import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { CertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { createResearchCase, draftDecision } from '@owlfolio/workflow'
import { afterEach, describe, expect, it } from 'vitest'

import {
  confirmPersonalHoldingReviewDraft,
  confirmPersonalWatchlistDraft,
  createPersonalHoldingReviewDraft,
  createPersonalResearchCase,
  getAppHoldingsFromStore,
  getAppResearchCaseFromStore,
  getAppWatchlistItemsFromStore,
  openPersonalHoldingFromWatchlist,
  overridePersonalHoldingReviewDraft,
  promoteResearchCaseToWatchlist,
  recordPersonalHoldingValuation,
  rejectPersonalHoldingReviewDraft,
  resolveActiveWorkflowMode,
  resolveModelIdForProvider,
} from '../workflow'

describe('workflow helpers', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('creates and drafts the first personal-local research case in the configured durable ledger', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-workflow-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
    const created = await createPersonalResearchCase(
      {
        config: {
          ...defaultPersonalLocalAppConfig(),
          provider: {
            provider_id: 'mock-provider',
            support_level: 'certified',
            model_id: 'mock-buffett-munger-demo',
          },
          initialized_at: '2026-05-29T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
        },
        is_initialized: true,
      },
      { ticker: 'MSFT', company_id: 'company_msft' },
    )

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect(created.research_case_id).toMatch(/^rc_msft_/)
      const researchCase = await getAppResearchCaseFromStore(store, 'personal-local', created.research_case_id)
      expect(researchCase).toMatchObject({
        ticker: 'MSFT',
        company_id: 'company_msft',
        stage: 'decision_drafted',
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        shariah_status: 'COMPLIANT',
        valuation_status: 'EXPENSIVE',
      })
      expect(researchCase.next_required_action).toMatch(/MSFT source coverage/i)
      expect(researchCase.next_required_action).not.toMatch(/Costco|COST\b/)
      expect(researchCase.source_ids).toEqual(['src_msft_10k_2025', 'src_msft_proxy_2025', 'src_msft_q1_2026'])
    } finally {
      store.close()
    }
  })

  it('promotes and confirms a drafted personal-local decision into a user-approved watchlist item', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-promotion-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
    const state = {
      config: {
        ...defaultPersonalLocalAppConfig(),
        provider: {
          provider_id: 'mock-provider' as const,
          support_level: 'certified' as const,
          model_id: 'mock-buffett-munger-demo',
        },
        initialized_at: '2026-05-31T12:00:00.000Z',
        ledger_path: ledgerPath,
        source_ledger_path: sourceLedgerPath,
      },
      is_initialized: true,
    }

    const created = await createPersonalResearchCase(state, { ticker: 'MSFT', company_id: 'company_msft' })
    const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)
    const confirmed = await confirmPersonalWatchlistDraft(state, promoted.watchlist_item_id)
    const openedHolding = await openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id, {
      shares: '3.25',
      cost_basis_per_share: '812.40',
      currency: 'USD',
      opened_at: '2026-05-31',
    })
    const valuation = await recordPersonalHoldingValuation(state, openedHolding.holding_id, {
      price_per_share: '900',
      currency: 'USD',
      valued_at: '2026-06-01',
    })
    const reviewDraft = await createPersonalHoldingReviewDraft(state, openedHolding.holding_id)
    const reviewConfirmation = await confirmPersonalHoldingReviewDraft(state, openedHolding.holding_id, reviewDraft.review_id)
    const secondReviewDraft = await createPersonalHoldingReviewDraft(state, openedHolding.holding_id)
    const reviewOverride = await overridePersonalHoldingReviewDraft(state, openedHolding.holding_id, secondReviewDraft.review_id, {
      thesis_health: 'WATCH',
      action_stance: 'RESEARCH_MORE',
      rationale: 'User override: valuation requires another evidence pass before adding.',
      evidence_summary: 'Compared provider draft to the manual valuation snapshot and original thesis.',
      uncertainty: 'Need updated Shariah ratio review and concentration check.',
      next_review_at: '2026-10-31',
    })
    const rejectedReviewDraft = await createPersonalHoldingReviewDraft(state, openedHolding.holding_id)
    const reviewRejection = await rejectPersonalHoldingReviewDraft(state, openedHolding.holding_id, rejectedReviewDraft.review_id, {
      rejection_reason: 'Reject stale draft after override; wait for new evidence.',
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect(promoted).toMatchObject({
        research_case_id: created.research_case_id,
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        user_approved: false,
        created_by_actor_type: 'user',
        created_by_actor_id: 'user_local',
      })
      expect(promoted.watchlist_item_id).toMatch(/^watch_msft_/)
      expect(confirmed).toMatchObject({
        watchlist_item_id: promoted.watchlist_item_id,
        research_case_id: created.research_case_id,
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
      })
      expect(openedHolding).toMatchObject({
        watchlist_item_id: promoted.watchlist_item_id,
        research_case_id: created.research_case_id,
        ticker: 'MSFT',
        shares: 3.25,
        cost_basis_per_share: 812.4,
        opened_at: '2026-05-31',
        total_cost_basis: 2640.3,
        currency: 'USD',
        opened_by_actor_type: 'user',
        opened_by_actor_id: 'user_local',
      })
      expect(valuation).toMatchObject({
        holding_id: openedHolding.holding_id,
        price_per_share: 900,
        shares: 3.25,
        market_value: 2925,
        currency: 'USD',
        valued_at: '2026-06-01',
        valued_by_actor_type: 'user',
        valued_by_actor_id: 'user_local',
      })
      expect(reviewDraft).toMatchObject({
        holding_id: openedHolding.holding_id,
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        thesis_health: 'HEALTHY',
        action_stance: 'HOLD',
        user_approved: false,
        reviewed_by_actor_type: 'provider',
        reviewed_by_actor_id: 'mock-provider',
        next_review_at: '2026-09-30',
      })
      expect(reviewConfirmation).toMatchObject({
        review_id: reviewDraft.review_id,
        holding_id: openedHolding.holding_id,
        thesis_health: 'HEALTHY',
        action_stance: 'HOLD',
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
        next_review_at: '2026-09-30',
      })
      expect(reviewOverride).toMatchObject({
        review_id: secondReviewDraft.review_id,
        holding_id: openedHolding.holding_id,
        thesis_health: 'WATCH',
        action_stance: 'RESEARCH_MORE',
        rationale: 'User override: valuation requires another evidence pass before adding.',
        user_approved: true,
        user_overrode_provider: true,
        overridden_by_actor_type: 'user',
        overridden_by_actor_id: 'user_local',
        next_review_at: '2026-10-31',
      })
      expect(reviewRejection).toMatchObject({
        review_id: rejectedReviewDraft.review_id,
        holding_id: openedHolding.holding_id,
        user_approved: false,
        rejected_by_actor_type: 'user',
        rejected_by_actor_id: 'user_local',
        rejection_reason: 'Reject stale draft after override; wait for new evidence.',
      })
      const watchlistItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
      expect(watchlistItems).toHaveLength(1)
      expect(watchlistItems[0]).toMatchObject({
        watchlist_item_id: promoted.watchlist_item_id,
        research_case_id: created.research_case_id,
        thesis_summary: expect.stringMatching(/watch/i),
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
        holding_id: expect.stringMatching(/^holding_msft_/),
        shariah_gate_status: 'COMPLIANT',
        shariah_gate_allowed: true,
        shariah_required_source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025', 'src_msft_q1_2026'],
      })
      await expect(getAppHoldingsFromStore(store, 'personal-local')).resolves.toMatchObject([
        {
          holding_id: expect.stringMatching(/^holding_msft_/),
          ticker: 'MSFT',
          shares: 3.25,
          cost_basis_per_share: 812.4,
          total_cost_basis: 2640.3,
          opened_at: '2026-05-31',
          latest_price_per_share: 900,
          latest_market_value: 2925,
          latest_valuation_at: '2026-06-01',
          unrealized_gain_loss: 284.7,
          unrealized_gain_loss_percent: 10.78,
          portfolio_weight: 100,
          latest_review_id: secondReviewDraft.review_id,
          thesis_health: 'WATCH',
          action_stance: 'RESEARCH_MORE',
          latest_review_rationale: 'User override: valuation requires another evidence pass before adding.',
          latest_review_evidence_summary: 'Compared provider draft to the manual valuation snapshot and original thesis.',
          latest_review_uncertainty: 'Need updated Shariah ratio review and concentration check.',
          next_review_at: '2026-10-31',
          shariah_gate_status: 'COMPLIANT',
          shariah_gate_allowed: true,
          shariah_required_source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025', 'src_msft_q1_2026'],
        },
      ])
      const gateEvents = (await store.list()).filter((event) => event.event_type === 'shariah_gate_decision_recorded')
      expect(gateEvents.map((event) => event.payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({ target_transition: 'watchlist_promotion', target_id: promoted.watchlist_item_id, allowed: true }),
        expect.objectContaining({ target_transition: 'watchlist_confirmation', target_id: promoted.watchlist_item_id, allowed: true }),
        expect.objectContaining({ target_transition: 'holding_open', target_id: openedHolding.holding_id, allowed: true }),
      ]))
      const [projectedHolding] = await getAppHoldingsFromStore(store, 'personal-local')
      expect(projectedHolding?.pending_review_id).toBeUndefined()
    } finally {
      store.close()
    }
  })

  it('rejects provider-authored holding review drafts when the latest certification report is unsupported', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-holding-review-unsupported-provider-'))
    dirs.push(projectDir)
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(reportDir, 'claude.latest.json'), JSON.stringify(unsupportedCompletedReport('claude')), 'utf8')

    const previousCertificationDir = process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
    process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR = reportDir
    process.env.ANTHROPIC_API_KEY = 'credential-file-exists-but-live-certification-failed'

    try {
      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
      const state = {
        config: {
          ...defaultPersonalLocalAppConfig(),
          provider: {
            provider_id: 'mock-provider' as const,
            support_level: 'certified' as const,
            model_id: 'mock-buffett-munger-demo',
          },
          initialized_at: '2026-06-02T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
        },
        is_initialized: true,
      }

      const created = await createPersonalResearchCase(state, { ticker: 'MSFT', company_id: 'company_msft' })
      const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)
      await confirmPersonalWatchlistDraft(state, promoted.watchlist_item_id)
      const openedHolding = await openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id)
      const unsupportedProviderState = {
        ...state,
        config: {
          ...state.config,
          provider: {
            provider_id: 'claude' as const,
            support_level: 'experimental' as const,
            model_id: 'claude-sonnet-4',
          },
        },
      }

      await expect(createPersonalHoldingReviewDraft(unsupportedProviderState, openedHolding.holding_id))
        .rejects.toThrow('Provider claude is not ready: 0/13 scenarios passed; provider support level is unsupported.')
    } finally {
      if (previousCertificationDir === undefined) {
        delete process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
      } else {
        process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR = previousCertificationDir
      }
      if (previousAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropicKey
      }
    }
  })

  it('records a blocked Shariah gate before rejecting personal-local watchlist promotion', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-shariah-blocked-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = {
      config: {
        ...defaultPersonalLocalAppConfig(),
        ledger_path: ledgerPath,
        shariah: { ...defaultPersonalLocalAppConfig().shariah, allow_conditional: false },
      },
      is_initialized: true,
    }
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const researchCase = await createResearchCase(store, {
        research_case_id: 'rc_blocked_001',
        company_id: 'company_blocked',
        ticker: 'BLCK',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
      })
      await store.append({
        event_id: 'evt_analysis_rc_blocked_001',
        event_type: 'buffett_munger_analysis_drafted',
        aggregate_type: 'research_case',
        aggregate_id: researchCase.research_case_id,
        correlation_id: researchCase.research_case_id,
        actor_type: 'provider',
        actor_id: 'mock-provider',
        payload: {
          research_case_id: researchCase.research_case_id,
          company_id: researchCase.company_id,
          ticker: researchCase.ticker,
          investment_verdict: 'WATCH',
          strategy_compliance: 'CONDITIONAL',
          shariah_status: 'NON_COMPLIANT',
          valuation_status: 'EXPENSIVE',
          next_required_action: 'Do not promote without Shariah remediation.',
        },
        source_ids: ['src_blocked_10k_2025', 'src_blocked_screen_2025'],
        created_at: '2026-06-01T00:00:00.000Z',
        schema_version: 1,
      })
      await draftDecision(store, {
        research_case_id: researchCase.research_case_id,
        decision_id: 'decision_blocked_watch_001',
        decision: 'WATCH',
        reason: 'Provider draft says watch, but gate must block non-compliant Shariah status.',
        causation_id: 'evt_analysis_rc_blocked_001',
      })

      await expect(promoteResearchCaseToWatchlist(state, researchCase.research_case_id)).rejects.toThrow(/Shariah gate blocked watchlist_promotion/)
      const events = await store.list()
      expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event_type: 'shariah_gate_decision_recorded',
          payload: expect.objectContaining({
            target_transition: 'watchlist_promotion',
            research_case_id: researchCase.research_case_id,
            status: 'NON_COMPLIANT',
            allowed: false,
            required_source_ids: ['src_blocked_10k_2025', 'src_blocked_screen_2025'],
          }),
        }),
      ]))
    } finally {
      store.close()
    }
  })

  it('rejects invalid personal-local holding lot input before appending an event', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-holding-validation-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
    const state = {
      config: {
        ...defaultPersonalLocalAppConfig(),
        provider: {
          provider_id: 'mock-provider' as const,
          support_level: 'certified' as const,
          model_id: 'mock-buffett-munger-demo',
        },
        initialized_at: '2026-05-31T12:00:00.000Z',
        ledger_path: ledgerPath,
        source_ledger_path: sourceLedgerPath,
      },
      is_initialized: true,
    }

    const created = await createPersonalResearchCase(state, { ticker: 'MSFT', company_id: 'company_msft' })
    const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)
    await confirmPersonalWatchlistDraft(state, promoted.watchlist_item_id)

    await expect(openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id, {
      shares: '0',
      cost_basis_per_share: '812.40',
      currency: 'USD',
      opened_at: '2026-05-31',
    })).rejects.toThrow('Holding shares must be greater than zero')
    await expect(openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id, {
      shares: '3.25',
      cost_basis_per_share: '812.40',
      currency: 'INVALID',
      opened_at: '2026-05-31',
    })).rejects.toThrow('Holding currency must be a valid ISO 4217 currency code')

    const openedHolding = await openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id, {
      shares: '3.25',
      cost_basis_per_share: '812.40',
      currency: 'USD',
      opened_at: '2026-05-31',
    })
    await expect(recordPersonalHoldingValuation(state, openedHolding.holding_id, {
      price_per_share: '-1',
      currency: 'USD',
      valued_at: '2026-06-01',
    })).rejects.toThrow('Valuation price per share cannot be negative')
    await expect(recordPersonalHoldingValuation(state, openedHolding.holding_id, {
      price_per_share: '900',
      currency: 'ZZZZ',
      valued_at: '2026-06-01',
    })).rejects.toThrow('Valuation currency must be a valid ISO 4217 currency code')
    await expect(recordPersonalHoldingValuation(state, openedHolding.holding_id, {
      price_per_share: '900',
      currency: 'USD',
      valued_at: 'June 1, 2026',
    })).rejects.toThrow('Valuation date must use YYYY-MM-DD format')
  })

  it('defaults openai provider runs to a ChatGPT-backed Codex-supported model id', () => {
    expect(resolveModelIdForProvider({
      provider: {
        provider_id: 'openai',
        support_level: 'experimental',
      },
    })).toBe('gpt-5.5')
  })

  it('returns an empty watchlist for a newly initialized personal ledger', async () => {
    const store = new SQLiteEventStore()
    try {
      await expect(getAppWatchlistItemsFromStore(store, 'personal-local')).resolves.toEqual([])
    } finally {
      store.close()
    }
  })

  it('keeps demo mode routed through the seeded demo loaders', () => {
    expect(resolveActiveWorkflowMode({ mode: 'demo' })).toBe('demo')
    expect(resolveActiveWorkflowMode({ mode: 'personal-local' })).toBe('personal-local')
  })
})

function unsupportedCompletedReport(providerId: 'claude' | 'openai'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-02T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
    },
    cases: [],
    summary: '0/13 scenarios passed; provider support level is unsupported.',
  }
}
