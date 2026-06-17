// valuation-core revision — the "valuation-inverted" sell trigger, REKEYED to implied-growth-vs-FROZEN-band
// (the MIRROR of the reverse-DCF-vs-band BUY). Pure, deterministic, no I/O, no LLM.
//
// One of the four sell triggers. It fires when the market now implies near-term growth ABOVE what the
// business can sustain — i.e. the held name's margin of safety is gone — the exact mirror of the BUY side,
// which fires when the market implies growth BELOW the band (cheap). Two hard constraints from the owner:
//
//   1. DON'T MOVE THE NUMBER (F.9/F.10). The growth this compares against the frozen band ceiling is the
//      market-IMPLIED growth solved off the LIVE price against the SIGN-OFF-FROZEN band/oe_ps + the frozen
//      valuation params (discount/terminal/horizon/fade). It is NEVER a recomputed LIVE band: the agent
//      must not be able to nudge it to manufacture or suppress a sell. This function therefore takes the
//      already-frozen `frozen_band_high` + `frozen_oe_ps` and only solves implied growth off them; it must
//      never fetch or recompute a live sustainable band. The caller reads the frozen band/oe_ps off the
//      sign-off-frozen projection fields (nameLifecycle.frozen_band_high / frozen_oe_ps).
//
//   2. PABRAI RECANT. Selling winners at 90-95% of IV was Pabrai's documented biggest mistake, so the
//      trigger fires only at/above the FULL frozen band ceiling (the configured `sell_band_fraction`,
//      default 1.0 — a HARD threshold, NOT a wider band). The trigger is biased to HOLD below the ceiling.
//
// The CAUSE of an inversion is "the market now implies growth above the frozen sustainable ceiling": the
// LIVE price is the INPUT to the reverse-DCF, the frozen band/oe_ps are the fixed references. Every constant
// is read from SELL_PARAMS (no magic numbers).

import { marketImpliedGrowth } from './reverseDcf'
import { SELL_PARAMS, type SellParams } from './sellParams'

/**
 * Numerical slack on the at-threshold comparison. The market-implied growth is solved by BISECTION
 * (reverse-DCF), so an implied growth that is mathematically AT the threshold lands a few solver-tolerance
 * units below it (e.g. solving the price for g=0.10 returns 0.0999998…). This epsilon — far smaller than any
 * real decision margin (1e-4 growth-points ≈ a hundredth of a basis point of growth) — makes the
 * at-the-ceiling case fire deterministically rather than flicker on solver noise. It is NOT a decision band:
 * the Pabrai-recant HARD threshold is still `frozen_band_high × sell_band_fraction`.
 */
const IMPLIED_GROWTH_AT_THRESHOLD_EPSILON = 1e-4

/** The valuation-inverted trigger result. */
export type ValuationInvertedStatus = 'inverted' | 'not_inverted' | 'cannot_assess'

export type ValuationInvertedResult = {
  status: ValuationInvertedStatus
  /**
   * The market-IMPLIED near-term growth solved off the LIVE price against the FROZEN band/oe_ps. Present
   * only when it could be solved (positive frozen oe_ps + a solvable price); absent on `cannot_assess`.
   */
  implied_growth?: number
  /** Human-readable reason carrying the cause ("market implies growth above the frozen ceiling") or the fail-closed reason. */
  reason: string
}

/**
 * Evaluate the valuation-inverted sell trigger (implied-growth-vs-FROZEN-band).
 *
 * @param current_price    The current per-share LIVE price (the reverse-DCF INPUT).
 * @param frozen_band_high The SIGN-OFF-FROZEN sustainable-growth band HIGH edge — the ceiling the market
 *                         must price ABOVE to invert. MUST be the frozen projection value; this function
 *                         never recomputes a live band. Undefined/non-finite → `cannot_assess` (FAIL-CLOSED).
 * @param frozen_oe_ps     The SIGN-OFF-FROZEN normalized owner-earnings/share the implied growth is solved
 *                         against. Undefined/≤0 → `cannot_assess` (FAIL-CLOSED).
 * @param terminal_g       Frozen terminal growth; defaults to the valuation-params default (reverse-DCF default).
 * @param discount         Frozen discount rate; defaults to the valuation-params default (reverse-DCF default).
 * @param horizon          Frozen stage-1 horizon; defaults to the valuation-params default.
 * @param fade_years       Frozen trailing fade years; defaults to the valuation-params default.
 * @param params           Sell parameter set (defaults to SELL_PARAMS); `sell_band_fraction` is the threshold.
 *
 * Inverted IFF the implied growth is solvable AND `implied_growth >= frozen_band_high * sell_band_fraction`
 * (default fraction 1.0 = the FULL frozen band ceiling).
 *
 * NOTE: there is deliberately NO live-band parameter. Don't-move-the-number (F.9/F.10): the inversion keys
 * ONLY off the frozen band/oe_ps + the live price, never a recomputed live band.
 */
export function evaluateValuationInverted({
  current_price,
  frozen_band_high,
  frozen_oe_ps,
  terminal_g,
  discount,
  horizon,
  fade_years,
  params = SELL_PARAMS,
}: {
  current_price: number
  frozen_band_high: number | undefined
  frozen_oe_ps: number | undefined
  terminal_g?: number
  discount?: number
  horizon?: number
  fade_years?: number
  params?: SellParams
}): ValuationInvertedResult {
  // FAIL-CLOSED: with no usable frozen band ceiling / oe_ps the trigger cannot assess; it never
  // manufactures or suppresses a sell, and it never recomputes a live band.
  if (frozen_band_high === undefined || !Number.isFinite(frozen_band_high)) {
    return {
      status: 'cannot_assess',
      reason:
        'No sign-off-frozen sustainable-growth band ceiling available — cannot assess valuation inversion (fail-closed).',
    }
  }
  if (frozen_oe_ps === undefined || !Number.isFinite(frozen_oe_ps) || frozen_oe_ps <= 0) {
    return {
      status: 'cannot_assess',
      reason:
        'No sign-off-frozen owner-earnings/share available — cannot solve market-implied growth (fail-closed).',
    }
  }

  // Solve the market-IMPLIED near-term growth off the LIVE price against the FROZEN oe_ps + frozen params.
  // The reverse-DCF inverts the SAME forward valuation the band/buy side uses, so reverse and forward stay
  // consistent. The band is NOT recomputed here — only the implied growth, against the frozen inputs.
  const implied = marketImpliedGrowth({
    price: current_price,
    oe_ps: frozen_oe_ps,
    ...(terminal_g === undefined ? {} : { terminal_g }),
    ...(discount === undefined ? {} : { discount }),
    ...(horizon === undefined ? {} : { horizon }),
    ...(fade_years === undefined ? {} : { fade_years }),
  })

  // FAIL-CLOSED: an unsolvable implied growth (not-computable price, or out of the solvable bracket) can
  // never produce a sell — a raw price move ALONE is never a sell.
  if (implied.implied_growth === undefined || !Number.isFinite(implied.implied_growth)) {
    return {
      status: 'cannot_assess',
      reason:
        `Market-implied growth could not be solved at price ${current_price} (status: ${implied.status}) — ` +
        'cannot assess valuation inversion (fail-closed).',
    }
  }

  const implied_growth = implied.implied_growth
  const threshold = frozen_band_high * params.sell_band_fraction
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

  if (implied_growth >= threshold - IMPLIED_GROWTH_AT_THRESHOLD_EPSILON) {
    return {
      status: 'inverted',
      implied_growth,
      reason:
        `Market now implies ${pct(implied_growth)} growth — at/above the sign-off-frozen sustainable ` +
        `ceiling (band-high ${pct(frozen_band_high)}, threshold ${pct(threshold)}). Margin of safety gone ` +
        '(the mirror of the buy: high implied = priced above what the business can sustain = overvalued).',
    }
  }

  return {
    status: 'not_inverted',
    implied_growth,
    reason:
      `Market implies ${pct(implied_growth)} growth — below the sign-off-frozen sustainable ceiling ` +
      `(band-high ${pct(frozen_band_high)}, threshold ${pct(threshold)}). Margin of safety intact (holds ` +
      'below the frozen band ceiling).',
  }
}
