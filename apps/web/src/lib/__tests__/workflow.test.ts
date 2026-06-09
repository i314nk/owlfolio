import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { CertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import {
  createResearchCase,
  discoverCandidate,
  draftDecision,
  draftQuickScreen,
  confirmWatchlistDraft,
  queueDeepDive,
  queueDiscoveryCandidateForQuickScreen,
  startDeepDive,
} from '@owlfolio/workflow'
import { afterEach, describe, expect, it } from 'vitest'

import {
  confirmPersonalHoldingReviewDraft,
  confirmPersonalWatchlistDraft,
  createPersonalHoldingReviewDraft,
  enqueueResearchRun,
  getAppHoldingsFromStore,
  getAppResearchCaseFromStore,
  getAppResearchPipelineFromStore,
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

  it('enqueues a research run and appends a research_run_requested event to the durable ledger (production spawn path)', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-enqueue-research-'))
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
          initialized_at: '2026-05-29T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
        },
        is_initialized: true,
      }

      const result = await enqueueResearchRun(state, { ticker: 'MSFT', company_id: 'company_msft' }, { spawn: (_paths) => {} })

      expect(result.research_case_id).toMatch(/^rc_msft_/)

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          event_id: `evt_research_run_requested_${result.research_case_id}`,
          event_type: 'research_run_requested',
          aggregate_type: 'research_case',
          aggregate_id: result.research_case_id,
          correlation_id: result.research_case_id,
          actor_type: 'user',
          actor_id: 'user_local',
          source_ids: [],
          schema_version: 1,
          idempotency_key: `research-run-request:${result.research_case_id}:v1`,
        })
        expect(events[0]?.payload).toMatchObject({
          research_case_id: result.research_case_id,
          ticker: 'MSFT',
          requested_by: 'user_local',
        })
        // Production path: swarm is NOT run inline; only the requested event is present
        expect(events.some((e) => e.event_type === 'research_run_claimed')).toBe(false)
        expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(false)
      } finally {
        store.close()
      }
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('runs the research swarm inline (playwright test mode) and produces a complete decision in the same store', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-enqueue-inline-'))
      dirs.push(projectDir)

      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
      await mkdir(sourceLedgerPath, { recursive: true })

      const state = {
        config: {
          ...defaultPersonalLocalAppConfig(),
          provider: {
            provider_id: 'mock-provider' as const,
            support_level: 'certified' as const,
            model_id: 'mock-buffett-munger-demo',
          },
          initialized_at: '2026-05-29T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
        },
        is_initialized: true,
      }

      // No spawn dep needed — inline path must not spawn
      const result = await enqueueResearchRun(state, { ticker: 'MSFT' })

      expect(result.research_case_id).toMatch(/^rc_msft_/)

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()
        const eventTypes = events.map((e) => e.event_type)

        // research_run_requested was appended
        expect(eventTypes).toContain('research_run_requested')

        // research_run_claimed was appended inline
        const claimedEvent = events.find((e) => e.event_type === 'research_run_claimed')
        expect(claimedEvent).toBeDefined()
        expect(claimedEvent).toMatchObject({
          event_type: 'research_run_claimed',
          aggregate_type: 'research_case',
          aggregate_id: result.research_case_id,
          correlation_id: result.research_case_id,
          actor_type: 'worker',
          actor_id: 'owlfolio-worker',
          source_ids: [],
          schema_version: 1,
          idempotency_key: `research-run-claim:${result.research_case_id}:v1`,
        })
        expect(claimedEvent?.payload).toMatchObject({
          research_case_id: result.research_case_id,
          run_id: `run_${result.research_case_id}`,
          worker_id: 'owlfolio-worker',
        })

        // The swarm ran inline: decision_drafted must be present
        expect(eventTypes).toContain('decision_drafted')

        // The buffett-munger analysis event must be present
        expect(eventTypes).toContain('buffett_munger_analysis_drafted')
      } finally {
        store.close()
      }
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('sanitizes legacy source bundle paths and secret-bearing URLs before UI projection', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-source-privacy-'))
    dirs.push(projectDir)

    const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
    await mkdir(sourceLedgerPath, { recursive: true })
    const store = new SQLiteEventStore()
    try {
      const created = await createResearchCase(store, {
        research_case_id: 'rc_privacy_001',
        company_id: 'company_privacy',
        ticker: 'PRIV',
        strategy_id: 'buffett-munger',
        strategy_version: '1.0.0',
        actor_id: 'user_local',
      })
      await draftDecision(store, {
        research_case_id: created.research_case_id,
        decision_id: 'decision_privacy_001',
        decision: 'WATCH',
        reason: 'Privacy fixture decision.',
        source_ids: ['src_private_fixture'],
        causation_id: created.event_id,
      })
      await writeFile(join(sourceLedgerPath, 'research-source-bundle-rc_privacy_001.json'), JSON.stringify({
        research_case_id: 'rc_privacy_001',
        provider_id: 'legacy-provider',
        captured_at: '2026-06-07T14:00:00.000Z',
        records: [
          {
            source_id: 'src_private_fixture',
            source_type: 'local-file',
            title: '/root/private-source.txt',
            excerpt: 'Loaded from /workspace/private/secrets/model-output.txt and /srv/owlfolio/private-note.md',
            url: 'https://user:pass@example.test/research/source?token=secret#private',
            citation_locator: '/data/private-notes/source.md',
            captured_at: '2026-06-07T14:00:00.000Z',
          },
        ],
      }))

      const researchCase = await getAppResearchCaseFromStore(store, 'personal-local', 'rc_privacy_001', sourceLedgerPath)

      expect(researchCase.source_evidence).toEqual([
        {
          source_id: 'src_private_fixture',
          title: 'Source evidence recorded',
          excerpt: 'Local source evidence was recorded with private path details redacted.',
          url: 'https://example.test/research/source',
        },
      ])
      expect(JSON.stringify(researchCase.source_evidence)).not.toMatch(/token|secret|user:pass|\/root|\/workspace|\/srv|\/data/i)
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

    const created = await setupMsftResearchCaseInLedger(ledgerPath)
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
      // Confirmation reuses the promotion decision — no duplicate gate event for watchlist_confirmation.
      expect(gateEvents.map((event) => event.payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({ target_transition: 'watchlist_promotion', target_id: promoted.watchlist_item_id, allowed: true }),
        expect.objectContaining({ target_transition: 'holding_open', target_id: openedHolding.holding_id, allowed: true }),
      ]))
      // Exactly ONE gate decision for the watchlist_item_id (the promotion one; no confirmation duplicate).
      const watchlistItemGatePayloads = gateEvents
        .map((event) => event.payload)
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object' && !Array.isArray(p))
        .filter((p) => p['target_id'] === promoted.watchlist_item_id)
      expect(watchlistItemGatePayloads).toHaveLength(1)
      expect(watchlistItemGatePayloads[0]).toMatchObject({ target_transition: 'watchlist_promotion' })
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

      const created = await setupMsftResearchCaseInLedger(ledgerPath)
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

    const created = await setupMsftResearchCaseInLedger(ledgerPath)
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

  it('projects the selected strategy research pipeline into cockpit sections', async () => {
    const store = new SQLiteEventStore()
    const selectedStrategy = { strategy_id: 'buffett-munger', strategy_version: 'v2-alpha' }
    const otherStrategy = { strategy_id: 'income-yield', strategy_version: 'v1' }

    try {
      const discovered = await discoverCandidate(store, {
        candidate_id: 'candidate_discovered_001',
        ticker: 'DSCV',
        company_name: 'Discovered Co',
        market: 'NYSE',
        ...selectedStrategy,
        discovery_source: 'mock-screener',
        source_ids: ['src_discovered'],
        actor_id: 'worker_discovery',
      })
      const quickScreenCandidate = await discoverCandidate(store, {
        candidate_id: 'candidate_quick_001',
        ticker: 'QSCR',
        company_name: 'Quick Screen Co',
        market: 'NASDAQ',
        ...selectedStrategy,
        discovery_source: 'mock-screener',
        source_ids: ['src_quick_candidate'],
        actor_id: 'worker_discovery',
      })
      await queueDiscoveryCandidateForQuickScreen(store, {
        candidate_id: quickScreenCandidate.candidate_id,
        queue_id: 'queue_candidate_quick_001',
        causation_id: quickScreenCandidate.event_id,
        actor_id: 'worker_discovery',
      })
      await discoverCandidate(store, {
        candidate_id: 'candidate_other_strategy_001',
        ticker: 'OTHR',
        company_name: 'Other Strategy Co',
        market: 'NYSE',
        ...otherStrategy,
        discovery_source: 'mock-screener',
        source_ids: ['src_other_strategy'],
        actor_id: 'worker_discovery',
      })

      const quickCase = await createResearchCase(store, {
        research_case_id: 'rc_quick_001',
        company_id: 'company_quick',
        ticker: 'QKCS',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      await draftQuickScreen(store, {
        research_case_id: quickCase.research_case_id,
        quick_screen_id: 'quick_rc_quick_001',
        company_id: 'company_quick',
        ticker: 'QKCS',
        ...selectedStrategy,
        screening_result: 'deep_dive_candidate',
        summary: 'Quick screen recommends a deeper selected-strategy review.',
        business_quality: 'Good enough for a deeper review.',
        moat: 'Moat needs specialist confirmation.',
        management_capital_allocation: 'Needs capital allocation review.',
        financial_quality: 'Financial quality appears resilient.',
        valuation_sanity: 'Valuation needs a margin-of-safety pass.',
        shariah_status: 'PENDING',
        red_flags: [],
        confidence: 'medium',
        caveats: ['Quick screen only'],
        source_ids: ['src_quick_case'],
        actor_id: 'mock-provider',
      })

      const queuedCase = await createResearchCase(store, {
        research_case_id: 'rc_queue_001',
        company_id: 'company_queue',
        ticker: 'QDVE',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      const queuedQuickScreen = await draftQuickScreen(store, {
        research_case_id: queuedCase.research_case_id,
        quick_screen_id: 'quick_rc_queue_001',
        company_id: 'company_queue',
        ticker: 'QDVE',
        ...selectedStrategy,
        screening_result: 'deep_dive_candidate',
        summary: 'Queue this company for deep dive.',
        business_quality: 'Quality evidence is promising.',
        moat: 'Moat evidence is plausible.',
        management_capital_allocation: 'Capital allocation requires diligence.',
        financial_quality: 'Financials pass the initial filter.',
        valuation_sanity: 'Valuation requires detailed review.',
        shariah_status: 'PENDING',
        red_flags: [],
        confidence: 'medium',
        caveats: ['Needs a full source pass'],
        source_ids: ['src_queue_case'],
        actor_id: 'mock-provider',
      })
      await queueDeepDive(store, {
        research_case_id: queuedCase.research_case_id,
        queue_id: 'queue_rc_queue_001',
        ...selectedStrategy,
        source_ids: ['src_queue_case'],
        causation_id: queuedQuickScreen.event_id,
        actor_id: 'system',
      })

      const deepDiveCase = await createResearchCase(store, {
        research_case_id: 'rc_deep_001',
        company_id: 'company_deep',
        ticker: 'DEEP',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      const deepDiveQuickScreen = await draftQuickScreen(store, {
        research_case_id: deepDiveCase.research_case_id,
        quick_screen_id: 'quick_rc_deep_001',
        company_id: 'company_deep',
        ticker: 'DEEP',
        ...selectedStrategy,
        screening_result: 'deep_dive_candidate',
        summary: 'Start deep dive after queueing.',
        business_quality: 'Quality evidence is promising.',
        moat: 'Moat evidence is plausible.',
        management_capital_allocation: 'Capital allocation requires diligence.',
        financial_quality: 'Financials pass the initial filter.',
        valuation_sanity: 'Valuation requires detailed review.',
        shariah_status: 'PENDING',
        red_flags: [],
        confidence: 'medium',
        caveats: ['Needs a full source pass'],
        source_ids: ['src_deep_case'],
        actor_id: 'mock-provider',
      })
      const queuedDeepDive = await queueDeepDive(store, {
        research_case_id: deepDiveCase.research_case_id,
        queue_id: 'queue_rc_deep_001',
        ...selectedStrategy,
        source_ids: ['src_deep_case'],
        causation_id: deepDiveQuickScreen.event_id,
        actor_id: 'system',
      })
      await startDeepDive(store, {
        research_case_id: deepDiveCase.research_case_id,
        deep_dive_id: 'deep_rc_deep_001',
        ...selectedStrategy,
        specialist_lanes: ['moat', 'valuation'],
        source_ids: ['src_deep_case', 'src_deep_transcript'],
        causation_id: queuedDeepDive.event_id,
        actor_id: 'worker_research',
      })

      const decisionCase = await createResearchCase(store, {
        research_case_id: 'rc_decision_001',
        company_id: 'company_decision',
        ticker: 'DCSN',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      await draftDecision(store, {
        research_case_id: decisionCase.research_case_id,
        decision_id: 'decision_rc_decision_001',
        decision: 'WATCH',
        reason: 'Draft decision is waiting for user review.',
        causation_id: decisionCase.event_id,
      })

      const watchlistCase = await createResearchCase(store, {
        research_case_id: 'rc_watch_001',
        company_id: 'company_watch',
        ticker: 'WTCH',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      await confirmWatchlistDraft(store, {
        watchlist_item_id: 'watch_rc_watch_001',
        research_case_id: watchlistCase.research_case_id,
        decision_id: 'decision_rc_watch_001',
        company_id: 'company_watch',
        ticker: 'WTCH',
        ...selectedStrategy,
        thesis_summary: 'Selected-strategy watchlist draft awaits user confirmation.',
        actor_id: 'user_local',
      })

      const passedCase = await createResearchCase(store, {
        research_case_id: 'rc_pass_001',
        company_id: 'company_pass',
        ticker: 'PASS',
        ...selectedStrategy,
        actor_id: 'user_local',
      })
      await draftQuickScreen(store, {
        research_case_id: passedCase.research_case_id,
        quick_screen_id: 'quick_rc_pass_001',
        company_id: 'company_pass',
        ticker: 'PASS',
        ...selectedStrategy,
        screening_result: 'pass',
        summary: 'Initial screen says pass for now.',
        business_quality: 'Good business but not compelling enough.',
        moat: 'Moat evidence is mixed.',
        management_capital_allocation: 'Capital allocation is acceptable.',
        financial_quality: 'Financial quality is stable.',
        valuation_sanity: 'Valuation is not attractive enough.',
        shariah_status: 'PENDING',
        red_flags: [],
        confidence: 'medium',
        caveats: ['Can be revisited later'],
        source_ids: ['src_pass_case'],
        actor_id: 'mock-provider',
      })

      const pipeline = await getAppResearchPipelineFromStore(store, 'personal-local', selectedStrategy.strategy_id)
      const sectionItems = Object.fromEntries(
        pipeline.sections.map((section) => [section.title, section.items.map((item) => item.label)]),
      )

      expect(pipeline.selectedStrategyLabel).toBe('Selected strategy: buffett-munger')
      expect(sectionItems['Discovered']).toEqual([`${discovered.ticker} — ${discovered.company_name}`])
      expect(sectionItems['Quick Screen']).toEqual(expect.arrayContaining([
        `${quickScreenCandidate.ticker} — ${quickScreenCandidate.company_name}`,
        'QKCS',
      ]))
      expect(sectionItems['Deep Dive Queue']).toEqual(['QDVE'])
      expect(sectionItems['In Deep Dive']).toEqual(['DEEP'])
      expect(sectionItems['Synthesis / Decision Pending']).toEqual(['DCSN'])
      const decisionItem = pipeline.sections
        .flatMap((section) => section.items)
        .find((item) => item.id === 'rc_decision_001')
      expect(decisionItem?.summary).toBe('Draft decision is waiting for user review.')
      expect(sectionItems.Watchlist).toEqual(['WTCH'])
      expect(sectionItems['Rejected / Passed']).toEqual(['PASS'])
      expect(pipeline.sections.flatMap((section) => section.items.map((item) => item.label))).not.toContain('OTHR — Other Strategy Co')
    } finally {
      store.close()
    }
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

  it('enqueueResearchRun throws when research_engine_enabled is false (master switch off)', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-master-switch-off-'))
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
          initialized_at: '2026-06-08T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            research_engine_enabled: false,
          },
        },
        is_initialized: true,
      }

      await expect(
        enqueueResearchRun(state, { ticker: 'AAPL' }, { spawn: (_paths) => {} }),
      ).rejects.toThrow('Research engine is turned off in Settings. Enable it to run research.')
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('enqueueResearchRun proceeds normally when research_engine_enabled is true', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-master-switch-on-'))
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
          initialized_at: '2026-06-08T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            research_engine_enabled: true,
          },
        },
        is_initialized: true,
      }

      const result = await enqueueResearchRun(state, { ticker: 'GOOG' }, { spawn: (_paths) => {} })
      expect(result.research_case_id).toMatch(/^rc_goog_/)
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('enqueueResearchRun proceeds normally when automation field is absent (legacy config)', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-master-switch-legacy-'))
      dirs.push(projectDir)

      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
      const baseConfig = defaultPersonalLocalAppConfig()
      // Simulate a legacy config without automation field
      const { automation: _dropped, ...configWithoutAutomation } = baseConfig
      const state = {
        config: {
          ...configWithoutAutomation,
          provider: {
            provider_id: 'mock-provider' as const,
            support_level: 'certified' as const,
            model_id: 'mock-buffett-munger-demo',
          },
          initialized_at: '2026-06-08T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
        },
        is_initialized: true,
      }

      // automation is undefined → research_engine_enabled defaults to true → should not throw
      const result = await enqueueResearchRun(state, { ticker: 'NVDA' }, { spawn: (_paths) => {} })
      expect(result.research_case_id).toMatch(/^rc_nvda_/)
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })
})

function unsupportedCompletedReport(providerId: 'claude' | 'openai'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    target: {
      provider_surface_id: providerId === 'claude' ? 'claude-cli' : 'openai-codex-cli',
      vendor_id: providerId === 'claude' ? 'anthropic' : 'openai',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      model_id: providerId === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.5',
      workflow_role: 'research_draft',
      schema_version: 1,
    },
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-02T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    cases: [],
    summary: '0/13 scenarios passed; provider support level is unsupported.',
  }
}

/**
 * Sets up a minimal MSFT research case directly in the SQLite ledger at ledgerPath,
 * producing a `decision_drafted` stage with the standard mock-provider source IDs.
 * Use this in tests that need a pre-existing research case to test downstream workflow steps
 * (watchlist promotion, holding open, etc.) without calling the now-retired synchronous
 * `createPersonalResearchCase` / `runClaudeBuffettMungerResearch` path.
 */
async function setupMsftResearchCaseInLedger(
  ledgerPath: string,
): Promise<{ research_case_id: string; decision_id: string }> {
  const researchCaseId = `rc_msft_${Date.now()}`
  const decisionId = `decision_msft_${Date.now()}`
  const sourceIds = ['src_msft_10k_2025', 'src_msft_proxy_2025', 'src_msft_q1_2026']
  const store = new SQLiteEventStore(ledgerPath)
  try {
    const researchCase = await createResearchCase(store, {
      research_case_id: researchCaseId,
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${researchCaseId}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: 'mock-provider',
      payload: {
        research_case_id: researchCaseId,
        company_id: 'company_msft',
        ticker: 'MSFT',
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        shariah_status: 'COMPLIANT',
        valuation_status: 'EXPENSIVE',
        next_required_action: 'Wait for a wider margin of safety and refresh MSFT source coverage after the next quarterly filing.',
        thesis_summary: 'Microsoft screens as a durable quality compounder, but remains a watchlist candidate until valuation provides a wider margin of safety.',
        evidence_summary: 'Microsoft source records cover the latest annual report, proxy governance context, and recent quarterly operating momentum.',
        valuation_rationale: 'Current valuation remains elevated versus the required Buffett-Munger margin of safety.',
        shariah_rationale: 'Mock source coverage did not identify prohibited-business evidence; final Shariah treatment remains subject to sourced ratio review.',
        risks: ['Valuation compression', 'Source coverage may need refreshing after the next filing'],
        open_questions: ['Refresh owner-earnings and Shariah ratio evidence after the next quarterly filing'],
        quick_screen: {
          summary: 'Quality screen recommends deep dive.',
          business_quality: 'Sticky enterprise demand.',
          moat: 'Switching costs and ecosystem breadth.',
          management_capital_allocation: 'Capital allocation requires diligence.',
          financial_quality: 'High margins and FCF conversion.',
          shariah_data_availability: 'Source records exist; ratio refresh required.',
          red_flags: ['Valuation deferred to deep dive'],
          confidence: 'medium',
          caveats: ['Single-agent screen only'],
          deep_dive_recommendation: 'deep_dive_candidate',
        },
        owner_earnings_valuation: {
          summary: 'Owner-earnings valuation points to a watchlist posture.',
          normalized_owner_earnings: '$85B normalized owner earnings',
          assumptions: ['5% ten-year growth', '10% discount rate'],
          fair_value_range: '$360–$420/share',
          buy_price_range: '$260–$300/share',
          margin_of_safety: '25%–35%',
          sources: sourceIds,
          confidence: 'medium',
          caveats: ['AI capex normalization is the key swing factor'],
        },
      },
      source_ids: sourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
    })
    await draftDecision(store, {
      research_case_id: researchCaseId,
      decision_id: decisionId,
      decision: 'WATCH',
      reason: 'Durable quality business, but current valuation does not yet provide a sufficient margin of safety.',
      causation_id: researchCase.event_id,
      source_ids: sourceIds,
    })
  } finally {
    store.close()
  }
  return { research_case_id: researchCaseId, decision_id: decisionId }
}
