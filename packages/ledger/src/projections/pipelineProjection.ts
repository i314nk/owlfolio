import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases, type ResearchCaseProjection } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'
import { projectHoldings } from './holdingProjection'

/**
 * Pipeline observability projection.
 *
 * Pure, read-only view-model that makes the autonomous research swarm and the
 * whole workflow legible from the audit ledger. It introduces no new events and
 * derives every count/status from existing research-case, watchlist and holding
 * projections plus the raw event stream (for per-run timelines + lane timing).
 */

/**
 * The canonical Buffett-Munger deep-dive specialist lanes (kept in sync with the strategy set).
 * Valuation is NOT a parallel lane — it is a dedicated focused pass run during synthesis.
 * See: packages/workflow/src/strategyResearchPipeline.ts (buffettMungerDeepDiveLanes).
 * The drift-guard test in __tests__/pipelineSpecialistLanesSync.test.ts catches any divergence.
 */
export const PIPELINE_SPECIALIST_LANES = [
  'business_quality',
  'moat',
  'management',
  'financial_quality',
  'risks',
] as const

export type PipelineStageKey =
  | 'shariah_gate'
  | 'deep_dive'
  | 'synthesis'
  | 'decision'
  | 'watchlist'
  | 'holding'
  | 'review'

export type PipelineStageHealth = 'ok' | 'warn' | 'err'

export type PipelineStageCount = {
  key: PipelineStageKey
  label: string
  count: number
  health: PipelineStageHealth
}

export type PipelineRunStatus = 'running' | 'awaiting_approval' | 'done' | 'rejected' | 'failed'

export type PipelineRun = {
  research_case_id: string
  ticker: string
  version: number
  stage_label: string
  status: PipelineRunStatus
  verdict?: string
  source_count: number
  started_at: string
  updated_at: string
}

export type PipelineFailedRun = {
  case_id: string
  ticker: string
  failed_at: string
  error_summary?: string
}

export type PipelineSummary = {
  active_runs: number
  awaiting_approval: number
  failed_recent: number
  grounded_sources: number
}

export type PipelineLaneStatus = 'done' | 'running' | 'pending'

export type PipelineLane = {
  lane: string
  label: string
  status: PipelineLaneStatus
  source_count: number
  duration_ms?: number
}

export type PipelineTimelineEntry = {
  event_type: string
  label: string
  at: string
}

export type PipelineDrillDown = {
  research_case_id: string
  ticker: string
  version: number
  status: PipelineRunStatus
  lanes: PipelineLane[]
  grounded_source_ids: string[]
  timeline: PipelineTimelineEntry[]
}

export type PipelineProjection = {
  stage_counts: PipelineStageCount[]
  summary: PipelineSummary
  runs: PipelineRun[]
  failed_runs?: PipelineFailedRun[]
  snapshot_at?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

const LANE_LABELS: Record<string, string> = {
  business_quality: 'Business quality',
  moat: 'Moat',
  management: 'Management',
  financial_quality: 'Financial quality',
  shariah: 'Shariah',
  risks: 'Risks',
  valuation: 'Valuation',
}

function laneLabel(lane: string): string {
  return LANE_LABELS[lane] ?? lane.replace(/_/g, ' ')
}

/** Stages that count as "in deep dive" for the run/stage derivations. */
const DEEP_DIVE_STAGES = new Set<ResearchCaseProjection['stage']>([
  'deep_dive_started',
  'specialist_finding_recorded',
  'deep_dive_in_progress',
])

const SYNTHESIS_STAGES = new Set<ResearchCaseProjection['stage']>([
  'deep_dive_synthesis_drafted',
  'deep_dive_completed',
  'deep_dive_complete',
  'analysis_drafted',
])

const DECISION_STAGES = new Set<ResearchCaseProjection['stage']>([
  'decision_pending',
  'decision_drafted',
  'pass',
])

function runStatusForCase(researchCase: ResearchCaseProjection): PipelineRunStatus {
  const stage = researchCase.stage
  if (stage === 'rejected') {
    return 'rejected'
  }
  if (stage === 'awaiting_deep_dive_approval') {
    return 'awaiting_approval'
  }
  if (stage === 'queued_for_deep_dive' || DEEP_DIVE_STAGES.has(stage)) {
    return 'running'
  }
  return 'done'
}

function stageLabelForCase(
  researchCase: ResearchCaseProjection,
  recordedLaneCount: number,
): string {
  const stage = researchCase.stage
  switch (stage) {
    case 'discovered':
      return 'Discovered'
    case 'shariah_gate_judged':
      return 'Shariah gate'
    case 'quick_screened': // legacy (pre-restructure) cases
      return 'Quick screen'
    case 'awaiting_deep_dive_approval':
      return 'Awaiting deep-dive approval'
    case 'queued_for_deep_dive':
      return 'Deep dive (queued)'
    case 'circle_competence_judged':
      return 'Circle of competence'
    case 'deep_dive_started':
    case 'specialist_finding_recorded':
    case 'deep_dive_in_progress':
      return `Deep dive (${recordedLaneCount}/${PIPELINE_SPECIALIST_LANES.length} lanes)`
    case 'deep_dive_synthesis_drafted':
      return 'Synthesis'
    case 'deep_dive_completed':
    case 'deep_dive_complete':
      return 'Deep dive complete'
    case 'analysis_drafted':
      return 'Analysis'
    case 'decision_pending':
    case 'decision_drafted':
      return 'Decision'
    case 'pass':
      return 'Passed'
    case 'rejected':
      return 'Rejected'
    case 'watchlist_draft':
      return 'Watchlist (draft)'
    case 'watchlist':
      return 'Watchlist'
    case 'holding':
      return 'Holding'
    default:
      return stage
  }
}

function rejectionReason(researchCase: ResearchCaseProjection): string | undefined {
  // Prefer an explicit Shariah block when present, else the screening/decision reason.
  if (researchCase.shariah_status !== undefined && /reject|prohib|fail/i.test(researchCase.shariah_status)) {
    return 'Shariah'
  }
  return researchCase.reason ?? researchCase.next_required_action
}

function countSourceIds(researchCase: ResearchCaseProjection): number {
  const ids = new Set<string>()
  for (const finding of researchCase.specialist_findings ?? []) {
    for (const sourceId of finding.source_ids ?? []) {
      ids.add(sourceId)
    }
  }
  for (const sourceId of researchCase.owner_earnings_valuation?.sources ?? []) {
    ids.add(sourceId)
  }
  return ids.size
}

/**
 * Builds the recent-runs list. A "run" is a research case that has at least
 * started the swarm (quick screen requested/drafted onward). Ordered most-recent first.
 */
function buildRuns(researchCases: ResearchCaseProjection[], failedCaseIds: ReadonlySet<string>): PipelineRun[] {
  const runs: PipelineRun[] = []
  for (const researchCase of researchCases) {
    if (researchCase.superseded || researchCase.archived) {
      continue
    }
    // Only surface cases that have entered the swarm pipeline (have a ticker + a stage past discovery).
    if (researchCase.ticker === undefined) {
      continue
    }
    if (researchCase.stage === 'discovered') {
      continue
    }

    const recordedLaneCount = new Set(
      (researchCase.specialist_findings ?? [])
        .map((finding) => finding.specialist_lane)
        .filter((lane): lane is string => lane !== undefined),
    ).size

    // A recorded run-failure (order-aware, with no later recovery) terminates the run: the failure is
    // recorded (Faults), but its partial in-progress research is DISCARDED from the active view — a failed
    // case must NOT read as a running deep-dive/quick-screen just because its pre-failure stage lingers.
    const status: PipelineRunStatus = failedCaseIds.has(researchCase.research_case_id)
      ? 'failed'
      : runStatusForCase(researchCase)
    const run: PipelineRun = {
      research_case_id: researchCase.research_case_id,
      ticker: researchCase.ticker,
      version: researchCase.version,
      stage_label: stageLabelForCase(researchCase, recordedLaneCount),
      status,
      source_count: countSourceIds(researchCase),
      started_at: researchCase.updated_at,
      updated_at: researchCase.updated_at,
    }

    const verdict = researchCase.investment_verdict ?? researchCase.decision
    if (status === 'done' && verdict !== undefined) {
      run.verdict = verdict
    }
    if (status === 'rejected') {
      const reason = rejectionReason(researchCase)
      if (reason !== undefined) {
        run.verdict = reason
      }
    }

    runs.push(run)
  }

  return runs.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
}

/**
 * Forward-progress events that, when they occur AFTER a `research_run_failed`,
 * mean the run genuinely recovered (was re-run and advanced) rather than having
 * stalled at the failure. A failure followed by no such event is a genuine
 * recent failure — including a watchdog-abandoned run that progressed and then
 * failed (the failure is its latest lifecycle state, not "recovered").
 */
const RUN_RECOVERY_EVENT_TYPES = new Set<string>([
  'shariah_gate_judged',
  'quick_screen_drafted', // legacy (pre-restructure) runs
  'deep_dive_started',
  'specialist_finding_recorded',
  'deep_dive_synthesis_drafted',
  'deep_dive_completed',
  'buffett_munger_analysis_drafted',
  'decision_drafted',
])

/**
 * A `research_run_failed` event is a recent failure only if it is the case's
 * latest lifecycle state — i.e. no forward-progress event for the same case
 * occurs after it. Recovery is ORDER-AWARE: iterating in append order, a failure
 * is recorded on `research_run_failed` and cleared by any later progress event,
 * so progressed-then-abandoned runs correctly remain failed while
 * failed-then-re-run runs correctly drop out.
 * Returns both the count and the structured failed run entries.
 */
function collectRecentFailures(events: LedgerEventEnvelope<unknown>[]): { count: number; failed_runs: PipelineFailedRun[] } {
  const latestFailureByCase = new Map<string, PipelineFailedRun>()
  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }
    const caseId = getString(event.payload, 'research_case_id') ?? event.correlation_id ?? event.aggregate_id
    if (event.event_type === 'research_run_failed') {
      const ticker = getString(event.payload, 'ticker') ?? caseId
      const errorSummary = getString(event.payload, 'error_summary')
      const failedAt = getString(event.payload, 'failed_at') ?? event.created_at
      latestFailureByCase.set(caseId, { case_id: caseId, ticker, failed_at: failedAt, ...(errorSummary !== undefined ? { error_summary: errorSummary } : {}) })
    } else if (RUN_RECOVERY_EVENT_TYPES.has(event.event_type)) {
      // Forward progress AFTER a recorded failure clears it (genuine recovery).
      // Progress BEFORE a failure leaves nothing to clear, so a later failure stays.
      latestFailureByCase.delete(caseId)
    }
  }
  const failed_runs = [...latestFailureByCase.values()]
  return { count: failed_runs.length, failed_runs }
}

export function projectPipeline(events: LedgerEventEnvelope<unknown>[]): PipelineProjection {
  const researchCases = projectResearchCases(events)
  // ACTIVE view = non-superseded AND non-archived. Archived runs (option-b append-only archive) stay in the
  // ledger + still project, but leave the active stage counts + runs list — exactly like superseded.
  const liveCases = researchCases.filter((researchCase) => !researchCase.superseded && !researchCase.archived)
  const watchlistItems = projectWatchlist(events)
  const holdings = projectHoldings(events)

  // Recorded run-failures (order-aware): a case whose latest lifecycle state is research_run_failed (no
  // later recovery). The failure is RECORDED (surfaced as a fault below), but its abandoned research is
  // DISCARDED from the ACTIVE stage counts + runs — a failed run must not linger as an in-progress
  // deep-dive/quick-screen just because research_run_failed does not advance the research-case stage.
  // ARCHIVED runs (option-b archive) are excluded from Faults too: archiving acknowledges + discards a run,
  // so it leaves EVERY active surface (counts, runs, AND faults), not just the stage counts.
  const archivedCaseIds = new Set(researchCases.filter((c) => c.archived).map((c) => c.research_case_id))
  const failed_runs = collectRecentFailures(events).failed_runs.filter((run) => !archivedCaseIds.has(run.case_id))
  const failedRecent = failed_runs.length
  const failedCaseIds = new Set(failed_runs.map((run) => run.case_id))

  // ── Stage counts ── (active stages exclude failed cases) ───────────────────
  const isActive = (c: ResearchCaseProjection): boolean => !failedCaseIds.has(c.research_case_id)
  const shariahGate = liveCases.filter(
    (c) => isActive(c) && (c.stage === 'shariah_gate_judged' || c.stage === 'quick_screened' || c.stage === 'awaiting_deep_dive_approval' || c.stage === 'pass'),
  ).length
  const deepDive = liveCases.filter((c) => isActive(c) && (c.stage === 'queued_for_deep_dive' || DEEP_DIVE_STAGES.has(c.stage))).length
  const synthesis = liveCases.filter((c) => isActive(c) && SYNTHESIS_STAGES.has(c.stage)).length
  const decision = liveCases.filter((c) => isActive(c) && DECISION_STAGES.has(c.stage)).length
  const watchlistCount = watchlistItems.length
  const holdingCount = holdings.length
  const reviewCount = holdings.filter(
    (h) => h.pending_review_id !== undefined || h.latest_review_id !== undefined,
  ).length

  const awaitingApproval = liveCases.filter((c) => isActive(c) && c.stage === 'awaiting_deep_dive_approval').length

  const stage_counts: PipelineStageCount[] = [
    { key: 'shariah_gate', label: 'Shariah gate', count: shariahGate, health: 'ok' },
    {
      key: 'deep_dive',
      label: `Deep dive · ${PIPELINE_SPECIALIST_LANES.length} lanes`,
      count: deepDive,
      health: deepDive > 0 ? 'warn' : 'ok',
    },
    { key: 'synthesis', label: 'Synthesis', count: synthesis, health: 'ok' },
    { key: 'decision', label: 'Decision', count: decision, health: 'ok' },
    { key: 'watchlist', label: 'Watchlist', count: watchlistCount, health: 'ok' },
    { key: 'holding', label: 'Holding', count: holdingCount, health: 'ok' },
    { key: 'review', label: 'Review', count: reviewCount, health: 'ok' },
  ]
  if (failedRecent > 0) {
    const quickScreenStage = stage_counts[0]
    if (quickScreenStage !== undefined) {
      quickScreenStage.health = 'err'
    }
  }

  // ── Runs ────────────────────────────────────────────────────────────────────
  const runs = buildRuns(liveCases, failedCaseIds)
  const active_runs = runs.filter((run) => run.status === 'running').length

  // ── Grounded sources (total distinct across live cases) ──────────────────────
  const allSourceIds = new Set<string>()
  for (const researchCase of liveCases) {
    for (const finding of researchCase.specialist_findings ?? []) {
      for (const sourceId of finding.source_ids ?? []) {
        allSourceIds.add(sourceId)
      }
    }
    for (const sourceId of researchCase.owner_earnings_valuation?.sources ?? []) {
      allSourceIds.add(sourceId)
    }
  }

  const summary: PipelineSummary = {
    active_runs,
    awaiting_approval: awaitingApproval,
    failed_recent: failedRecent,
    grounded_sources: allSourceIds.size,
  }

  return { stage_counts, summary, runs, failed_runs, snapshot_at: new Date().toISOString() }
}

const TIMELINE_LABELS: Record<string, (payload: Record<string, unknown>) => string> = {
  research_run_requested: () => 'research_run_requested',
  research_run_claimed: () => 'research_run_claimed',
  research_run_failed: () => 'research_run_failed',
  shariah_gate_judged: (payload) => {
    const allowed = payload['allowed']
    if (allowed === true) return 'shariah_gate_judged · OPEN gate'
    if (allowed === false) return 'shariah_gate_judged · CLOSED gate'
    return 'shariah_gate_judged'
  },
  quick_screen_drafted: (payload) => {
    const result = getString(payload, 'screening_result')
    if (result === 'pass') return 'quick_screen_drafted · PASS gate'
    if (result === 'reject') return 'quick_screen_drafted · REJECT gate'
    return 'quick_screen_drafted'
  },
  deep_dive_approval_pending: () => 'deep_dive_approval_pending',
  queued_for_deep_dive: () => 'queued_for_deep_dive',
  deep_dive_started: () => 'deep_dive_started',
  specialist_finding_recorded: (payload) =>
    `specialist_finding · ${getString(payload, 'specialist_lane') ?? 'unknown'}`,
  deep_dive_synthesis_drafted: () => 'deep_dive_synthesis_drafted',
  deep_dive_completed: () => 'deep_dive_completed',
  buffett_munger_analysis_drafted: (payload) =>
    `buffett_munger_analysis · ${getString(payload, 'investment_verdict') ?? 'verdict'}`,
  strategy_decision_drafted: () => 'strategy_decision_drafted',
  decision_drafted: (payload) => `decision_drafted · ${getString(payload, 'decision') ?? ''}`.trim(),
}

const PIPELINE_TIMELINE_EVENT_TYPES = new Set(Object.keys(TIMELINE_LABELS))

function eventBelongsToCase(event: LedgerEventEnvelope<unknown>, caseId: string): boolean {
  if (event.aggregate_type === 'research_case' && event.aggregate_id === caseId) {
    return true
  }
  if (event.correlation_id === caseId) {
    return true
  }
  return isRecord(event.payload) && getString(event.payload, 'research_case_id') === caseId
}

/**
 * Builds the per-run swarm drill-down: specialist lane statuses (with approximate
 * timing derived from event timestamps), grounded source ids, and an ordered timeline.
 *
 * Lane status is derived honestly from events only:
 *  - a `specialist_finding_recorded` for a lane ⇒ done (duration = finding ts − deep_dive_started ts)
 *  - a lane in the deep dive's expected set, not yet recorded, while the swarm is live ⇒ running
 *  - everything else (no deep dive started / completed run) ⇒ pending
 */
export function buildPipelineDrillDown(
  events: LedgerEventEnvelope<unknown>[],
  caseId: string,
): PipelineDrillDown | undefined {
  const researchCase = projectResearchCases(events).find((c) => c.research_case_id === caseId)
  if (researchCase === undefined) {
    return undefined
  }

  const caseEvents = events
    .filter((event) => eventBelongsToCase(event, caseId))
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))

  // A recorded run-failure (order-aware) terminates the run: the drill-down reads 'failed', and its lanes
  // are NOT shown as live-running (consistent with the active-pipeline view, which discards failed runs).
  const failed = new Set(collectRecentFailures(events).failed_runs.map((run) => run.case_id)).has(caseId)
  const status: PipelineRunStatus = failed ? 'failed' : runStatusForCase(researchCase)
  const deepDiveStarted = caseEvents.find((event) => event.event_type === 'deep_dive_started')
  const deepDiveStartMs = deepDiveStarted !== undefined ? Date.parse(deepDiveStarted.created_at) : undefined
  const swarmLive = status === 'running' && deepDiveStarted !== undefined

  // Expected lanes for this run: the deep_dive_started payload's specialist_lanes if present,
  // otherwise the canonical Buffett-Munger set.
  let expectedLanes: string[] = [...PIPELINE_SPECIALIST_LANES]
  if (deepDiveStarted !== undefined && isRecord(deepDiveStarted.payload)) {
    const payloadLanes = deepDiveStarted.payload['specialist_lanes']
    if (Array.isArray(payloadLanes) && payloadLanes.every((entry) => typeof entry === 'string') && payloadLanes.length > 0) {
      expectedLanes = payloadLanes as string[]
    }
  }

  // Findings by lane (with timing + source count).
  const findingByLane = new Map<string, { at: string; sourceCount: number }>()
  for (const event of caseEvents) {
    if (event.event_type !== 'specialist_finding_recorded' || !isRecord(event.payload)) {
      continue
    }
    const lane = getString(event.payload, 'specialist_lane')
    if (lane === undefined) {
      continue
    }
    const sourceIdsRaw = event.payload['source_ids']
    const sourceCount = Array.isArray(sourceIdsRaw)
      ? new Set(sourceIdsRaw.filter((entry) => typeof entry === 'string')).size
      : event.source_ids.length
    findingByLane.set(lane, { at: event.created_at, sourceCount })
  }

  const lanes: PipelineLane[] = expectedLanes.map((lane) => {
    const finding = findingByLane.get(lane)
    if (finding !== undefined) {
      const entry: PipelineLane = {
        lane,
        label: laneLabel(lane),
        status: 'done',
        source_count: finding.sourceCount,
      }
      if (deepDiveStartMs !== undefined) {
        const duration = Date.parse(finding.at) - deepDiveStartMs
        if (Number.isFinite(duration) && duration >= 0) {
          entry.duration_ms = duration
        }
      }
      return entry
    }
    return {
      lane,
      label: laneLabel(lane),
      status: swarmLive ? 'running' : 'pending',
      source_count: 0,
    }
  })

  // Grounded source ids: distinct across all findings, preserving first-seen order.
  const groundedSourceIds: string[] = []
  const seen = new Set<string>()
  for (const finding of researchCase.specialist_findings ?? []) {
    for (const sourceId of finding.source_ids ?? []) {
      if (!seen.has(sourceId)) {
        seen.add(sourceId)
        groundedSourceIds.push(sourceId)
      }
    }
  }

  const timeline: PipelineTimelineEntry[] = caseEvents
    .filter((event) => PIPELINE_TIMELINE_EVENT_TYPES.has(event.event_type))
    .map((event) => {
      const labelFn = TIMELINE_LABELS[event.event_type]
      const payload = isRecord(event.payload) ? event.payload : {}
      return {
        event_type: event.event_type,
        label: labelFn !== undefined ? labelFn(payload) : event.event_type,
        at: event.created_at,
      }
    })

  return {
    research_case_id: researchCase.research_case_id,
    ticker: researchCase.ticker ?? researchCase.research_case_id,
    version: researchCase.version,
    status,
    lanes,
    grounded_source_ids: groundedSourceIds,
    timeline,
  }
}
