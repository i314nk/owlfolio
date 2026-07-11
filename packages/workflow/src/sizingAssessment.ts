// ---------------------------------------------------------------------------
// Phase 5 S6 — the SIZING ASSEMBLER (the pure orchestrator core).
//
// Before S6, S1 (convictionFactor) / S2 (downsideFloor) / S3 (permanentLossCap) / S4 (correlatedClusters)
// / S5 (deploymentHurdle) were BUILT + TESTED but never composed (pure islands). This assembler composes
// them into ONE sizing recommendation. It mirrors admitAssessment's orchestrator SHAPE, but it is PURE:
// all arithmetic, no provider, no I/O, no probability, no LLM. (S7 wires this into the live flow next.)
//
// ORDER (gate FIRST, short-circuit):
//   1. Deployment hurdle (S5) FIRST. If the candidate's owner-earnings yield does not clear
//      savings_rate + equity_risk_margin (or there is no candidate yield), return `hold_in_savings`
//      IMMEDIATELY — NO floor/cluster compute. Holding idle capital in the savings sleeve is the CORRECT
//      fat-pitch posture, NOT a warning.
//   2. Conviction (S1) → target_value = target_weight × investable_capital. S1 cannot_size → cannot_size.
//   3. Floor (S2) — read the persisted floor. cannot_floor → cannot_size (fail-closed; never size on a
//      quality-only guess).
//   4. Per-name permanent-loss cap (S3) + deployment cap (per_name_cap × investable) + cluster cap (S4).
//   5. sizeable_value = min(conviction target, deployment cap, S3 max, S4 max); binding_constraint =
//      which min won.
//   6. Reuse computeTrancheLevels for the ladder. worst_case is ALWAYS attached.
//
// DENOMINATORS — PINNED, NEVER CROSSED:
//   - book_nav (accountingProjection.nav)         → the S3/S4 BOOK-IMPAIRMENT denominator.
//   - investable_capital (investableCapitalProj.) → the conviction TARGET + the deployment-cap denominator.
// A single crossed use makes caps bind at the wrong level. The two arrive as distinct named args and each
// is named at its call site; they are never substituted for one another.
// ---------------------------------------------------------------------------

import { SIZING_PARAMS, type SizingParams } from '@owlfolio/strategies/sizingParams'
import { computeConvictionFactor } from '@owlfolio/strategies/convictionFactor'
import { evaluatePermanentLossCap } from '@owlfolio/strategies/permanentLossCap'
import { evaluateClusterCap, type ClusterBasis, type ClusteredPosition } from '@owlfolio/strategies/correlatedClusters'
import { evaluateDeploymentHurdle } from '@owlfolio/strategies/deploymentHurdle'
import type { MoatClass } from '@owlfolio/strategies/strategyContract'

import { computeTrancheLevels, suggestLadder, type TrancheLevel } from './positionSizingEngine'
import type { DownsideFloorBasis } from './downsideFloor'

type RiskLevel = 'low' | 'medium' | 'high'

/** Which constraint produced the binding (smallest) sizeable value. */
export type SizingBindingConstraint = 'conviction' | 'deployment_cap' | 'permanent_loss' | 'cluster'

/**
 * The S2 floor as READ OFF the persisted admit recommendation (never recomputed here): either a concrete
 * per-share floor with its basis + reliability, or absent (`cannot_floor`).
 */
export type PersistedDownsideFloor =
  | {
      downside_floor_per_share: number
      downside_floor_basis: DownsideFloorBasis
      downside_floor_reliability: 'sound' | 'qualified' | 'unreliable'
    }
  | { cannot_floor: true }

export type SizingRecommendation = {
  conviction_factor: number
  target_weight: number
  sizeable_value: number
  binding_constraint: SizingBindingConstraint
  /** The explicit worst case that ALWAYS reaches the human alongside the size. */
  worst_case: {
    downside_floor_per_share: number
    /** Basis rides alongside (the reliability signal): net_cash is harder than stressed_book. */
    downside_floor_basis: DownsideFloorBasis
    realistic_downside_per_share: number
    aggregate_cluster_downside_fraction: number
    /**
     * Phase 7 S4 — the candidate's per-name cluster key + basis, CARRIED from the same evaluateClusterCap
     * computation that produced aggregate_cluster_downside_fraction (NOT a new derivation). Persisted so the
     * concentration_correlation business-checklist item can marshal evidence ("which cluster, on what basis").
     */
    cluster_key: string
    cluster_basis: ClusterBasis
  }
  /** The entry ladder (reuses computeTrancheLevels — the existing engine). */
  ladder: TrancheLevel[]
  caveats: string[]
  is_observation: true
  is_recommendation: false
}

export type SizingAssessmentResult =
  | { status: 'sizeable'; recommendation: SizingRecommendation }
  /** The CORRECT posture (NOT a warning): nothing clears the deployment hurdle → hold idle in savings. */
  | { status: 'hold_in_savings'; reason: string; expected_savings_return?: number }
  /** Fail-closed: cannot size (no floor / non-investable moat / bad inputs). */
  | { status: 'cannot_size'; reason: string }

/** The sizing candidate — the S1/S3/S4/S5 per-name inputs gathered in one place. */
export type SizingCandidate = {
  ticker: string
  moat_class: MoatClass
  permanent_loss_level: RiskLevel
  uncertainty_level: RiskLevel
  entry_price_per_share: number
  /** Candidate's owner-earnings yield at entry (drives the S5 deployment hurdle). */
  fcf_yield: number
  /** From Fundamentals.sic — the S4 cluster key (optional). */
  sic?: string
  /** Optional named scenario tags — the S4 default-empty secondary cluster seam. */
  scenario_tags?: string[]
}

export type SizingAssessmentArgs = {
  candidate: SizingCandidate
  /** The S2 floor read off the persisted admit recommendation (or cannot_floor). */
  downside_floor: PersistedDownsideFloor
  /** The held book the S4 cluster cap aggregates across. */
  held_book?: ClusteredPosition[]
  /** accountingProjection.nav — the S3/S4 BOOK-IMPAIRMENT denominator. NEVER the target denominator. */
  book_nav: number
  /** investableCapitalProjection.amount — the conviction TARGET + deployment-cap denominator. NEVER nav. */
  investable_capital: number
  /** The ONE expected (not guaranteed) Mudarabah savings rate (S5). */
  savings_expected_profit_rate: number
  /** The margin a candidate must clear ABOVE the savings rate to deploy (S5). */
  equity_risk_margin: number
  /** Buy-price version tag recorded on each ladder level (spec §3). */
  buy_price_version: string
  /** Optional regime temperature for ladder selection (deferred/hooked — defaults to normal). */
  temperature?: number
  /** B6 (book rule 8): the price sits ≥50% below intrinsic value — surfaces the load-up advisory. */
  in_load_up_zone?: boolean
  params?: SizingParams
}

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Compose the S1–S5 islands + the ladder engine into ONE sizing recommendation. Gate-first, short-circuit,
 * fail-closed. See the file header for the full order + the pinned-denominator discipline.
 */
export function computeSizingRecommendation(args: SizingAssessmentArgs): SizingAssessmentResult {
  const params = args.params ?? SIZING_PARAMS
  const { candidate } = args
  const heldBook = args.held_book ?? []

  // -------------------------------------------------------------------------
  // 1. DEPLOYMENT HURDLE (S5) FIRST — gate before any floor/cluster compute.
  //    Not clearing (or no candidate yield) → hold_in_savings, the CORRECT posture. Short-circuit.
  // -------------------------------------------------------------------------
  const hurdle = evaluateDeploymentHurdle({
    fcf_yield: candidate.fcf_yield,
    savings_expected_profit_rate: args.savings_expected_profit_rate,
    equity_risk_margin: args.equity_risk_margin,
  })
  if (!hurdle.clears) {
    return {
      status: 'hold_in_savings',
      reason: hurdle.reason,
      ...(finite(args.savings_expected_profit_rate)
        ? { expected_savings_return: args.savings_expected_profit_rate }
        : {}),
    }
  }

  // -------------------------------------------------------------------------
  // 2. CONVICTION (S1) → target_value = target_weight × INVESTABLE_CAPITAL (NOT nav).
  // -------------------------------------------------------------------------
  const conviction = computeConvictionFactor(
    {
      moat_class: candidate.moat_class,
      permanent_loss_level: candidate.permanent_loss_level,
      uncertainty_level: candidate.uncertainty_level,
    },
    params,
  )
  if (conviction.status === 'cannot_size') {
    return { status: 'cannot_size', reason: conviction.reason }
  }
  if (!finite(args.investable_capital) || args.investable_capital <= 0) {
    return { status: 'cannot_size', reason: 'investable_capital missing/non-positive — no conviction target to size.' }
  }
  const convictionTargetValue = conviction.target_weight * args.investable_capital

  // -------------------------------------------------------------------------
  // 3. FLOOR (S2) — read the persisted floor. cannot_floor → cannot_size (fail-closed).
  // -------------------------------------------------------------------------
  if ('cannot_floor' in args.downside_floor) {
    return {
      status: 'cannot_size',
      reason:
        'downside floor unavailable (S2 cannot_floor) — the permanent-loss cap binds on the concrete floor '
        + '(a number), never on a quality-only guess; fail-closed, no size.',
    }
  }
  const floorPerShare = args.downside_floor.downside_floor_per_share
  const floorBasis = args.downside_floor.downside_floor_basis

  // -------------------------------------------------------------------------
  // 4. The caps. The conviction target is the FIRST candidate value; each cap is evaluated against it.
  //    - S3 per-name permanent-loss cap: book_nav denominator (IMPAIRMENT).
  //    - deployment cap: per_name_cap × INVESTABLE_CAPITAL (NOT nav).
  //    - S4 cluster cap: book_nav denominator (IMPAIRMENT).
  // -------------------------------------------------------------------------
  const deploymentCapValue = params.per_name_cap * args.investable_capital

  const perNameCap = evaluatePermanentLossCap({
    entry_price_per_share: candidate.entry_price_per_share,
    downside_floor: { floor_per_share: floorPerShare },
    book_nav: args.book_nav, // IMPAIRMENT denominator — never investable.
    proposed_value: convictionTargetValue,
    params,
  })
  if (perNameCap.status === 'cannot_size') {
    return { status: 'cannot_size', reason: perNameCap.reason }
  }

  const clusterCap = evaluateClusterCap({
    candidate: {
      ticker: candidate.ticker,
      entry_price_per_share: candidate.entry_price_per_share,
      floor_per_share: floorPerShare,
      position_value: convictionTargetValue,
      ...(candidate.sic === undefined ? {} : { sic: candidate.sic }),
      ...(candidate.scenario_tags === undefined ? {} : { scenario_tags: candidate.scenario_tags }),
    },
    held_book: heldBook,
    book_nav: args.book_nav, // IMPAIRMENT denominator — never investable.
    proposed_value: convictionTargetValue,
    params,
  })
  if (clusterCap.status === 'cannot_size') {
    return { status: 'cannot_size', reason: clusterCap.reason }
  }

  // -------------------------------------------------------------------------
  // 5. sizeable_value = min(...); binding_constraint = which min won.
  // -------------------------------------------------------------------------
  const candidates: Array<{ constraint: SizingBindingConstraint; value: number }> = [
    { constraint: 'conviction', value: convictionTargetValue },
    { constraint: 'deployment_cap', value: deploymentCapValue },
    { constraint: 'permanent_loss', value: perNameCap.max_sizeable_value },
    { constraint: 'cluster', value: clusterCap.max_sizeable_value },
  ]
  // The smallest value wins; ties resolve in declaration order (conviction → deployment → permanent_loss
  // → cluster), so a structurally-binding constraint is named deterministically.
  let binding = candidates[0]!
  for (const c of candidates) {
    if (c.value < binding.value) binding = c
  }
  const sizeableValue = binding.value

  // -------------------------------------------------------------------------
  // 6. Ladder (reuse computeTrancheLevels) + worst_case (ALWAYS attached).
  // -------------------------------------------------------------------------
  const ladderId = suggestLadder(args.temperature, params)
  const ladder = computeTrancheLevels(
    candidate.entry_price_per_share,
    ladderId,
    args.buy_price_version,
    params,
  )

  const realisticDownsidePerShare = Math.max(candidate.entry_price_per_share - floorPerShare, 0)

  const caveats: string[] = [...clusterCap.cluster.caveats]
  if (conviction.factor < 1) {
    caveats.push(
      `conviction scaled the target DOWN to ${(conviction.factor * 100).toFixed(0)}% of base `
      + `(${conviction.reason})`,
    )
  }

  // B6 (book rule 8, ADVISORY — the human decides): a ≥50% discount to intrinsic value is the
  // book's "load up the truck" moment — surface it beside the ladder, never silently escalate.
  if (args.in_load_up_zone === true) {
    caveats.push(
      'rule_8_load_up: the price sits at or below the LOAD-UP threshold (≥50% below intrinsic value). '
      + 'The book: "once you find a margin of safety, load up the truck" — consider deploying the full '
      + 'target weight rather than laddering in. Advisory; the deployment/cluster caps above still bind.',
    )
  }

  const recommendation: SizingRecommendation = {
    conviction_factor: conviction.factor,
    target_weight: conviction.target_weight,
    sizeable_value: sizeableValue,
    binding_constraint: binding.constraint,
    worst_case: {
      downside_floor_per_share: floorPerShare,
      downside_floor_basis: floorBasis,
      realistic_downside_per_share: realisticDownsidePerShare,
      aggregate_cluster_downside_fraction: clusterCap.cluster.aggregate_impairment_fraction,
      // Phase 7 S4 — carry the per-name cluster key/basis from the SAME cluster result (persist-only).
      cluster_key: clusterCap.cluster.cluster_key,
      cluster_basis: clusterCap.cluster.cluster_basis,
    },
    ladder,
    caveats,
    is_observation: true,
    is_recommendation: false,
  }

  return { status: 'sizeable', recommendation }
}
