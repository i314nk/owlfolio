// Valuation sensitivity range (Phase 2): a low/base/high FAIR-VALUE band for a name whose width is
// driven by the GROWTH MEASURE'S OWN UNCERTAINTY — thin history and/or high dispersion widen the band,
// so a short-history, high-variance name (e.g. GOOGL, 5 points + high dispersion) is honestly presented
// with a WIDE range rather than false precision.
//
// The band straddles the CREDITED (capped, floored) growth, not the raw demonstrated rate:
//   - the DOWNSIDE bands the credited rate BELOW the cap ("what if it doesn't even sustain the capped rate?"),
//   - the UPSIDE is bounded by the named single_growth_cap. For a name whose demonstrated growth already
//     exceeds the cap, the upside equals the base (a zero-WIDTH upside) — so we SURFACE `cap_binding` to
//     flag that the base fair value is cap-LIMITED, never presenting that flat upside as confident headroom.
//
// We reuse the SAME forward faded two-stage DCF (`twoStageValuation`) the rest of the engine uses, so the
// band stays consistent with the point estimate and the reverse-DCF solver.
//
// PURE + deterministic. No network, no Date, no Math.random.

import { creditedGrowth, discountRate, twoStageValuation } from './buffettMunger'
import type { StrategyContract } from './strategyContract'
import { VALUATION_PARAMS } from './valuationParams'

export type ValuationSensitivity = {
  /** True when a fair-value band could be computed (finite, positive inputs). */
  computable: boolean
  /** Faded two-stage fair value per share at the low (banded-down credited) growth. */
  fair_value_low?: number
  /** Faded two-stage fair value per share at the base (credited) growth. */
  fair_value_base?: number
  /** Faded two-stage fair value per share at the high (cap-bounded) growth. */
  fair_value_high?: number
  /** Low scenario near-term growth (credited rate banded DOWN, below the cap, floored at 0). */
  growth_low: number
  /** Base scenario near-term growth (the credited, capped, floored rate). */
  growth_base: number
  /** High scenario near-term growth (demonstrated banded UP, bounded by the cap). */
  growth_high: number
  /** (fair_value_high − fair_value_low) / fair_value_base; undefined when base is not > 0. */
  range_pct?: number
  /** demonstrated_growth > single_growth_cap → the base FV is cap-LIMITED (not growth-limited). Surfaced. */
  cap_binding: boolean
  /** The clamped fraction by which the band straddles the credited rate. */
  band_fraction: number
  /** The uncertainty inputs that drove the band width. */
  uncertainty: { points_used: number; high_dispersion: boolean }
}

/** Base band fraction before any uncertainty add-ons. */
const BASE_BAND_FRACTION = 0.15
/** Add-on when the history is thin (fewer than this many points). */
const THIN_HISTORY_THRESHOLD = 8
const THIN_HISTORY_ADD = 0.25
/** Add-on when the growth measure shows high dispersion. */
const HIGH_DISPERSION_ADD = 0.25
/** Band fraction clamp bounds. */
const BAND_FRACTION_MIN = 0.10
const BAND_FRACTION_MAX = 0.65

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * Compute a low/base/high fair-value band for a name whose width WIDENS with the growth measure's own
 * uncertainty (thin history / high dispersion) and which FLAGS when the named growth cap is binding.
 *
 * The band straddles the CREDITED (capped, floored) growth (see `creditedGrowth`):
 *   - `growth_base = creditedGrowth(strategy, { demonstrated_growth }).growth` (≤ cap, ≥ 0),
 *   - `growth_low  = max(0, growth_base · (1 − band_fraction))` — bands the credited rate DOWN, below the cap,
 *   - `growth_high = min(single_growth_cap, demonstrated_growth · (1 + band_fraction))` — upside bounded by
 *     the cap; for a name whose demonstrated growth already exceeds the cap this collapses to the cap (= base).
 * Each scenario g is fed straight into the faded `twoStageValuation` (already ≤ cap and ≥ 0).
 *
 * Fail-closed: non-finite/≤0 `oe_ps` or non-finite `demonstrated_growth` → `computable: false`, no fair
 * values, no throw.
 */
export function valuationSensitivity(
  strategy: StrategyContract,
  args: {
    oe_ps: number
    demonstrated_growth: number
    points_used: number
    high_dispersion: boolean
    terminal_g?: number
    discount?: number
    horizon?: number
    fade_years?: number
  },
): ValuationSensitivity {
  const { oe_ps, demonstrated_growth, points_used, high_dispersion } = args
  const cap = strategy.valuation.single_growth_cap

  const band_fraction = clamp(
    BASE_BAND_FRACTION
      + (points_used < THIN_HISTORY_THRESHOLD ? THIN_HISTORY_ADD : 0)
      + (high_dispersion ? HIGH_DISPERSION_ADD : 0),
    BAND_FRACTION_MIN,
    BAND_FRACTION_MAX,
  )

  const cap_binding = Number.isFinite(demonstrated_growth) && demonstrated_growth > cap
  const uncertainty = { points_used, high_dispersion }

  // Fail-closed on non-finite/non-positive inputs — return the shape with no fair values.
  if (
    !Number.isFinite(oe_ps) || oe_ps <= 0
    || !Number.isFinite(demonstrated_growth)
  ) {
    return {
      computable: false,
      growth_low: 0,
      growth_base: 0,
      growth_high: 0,
      cap_binding,
      band_fraction,
      uncertainty,
    }
  }

  const credited_base = creditedGrowth(strategy, { demonstrated_growth }).growth
  const growth_base = credited_base
  const growth_low = Math.max(0, credited_base * (1 - band_fraction))
  const growth_high = Math.min(cap, demonstrated_growth * (1 + band_fraction))

  const terminal_g = args.terminal_g ?? strategy.valuation.terminal_growth
  const discount = args.discount ?? discountRate(strategy)
  const horizon = args.horizon ?? strategy.valuation.stage1_horizon
  const fade_years = args.fade_years ?? VALUATION_PARAMS.growth_fade_years

  const fvAt = (g: number): number | undefined =>
    twoStageValuation({
      oe_ps,
      g,
      terminal_g,
      discount,
      ceiling_multiple: strategy.valuation.valuation_multiple_ceiling,
      absurd_multiple: strategy.valuation.fv_absurd_multiple,
      horizon,
      fade_years,
    }).fair_value

  const fair_value_low = fvAt(growth_low)
  const fair_value_base = fvAt(growth_base)
  const fair_value_high = fvAt(growth_high)

  const result: ValuationSensitivity = {
    computable: true,
    growth_low,
    growth_base,
    growth_high,
    cap_binding,
    band_fraction,
    uncertainty,
    ...(fair_value_low !== undefined ? { fair_value_low } : {}),
    ...(fair_value_base !== undefined ? { fair_value_base } : {}),
    ...(fair_value_high !== undefined ? { fair_value_high } : {}),
  }

  if (
    fair_value_low !== undefined
    && fair_value_base !== undefined
    && fair_value_high !== undefined
    && fair_value_base > 0
  ) {
    result.range_pct = (fair_value_high - fair_value_low) / fair_value_base
  }

  return result
}
