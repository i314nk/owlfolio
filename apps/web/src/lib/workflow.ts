import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

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
import type { AppConfig } from '@owlfolio/shared'
import {
  approveWatchlistDraft,
  assertShariahGateAllowsTransition,
  confirmHoldingReviewDraft,
  confirmWatchlistDraft,
  draftHoldingReview,
  evaluateResearchCaseShariahGate,
  lookupExistingShariahGateDecision,
  openHoldingFromWatchlist,
  overrideHoldingReviewDraft,
  recordHoldingValuationSnapshot,
  rejectHoldingReviewDraft,
  defaultSourceLedgerStorage,
  type SourceLedgerBundle,
} from '@owlfolio/workflow'
import { selectResearchCaseAction } from '@owlfolio/workflow/researchCasePolicy'
import { runStrategyResearchSwarm, runResearchDeepDivePhase, type GroundFn } from '@owlfolio/workflow/researchSwarm'
import { resolveModelRoleEnv } from './modelRoleEnv'
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
          // model-tiering: file-configured per-role overrides (UI-managed env file) take effect here.
          model_role_env: await resolveModelRoleEnv(),
        },
        { ground },
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
            // model-tiering: file-configured per-role overrides take effect in the deep-dive phase too.
            model_role_env: await resolveModelRoleEnv(),
          },
          { ground },
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
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
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

    return await confirmWatchlistDraft(store, {
      watchlist_item_id: watchlistItemId,
      research_case_id: researchCase.research_case_id,
      decision_id: researchCase.decision_id,
      company_id: researchCase.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: researchCase.strategy_id ?? state.config.strategy_id,
      ...(researchCase.strategy_version === undefined ? {} : { strategy_version: researchCase.strategy_version }),
      thesis_summary: thesisSummary,
      actor_id: 'user_local',
      idempotency_key: `decision:${researchCase.research_case_id}:watchlist:v1`,
    })
  } finally {
    store.close()
  }
}

export async function confirmPersonalWatchlistDraft(
  state: OnboardingState,
  watchlistItemId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const watchlistItem = projectWatchlist(await store.list()).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (watchlistItem === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }

    // Reuse the existing promotion gate decision rather than recording a duplicate evaluation.
    // A prior decision already exists from watchlist_promotion (same target_id = watchlist_item_id).
    // Only fall back to a full evaluation if no prior decision is found (e.g. legacy ledger items).
    const existingDecision = await lookupExistingShariahGateDecision(store, watchlistItem.watchlist_item_id)
    const gateDecision = existingDecision ?? await evaluateResearchCaseShariahGate(store, {
      research_case_id: watchlistItem.research_case_id,
      target_transition: 'watchlist_confirmation',
      target_id: watchlistItem.watchlist_item_id,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${watchlistItem.research_case_id}:watchlist-confirmation:${watchlistItem.watchlist_item_id}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)

    return await approveWatchlistDraft(store, {
      watchlist_item_id: watchlistItem.watchlist_item_id,
      research_case_id: watchlistItem.research_case_id,
      causation_id: `evt_watchlist_draft_created_${watchlistItem.watchlist_item_id}`,
      actor_id: 'user_local',
      idempotency_key: `watchlist:${watchlistItem.watchlist_item_id}:confirm:v1`,
    })
  } finally {
    store.close()
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
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await confirmHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
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
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
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
        : 'Confirm watchlist draft',
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
      return 'Confirm watchlist draft'
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
