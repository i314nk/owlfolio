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
  /**
   * Effective DEFAULT discount/hurdle rate = ten_year_treasury_default + equity_premium (Phase 1.4). Kept
   * for callers/regression that read a single discount; the live discount is resolved per-run as
   * (live 10y Treasury || ten_year_treasury_default) + equity_premium via `discountRate()`. The discount is
   * GLOBAL config, human-set once — NEVER an agent input, and it carries NO quality knob (Part D Step 3 / G).
   */
  discount_rate: number
  /**
   * Fixed UNIFORM equity premium added to the 10y Treasury yield to form the discount (Phase 1.4 / Step 3).
   * Identical for every business — the single biggest divergence the method expels is a quality-adjusted
   * discount, so there is no per-name / per-moat knob here.
   */
  equity_premium: number
  /** Documented fail-closed default 10y Treasury yield used when the live fetch is unavailable (Phase 1.4). */
  ten_year_treasury_default: number
  /** Terminal-stage growth g_t by moat tier. Recalibrated: monopoly 2.5%, wide 1.5% (spec §1). */
  terminal_growth_by_moat: MoatTieredNumber
  /** Stage-1 horizon (years) by moat tier. Recalibrated: monopoly 15, wide 10 (spec §1). */
  stage1_horizon_by_moat: MoatTieredNumber
  /**
   * THE single conservatism knob (Phase 1.6 / Part D Step 6): the base margin-of-safety floor by moat tier.
   * Recalibrated: monopoly 15%, wide 25%. It WIDENS (via margin_of_safety_widening) with terminal-value
   * share, low maint-capex confidence, weak moat durability, and sensitivity dispersion.
   */
  margin_of_safety_by_moat: MoatTieredNumber
  /**
   * MoS-widening increments + cap (Phase 1.6). All conservatism beyond the base floor lives HERE (one knob):
   * each documented uncertainty adds its increment, clamped to `cap` (~0.50). Calibration-tunable.
   */
  margin_of_safety_widening: {
    /** Added when terminal_value_pct_of_iv exceeds terminal_value_share_flag. */
    high_terminal_value_share: number
    /** Added when the maintenance-capex estimate is low-confidence (e.g. Greenwald/D&A disagree, no gross PP&E). */
    low_maint_capex_confidence: number
    /** Added for weak moat durability — incl. above-GDP growth, which IS a moat-durability claim. */
    weak_moat_durability: number
    /** Max increment contributed by sensitivity dispersion (scaled by the dispersion magnitude in [0,1]). */
    sensitivity_dispersion_max: number
    /** Hard cap on the widened MoS (~0.50). */
    cap: number
  }
  /**
   * Fair-value sanity-FLAG threshold as a multiple of OE (18×). Phase 1.6: this is NO LONGER a silent
   * truncation — a fair value above it raises a surfaced `cap_exceeded` flag (which widens the MoS), the
   * value is kept. The old 18× hard cap is gone.
   */
  fv_cap_multiple: number
  /**
   * Absurd-error guard multiple (100×). Phase 1.6: a fair value at/above this multiple of OE signals a
   * units/scale bug (e.g. discount ≈ terminal_g) and is DISCARDED (not flagged-and-kept). The only
   * remaining hard limit.
   */
  fv_absurd_multiple: number
  /**
   * THE single named growth backstop (Phase 1.3 / Part D Step 2 / F.3) — one forecasting-humility cap on
   * the honest historical owner-earnings growth path. Replaces the old stacked
   * growth_band_ceilings/max_growth/growth_eligibility trio. **The ~0.20 level is a PLACEHOLDER pending the
   * 1.9 calibration against the circle's actual 5–10yr OE CAGRs — NOT a derived number.** It sits BEHIND the
   * durable-source requirement (it is a backstop, never a license) and bites only over-optimism.
   */
  single_growth_cap: number
  /**
   * Terminal-value-share flag threshold (Phase 1.5 / Part D Step 4): when the Gordon terminal value is
   * more than this fraction (~0.65) of total intrinsic value, flag it — most of the estimate is a guess
   * about the distant future — and WIDEN the end-stage margin of safety (Phase 1.6).
   */
  terminal_value_share_flag: number
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
  // discount_rate = ten_year_treasury_default (0.045) + equity_premium (0.055) = 0.10 (unchanged default).
  discount_rate: 0.10,
  equity_premium: 0.055,
  ten_year_treasury_default: 0.045,
  terminal_growth_by_moat: { monopoly: 0.025, wide: 0.015 },
  stage1_horizon_by_moat: { monopoly: 15, wide: 10 },
  margin_of_safety_by_moat: { monopoly: 0.15, wide: 0.25 },
  // Phase 1.6 — widening increments + 0.50 cap (PLACEHOLDER magnitudes, frozen at the 1.9 calibration).
  margin_of_safety_widening: {
    high_terminal_value_share: 0.10,
    low_maint_capex_confidence: 0.05,
    weak_moat_durability: 0.10,
    sensitivity_dispersion_max: 0.10,
    cap: 0.50,
  },
  fv_cap_multiple: 18,
  fv_absurd_multiple: 100,
  // PLACEHOLDER (Phase 1.3 / F.3): set at the 1.9 calibration against the circle's actual 5–10yr OE CAGRs.
  single_growth_cap: 0.20,
  terminal_value_share_flag: 0.65,
  gdp_growth_threshold: 0.03,
  oe_normalization_default: 'mid_cycle',
}) as ValuationParams
