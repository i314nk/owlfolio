// ---------------------------------------------------------------------------
// Phase 6 S6 — the SELL ASSEMBLER (the pure orchestrator core).
//
// Phase 6 built five pure islands for the HELD-position sell decision but never composed them:
//   - the held-impairment judgment (reassessHeldImpairment → impairment_call),
//   - the minimum-hold clock (S1, holdingMinimumHoldStatus → within_window),
//   - the minimum-hold GUARD (S2, applyMinimumHoldGuard),
//   - the per-trigger triggers (S3 valuationInverted, S4 betterOpportunity),
//   - the Munger bias caveats (S5, collectSellBiasCaveats).
// This assembler composes them into ONE advisory sell decision. It mirrors sizingAssessment's
// orchestrator SHAPE, but it is PURE: no provider, no I/O, no ledger, no LLM. All reads are passed in as
// args (the route — S8 — gathers them from projections). The decision is ADVISORY: the resulting OBSERVATION
// is emitted later by S8 and the actual close is human-authored. NEVER auto-sell.
//
// THE LOAD-BEARING INVARIANT: a sell must never result from PRICE ALONE. Price is an INPUT — to "at a
// loss?" and to the valuation-inverted reverse-DCF (the live price's IMPLIED growth, solved against the
// SIGN-OFF-FROZEN band/oe_ps) — never the sole cause. The ONLY price-driven `sell_review` is
// `valuation_inverted`, which fires only when the implied growth reaches the FROZEN sustainable-band ceiling
// (the mirror of the buy; the band/oe_ps are passed in, never recomputed here). Every other `sell_review`
// rides on a non-price cause (a broken thesis, a recognized mistake, a constrained better opportunity).
//
// ORDER (gate-first; short-circuit). See computeSellDecision for the exact sequence:
//   1. at_loss = current_price < cost_basis_per_share.
//   2. impairment_call = reassessHeldImpairment(...) — the SHARED judgment (never a parallel clock test).
//   3. within_window = holdingMinimumHoldStatus(...) — single-sourced in S1 (fail-closed on missing date).
//   4. guard = applyMinimumHoldGuard(...). hold_blocks_sell → hold; escalate_human_review → escalate_review;
//      release_through_guard / inactive → CONTINUE to trigger-specific logic.
//   5. Trigger-specific (only when released/inactive).
//   6. ALWAYS attach worst_case + bias_caveats; build the SELL-REVIEW scaffold for sell_review outcomes.
// ---------------------------------------------------------------------------

import { SELL_PARAMS, type SellParams } from '@owlfolio/strategies/sellParams'
import {
  applyMinimumHoldGuard,
  type GuardDecision,
  type MinimumHoldTrigger,
} from '@owlfolio/strategies/minimumHoldGuard'
import { holdingMinimumHoldStatus } from '@owlfolio/strategies/minimumHold'
import { evaluateValuationInverted } from '@owlfolio/strategies/valuationInverted'
import { evaluateBetterOpportunity } from '@owlfolio/strategies/betterOpportunity'
import { collectSellBiasCaveats, type SellBiasCaveat } from '@owlfolio/strategies/sellBiasGuards'

import { reassessHeldImpairment, type ImpairmentCall, type RiskLevel } from './heldImpairment'
import {
  buildSellReviewScaffold,
  type SellReviewDraft,
  type SellReviewReasonCode,
} from './lifecycleMonitors'
import type { MonitorHoldingInput } from './lifecycleMonitors'

export type { MinimumHoldTrigger }

/**
 * The explicit worst case that ALWAYS reaches the human alongside a sell decision. The floor fields come
 * from the persisted admit recommendation (Phase 5 S2 floor); when the floor is known, `realistic_downside`
 * = max(cost_basis_per_share - downside_floor_per_share, 0).
 */
export type SellWorstCase = {
  downside_floor_per_share?: number
  downside_floor_basis?: string
  downside_floor_reliability?: string
  /** max(cost - floor, 0); present only when the floor is known. */
  realistic_downside?: number
}

export type SellRecommendation = {
  trigger: MinimumHoldTrigger
  impairment_call: ImpairmentCall
  /** The minimum-hold guard's verdict (S2). */
  minimum_hold_decision: GuardDecision
  /**
   * The sign-off-frozen normalized owner-earnings/share (scope-reframe; passed in, never recomputed).
   * Present when supplied.
   */
  frozen_oe_ps?: number
  /**
   * The sign-off-frozen REFERENCE fair value the lightened valuation-inverted sell FLAG compares the live
   * price against — and the price anchor the anchoring bias guard reads (scope-reframe; passed in, never
   * recomputed). Present when supplied.
   */
  frozen_reference_fair_value?: number
  /** ALWAYS present — never an empty/absent worst case on a sell_review. */
  worst_case: SellWorstCase
  /** Advisory Munger bias caveats (S5); never block or change the decision. */
  bias_caveats: SellBiasCaveat[]
  /**
   * True when a human MUST author/sign-off as a structural gate: better_opportunity sell_reviews
   * (mandatory) and escalate_review. Defaults to true for ALL sell_reviews too (the close is always
   * human-authored), but the better_opportunity / escalate cases REQUIRE it as the structural gate.
   */
  requires_human_signoff: boolean
  reason_code: SellReviewReasonCode
  reason: string
  /** The SELL-REVIEW scaffold (a human-authored exit draft) — present on sell_review outcomes. */
  sell_review_draft?: SellReviewDraft
  /** This is an OBSERVATION (advisory). The close is human-authored — never an auto-sell. */
  is_observation: true
}

export type SellDecisionStatus = 'sell_review' | 'hold' | 'escalate_review' | 'cannot_assess'

export type SellDecisionResult = {
  status: SellDecisionStatus
  recommendation?: SellRecommendation
}

export type SellAssessmentArgs = {
  trigger: MinimumHoldTrigger
  // held position facts
  opened_at: string | undefined
  now: string
  current_price: number
  cost_basis_per_share: number
  // fresh impairment judgment inputs (current grounded fields):
  uncertainty: RiskLevel
  permanent_loss_risk: RiskLevel
  quality_verdict_passes: boolean
  // valuation-inverted (scope-reframe): the SIGN-OFF-FROZEN REFERENCE fair value the lightened sell FLAG
  // compares the live price against (never recomputed here) + the normalized owner-earnings/share. The
  // frozen reference is also the price anchor the anchoring bias guard reads.
  frozen_oe_ps: number | undefined
  frozen_reference_fair_value: number | undefined
  // better-opportunity (optional; only for that trigger):
  candidate_oe_yield?: number
  held_oe_yield?: number
  switching_friction?: number
  // worst case (from the persisted admit recommendation — Phase 5 floor):
  downside_floor_per_share?: number
  downside_floor_basis?: string
  downside_floor_reliability?: string
  params?: SellParams
}

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Build the ALWAYS-attached worst case from the persisted floor fields. `realistic_downside` is computed
 * only when the floor is a finite number.
 */
function buildWorstCase(args: SellAssessmentArgs): SellWorstCase {
  const worst: SellWorstCase = {}
  if (finite(args.downside_floor_per_share)) {
    worst.downside_floor_per_share = args.downside_floor_per_share
    worst.realistic_downside = Math.max(args.cost_basis_per_share - args.downside_floor_per_share, 0)
  }
  if (args.downside_floor_basis !== undefined) worst.downside_floor_basis = args.downside_floor_basis
  if (args.downside_floor_reliability !== undefined) {
    worst.downside_floor_reliability = args.downside_floor_reliability
  }
  return worst
}

/**
 * Compose the held-impairment judgment + the minimum-hold clock (S1) + guard (S2) + the per-trigger
 * triggers (S3/S4) + the bias caveats (S5) into ONE advisory sell decision. Gate-first, short-circuit,
 * fail-closed, PURE. worst_case + bias_caveats are ALWAYS attached. See the file header for the full
 * order and the price-alone-never-sells invariant.
 */
export function computeSellDecision(args: SellAssessmentArgs): SellDecisionResult {
  const params = args.params ?? SELL_PARAMS

  // 1. at_loss — price is an INPUT to "at a loss?", never the sole cause of a sell.
  const at_loss = args.current_price < args.cost_basis_per_share

  // 2. impairment_call — the SHARED fixable-vs-permanent judgment (consumed; never a parallel clock test).
  const impairment_call = reassessHeldImpairment({
    uncertainty: args.uncertainty,
    permanent_loss_risk: args.permanent_loss_risk,
    quality_verdict_passes: args.quality_verdict_passes,
  }).impairment_call

  // 3. within_window — single-sourced in S1 (fail-closed: missing opened_at → still inside the window).
  const within_window = holdingMinimumHoldStatus({
    opened_at: args.opened_at,
    now: args.now,
    params,
  }).within_window

  // 4. The guard.
  const guard = applyMinimumHoldGuard({ trigger: args.trigger, impairment_call, at_loss, within_window })

  // worst_case + bias_caveats are ALWAYS attached (even on hold/escalate).
  // proposed_basis: the reference the sell rationale leans on. We use the sign-off-frozen REFERENCE fair
  // value when known (a sound sell reasons FROM intrinsic/reference value, not from cost); when no frozen
  // reference exists we fall back to the cost basis so the anchoring guard fail-safes to no caveat (it
  // requires a usable reference to fire). The anchoring/disposition bias guard (a real safety property)
  // therefore still functions on the lighter freeze — its price anchor is now the frozen reference.
  const proposed_basis = args.frozen_reference_fair_value ?? args.cost_basis_per_share
  const worst_case = buildWorstCase(args)
  const bias_caveats = collectSellBiasCaveats({
    at_loss,
    impairment_call,
    proposed_basis,
    cost_basis_per_share: args.cost_basis_per_share,
    // The guard's `frozen_iv` parameter is a generic PRICE anchor; feed it the frozen reference.
    frozen_iv: args.frozen_reference_fair_value,
  })

  // A recommendation builder shared by every terminal outcome — guarantees worst_case + caveats ride
  // along on EVERY return (the structural invariant a later S8 tripwire greps for).
  const buildRecommendation = (extra: {
    status: SellDecisionStatus
    reason_code: SellReviewReasonCode
    reason: string
    requires_human_signoff: boolean
  }): SellRecommendation => {
    const rec: SellRecommendation = {
      trigger: args.trigger,
      impairment_call,
      minimum_hold_decision: guard.decision,
      ...(finite(args.frozen_oe_ps) ? { frozen_oe_ps: args.frozen_oe_ps } : {}),
      ...(finite(args.frozen_reference_fair_value)
        ? { frozen_reference_fair_value: args.frozen_reference_fair_value }
        : {}),
      worst_case,
      bias_caveats,
      requires_human_signoff: extra.requires_human_signoff,
      reason_code: extra.reason_code,
      reason: extra.reason,
      is_observation: true,
    }
    if (extra.status === 'sell_review') {
      // Build the SELL-REVIEW scaffold (the human-authored exit draft). The holding identity is unknown
      // to this pure assembler; S8 supplies it. We use a placeholder holding so the scaffold's
      // sell-discipline reasons/weakest-reason structure rides along; S8 may rebuild with real ids.
      const scaffoldHolding: MonitorHoldingInput = { holding_id: '' }
      rec.sell_review_draft = buildSellReviewScaffold(scaffoldHolding, {
        reason_code: extra.reason_code,
        detail: extra.reason,
      })
    }
    return rec
  }

  // hold_blocks_sell → hold (the guard held — correct posture; still attach worst_case + caveats).
  if (guard.decision === 'hold_blocks_sell') {
    return {
      status: 'hold',
      recommendation: buildRecommendation({
        status: 'hold',
        reason_code: args.trigger === 'better_opportunity' ? 'better_opportunity_under_constraint' : 'thesis_broken',
        reason: guard.reason,
        requires_human_signoff: false,
      }),
    }
  }

  // escalate_human_review → escalate_review (the unresolved / incoherent path — surfaced, never defaulted).
  if (guard.decision === 'escalate_human_review') {
    return {
      status: 'escalate_review',
      recommendation: buildRecommendation({
        status: 'escalate_review',
        reason_code: 'thesis_broken',
        reason: guard.reason,
        requires_human_signoff: true,
      }),
    }
  }

  // release_through_guard | inactive → trigger-specific logic.
  const released = guard.decision === 'release_through_guard'

  switch (args.trigger) {
    case 'valuation_inverted': {
      // PRICE-DRIVEN, but never price-ALONE (scope-reframe): a LIGHT price-vs-frozen-reference sanity FLAG.
      // The live price is compared against the SIGN-OFF-FROZEN reference fair value (don't-move-the-number
      // F.9/F.10 — never a recomputed live band, there is none) and flags only at/above the frozen
      // reference. This FLAG is advisory and feeds the human decision — never an auto-sell.
      const inv = evaluateValuationInverted({
        current_price: args.current_price,
        frozen_reference_fair_value: args.frozen_reference_fair_value,
        frozen_oe_ps: args.frozen_oe_ps,
        params,
      })
      if (inv.status === 'cannot_assess') {
        // No sign-off-frozen IV → cannot assess. A raw price move ALONE can never produce a sell_review.
        return { status: 'cannot_assess' }
      }
      if (inv.status === 'not_inverted') {
        // Price has not reached the frozen IV — no sale.
        return {
          status: 'hold',
          recommendation: buildRecommendation({
            status: 'hold',
            reason_code: 'valuation_inverted',
            reason: inv.reason,
            requires_human_signoff: false,
          }),
        }
      }
      return {
        status: 'sell_review',
        recommendation: buildRecommendation({
          status: 'sell_review',
          reason_code: 'valuation_inverted',
          reason: inv.reason,
          requires_human_signoff: true,
        }),
      }
    }

    case 'better_opportunity': {
      if (!finite(args.candidate_oe_yield) || !finite(args.held_oe_yield)) {
        return { status: 'cannot_assess' }
      }
      const better = evaluateBetterOpportunity({
        candidate_oe_yield: args.candidate_oe_yield,
        held_oe_yield: args.held_oe_yield,
        switching_friction: finite(args.switching_friction) ? args.switching_friction : 0,
        params,
      })
      if (!better.switch_warranted) {
        return {
          status: 'hold',
          recommendation: buildRecommendation({
            status: 'hold',
            reason_code: 'better_opportunity_under_constraint',
            reason: better.reason,
            requires_human_signoff: false,
          }),
        }
      }
      return {
        status: 'sell_review',
        recommendation: buildRecommendation({
          status: 'sell_review',
          reason_code: 'better_opportunity_under_constraint',
          // better_opportunity ALWAYS requires human sign-off as a structural gate (never mechanical).
          reason: better.reason,
          requires_human_signoff: true,
        }),
      }
    }

    case 'thesis_broke': {
      // Reaching here means the guard released (permanent, through the window) OR was inactive (out-of-window
      // or not-at-loss). Use `minimum_hold_released` when the broken thesis fired THROUGH the window
      // (release_through_guard); `thesis_broken` otherwise (inactive).
      const reason_code: SellReviewReasonCode = released ? 'minimum_hold_released' : 'thesis_broken'
      return {
        status: 'sell_review',
        recommendation: buildRecommendation({
          status: 'sell_review',
          reason_code,
          reason: guard.reason,
          requires_human_signoff: true,
        }),
      }
    }

    case 'original_mistake': {
      // The original buy was the error — a guard override (released) or out-of-window (inactive).
      return {
        status: 'sell_review',
        recommendation: buildRecommendation({
          status: 'sell_review',
          reason_code: 'original_mistake',
          reason: guard.reason,
          requires_human_signoff: true,
        }),
      }
    }

    default: {
      // Fail-closed: an unrecognized trigger never silently sells.
      const exhaustive: never = args.trigger
      void exhaustive
      return { status: 'cannot_assess' }
    }
  }
}
