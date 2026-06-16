import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

import {
  extractDiscoverySignal,
  projectDiscoveryCandidates,
  type DiscoveryCandidateProjection,
  type DiscoverySignal,
} from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectMonitorAlerts, type MonitorAlert } from '@owlfolio/ledger/projections/monitorAlertProjection'
import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import { findLatestResearchCaseForTicker, projectResearchCases, projectResearchCaseVersionsForTicker } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectForecasts, type ForecastProjection } from '@owlfolio/ledger/projections/forecastCalibrationProjection'
import { findPostMortemForResearchCase, type PositionPostMortemProjection } from '@owlfolio/ledger/projections/positionPostMortemProjection'
import { computeReAnalysisDiff, type ReAnalysisDiff } from '@owlfolio/workflow/reAnalysisDiff'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import type { HoldingProjection } from '@owlfolio/ledger/projections/holdingProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import type { WatchlistProjection } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveProvider } from '@owlfolio/providers'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { evaluateChecklistCompletion, type ChecklistAnswer } from '@owlfolio/strategies/checklist'
import type { AppConfig } from '@owlfolio/shared'
import {
  assertShariahGateAllowsTransition,
  confirmHoldingReviewDraft,
  confirmWatchlistDraft,
  draftHoldingReview,
  evaluateResearchCaseShariahGate,
  openHoldingFromWatchlist,
  overrideHoldingReviewDraft,
  recordHoldingValuationSnapshot,
  rejectHoldingReviewDraft,
  defaultSourceLedgerStorage,
  type SourceLedgerBundle,
} from '@owlfolio/workflow'
import { selectResearchCaseAction } from '@owlfolio/workflow/researchCasePolicy'
import { runStrategyResearchSwarm, runResearchDeepDivePhase, type GroundFn } from '@owlfolio/workflow/researchSwarm'
import { runAdmitAssessment, isDeepDiveComplete, type AdmitAssessmentResult } from '@owlfolio/workflow/admitAssessment'
import {
  computeSizingRecommendation,
  type PersistedDownsideFloor,
  type SizingAssessmentResult,
} from '@owlfolio/workflow/sizingAssessment'
import {
  computeSellDecision,
  type MinimumHoldTrigger,
  type SellAssessmentArgs,
  type SellDecisionResult,
  type SellRecommendation,
} from '@owlfolio/workflow/sellAssessment'
import { MINIMUM_HOLD_TRIGGERS as MINIMUM_HOLD_TRIGGER_LIST } from '@owlfolio/strategies/minimumHoldGuard'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import { screenCheapness } from '@owlfolio/workflow/cheapnessScreen'
import type { ClusteredPosition } from '@owlfolio/strategies/correlatedClusters'
import type { MoatClass } from '@owlfolio/strategies/strategyContract'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'
import { projectAccountingSnapshot } from '@owlfolio/ledger/projections/accountingProjection'
import { resolveFundamentalsForTicker } from '@owlfolio/workflow/fundamentalsProvider'
import { resolveCurrentPrice, type PriceQuote } from '@owlfolio/workflow/marketData'
import type { Fundamentals } from '@owlfolio/workflow/secEdgar'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { resolveModelRoleEnv } from './modelRoleEnv'
import { buildAutoModelRoleOverrides } from './autoTierConfig'
import { groundProposedSources, groundProposedSourcesDeterministic } from '@owlfolio/workflow/sourceGrounding'
import { projectPendingDeepDiveRuns } from '@owlfolio/ledger/projections/researchRunQueueProjection'
import {
  projectInvestableCapital,
  type InvestableCapitalSnapshot,
} from '@owlfolio/ledger/projections/investableCapitalProjection'

import type { StatusBadgeTone } from '../components/StatusBadge'
import { getDemoResearchCaseFromStore, getDemoWatchlistItemsFromStore } from './demo'
import type { OnboardingState } from './onboarding'
import { buildProviderStatusRows } from './providerStatus'

export type WorkflowMode = AppConfig['mode']

export type AppGateChecklistItem = {
  label: string
  status: string
  tone: StatusBadgeTone
}

export type AppResearchCase = ResearchCaseProjection & {
  gate_checklist: AppGateChecklistItem[]
  source_ids: string[]
  source_evidence?: AppSourceEvidence[]
  ledger_timeline: ResearchCaseTimelineEntry[]
  /** Module 10 / judgment Mechanism 4: falsifiable forecasts attached to this case. */
  forecasts?: ForecastProjection[]
  /** Module 10: structured "what changed since last case" vs the prior superseded version. */
  reanalysis_diff?: ReAnalysisDiff
  /** Module 10: exit post-mortem for the position this case opened (if exited). */
  post_mortem?: PositionPostMortemProjection
}

export type AppSourceEvidence = {
  source_id: string
  title: string
  excerpt: string
  url?: string
  citation_locator?: string
}

export type AppWatchlistItem = WatchlistProjection & {
  buy_zone_status?: string
  holding_id?: string
  /**
   * Verdict-band enrichment joined from the item's linked research case (valuation-recalibration §2 +
   * position-sizing §5). Lets the Watchlist desk split BUY-WINDOW / WATCH-FAIR / WATCH, show
   * distance-to-buy-price, and a staleness indicator. Absent when the linked case has no valuation yet.
   */
  verdict?: AppWatchlistVerdict
}

/** Verdict-band + distance-to-buy + staleness info for a watchlist item (derived from its research case). */
export type AppWatchlistVerdict = {
  /** 'BUY-WINDOW' | 'WATCH-FAIR' | 'WATCH' when the linked case computed a verdict band; else undefined. */
  state?: string
  buy_price_per_share?: number
  fair_value_per_share?: number
  discount_to_fv_pct?: number
  /** Current market price per share, when a quote is available (else undefined → "no live quote"). */
  market_price_per_share?: number
  /** Signed distance of market vs buy price as a fraction (negative = below buy price = in the window). */
  distance_to_buy_pct?: number
  /** The case's last-updated timestamp — basis for the staleness read. */
  case_updated_at?: string
  /** True when the linked case is older than the staleness window (>12 months) and must be re-run. */
  is_stale?: boolean
}

/**
 * Stale once the linked research case has not been re-run within `STALE_AFTER_MONTHS` months
 * (position-sizing-spec §5 #3: a stale case >12 months cannot generate a tranche alert until re-run).
 */
export const WATCHLIST_STALE_AFTER_MONTHS = 12

export function enrichWatchlistItemsWithVerdict(
  items: AppWatchlistItem[],
  cases: ResearchCaseProjection[],
  now: Date = new Date(),
): AppWatchlistItem[] {
  const caseById = new Map(cases.map((c) => [c.research_case_id, c]))
  return items.map((item) => {
    const linked = caseById.get(item.research_case_id)
    const valuation = linked?.valuation
    if (valuation === undefined || valuation.buy_price_per_share === undefined) {
      return item
    }
    const verdict: AppWatchlistVerdict = {
      ...(valuation.verdict_state?.state === undefined ? {} : { state: valuation.verdict_state.state }),
      buy_price_per_share: valuation.buy_price_per_share,
      ...(valuation.fair_value_per_share === undefined ? {} : { fair_value_per_share: valuation.fair_value_per_share }),
      ...(valuation.verdict_state?.discount_to_fv_pct === undefined ? {} : { discount_to_fv_pct: valuation.verdict_state.discount_to_fv_pct }),
    }
    const updatedAt = linked?.updated_at
    if (updatedAt !== undefined) {
      verdict.case_updated_at = updatedAt
      const ageMonths = (now.getTime() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
      verdict.is_stale = ageMonths > WATCHLIST_STALE_AFTER_MONTHS
    }
    return { ...item, verdict }
  })
}

export type AppHolding = HoldingProjection

export type AppResearchPipelineItem = {
  id: string
  label: string
  status: string
  next_action: string
  href?: string
  meta?: string
  summary?: string
  /** 13F discovery signal detail (CLUSTER_BUY/NEW/ADD, managers, conviction%, ticker resolution). */
  signal?: DiscoverySignal
}

export type { MonitorAlert } from '@owlfolio/ledger/projections/monitorAlertProjection'

export type AppResearchPipelineSection = {
  key: string
  title: string
  empty_message: string
  items: AppResearchPipelineItem[]
}

export type AppResearchPipeline = {
  selectedStrategyLabel: string
  sections: AppResearchPipelineSection[]
}

export type OpenPersonalHoldingInput = {
  shares?: FormDataEntryValue | number | string | null
  cost_basis_per_share?: FormDataEntryValue | number | string | null
  currency?: FormDataEntryValue | string | null
  opened_at?: FormDataEntryValue | string | null
}

export type RecordPersonalHoldingValuationInput = {
  price_per_share?: FormDataEntryValue | number | string | null
  currency?: FormDataEntryValue | string | null
  valued_at?: FormDataEntryValue | string | null
}

export type OverridePersonalHoldingReviewInput = {
  thesis_health?: FormDataEntryValue | string | null
  action_stance?: FormDataEntryValue | string | null
  rationale?: FormDataEntryValue | string | null
  evidence_summary?: FormDataEntryValue | string | null
  uncertainty?: FormDataEntryValue | string | null
  next_review_at?: FormDataEntryValue | string | null
}

export type RejectPersonalHoldingReviewInput = {
  rejection_reason?: FormDataEntryValue | string | null
}

const pendingChecklist: AppGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pending', tone: 'neutral' },
  { label: 'Management alignment', status: 'Pending', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Pending', tone: 'neutral' },
]

export function resolveActiveWorkflowMode(config: Pick<AppConfig, 'mode'>): WorkflowMode {
  return config.mode
}

type SpawnWorkerPaths = { ledgerPath: string; sourceLedgerPath: string }

function defaultSpawnWorker({ ledgerPath, sourceLedgerPath }: SpawnWorkerPaths): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_research_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function defaultSpawnDeepDiveWorker({ ledgerPath, sourceLedgerPath }: SpawnWorkerPaths): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_deep_dive_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export async function enqueueResearchRun(
  state: OnboardingState,
  input: { ticker: string; company_id?: string },
  deps: { spawn?: (paths: SpawnWorkerPaths) => void } = {},
): Promise<{ research_case_id: string }> {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
    || state.config.source_ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  // Master switch: block research when disabled in automation settings.
  // NOTE: discovery-trigger paths (if added in the future) must check the same gate.
  if (state.config.automation?.research_engine_enabled === false) {
    throw new Error('Research engine is turned off in Settings. Enable it to run research.')
  }

  const ticker = input.ticker.trim().toUpperCase()
  if (ticker.length === 0) {
    throw new Error('Ticker is required')
  }

  const companyId = input.company_id?.trim() || `company_${ticker.toLowerCase()}`
  const researchCaseId = `rc_${ticker.toLowerCase()}_${Date.now()}`
  const decisionId = `decision_${ticker.toLowerCase()}_${Date.now()}`
  await assertConfiguredProviderIsReady(state)

  const store = new SQLiteEventStore(state.config.ledger_path)
  // Look up prior case for versioning before appending.
  const priorCase = findLatestResearchCaseForTicker(await store.list(), ticker)
  const action = selectResearchCaseAction({
    trigger: 'user',
    now: new Date(),
    ...(priorCase !== undefined ? { latestCase: { research_case_id: priorCase.research_case_id, created_at: priorCase.updated_at, version: priorCase.version } } : {}),
  })
  const version = action === 'create_first' ? 1 : (priorCase?.version ?? 0) + 1
  const supersedesId = action === 'create_version' ? priorCase?.research_case_id : undefined
  try {
    const requestedEvent = await store.append({
      event_id: `evt_research_run_requested_${researchCaseId}`,
      event_type: 'research_run_requested',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        research_case_id: researchCaseId,
        ticker,
        company_id: companyId,
        strategy_id: state.config.strategy_id,
        model_id: resolveModelIdForProvider(state.config),
        requested_by: 'user_local',
        decision_id: decisionId,
      },
      source_ids: [],
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `research-run-request:${researchCaseId}:v1`,
    })

    if (process.env.OWLFOLIO_TEST_MODE === 'playwright') {
      const provider = resolveProvider({ provider_id: state.config.provider.provider_id })
      const ground: GroundFn = (
        provider.provider_id === 'mock-provider'
          ? groundProposedSourcesDeterministic as unknown as GroundFn
          : groundProposedSources as unknown as GroundFn
      )
      const claimedAt = new Date().toISOString()
      await store.append({
        event_id: `evt_research_run_claimed_${researchCaseId}`,
        event_type: 'research_run_claimed',
        aggregate_type: 'research_case',
        aggregate_id: researchCaseId,
        causation_id: requestedEvent.event_id,
        correlation_id: researchCaseId,
        idempotency_key: `research-run-claim:${researchCaseId}:v1`,
        actor_type: 'worker',
        actor_id: 'owlfolio-worker',
        payload: {
          research_case_id: researchCaseId,
          run_id: `run_${researchCaseId}`,
          claimed_at: claimedAt,
          worker_id: 'owlfolio-worker',
        },
        source_ids: [],
        created_at: claimedAt,
        schema_version: 1,
      })
      await runStrategyResearchSwarm(
        store,
        provider,
        {
          research_case_id: researchCaseId,
          company_id: companyId,
          ticker,
          strategy_id: state.config.strategy_id,
          actor_id: 'user_local',
          idempotency_key: `swarm:${researchCaseId}:v1`,
          model_id: resolveModelIdForProvider(state.config),
          decision_id: decisionId,
          source_ledger_path: state.config.source_ledger_path,
          version,
          ...(supersedesId === undefined ? {} : { supersedes_research_case_id: supersedesId }),
          quick_screen_approval: state.config.automation?.quick_screen_approval ?? 'review',
          // model-tiering: file-configured per-role overrides (UI-managed env file = PINS) take effect
          // here, layered OVER the deterministic AUTO defaults (auto fills only unpinned roles).
          model_role_env: await resolveModelRoleEnv(),
          model_overrides: (await buildAutoModelRoleOverrides({ processEnv: process.env })).overrides,
        },
        // Advanced research-depth knob: per-lane grounded-tool-call cap (undefined → loop default).
        { ground, ...(state.config.automation?.research_max_tool_calls === undefined ? {} : { maxToolCalls: state.config.automation.research_max_tool_calls }) },
      )
      return { research_case_id: researchCaseId }
    }
  } finally {
    store.close()
  }

  ;(deps.spawn ?? defaultSpawnWorker)({ ledgerPath: state.config.ledger_path, sourceLedgerPath: state.config.source_ledger_path })

  return { research_case_id: researchCaseId }
}

export async function requestDeepDiveRun(
  state: OnboardingState,
  researchCaseId: string,
  deps: { spawn?: (paths: SpawnWorkerPaths) => void } = {},
): Promise<{ research_case_id: string }> {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
    || state.config.source_ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const researchCase = projectResearchCases(events).find((c) => c.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }
    if (researchCase.stage !== 'awaiting_deep_dive_approval') {
      throw new Error(`Research case ${researchCaseId} is not awaiting deep-dive approval (stage: ${researchCase.stage})`)
    }

    const ticker = researchCase.ticker ?? researchCaseId

    // Append the deep_dive_run_requested event
    const requestedEvent = await store.append({
      event_id: `evt_deep_dive_run_requested_${researchCaseId}`,
      event_type: 'deep_dive_run_requested',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        research_case_id: researchCaseId,
        ticker,
        requested_by: 'user_local',
      },
      source_ids: [],
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `deep-dive-run-request:${researchCaseId}:v1`,
    })

    if (process.env.OWLFOLIO_TEST_MODE === 'playwright') {
      const provider = resolveProvider({ provider_id: state.config.provider.provider_id })
      const ground: GroundFn = (
        provider.provider_id === 'mock-provider'
          ? groundProposedSourcesDeterministic as unknown as GroundFn
          : groundProposedSources as unknown as GroundFn
      )

      // Find the pending deep dive run details from the ledger
      const updatedEvents = await store.list()
      const pendingRuns = projectPendingDeepDiveRuns(updatedEvents as Parameters<typeof projectPendingDeepDiveRuns>[0])
      const pendingRun = pendingRuns.find((r) => r.research_case_id === researchCaseId)

      if (pendingRun !== undefined) {
        await runResearchDeepDivePhase(
          store,
          provider,
          {
            research_case_id: researchCaseId,
            company_id: pendingRun.company_id ?? `company_${ticker.toLowerCase()}`,
            ticker,
            strategy_id: pendingRun.strategy_id ?? state.config.strategy_id,
            model_id: pendingRun.model_id ?? resolveModelIdForProvider(state.config),
            decision_id: pendingRun.decision_id ?? `decision_${researchCaseId}`,
            source_ledger_path: pendingRun.source_ledger_path ?? state.config.source_ledger_path,
            quick_screen_source_ids: pendingRun.quick_screen_source_ids,
            quick_screen_event_id: pendingRun.quick_screen_event_id,
            // model-tiering: file-configured per-role overrides (PINS) take effect in the deep-dive phase
            // too, layered over the deterministic AUTO defaults (auto fills only unpinned roles).
            model_role_env: await resolveModelRoleEnv(),
            model_overrides: (await buildAutoModelRoleOverrides({ processEnv: process.env })).overrides,
          },
          { ground, ...(state.config.automation?.research_max_tool_calls === undefined ? {} : { maxToolCalls: state.config.automation.research_max_tool_calls }) },
        )
      }

      return { research_case_id: researchCaseId }
    }

    void requestedEvent // suppress unused warning in non-test path
  } finally {
    store.close()
  }

  ;(deps.spawn ?? defaultSpawnDeepDiveWorker)({ ledgerPath: state.config.ledger_path, sourceLedgerPath: state.config.source_ledger_path })

  return { research_case_id: researchCaseId }
}

export async function getAppResearchCaseFromStore(
  store: EventStore,
  mode: WorkflowMode,
  caseId: string,
  sourceLedgerPath?: string,
): Promise<AppResearchCase> {
  if (mode === 'demo') {
    return getDemoResearchCaseFromStore(store, caseId)
  }

  const events = await store.list()
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase === undefined) {
    throw new Error(`Unknown research case: ${caseId}`)
  }

  return buildPersonalResearchCase(events, researchCase, sourceLedgerPath)
}

/**
 * Resolves how a research-case page should render a given id, tolerating the post-start race where
 * `research_run_requested` (web-authored) lands ~1s before `research_case_created` (worker-authored).
 *
 *   - `ready`   — `research_case_created` is projected → the full dossier renders.
 *   - `pending` — the worker has a `research_run_requested`/`research_run_claimed` for the id but has
 *                 not yet authored `research_case_created`. The page shows a "Research running…" state
 *                 and auto-refreshes until the case materializes. (Authorship stays with the worker.)
 *   - `failed`  — `research_run_failed` exists for the id and no case was created → a clear failed state.
 *   - `unknown` — there is NO event for the id at all → genuinely 404.
 */
export type ResearchCaseView =
  | { status: 'ready'; researchCase: AppResearchCase }
  | { status: 'pending' }
  | { status: 'failed'; error_summary?: string }
  | { status: 'unknown' }

const RESEARCH_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'research_run_requested',
  'research_run_claimed',
  'research_run_failed',
])

function eventResearchCaseId(event: LedgerEventEnvelope<unknown>): string {
  const payload = event.payload
  if (payload !== null && typeof payload === 'object') {
    const id = (payload as Record<string, unknown>).research_case_id
    if (typeof id === 'string' && id.length > 0) {
      return id
    }
  }
  return event.aggregate_id
}

export async function resolveResearchCaseView(
  store: EventStore,
  mode: WorkflowMode,
  caseId: string,
  sourceLedgerPath?: string,
): Promise<ResearchCaseView> {
  const events = await store.list()

  // 1. Case already created → render the real dossier.
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase !== undefined) {
    return { status: 'ready', researchCase: await buildPersonalResearchCase(events, researchCase, sourceLedgerPath) }
  }

  // 2. No case yet — inspect the run-lifecycle events for this id to distinguish pending/failed/unknown.
  const runEvents = events.filter(
    (event) => RESEARCH_RUN_EVENT_TYPES.has(event.event_type) && eventResearchCaseId(event) === caseId,
  )
  if (runEvents.length === 0) {
    return { status: 'unknown' }
  }

  const failed = runEvents.find((event) => event.event_type === 'research_run_failed')
  if (failed !== undefined) {
    const payload = failed.payload
    const summary =
      payload !== null && typeof payload === 'object'
        ? (payload as Record<string, unknown>).error_summary
        : undefined
    return { status: 'failed', ...(typeof summary === 'string' ? { error_summary: summary } : {}) }
  }

  // requested/claimed but not yet created → the worker is still building the case.
  return { status: 'pending' }
}

export async function getAppWatchlistItemsFromStore(
  store: EventStore,
  mode: WorkflowMode,
): Promise<AppWatchlistItem[]> {
  if (mode === 'demo') {
    return getDemoWatchlistItemsFromStore(store)
  }

  return buildPersonalWatchlistItems(await store.list())
}

export async function getAppResearchPipelineFromStore(
  store: EventStore,
  mode: WorkflowMode,
  selectedStrategyId: string,
): Promise<AppResearchPipeline> {
  const events = await store.list()
  const researchCases = projectResearchCases(events)
  const watchlistItems = mode === 'demo'
    ? await getDemoWatchlistItemsFromStore(store)
    : buildPersonalWatchlistItems(events)
  const discoveryCandidates = projectDiscoveryCandidates(events)
  const selectedResearchCases = researchCases.filter((researchCase) => belongsToStrategy(researchCase, selectedStrategyId))
  const selectedWatchlistItems = watchlistItems.filter((item) => item.strategy_id === undefined || item.strategy_id === selectedStrategyId)
  const selectedDiscoveryCandidates = discoveryCandidates.filter((candidate) => candidate.strategy_id === selectedStrategyId)

  return {
    selectedStrategyLabel: `Selected strategy: ${selectedStrategyId}`,
    sections: [
      {
        key: 'discovered',
        title: 'Discovered',
        empty_message: 'No new discovery candidates for the selected strategy.',
        items: selectedDiscoveryCandidates
          .filter((candidate) => candidate.status === 'discovered')
          .map(candidateToPipelineItem),
      },
      {
        key: 'quick-screen',
        title: 'Quick Screen',
        empty_message: 'No companies are waiting in or exiting quick screen.',
        items: [
          ...selectedDiscoveryCandidates
            .filter((candidate) => candidate.status === 'queued_for_quick_screen')
            .map(candidateToPipelineItem),
          ...selectedResearchCases
            .filter((researchCase) => researchCase.stage === 'quick_screened' || researchCase.stage === 'awaiting_deep_dive_approval')
            .map(researchCaseToPipelineItem),
        ],
      },
      {
        key: 'deep-dive-queue',
        title: 'Deep Dive Queue',
        empty_message: 'No candidates are queued for deep dive.',
        items: selectedResearchCases
          .filter((researchCase) => researchCase.stage === 'queued_for_deep_dive')
          .map(researchCaseToPipelineItem),
      },
      {
        key: 'in-deep-dive',
        title: 'In Deep Dive',
        empty_message: 'No research cases are currently in deep dive.',
        items: selectedResearchCases
          .filter((researchCase) => ['deep_dive_started', 'specialist_finding_recorded', 'deep_dive_in_progress'].includes(researchCase.stage))
          .map(researchCaseToPipelineItem),
      },
      {
        key: 'synthesis-decision-pending',
        title: 'Synthesis / Decision Pending',
        empty_message: 'No research cases are awaiting synthesis or a decision gate.',
        items: selectedResearchCases
          .filter((researchCase) => [
            'analysis_drafted',
            'deep_dive_synthesis_drafted',
            'deep_dive_completed',
            'deep_dive_complete',
            'decision_pending',
            'decision_drafted',
          ].includes(researchCase.stage))
          .map(researchCaseToPipelineItem),
      },
      {
        key: 'watchlist',
        title: 'Watchlist',
        empty_message: 'No selected-strategy watchlist items yet.',
        items: selectedWatchlistItems.map(watchlistItemToPipelineItem),
      },
      {
        key: 'rejected-passed',
        title: 'Rejected / Passed',
        empty_message: 'No rejected or passed candidates are recorded yet.',
        items: [
          ...selectedResearchCases
            .filter((researchCase) => researchCase.stage === 'rejected' || researchCase.stage === 'pass')
            .map(researchCaseToPipelineItem),
          ...selectedDiscoveryCandidates
            .filter((candidate) => candidate.status === 'rejected' || candidate.status === 'duplicate' || candidate.status === 'promoted_to_research_case')
            .map(candidateToPipelineItem),
        ],
      },
    ].map((section) => ({ ...section, items: sortPipelineItems(section.items) })),
  }
}

export async function getAppHoldingsFromStore(
  store: EventStore,
  _mode: WorkflowMode,
): Promise<AppHolding[]> {
  return projectHoldings(await store.list())
}

/**
 * The open monitor alerts (watchlist/holding monitor observations + Shariah-grace + sell-review drafts),
 * severity-ranked. Every alert is an agent OBSERVATION or a human-decision DRAFT — never executed. The
 * UI links each one to where the user authors the decision.
 */
export async function getAppMonitorAlertsFromStore(store: EventStore): Promise<MonitorAlert[]> {
  return projectMonitorAlerts(await store.list())
}

/** Filter the monitor-alerts model to a single watchlist item (for the per-item watchlist view). */
export function monitorAlertsForWatchlistItem(alerts: MonitorAlert[], watchlistItemId: string): MonitorAlert[] {
  return alerts.filter((alert) => alert.subject.watchlist_item_id === watchlistItemId)
}

/** Filter the monitor-alerts model to a single holding (for the per-holding portfolio view). */
export function monitorAlertsForHolding(alerts: MonitorAlert[], holdingId: string): MonitorAlert[] {
  return alerts.filter((alert) => alert.subject.holding_id === holdingId)
}

export async function promoteResearchCaseToWatchlist(
  state: OnboardingState,
  researchCaseId: string,
  signedThesis: string,
  checklistAnswers: Record<string, ChecklistAnswer> = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  // The signed thesis is the HUMAN commitment that makes admission a real decision (Task 4.3). It is
  // required and must be the human's own words — there is NO auto-fallback to the agent-drafted
  // thesis_summary on this interactive path. An empty/whitespace thesis is rejected here so a missing
  // human thesis can never be silently papered over by the agent draft.
  const humanSignedThesis = signedThesis.trim()
  if (humanSignedThesis.length === 0) {
    throw new Error('A human-signed thesis is required to promote a research case to the watchlist')
  }

  // COMPLETION-BLOCK (Phase 7 S2): every hygiene/bias checklist item must be ADDRESSED before admit —
  // mirroring the signed-thesis gate. The cognitive answers are HUMAN-AUTHORED only; we pass through the
  // human's answers untouched and NEVER default/synthesize any answer here. Reject with the unaddressed
  // ids so the route can 400 with what still needs attention. Decision-NEUTRAL: no scoring/count.
  const checklistCompletion = evaluateChecklistCompletion(checklistAnswers)
  if (!checklistCompletion.complete) {
    throw new Error(
      `The hygiene/bias checklist must be fully addressed to promote a research case to the watchlist; unaddressed: ${checklistCompletion.unaddressed.join(', ')}`,
    )
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const researchCase = projectResearchCases(await store.list()).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }
    if (researchCase.decision === undefined || researchCase.decision_id === undefined) {
      throw new Error(`Research case is not ready for watchlist promotion: ${researchCaseId}`)
    }

    const fallbackTicker = researchCase.company_id ?? researchCase.research_case_id
    const ticker = researchCase.ticker ?? fallbackTicker
    // Deterministic per research case so re-adding the same completed case is a clean no-op:
    // the watchlist-draft event, its Shariah gate decision, and the idempotency key all key off
    // this stable id. A non-deterministic (Date.now()) id would orphan a fresh gate decision and
    // risk duplicate watchlist items on retry. WATCHLIST entry is the human's authored transition;
    // re-asserting it must converge, not fan out. We derive from the research_case_id (dropping its
    // `rc_` prefix) to preserve the historical `watch_<ticker>_<n>` shape while staying stable.
    const watchlistItemId = `watch_${researchCase.research_case_id.replace(/^rc_/, '')}`
    const gateDecision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: researchCase.research_case_id,
      target_transition: 'watchlist_promotion',
      target_id: watchlistItemId,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${researchCase.research_case_id}:watchlist-promotion:${watchlistItemId}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)
    const thesisSummary = researchCase.reason === undefined
      ? researchCase.next_required_action ?? `Watch ${ticker} after drafted decision ${researchCase.decision}`
      : `Watch ${ticker}: ${researchCase.reason}`

    // FREEZE the buy-below at admit (Task 4.2b): snapshot the Phase-1 valuation buy-below and record the
    // MoS/valuation version it was frozen under. The MoS is still PROVISIONAL (#124), so a future MoS
    // freeze that changes the number is a VISIBLE, logged re-price — never a silent move on the locked
    // thesis. Fall back to the verdict-band buy-below / 0 when the case has no valuation buy-below yet.
    const lockedBuyBelow = researchCase.valuation?.buy_price_per_share ?? 0

    // FREEZE the UNDISCOUNTED IV at sign-off (Phase 6 S3): snapshot the case's fair_value_per_share — the
    // UNDISCOUNTED intrinsic value, DISTINCT from the MoS-discounted buy_price_per_share above. The
    // valuation-inverted sell trigger reads THIS frozen number (don't-move-the-number F.9/F.10): only a
    // re-underwrite that re-runs this freeze may change it. FAIL-CLOSED — when the case has no undiscounted
    // IV we freeze it as `undefined` (absent), NEVER falling back to the discounted buy-below; the trigger
    // then returns cannot_assess rather than reading a wrong number.
    const frozenIv = researchCase.valuation?.fair_value_per_share

    return await confirmWatchlistDraft(store, {
      watchlist_item_id: watchlistItemId,
      research_case_id: researchCase.research_case_id,
      decision_id: researchCase.decision_id,
      company_id: researchCase.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: researchCase.strategy_id ?? state.config.strategy_id,
      ...(researchCase.strategy_version === undefined ? {} : { strategy_version: researchCase.strategy_version }),
      thesis_summary: thesisSummary,
      locked_buy_below: lockedBuyBelow,
      buy_below_valuation_version: VALUATION_PARAMS.version,
      buy_below_mos_provisional: true,
      ...(frozenIv === undefined
        ? {}
        : { frozen_iv: frozenIv, frozen_iv_valuation_version: VALUATION_PARAMS.version }),
      signed_thesis: humanSignedThesis,
      checklist_answers: checklistAnswers,
      actor_id: 'user_local',
      idempotency_key: `decision:${researchCase.research_case_id}:watchlist:v1`,
    })
  } finally {
    store.close()
  }
}

/**
 * Dependency surface for the on-demand admit assessment (Task 4.2c). Lets the route test inject a fake
 * provider + fixture fundamentals/price + a deterministic ground fn (offline, like the swarm tests),
 * while the live path resolves the configured provider + live SEC EDGAR / Yahoo data.
 */
export type RecordAdmitJudgmentDeps = {
  /** Override the provider (test fake). Defaults to the configured provider. */
  provider?: ReturnType<typeof resolveProvider>
  /** Override the grounding fn (test). Defaults to the provider-appropriate live grounder. */
  ground?: GroundFn
  /** Pre-resolved fundamentals (test fixture). Takes precedence over the live resolver. */
  fundamentals?: Fundamentals
  /** Override the current-price resolver (test fixture). Defaults to the live Yahoo adapter. */
  resolvePrice?: (ticker: string) => Promise<PriceQuote>
}

export type RecordAdmitJudgmentOutcome =
  | { status: 'complete'; admit_judgment_id: string; recommendation: Record<string, unknown> }
  | { status: 'not_an_admission_candidate'; reason: string }
  | { status: 'admit_judgment_incomplete'; reason: string }

/**
 * Compute + persist the admit-judgment recommendation for a research case ON-DEMAND (Task 4.2c).
 *
 * This is the LIVE wiring that composes the previously-islanded screenCheapness + runAdmitJudgment:
 *   - reads the case FRESH from the ledger (gate verdict, lane digest, verified source corpus),
 *   - fetches fundamentals + current price FRESH (so cheapness/EV reflect today),
 *   - runs the orchestrator (which fail-closes early for a non-candidate — no provider call), and
 *   - emits a single `admit_judgment_recorded` OBSERVATION (actor=provider). It does NOT admit anything:
 *     the human still admits via the watchlist_draft confirm (signed thesis). No auto-transition.
 *
 * Idempotency is keyed on case + the recommendation's CONTENT hash, so re-running with an identical
 * result converges to one event, while a fresh recompute that changes the call appends a new event
 * (newest wins in the projection).
 */
export async function recordAdmitJudgment(
  state: OnboardingState,
  researchCaseId: string,
  deps: RecordAdmitJudgmentDeps = {},
): Promise<RecordAdmitJudgmentOutcome> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }

    const ticker = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
    const gatePassing = researchCase.valuation?.moat_passes_gate === true

    // Pre-spend funnel discipline: gate from the projection alone — in the SAME order + with the SAME
    // reasons as runAdmitAssessment (reusing isDeepDiveComplete, so there's no divergence) — BEFORE the fresh
    // EDGAR/price fetches, so a non-candidate spends zero data-feed reads. (The orchestrator re-gates too,
    // defense-in-depth, before any provider call.)
    if (!isDeepDiveComplete(researchCase.stage)) {
      return {
        status: 'not_an_admission_candidate',
        reason: `research case is not deep-dive-complete (stage: ${researchCase.stage}); the admit judgment is only live for a deep-dive-complete candidate.`,
      }
    }
    if (!gatePassing) {
      return {
        status: 'not_an_admission_candidate',
        reason: 'research case did not pass the quality gate; the admit judgment is only live for a gate-passing admission candidate.',
      }
    }

    // The verified source corpus the judgment must cite from = the case's accumulated source_ids. We do
    // NOT have raw content hashes on the projection, so we cite-check by source_id (a lane may cite by id;
    // the swarm treats source_id as corpus-verified). This keeps the judgment grounded to the case corpus.
    const timeline = projectResearchCaseTimeline(events, researchCaseId)
    const corpusSourceIds = [...new Set(timeline.flatMap((entry) => entry.source_ids))]
    const verifiedCitationHashes = new Set<string>(corpusSourceIds)

    // Lane digest from the persisted specialist findings (same compact shape the red-team digest uses).
    const laneDigest = (researchCase.specialist_findings ?? [])
      .filter((finding) => finding.finding_summary !== undefined)
      .map((finding) => ({
        lane: finding.specialist_lane ?? finding.finding_id,
        finding_summary: finding.finding_summary ?? '',
        confidence: finding.confidence ?? 'medium',
      }))

    const provider = deps.provider ?? resolveProvider({ provider_id: state.config.provider.provider_id })
    const ground: GroundFn = deps.ground ?? (
      provider.provider_id === 'mock-provider'
        ? groundProposedSourcesDeterministic as unknown as GroundFn
        : groundProposedSources as unknown as GroundFn
    )

    // Fetch fundamentals + current price FRESH so the cheapness screen (OE-yield / EV) reflects today.
    const fundamentals = deps.fundamentals ?? await resolveFundamentalsFreshForAdmit(ticker)
    if (fundamentals === undefined) {
      return {
        status: 'not_an_admission_candidate',
        reason: `cannot run the admit judgment for ${ticker}: no SEC EDGAR fundamentals resolved (cheapness/EV not computable).`,
      }
    }
    const marketCapMusd = await resolveMarketCapMusdForAdmit(ticker, fundamentals, deps.resolvePrice)
    if (marketCapMusd === undefined) {
      return {
        status: 'not_an_admission_candidate',
        reason: `cannot run the admit judgment for ${ticker}: no current price resolved (market cap / EV not computable).`,
      }
    }

    const result: AdmitAssessmentResult = await runAdmitAssessment(
      provider,
      {
        research_case_id: researchCaseId,
        ticker,
        model_id: resolveModelIdForProvider(state.config),
        stage: researchCase.stage,
        gate_passing: gatePassing,
        fundamentals,
        market_cap_musd: marketCapMusd,
        laneDigest,
        corpusSourceIds,
        verifiedCitationHashes,
        ...(researchCase.valuation?.buy_price_per_share === undefined
          ? {}
          : { valuation: { buy_below: researchCase.valuation.buy_price_per_share } }),
      },
      { ground },
    )

    if (result.status !== 'complete') {
      return result
    }

    const rec = result.recommendation
    // Idempotency keyed on case + the recommendation content (so an identical recompute converges; a
    // changed recompute appends — newest wins in the projection).
    const contentHash = createHash('sha256').update(JSON.stringify({
      impairment_call: rec.impairment_call,
      admittable: rec.admittable,
      uncertainty: rec.uncertainty,
      permanent_loss_risk: rec.permanent_loss_risk,
      impairment_bear_case: rec.impairment_bear_case,
      buy_below: rec.buy_below,
      cheapness: rec.cheapness,
      downside_floor: rec.downside_floor,
    })).digest('hex').slice(0, 16)
    const admitJudgmentId = `admit_${researchCaseId.replace(/^rc_/, '')}_${contentHash}`

    const event: LedgerEventEnvelope<unknown> = {
      event_id: `evt_admit_judgment_recorded_${admitJudgmentId}`,
      event_type: 'admit_judgment_recorded',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: provider.provider_id,
      payload: {
        admit_judgment_id: admitJudgmentId,
        research_case_id: researchCaseId,
        ticker,
        uncertainty: rec.uncertainty,
        permanent_loss_risk: rec.permanent_loss_risk,
        impairment_bear_case: rec.impairment_bear_case,
        impairment_call: rec.impairment_call,
        // RECOMMENDATION flag only — nothing transitions the name here (the human admits in 4.2b).
        admittable: rec.admittable,
        reason: rec.reason,
        ...(rec.buy_below === undefined ? {} : { buy_below: rec.buy_below }),
        ...(rec.cheapness === undefined ? {} : { cheapness: rec.cheapness }),
        // Phase 5 S2 — the concrete downside floor (incl. its basis + reliability, or cannot_floor reason)
        // travels on the admit observation so Phase-5 sizing reads it from the projection.
        ...(rec.downside_floor === undefined ? {} : { downside_floor: rec.downside_floor }),
        ...(rec.uncited_refs === undefined ? {} : { uncited_refs: rec.uncited_refs }),
        // Worker/agent OBSERVATION discipline: this is an observation, NOT a recommendation to ACT.
        is_observation: true,
        is_recommendation: false,
      },
      source_ids: corpusSourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `admit-judgment:${researchCaseId}:${contentHash}`,
    }
    await store.append(event)

    return {
      status: 'complete',
      admit_judgment_id: admitJudgmentId,
      recommendation: event.payload as Record<string, unknown>,
    }
  } finally {
    store.close()
  }
}

/**
 * Dependency surface for the on-demand sizing recommendation (Phase 5 S7). Lets the route test inject a
 * fixture price + fundamentals (offline) while the live path resolves fresh SEC EDGAR + Yahoo data.
 */
export type RecordSizingRecommendationDeps = {
  /** Pre-resolved fundamentals (test fixture). Takes precedence over the live resolver. */
  fundamentals?: Fundamentals
  /** Override the current-price resolver (test fixture). Defaults to the live Yahoo adapter. */
  resolvePrice?: (ticker: string) => Promise<PriceQuote>
}

export type RecordSizingRecommendationOutcome =
  | { status: 'complete'; sizing_recommendation_id: string; recommendation: Record<string, unknown> }
  | { status: 'not_a_sizing_candidate'; reason: string }

const RISK_LEVELS = new Set(['low', 'medium', 'high'])

function asRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value !== undefined && RISK_LEVELS.has(value) ? (value as 'low' | 'medium' | 'high') : undefined
}

const INVESTABLE_MOAT_CLASSES = new Set<MoatClass>(['wide', 'monopoly'])

/**
 * Compute + persist the SIZING recommendation for a research case ON-DEMAND (Phase 5 S7).
 *
 * This is the LIVE wiring that composes the S6 assembler (computeSizingRecommendation) into the
 * watched→held flow. It reads everything FRESH at call time:
 *   - the case FRESH from the ledger (the persisted admit recommendation = the S2 downside floor + its
 *     basis/reliability, the permanent-loss / uncertainty risk levels, the buy-below; valuation.moat_class),
 *   - the FRESH market price (the entry price + the candidate's owner-earnings yield via screenCheapness),
 *   - the user-set investable_capital, the accounting NAV (the S3/S4 BOOK-IMPAIRMENT denominator), the
 *     held book (the S4 cluster aggregation), and the savings config (the S5 deployment hurdle), then
 *   - emits ONE `sizing_recommendation_recorded` OBSERVATION (content-hash idempotency, like admit).
 *
 * It does NOT open the holding — openHoldingFromWatchlist stays human-authored/signed (the irreversible
 * boundary). Fail-closed: a non-candidate (no floor / not gate-passing / no buy-below / no price) is
 * surfaced, never a fabricated size. The newest recorded recommendation wins in the projection.
 */
export async function recordSizingRecommendation(
  state: OnboardingState,
  researchCaseId: string,
  deps: RecordSizingRecommendationDeps = {},
): Promise<RecordSizingRecommendationOutcome> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }

    const ticker = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id

    // A sizing recommendation is only meaningful for a gate-passing admittable name with a locked
    // buy-below + a recorded admit recommendation (which carries the S2 floor + risk levels). Gate the
    // candidate from the projection BEFORE any fresh data fetch (a non-candidate spends zero feed reads).
    const moatClassRaw = researchCase.valuation?.moat_class
    const moatClass = moatClassRaw as MoatClass | undefined
    if (moatClass === undefined || !INVESTABLE_MOAT_CLASSES.has(moatClass)) {
      return {
        status: 'not_a_sizing_candidate',
        reason: `sizing is only live for a wide/monopoly-moat candidate (moat: ${moatClassRaw ?? 'unknown'}).`,
      }
    }
    const admit = researchCase.admit_recommendation
    if (admit === undefined) {
      return {
        status: 'not_a_sizing_candidate',
        reason: 'no admit recommendation recorded yet — run the admit judgment first (it carries the downside floor + risk levels sizing reads).',
      }
    }
    const buyBelow = admit.buy_below ?? researchCase.valuation?.buy_price_per_share
    if (buyBelow === undefined || !(buyBelow > 0)) {
      return {
        status: 'not_a_sizing_candidate',
        reason: 'no locked buy-below price — sizing needs the entry price the ladder is laddered against.',
      }
    }
    const permanentLossLevel = asRiskLevel(admit.permanent_loss_risk?.level)
    const uncertaintyLevel = asRiskLevel(admit.uncertainty?.level)
    if (permanentLossLevel === undefined || uncertaintyLevel === undefined) {
      return {
        status: 'not_a_sizing_candidate',
        reason: 'admit recommendation is missing the permanent-loss / uncertainty risk levels conviction reads.',
      }
    }

    // The S2 floor read OFF the persisted admit recommendation (never recomputed). cannot_floor → the
    // assembler fail-closes to cannot_size (the permanent-loss cap binds on a concrete floor, not a guess).
    const downsideFloor: PersistedDownsideFloor =
      admit.downside_floor_per_share !== undefined
        && (admit.downside_floor_basis === 'net_cash' || admit.downside_floor_basis === 'stressed_book')
        ? {
            downside_floor_per_share: admit.downside_floor_per_share,
            downside_floor_basis: admit.downside_floor_basis,
            downside_floor_reliability: (admit.downside_floor_reliability ?? 'qualified') as 'sound' | 'qualified' | 'unreliable',
          }
        : { cannot_floor: true }

    // FRESH price → the entry price + the candidate's owner-earnings yield (the S5 deployment hurdle input).
    const fundamentals = deps.fundamentals ?? await resolveFundamentalsFreshForAdmit(ticker)
    const resolvePrice = deps.resolvePrice ?? ((t: string) => resolveCurrentPrice({ ticker: t }))
    let freshPrice: number | undefined
    try {
      const quote = await resolvePrice(ticker)
      if (quote.available) freshPrice = quote.price_per_share
    } catch {
      freshPrice = undefined
    }
    if (freshPrice === undefined || !(freshPrice > 0)) {
      return {
        status: 'not_a_sizing_candidate',
        reason: `cannot size ${ticker}: no fresh market price resolved (the entry price + OE yield are not computable).`,
      }
    }

    // Candidate owner-earnings yield FRESH (screenCheapness over fresh fundamentals + fresh price). When
    // fundamentals are unavailable the yield is 0 → the deployment hurdle does not clear → hold_in_savings
    // (the CORRECT fail-closed posture), never a fabricated yield.
    let ownerEarningsYield = 0
    if (fundamentals !== undefined) {
      const dilutedShares = fundamentals.latest_annual.diluted_shares_m
      if (dilutedShares !== undefined && dilutedShares > 0) {
        const cheap = screenCheapness({
          fundamentals,
          market_cap_musd: freshPrice * dilutedShares,
          gate_passing: true,
        })
        ownerEarningsYield = cheap.owner_earnings_yield ?? 0
      }
    }

    // Investable capital (the conviction TARGET + deployment-cap denominator) + accounting NAV (the
    // S3/S4 BOOK-IMPAIRMENT denominator — NEVER crossed with investable) + the held book (S4 cluster).
    const investableSnapshot = projectInvestableCapital(events)
    const investable = investableSnapshot?.amount ?? 0
    const currency = investableSnapshot?.currency ?? 'USD'
    const nowIso = new Date().toISOString()
    const accounting = projectAccountingSnapshot(events, {
      snapshot_id: `sizing-asof-${researchCaseId}`,
      period_start: '0000-01-01',
      period_end: nowIso.slice(0, 10),
      currency,
      recorded_at: nowIso,
    })
    const bookNav = accounting.nav
    const heldBook: ClusteredPosition[] = projectHoldings(events)
      .filter((holding) => holding.currency === currency && holding.ticker !== undefined && holding.ticker !== ticker)
      .map((holding) => ({
        ticker: holding.ticker as string,
        entry_price_per_share: holding.cost_basis_per_share,
        position_value: holding.latest_market_value ?? holding.total_cost_basis,
      }))

    // The verified source corpus the recommendation is grounded to = the case's accumulated source_ids.
    const timeline = projectResearchCaseTimeline(events, researchCaseId)
    const corpusSourceIds = [...new Set(timeline.flatMap((entry) => entry.source_ids))]

    const savings = state.config.savings
    const savingsRate = savings?.savings_expected_profit_rate ?? 0
    const equityRiskMargin = savings?.equity_risk_margin ?? 0

    const result: SizingAssessmentResult = computeSizingRecommendation({
      candidate: {
        ticker,
        moat_class: moatClass,
        permanent_loss_level: permanentLossLevel,
        uncertainty_level: uncertaintyLevel,
        entry_price_per_share: buyBelow,
        owner_earnings_yield: ownerEarningsYield,
      },
      downside_floor: downsideFloor,
      held_book: heldBook,
      book_nav: bookNav,
      investable_capital: investable,
      savings_expected_profit_rate: savingsRate,
      equity_risk_margin: equityRiskMargin,
      buy_price_version: SIZING_PARAMS.version,
    })

    // Build the persisted payload. Idempotency keyed on case + the recommendation CONTENT (an identical
    // recompute converges to one event; a changed recompute appends — newest wins in the projection).
    const payloadCore = buildSizingPayloadCore(result)
    const contentHash = createHash('sha256').update(JSON.stringify(payloadCore)).digest('hex').slice(0, 16)
    const sizingRecommendationId = `sizing_${researchCaseId.replace(/^rc_/, '')}_${contentHash}`

    const event: LedgerEventEnvelope<unknown> = {
      event_id: `evt_sizing_recommendation_recorded_${sizingRecommendationId}`,
      event_type: 'sizing_recommendation_recorded',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: state.config.provider.provider_id,
      payload: {
        sizing_recommendation_id: sizingRecommendationId,
        research_case_id: researchCaseId,
        ticker,
        ...payloadCore,
        // Worker/agent OBSERVATION discipline: this is an observation, NOT a recommendation to ACT, and it
        // NEVER opens a holding — the buy stays the human-signed openHoldingFromWatchlist transition.
        is_observation: true,
        is_recommendation: false,
      },
      source_ids: corpusSourceIds,
      created_at: nowIso,
      schema_version: 1,
      idempotency_key: `sizing-recommendation:${researchCaseId}:${contentHash}`,
    }
    await store.append(event)

    return {
      status: 'complete',
      sizing_recommendation_id: sizingRecommendationId,
      recommendation: event.payload as Record<string, unknown>,
    }
  } finally {
    store.close()
  }
}

// ---------------------------------------------------------------------------
// Phase 6 S8a — the ON-DEMAND SELL DECISION (recordSellDecision).
//
// Mirrors recordSizingRecommendation: a fresh-read + assemble + emit-ONE-OBSERVATION recorder for the
// HELD-position sell decision. It composes the S6 pure assembler (computeSellDecision) into the held flow.
// It NEVER closes the holding — the close is the human-authored closeHolding (S7). The emitted artifact is
// an advisory `holding_sell_review_drafted` OBSERVATION (is_observation:true, additive); the actual exit is
// always human-authored.
//
// The trigger comes from the caller (the UI / a cadence-raised signal picks WHICH minimum-hold trigger to
// evaluate). For `better_opportunity` the candidate/held owner-earnings yields also come from the caller
// (optional; missing → the assembler returns cannot_assess).
//
// The grounded risk fields (uncertainty / permanent_loss_risk / quality_verdict_passes) are read from the
// PERSISTED admit recommendation + the case's gate flag — the same source recordAdmitJudgment used. A fully
// fresh corpus re-run (re-grounding the impairment judgment against today's filings) is a FUTURE
// enhancement; this slice reuses the persisted grounded fields and does NOT build a provider re-run.
// ---------------------------------------------------------------------------

/**
 * The minimum-hold triggers a sell decision may be evaluated against (the request body's `trigger`).
 * Derived from the canonical `MINIMUM_HOLD_TRIGGER_LIST` in `@owlfolio/strategies` (single source of WHICH
 * triggers exist) so this membership check can never drift from the union.
 */
export const MINIMUM_HOLD_TRIGGERS: ReadonlySet<MinimumHoldTrigger> = new Set<MinimumHoldTrigger>(
  MINIMUM_HOLD_TRIGGER_LIST,
)

export function isMinimumHoldTrigger(value: unknown): value is MinimumHoldTrigger {
  return typeof value === 'string' && MINIMUM_HOLD_TRIGGERS.has(value as MinimumHoldTrigger)
}

/**
 * Input for the on-demand sell decision. `trigger` is required (the caller picks which minimum-hold trigger
 * to evaluate). The yields are optional and only consumed by the `better_opportunity` trigger.
 */
export type RecordSellDecisionInput = {
  trigger: MinimumHoldTrigger
  candidate_oe_yield?: number
  held_oe_yield?: number
  switching_friction?: number
}

/**
 * Dependency surface for the on-demand sell decision. The default path resolves the current price via the
 * live Yahoo adapter; the test injects a fixture resolver (offline). No provider call is needed — the
 * grounded risk fields are read from the persisted admit recommendation, not re-grounded in this slice.
 */
export type RecordSellDecisionDeps = {
  /** Override the current-price resolver (test fixture). Defaults to the live Yahoo adapter. */
  resolvePrice?: (ticker: string) => Promise<PriceQuote>
}

export type RecordSellDecisionOutcome =
  | { status: 'complete'; sell_review_id: string; recommendation: Record<string, unknown> }
  | { status: 'not_a_held_position'; reason: string }
  | { status: 'cannot_assess'; reason: string }

/**
 * Compute + persist the SELL DECISION for a HELD name's research case ON-DEMAND (Phase 6 S8a).
 *
 * Fresh reads:
 *   - the HELD name's lifecycle row (nameLifecycle): holding_id, ticker, opened_at, frozen_iv (sign-off
 *     frozen undiscounted IV — read from the projection, NEVER recomputed here), downside_floor_* (the
 *     Phase-5 floor for the always-attached worst case),
 *   - the persisted admit recommendation (researchCase.admit_recommendation): uncertainty.level,
 *     permanent_loss_risk.level — the current grounded risk fields the impairment judgment consumes,
 *   - the case's gate flag (valuation.moat_passes_gate) → quality_verdict_passes (same source as
 *     recordAdmitJudgment), and
 *   - the FRESH current price (the at-loss + valuation-inverted input), via the same resolver sizing uses.
 *
 * Gate: the name must be HELD; a non-held name returns `not_a_held_position` (the route maps to 409). It
 * then calls computeSellDecision, REBUILDS the sell-review scaffold with the REAL holding_id + ticker, and
 * emits ONE `holding_sell_review_drafted` OBSERVATION (is_observation:true, additive). Content-hash
 * idempotency converges an identical recompute to one event; a changed recompute appends (newest wins).
 *
 * It NEVER closes the holding — the buy/sell EXECUTION stays the human-signed closeHolding transition.
 */
export async function recordSellDecision(
  state: OnboardingState,
  researchCaseId: string,
  input: RecordSellDecisionInput,
  deps: RecordSellDecisionDeps = {},
): Promise<RecordSellDecisionOutcome> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  if (!isMinimumHoldTrigger(input.trigger)) {
    throw new Error(`Invalid minimum-hold trigger: ${String(input.trigger)}`)
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }

    const ticker = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id

    // The HELD name's lifecycle row is the source of the holding identity + the sign-off-frozen IV +
    // opened_at + the downside floor. The sell decision is ONLY meaningful for a HELD position.
    const lifecycle = projectNameLifecycle(events).find((row) => row.research_case_id === researchCaseId)
    if (lifecycle === undefined || lifecycle.state !== 'held' || lifecycle.holding_id === undefined) {
      return {
        status: 'not_a_held_position',
        reason: `the sell decision is only live for a HELD position (state: ${lifecycle?.state ?? 'unknown'}).`,
      }
    }
    const holdingId = lifecycle.holding_id
    const heldTicker = lifecycle.ticker ?? ticker

    // The held position's cost basis (the at-loss input) comes from the holding_opened lot.
    const holding = projectHoldings(events).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      return {
        status: 'not_a_held_position',
        reason: `no open holding found for ${heldTicker} (holding ${holdingId}).`,
      }
    }
    const costBasisPerShare = holding.cost_basis_per_share

    // The CURRENT grounded risk fields = the persisted admit recommendation's risk levels. A fully fresh
    // corpus re-run is a future enhancement; we reuse the persisted grounded fields here. quality_verdict
    // is the case's quality gate (moat_passes_gate) — the SAME source recordAdmitJudgment used. Fail-closed
    // defaults (high uncertainty / high permanent-loss) keep a missing-admit case from a hollow "fixable".
    const admit = researchCase.admit_recommendation
    const uncertaintyLevel: SellAssessmentArgs['uncertainty'] =
      asRiskLevel(admit?.uncertainty?.level) ?? 'high'
    const permanentLossLevel: SellAssessmentArgs['permanent_loss_risk'] =
      asRiskLevel(admit?.permanent_loss_risk?.level) ?? 'high'
    const qualityVerdictPasses = researchCase.valuation?.moat_passes_gate === true

    // The FRESH current price — the at-loss + valuation-inverted input (the SAME resolver sizing/buy-window
    // uses). Fail-closed: no price → cannot_assess (a sell can never proceed without a real price input).
    const resolvePrice = deps.resolvePrice ?? ((t: string) => resolveCurrentPrice({ ticker: t }))
    let currentPrice: number | undefined
    try {
      const quote = await resolvePrice(heldTicker)
      if (quote.available) currentPrice = quote.price_per_share
    } catch {
      currentPrice = undefined
    }
    if (currentPrice === undefined || !(currentPrice > 0)) {
      return {
        status: 'cannot_assess',
        reason: `cannot assess ${heldTicker}: no fresh market price resolved (the at-loss / valuation-inverted inputs are not computable).`,
      }
    }

    // frozen_iv is READ FROM THE PROJECTION (sign-off-frozen undiscounted IV), NEVER recomputed here.
    const frozenIv = lifecycle.frozen_iv

    const assemblerArgs: SellAssessmentArgs = {
      trigger: input.trigger,
      opened_at: lifecycle.opened_at,
      now: new Date().toISOString(),
      current_price: currentPrice,
      cost_basis_per_share: costBasisPerShare,
      uncertainty: uncertaintyLevel,
      permanent_loss_risk: permanentLossLevel,
      quality_verdict_passes: qualityVerdictPasses,
      frozen_iv: frozenIv,
      ...(input.candidate_oe_yield === undefined ? {} : { candidate_oe_yield: input.candidate_oe_yield }),
      ...(input.held_oe_yield === undefined ? {} : { held_oe_yield: input.held_oe_yield }),
      ...(input.switching_friction === undefined ? {} : { switching_friction: input.switching_friction }),
      ...(lifecycle.downside_floor_per_share === undefined
        ? {}
        : { downside_floor_per_share: lifecycle.downside_floor_per_share }),
      ...(lifecycle.downside_floor_basis === undefined
        ? {}
        : { downside_floor_basis: lifecycle.downside_floor_basis }),
      ...(lifecycle.downside_floor_reliability === undefined
        ? {}
        : { downside_floor_reliability: lifecycle.downside_floor_reliability }),
    }

    const result: SellDecisionResult = computeSellDecision(assemblerArgs)

    if (result.status === 'cannot_assess' || result.recommendation === undefined) {
      return {
        status: 'cannot_assess',
        reason: `cannot assess the ${input.trigger} sell trigger for ${heldTicker} (e.g. no sign-off-frozen IV for valuation_inverted, or missing candidate/held yields for better_opportunity).`,
      }
    }

    const rec: SellRecommendation = result.recommendation

    // Rebuild the sell-review scaffold with the REAL holding identity (the pure assembler used a placeholder
    // holding_id: ''). The scaffold rides on the OBSERVATION payload so S8b can render the human-authored
    // exit draft against the real holding + ticker.
    const sellReviewDraft = rec.sell_review_draft === undefined
      ? undefined
      : { ...rec.sell_review_draft, holding_id: holdingId, ticker: heldTicker }

    // The verified source corpus the decision is grounded to = the case's accumulated source_ids.
    const timeline = projectResearchCaseTimeline(events, researchCaseId)
    const corpusSourceIds = [...new Set(timeline.flatMap((entry) => entry.source_ids))]

    // Idempotency keyed on case + holding + the recommendation CONTENT (an identical recompute converges to
    // one event; a changed recompute appends — newest wins in the projection). Mirror sizing/admit.
    const contentHash = createHash('sha256').update(JSON.stringify({
      holding_id: holdingId,
      status: result.status,
      trigger: rec.trigger,
      impairment_call: rec.impairment_call,
      minimum_hold_decision: rec.minimum_hold_decision,
      reason_code: rec.reason_code,
      frozen_iv: rec.frozen_iv,
      worst_case: rec.worst_case,
      requires_human_signoff: rec.requires_human_signoff,
    })).digest('hex').slice(0, 16)
    const sellReviewId = `sell_${researchCaseId.replace(/^rc_/, '')}_${contentHash}`
    const nowIso = new Date().toISOString()

    const event: LedgerEventEnvelope<unknown> = {
      event_id: `evt_holding_sell_review_drafted_${sellReviewId}`,
      event_type: 'holding_sell_review_drafted',
      aggregate_type: 'holding',
      aggregate_id: holdingId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: state.config.provider.provider_id,
      payload: {
        sell_review_id: sellReviewId,
        holding_id: holdingId,
        research_case_id: researchCaseId,
        ticker: heldTicker,
        reason_code: rec.reason_code,
        detail: rec.reason,
        ...(sellReviewDraft === undefined
          ? {}
          : { reasons: sellReviewDraft.reasons, weakest_reason: sellReviewDraft.weakest_reason, weakest_reason_note: sellReviewDraft.weakest_reason_note }),
        message: rec.reason,
        // Phase 6 S8a — the advisory sell-decision fields ride on the OBSERVATION so S8b can render them.
        // (Additive payload fields beyond the base holding_sell_review_drafted contract.)
        decision_status: result.status,
        trigger: rec.trigger,
        impairment_call: rec.impairment_call,
        minimum_hold_decision: rec.minimum_hold_decision,
        ...(rec.frozen_iv === undefined ? {} : { frozen_iv: rec.frozen_iv }),
        worst_case: rec.worst_case,
        bias_caveats: rec.bias_caveats,
        requires_human_signoff: rec.requires_human_signoff,
        ...(sellReviewDraft === undefined ? {} : { sell_review_draft: sellReviewDraft }),
        // The exit draft is NEVER an execution / recommendation-to-act; it requires human authoring.
        is_execution: false,
        is_recommendation: false,
        requires_user_authoring: true,
        // Worker/agent OBSERVATION discipline: this is an observation, and it NEVER closes the holding —
        // the close stays the human-signed closeHolding transition.
        is_observation: true,
      },
      source_ids: corpusSourceIds,
      created_at: nowIso,
      schema_version: 1,
      idempotency_key: `sell-decision:${researchCaseId}:${holdingId}:${contentHash}`,
    }
    await store.append(event)

    return {
      status: 'complete',
      sell_review_id: sellReviewId,
      recommendation: event.payload as Record<string, unknown>,
    }
  } finally {
    store.close()
  }
}

/** Flatten the S6 assembler result into the persisted payload core (status + size fields or reason). */
function buildSizingPayloadCore(result: SizingAssessmentResult): Record<string, unknown> {
  if (result.status === 'sizeable') {
    const rec = result.recommendation
    return {
      status: 'sizeable' as const,
      conviction_factor: rec.conviction_factor,
      target_weight: rec.target_weight,
      sizeable_value: rec.sizeable_value,
      binding_constraint: rec.binding_constraint,
      worst_case: rec.worst_case,
      ladder: rec.ladder,
      caveats: rec.caveats,
    }
  }
  if (result.status === 'hold_in_savings') {
    return {
      status: 'hold_in_savings' as const,
      reason: result.reason,
      ...(result.expected_savings_return === undefined ? {} : { expected_savings_return: result.expected_savings_return }),
    }
  }
  return { status: 'cannot_size' as const, reason: result.reason }
}

/** Resolve fundamentals fresh for the admit screen — fail-closed (undefined) on any error / offline. */
async function resolveFundamentalsFreshForAdmit(ticker: string): Promise<Fundamentals | undefined> {
  try {
    return await resolveFundamentalsForTicker(ticker)
  } catch {
    return undefined
  }
}

/** Resolve market cap ($M) = current price × diluted shares (millions). Fail-closed (undefined). */
async function resolveMarketCapMusdForAdmit(
  ticker: string,
  fundamentals: Fundamentals,
  resolvePrice?: (ticker: string) => Promise<PriceQuote>,
): Promise<number | undefined> {
  const dilutedShares = fundamentals.latest_annual.diluted_shares_m
  if (dilutedShares === undefined || !(dilutedShares > 0)) return undefined
  try {
    const quote = await (resolvePrice ?? ((t: string) => resolveCurrentPrice({ ticker: t })))(ticker)
    if (!quote.available) return undefined
    // diluted_shares_m is in MILLIONS → price × shares(M) yields $MILLIONS market cap.
    return quote.price_per_share * dilutedShares
  } catch {
    return undefined
  }
}

export async function openPersonalHoldingFromWatchlist(
  state: OnboardingState,
  watchlistItemId: string,
  input: OpenPersonalHoldingInput = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const watchlistItem = projectWatchlist(events).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (watchlistItem === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }
    if (!watchlistItem.user_approved) {
      throw new Error(`Watchlist item is not confirmed: ${watchlistItemId}`)
    }

    const ticker = watchlistItem.ticker ?? watchlistItem.company_id ?? watchlistItem.watchlist_item_id
    const lot = parseHoldingLotInput(input)
    const holdingId = `holding_${ticker.toLowerCase()}_${Date.now()}`
    const gateDecision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: watchlistItem.research_case_id,
      target_transition: 'holding_open',
      target_id: holdingId,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${watchlistItem.research_case_id}:holding-open:${holdingId}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)
    return await openHoldingFromWatchlist(store, {
      holding_id: holdingId,
      watchlist_item_id: watchlistItem.watchlist_item_id,
      research_case_id: watchlistItem.research_case_id,
      company_id: watchlistItem.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: watchlistItem.strategy_id ?? state.config.strategy_id,
      ...(watchlistItem.strategy_version === undefined ? {} : { strategy_version: watchlistItem.strategy_version }),
      thesis_summary: watchlistItem.thesis_summary ?? `Initial holding opened from watchlist item ${watchlistItem.watchlist_item_id}`,
      shares: lot.shares,
      cost_basis_per_share: lot.cost_basis_per_share,
      currency: lot.currency,
      opened_at: lot.opened_at,
      causation_id: `evt_watchlist_draft_confirmed_${watchlistItem.watchlist_item_id}`,
      actor_id: 'user_local',
      idempotency_key: `holding:${watchlistItem.watchlist_item_id}:open:v1`,
    })
  } finally {
    store.close()
  }
}

export async function recordPersonalHoldingValuation(
  state: OnboardingState,
  holdingId: string,
  input: RecordPersonalHoldingValuationInput = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const holding = projectHoldings(await store.list()).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      throw new Error(`Unknown holding: ${holdingId}`)
    }

    const valuation = parseHoldingValuationInput(input, holding.currency)
    const safeValuedAt = valuation.valued_at.replaceAll('-', '_')
    return await recordHoldingValuationSnapshot(store, {
      snapshot_id: `valuation_${holding.holding_id}_${safeValuedAt}_${Date.now()}`,
      holding_id: holding.holding_id,
      price_per_share: valuation.price_per_share,
      currency: valuation.currency,
      valued_at: valuation.valued_at,
      causation_id: `evt_holding_opened_${holding.holding_id}`,
      actor_id: 'user_local',
      idempotency_key: `holding:${holding.holding_id}:valuation:${valuation.valued_at}:${Date.now()}`,
    })
  } finally {
    store.close()
  }
}

export async function createPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const holding = projectHoldings(await store.list()).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      throw new Error(`Unknown holding: ${holdingId}`)
    }

    const reviewId = `review_${holding.holding_id}_${Date.now()}`
    await assertConfiguredProviderIsReady(state)
    const provider = resolveProvider({ provider_id: state.config.provider.provider_id })
    return await draftHoldingReview(store, provider, {
      review_id: reviewId,
      holding_id: holding.holding_id,
      model_id: resolveModelIdForProvider(state.config),
      causation_id: holding.latest_review_id === undefined
        ? `evt_holding_opened_${holding.holding_id}`
        : `evt_holding_review_confirmed_${holding.latest_review_id}`,
      idempotency_key: `holding:${holding.holding_id}:review:${reviewId}:draft`,
    })
  } finally {
    store.close()
  }
}

export async function confirmPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
  checklistAnswers: Record<string, ChecklistAnswer> = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  // COMPLETION-BLOCK (Phase 7 S3): the re-underwrite sign-off requires every hygiene/bias checklist item
  // to be ADDRESSED — the integrity fix that turns holding_review_confirmed from validating NOTHING into
  // validating the checklist. The cognitive answers are HUMAN-AUTHORED only; we pass them through untouched
  // and NEVER default/synthesize any answer here. Reject with the unaddressed ids so the route can 400 with
  // what still needs attention. Decision-NEUTRAL: no scoring/count. (confirmHoldingReviewDraft re-checks.)
  const checklistCompletion = evaluateChecklistCompletion(checklistAnswers)
  if (!checklistCompletion.complete) {
    throw new Error(
      `Re-underwrite sign-off requires every quality/bias checklist item to be addressed; unaddressed: ${checklistCompletion.unaddressed.join(', ')}`,
    )
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await confirmHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      checklist_answers: checklistAnswers,
      idempotency_key: `holding:${holdingId}:review:${reviewId}:confirm`,
    })
  } finally {
    store.close()
  }
}

export async function overridePersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
  input: OverridePersonalHoldingReviewInput,
  checklistAnswers: Record<string, ChecklistAnswer> = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  // COMPLETION-BLOCK (Phase 7 S3 — bypass close): the override is a co-equal re-underwrite sign-off writing
  // the SAME confirmed thesis state as confirm, so it requires every hygiene/bias checklist item to be
  // ADDRESSED — gating only confirm would reopen the gap S3 closed. The cognitive answers are HUMAN-AUTHORED
  // only; we pass them through untouched and NEVER default/synthesize. Reject with the unaddressed ids so the
  // route can 400 with what still needs attention. Decision-NEUTRAL: no scoring/count. (overrideHoldingReviewDraft re-checks.)
  const checklistCompletion = evaluateChecklistCompletion(checklistAnswers)
  if (!checklistCompletion.complete) {
    throw new Error(
      `Re-underwrite sign-off requires every quality/bias checklist item to be addressed; unaddressed: ${checklistCompletion.unaddressed.join(', ')}`,
    )
  }

  const override = parseHoldingReviewOverrideInput(input)
  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await overrideHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      thesis_health: override.thesis_health,
      action_stance: override.action_stance,
      rationale: override.rationale,
      evidence_summary: override.evidence_summary,
      uncertainty: override.uncertainty,
      next_review_at: override.next_review_at,
      checklist_answers: checklistAnswers,
      idempotency_key: `holding:${holdingId}:review:${reviewId}:override`,
    })
  } finally {
    store.close()
  }
}

export async function rejectPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
  input: RejectPersonalHoldingReviewInput,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const rejectionReason = parseRequiredText(input.rejection_reason, 'Rejection reason')
  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await rejectHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      rejection_reason: rejectionReason,
      idempotency_key: `holding:${holdingId}:review:${reviewId}:reject`,
    })
  } finally {
    store.close()
  }
}

export type SetInvestableCapitalInput = {
  amount?: FormDataEntryValue | number | string | null
  currency?: FormDataEntryValue | string | null
}

/**
 * Appends a user-authored `investable_capital_set` event to the durable ledger.
 *
 * Investable capital is ADVISORY: it is used to size positions on the dossier, but
 * the user authors all actual buys. The worker never trades. `as_of` is server time.
 */
export async function setInvestableCapital(
  state: OnboardingState,
  input: SetInvestableCapitalInput,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const amount = parseRequiredNumber(input.amount, 'Investable capital amount')
  if (amount <= 0) {
    throw new Error('Investable capital amount must be greater than zero')
  }
  const currency = parseCurrency(input.currency, 'Investable capital currency', 'USD')
  const asOf = new Date().toISOString()

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await store.append({
      event_id: `evt_investable_capital_set_${Date.now()}`,
      event_type: 'investable_capital_set',
      aggregate_type: 'portfolio',
      aggregate_id: 'portfolio_local',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        amount,
        currency,
        as_of: asOf,
      },
      source_ids: [],
      created_at: asOf,
      schema_version: 1,
      idempotency_key: `investable-capital-set:${asOf}`,
    })
  } finally {
    store.close()
  }
}

/**
 * Projects the latest user-set investable capital snapshot from the durable ledger.
 * Returns undefined when the ledger is not configured or no capital has been set.
 */
export async function getInvestableCapital(
  ledgerPath: string | undefined,
): Promise<InvestableCapitalSnapshot | undefined> {
  if (ledgerPath === undefined) {
    return undefined
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    return projectInvestableCapital(await store.list())
  } finally {
    store.close()
  }
}

function parseHoldingLotInput(input: OpenPersonalHoldingInput): {
  shares: number
  cost_basis_per_share: number
  currency: string
  opened_at: string
} {
  const shares = parseRequiredNumber(input.shares ?? 1, 'Holding shares')
  const costBasisPerShare = parseRequiredNumber(input.cost_basis_per_share ?? 0, 'Cost basis per share')
  const currency = parseCurrency(input.currency, 'Holding currency', 'USD')
  const openedAt = String(input.opened_at ?? new Date().toISOString().slice(0, 10)).trim()

  if (shares <= 0) {
    throw new Error('Holding shares must be greater than zero')
  }
  if (costBasisPerShare < 0) {
    throw new Error('Cost basis per share cannot be negative')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openedAt)) {
    throw new Error('Opened date must use YYYY-MM-DD format')
  }

  return {
    shares,
    cost_basis_per_share: costBasisPerShare,
    currency,
    opened_at: openedAt,
  }
}

function parseHoldingValuationInput(input: RecordPersonalHoldingValuationInput, fallbackCurrency: string): {
  price_per_share: number
  currency: string
  valued_at: string
} {
  const pricePerShare = parseRequiredNumber(input.price_per_share, 'Valuation price per share')
  const currency = parseCurrency(input.currency, 'Valuation currency', fallbackCurrency)
  const valuedAt = String(input.valued_at ?? new Date().toISOString().slice(0, 10)).trim()

  if (pricePerShare < 0) {
    throw new Error('Valuation price per share cannot be negative')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valuedAt)) {
    throw new Error('Valuation date must use YYYY-MM-DD format')
  }

  return {
    price_per_share: pricePerShare,
    currency,
    valued_at: valuedAt,
  }
}

function parseHoldingReviewOverrideInput(input: OverridePersonalHoldingReviewInput): {
  thesis_health: 'HEALTHY' | 'WATCH' | 'IMPAIRED' | 'EXIT_CANDIDATE'
  action_stance: 'HOLD' | 'ADD_ON_PULLBACK' | 'REDUCE' | 'EXIT_REVIEW_NEEDED' | 'RESEARCH_MORE'
  rationale: string
  evidence_summary: string
  uncertainty: string
  next_review_at: string
} {
  const thesisHealth = parseRequiredText(input.thesis_health, 'Override thesis health')
  const actionStance = parseRequiredText(input.action_stance, 'Override action stance')
  const nextReviewAt = parseRequiredText(input.next_review_at, 'Override next review date')

  if (!['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE'].includes(thesisHealth)) {
    throw new Error('Override thesis health is invalid')
  }
  if (!['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE'].includes(actionStance)) {
    throw new Error('Override action stance is invalid')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextReviewAt)) {
    throw new Error('Override next review date must use YYYY-MM-DD format')
  }

  return {
    thesis_health: thesisHealth as 'HEALTHY' | 'WATCH' | 'IMPAIRED' | 'EXIT_CANDIDATE',
    action_stance: actionStance as 'HOLD' | 'ADD_ON_PULLBACK' | 'REDUCE' | 'EXIT_REVIEW_NEEDED' | 'RESEARCH_MORE',
    rationale: parseRequiredText(input.rationale, 'Override rationale'),
    evidence_summary: parseRequiredText(input.evidence_summary, 'Override evidence summary'),
    uncertainty: parseRequiredText(input.uncertainty, 'Override uncertainty'),
    next_review_at: nextReviewAt,
  }
}

function parseRequiredText(value: FormDataEntryValue | string | null | undefined, label: string): string {
  const parsed = String(value ?? '').trim()
  if (parsed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return parsed
}

function parseRequiredNumber(value: FormDataEntryValue | number | string | null | undefined, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`)
  }
  return parsed
}

function parseCurrency(value: FormDataEntryValue | string | null | undefined, label: string, fallback: string): string {
  const parsed = String(value ?? fallback).trim().toUpperCase() || fallback
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: parsed }).format(0)
  } catch {
    throw new Error(`${label} must be a valid ISO 4217 currency code`)
  }
  return parsed
}

function belongsToStrategy(
  item: Pick<ResearchCaseProjection, 'strategy_id'>,
  selectedStrategyId: string,
): boolean {
  return item.strategy_id === undefined || item.strategy_id === selectedStrategyId
}

function candidateToPipelineItem(candidate: DiscoveryCandidateProjection): AppResearchPipelineItem {
  const signal = extractDiscoverySignal(candidate.discovery_metadata)
  return {
    id: candidate.candidate_id,
    label: `${candidate.ticker} — ${candidate.company_name}`,
    status: candidate.status,
    next_action: nextActionForDiscoveryCandidate(candidate),
    ...(candidate.research_case_id === undefined ? {} : { href: `/research/${candidate.research_case_id}` }),
    meta: `${candidate.market} • ${candidate.strategy_id}@${candidate.strategy_version}`,
    ...(signal === undefined ? {} : { signal }),
  }
}

function researchCaseToPipelineItem(researchCase: ResearchCaseProjection): AppResearchPipelineItem {
  const label = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const summary = researchCaseSummarySnippet(researchCase)

  return {
    id: researchCase.research_case_id,
    label,
    status: researchCase.screening_result ?? researchCase.decision ?? researchCase.stage,
    next_action: researchCase.next_required_action ?? nextActionForResearchCase(researchCase),
    href: `/research/${researchCase.research_case_id}`,
    meta: `${strategyLabelFor(researchCase)} • Updated ${researchCase.updated_at}`,
    ...(summary === undefined ? {} : { summary }),
  }
}

function watchlistItemToPipelineItem(item: AppWatchlistItem): AppResearchPipelineItem {
  const label = item.ticker ?? item.company_id ?? item.watchlist_item_id
  const status = item.user_approved ? 'confirmed_watchlist' : 'watchlist_draft'

  return {
    id: item.watchlist_item_id,
    label,
    status,
    next_action: item.holding_id !== undefined
      ? 'Review in portfolio'
      : item.user_approved
        ? 'Monitor and open a holding only after user decision'
        // Phase 8 S6: legacy-only — the standalone confirm-draft affordance was removed in S4. An
        // unconfirmed draft can only come from a legacy partial ledger; do not promise the deleted action.
        : 'Legacy unconfirmed draft — re-admit from research',
    href: item.holding_id !== undefined ? `/portfolio#${item.holding_id}` : '/watchlist',
    meta: `${item.strategy_id ?? 'strategy pending'} • Updated ${item.updated_at}`,
  }
}

function nextActionForDiscoveryCandidate(candidate: DiscoveryCandidateProjection): string {
  switch (candidate.status) {
    case 'discovered':
      return 'Queue for quick screen'
    case 'queued_for_quick_screen':
      return 'Run selected-strategy quick screen'
    case 'duplicate':
      return `Review duplicate target ${candidate.duplicate_target_id ?? 'record'}`
    case 'promoted_to_research_case':
      return 'Continue from the promoted research case'
    case 'rejected':
      return 'No action required'
  }
}

function nextActionForResearchCase(researchCase: ResearchCaseProjection): string {
  switch (researchCase.stage) {
    case 'discovered':
      return 'Run selected-strategy quick screen'
    case 'quick_screened':
      return researchCase.screening_result === 'deep_dive_candidate'
        ? 'Send to deep dive queue'
        : 'Review quick screen outcome'
    case 'awaiting_deep_dive_approval':
      return 'Review quick screen and click "Run deep dive" to start the swarm'
    case 'queued_for_deep_dive':
      return 'Start deep dive'
    case 'deep_dive_started':
    case 'specialist_finding_recorded':
    case 'deep_dive_in_progress':
      return 'Record specialist findings and draft synthesis'
    case 'deep_dive_synthesis_drafted':
    case 'deep_dive_completed':
    case 'deep_dive_complete':
      return 'Draft strategy decision'
    case 'analysis_drafted':
      return 'Draft auditable decision'
    case 'decision_pending':
    case 'decision_drafted':
      return 'Review decision and confirm the next user-authored transition'
    case 'watchlist_draft':
      // Phase 8 S6: legacy-only stage — S4 promotes straight to a confirmed watchlist (atomic admit +
      // confirm), so the confirm-draft action no longer exists; surface the legacy state instead.
      return 'Legacy unconfirmed draft — re-admit from research'
    case 'watchlist':
      return 'Monitor watchlist thesis'
    case 'holding':
      return 'Review holding in portfolio'
    case 'rejected':
    case 'pass':
      return 'No action required'
  }
}

function strategyLabelFor(item: Pick<ResearchCaseProjection, 'strategy_id' | 'strategy_version'>): string {
  if (item.strategy_id === undefined) {
    return 'strategy pending'
  }

  return item.strategy_version === undefined ? item.strategy_id : `${item.strategy_id}@${item.strategy_version}`
}

function sortPipelineItems(items: AppResearchPipelineItem[]): AppResearchPipelineItem[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label))
}

function buildPersonalWatchlistItems(events: Awaited<ReturnType<EventStore['list']>>): AppWatchlistItem[] {
  const holdingsByWatchlistId = new Map(projectHoldings(events).map((holding) => [holding.watchlist_item_id, holding]))

  return projectWatchlist(events).map((item) => {
    const holding = holdingsByWatchlistId.get(item.watchlist_item_id)
    return {
      ...item,
      ...(holding === undefined ? {} : { holding_id: holding.holding_id }),
    }
  })
}

async function buildPersonalResearchCase(
  events: Awaited<ReturnType<EventStore['list']>>,
  researchCase: ResearchCaseProjection,
  sourceLedgerPath?: string,
): Promise<AppResearchCase> {
  const timeline = projectResearchCaseTimeline(events, researchCase.research_case_id)
  const sourceIds = [...new Set(timeline.flatMap((entry) => entry.source_ids))]

  const forecasts = projectForecasts(events).filter((forecast) => forecast.research_case_id === researchCase.research_case_id)
  const reanalysisDiff = buildReAnalysisDiff(events, researchCase)
  const postMortem = findPostMortemForResearchCase(events, researchCase.research_case_id)

  return {
    ...researchCase,
    gate_checklist: pendingChecklist.map((gate) => ({ ...gate })),
    source_ids: sourceIds,
    source_evidence: await loadSourceEvidenceForResearchCase(sourceLedgerPath, researchCase.research_case_id, sourceIds),
    ledger_timeline: timeline,
    ...(forecasts.length === 0 ? {} : { forecasts }),
    ...(reanalysisDiff === undefined ? {} : { reanalysis_diff: reanalysisDiff }),
    ...(postMortem === undefined ? {} : { post_mortem: postMortem }),
    next_required_action: researchCase.next_required_action ?? `Start selected-strategy research for ${researchCase.ticker ?? researchCase.research_case_id}`,
  }
}

/** Map a projected case to the re-analysis-diff snapshot shape. */
function reAnalysisSnapshot(researchCase: ResearchCaseProjection): Parameters<typeof computeReAnalysisDiff>[0] {
  const snapshot: Parameters<typeof computeReAnalysisDiff>[0] = { research_case_id: researchCase.research_case_id }
  if (researchCase.investment_verdict !== undefined) snapshot.investment_verdict = researchCase.investment_verdict
  if (researchCase.valuation?.verdict_state?.state !== undefined) snapshot.verdict_state = researchCase.valuation.verdict_state.state
  if (researchCase.valuation?.moat_class !== undefined) snapshot.moat_class = researchCase.valuation.moat_class
  if (researchCase.valuation?.growth_rate !== undefined) snapshot.credited_g = researchCase.valuation.growth_rate
  if (researchCase.valuation?.fair_value_per_share !== undefined) snapshot.fair_value_per_share = researchCase.valuation.fair_value_per_share
  if (researchCase.valuation?.buy_price_per_share !== undefined) snapshot.buy_price_per_share = researchCase.valuation.buy_price_per_share
  const shariah = researchCase.shariah_status ?? researchCase.shariah_financial?.verdict
  if (shariah !== undefined) snapshot.shariah_status = shariah
  return snapshot
}

/**
 * Compute the "what changed since last case" diff: the prior version is the case
 * this one supersedes (or, failing an explicit link, the immediately prior version
 * for the same ticker). Undefined when there is no prior case.
 */
function buildReAnalysisDiff(
  events: Awaited<ReturnType<EventStore['list']>>,
  researchCase: ResearchCaseProjection,
): ReAnalysisDiff | undefined {
  let prior: ResearchCaseProjection | undefined
  if (researchCase.supersedes_research_case_id !== undefined) {
    prior = projectResearchCases(events).find((candidate) => candidate.research_case_id === researchCase.supersedes_research_case_id)
  }
  if (prior === undefined && researchCase.ticker !== undefined) {
    const versions = projectResearchCaseVersionsForTicker(events, researchCase.ticker)
    const index = versions.findIndex((candidate) => candidate.research_case_id === researchCase.research_case_id)
    if (index > 0) prior = versions[index - 1]
  }
  if (prior === undefined) return undefined
  return computeReAnalysisDiff(reAnalysisSnapshot(prior), reAnalysisSnapshot(researchCase))
}

function researchCaseSummarySnippet(researchCase: ResearchCaseProjection): string | undefined {
  const source = [
    researchCase.thesis_summary,
    researchCase.evidence_summary,
    researchCase.reason,
    researchCase.next_required_action,
  ].find((value) => value !== undefined && value.trim().length > 0)

  if (source === undefined) {
    return undefined
  }

  return truncateSentence(source, 180)
}

function truncateSentence(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

async function loadSourceEvidenceForResearchCase(
  sourceLedgerPath: string | undefined,
  researchCaseId: string,
  sourceIds: string[],
): Promise<AppSourceEvidence[]> {
  if (sourceLedgerPath === undefined || sourceLedgerPath.trim().length === 0) {
    return sourceIds.map(sourceIdToFallbackEvidence)
  }

  const bundle = await readSourceBundle(sourceLedgerPath, researchCaseId)
  if (bundle === undefined) {
    return sourceIds.map(sourceIdToFallbackEvidence)
  }

  const recordsBySourceId = new Map(bundle.records.map((record) => [record.source_id, record]))
  const orderedSourceIds = sourceIds.length === 0
    ? bundle.records.map((record) => record.source_id)
    : sourceIds

  return orderedSourceIds.map((sourceId) => {
    const record = recordsBySourceId.get(sourceId)
    if (record === undefined) {
      return sourceIdToFallbackEvidence(sourceId)
    }

    const safeUrl = safeEvidenceUrl(record.url)
    const safeCitationLocator = safeDisplayText(record.citation_locator)

    return {
      source_id: sourceId,
      title: safeDisplayText(record.title) ?? 'Source evidence recorded',
      excerpt: safeDisplayText(record.excerpt) ?? fallbackExcerptForRecord(record),
      ...(safeUrl === undefined ? {} : { url: safeUrl }),
      ...(safeCitationLocator === undefined ? {} : { citation_locator: safeCitationLocator }),
    }
  })
}

async function readSourceBundle(sourceLedgerPath: string, researchCaseId: string): Promise<SourceLedgerBundle | undefined> {
  const bundlePath = join(sourceLedgerPath, `${defaultSourceLedgerStorage.file_prefix}-${researchCaseId}.json`)
  try {
    const raw = JSON.parse(await readFile(bundlePath, 'utf8')) as Omit<SourceLedgerBundle, 'bundle_path'> & { bundle_path?: string }
    if (!Array.isArray(raw.records)) {
      return undefined
    }

    return {
      bundle_path: bundlePath,
      research_case_id: raw.research_case_id,
      provider_id: raw.provider_id,
      captured_at: raw.captured_at,
      records: raw.records,
    }
  } catch {
    return undefined
  }
}

function sourceIdToFallbackEvidence(sourceId: string): AppSourceEvidence {
  return {
    source_id: sourceId,
    title: humanizeAuditSourceId(sourceId),
    excerpt: 'No source excerpt was recorded for this legacy event; keep the audit source ID for ledger traceability.',
  }
}

function humanizeAuditSourceId(sourceId: string): string {
  const tokens = sourceId
    .replace(/^src_/, '')
    .split(/[_\s-]+/)
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return 'Audit source recorded'
  }

  return tokens.map((token, index) => {
    if (/^(?:fy\d+|q\d+|\d+k|\d{4})$/i.test(token)) {
      return token.toUpperCase()
    }

    const nextToken = tokens[index + 1]
    const looksLikeTickerPrefix = index === 0 && /^(?:fy\d+|q\d+|\d+k|proxy|market)$/i.test(nextToken ?? '')
    if (looksLikeTickerPrefix) {
      return token.toUpperCase()
    }

    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  }).join(' ')
}

function fallbackExcerptForRecord(record: SourceLedgerBundle['records'][number]): string {
  if (record.source_type === 'local-file') {
    return 'Local source evidence was recorded with private path details redacted.'
  }

  return 'No source excerpt was recorded; use the audit source ID and citation metadata for traceability.'
}

function safeDisplayText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (text === undefined || text.length === 0 || looksLikePrivatePath(text)) {
    return undefined
  }

  return text
}

function safeEvidenceUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined
    }

    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''

    return url.toString()
  } catch {
    return undefined
  }
}

function looksLikePrivatePath(value: string): boolean {
  return /(?:^|\s)(?:\/\S|[A-Za-z]:[\\/]|\\\\|file:\/\/|\.\.?[\\/]|~[\\/])/.test(value)
}

async function assertConfiguredProviderIsReady(state: OnboardingState): Promise<void> {
  const rows = await buildProviderStatusRows()
  const provider = rows.find((row) => row.provider_id === state.config.provider.provider_id)
  if (provider === undefined) {
    throw new Error(`Unknown provider: ${state.config.provider.provider_id}`)
  }
  if (!provider.is_ready) {
    throw new Error(`Provider ${provider.provider_id} is not ready: ${provider.status_label}`)
  }
}

export function resolveModelIdForProvider(config: Pick<AppConfig, 'provider'>): string {
  if (config.provider.model_id !== undefined && config.provider.model_id.length > 0) {
    return config.provider.model_id
  }

  if (config.provider.provider_id === 'mock-provider') {
    return 'mock-buffett-munger-demo'
  }

  if (config.provider.provider_id === 'claude') {
    return 'claude-sonnet-4-6'
  }

  return 'gpt-5.5'
}
