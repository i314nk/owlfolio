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

/** Banded credited-growth ceilings (Step 3): runway sets the value, moat tier sets the ceiling. */
export type GrowthBandCeilings = {
  /** limited/none runway — any moat tier */
  limited_or_none: number
  /** wide moat + proven runway */
  wide_proven: number
  /** wide moat + proven runway, exceptional */
  wide_proven_exceptional: number
  /** monopoly + proven runway */
  monopoly_proven: number
  /** monopoly + proven runway, exceptional */
  monopoly_proven_exceptional: number
}

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
  /** Banded credited-growth ceilings (Step 3) — unchanged by recalibration. */
  growth_band_ceilings: GrowthBandCeilings
  /** Growth credit only when incremental ROIC strictly exceeds this (0.10) — unchanged. */
  growth_eligibility_incremental_roic: number
  /** Absolute maximum credited growth, never exceeded by any band (0.05) — unchanged. */
  max_growth: number
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
 * Unchanged: 10% discount (constitutional), 18× FV cap, growth bands/eligibility/max.
 */
export const VALUATION_PARAMS: ValuationParams = Object.freeze({
  version: 'valuation-2026-06-recalibration-1',
  discount_rate: 0.10,
  terminal_growth_by_moat: { monopoly: 0.025, wide: 0.015 },
  stage1_horizon_by_moat: { monopoly: 15, wide: 10 },
  margin_of_safety_by_moat: { monopoly: 0.15, wide: 0.25 },
  fv_cap_multiple: 18,
  growth_band_ceilings: {
    limited_or_none: 0.02,
    wide_proven: 0.03,
    wide_proven_exceptional: 0.04,
    monopoly_proven: 0.04,
    monopoly_proven_exceptional: 0.05,
  },
  growth_eligibility_incremental_roic: 0.10,
  max_growth: 0.05,
  oe_normalization_default: 'mid_cycle',
}) as ValuationParams
