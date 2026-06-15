// Phase 6 S3 — the "valuation-inverted" sell trigger (pure, deterministic, no I/O, no LLM).
//
// One of the four Phase-6 sell triggers. It fires when the current price has RISEN to the position's
// intrinsic value (IV), so the margin of safety is gone. Two hard constraints from the owner:
//
//   1. DON'T MOVE THE NUMBER (F.9/F.10). The IV this compares against is the UNDISCOUNTED intrinsic value
//      FROZEN AT SIGN-OFF — NOT the MoS-discounted buy-below (provisional, #124), and NEVER a live or
//      recomputed fair value. The agent must not be able to nudge it to manufacture or suppress a sell.
//      This function therefore takes the already-frozen number as `frozen_iv` and only COMPARES against
//      it; it must never fetch, recompute, or discount a fair value of its own. The caller is responsible
//      for reading `frozen_iv` off the sign-off-frozen projection field (nameLifecycleProjection.frozen_iv).
//
//   2. PABRAI RECANT. Selling winners at 90-95% of IV was Pabrai's documented biggest mistake, so the
//      trigger fires only at/above FULL IV (the configured `sell_iv_fraction`, default 1.0 — a HARD
//      threshold, NOT a band). The trigger is biased to HOLD below IV.
//
// The CAUSE of an inversion is "price reached the frozen IV": price is an INPUT to the comparison, the
// frozen IV is the fixed reference. Every constant is read from SELL_PARAMS (no magic numbers).

import { SELL_PARAMS, type SellParams } from './sellParams'

/** The valuation-inverted trigger result. */
export type ValuationInvertedStatus = 'inverted' | 'not_inverted' | 'cannot_assess'

export type ValuationInvertedResult = {
  status: ValuationInvertedStatus
  /**
   * `current_price / frozen_iv` — how far price has run toward (≥1.0 = past) the frozen IV. Present only
   * when the IV could be assessed (a positive `frozen_iv`); absent on `cannot_assess`.
   */
  fraction_of_iv?: number
  /** Human-readable reason carrying the cause ("price reached the frozen IV") or the fail-closed reason. */
  reason: string
}

/**
 * Evaluate the valuation-inverted sell trigger.
 *
 * @param current_price  The current per-share price (the comparison INPUT).
 * @param frozen_iv      The SIGN-OFF-FROZEN undiscounted intrinsic value per share. MUST be the frozen
 *                       projection value — this function never fetches or recomputes a live fair value.
 *                       Undefined/≤0 → `cannot_assess` (FAIL-CLOSED; it never falls back to the
 *                       discounted buy-below or any other number).
 * @param params         Sell parameter set (defaults to SELL_PARAMS); `sell_iv_fraction` is the threshold.
 *
 * Inverted IFF `current_price >= frozen_iv * params.sell_iv_fraction` (default fraction 1.0 = full IV).
 */
export function evaluateValuationInverted({
  current_price,
  frozen_iv,
  params = SELL_PARAMS,
}: {
  current_price: number
  frozen_iv: number | undefined
  params?: SellParams
}): ValuationInvertedResult {
  // FAIL-CLOSED: with no usable frozen IV the trigger cannot assess; it never manufactures/suppresses a
  // sell and never falls back to the discounted buy-below.
  if (frozen_iv === undefined || !Number.isFinite(frozen_iv) || frozen_iv <= 0) {
    return {
      status: 'cannot_assess',
      reason:
        'No sign-off-frozen intrinsic value available — cannot assess valuation inversion (fail-closed).',
    }
  }

  // Compare on the dimensionless fraction (price/IV ≥ threshold-fraction) rather than reconstructing a
  // price threshold via frozen_iv * fraction — the multiply-then-compare form introduces floating-point
  // asymmetry (e.g. 100 * 1.1 = 110.00000000000001 > 110), which would spuriously not-fire at exactly the
  // configured fraction. The fraction form keeps the at-threshold case exact.
  const fraction_of_iv = current_price / frozen_iv

  if (fraction_of_iv >= params.sell_iv_fraction) {
    return {
      status: 'inverted',
      fraction_of_iv,
      reason:
        `Price (${current_price}) reached the sign-off-frozen intrinsic value (${frozen_iv}) at ` +
        `${(fraction_of_iv * 100).toFixed(0)}% of IV — margin of safety gone (threshold ` +
        `${(params.sell_iv_fraction * 100).toFixed(0)}% of frozen IV).`,
    }
  }

  return {
    status: 'not_inverted',
    fraction_of_iv,
    reason:
      `Price (${current_price}) is below the sign-off-frozen intrinsic value (${frozen_iv}) at ` +
      `${(fraction_of_iv * 100).toFixed(0)}% of IV — margin of safety intact (holds below the ` +
      `${(params.sell_iv_fraction * 100).toFixed(0)}% of frozen IV threshold).`,
  }
}
