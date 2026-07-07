import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  projectResearchCases,
  type ResearchCaseStage,
} from '@owlfolio/ledger/projections/researchCaseProjection'

/**
 * Run watchdog — detect ABANDONED in-flight research runs.
 *
 * A worker that dies/is killed mid-run leaves the research case in a NON-TERMINAL stage with no
 * terminal event, so the pipeline shows it "running" forever and nothing reports a failure. This
 * pure detector finds those cases so the worker reaper can record a `research_run_failed` WITH A
 * REASON. It is the real anti-stuck mechanism (alongside the codex hard-kill + retry); the per-call
 * timeout is only a generous backstop.
 */

/**
 * TERMINAL stages — a case that has reached a human-facing decision (any `decision_*`), been
 * rejected/passed, or otherwise left the in-flight pipeline. These are NEVER abandonable: the run
 * already finished (or was explicitly closed), so no watchdog failure is owed. (A case carrying a
 * `research_run_failed` event is also terminal — checked separately, since the projection does not
 * fold `research_run_failed` into the stage.)
 */
const TERMINAL_STAGES: ReadonlySet<ResearchCaseStage> = new Set<ResearchCaseStage>([
  'decision_pending', // strategy_decision_drafted — the human-facing decision exists
  'decision_drafted',
  'rejected',
  'pass',
  'watchlist_draft',
  'watchlist',
  'holding',
])

/**
 * IN-FLIGHT (abandonable) stages — every pipeline stage BEFORE the human-facing decision. A worker
 * is supposed to drive a case from here to a terminal stage in one bounded run; if it stops emitting
 * events here for longer than the staleness threshold, the worker died mid-run. Mirrors the
 * projection's stage enum: `research_case_created`→`discovered`, `quick_screen_drafted`→
 * `quick_screened`, `queued_for_deep_dive`, `deep_dive_started`, specialist/synthesis/completed
 * intermediates, and `buffett_munger_analysis_drafted`→`analysis_drafted`.
 */
const ABANDONABLE_STAGES: ReadonlySet<ResearchCaseStage> = new Set<ResearchCaseStage>([
  'discovered',
  'quick_screened',
  'awaiting_deep_dive_approval',
  'queued_for_deep_dive',
  'deep_dive_started',
  'specialist_finding_recorded',
  'deep_dive_in_progress',
  'deep_dive_synthesis_drafted',
  'deep_dive_completed',
  'deep_dive_complete',
  'analysis_drafted',
])

export type AbandonedResearchRun = {
  research_case_id: string
  ticker?: string
  last_event_at: string
  stalled_for_ms: number
}

export type FindAbandonedResearchRunsArgs = {
  events: LedgerEventEnvelope<unknown>[]
  /** Current wall-clock instant (injected — the detector never calls Date.now() itself). */
  now: Date
  /** No-progress window beyond which a non-terminal case is treated as worker-died. */
  stalenessMs: number
}

/**
 * Pure, deterministic detector. A research case is ABANDONED when ALL of:
 *   - it is NOT superseded (a newer version replaced it → the old one is moot),
 *   - its stage is an in-flight / non-terminal stage (it has NOT reached a decision/rejection),
 *   - it does NOT already carry a `research_run_failed` event (no double-report),
 *   - its latest event (`updated_at`) is older than `now - stalenessMs`.
 * Returns one entry per abandoned case.
 */
export function findAbandonedResearchRuns({
  events,
  now,
  stalenessMs,
}: FindAbandonedResearchRunsArgs): AbandonedResearchRun[] {
  const nowMs = now.getTime()
  const cases = projectResearchCases(events)

  // The projection does NOT fold `research_run_failed` into the stage, so scan the events directly
  // for which cases already carry a failure (terminal — no second failure owed).
  const failedCaseIds = new Set<string>()
  const claimedCaseIds = new Set<string>()
  for (const event of events) {
    if (event.event_type === 'research_run_failed') {
      failedCaseIds.add(event.aggregate_id)
    }
    if (event.event_type === 'research_run_claimed') {
      const payload = event.payload as Record<string, unknown> | undefined
      const id = typeof payload?.['research_case_id'] === 'string' ? (payload['research_case_id'] as string) : event.aggregate_id
      claimedCaseIds.add(id)
    }
  }

  const abandoned: AbandonedResearchRun[] = []
  for (const researchCase of cases) {
    if (researchCase.superseded) {
      continue
    }
    if (TERMINAL_STAGES.has(researchCase.stage) || !ABANDONABLE_STAGES.has(researchCase.stage)) {
      continue
    }
    // A case still at `discovered` is only an in-flight run if a worker actually CLAIMED it (and then
    // died before advancing it). A discovery-promoted case sits at `discovered` with NO claim — it is
    // idle/not-started, not abandoned — so it must never be reaped. (Before discovery-promote, intake
    // always claimed a run immediately, so `discovered` implied in-flight; that invariant no longer holds.)
    if (researchCase.stage === 'discovered' && !claimedCaseIds.has(researchCase.research_case_id)) {
      continue
    }
    if (failedCaseIds.has(researchCase.research_case_id)) {
      continue
    }
    const lastEventMs = new Date(researchCase.updated_at).getTime()
    const stalledForMs = nowMs - lastEventMs
    if (stalledForMs <= stalenessMs) {
      continue
    }
    abandoned.push({
      research_case_id: researchCase.research_case_id,
      ...(researchCase.ticker === undefined ? {} : { ticker: researchCase.ticker }),
      last_event_at: researchCase.updated_at,
      stalled_for_ms: stalledForMs,
    })
  }

  return abandoned
}

/**
 * Default run-watchdog staleness window: 25 min. WHY this generous: a single codex call can take up
 * to the 300s per-call timeout, a stalled-then-retried call ~10 min, and there can be a multi-minute
 * gap between pipeline phases — so 25 min of NO new events for a non-terminal case is comfortably
 * beyond any legitimate gap, meaning the worker is dead. A threshold any shorter risks cutting off
 * real, slow-but-progressing analysis (the explicit design constraint).
 */
export const RUN_WATCHDOG_STALENESS_MS = 25 * 60_000

/**
 * Resolve the run-watchdog staleness window from an OWLFOLIO_RUN_WATCHDOG_STALENESS_MS-style raw
 * value. A valid positive integer wins; anything invalid (unset, empty, zero, negative, non-numeric)
 * falls back to {@link RUN_WATCHDOG_STALENESS_MS}. Mirrors `resolveAgentTimeoutMs`.
 */
export function resolveRunWatchdogStalenessMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RUN_WATCHDOG_STALENESS_MS
}
