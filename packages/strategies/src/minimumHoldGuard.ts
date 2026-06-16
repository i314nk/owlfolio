// Phase 6 S2 — the minimum-hold GUARD (pure, deterministic, no I/O, no LLM).
//
// The CENTRAL Phase-6 reconciliation: a 2–3 year minimum-hold guard ("don't sell at a loss inside the
// window") collides with the "thesis broke → sell" trigger. This guard resolves that WITHOUT inventing
// its own clock-based judgment. It CONSUMES the same fixable-vs-permanent call the admit / heldImpairment
// layer already produces (`impairment_call`) so a genuinely broken thesis fires THROUGH the guard while
// loss-driven impatience is braked.
//
// There is deliberately NO age-only / clock-only release path here: the ONLY ways to reach
// `release_through_guard` are (`thesis_broke` + `permanent_impairment`) or `original_mistake`, both
// requiring `at_loss && within_window`. The window rule itself is single-sourced in S1
// (holdingMinimumHoldStatus); this function takes `within_window` directly as a boolean rather than
// recomputing age — see the inputs note below.

/**
 * The shared fixable-vs-permanent judgment, structurally mirroring
 * `@owlfolio/workflow`'s admitJudgment.ImpairmentCall.
 *
 * Defined LOCALLY (not imported) on purpose: `@owlfolio/strategies` does not depend on
 * `@owlfolio/workflow` (see package.json — only zod), and we keep strategies independent of workflow.
 * A small structural duplicate of this 3-member string-union is the correct trade-off here. The guard
 * never recomputes this call; it only consumes the value the upstream judgment produced.
 */
export type ImpairmentCall = 'fixable_temporary' | 'permanent_impairment' | 'unresolved'

/** Why a held name is being considered for sale inside the minimum-hold window. */
export type MinimumHoldTrigger =
  | 'thesis_broke'
  | 'valuation_inverted'
  | 'better_opportunity'
  | 'original_mistake'

/**
 * The canonical runtime list of WHICH minimum-hold triggers exist, in canonical order.
 *
 * This is the SINGLE SOURCE for callers that need to enumerate the triggers at runtime (e.g. the web
 * picker, validators). It is typed `readonly MinimumHoldTrigger[]` and the `satisfies` exhaustiveness check
 * below makes adding a member to the union a COMPILE ERROR until it is listed here — so this list can never
 * silently drift from the union. This carries only the trigger VALUES (no UI copy/labels — those belong in
 * the consuming layer).
 */
export const MINIMUM_HOLD_TRIGGERS = [
  'thesis_broke',
  'valuation_inverted',
  'better_opportunity',
  'original_mistake',
] as const satisfies readonly MinimumHoldTrigger[]

// Anti-drift guard (compile-time only): asserts MINIMUM_HOLD_TRIGGERS covers the WHOLE union. If a member
// is added to MinimumHoldTrigger but not to the array above, `_TriggerCoverage` becomes a non-`never` type
// and this assignment fails to compile.
type _MissingTrigger = Exclude<MinimumHoldTrigger, (typeof MINIMUM_HOLD_TRIGGERS)[number]>
const _triggerCoverage: _MissingTrigger extends never ? true : never = true
void _triggerCoverage

/**
 * The guard's verdict on a candidate sell:
 * - `release_through_guard`: the sale proceeds despite the window (a broken thesis / recognized mistake).
 * - `hold_blocks_sell`: the disposition brake holds — a loss-driven sale on a fixable stumble (or churn).
 * - `escalate_human_review`: the system cannot make the call safely; surface it rather than default.
 * - `inactive`: the guard does not engage (not a loss sale, or already past the window).
 */
export type GuardDecision =
  | 'release_through_guard'
  | 'hold_blocks_sell'
  | 'escalate_human_review'
  | 'inactive'

/**
 * Inputs to the guard. All booleans / pre-computed enums — the guard performs no I/O and no arithmetic.
 *
 * NOTE on `within_window` (intentional): the Phase-6 plan listed `holding_age_months`, but this guard
 * consumes the pre-computed `within_window` boolean instead. The caller (S6) computes it via S1's
 * `holdingMinimumHoldStatus`, which keeps the fail-closed window rule SINGLE-SOURCED in S1. Recomputing
 * age (and the < minimum_hold_months comparison) here would create a second source of truth for that
 * rule; we deliberately avoid that.
 */
export type MinimumHoldGuardArgs = {
  trigger: MinimumHoldTrigger
  impairment_call: ImpairmentCall
  /** True when the candidate sale would realize a loss vs the cost basis. */
  at_loss: boolean
  /** True while the name is still inside the minimum-hold window (from S1's holdingMinimumHoldStatus). */
  within_window: boolean
}

/**
 * Applies the minimum-hold guard to a candidate sell.
 *
 * Pre-gate: the guard ONLY ever brakes LOSS sales inside the window. A non-loss sale (e.g. a
 * valuation-inverted sale at/above intrinsic value) → `inactive`. A sale past the window → `inactive`
 * (the trigger proceeds on its own terms).
 *
 * Inside the window AND at a loss, the verdict comes from an EXPLICIT per-trigger × impairment_call
 * matrix (see the spec comments inline). The guard never recomputes the impairment judgment.
 */
export function applyMinimumHoldGuard(
  args: MinimumHoldGuardArgs,
): { decision: GuardDecision; reason: string } {
  const { trigger, impairment_call, at_loss, within_window } = args

  // --- Pre-gate: the guard only brakes LOSS sales inside the window. ---
  if (!at_loss) {
    return {
      decision: 'inactive',
      reason:
        `not a loss sale (trigger=${trigger}) — the minimum-hold guard only brakes loss sales; `
        + 'a sale at/above cost (e.g. a valuation-inverted gain) proceeds on its own terms.',
    }
  }
  if (!within_window) {
    return {
      decision: 'inactive',
      reason:
        `past the minimum-hold window (trigger=${trigger}) — the guard does not engage; the trigger `
        + 'proceeds on its own terms.',
    }
  }

  // --- Inside the window AND at a loss: explicit per-trigger × impairment_call matrix. ---
  switch (trigger) {
    case 'original_mistake':
      // A never-valid thesis is a guard-OVERRIDE, not a fixable stumble — it releases regardless of
      // impairment_call (it does not depend on fixable-vs-permanent; the original buy was the error).
      return {
        decision: 'release_through_guard',
        reason:
          'recognized original mistake — the thesis was never valid, so this is a guard override, not a '
          + 'fixable stumble; the sale releases through the guard regardless of impairment_call '
          + `(impairment_call=${impairment_call}).`,
      }

    case 'thesis_broke':
      switch (impairment_call) {
        case 'permanent_impairment':
          // A genuinely broken thesis fires THROUGH the guard.
          return {
            decision: 'release_through_guard',
            reason:
              'thesis_broke + permanent_impairment — a genuinely broken thesis fires through the guard; '
              + 'the sale releases.',
          }
        case 'fixable_temporary':
          // The disposition brake: loss-driven impatience on a fixable stumble inside the window.
          return {
            decision: 'hold_blocks_sell',
            reason:
              'thesis_broke + fixable_temporary — the stumble is fixable/temporary, so a loss sale inside '
              + 'the minimum-hold window is loss-driven impatience; the hold blocks the sell.',
          }
        case 'unresolved':
          // The system CANNOT tell fixable-vs-permanent (the Horsehead trap): surface it. Defaulting to
          // hold would make a consequential call by inaction — `unresolved` must NEVER route to
          // hold_blocks_sell.
          return {
            decision: 'escalate_human_review',
            reason:
              'thesis_broke + unresolved — the system cannot tell fixable-vs-permanent; escalating for '
              + 'human review (defaulting to hold would be a consequential call by inaction — the '
              + 'Horsehead trap).',
          }
        default: {
          const exhaustive: never = impairment_call
          return {
            decision: 'escalate_human_review',
            reason: `unrecognized impairment_call (${String(exhaustive)}) — escalating (fail-closed).`,
          }
        }
      }

    case 'better_opportunity':
      // Selling a holding at a loss inside the 2–3yr window to chase "better" is exactly the churn the
      // guard exists to prevent — so the hold blocks the sell, UNCONDITIONALLY (regardless of
      // impairment_call, including `unresolved`). The `unresolved`→never-silently-hold invariant is
      // scoped to the IMPAIRMENT-JUDGMENT-DRIVEN path (`thesis_broke`), where the held name's own
      // fixable-vs-permanent status IS the decision and an unknown there is the Horsehead trap. Here the
      // decision is switching discipline, not impairment: blocking does not trap you in a real impairment
      // (if the holding were impaired, that is the `thesis_broke` channel, which releases). Escalating on
      // `unresolved` here would be a churn loophole — leave impairment unresolved (easy on a thin corpus)
      // to convert a should-be-blocked switch into an approvable escalation. So: block, full stop.
      return {
        decision: 'hold_blocks_sell',
        reason:
          'better_opportunity — selling at a loss inside the minimum-hold window to chase a "better" idea '
          + 'is the churn the guard exists to prevent; the hold blocks the sell unconditionally '
          + `(impairment_call=${impairment_call}; the unresolved→escalate rule is scoped to thesis_broke, `
          + 'where impairment is the decision — not to switching discipline).',
      }

    case 'valuation_inverted':
      // INCOHERENT: valuation_inverted means price ≥ intrinsic value (a gain), which the !at_loss pre-gate
      // should have caught. Reaching here at a loss is an inconsistent input; do not silently pick
      // hold/release — escalate.
      return {
        decision: 'escalate_human_review',
        reason:
          'valuation_inverted + at_loss is incoherent — valuation-inverted means price ≥ intrinsic value '
          + '(a gain), which the loss pre-gate should have filtered; escalating the inconsistent input '
          + 'rather than silently holding or releasing.',
      }

    default: {
      const exhaustive: never = trigger
      return {
        decision: 'escalate_human_review',
        reason: `unrecognized trigger (${String(exhaustive)}) — escalating (fail-closed).`,
      }
    }
  }
}
