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
   * Fraction of the SIGN-OFF-FROZEN REFERENCE fair value at/above which the "valuation-inverted" sell FLAG
   * fires (scope-reframe — the band/gap engine was removed; this is now a LIGHT price-vs-reference sanity
   * flag, advisory, the human decides). The flag fires when `current_price ≥ frozen_reference_fair_value ×
   * sell_band_fraction`: the live price runs at/above the signed-off reference, so the name is priced richly
   * vs the reference. 1.0 = the FULL frozen reference — a HARD threshold, NOT a wider band. This preserves
   * the Pabrai recant (selling winners at 90-95% of IV was his documented biggest mistake): biased to HOLD,
   * it only flags once the price reaches the whole frozen reference.
   *
   * The comparison keys off the FROZEN reference + the LIVE price ONLY (don't-move-the-number F.9/F.10) —
   * never a recomputed live band (there is none). Name retained from the band era to avoid config churn.
   */
  sell_band_fraction: number
  /**
   * @deprecated SUPERSEDED by `sell_band_fraction`. Was the fraction of the sign-off-frozen UNDISCOUNTED
   * point IV at/above which the (old) price-vs-frozen-IV inversion fired. The valuation-inverted sell was
   * rekeyed to implied-growth-vs-FROZEN-band (the mirror of the reverse-DCF-vs-band BUY). Retained for one
   * release so legacy callers/configs that still read this constant do not break; the sell trigger no
   * longer consumes it.
   */
  sell_iv_fraction: number
  /**
   * The HIGH hurdle for the "better opportunity under capital constraint" sell trigger (Phase 6 S4): the
   * minimum NET owner-earnings-yield margin (absolute, in yield points) a candidate must beat the held
   * name by — AFTER switching friction (taxes/spreads as a yield-equivalent drag) — before a switch is
   * "warranted". Default 0.05 (5 yield points) is deliberately HIGH: this is the most churn-prone trigger
   * (Buffett/Pabrai: "patient holding dies by a thousand switches"), so the bar to clear is steep. Note
   * this only gates `switch_warranted`; the switch ALWAYS additionally requires human sign-off — it is
   * never mechanical.
   */
  better_opportunity_min_margin: number
}

/**
 * The frozen DEFAULT sell parameters.
 *
 *   minimum_hold_months:          30   (≈ 2.5 years — inside the stated 2–3 year minimum-hold band)
 *   sell_band_fraction:           1.0  (FULL frozen band ceiling — hard threshold, Pabrai recant; biased to hold)
 *   sell_iv_fraction:             1.0  (DEPRECATED — superseded by sell_band_fraction; retained one release)
 *   better_opportunity_min_margin: 0.05 (HIGH net OE-yield hurdle; switch ALSO always needs human sign-off)
 */
export const SELL_PARAMS: SellParams = Object.freeze({
  version: 'sell-2026-06-band-1',
  minimum_hold_months: 30,
  sell_band_fraction: 1.0,
  sell_iv_fraction: 1.0,
  better_opportunity_min_margin: 0.05,
}) as SellParams
