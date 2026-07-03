import type { ResearchCaseStage } from '@owlfolio/ledger/projections/researchCaseProjection'

/**
 * The user-facing ordered checklist of a deep-dive research run. This is a PRESENTATION model — a stable,
 * coarse projection of the much finer-grained `ResearchCaseStage` event ladder into the six steps a person
 * actually waits through (quick-screen → circle → 5 lanes → synthesis → decision). Keep it a PURE function
 * over plain inputs so the progress UI can be driven from the projection without a DB.
 */
export type ResearchRunStageKey = 'queued' | 'quick_screen' | 'circle' | 'deep_dive' | 'synthesis' | 'decision'

export type RunProgressStageState = 'done' | 'current' | 'pending'

export type RunProgressStage = {
  key: ResearchRunStageKey
  label: string
  state: RunProgressStageState
}

export type RunProgress = {
  /** Case exists AND is not terminal AND not failed AND not paused awaiting approval → render the live view. */
  inProgress: boolean
  /** A `research_run_failed` event exists for the case. */
  failed: boolean
  /** The run paused at the human deep-dive approval gate — the page's dossier/approval branch owns this. */
  awaitingApproval: boolean
  currentStage: ResearchRunStageKey | 'done'
  stages: RunProgressStage[]
  lanes: { completed: number; total: number }
}

export type ResolveRunProgressInput = {
  /** The projected case stage. Absent (e.g. the run is enqueued but the case row is not yet created) → queued. */
  stage?: ResearchCaseStage
  /** Count of recorded specialist findings — drives the live deep-dive "N/5" lane count. */
  specialistFindingCount?: number
  /** True when a `research_run_failed` event exists for the case. */
  failed?: boolean
}

/**
 * The five Buffett-Munger deep-dive specialist lanes (business_quality, moat, management, financial_quality,
 * risks). Hardcoded here to keep this module a pure, dependency-light presentation helper;
 * it mirrors `buffettMungerDeepDiveLanes.length` in `@owlfolio/workflow` (kept in sync by intent).
 * Shariah runs as an always-on focused pass (not a parallel lane), so it is not counted here.
 */
export const DEEP_DIVE_LANE_TOTAL = 5

const STAGE_ORDER: readonly ResearchRunStageKey[] = [
  'queued',
  'quick_screen',
  'circle',
  'deep_dive',
  'synthesis',
  'decision',
] as const

function labelFor(key: ResearchRunStageKey, lanes: { completed: number; total: number }): string {
  switch (key) {
    case 'queued':
      return 'Queued — fetching filings'
    case 'quick_screen':
      return 'Quick screen — Shariah + worth-it gate'
    case 'circle':
      return 'Circle of competence'
    case 'deep_dive':
      return `Deep dive — ${lanes.completed}/${lanes.total} specialists`
    case 'synthesis':
      return 'Synthesis & valuation'
    case 'decision':
      return 'Decision drafted'
  }
}

/**
 * Map the fine-grained projection stage to the coarse current step. The worker proceeds straight from the
 * quick-screen to the circle judgment in automatic mode, so `quick_screened` reads as circle-current.
 */
function mapStageToCurrent(stage: ResearchCaseStage | undefined): ResearchRunStageKey | 'done' {
  switch (stage) {
    case undefined:
    case 'discovered':
      return 'queued'
    case 'quick_screened':
      return 'circle'
    // The approval pause is handled by the caller (awaitingApproval); kept coherent here.
    case 'awaiting_deep_dive_approval':
      return 'deep_dive'
    case 'circle_competence_judged':
    case 'queued_for_deep_dive':
    case 'deep_dive_started':
    case 'specialist_finding_recorded':
    case 'deep_dive_in_progress':
      return 'deep_dive'
    case 'deep_dive_synthesis_drafted':
    case 'deep_dive_completed':
    case 'deep_dive_complete':
    case 'decision_pending':
      return 'synthesis'
    case 'analysis_drafted':
    case 'decision_drafted':
    case 'pass':
    case 'rejected':
    case 'watchlist':
    case 'watchlist_draft':
    case 'holding':
      return 'done'
    default:
      return 'queued'
  }
}

function buildStages(
  currentStage: ResearchRunStageKey | 'done',
  lanes: { completed: number; total: number },
): RunProgressStage[] {
  if (currentStage === 'done') {
    // Terminal. A circle SET-ASIDE (or a quick-screen reject) jumps to a terminal stage WITHOUT running the
    // deep dive, so mark the deep_dive/synthesis steps 'pending' (skipped) — not 'done' — when no lane ever
    // recorded a finding. A full run completes with all five lanes, so those read 'done'.
    const deepDiveRan = lanes.completed > 0
    return STAGE_ORDER.map((key) => {
      const skipped = (key === 'deep_dive' || key === 'synthesis') && !deepDiveRan
      return { key, label: labelFor(key, lanes), state: skipped ? 'pending' : 'done' }
    })
  }

  const currentIndex = STAGE_ORDER.indexOf(currentStage)
  return STAGE_ORDER.map((key, index) => {
    const state: RunProgressStageState = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending'
    return { key, label: labelFor(key, lanes), state }
  })
}

/**
 * PURE: resolve the run-progress presentation model from the projected case fields. Drives the animated,
 * stage-aware "research running…" view. `inProgress` is the single gate the page reads to decide whether to
 * show the progress view or fall through to the dossier / failed / approval branches.
 */
export function resolveRunProgress(input: ResolveRunProgressInput): RunProgress {
  const total = DEEP_DIVE_LANE_TOTAL
  const completed = Math.max(0, Math.min(input.specialistFindingCount ?? 0, total))
  const lanes = { completed, total }

  const failed = input.failed === true
  const awaitingApproval = !failed && input.stage === 'awaiting_deep_dive_approval'

  const currentStage = mapStageToCurrent(input.stage)
  const isTerminal = currentStage === 'done'
  const inProgress = !isTerminal && !failed && !awaitingApproval

  return {
    inProgress,
    failed,
    awaitingApproval,
    currentStage,
    stages: buildStages(currentStage, lanes),
    lanes,
  }
}
