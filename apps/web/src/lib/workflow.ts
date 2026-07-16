import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
import { getProviderCatalog, resolveProvider } from '@owlfolio/providers'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { CHECKLIST_PARAMS, type ChecklistAudit } from '@owlfolio/strategies/checklistParams'
import { resolveAdmissionThesisDraft, resolveBusinessFindings } from './checklistEvidence'
import { isTerminalResearchStage } from './researchRunProgress'
import { resolveAppConfigPath } from './appConfigStore'
import { resolveProviderCertificationReportDir } from './providerStatus'
import type { AppConfig } from '@owlfolio/shared'
import { mergeSavingsSleeveConfig, userSetRequiredReturn } from '@owlfolio/shared/appConfig'
import { mergeAutomationSettings } from '@owlfolio/shared/appConfig'

/** Resolve the clamped circle-gate hardening knobs from app config (k-sample agreement + evidence floors). */
function resolveCircleGateSettings(config: AppConfig): { k_samples: number; min_drivers: number; min_breakers: number } {
  const automation = mergeAutomationSettings(config.automation)
  return {
    k_samples: automation.circle_gate_k_samples,
    min_drivers: automation.circle_gate_min_drivers,
    min_breakers: automation.circle_gate_min_breakers,
  }
}
import {
  assertShariahGateAllowsTransition,
  checkForNewFilings,
  closeHolding,
  confirmWatchlistDraft,
  draftThesisReReview,
  evaluateResearchCaseShariahGate,
  loadPriorThesis,
  openHoldingFromWatchlist,
  pruneWatchlistItem,
  recordHoldingValuationSnapshot,
  defaultSourceLedgerStorage,
  type CheckForNewFilingsDeps,
  type InsiderClusterTrigger,
  type SourceLedgerBundle,
  type ThesisReReviewRecordedPayload,
} from '@owlfolio/workflow'
import { selectResearchCaseAction } from '@owlfolio/workflow/researchCasePolicy'
import { archiveResearchCase } from '@owlfolio/workflow/researchWorkflow'
import { runStrategyResearchSwarm, runResearchDeepDivePhase, type GroundFn } from '@owlfolio/workflow/researchSwarm'
import { runAdmitAssessment, isDeepDiveComplete, type AdmitAssessmentResult } from '@owlfolio/workflow/admitAssessment'
import {
  computeSellDecision,
  type MinimumHoldTrigger,
  type SellAssessmentArgs,
  type SellDecisionResult,
  type SellRecommendation,
} from '@owlfolio/workflow/sellAssessment'
import { MINIMUM_HOLD_TRIGGERS as MINIMUM_HOLD_TRIGGER_LIST } from '@owlfolio/strategies/minimumHoldGuard'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import {
  queueDiscoveryCandidateForQuickScreen,
  rejectDiscoveryCandidate as rejectDiscoveryCandidateEvent,
  promoteDiscoveryCandidateToResearchCase,
} from '@owlfolio/workflow/discoveryCandidateWorkflow'
import { resolveFundamentalsForTicker } from '@owlfolio/workflow/fundamentalsProvider'
import { resolveCurrentPrice, type PriceQuote } from '@owlfolio/workflow/marketData'
import { runPriceRefresh, type PriceRefreshResult, type RunPriceRefreshDeps } from '@owlfolio/workflow/priceRefresh'
import type { FilingRef, Fundamentals } from '@owlfolio/workflow/secEdgar'
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
import type { OnboardingState } from './onboarding'
import { buildProviderStatusRows } from './providerStatus'
import { isResearchResetEnabled, type DevToolsEnv } from './devTools'

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
  /** OWNER-LOCKED (2026-07-14): the board DISPLAYS from the latest non-superseded case for the
   * ticker — this is that case's id (the dossier link target). The item's own research_case_id
   * remains the frozen audit pointer (what the user confirmed on). */
  display_research_case_id?: string
  /** The latest analysis's verdict + date — rendered honestly when that run produced no thresholds. */
  latest_analysis_verdict?: string
  latest_analysis_at?: string
  /** The latest analysis's own thesis summary — the display text (the item's copy is the admitted-on draft). */
  latest_analysis_thesis?: string
  /** The harness-computed purification rate (= impermissible income / revenue) from the latest analysis. */
  purification_pct?: number
}

/**
 * Model-verdict + distance-to-buy + staleness info for a watchlist item (derived from its research case).
 * RELIGHTENED DECISION (R1): the MODEL proposes the verdict + valuation_status + buy-below; the deterministic
 * side emits a flag-only sanity-check. The band/gap engine is retired; these fields carry the model's framing.
 */
export type AppWatchlistVerdict = {
  /** 'BUY-WINDOW' | 'WATCH-FAIR' | 'WATCH' when the linked case computed a verdict state; else undefined. */
  state?: string
  /** The model's valuation status (e.g. FAIR / EXPENSIVE / OVERVALUED). */
  valuation_status?: string
  /** The MODEL-proposed buy-below (recorded verbatim, NOT a derived FV). */
  proposed_buy_below?: number
  buy_price_per_share?: number
  /** RELIGHTENED DECISION (R1): a forward-DCF cross-check fair value — a reference only, not the decision. */
  reference_fair_value?: number
  /** RELIGHTENED DECISION (R1): pure arithmetic — current_price <= buy_below. */
  in_buy_zone?: boolean
  /** RELIGHTENED DECISION (R1): the deterministic flag-only sanity-check messages (advisory; never blocks). */
  sanity_flags?: string[]
  /** Current market price per share, when a quote is available (else undefined → "no live quote"). */
  market_price_per_share?: number
  /** Signed distance of market vs buy price as a PERCENT (negative = below buy price = in the window). */
  distance_to_buy_pct?: number
  /** RULE 8 (owner-locked 2026-07-13): the load-up threshold (IV × 0.50) + the zone read at the live price. */
  load_up_below?: number
  in_load_up_zone?: boolean
  /** ISO timestamp of the price snapshot used for market_price_per_share (from the ledger snapshot). */
  price_as_of?: string
  /** The case's last-updated timestamp — basis for the staleness read. */
  case_updated_at?: string
  /** True when the linked case is older than the staleness window (>12 months) and must be re-run. */
  is_stale?: boolean
  /** Market-implied near-term growth (reverse-DCF of today's price), fraction — the richness read. */
  market_implied_growth?: number
  /** The DCF intrinsic value per share from the linked case — the ladder's top anchor. */
  intrinsic_value_per_share?: number
  /** The registrant's name from the linked case (EDGAR companyfacts); absent on legacy cases. */
  entity_name?: string
}

/**
 * Stale once the linked research case has not been re-run within `STALE_AFTER_MONTHS` months
 * (position-sizing-spec §5 #3: a stale case >12 months cannot generate a tranche alert until re-run).
 */
export const WATCHLIST_STALE_AFTER_MONTHS = 12

/** First non-empty trimmed string — the dossier's verdict-summary fallback chain. */
function firstNonEmptyText(values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

export function enrichWatchlistItemsWithVerdict(
  items: AppWatchlistItem[],
  cases: ResearchCaseProjection[],
  now: Date = new Date(),
  snapshots: Map<string, { price_per_share: number; as_of: string }> = new Map(),
): AppWatchlistItem[] {
  const caseById = new Map(cases.map((c) => [c.research_case_id, c]))
  // OWNER-LOCKED (2026-07-14): zone thresholds are provider OBSERVATIONS, the same class as the
  // refreshing price — so the board displays from the LATEST non-superseded, non-archived case for
  // the ticker, not the (possibly superseded) case the item was admitted on. The admitted-on case id
  // stays on the item as the frozen audit pointer; the confirmed/locked buy-below history is in the
  // ledger. A latest case with NO valuation renders honestly (no thresholds, verdict surfaced) rather
  // than silently keeping the old numbers.
  const latestByTicker = new Map<string, ResearchCaseProjection>()
  for (const c of cases) {
    if (c.ticker === undefined || c.superseded || c.archived) continue
    const best = latestByTicker.get(c.ticker)
    if (best === undefined || c.updated_at > best.updated_at) latestByTicker.set(c.ticker, c)
  }
  return items.map((item) => {
    const linked = (item.ticker === undefined ? undefined : latestByTicker.get(item.ticker))
      ?? caseById.get(item.research_case_id)
    const displayThesis = firstNonEmptyText([linked?.thesis_summary, linked?.evidence_summary, linked?.reason])
    const displayFields = {
      ...(linked?.research_case_id === undefined ? {} : { display_research_case_id: linked.research_case_id }),
      ...(linked?.investment_verdict === undefined ? {} : { latest_analysis_verdict: linked.investment_verdict }),
      ...(linked?.updated_at === undefined ? {} : { latest_analysis_at: linked.updated_at }),
      // Mirror the dossier's verdict-summary chain (thesis → evidence → reason): the newest engine
      // versions leave thesis_summary empty on some paths and the narrative lives downstream.
      ...(displayThesis === undefined ? {} : { latest_analysis_thesis: displayThesis }),
      ...(linked?.shariah_financial?.purification_pct === undefined ? {} : { purification_pct: linked.shariah_financial.purification_pct }),
    }
    const valuation = linked?.valuation
    const buyBelow = valuation?.proposed_buy_below ?? valuation?.buy_price_per_share
    if (valuation === undefined || buyBelow === undefined) {
      return { ...item, ...displayFields }
    }
    // RELIGHTENED DECISION (R1): carry the MODEL's verdict framing — valuation_status, the model-proposed
    // buy-below, the arithmetic in-buy-zone, and the flag-only sanity-check. The retired verdict_state.state
    // still seeds the section grouping for legacy events; new runs no longer emit it.
    const vs = valuation.verdict_state
    const verdict: AppWatchlistVerdict = {
      ...(vs?.state === undefined ? {} : { state: vs.state }),
      ...(linked?.valuation_status === undefined ? {} : { valuation_status: linked.valuation_status }),
      proposed_buy_below: buyBelow,
      buy_price_per_share: buyBelow,
      ...(valuation.reference_fair_value === undefined ? {} : { reference_fair_value: valuation.reference_fair_value }),
      ...(valuation.in_buy_zone === undefined ? {} : { in_buy_zone: valuation.in_buy_zone }),
      ...(valuation.sanity_flags === undefined ? {} : { sanity_flags: valuation.sanity_flags }),
      ...(valuation.market_implied_growth === undefined ? {} : { market_implied_growth: valuation.market_implied_growth }),
    }
    // The ladder anchors + the display name ride the verdict so the board can render the small
    // decision-card view without re-projecting the case.
    const iv = (valuation as { intrinsic_value_per_share?: number }).intrinsic_value_per_share
    if (iv !== undefined) verdict.intrinsic_value_per_share = iv
    if (linked?.entity_name !== undefined) verdict.entity_name = linked.entity_name
    // RULE 8: the load-up threshold — from the linked case when present, else derived from the
    // frozen reference IV (load_up = IV × (1 − load_up_margin); pure arithmetic, same provenance).
    const linkedLoadUp = (linked?.valuation as { load_up_below?: number } | undefined)?.load_up_below
    const frozenIv = (item as { frozen_reference_fair_value?: number }).frozen_reference_fair_value
    const loadUpBelow = linkedLoadUp
      ?? (typeof frozenIv === 'number' && Number.isFinite(frozenIv) && frozenIv > 0
        ? Number((frozenIv * (1 - VALUATION_PARAMS.load_up_margin)).toFixed(2))
        : undefined)
    if (loadUpBelow !== undefined) verdict.load_up_below = loadUpBelow
    if (typeof item.ticker === 'string' && item.ticker.length > 0 && snapshots.has(item.ticker)) {
      const snap = snapshots.get(item.ticker)!
      verdict.market_price_per_share = snap.price_per_share
      verdict.distance_to_buy_pct = ((snap.price_per_share - buyBelow) / buyBelow) * 100
      verdict.in_buy_zone = snap.price_per_share <= buyBelow
      if (loadUpBelow !== undefined) verdict.in_load_up_zone = snap.price_per_share <= loadUpBelow
      verdict.price_as_of = snap.as_of
    }
    const updatedAt = linked?.updated_at
    if (updatedAt !== undefined) {
      verdict.case_updated_at = updatedAt
      const ageMonths = (now.getTime() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
      verdict.is_stale = ageMonths > WATCHLIST_STALE_AFTER_MONTHS
    }
    return { ...item, ...displayFields, verdict }
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

const pendingChecklist: AppGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pending', tone: 'neutral' },
  { label: 'Management alignment', status: 'Pending', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Pending', tone: 'neutral' },
]

export function resolveActiveWorkflowMode(config: Pick<AppConfig, 'mode'>): WorkflowMode {
  return config.mode
}

export type SpawnWorkerPaths = {
  ledgerPath: string
  sourceLedgerPath: string
  /**
   * The app-config file the web app itself resolved. The spawned worker MUST read the same file,
   * otherwise it falls back to the unconfigured default (provider `mock-provider`) and a personal-local
   * run silently executes the mock swarm. This is the load-bearing fix.
   */
  appConfigPath: string
  /** Provider-certification report dir, propagated so the worker's readiness/cert checks match the web app's. */
  providerCertificationDir?: string
}

function defaultSpawnWorker({ ledgerPath, sourceLedgerPath, appConfigPath, providerCertificationDir }: SpawnWorkerPaths): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_research_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
      OWLFOLIO_APP_CONFIG_PATH: appConfigPath,
      ...(providerCertificationDir === undefined ? {} : { OWLFOLIO_PROVIDER_CERTIFICATION_DIR: providerCertificationDir }),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function defaultSpawnDeepDiveWorker({ ledgerPath, sourceLedgerPath, appConfigPath, providerCertificationDir }: SpawnWorkerPaths): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_deep_dive_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
      OWLFOLIO_APP_CONFIG_PATH: appConfigPath,
      ...(providerCertificationDir === undefined ? {} : { OWLFOLIO_PROVIDER_CERTIFICATION_DIR: providerCertificationDir }),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function defaultSpawnDiscoveryWorker({ ledgerPath, sourceLedgerPath, appConfigPath, providerCertificationDir }: SpawnWorkerPaths): void {
  // --define-defaults ensures the discovery_13f scheduled task exists in the ledger before
  // runScheduledTasks selects it (it filters over projectScheduledTasks, i.e. store events, not the
  // in-memory definitions). OWLFOLIO_DISCOVERY_13F_ENABLED=1 (below) means it is defined enabled.
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--define-defaults', '--task-kind', 'discovery_13f'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
      OWLFOLIO_APP_CONFIG_PATH: appConfigPath,
      OWLFOLIO_DISCOVERY_13F_ENABLED: '1',
      ...(providerCertificationDir === undefined ? {} : { OWLFOLIO_PROVIDER_CERTIFICATION_DIR: providerCertificationDir }),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export type EnqueueDiscoveryRunDeps = { spawn?: (paths: SpawnWorkerPaths) => void }

export async function enqueueDiscoveryRun(state: OnboardingState, deps: EnqueueDiscoveryRunDeps = {}): Promise<{ started: true }> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined || state.config.source_ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  ;(deps.spawn ?? defaultSpawnDiscoveryWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
    appConfigPath: resolveAppConfigPath(),
    providerCertificationDir: resolveProviderCertificationReportDir(),
  })
  return { started: true }
}

export async function enqueueResearchRun(
  state: OnboardingState,
  input: { ticker: string; company_id?: string; supersedes_research_case_id?: string; moat_gate_override?: boolean },
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
  const allEvents = await store.list()
  const priorCase = findLatestResearchCaseForTicker(allEvents, ticker)
  const action = selectResearchCaseAction({
    trigger: 'user',
    now: new Date(),
    ...(priorCase !== undefined ? { latestCase: { research_case_id: priorCase.research_case_id, created_at: priorCase.updated_at, version: priorCase.version } } : {}),
  })
  // Supersession: an EXPLICIT re-run target (the dossier's "Re-run on current engine" action) takes
  // precedence over auto-versioning. The new run supersedes the named case and bumps the version off
  // it (so the new dossier is visibly v+1). Absent an explicit target, fall back to the auto-versioning
  // policy (supersede the latest case for the ticker) — today's behavior.
  const explicitSupersedesId = input.supersedes_research_case_id?.trim() || undefined
  const explicitSupersededCase = explicitSupersedesId === undefined
    ? undefined
    : projectResearchCases(allEvents).find((c) => c.research_case_id === explicitSupersedesId)
  const supersedesId = explicitSupersedesId ?? (action === 'create_version' ? priorCase?.research_case_id : undefined)
  const version = explicitSupersedesId !== undefined
    ? (explicitSupersededCase?.version ?? priorCase?.version ?? 0) + 1
    : action === 'create_first' ? 1 : (priorCase?.version ?? 0) + 1
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
        version,
        // Re-run supersession: record WHICH prior case this run supersedes so the production worker
        // (which reads this event off the queue) threads it into the new case's `research_case_created`.
        // Without this the worker would not know to supersede the prior case for an explicit re-run.
        ...(supersedesId === undefined ? {} : { supersedes_research_case_id: supersedesId }),
        // S6: the USER-AUTHORED moat-gate override ("run remaining pillars anyway" on a gated dossier).
        // Recorded on the user-authored request event — the audit trail of WHO chose to spend past the
        // gate — and threaded to the swarm, which skips only the EARLY short-circuit (late rails gate).
        ...(input.moat_gate_override === true ? { moat_gate_override: true } : {}),
        // Defense-in-depth: the request records the provider/mode it was made under so the
        // worker can fail closed if it loads a different config (e.g. silent demo/mock fallback)
        // instead of silently substituting a mock/demo dossier for a real personal-local run.
        expected_provider_id: state.config.provider.provider_id,
        expected_mode: state.config.mode,
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
      const userRequiredReturn = userSetRequiredReturn(state.config.valuation)
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
          ...(input.moat_gate_override === true ? { moat_gate_override: true } : {}),
          // mergeAutomationSettings migrates the retired quick_screen_approval key from older configs.
          deep_dive_approval: mergeAutomationSettings(state.config.automation).deep_dive_approval,
          // model-tiering: file-configured per-role overrides (UI-managed env file = PINS) take effect
          // here, layered OVER the deterministic AUTO defaults (auto fills only unpinned roles).
          model_role_env: await resolveModelRoleEnv(),
          model_overrides: (await buildAutoModelRoleOverrides({ processEnv: process.env })).overrides,
          circle_gate: resolveCircleGateSettings(state.config),
          // F.2: the compliant savings anchor (Settings → Valuation & capital) — same discount on the
          // inline path as the worker paths.
          risk_free_rate: mergeSavingsSleeveConfig(state.config.savings).savings_expected_profit_rate,
          // Phase 4: thread the required return ONLY when user-set (vintage-stamped) — an absent field
          // lets the engine use the book default AND stamp required_return_basis 'book_default' honestly.
          ...(userRequiredReturn === undefined ? {} : { required_return: userRequiredReturn }),
        },
        // Advanced research-depth knob: per-lane grounded-tool-call cap (undefined → loop default).
        { ground, ...(state.config.automation?.research_max_tool_calls === undefined ? {} : { maxToolCalls: state.config.automation.research_max_tool_calls }) },
      )
      return { research_case_id: researchCaseId }
    }
  } finally {
    store.close()
  }

  ;(deps.spawn ?? defaultSpawnWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
    appConfigPath: resolveAppConfigPath(),
    providerCertificationDir: resolveProviderCertificationReportDir(),
  })

  return { research_case_id: researchCaseId }
}

/**
 * Enqueue a research run for an EXISTING case (e.g. a discovery-promoted case that was created but never
 * had a run requested). This is distinct from `enqueueResearchRun` which creates a NEW case. This appends
 * a `research_run_requested` event for the given `caseId` (the case must already exist in the ledger)
 * and spawns the worker to process it.
 */
export async function startResearchRun(
  state: OnboardingState,
  caseId: string,
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

    // Find the existing case.
    const rc = projectResearchCases(events).find((c) => c.research_case_id === caseId)
    if (rc === undefined) {
      throw new Error(`Unknown research case: ${caseId}`)
    }

    // Guard double-start: refuse if a run has already been requested or claimed for this case.
    const alreadyStarted = events.some((e) => {
      if (e.event_type !== 'research_run_requested' && e.event_type !== 'research_run_claimed') return false
      const payload = e.payload
      const payloadCaseId =
        payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>).research_case_id
          : undefined
      const id = typeof payloadCaseId === 'string' && payloadCaseId.length > 0 ? payloadCaseId : e.aggregate_id
      return id === caseId
    })
    if (alreadyStarted) {
      throw new Error(`Research run already started for ${caseId}`)
    }

    const ticker = rc.ticker
    if (ticker === undefined) {
      throw new Error(`Research case ${caseId} has no ticker`)
    }

    const decisionId = `decision_${ticker.toLowerCase()}_${Date.now()}`

    await store.append({
      event_id: `evt_research_run_requested_${caseId}`,
      event_type: 'research_run_requested',
      aggregate_type: 'research_case',
      aggregate_id: caseId,
      correlation_id: caseId,
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        research_case_id: caseId,
        ticker,
        ...(rc.company_id !== undefined ? { company_id: rc.company_id } : {}),
        strategy_id: state.config.strategy_id,
        model_id: resolveModelIdForProvider(state.config),
        requested_by: 'user_local',
        decision_id: decisionId,
        version: rc.version ?? 1,
        expected_provider_id: state.config.provider.provider_id,
        expected_mode: state.config.mode,
      },
      source_ids: [],
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `research-run-request:${caseId}:v1`,
    })
  } finally {
    store.close()
  }

  ;(deps.spawn ?? defaultSpawnWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
    appConfigPath: resolveAppConfigPath(),
    providerCertificationDir: resolveProviderCertificationReportDir(),
  })

  return { research_case_id: caseId }
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
        const userRequiredReturn = userSetRequiredReturn(state.config.valuation)
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
            gate_source_ids: pendingRun.gate_source_ids,
            gate_event_id: pendingRun.gate_event_id,
            // model-tiering: file-configured per-role overrides (PINS) take effect in the deep-dive phase
            // too, layered over the deterministic AUTO defaults (auto fills only unpinned roles).
            model_role_env: await resolveModelRoleEnv(),
            model_overrides: (await buildAutoModelRoleOverrides({ processEnv: process.env })).overrides,
            circle_gate: resolveCircleGateSettings(state.config),
            // Phase 4: the resume path threads the required return like the inline path (user-set only).
            ...(userRequiredReturn === undefined ? {} : { required_return: userRequiredReturn }),
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

  ;(deps.spawn ?? defaultSpawnDeepDiveWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
    appConfigPath: resolveAppConfigPath(),
    providerCertificationDir: resolveProviderCertificationReportDir(),
  })

  return { research_case_id: researchCaseId }
}

/**
 * Append-only ARCHIVE of a stale research run (option-b: hide-without-mutate). Appends a single
 * `research_case_archived` event so the ACTIVE research surfaces (pipeline counts + runs, the research
 * library, the latest-per-ticker resolution) hide the case WITHOUT mutating the append-only ledger. The case
 * STILL PROJECTS + its dossier still renders. Personal-local only; rejects an unknown case. Idempotent — the
 * deterministic idempotency_key makes re-archiving a no-op.
 */
export async function archiveAppResearchCase(
  state: OnboardingState,
  researchCaseId: string,
): Promise<{ research_case_id: string }> {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const researchCase = projectResearchCases(await store.list()).find((c) => c.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }

    await archiveResearchCase(store, {
      research_case_id: researchCaseId,
      reason: 'Archived stale research run from the research surface',
      actor_id: 'user_local',
    })

    return { research_case_id: researchCaseId }
  } finally {
    store.close()
  }
}

// ---------------------------------------------------------------------------------------------------
// B7 (Phase 4, book alignment): the PASSIVE SLEEVE — record a DCA contribution (user-authored,
// append-only; a local record of an index purchase already made elsewhere) + the sleeve view
// (recorded contributions + the active book's value for the drift read). Rule 3 by construction:
// there is no withdrawal helper and no sell affordance anywhere in the sleeve.
// ---------------------------------------------------------------------------------------------------

// SCALE-DOWN S4 (owner-locked 2026-07-13): the passive contribution tracker is REMOVED — the
// passive page is informative only. Legacy passive_contribution events stay readable.

export async function getAppResearchCaseFromStore(
  store: EventStore,
  _mode: WorkflowMode,
  caseId: string,
  sourceLedgerPath?: string,
): Promise<AppResearchCase> {
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
  /** `ticker` (from the projected case or the run-request payload) lets the failed page offer a re-run. */
  | { status: 'failed'; error_summary?: string; ticker?: string }
  | { status: 'unknown' }

const RESEARCH_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'research_run_requested',
  'research_run_claimed',
  'research_run_failed',
])

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The worker's error_summary off a research_run_failed event payload, when present. */
function failureSummaryFrom(event: LedgerEventEnvelope<unknown>): string | undefined {
  const payload = event.payload
  const summary =
    payload !== null && typeof payload === 'object'
      ? (payload as Record<string, unknown>).error_summary
      : undefined
  return typeof summary === 'string' ? summary : undefined
}

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

/**
 * How long a run may sit "requested/claimed but no dossier yet" before the UI stops showing the
 * animated loader and reports a failure instead. A worker that is going to run claims + starts building
 * the case within seconds (even allowing for a cold pnpm/tsx spawn), so a run with NO progress past this
 * window means the worker never started (bad provider/model config, a spawn/env fault, or a crash before
 * the first event). Without this the loader spins forever. Env-overridable; default 180s (6x the normal
 * cold-start headroom). Distinct from the worker-side abandoned-run watchdog, which can only reap cases
 * that already reached `research_case_created` AND only runs when a worker actually ticks.
 */
const DEFAULT_RESEARCH_PENDING_TIMEOUT_MS = 180_000

function resolveResearchPendingTimeoutMs(env: { readonly [key: string]: string | undefined }): number {
  const raw = env.OWLFOLIO_RESEARCH_PENDING_TIMEOUT_MS
  if (raw !== undefined && raw.length > 0) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_RESEARCH_PENDING_TIMEOUT_MS
}

export async function resolveResearchCaseView(
  store: EventStore,
  mode: WorkflowMode,
  caseId: string,
  sourceLedgerPath?: string,
  options: { now?: Date; pendingTimeoutMs?: number } = {},
): Promise<ResearchCaseView> {
  const events = await store.list()

  // 1. Case already created → render the real dossier — UNLESS the run died mid-flight. A
  //    `research_run_failed` on a case that never reached a terminal stage means the worker failed
  //    between `research_case_created` and the dossier (e.g. synthesis validation exhausted); without
  //    this check the ready branch renders the animated progress view FOREVER (the client poller sees
  //    failed, triggers a server re-render, and the server serves the loader again — the ADBE
  //    loading-forever bug). A case that DID reach a terminal stage keeps its dossier: never hide a
  //    completed dossier behind a failed screen.
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase !== undefined) {
    const midRunFailure = events.find(
      (event) => event.event_type === 'research_run_failed' && eventResearchCaseId(event) === caseId,
    )
    if (midRunFailure !== undefined && !isTerminalResearchStage(researchCase.stage)) {
      const summary = failureSummaryFrom(midRunFailure)
      return {
        status: 'failed',
        ...(summary !== undefined ? { error_summary: summary } : {}),
        ...(researchCase.ticker !== undefined ? { ticker: researchCase.ticker } : {}),
      }
    }
    return { status: 'ready', researchCase: await buildPersonalResearchCase(events, researchCase, sourceLedgerPath) }
  }

  // 2. No case yet — inspect the run-lifecycle events for this id to distinguish pending/failed/unknown.
  const runEvents = events.filter(
    (event) => RESEARCH_RUN_EVENT_TYPES.has(event.event_type) && eventResearchCaseId(event) === caseId,
  )
  if (runEvents.length === 0) {
    return { status: 'unknown' }
  }

  // Ticker recovered from any run-lifecycle payload (research_run_requested carries it) so a failed
  // view can offer a re-run even when the case row was never created.
  const runTicker = runEvents
    .map((event) => (isRecordValue(event.payload) ? event.payload.ticker : undefined))
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  const failed = runEvents.find((event) => event.event_type === 'research_run_failed')
  if (failed !== undefined) {
    const summary = failureSummaryFrom(failed)
    return {
      status: 'failed',
      ...(summary !== undefined ? { error_summary: summary } : {}),
      ...(runTicker !== undefined ? { ticker: runTicker } : {}),
    }
  }

  // requested/claimed but not yet created → the worker should be building the case. Guard against an
  // infinite loader: if the newest run event is older than the start-timeout, the worker never started (or
  // died before its first event) — fail closed with a reason instead of spinning forever.
  const pendingTimeoutMs = options.pendingTimeoutMs ?? resolveResearchPendingTimeoutMs(process.env)
  const nowMs = (options.now ?? new Date()).getTime()
  const latestRunEventMs = runEvents.reduce((newest, event) => {
    const ms = new Date(event.created_at).getTime()
    return Number.isFinite(ms) && ms > newest ? ms : newest
  }, 0)
  if (latestRunEventMs > 0 && nowMs - latestRunEventMs > pendingTimeoutMs) {
    const minutes = Math.max(1, Math.round((nowMs - latestRunEventMs) / 60_000))
    return {
      status: 'failed',
      error_summary: `The research worker did not start or produce a dossier (no progress for ${minutes} min). This usually means the worker could not run — check the provider and model in Settings, then start a new run.`,
      ...(runTicker !== undefined ? { ticker: runTicker } : {}),
    }
  }

  return { status: 'pending' }
}

export async function getAppWatchlistItemsFromStore(
  store: EventStore,
  _mode: WorkflowMode,
): Promise<AppWatchlistItem[]> {
  return buildPersonalWatchlistItems(await store.list())
}

export async function getAppResearchPipelineFromStore(
  store: EventStore,
  _mode: WorkflowMode,
  selectedStrategyId: string,
): Promise<AppResearchPipeline> {
  const events = await store.list()
  const researchCases = projectResearchCases(events)
  const watchlistItems = buildPersonalWatchlistItems(events)
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
        // The board key stays 'quick-screen' for UI/e2e stability; it now renders the FRONT GATES
        // column (Shariah gate + circle gate, plus legacy quick-screened cases).
        key: 'quick-screen',
        title: 'Front Gates',
        empty_message: 'No companies are waiting in or exiting the front gates.',
        items: [
          ...selectedDiscoveryCandidates
            .filter((candidate) => candidate.status === 'queued_for_quick_screen')
            .map(candidateToPipelineItem),
          ...selectedResearchCases
            .filter((researchCase) => researchCase.stage === 'shariah_gate_judged' || researchCase.stage === 'quick_screened' || researchCase.stage === 'awaiting_deep_dive_approval')
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

    // REVIEW-AND-PROMOTE provenance (entirely SERVER-SOURCED, never client-authored). The human's explicit
    // "Promote" click is the commitment; we no longer require them to re-author a thesis or tick a checklist.
    //  - signed_thesis: sourced from the agent draft (resolveAdmissionThesisDraft) so the ledger event still
    //    carries a non-empty thesis for provenance. Falls back to the case reason / a synthesized line if the
    //    draft is ever empty (it normally is not — the resolver has its own fallbacks).
    //  - signed_thesis_draft: the SAME value, so `thesis_amended` derives false (no human amendment occurred).
    //  - checklist_audit: the server-marshaled business findings (a pure read of THIS case's projection) are
    //    recorded for the audit trail, NOT as a gate. cognitive_acknowledged is HONESTLY false — no human
    //    reflection was required by this flow (confirmWatchlistDraft no longer blocks on it).
    const agentThesisDraft = resolveAdmissionThesisDraft(researchCase)
    const serverSignedThesis = agentThesisDraft.trim().length > 0
      ? agentThesisDraft
      : researchCase.reason ?? 'Promoted to watchlist after review'
    const checklistAudit: ChecklistAudit = {
      version: CHECKLIST_PARAMS.version,
      business_findings: resolveBusinessFindings(researchCase),
      cognitive_acknowledged: false,
    }

    // FREEZE the buy-below at admit (Task 4.2b): snapshot the Phase-1 valuation buy-below and record the
    // MoS/valuation version it was frozen under. The MoS is still PROVISIONAL (#124), so a future MoS
    // freeze that changes the number is a VISIBLE, logged re-price — never a silent move on the locked
    // thesis. Fall back to the verdict-band buy-below / 0 when the case has no valuation buy-below yet.
    const lockedBuyBelow = researchCase.valuation?.buy_price_per_share ?? 0

    // E2: FREEZE the BOOK intrinsic value at sign-off — the computed FCF reference the method margins
    // off, snapshotted verbatim (no recompute, no owner-earnings derive). The lightened valuation-
    // inverted SELL is a LIGHT price-vs-this-reference sanity FLAG (advisory; the human decides).
    // FAIL-CLOSED: an unpriced case freezes `undefined` and the sell returns cannot_assess. Legacy
    // events keep their persisted OE-derived references (read-only).
    const frozenIntrinsicValue = researchCase.valuation?.intrinsic_value_per_share
    const hasFrozenReference = frozenIntrinsicValue !== undefined

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
      ...(frozenIntrinsicValue === undefined ? {} : { frozen_reference_fair_value: frozenIntrinsicValue }),
      // The version provenance is the sign-off valuation provenance; recorded whenever the reference can be
      // derived.
      ...(hasFrozenReference ? { frozen_iv_valuation_version: VALUATION_PARAMS.version } : {}),
      signed_thesis: serverSignedThesis,
      signed_thesis_draft: serverSignedThesis,
      checklist_audit: checklistAudit,
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
 * Build the admit cite-check's VERIFIED set from content-hash-confirmed sources only — the exact mirror
 * of the swarm primitive (researchSwarm.ts: a captured-but-unverified source whose `content_hash` is
 * undefined is SKIPPED). A failed-fetch source_id present in the case corpus must NOT satisfy the
 * decisive permanent_loss_risk / uncertainty citation. A source counts as verified iff a source-ledger
 * record for that source_id carries a `content_hash` (and is not explicitly `unavailable`). For each such
 * source both its `source_id` and its `content_hash` enter the set, because a lane may cite by either.
 *
 * `corpusSourceIds` only scopes which ids are eligible (the ids the case actually accumulated); records
 * are the source of truth for verification. Ids with no verified record never enter the set.
 */
export function buildAdmitVerifiedCitationSet(
  corpusSourceIds: readonly string[],
  records: readonly { source_id: string; content_hash?: string; availability?: SourceLedgerBundle['records'][number]['availability'] }[],
): Set<string> {
  const eligible = new Set(corpusSourceIds)
  const verified = new Set<string>()
  for (const record of records) {
    if (!eligible.has(record.source_id)) continue
    // Mirror the swarm primitive: skip unless content-hash-confirmed (and not an explicit failed fetch).
    if (record.content_hash === undefined) continue
    if (record.availability === 'unavailable') continue
    verified.add(record.source_id)
    verified.add(record.content_hash)
  }
  return verified
}

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

    // The corpus the judgment may cite from = the case's accumulated source_ids (for the prompt framing).
    // The CITE-CHECK set, however, must admit ONLY content-hash-VERIFIED sources — mirroring the swarm
    // primitive (researchSwarm.ts: skip when content_hash === undefined). A captured-but-unverified
    // source_id (fetch failed: SSRF/404/redirect-exhausted/network → record persisted with NO content_hash)
    // must NOT satisfy the decisive permanent_loss_risk / uncertainty citation. We read the verified status
    // from the SOURCE LEDGER (the source of truth that carries content_hash / availability per source),
    // not from the raw timeline source_ids (which carry no verification).
    const timeline = projectResearchCaseTimeline(events, researchCaseId)
    const corpusSourceIds = [...new Set(timeline.flatMap((entry) => entry.source_ids))]
    const sourceBundle = state.config.source_ledger_path === undefined
      ? undefined
      : await readSourceBundle(state.config.source_ledger_path, researchCaseId)
    const verifiedCitationHashes = buildAdmitVerifiedCitationSet(corpusSourceIds, sourceBundle?.records ?? [])

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

export type RunReReviewDeps = {
  /** Override the provider (test fake). Defaults to the configured provider. */
  provider?: ReturnType<typeof resolveProvider>
  /** Override the grounding fn (test). Defaults to the provider-appropriate live grounder. */
  ground?: GroundFn
  /** Injectable EDGAR resolver for the trigger check (test fixture). */
  fetchFundamentals?: CheckForNewFilingsDeps['fetchFundamentals']
  /** Injectable per-document Form 4 fetch for the insider-cluster trigger (test fixture). */
  fetchForm4Document?: CheckForNewFilingsDeps['fetchForm4Document']
}

export type RunReReviewOutcome =
  | { status: 'recorded'; re_review: ThesisReReviewRecordedPayload; insider_cluster?: InsiderClusterTrigger; new_annual_filing?: FilingRef }
  | { status: 'no_recorded_thesis' }
  | { status: 'no_prior_corpus' }
  | { status: 'no_new_filings'; checked_at: string; insider_cluster?: InsiderClusterTrigger; new_annual_filing?: FilingRef }
  | { status: 'fundamentals_unresolved' }

/**
 * On-demand thesis RE-REVIEW for a research case (Phase 1 of the re-review method):
 *   1. TRIGGER — checkForNewFilings diffs discovery-now against the persisted source-ledger corpus the
 *      decision stood on (fail-closed: a missing bundle is `no_prior_corpus`, never a fabricated delta).
 *   2. PASS — draftThesisReReview grounds the delta and compares it against the RECORDED thesis
 *      (thesis_summary, key_wrong_assumption, every thesis_break_trigger), emitting a DIFF observation
 *      (`research_case_re_review_recorded`): INTACT | WEAKENED | BROKEN | UNVERIFIED (fail-closed).
 * ZERO provider spend on every non-`recorded` outcome. Never a verdict, never a transition — a BROKEN
 * diff points the human at the existing "Re-run on current engine" supersession action.
 */
export async function runResearchCaseReReview(
  state: OnboardingState,
  researchCaseId: string,
  deps: RunReReviewDeps = {},
): Promise<RunReReviewOutcome> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  const sourceLedgerPath = state.config.source_ledger_path
  if (sourceLedgerPath === undefined) {
    throw new Error('Re-review requires a configured source_ledger_path (the persisted decision corpus).')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const prior = loadPriorThesis(events, researchCaseId)
    if (prior === undefined) {
      return { status: 'no_recorded_thesis' }
    }
    const ticker = prior.ticker
    if (ticker === undefined) {
      return { status: 'no_recorded_thesis' }
    }

    const check = await checkForNewFilings(
      {
        ticker,
        research_case_id: researchCaseId,
        source_ledger_path: sourceLedgerPath,
        // The delta is "filed SINCE the decision" — without this bound the entire unread filing
        // history looks new (the corpus only holds what the run read).
        ...(prior.decided_at === undefined ? {} : { since: prior.decided_at }),
      },
      deps.fetchFundamentals === undefined && deps.fetchForm4Document === undefined
        ? undefined
        : {
            ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
            ...(deps.fetchForm4Document === undefined ? {} : { fetchForm4Document: deps.fetchForm4Document }),
          },
    )
    if (check === undefined) {
      return { status: 'fundamentals_unresolved' }
    }
    if (check.no_prior_corpus) {
      return { status: 'no_prior_corpus' }
    }
    // A threshold-meeting insider-selling cluster (§3.3) is a STRONG signal in its own right — surface it
    // even when there are no new conventional filings, rather than silently reporting "no new filings".
    const insiderCluster = check.insider_cluster?.meets_threshold === true ? check.insider_cluster : undefined
    // 10-K CADENCE (owner-approved 2026-07-14): a new ANNUAL filing resets everything the valuation
    // stands on — the check-in is the wrong tool for it. Record a deterministic zero-spend detection
    // OBSERVATION (idempotent per filing) so the monitor raises "full re-analysis recommended" with
    // the one-click superseding re-run. Never auto-runs — the re-run spend stays user-authored.
    const annual = check.new_annual_filing
    if (annual !== undefined) {
      const formSlug = annual.form.toLowerCase().replace(/[^a-z0-9]/g, '')
      await store.append({
        event_id: `evt_annual_filing_${researchCaseId}_${formSlug}_${annual.filed}`,
        event_type: 'research_case_annual_filing_detected',
        aggregate_type: 'research_case',
        aggregate_id: researchCaseId,
        correlation_id: researchCaseId,
        causation_id: researchCaseId,
        actor_type: 'system',
        actor_id: 'research_workflow',
        payload: {
          research_case_id: researchCaseId,
          ticker,
          form: annual.form,
          filed: annual.filed,
          url: annual.url,
          checked_at: check.checked_at,
          is_observation: true,
        },
        source_ids: [],
        created_at: check.checked_at,
        schema_version: 1,
        idempotency_key: `annual_filing_${researchCaseId}_${formSlug}_${annual.filed}`,
      })
    }
    if (check.new_filings.length === 0) {
      return {
        status: 'no_new_filings',
        checked_at: check.checked_at,
        ...(insiderCluster === undefined ? {} : { insider_cluster: insiderCluster }),
        ...(annual === undefined ? {} : { new_annual_filing: annual }),
      }
    }

    const provider = deps.provider ?? resolveProvider({ provider_id: state.config.provider.provider_id })
    const recorded = await draftThesisReReview(store, provider, {
      research_case_id: researchCaseId,
      model_id: resolveModelIdForProvider(state.config),
      causation_id: researchCaseId,
      source_ledger_path: sourceLedgerPath,
      check,
    }, deps.ground === undefined ? {} : { ground: deps.ground })

    return {
      status: 'recorded',
      re_review: recorded.payload,
      ...(insiderCluster === undefined ? {} : { insider_cluster: insiderCluster }),
      ...(annual === undefined ? {} : { new_annual_filing: annual }),
    }
  } finally {
    store.close()
  }
}

function asRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

// SCALE-DOWN S1 (owner-locked 2026-07-13): the on-demand sizing recommendation is REMOVED —
// zones tell you when; the size is yours. Legacy sizing_recommendation events stay readable.

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
 *   - the HELD name's lifecycle row (nameLifecycle): holding_id, ticker, opened_at, frozen_reference_fair_value (sign-off
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

    // The sign-off-frozen inputs are READ FROM THE PROJECTION (scope-reframe), NEVER recomputed here
    // (don't-move-the-number F.9/F.10): the REFERENCE fair value the lightened valuation-inverted sell FLAG
    // compares the live price against + the oe_ps. The frozen reference is also the anchoring guard's price
    // anchor.
    const frozenOePs = lifecycle.frozen_oe_ps
    const frozenReferenceFairValue = lifecycle.frozen_reference_fair_value

    const assemblerArgs: SellAssessmentArgs = {
      trigger: input.trigger,
      opened_at: lifecycle.opened_at,
      now: new Date().toISOString(),
      current_price: currentPrice,
      cost_basis_per_share: costBasisPerShare,
      uncertainty: uncertaintyLevel,
      permanent_loss_risk: permanentLossLevel,
      quality_verdict_passes: qualityVerdictPasses,
      frozen_oe_ps: frozenOePs,
      frozen_reference_fair_value: frozenReferenceFairValue,
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
        reason: `cannot assess the ${input.trigger} sell trigger for ${heldTicker} (e.g. no sign-off-frozen band/oe_ps for valuation_inverted, or missing candidate/held yields for better_opportunity).`,
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
      frozen_oe_ps: rec.frozen_oe_ps,
      frozen_reference_fair_value: rec.frozen_reference_fair_value,
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
        ...(rec.frozen_oe_ps === undefined ? {} : { frozen_oe_ps: rec.frozen_oe_ps }),
        ...(rec.frozen_reference_fair_value === undefined
          ? {}
          : { frozen_reference_fair_value: rec.frozen_reference_fair_value }),
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
      return 'Queue for research'
    case 'queued_for_quick_screen':
      return 'Run the selected-strategy research (front gates first)'
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
      return 'Run the selected-strategy research (front gates first)'
    case 'shariah_gate_judged':
      return 'Shariah gate judged; research in progress'
    case 'quick_screened': // legacy (pre-restructure) cases
      return researchCase.screening_result === 'deep_dive_candidate'
        ? 'Send to deep dive queue'
        : 'Review quick screen outcome'
    case 'awaiting_deep_dive_approval':
      return 'Review the gate outcomes and click "Run deep dive" to start the swarm'
    case 'queued_for_deep_dive':
      return 'Start deep dive'
    case 'circle_competence_judged':
      return 'Circle-of-competence judged; deep dive in progress'
    case 'deep_dive_started':
    case 'specialist_finding_recorded':
    case 'deep_dive_in_progress':
      return 'Record specialist findings and draft synthesis'
    case 'valuation_judgment_drafted':
      return 'Valuation judgment drafted; synthesis in progress'
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
    case 'failed':
      return 'Run failed mid-flight — open the case for the error and re-run'
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

/**
 * Remove a name from the watchlist (the human-authored prune — watchlist_item_pruned). The item
 * leaves every active view; the raw events remain the audit record. A held name cannot be pruned —
 * close the holding first (the position is the stronger commitment).
 */
export async function removePersonalWatchlistItem(
  state: OnboardingState,
  watchlistItemId: string,
  input: { reason?: unknown } = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  const reason = typeof input.reason === 'string' && input.reason.trim().length > 0
    ? input.reason.trim()
    : 'Removed from the watchlist by the user.'

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const item = buildPersonalWatchlistItems(events).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (item === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }
    if (item.holding_id !== undefined) {
      throw new Error(`Watchlist item is held: close the holding before removing ${watchlistItemId}`)
    }
    return await pruneWatchlistItem(store, {
      watchlist_item_id: watchlistItemId,
      ticker: item.ticker ?? item.company_id ?? watchlistItemId,
      ...(item.research_case_id === undefined ? {} : { research_case_id: item.research_case_id }),
      reason,
      actor_type: 'user',
      actor_id: 'user_local',
      idempotency_key: `watchlist:${watchlistItemId}:prune:v1`,
    })
  } finally {
    store.close()
  }
}

const CLOSE_REASON_CODES = new Set(['thesis_broken', 'valuation_inverted', 'better_opportunity_under_constraint', 'original_mistake', 'minimum_hold_released', 'unresolvable_shariah_breach'])

/**
 * Close a holding (the human-authored, irreversible exit — holding_closed). The position leaves
 * every active view (and its watchlist item returns to plain watching); the raw events + any
 * post-mortem remain the audit record.
 */
export async function closePersonalHolding(
  state: OnboardingState,
  holdingId: string,
  input: { exit_price_per_share?: unknown; closed_at?: unknown; reason_code?: unknown; message?: unknown } = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  const exitPrice = Number(input.exit_price_per_share)
  if (!Number.isFinite(exitPrice) || exitPrice < 0) {
    throw new Error('Exit price per share must be a non-negative number')
  }
  const reasonCode = typeof input.reason_code === 'string' && CLOSE_REASON_CODES.has(input.reason_code)
    ? input.reason_code as 'thesis_broken' | 'valuation_inverted' | 'better_opportunity_under_constraint' | 'original_mistake' | 'minimum_hold_released' | 'unresolvable_shariah_breach'
    : undefined
  if (reasonCode === undefined) {
    throw new Error('Close reason is required (pick one of the sell-discipline reasons)')
  }
  const closedAt = typeof input.closed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.closed_at) ? input.closed_at : undefined
  const message = typeof input.message === 'string' && input.message.trim().length > 0 ? input.message.trim() : undefined

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const holding = projectHoldings(events).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      throw new Error(`Unknown holding: ${holdingId}`)
    }
    return await closeHolding(store, {
      holding_id: holdingId,
      exit_price_per_share: exitPrice,
      reason_code: reasonCode,
      ...(closedAt === undefined ? {} : { closed_at: closedAt }),
      ...(message === undefined ? {} : { message }),
      actor_type: 'user',
      actor_id: 'user_local',
      idempotency_key: `holding:${holdingId}:close:v1`,
    })
  } finally {
    store.close()
  }
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

  // For real providers, fall back to the catalog's curated default model for the selected provider
  // (e.g. openrouter/auto, gpt-5.5, claude-sonnet-4-6, gemini-3.5-flash) rather than a single hard-coded id.
  const entry = getProviderCatalog().find((candidate) => candidate.provider_id === config.provider.provider_id)
  return entry?.default_model_id ?? 'openrouter/auto'
}

/**
 * On-demand price refresh for all tracked tickers (user-approved watchlist items + open holdings).
 * Personal-local only. Opens and closes the SQLiteEventStore around the operation.
 */
export async function refreshPrices(state: OnboardingState, deps: RunPriceRefreshDeps = {}): Promise<PriceRefreshResult> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  const store = new SQLiteEventStore(state.config.ledger_path)
  try { return await runPriceRefresh(store, deps) } finally { store.close() }
}

export type { PriceRefreshResult, RunPriceRefreshDeps }

export type ResearchLedgerResetSummary = {
  cleared_events: number
}

/**
 * DESTRUCTIVE dev/test-only wholesale clear of the active local ledger + source bundles.
 *
 * Honest scope: this clears the WHOLE active ledger at `state.config.ledger_path` — not just research
 * runs. The append-only `SQLiteEventStore` has no per-aggregate delete, and a partial rebuild would risk
 * dangling references (holdings/capital/watchlist events reference research cases and each other), so this
 * truncates the entire `ledger_events` table. App configuration is PRESERVED: the environment stays
 * configured (same mode/provider/paths); only the event/ledger state is wiped.
 *
 * Live-safe by design: the dev server holds the sqlite file open, so we must NOT unlink the file. We open
 * the DB directly with `DatabaseSync` and `DELETE` the rows (and reset `sqlite_sequence` so a fresh ledger
 * starts at sequence 1), then close — leaving a valid, immediately-appendable empty ledger.
 *
 * This is SEPARATE from the append-only single-run archive (`archiveAppResearchCase`); it is the gated
 * wholesale clear, guarded here as defense-in-depth even though the route also gates.
 */
export async function resetResearchLedgerState(
  state: OnboardingState,
  { env }: { env: DevToolsEnv },
): Promise<ResearchLedgerResetSummary> {
  if (!isResearchResetEnabled({ env, mode: state.config.mode })) {
    throw new Error('Research/ledger reset is not enabled in this environment')
  }

  const ledgerPath = state.config.ledger_path
  if (ledgerPath === undefined) {
    // Uninitialized environment: nothing to clear. Harmless success.
    return { cleared_events: 0 }
  }

  const db = new DatabaseSync(ledgerPath)
  let clearedEvents: number
  try {
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM ledger_events').get() as { count: number } | undefined
    clearedEvents = countRow?.count ?? 0

    db.exec('DELETE FROM ledger_events')

    // Reset the AUTOINCREMENT counter so a re-seeded ledger starts at sequence 1. sqlite_sequence only
    // exists once an AUTOINCREMENT row has been inserted; tolerate its absence on a never-written ledger.
    try {
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run('ledger_events')
    } catch {
      /* no sqlite_sequence row yet — nothing to reset */
    }
  } finally {
    db.close()
  }

  // Clear the source-ledger bundle directory CONTENTS (keep the directory itself so the configured path
  // stays valid for the next run).
  const sourceLedgerPath = state.config.source_ledger_path
  if (sourceLedgerPath !== undefined && sourceLedgerPath.length > 0) {
    const entries = await readdir(sourceLedgerPath).catch(() => [] as string[])

    await Promise.all(
      entries.map((entry) => rm(join(sourceLedgerPath, entry), { force: true, recursive: true })),
    )
  }

  return { cleared_events: clearedEvents }
}

function personalLocalStore(state: OnboardingState): SQLiteEventStore {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  return new SQLiteEventStore(state.config.ledger_path)
}

export async function acceptDiscoveryCandidate(state: OnboardingState, candidateId: string): Promise<void> {
  const store = personalLocalStore(state)
  try {
    await queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: candidateId,
      queue_id: `queue_${candidateId}_${Date.now()}`,
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
  } finally {
    store.close()
  }
}

export async function rejectDiscoveryCandidate(state: OnboardingState, candidateId: string, reason: string): Promise<void> {
  const store = personalLocalStore(state)
  try {
    await rejectDiscoveryCandidateEvent(store, {
      candidate_id: candidateId,
      reason: reason.trim() || 'Rejected from discovery triage',
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
  } finally {
    store.close()
  }
}

export async function promoteDiscoveryCandidate(state: OnboardingState, candidateId: string): Promise<{ research_case_id: string }> {
  const store = personalLocalStore(state)
  try {
    const candidate = projectDiscoveryCandidates(await store.list()).find((c) => c.candidate_id === candidateId)
    if (candidate === undefined) throw new Error(`Discovery candidate ${candidateId} not found`)
    const researchCaseId = `rc_${candidate.ticker.toLowerCase()}_${Date.now()}`
    await promoteDiscoveryCandidateToResearchCase(store, {
      candidate_id: candidateId,
      research_case_id: researchCaseId,
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
    return { research_case_id: researchCaseId }
  } finally {
    store.close()
  }
}
