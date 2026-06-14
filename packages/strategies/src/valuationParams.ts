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
  /**
   * Terminal-stage growth g_t — UNIFORM across every investable business (F.13). The old
   * terminal_growth_by_moat {wide:0.015, monopoly:0.025} tier table was collapsed to one scalar
   * (the conservative wide value): business quality is NOT a per-name valuation-loosening lever.
   * A stronger moat earns higher terminal value through the surfaced, human-weighted moat-durability
   * input (terminal-value share, Phase 7), not via a silent tier table that raises g_t.
   */
  terminal_growth: number
  /**
   * Stage-1 (explicit) DCF horizon in years — UNIFORM across every investable business (F.13). The old
   * stage1_horizon_by_moat {wide:10, monopoly:15} table was collapsed to one scalar (the conservative wide
   * value): a stronger moat must not silently extend the optimistic-extrapolation horizon.
   */
  stage1_horizon: number
  /**
   * Number of TRAILING stage-1 years over which the near-term growth rate LINEARLY FADES down to the
   * terminal rate (Part D Step 2: "Linear fade from the near-term rate to a terminal rate (GDP-like, ~2.5%)
   * over years 6–10" — i.e. F=5 of a 10-year horizon). The plateau years (t ≤ H−F) compound at the
   * near-term g; the fade years glide so that at t=H, g_t = terminal exactly. The fade is the
   * forecasting-humility mechanism INSIDE the explicit window: flat compounding over a long horizon
   * over-values quality compounders. Fade applies ONLY when g > terminal (a low/no-growth name is NOT
   * glided upward). Guard: F ≥ H → all years fade; F ≤ 0 → flat (no fade).
   */
  growth_fade_years: number
  /**
   * THE single conservatism knob (Phase 1.6 / Part D Step 6): the base margin-of-safety floor — UNIFORM
   * across every investable business (F.13). The old margin_of_safety_by_moat {wide:0.25, monopoly:0.15}
   * table was collapsed to one scalar (the conservative wide value): a monopoly is a durability signal, NOT
   * a license to lower the safety margin. It WIDENS (via margin_of_safety_widening) with terminal-value
   * share, low maint-capex confidence, weak moat durability, and sensitivity dispersion.
   */
  base_margin_of_safety: number
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
   * growth_band_ceilings/max_growth/growth_eligibility trio. It sits BEHIND the durable-source requirement
   * (it is a backstop, never a license) and bites only over-optimism.
   *
   * **PROVISIONAL PLACEHOLDER — currently UN-ANCHORED (NOT frozen).** FDS was removed from the calibration
   * set, AND its 8.2% figure was an old-method CAGR, so the earlier "frozen at 1.9 against the circle's
   * 5–10yr OE CAGRs (max FDS 8.2%)" justification no longer holds. The *direction* (lower is safer) still
   * rests on the deterministic over-optimism math (a long horizon on an optimistic input licensed 45–83× OE
   * fair values), but the *level* must be re-derived from Phase-1-method OE/share CAGRs before any freeze.
   * Kept at 0.10 for now as an interim placeholder.
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
 * The DEFAULT valuation parameters (valuation-recalibration-spec §1).
 *
 * F.13 — the monopoly moat tier is a relocated quality-knob; COLLAPSED to uniform valuation params:
 *   terminal_growth:       uniform 1.5% (was terminal_growth_by_moat {wide:0.015, monopoly:0.025})
 *   stage1_horizon:        uniform 10   (was stage1_horizon_by_moat {wide:10, monopoly:15})
 *   base_margin_of_safety: uniform 0.25 (was margin_of_safety_by_moat {wide:0.25, monopoly:0.15})
 * Business quality is NOT a per-name valuation-loosening lever (same principle already applied to the
 * uniform discount rate). A monopoly is a durability signal: it earns higher terminal value through the
 * surfaced, human-weighted moat-durability input (terminal-value share, Phase 7), never via a silent tier
 * table. The investability gate is UNCHANGED (wide/monopoly investable; narrow/moderate fail pre-valuation)
 * and target_weight_by_moat stays in portfolio sizing (Phase 5 owns sizing).
 *
 * Phase 1.3 (one-knob): the stacked growth_band_ceilings/max_growth/growth_eligibility trio is replaced by
 * a single named single_growth_cap (provisional placeholder) + an above-GDP coupling flag (gdp_growth_threshold).
 */
export const VALUATION_PARAMS: ValuationParams = Object.freeze({
  version: 'valuation-2026-06-fade-1',
  // discount_rate = ten_year_treasury_default (0.045) + equity_premium (0.055) = 0.10 (unchanged default).
  discount_rate: 0.10,
  // PROVISIONAL — these signal-dependent params are NOT yet frozen. The 1.9 calibration ran on only n=2
  // names (CPRT, FDS; NVO failed on DKK-vs-USD currency, 4 GCC names deferred) — too thin to freeze MoS /
  // premium / must-signal against (F.11 overfitting). They stay at these defaults pending a broader-universe
  // calibration (fix NVO's currency path + add US 10-K compounders). Only single_growth_cap was frozen at 1.9
  // (measurement + deterministic math, robust to n=2).
  equity_premium: 0.055,
  ten_year_treasury_default: 0.045,
  // F.13 — UNIFORM across every investable business (collapsed from the old _by_moat tier tables to the
  // conservative wide values). Quality is not a per-name valuation-loosening lever.
  terminal_growth: 0.015,
  stage1_horizon: 10,
  // Part D Step 2 — linear fade over the trailing F years (years 6–10 of a 10-yr horizon). Fade applies
  // only when near-term g > terminal_growth; a low/no-growth name is never glided upward.
  growth_fade_years: 5,
  base_margin_of_safety: 0.25, // PROVISIONAL (see note above)
  // Phase 1.6 — widening increments + 0.50 cap. PROVISIONAL magnitudes (see note above; not yet frozen).
  margin_of_safety_widening: {
    high_terminal_value_share: 0.10,
    low_maint_capex_confidence: 0.05,
    weak_moat_durability: 0.10,
    sensitivity_dispersion_max: 0.10,
    cap: 0.50,
  },
  fv_cap_multiple: 18,
  fv_absurd_multiple: 100,
  // PROVISIONAL PLACEHOLDER — NO LONGER FROZEN. The earlier 1.9 freeze leaned on the circle's measured OE
  // CAGRs (incl. FDS 8.2%); FDS has since been removed from the calibration set AND its 8.2% was an
  // old-method CAGR, so that anchor is gone. The DIRECTION (lower is safer) still holds on the deterministic
  // over-optimism math (a long horizon on an optimistic input licensed 45–83× OE fair values; a lower cap is
  // far tamer), but the LEVEL must be re-derived from Phase-1-method OE/share CAGRs before any freeze. Kept
  // at 0.10 as an interim placeholder; cap_exceeded stays a WARN flag, no output-side hard guard.
  single_growth_cap: 0.10,
  terminal_value_share_flag: 0.65,
  gdp_growth_threshold: 0.03,
  oe_normalization_default: 'mid_cycle',
}) as ValuationParams
