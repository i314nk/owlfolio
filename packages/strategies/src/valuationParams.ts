// Versioned valuation parameter config — the SINGLE source of truth for every valuation constant.
//
// valuation-recalibration-spec §1 "Implementation requirement": every valuation parameter lives in
// ONE versioned config; NO valuation constant is hardcoded in the valuation logic. The valuation
// helpers (creditedGrowth, twoStageFairValuePerShare, terminal/horizon lookups) read ALL of
// their constants from this object.
//
// "Conservatism lives in ONE place per risk. Inputs honest; MOS absorbs estimation error." Any change to
// these params is a separate, deliberate, human-authored edit — never an automated drift.

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
   * Effective DEFAULT discount/hurdle rate = savings_rate_default + equity_premium (Phase 1.4 / F.2). Kept
   * for callers/regression that read a single discount; the live discount is resolved per-run as
   * (app-config compliant savings rate || savings_rate_default) + equity_premium via `discountRate()`. The
   * discount is GLOBAL config, human-set once — NEVER an agent input, and it carries NO quality knob
   * (Part D Step 3 / G).
   */
  // ANCHOR-SWAP-F2 (SHIPPED): the discount anchor is the COMPLIANT risk-free SAVINGS rate (Mudarabah
  // expected profit) + equity_premium. The interest-bearing 10y Treasury anchor is RETIRED — a compliant
  // investor cannot hold Treasury, so their true risk-free opportunity cost is the savings rate (the SAME
  // baseline the deployment-hurdle + sizing engines already use). Effective default 0.02 + 0.055 = 0.075.
  discount_rate: number
  /**
   * Fixed UNIFORM equity premium added to the compliant risk-free (savings) rate to form the discount
   * (Phase 1.4 / Step 3 / F.2). Identical for every business — the single biggest divergence the method
   * expels is a quality-adjusted discount, so there is no per-name / per-moat knob here.
   */
  equity_premium: number
  /** Phase 2 V2 — uniform required margin of safety (decimal). PROVISIONAL (F.11): owner-chosen 0.25,
   *  pending post-mortem calibration (entry_discount_to_fv vs realized outcomes). */
  required_margin_of_safety: number
  /**
   * Documented fail-closed default COMPLIANT SAVINGS rate (Mudarabah expected profit) used as the discount
   * risk-free anchor when the app-config savings rate is unavailable (F.2). Mirrors the app-config default
   * (`DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE` = 0.02). Replaced the retired `ten_year_treasury_default`.
   */
  savings_rate_default: number
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
 * Business quality is NOT a per-name valuation-loosening lever (same principle already applied to the
 * uniform discount rate). A monopoly is a durability signal: it earns higher terminal value through the
 * surfaced, human-weighted moat-durability input (terminal-value share, Phase 7), never via a silent tier
 * table. The investability gate is UNCHANGED (wide/monopoly investable; narrow/moderate fail pre-valuation)
 * and position sizing is conviction-based (base_target_weight × conviction_factor; Phase 5 owns sizing —
 * the old moat-tiered target_weight_by_moat sizing surface was retired in Phase 5 S6 O-9).
 *
 * Phase 1.3 (one-knob): the stacked growth_band_ceilings/max_growth/growth_eligibility trio is replaced by
 * a single named single_growth_cap (provisional placeholder) + an above-GDP coupling flag (gdp_growth_threshold).
 */
export const VALUATION_PARAMS: ValuationParams = Object.freeze({
  version: 'valuation-2026-06-savings-anchor-1',
  // F.2 ANCHOR SWAP: discount_rate = savings_rate_default (0.02) + equity_premium (0.055) = 0.075. The
  // compliant risk-free anchor is the SAVINGS rate (Mudarabah expected profit) — the same baseline the
  // deployment-hurdle + sizing engines already use — NOT the interest-bearing 10y Treasury (retired).
  discount_rate: 0.075,
  // PROVISIONAL — these signal-dependent params are NOT yet frozen. The 1.9 calibration ran on only n=2
  // names (CPRT, FDS; NVO failed on DKK-vs-USD currency, 4 GCC names deferred) — too thin to freeze the
  // premium / must-signal against (F.11 overfitting). They stay at these defaults pending a broader-universe
  // calibration (fix NVO's currency path + add US 10-K compounders). single_growth_cap was re-derived
  // 2026-06-15 (see its note below); premium remains provisional until the must-signal pass.
  equity_premium: 0.055,
  // Phase 2 V2 (owner-validated 2026-07-11): the T0 margin-of-safety grade's uniform threshold —
  // buy-below must sit ≥25% below min(internal DCF fair value, the 18× OE cap value) to grade
  // 'adequate' (≥ half that → 'thin'). UNIFORM per F.13; PROVISIONAL per F.11 until post-mortems
  // calibrate it. The moat's contribution to safety stays in the surfaced human-weighted channels.
  required_margin_of_safety: 0.25,
  // F.2 — fail-closed compliant savings-rate anchor (mirrors DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE = 0.02).
  // The live discount sources the app-config savings rate; this is the fail-closed default.
  savings_rate_default: 0.02,
  // F.13 — UNIFORM across every investable business (collapsed from the old _by_moat tier tables to the
  // conservative wide values). Quality is not a per-name valuation-loosening lever.
  terminal_growth: 0.015,
  stage1_horizon: 10,
  // Part D Step 2 — linear fade over the trailing F years (years 6–10 of a 10-yr horizon). Fade applies
  // only when near-term g > terminal_growth; a low/no-growth name is never glided upward.
  growth_fade_years: 5,
  fv_cap_multiple: 18,
  fv_absurd_multiple: 100,
  // RE-DERIVED 2026-06-15 (owner decision) as a forward-FORECASTING-HUMILITY ceiling. The robust Phase-1
  // OE/share CAGRs of the believed-in Role A/B set (split-adjusted, log-linear: MSFT 23.5, GOOGL 22.7,
  // CPRT 21.8, MCO 20.4, MA 18.4, COST 16.5, AAPL 15.8, SPGI 10.7 — cluster 16–23.5%, median ~19%) show the
  // real compounders grew well above this. The owner chose to let the CAP itself carry forward-humility
  // ("we won't underwrite >15% forward even if history was higher") rather than honoring 20%+ inputs and
  // leaning entirely on the MoS. This clips most of the cluster, but POST-FADE it does NOT recreate
  // "never buyable": at g=0.15 the faded FV is ~24.6× OE and the above-GDP-widened buy is ~16× OE, so a top
  // compounder is buyable at a genuine ~25–30% dislocation (matching its "buy only at deep dislocation"
  // verdict), while richer names decline at normal prices. The fade — not the cap — is the primary guard
  // against over-conservatism; the cap is the hardest available bite on over-optimism. cap_exceeded stays a
  // WARN flag (no output-side hard guard). premium is tuned next against the must-signal calibration.
  single_growth_cap: 0.15,
  terminal_value_share_flag: 0.65,
  gdp_growth_threshold: 0.03,
  oe_normalization_default: 'mid_cycle',
}) as ValuationParams
