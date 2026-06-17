// scope-reframe — the "valuation-inverted" sell is now a LIGHT price-vs-frozen-reference SANITY FLAG
// (advisory), NOT a band engine. Pure, deterministic, no I/O, no LLM.
//
// The band/gap decision engine (R1/R2) was removed. This trigger no longer keys off a frozen
// sustainable-growth BAND. It keys off a frozen REFERENCE fair value (`frozen_reference_fair_value`) — the
// signed-off reference FV — and fires `inverted` (an ADVISORY FLAG feeding the sell decision + the model's
// hold/trim assessment) when the LIVE price runs FAR above what the frozen reference assumed:
//
//   inverted IFF  current_price >= frozen_reference_fair_value × sell_fraction   (default fraction 1.0)
//
// Determinism here = arithmetic + a flag + the human boundary; NOT a band engine. This is NOT an auto-sell:
// the human decides the irreversible close. Two hard constraints survive:
//
//   1. DON'T MOVE THE NUMBER (F.9/F.10). The reference + oe_ps are the SIGN-OFF-FROZEN values, read off the
//      sign-off-frozen projection — never a recomputed live band (there is none). This function takes the
//      already-frozen reference + oe_ps; it never fetches or recomputes a live valuation.
//
//   2. HOLD BIAS. The flag fires only at/above the FULL frozen reference (the configured `sell_band_fraction`,
//      default 1.0 — a HARD threshold, NOT a wider band). Biased to HOLD below the reference.
//
// `frozen_oe_ps` is still required for fail-closed parity with the freeze (a reference with no oe_ps is not
// a usable sign-off freeze); the implied growth off the live price is reported for context only.

import { marketImpliedGrowth } from './reverseDcf'
import { SELL_PARAMS, type SellParams } from './sellParams'

/** The valuation-inverted FLAG result. */
export type ValuationInvertedStatus = 'inverted' | 'not_inverted' | 'cannot_assess'

export type ValuationInvertedResult = {
  status: ValuationInvertedStatus
  /**
   * The market-IMPLIED near-term growth solved off the LIVE price against the FROZEN oe_ps — reported for
   * CONTEXT only (it is no longer the trigger; the trigger is the price-vs-reference comparison). Present
   * only when it could be solved; absent on `cannot_assess`.
   */
  implied_growth?: number
  /** Human-readable reason carrying the cause (the live price ran above the frozen reference) or fail-closed. */
  reason: string
}

/**
 * Evaluate the valuation-inverted sell FLAG (light price-vs-frozen-reference sanity check).
 *
 * @param current_price                The current per-share LIVE price (the comparison INPUT).
 * @param frozen_reference_fair_value  The SIGN-OFF-FROZEN reference fair value per share the live price is
 *                                     compared against. MUST be the frozen projection value; never recomputed
 *                                     here. Undefined/≤0/non-finite → `cannot_assess` (FAIL-CLOSED).
 * @param frozen_oe_ps                 The SIGN-OFF-FROZEN normalized owner-earnings/share. Undefined/≤0 →
 *                                     `cannot_assess` (FAIL-CLOSED). Used to report the implied growth for
 *                                     context (not the trigger).
 * @param params                       Sell parameter set (defaults to SELL_PARAMS); `sell_band_fraction` is
 *                                     the threshold fraction (default 1.0 = the FULL frozen reference).
 *
 * Inverted IFF `current_price >= frozen_reference_fair_value × sell_band_fraction`.
 *
 * NOTE: there is deliberately NO live-band parameter. Don't-move-the-number (F.9/F.10): the flag keys ONLY
 * off the frozen reference + the live price — never a recomputed live band (there is none).
 */
export function evaluateValuationInverted({
  current_price,
  frozen_reference_fair_value,
  frozen_oe_ps,
  params = SELL_PARAMS,
}: {
  current_price: number
  frozen_reference_fair_value: number | undefined
  frozen_oe_ps: number | undefined
  params?: SellParams
}): ValuationInvertedResult {
  // FAIL-CLOSED: with no usable frozen reference / oe_ps the FLAG cannot assess; it never manufactures or
  // suppresses a sell, and it never recomputes a live valuation.
  if (
    frozen_reference_fair_value === undefined
    || !Number.isFinite(frozen_reference_fair_value)
    || frozen_reference_fair_value <= 0
  ) {
    return {
      status: 'cannot_assess',
      reason:
        'No sign-off-frozen reference fair value available — cannot assess valuation inversion (fail-closed).',
    }
  }
  if (frozen_oe_ps === undefined || !Number.isFinite(frozen_oe_ps) || frozen_oe_ps <= 0) {
    return {
      status: 'cannot_assess',
      reason:
        'No sign-off-frozen owner-earnings/share available — cannot assess valuation inversion (fail-closed).',
    }
  }
  // FAIL-CLOSED: a non-finite / non-positive live price can never produce a sell — a missing price is never
  // a sell.
  if (!Number.isFinite(current_price) || current_price <= 0) {
    return {
      status: 'cannot_assess',
      reason:
        `No usable live price (${current_price}) — cannot assess valuation inversion (fail-closed).`,
    }
  }

  // Report the market-IMPLIED near-term growth off the LIVE price against the FROZEN oe_ps for CONTEXT only
  // (it feeds the human-facing reason; it is NOT the trigger). The trigger is the price-vs-reference
  // comparison below. The implied growth may be unsolvable for an extreme price; that is non-fatal here.
  const implied = marketImpliedGrowth({ price: current_price, oe_ps: frozen_oe_ps })
  const impliedGrowth = Number.isFinite(implied.implied_growth) ? implied.implied_growth : undefined

  const threshold = frozen_reference_fair_value * params.sell_band_fraction
  const num = (v: number): string => v.toFixed(2)
  const growthNote =
    impliedGrowth === undefined ? '' : ` (live price implies ~${(impliedGrowth * 100).toFixed(1)}% growth)`

  if (current_price >= threshold) {
    return {
      status: 'inverted',
      ...(impliedGrowth === undefined ? {} : { implied_growth: impliedGrowth }),
      reason:
        `Live price ${num(current_price)} is at/above the sign-off-frozen reference fair value `
        + `(${num(frozen_reference_fair_value)}, threshold ${num(threshold)})${growthNote}. ADVISORY FLAG: `
        + 'the market prices the name richly vs the signed-off reference — review for a possible trim/exit. '
        + 'The human decides the irreversible close (never an auto-sell).',
    }
  }

  return {
    status: 'not_inverted',
    ...(impliedGrowth === undefined ? {} : { implied_growth: impliedGrowth }),
    reason:
      `Live price ${num(current_price)} is below the sign-off-frozen reference fair value `
      + `(${num(frozen_reference_fair_value)}, threshold ${num(threshold)})${growthNote}. Hold bias intact.`,
  }
}
