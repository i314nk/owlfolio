import type { Provider } from '@owlfolio/providers'
import type { GroundFn } from './groundedAgent'
import type { GroundingDeps } from './sourceGrounding'
import { screenCheapness, type CheapnessResult } from './cheapnessScreen'
import { runAdmitJudgment, type AdmitLaneDigest, type AdmitRecommendation } from './admitJudgment'
import type { Fundamentals } from './secEdgar'

// ---------------------------------------------------------------------------
// Task 4.2c — the ADMIT-ASSESSMENT ORCHESTRATOR (the integration slice).
//
// Before 4.2c, screenCheapness + runAdmitJudgment were BUILT + TESTED but never called from a live path
// (pure islands). This orchestrator composes them on-demand for a deep-dive-complete, GATE-PASSING
// research case:
//   1. screenCheapness (Phase-1 OE / EV) frames the "why is it cheap" question, and
//   2. runAdmitJudgment makes the fixable-vs-terminal impairment call (independent bear case + the two
//      grounded risk fields → classifyAdmit).
//
// It is computed FRESH at call time (on-demand): the API route invokes it only when the human opens the
// admit step / a cheapness-surfaced name is considered, NOT eagerly at deep-dive completion.
//
// It is an OBSERVATION, never an admit: the returned AdmitRecommendation's `admittable` is a
// RECOMMENDATION flag — nothing here transitions the name. The human still admits via confirmWatchlistDraft.
// ---------------------------------------------------------------------------

/** Cheapness summary surfaced on the recommendation (Phase-1 OE / EV — the screen's reader output). */
export type AdmitCheapnessSummary = {
  /** Phase-1 normalized OE / EV (the cheap-yield), when computable. */
  owner_earnings_yield?: number
  /** Enterprise value ($M) = market_cap + total_debt − cash (when computable). */
  ev?: number
  /** True when OE-yield ≥ threshold (computed independently of the gate). */
  cheap: boolean
  /** Human-readable reason when the screen failed closed (absent when it computed cleanly). */
  reason?: string
}

/** The complete admit recommendation the orchestrator produces (judgment + the cheapness summary). */
export type AdmitAssessmentRecommendation = Extract<AdmitRecommendation, { status: 'complete' }> & {
  /** The cheapness screen summary that surfaced this name (Phase-1 OE / EV). */
  cheapness?: AdmitCheapnessSummary
}

/**
 * Outcome of the on-demand orchestrator:
 *  - `complete`              — the judgment ran; carries the full recommendation (observation).
 *  - `not_an_admission_candidate` — the case is not deep-dive-complete and/or not gate-passing, so the
 *                             admit question is not live (no provider call is made — fail-closed early).
 *  - `admit_judgment_incomplete`  — the candidate qualified but the judgment degraded visibly (a provider
 *                             timeout/failure after the grounded retry); never a fabricated clean admit.
 */
export type AdmitAssessmentResult =
  | { status: 'complete'; recommendation: AdmitAssessmentRecommendation; cheapness: CheapnessResult }
  | { status: 'not_an_admission_candidate'; reason: string }
  | { status: 'admit_judgment_incomplete'; reason: string }

export type RunAdmitAssessmentArgs = {
  research_case_id: string
  ticker: string
  /** The model the judgment runs on (defaults to the run's model). */
  model_id: string
  /** The case's current projection stage — must be deep-dive-complete for the admit question to be live. */
  stage: string
  /** Did the research swarm call this a good business? (the gate verdict.) Fed to screenCheapness + classifyAdmit. */
  gate_passing: boolean
  /** Phase-1 SEC EDGAR fundamentals (READ by screenCheapness for the normalized OE / balance sheet). */
  fundamentals: Fundamentals
  /** Market cap ($M) — price × diluted shares (caller supplies; no network here). */
  market_cap_musd: number
  /** Compact lane digest (same shape as the red-team digest) the judgment reasons from. */
  laneDigest: AdmitLaneDigest[]
  /** The verified source corpus (source_ids) the judgment must cite from. */
  corpusSourceIds: string[]
  /** Hashes/source_ids verified against the fetched corpus — used to cite-check the risk fields. */
  verifiedCitationHashes: ReadonlySet<string>
  /** Phase-1 valuation outputs carried through to the recommendation. */
  valuation?: { buy_below?: number }
  /** Optional cheapness yield-threshold override (forwarded to screenCheapness). */
  yield_threshold?: number
}

/** The stages at which a research case is considered deep-dive-complete (the admit question is live). */
const DEEP_DIVE_COMPLETE_STAGES = new Set<string>([
  'deep_dive_completed',
  'deep_dive_complete',
  'analysis_drafted',
  'decision_pending',
  'decision_drafted',
  'watchlist_draft',
])

export function isDeepDiveComplete(stage: string): boolean {
  return DEEP_DIVE_COMPLETE_STAGES.has(stage)
}

/** Build the human-readable "why cheap" framing the judgment prompt leads with. */
function buildCheapnessSummary(cheapness: CheapnessResult, ticker: string): string {
  if (cheapness.owner_earnings_yield === undefined || cheapness.ev_musd === undefined) {
    return `${ticker} surfaced for the admit judgment (cheapness not computable: ${cheapness.reason ?? 'missing inputs'}).`
  }
  const yieldPct = (cheapness.owner_earnings_yield * 100).toFixed(1)
  return (
    `${ticker} screens cheap on Phase-1 owner-earnings yield ${yieldPct}% `
    + `(normalized OE / EV; EV ≈ $${Math.round(cheapness.ev_musd)}M) on a gate-passing business.`
  )
}

/**
 * Run the on-demand admit assessment. Gates FIRST (fail-closed): if the case is not deep-dive-complete or
 * not gate-passing, returns `not_an_admission_candidate` WITHOUT making a provider call — the admit
 * question is only live for an admission candidate. Otherwise it screens cheapness (Phase-1 OE / EV) and
 * runs the admit judgment, returning the full recommendation + the cheapness summary as an OBSERVATION.
 */
export async function runAdmitAssessment(
  provider: Provider,
  args: RunAdmitAssessmentArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<AdmitAssessmentResult> {
  // Gate 1 — deep-dive-complete. No admit judgment before the deep dive finishes (the inputs aren't ready).
  if (!isDeepDiveComplete(args.stage)) {
    return {
      status: 'not_an_admission_candidate',
      reason: `research case is not deep-dive-complete (stage: ${args.stage}); the admit judgment is only live for a deep-dive-complete candidate.`,
    }
  }

  // Gate 2 — gate-passing. Cheapness on a non-wonderful business is not the signal; the admit question is
  // only live for an "already wonderful" gate-passing name.
  if (!args.gate_passing) {
    return {
      status: 'not_an_admission_candidate',
      reason: 'research case did not pass the quality gate; the admit judgment is only live for a gate-passing admission candidate.',
    }
  }

  // Cheapness screen — READS the Phase-1 OE series + balance sheet (no recompute, no network).
  const cheapness = screenCheapness({
    fundamentals: args.fundamentals,
    market_cap_musd: args.market_cap_musd,
    gate_passing: args.gate_passing,
    ...(args.yield_threshold === undefined ? {} : { yield_threshold: args.yield_threshold }),
  })

  // The admit judgment (independent impairment bear case + the two grounded risk fields → classifyAdmit).
  const judgment = await runAdmitJudgment(
    provider,
    {
      research_case_id: args.research_case_id,
      ticker: args.ticker,
      model_id: args.model_id,
      quality_verdict_passes: args.gate_passing,
      laneDigest: args.laneDigest,
      cheapness_summary: buildCheapnessSummary(cheapness, args.ticker),
      corpusSourceIds: args.corpusSourceIds,
      verifiedCitationHashes: args.verifiedCitationHashes,
      ...(args.valuation === undefined ? {} : { valuation: args.valuation }),
    },
    deps,
  )

  if (judgment.status === 'admit_judgment_incomplete') {
    return { status: 'admit_judgment_incomplete', reason: judgment.reason }
  }

  const cheapnessSummary: AdmitCheapnessSummary = {
    cheap: cheapness.cheap,
    ...(cheapness.owner_earnings_yield === undefined ? {} : { owner_earnings_yield: cheapness.owner_earnings_yield }),
    ...(cheapness.ev_musd === undefined ? {} : { ev: cheapness.ev_musd }),
    ...(cheapness.reason === undefined ? {} : { reason: cheapness.reason }),
  }

  return {
    status: 'complete',
    recommendation: { ...judgment, cheapness: cheapnessSummary },
    cheapness,
  }
}
