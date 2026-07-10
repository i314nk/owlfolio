import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import type { CertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { CHECKLIST_PARAMS, listBusinessItems } from '@owlfolio/strategies/checklistParams'
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

import { resolveAppConfigPath } from '../appConfigStore'
import {
  confirmPersonalHoldingReviewDraft,
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
  requestDeepDiveRun,
  buildAdmitVerifiedCitationSet,
  resolveResearchCaseView,
  resolveActiveWorkflowMode,
  resolveModelIdForProvider,
  setInvestableCapital,
  getInvestableCapital,
} from '../workflow'

// A server-marshaled audit (one finding per business item + an ack flag) for a DIRECT confirmWatchlistDraft
// call. Review-and-promote: this is provenance, not a gate — confirmWatchlistDraft no longer blocks on it.
const COMPLETE_AUDIT = {
  version: CHECKLIST_PARAMS.version,
  business_findings: Object.fromEntries(listBusinessItems().map((item) => [item.id, `Marshaled finding for ${item.id}.`])),
  cognitive_acknowledged: true,
}

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

  it('propagates the web app resolved app-config path to the spawned research worker (so it does not fall back to the demo/mock config)', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-enqueue-research-config-'))
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

      let capturedPaths: { ledgerPath: string; sourceLedgerPath: string; appConfigPath: string } | undefined
      await enqueueResearchRun(state, { ticker: 'INTC' }, {
        spawn: (paths) => {
          capturedPaths = paths
        },
      })

      expect(capturedPaths?.appConfigPath).toBe(resolveAppConfigPath())
      expect(capturedPaths?.ledgerPath).toBe(ledgerPath)
      expect(capturedPaths?.sourceLedgerPath).toBe(sourceLedgerPath)
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
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            deep_dive_approval: 'automatic' as const,
          },
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

  describe('resolveResearchCaseView (post-start pending race)', () => {
    async function appendRunRequested(store: SQLiteEventStore, researchCaseId: string): Promise<void> {
      await store.append({
        event_id: `evt_research_run_requested_${researchCaseId}`,
        event_type: 'research_run_requested',
        aggregate_type: 'research_case',
        aggregate_id: researchCaseId,
        correlation_id: researchCaseId,
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { research_case_id: researchCaseId, ticker: 'MSFT', company_id: 'company_msft', requested_by: 'user_local' },
        source_ids: [],
        created_at: new Date().toISOString(),
        schema_version: 1,
        idempotency_key: `research-run-request:${researchCaseId}:v1`,
      })
    }

    it('reports pending when a run was requested but no case_created is projected yet', async () => {
      const store = new SQLiteEventStore()
      try {
        await appendRunRequested(store, 'rc_pending_001')
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_pending_001')
        expect(view.status).toBe('pending')
      } finally {
        store.close()
      }
    })

    async function appendRunRequestedAt(store: SQLiteEventStore, researchCaseId: string, createdAt: string): Promise<void> {
      await store.append({
        event_id: `evt_research_run_requested_${researchCaseId}`,
        event_type: 'research_run_requested',
        aggregate_type: 'research_case',
        aggregate_id: researchCaseId,
        correlation_id: researchCaseId,
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { research_case_id: researchCaseId, ticker: 'MSFT', company_id: 'company_msft', requested_by: 'user_local' },
        source_ids: [],
        created_at: createdAt,
        schema_version: 1,
        idempotency_key: `research-run-request:${researchCaseId}:v1`,
      })
    }

    it('fails a run left pending past the start-timeout (worker never started → no infinite spinner)', async () => {
      const store = new SQLiteEventStore()
      try {
        // Requested 10 minutes ago, never claimed / no case created → the worker never ran.
        await appendRunRequestedAt(store, 'rc_stuck_001', new Date(Date.now() - 10 * 60_000).toISOString())
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_stuck_001')
        expect(view.status).toBe('failed')
        if (view.status === 'failed') {
          expect(view.error_summary).toMatch(/did not start|no progress/i)
        }
      } finally {
        store.close()
      }
    })

    it('stays pending while the (configurable) start-timeout has not elapsed', async () => {
      const store = new SQLiteEventStore()
      try {
        // Same 10-minutes-old request, but a generous 30-minute timeout → still legitimately in flight.
        await appendRunRequestedAt(store, 'rc_within_001', new Date(Date.now() - 10 * 60_000).toISOString())
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_within_001', undefined, {
          pendingTimeoutMs: 30 * 60_000,
        })
        expect(view.status).toBe('pending')
      } finally {
        store.close()
      }
    })

    it('resolves to the real case once research_case_created is appended', async () => {
      const store = new SQLiteEventStore()
      try {
        await appendRunRequested(store, 'rc_resolve_001')
        await createResearchCase(store, {
          research_case_id: 'rc_resolve_001',
          company_id: 'company_msft',
          ticker: 'MSFT',
          strategy_id: 'buffett-munger',
          strategy_version: '1.0.0',
          actor_id: 'user_local',
        })
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_resolve_001')
        expect(view.status).toBe('ready')
        if (view.status === 'ready') {
          expect(view.researchCase.research_case_id).toBe('rc_resolve_001')
        }
      } finally {
        store.close()
      }
    })

    it('reports unknown when there is no event at all for the id (genuine 404)', async () => {
      const store = new SQLiteEventStore()
      try {
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_nonexistent_999')
        expect(view.status).toBe('unknown')
      } finally {
        store.close()
      }
    })

    it('reports failed (with summary) when research_run_failed exists and no case was created', async () => {
      const store = new SQLiteEventStore()
      try {
        await appendRunRequested(store, 'rc_failed_001')
        await store.append({
          event_id: 'evt_research_run_failed_rc_failed_001',
          event_type: 'research_run_failed',
          aggregate_type: 'research_case',
          aggregate_id: 'rc_failed_001',
          correlation_id: 'rc_failed_001',
          actor_type: 'worker',
          actor_id: 'owlfolio-worker',
          payload: { research_case_id: 'rc_failed_001', run_id: 'run_rc_failed_001', failed_at: new Date().toISOString(), error_summary: 'provider timed out' },
          source_ids: [],
          created_at: new Date().toISOString(),
          schema_version: 1,
        })
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_failed_001')
        expect(view.status).toBe('failed')
        if (view.status === 'failed') {
          expect(view.error_summary).toBe('provider timed out')
          // Ticker recovered from the run-request payload → the failed page can offer a re-run.
          expect(view.ticker).toBe('MSFT')
        }
      } finally {
        store.close()
      }
    })

    it('reports failed for a MID-RUN failure (case created, non-terminal stage) instead of the eternal loader', async () => {
      // The ADBE loading-forever bug: the case row existed (deep dive mid-flight), synthesis failed →
      // research_run_failed appended — but the ready branch never consulted it, so the page re-rendered
      // the animated progress view forever. A failure on a non-terminal case must surface as failed.
      const store = new SQLiteEventStore()
      try {
        await appendRunRequested(store, 'rc_midfail_001')
        await createResearchCase(store, {
          research_case_id: 'rc_midfail_001',
          company_id: 'company_adbe',
          ticker: 'ADBE',
          strategy_id: 'buffett-munger',
          strategy_version: '1.0.0',
          actor_id: 'user_local',
        })
        await store.append({
          event_id: 'evt_research_run_failed_rc_midfail_001',
          event_type: 'research_run_failed',
          aggregate_type: 'research_case',
          aggregate_id: 'rc_midfail_001',
          correlation_id: 'rc_midfail_001',
          actor_type: 'worker',
          actor_id: 'owlfolio-worker',
          payload: { research_case_id: 'rc_midfail_001', run_id: 'run_rc_midfail_001', failed_at: new Date().toISOString(), error_summary: 'synthesis stage failed after retry' },
          source_ids: [],
          created_at: new Date().toISOString(),
          schema_version: 1,
        })
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_midfail_001')
        expect(view.status).toBe('failed')
        if (view.status === 'failed') {
          expect(view.error_summary).toBe('synthesis stage failed after retry')
          // Ticker carried from the projected case → the failed page can offer a re-run.
          expect(view.ticker).toBe('ADBE')
        }
      } finally {
        store.close()
      }
    })

    it('keeps the dossier (ready) when a failure event exists but the case already reached a terminal stage', async () => {
      // Defensive guard: never hide a completed dossier behind a failed screen (e.g. a watchdog reaping
      // a stale run record after the decision was already drafted).
      const store = new SQLiteEventStore()
      try {
        await appendRunRequested(store, 'rc_lateflag_001')
        await createResearchCase(store, {
          research_case_id: 'rc_lateflag_001',
          company_id: 'company_adbe',
          ticker: 'ADBE',
          strategy_id: 'buffett-munger',
          strategy_version: '1.0.0',
          actor_id: 'user_local',
        })
        await store.append({
          event_id: 'evt_decision_drafted_rc_lateflag_001',
          event_type: 'decision_drafted',
          aggregate_type: 'research_case',
          aggregate_id: 'rc_lateflag_001',
          correlation_id: 'rc_lateflag_001',
          actor_type: 'worker',
          actor_id: 'owlfolio-worker',
          payload: { research_case_id: 'rc_lateflag_001', decision_id: 'dec_001', decision: 'watch', user_approved: false, reason: 'r' },
          source_ids: [],
          created_at: new Date().toISOString(),
          schema_version: 1,
        })
        await store.append({
          event_id: 'evt_research_run_failed_rc_lateflag_001',
          event_type: 'research_run_failed',
          aggregate_type: 'research_case',
          aggregate_id: 'rc_lateflag_001',
          correlation_id: 'rc_lateflag_001',
          actor_type: 'worker',
          actor_id: 'owlfolio-worker',
          payload: { research_case_id: 'rc_lateflag_001', run_id: 'run_rc_lateflag_001', failed_at: new Date().toISOString(), error_summary: 'stale run reaped' },
          source_ids: [],
          created_at: new Date().toISOString(),
          schema_version: 1,
        })
        const view = await resolveResearchCaseView(store, 'personal-local', 'rc_lateflag_001')
        expect(view.status).toBe('ready')
      } finally {
        store.close()
      }
    })
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
    // Phase 8 S4: the single gated promote lands the item user-confirmed (both events emitted atomically).
    const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)
    const confirmStore = new SQLiteEventStore(ledgerPath)
    const confirmed = projectWatchlist(await confirmStore.list()).find((item) => item.watchlist_item_id === promoted.watchlist_item_id)
    confirmStore.close()
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
    const reviewConfirmation = await confirmPersonalHoldingReviewDraft(state, openedHolding.holding_id, reviewDraft.review_id, true)
    const secondReviewDraft = await createPersonalHoldingReviewDraft(state, openedHolding.holding_id)
    const reviewOverride = await overridePersonalHoldingReviewDraft(state, openedHolding.holding_id, secondReviewDraft.review_id, {
      thesis_health: 'WATCH',
      action_stance: 'RESEARCH_MORE',
      rationale: 'User override: valuation requires another evidence pass before adding.',
      evidence_summary: 'Compared provider draft to the manual valuation snapshot and original thesis.',
      uncertainty: 'Need updated Shariah ratio review and concentration check.',
      next_review_at: '2026-10-31',
    }, true)
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

  it('is idempotent: re-adding the same completed case to the watchlist converges to one item and no orphan gate', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-idempotent-'))
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

    const first = await promoteResearchCaseToWatchlist(state, created.research_case_id)
    // Re-adding the same case is the owner clicking the button twice; it must be a no-op.
    const second = await promoteResearchCaseToWatchlist(state, created.research_case_id)

    expect(second.watchlist_item_id).toBe(first.watchlist_item_id)
    // The id is deterministic per research case (not time-based), preserving the watch_<ticker>_ shape.
    expect(first.watchlist_item_id).toBe(`watch_${created.research_case_id.replace(/^rc_/, '')}`)
    expect(first.watchlist_item_id).toMatch(/^watch_msft_/)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const watchlistItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
      expect(watchlistItems).toHaveLength(1)
      expect(watchlistItems[0]).toMatchObject({
        watchlist_item_id: first.watchlist_item_id,
        research_case_id: created.research_case_id,
        // Phase 8 S4: the single gated promote lands the item confirmed (both events atomic).
        user_approved: true,
      })

      // No duplicate watchlist-draft/confirmed events and no orphan Shariah gate decisions on retry.
      const events = await store.list()
      const draftEvents = events.filter((event) => event.event_type === 'watchlist_draft_created')
      expect(draftEvents).toHaveLength(1)
      const confirmEvents = events.filter((event) => event.event_type === 'watchlist_draft_confirmed')
      expect(confirmEvents).toHaveLength(1)
      const gatePayloads = events
        .filter((event) => event.event_type === 'shariah_gate_decision_recorded')
        .map((event) => event.payload)
        .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object' && !Array.isArray(p))
        .filter((p) => p['target_transition'] === 'watchlist_promotion')
      expect(gatePayloads).toHaveLength(1)
      expect(gatePayloads[0]).toMatchObject({ target_id: first.watchlist_item_id })
    } finally {
      store.close()
    }
  })

  it('records a server-sourced, non-empty signed thesis on promote (no human authoring required)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-server-thesis-'))
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
    // Review-and-promote: no thesis/ack arguments — the explicit promote is the commitment.
    const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const draft = (await store.list()).find((event) => event.event_type === 'watchlist_draft_created')
      const payload = draft?.payload as Record<string, unknown> | undefined
      // The signed thesis is server-sourced from the agent draft — non-empty, recorded as an affirm.
      expect(typeof payload?.['signed_thesis']).toBe('string')
      expect((payload?.['signed_thesis'] as string).length).toBeGreaterThan(0)
      expect(payload?.['signed_thesis']).toBe(payload?.['signed_thesis_draft'])
      expect(payload?.['thesis_amended']).toBe(false)
      // Honest: no human reflection was required, so the cognitive ack is false.
      const audit = payload?.['checklist_audit'] as { cognitive_acknowledged?: boolean } | undefined
      expect(audit?.cognitive_acknowledged).toBe(false)
      expect(promoted.watchlist_item_id).toMatch(/^watch_msft_/)
    } finally {
      store.close()
    }
  })

  it('rejects provider-authored holding review drafts when the latest certification report is unsupported', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-holding-review-unsupported-provider-'))
    dirs.push(projectDir)
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(reportDir, 'openrouter.latest.json'), JSON.stringify(unsupportedCompletedReport('openrouter')), 'utf8')

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
      const openedHolding = await openPersonalHoldingFromWatchlist(state, promoted.watchlist_item_id)
      const unsupportedProviderState = {
        ...state,
        config: {
          ...state.config,
          provider: {
            provider_id: 'openrouter' as const,
            support_level: 'experimental' as const,
            model_id: 'claude-sonnet-4',
          },
        },
      }

      await expect(createPersonalHoldingReviewDraft(unsupportedProviderState, openedHolding.holding_id))
        .rejects.toThrow('Provider openrouter is not ready: 0/13 scenarios passed; provider support level is unsupported.')
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
      // Phase 8 S4: the consolidated single step preserves the Shariah gate — a non-compliant case is
      // blocked BEFORE any append, so NEITHER the created draft NOR the atomic confirmation leaks.
      expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
      expect(events.some((event) => event.event_type === 'watchlist_draft_confirmed')).toBe(false)
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

  it('defaults a provider without an explicit model id to its curated catalog default model', () => {
    // openai-api → gpt-5.5 (the catalog default for the direct OpenAI API surface)
    expect(resolveModelIdForProvider({
      provider: {
        provider_id: 'openai-api',
        support_level: 'experimental',
      },
    })).toBe('gpt-5.5')
    // openrouter → openrouter/auto (its own catalog default), not a hard-coded fallback
    expect(resolveModelIdForProvider({
      provider: {
        provider_id: 'openrouter',
        support_level: 'experimental',
      },
    })).toBe('openrouter/auto')
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
        locked_buy_below: 50,
        buy_below_valuation_version: 'valuation-2026-06-cap-1',
        signed_thesis: 'I am admitting WTCH at the frozen buy-below.',
        signed_thesis_draft: 'Watch WTCH: selected-strategy watchlist draft awaits user confirmation.',
        checklist_audit: COMPLETE_AUDIT,
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

  it('passes the config mode through as the active workflow mode', () => {
    expect(resolveActiveWorkflowMode({ mode: 'unconfigured' })).toBe('unconfigured')
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

  it('stops the inline swarm behind the gates when deep_dive_approval is review (awaiting_deep_dive_approval)', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-review-gate-'))
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
          initialized_at: '2026-06-09T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
          // 'review' is the default but we set it explicitly to test the gate
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            deep_dive_approval: 'review' as const,
          },
        },
        is_initialized: true,
      }

      const result = await enqueueResearchRun(state, { ticker: 'AMZN' })
      expect(result.research_case_id).toMatch(/^rc_amzn_/)

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()
        const eventTypes = events.map((e) => e.event_type)

        // Quick screen ran
        expect(eventTypes).toContain('research_run_requested')
        expect(eventTypes).toContain('research_run_claimed')

        // Gate fired — case is now awaiting deep-dive approval
        expect(eventTypes).toContain('deep_dive_approval_pending')

        // Deep dive did NOT run
        expect(eventTypes).not.toContain('deep_dive_started')
        expect(eventTypes).not.toContain('decision_drafted')

        // Stage must be awaiting_deep_dive_approval
        const { projectResearchCases } = await import('@owlfolio/ledger/projections/researchCaseProjection')
        const cases = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
        const researchCase = cases.find((c) => c.research_case_id === result.research_case_id)
        expect(researchCase?.stage).toBe('awaiting_deep_dive_approval')
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

  it('requestDeepDiveRun in playwright mode runs the deep dive inline and produces a decision', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-deep-dive-trigger-'))
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
          initialized_at: '2026-06-09T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            deep_dive_approval: 'review' as const,
          },
        },
        is_initialized: true,
      }

      // Enqueue with 'review' — stops at awaiting_deep_dive_approval
      const { research_case_id } = await enqueueResearchRun(state, { ticker: 'TSLA' })

      // Trigger deep dive — must run inline in playwright mode and complete
      const triggered = await requestDeepDiveRun(state, research_case_id)
      expect(triggered.research_case_id).toBe(research_case_id)

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()
        const eventTypes = events.map((e) => e.event_type)

        // Gate fired
        expect(eventTypes).toContain('deep_dive_approval_pending')
        // User triggered deep dive
        expect(eventTypes).toContain('deep_dive_run_requested')
        // Deep dive completed inline
        expect(eventTypes).toContain('decision_drafted')
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

  it('requestDeepDiveRun throws when the case is not awaiting_deep_dive_approval', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-deep-dive-wrong-stage-'))
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
          initialized_at: '2026-06-09T12:00:00.000Z',
          ledger_path: ledgerPath,
          source_ledger_path: sourceLedgerPath,
          automation: {
            ...defaultPersonalLocalAppConfig().automation!,
            // 'automatic' — the case will already have a decision; not awaiting approval
            deep_dive_approval: 'automatic' as const,
          },
        },
        is_initialized: true,
      }

      // Enqueue with 'automatic' — runs straight through to decision
      const { research_case_id } = await enqueueResearchRun(state, { ticker: 'META' })

      // requestDeepDiveRun must throw — case is not in the awaiting stage
      await expect(requestDeepDiveRun(state, research_case_id))
        .rejects.toThrow(/not awaiting deep-dive approval/)
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

  it('appends investable_capital_set (user) and round-trips through projectInvestableCapital', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-investable-capital-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
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
        source_ledger_path: join(projectDir, 'data', 'source-ledger'),
      },
      is_initialized: true,
    }

    // No capital set yet → undefined.
    expect(await getInvestableCapital(ledgerPath)).toBeUndefined()

    const appended = await setInvestableCapital(state, { amount: '50000', currency: 'usd' })
    expect(appended).toMatchObject({
      event_type: 'investable_capital_set',
      aggregate_type: 'portfolio',
      actor_type: 'user',
      actor_id: 'user_local',
    })
    expect(appended.payload).toMatchObject({ amount: 50000, currency: 'USD' })

    const projected = await getInvestableCapital(ledgerPath)
    expect(projected).toMatchObject({ amount: 50000, currency: 'USD' })
    expect(typeof projected?.as_of).toBe('string')

    // Last-write-wins on update.
    await setInvestableCapital(state, { amount: '75000', currency: 'USD' })
    expect((await getInvestableCapital(ledgerPath))?.amount).toBe(75000)
  })

  it('rejects non-positive or invalid investable-capital input before appending', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-investable-capital-invalid-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
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
        source_ledger_path: join(projectDir, 'data', 'source-ledger'),
      },
      is_initialized: true,
    }

    await expect(setInvestableCapital(state, { amount: '0', currency: 'USD' }))
      .rejects.toThrow('Investable capital amount must be greater than zero')
    await expect(setInvestableCapital(state, { amount: '1000', currency: 'ZZZZ' }))
      .rejects.toThrow('Investable capital currency must be a valid ISO 4217 currency code')
  })
})

function unsupportedCompletedReport(providerId: 'openrouter' | 'openai-api'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    target: {
      provider_surface_id: providerId === 'openrouter' ? 'openrouter-api' : 'openai-api',
      vendor_id: providerId === 'openrouter' ? 'openrouter' : 'openai',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      model_id: providerId === 'openrouter' ? 'openrouter/auto' : 'gpt-5.5',
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

describe('buildAdmitVerifiedCitationSet — the admit cite-check only counts content-hash-verified sources', () => {
  // FOUNDING-RISK REGRESSION: the admit judgment's decisive permanent_loss_risk / uncertainty citations
  // are cite-checked against this set. A captured-but-unverified source_id (fetch failed → ledger record
  // has NO content_hash) must NOT enter the set, exactly like the swarm primitive — otherwise a failed-fetch
  // source could satisfy the decisive citation. (Pre-fix, the set was `new Set(corpusSourceIds)`, which
  // counted EVERY corpus id as verified — this test fails RED against that.)
  it('does NOT count a captured-but-unverified source (no content_hash) as grounded', () => {
    const corpusSourceIds = ['src_verified', 'src_unverified']
    const records = [
      { source_id: 'src_verified', content_hash: 'sha256:abc', availability: 'available' as const },
      // failed fetch: persisted with NO content_hash (the swarm omits content_hash when undefined)
      { source_id: 'src_unverified', availability: 'unavailable' as const },
    ]

    const verified = buildAdmitVerifiedCitationSet(corpusSourceIds, records)

    expect(verified.has('src_unverified')).toBe(false)
    expect(verified.has('src_verified')).toBe(true)
  })

  it('also rejects a source that has a content_hash but is explicitly unavailable', () => {
    const verified = buildAdmitVerifiedCitationSet(
      ['src_stale'],
      [{ source_id: 'src_stale', content_hash: 'sha256:stale', availability: 'unavailable' as const }],
    )

    expect(verified.has('src_stale')).toBe(false)
    expect(verified.has('sha256:stale')).toBe(false)
  })

  it('NO false-omission: a genuinely verified source (content_hash present) satisfies the citation by id OR by hash', () => {
    const verified = buildAdmitVerifiedCitationSet(
      ['src_a'],
      [{ source_id: 'src_a', content_hash: 'sha256:hashA', availability: 'available' as const }],
    )

    // a lane may cite by source_id or by content_hash — both must be admitted
    expect(verified.has('src_a')).toBe(true)
    expect(verified.has('sha256:hashA')).toBe(true)
  })

  it('only scopes to the case corpus: a verified ledger record for a source NOT in this case corpus is ignored', () => {
    const verified = buildAdmitVerifiedCitationSet(
      ['src_in_corpus'],
      [
        { source_id: 'src_in_corpus', content_hash: 'sha256:in', availability: 'available' as const },
        { source_id: 'src_other_case', content_hash: 'sha256:other', availability: 'available' as const },
      ],
    )

    expect(verified.has('src_in_corpus')).toBe(true)
    expect(verified.has('src_other_case')).toBe(false)
  })
})
