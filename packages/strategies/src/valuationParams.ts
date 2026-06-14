// Versioned valuation parameter config — the SINGLE source of truth for every valuation constant.
//
// valuation-recalibration-spec §1 "Implementation requirement": every valuation parameter lives in
// ONE versioned config; NO valuation constant is hardcoded in the valuation logic. The valuation
// helpers (creditedGrowth, twoStageFairValuePerShare, terminal/MOS/horizon lookups) read ALL of
// their constants from this object. Config changes are logged as `valuation_config` ledger events
// (see valuationConfigEvent.ts).
//
// "Conservatism lives in ONE place per risk. Inputs honest; MOS absorbs estimation error. Decide
// parameters by calibration backtest before go-live, then freeze." Post-go-live changes are
// permitted only at the annual review with a backtest re-run attached (spec §3.4 anti-drift).

/** OE normalization stance — trough reserved for true cyclicals flagged by the FINANCIAL_QUALITY lane. */
export type OeNormalization = 'trough' | 'mid_cycle'

export type MoatTieredNumber = {
  wide: number
  monopoly: number
}

/**
 * The full versioned valuation parameter set. Every number the valuation engine needs lives here;
 * nothing is hardcoded in buffettMunger.ts / researchSwarm.ts. Bump `version` on any change and log a
 * `valuation_config` ledger event (valuation-recalibration-spec §1, acceptance test #5).
 */
export type ValuationParams = {
  /** Monotonic version string. Bump on every parameter change; pairs with the ledger event diff. */
  version: string
  /** Flat discount/hurdle rate — CONSTITUTIONAL, never touched by calibration (spec §1, §3.3). */
  discount_rate: number
  /** Terminal-stage growth g_t by moat tier. Recalibrated: monopoly 2.5%, wide 1.5% (spec §1). */
  terminal_growth_by_moat: MoatTieredNumber
  /** Stage-1 horizon (years) by moat tier. Recalibrated: monopoly 15, wide 10 (spec §1). */
  stage1_horizon_by_moat: MoatTieredNumber
  /** Margin of safety by moat tier. Recalibrated: monopoly 15%, wide 25% (spec §1). */
  margin_of_safety_by_moat: MoatTieredNumber
  /** Fair-value sanity cap as a multiple of OE (18×). Real work against the 15-yr monopoly horizon. */
  fv_cap_multiple: number
  /**
   * THE single named growth backstop (Phase 1.3 / Part D Step 2 / F.3) — one forecasting-humility cap on
   * the honest historical owner-earnings growth path. Replaces the old stacked
   * growth_band_ceilings/max_growth/growth_eligibility trio. **The ~0.20 level is a PLACEHOLDER pending the
   * 1.9 calibration against the circle's actual 5–10yr OE CAGRs — NOT a derived number.** It sits BEHIND the
   * durable-source requirement (it is a backstop, never a license) and bites only over-optimism.
   */
  single_growth_cap: number
  /**
   * GDP-like threshold (~2.5–3%) above which a near-term growth rate is treated as a moat-durability CLAIM
   * (Phase 1.3 coupling): the harness flags it lowest-confidence so it surfaces with the moat-durability
   * input rather than being silently accepted. A citation grounds "grew 22% last year" but not "grows 20%
   * for a decade."
   */
  gdp_growth_threshold: number
  /** Default OE normalization stance — mid_cycle (trough only for flagged cyclicals) (spec §1). */
  oe_normalization_default: OeNormalization
}

/**
 * The frozen DEFAULT valuation parameters (valuation-recalibration-spec §1 recalibrated values).
 *
 * Recalibrated from buffett-valuation-method-v2:
 *   terminal g:     monopoly 2.0% → 2.5%, wide 1.0% → 1.5%
 *   stage-1 horizon: monopoly 10 → 15 yrs, wide 10 (unchanged)
 *   MOS:            monopoly 20% → 15%, wide 30% → 25%
 *   OE default:     trough-everywhere → mid_cycle
 * Phase 1.3 (one-knob): the stacked growth_band_ceilings/max_growth/growth_eligibility trio is replaced by
 * a single named single_growth_cap (~0.20 PLACEHOLDER) + an above-GDP coupling flag (gdp_growth_threshold).
 */
export const VALUATION_PARAMS: ValuationParams = Object.freeze({
  version: 'valuation-2026-06-recalibration-1',
  discount_rate: 0.10,
  terminal_growth_by_moat: { monopoly: 0.025, wide: 0.015 },
  stage1_horizon_by_moat: { monopoly: 15, wide: 10 },
  margin_of_safety_by_moat: { monopoly: 0.15, wide: 0.25 },
  fv_cap_multiple: 18,
  // PLACEHOLDER (Phase 1.3 / F.3): set at the 1.9 calibration against the circle's actual 5–10yr OE CAGRs.
  single_growth_cap: 0.20,
  gdp_growth_threshold: 0.03,
  oe_normalization_default: 'mid_cycle',
}) as ValuationParams
