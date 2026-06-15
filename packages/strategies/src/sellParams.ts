// Versioned SELL-decision parameter config (Phase 6) — the SINGLE source of truth for every sell-side
// constant. Sibling of sizingParams.ts: a frozen, versioned object read by the Phase-6 sell helpers
// (the minimum-hold clock today; the guard / assembler later). No sell constant is hardcoded in the
// sell engine — every number is read from here, so a test that mutates this config changes sell
// behaviour with no code change.
//
// This file will ACCRETE more Phase-6 params (e.g. trim thresholds, re-judgment cadence). Add new
// constants here and bump `version`; keep the structure so later slices extend it without churn.

/**
 * The full versioned sell parameter set. Every number the Phase-6 sell flow needs lives here.
 * Bump `version` on any change.
 */
export type SellParams = {
  /** Monotonic version string. Bump on every parameter change. */
  version: string
  /**
   * Minimum-hold window in months (Phase 6): the 2–3 year minimum-hold guard's clock length. A held name
   * younger than this is INSIDE the window, so a routine sell is held back UNLESS the shared impairment
   * judgment (reassessHeldImpairment → impairment_call) overrides — the guard must never fight a
   * thesis-broke sell. 30 months ≈ 2.5 years.
   */
  minimum_hold_months: number
  /**
   * Fraction of the SIGN-OFF-FROZEN undiscounted intrinsic value (IV) at/above which the
   * "valuation-inverted" sell trigger fires (Phase 6 S3). 1.0 = FULL IV — a HARD threshold, NOT a band.
   * Pabrai's documented biggest mistake was selling winners at 90-95% of IV, so the trigger is biased to
   * HOLD: it only fires once price reaches the whole frozen IV. The IV compared against is always the
   * value FROZEN at sign-off (never the MoS-discounted buy-below, never a live/recomputed fair value).
   */
  sell_iv_fraction: number
}

/**
 * The frozen DEFAULT sell parameters.
 *
 *   minimum_hold_months: 30  (≈ 2.5 years — inside the stated 2–3 year minimum-hold band)
 *   sell_iv_fraction:    1.0 (FULL IV — hard threshold, Pabrai recant; biased to hold below IV)
 */
export const SELL_PARAMS: SellParams = Object.freeze({
  version: 'sell-2026-06-phase6-2',
  minimum_hold_months: 30,
  sell_iv_fraction: 1.0,
}) as SellParams
