// Reverse-DCF core (Phase 2): "what near-term growth rate does the current market price IMPLY?"
//
// Inverts the harness's FADED two-stage DCF. The forward faded fair value per share is MONOTONICALLY
// INCREASING in the near-term growth g (for fixed oe_ps / terminal / discount / horizon / fade), so we
// BISECT for the g whose faded fair value equals the market price. We invert the SAME function the forward
// valuation uses (`twoStageValuation`'s faded `fair_value`), so reverse and forward stay consistent.
//
// This is the overconfidence-defense lead of the research dossier: "market implies X% growth vs our Y%".
//
// PURE + deterministic. No network, no Date, no Math.random.

import { buffettMungerStrategy, discountRate, twoStageValuation } from './buffettMunger'
import { VALUATION_PARAMS } from './valuationParams'

export type MarketImpliedGrowthResult = {
  /** Near-term g such that the faded two-stage FV per share == price; undefined if unsolvable/out-of-range. */
  implied_growth?: number
  status: 'solved' | 'above_range' | 'below_range' | 'not_computable'
  // Context flags (informational — NOT used to alter the solve):
  /** implied_growth > single_growth_cap — the market prices in growth the method would refuse to underwrite. */
  above_cap: boolean
  /** implied_growth > gdp_growth_threshold — an above-GDP rate is a moat-durability claim. */
  above_gdp: boolean
}

/** Low bracket for the near-term growth search (deep decline). */
const G_LOW = -0.5
/** High bracket for the near-term growth search (aggressive growth). */
const G_HIGH = 0.5
/** Step used to walk the high bracket down until the forward FV is finite (not absurd). */
const HIGH_BRACKET_STEP = 0.01
/** Bisection tolerances. */
const G_TOLERANCE = 1e-6
const REL_FV_TOLERANCE = 1e-6
const MAX_ITERATIONS = 200

export function marketImpliedGrowth(args: {
  /** Current market price per share. */
  price: number
  /** Owner earnings per share (same basis as price). */
  oe_ps: number
  /** Terminal growth; defaults to VALUATION_PARAMS.terminal_growth. */
  terminal_g?: number
  /** Discount rate; defaults to discountRate(buffettMungerStrategy). */
  discount?: number
  /** Stage-1 explicit horizon; defaults to VALUATION_PARAMS.stage1_horizon. */
  horizon?: number
  /** Trailing fade years; defaults to VALUATION_PARAMS.growth_fade_years. */
  fade_years?: number
}): MarketImpliedGrowthResult {
  const { price, oe_ps } = args
  const terminal_g = args.terminal_g ?? VALUATION_PARAMS.terminal_growth
  const discount = args.discount ?? discountRate(buffettMungerStrategy)
  const horizon = args.horizon ?? VALUATION_PARAMS.stage1_horizon
  const fade_years = args.fade_years ?? VALUATION_PARAMS.growth_fade_years

  // Fail-closed: non-finite / non-positive price or oe_ps.
  if (
    !Number.isFinite(price) || price <= 0
    || !Number.isFinite(oe_ps) || oe_ps <= 0
  ) {
    return { status: 'not_computable', above_cap: false, above_gdp: false }
  }

  // Forward faded FV per share at a near-term g, inverting the SAME function the forward valuation uses.
  // Returns undefined when the absurd-error guard fired (top of the solvable range).
  const fv = (g: number): number | undefined =>
    twoStageValuation({
      oe_ps,
      g,
      terminal_g,
      discount,
      ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
      absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
      horizon,
      fade_years,
    }).fair_value

  // Low bracket FV.
  const fvLow = fv(G_LOW)
  if (fvLow === undefined || !Number.isFinite(fvLow)) {
    // Should not happen for a deep-decline g, but fail-closed.
    return { status: 'not_computable', above_cap: false, above_gdp: false }
  }
  if (price < fvLow) {
    return { status: 'below_range', above_cap: false, above_gdp: false }
  }

  // High bracket: walk down from G_HIGH until the forward FV is finite (below the absurd ceiling).
  let gHigh = G_HIGH
  let fvHigh = fv(gHigh)
  while ((fvHigh === undefined || !Number.isFinite(fvHigh)) && gHigh > G_LOW) {
    gHigh -= HIGH_BRACKET_STEP
    fvHigh = fv(gHigh)
  }
  if (fvHigh === undefined || !Number.isFinite(fvHigh) || gHigh <= G_LOW) {
    // No finite high bracket above the low bracket — cannot express.
    return { status: 'above_range', above_cap: false, above_gdp: false }
  }
  if (price > fvHigh) {
    return { status: 'above_range', above_cap: false, above_gdp: false }
  }

  // Bisect for g where fv(g) == price. fv is monotonically increasing in g.
  let lo = G_LOW
  let hi = gHigh
  let mid = (lo + hi) / 2
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    mid = (lo + hi) / 2
    const fvMid = fv(mid)
    if (fvMid === undefined || !Number.isFinite(fvMid)) {
      // Stepped into the absurd region — treat as too-high, move the ceiling down.
      hi = mid
      continue
    }
    const relErr = Math.abs(fvMid - price) / price
    if (relErr <= REL_FV_TOLERANCE || hi - lo <= G_TOLERANCE) {
      break
    }
    if (fvMid < price) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const implied_growth = mid
  const above_cap = implied_growth > VALUATION_PARAMS.single_growth_cap
  const above_gdp = implied_growth > VALUATION_PARAMS.gdp_growth_threshold
  return { implied_growth, status: 'solved', above_cap, above_gdp }
}
