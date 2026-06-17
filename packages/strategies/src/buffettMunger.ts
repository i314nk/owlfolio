import { strategyContractSchema, type MoatClass, type StrategyContract, type TargetWeightByMoat } from './strategyContract'
import { VALUATION_PARAMS } from './valuationParams'

/** Moat classes that pass the wide-moat gate (investable). */
const INVESTABLE_MOAT_CLASSES = new Set<MoatClass>(['wide', 'monopoly'])

/**
 * Returns true when the given moat class meets the strategy's minimum investable moat gate.
 * narrow and moderate are rejected; wide and monopoly are investable.
 */
export function moatPassesGate(strategy: StrategyContract, moatClass: MoatClass): boolean {
  const min = strategy.valuation.min_investable_moat
  const investable = INVESTABLE_MOAT_CLASSES
  if (!investable.has(min)) {
    return false
  }
  return investable.has(moatClass)
}

/**
 * The discount/hurdle rate (Phase 1.4 / Part D Step 3): `discount = 10y Treasury yield + a fixed UNIFORM
 * equity premium`. The SAME rate for every business — no beta, no quality knob, no per-moat adjustment.
 * It is GLOBAL config the human sets once, NEVER an agent input.
 *
 * `tenYearTreasury` is the live yield (decimal) when available; when omitted (or non-finite) the config
 * default (`ten_year_treasury_default`) is used, fail-closed. Business quality is never a discount-rate knob;
 * post-F.13 it is not a valuation-parameter knob at all — a stronger moat routes its durability through the
 * surfaced, human-weighted moat-durability input (terminal-value share), not via tier-varying params.
 */
export function discountRate(strategy: StrategyContract, tenYearTreasury?: number): number {
  // ANCHOR-SWAP-F2: discount anchor = Treasury + equity_premium today; F.2 swaps to savings_rate + equity_premium (deferred, blocked on the calibration cohort #124).
  const v = strategy.valuation
  const treasury = (typeof tenYearTreasury === 'number' && Number.isFinite(tenYearTreasury) && tenYearTreasury > 0)
    ? tenYearTreasury
    : v.ten_year_treasury_default
  return treasury + v.equity_premium
}

/**
 * Returns the base margin of safety. UNIFORM across every investable business post-F.13 — the value no
 * longer varies by moat tier (the monopoly tier was a relocated quality-knob; collapsed to the conservative
 * wide value). The `moatClass` argument is retained ONLY to validate the investability gate.
 * Throws if called for a non-investable moat class (narrow, moderate).
 */
export function marginOfSafetyForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  if (!INVESTABLE_MOAT_CLASSES.has(moatClass)) {
    throw new Error(`No margin of safety for moat class '${moatClass}' — only investable classes (wide, monopoly) have margin of safety values.`)
  }
  return strategy.valuation.base_margin_of_safety
}

/** Result of widening the single MoS knob (Phase 1.6). */
export type WidenedMarginOfSafety = {
  /** The end-stage margin of safety actually applied (base floor + widening, capped). */
  margin_of_safety: number
  /** The moat base floor before widening. */
  base: number
  /** True when any widening input bound. */
  widened: boolean
  /** Human-readable reasons each widening increment fired. */
  widening_reasons: string[]
}

/**
 * THE single conservatism knob (Phase 1.6 / Part D Step 6). Start from the uniform base floor (F.13 — no
 * longer moat-tiered; `moat_class` is validated for the investability gate only) and WIDEN
 * (toward the configured cap, ~0.50) with the documented uncertainties: a high terminal-value share, low
 * maintenance-capex confidence, weak moat durability (above-GDP growth IS a moat-durability claim), and
 * sensitivity dispersion (scaled in [0,1] when available). All conservatism beyond honest inputs lives
 * here — one number, visible, config-driven. (The old 18× hard cap is gone — it is a surfaced cap_exceeded
 * flag in `twoStageValuation`.)
 */
export function widenedMarginOfSafety(
  strategy: StrategyContract,
  args: {
    moat_class: MoatClass
    terminal_value_pct_of_iv?: number
    low_maint_capex_confidence?: boolean
    weak_moat_durability?: boolean
    /** Sensitivity dispersion magnitude in [0,1]; scales sensitivity_dispersion_max. */
    sensitivity_dispersion?: number
  },
): WidenedMarginOfSafety {
  const v = strategy.valuation
  const base = marginOfSafetyForMoat(strategy, args.moat_class)
  const w = v.margin_of_safety_widening
  let mos = base
  const reasons: string[] = []
  if (args.terminal_value_pct_of_iv !== undefined && args.terminal_value_pct_of_iv > v.terminal_value_share_flag) {
    mos += w.high_terminal_value_share
    reasons.push(`high terminal-value share (${(args.terminal_value_pct_of_iv * 100).toFixed(0)}% > ${(v.terminal_value_share_flag * 100).toFixed(0)}%)`)
  }
  if (args.low_maint_capex_confidence === true) {
    mos += w.low_maint_capex_confidence
    reasons.push('low maintenance-capex confidence')
  }
  if (args.weak_moat_durability === true) {
    mos += w.weak_moat_durability
    reasons.push('weak moat durability (above-GDP growth is a moat-durability claim)')
  }
  if (args.sensitivity_dispersion !== undefined && Number.isFinite(args.sensitivity_dispersion) && args.sensitivity_dispersion > 0) {
    const clamped = Math.min(1, Math.max(0, args.sensitivity_dispersion))
    mos += w.sensitivity_dispersion_max * clamped
    reasons.push(`sensitivity dispersion (${(clamped * 100).toFixed(0)}%)`)
  }
  mos = Math.min(mos, w.cap)
  return { margin_of_safety: mos, base, widened: reasons.length > 0, widening_reasons: reasons }
}

/**
 * Returns the terminal-stage growth rate (g_t) used by the two-stage DCF terminal value. UNIFORM across
 * every investable business post-F.13 — the value no longer varies by moat tier (collapsed to the
 * conservative wide value; a stronger moat earns higher terminal value through the surfaced, human-weighted
 * moat-durability input, not via a silent tier table). The `moatClass` argument is retained ONLY to validate
 * the investability gate. Throws if called for a non-investable moat class (narrow, moderate).
 */
export function terminalGrowthForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  if (!INVESTABLE_MOAT_CLASSES.has(moatClass)) {
    throw new Error(`No terminal growth for moat class '${moatClass}' — only investable classes (wide, monopoly) have terminal growth values.`)
  }
  return strategy.valuation.terminal_growth
}

/**
 * Returns the stage-1 (explicit) DCF horizon in years. UNIFORM across every investable business post-F.13 —
 * the value no longer varies by moat tier (collapsed to the conservative wide value; a stronger moat must
 * not silently extend the optimistic-extrapolation horizon). The `moatClass` argument is retained ONLY to
 * validate the investability gate. Throws if called for a non-investable moat class (narrow, moderate).
 */
export function stage1HorizonForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  if (!INVESTABLE_MOAT_CLASSES.has(moatClass)) {
    throw new Error(`No stage-1 horizon for moat class '${moatClass}' — only investable classes (wide, monopoly) have horizon values.`)
  }
  return strategy.valuation.stage1_horizon
}

/** Outcome of the single growth-path computation (Phase 1.3). */
export type CreditedGrowthResult = {
  /** The near-term growth rate the harness will use in the two-stage DCF (Stage-1 g). */
  growth: number
  /** True when `growth` is materially above GDP — i.e. it is a moat-durability claim (lowest-confidence). */
  above_gdp: boolean
  /** A `degraded_flags`-style note when `above_gdp` is true; surfaces growth WITH the moat-durability input. */
  above_gdp_flag?: string
  /** True when the named single_growth_cap bound the rate (over-optimism backstop bit). */
  cap_binds: boolean
}

/**
 * The ONE growth path (Buffett-Munger gap-closing Phase 1.3 / Part D Step 2 / F.3).
 *
 * Input is the DEMONSTRATED historical owner-earnings-per-share growth (the OE/share CAGR computed upstream
 * from `ownerEarningsPerShareSeries`). The harness applies only:
 *   1. a floor at 0 (no negative compounding credit; non-finite → 0, fail-closed),
 *   2. the agent's argued rate IF it is LOWER (the agent may argue down, NEVER up),
 *   3. the named 15% forecasting-humility ceiling (`single_growth_cap`, re-derived 2026-06-15) —
 *      a ceiling behind the durable-source requirement, never a license,
 *   4. an above-GDP coupling FLAG: any rate materially above `gdp_growth_threshold` is a moat-durability
 *      claim and is flagged lowest-confidence so it surfaces WITH the moat-durability input (it is NOT
 *      silently accepted, and it is NOT haircut here — the single end-stage MoS carries the conservatism).
 *
 * Replaces the old reinvestment×ROIC + band-ceiling + eligibility-gate + max-growth stack ("one knob +
 * one named backstop, not five"). Pure + config-driven.
 */
export function creditedGrowth(
  strategy: StrategyContract,
  args: {
    /** Demonstrated historical OE/share growth (CAGR) — the honest, falsifiable near-recent-history rate. */
    demonstrated_growth: number
    /** Optional agent argument; honoured ONLY when strictly lower than the demonstrated rate. */
    agent_proposed_growth?: number
  },
): CreditedGrowthResult {
  const v = strategy.valuation
  // (1) floor + fail-closed.
  let g = Number.isFinite(args.demonstrated_growth) ? Math.max(0, args.demonstrated_growth) : 0
  // (2) agent may argue LOWER, never higher.
  if (
    args.agent_proposed_growth !== undefined
    && Number.isFinite(args.agent_proposed_growth)
    && args.agent_proposed_growth >= 0
    && args.agent_proposed_growth < g
  ) {
    g = args.agent_proposed_growth
  }
  // (3) named forecasting-humility cap (placeholder).
  const cap_binds = g > v.single_growth_cap
  if (cap_binds) g = v.single_growth_cap
  // (4) above-GDP coupling flag.
  const above_gdp = g > v.gdp_growth_threshold
  const result: CreditedGrowthResult = { growth: g, above_gdp, cap_binds }
  if (above_gdp) {
    result.above_gdp_flag =
      `growth_above_gdp_moat_durability_claim: near-term growth ${(g * 100).toFixed(1)}% is materially above `
      + `GDP (~${(v.gdp_growth_threshold * 100).toFixed(1)}%) — a citation grounds past growth but not a `
      + `decade of it. Treat as a moat-durability claim: lowest-confidence, human-weighted, surfaced with `
      + `the moat-durability input (terminal-value share). Widens the end-stage margin of safety.`
  }
  return result
}

/**
 * Raw two-stage DCF components (no cap applied), with a LINEAR STAGE-1 GROWTH FADE (Part D Step 2).
 *
 * Per-year growth g_t over the H-year explicit window glides from the near-term g down to the terminal rate
 * over the trailing F (`fade_years`) years; plateau years (t ≤ H−F) compound at g, and at t=H, g_t = g_t
 * (terminal) exactly. Flat compounding over a long horizon over-values quality compounders; the fade is the
 * forecasting-humility mechanism inside the explicit window.
 *
 *   - Plateau years  t ≤ H−F:        g_t = g
 *   - Fade years     t ∈ (H−F+1)..H: k = t−(H−F); g_t = g + (g_terminal − g)·(k/F)   (k = 1..F)
 *   - OE_t = OE_0 · Π_{i=1..t} (1 + g_i); discount each year by (1+r)^t.
 *   - Terminal (Gordon) attaches at year H off the FADED OE_H: OE_H·(1+g_t)/(r−g_t), discounted by (1+r)^H.
 *
 * Fade-only-downward: when g ≤ terminal (a low/no-growth name) the glide is SKIPPED (flat g_t = g for all
 * H years) so a 1% grower is not inflated up toward the terminal rate. Guards: F ≥ H → every year fades
 * (no plateau); F ≤ 0 → flat (no fade).
 */
function twoStageRaw(args: { oe_ps: number; g: number; terminal_g: number; discount: number; horizon: number; fade_years: number }): {
  stage1: number
  terminal: number
  fair_value: number
} {
  const { oe_ps, g, terminal_g, discount: r, horizon } = args
  // Clamp the fade window to [0, horizon]; fade only bites downward (g > terminal_g).
  const fadeYears = Math.min(Math.max(0, args.fade_years), horizon)
  const fadeApplies = g > terminal_g && fadeYears > 0
  const plateauEnd = horizon - fadeYears // last plateau year (years t ≤ plateauEnd compound at g)

  let stage1 = 0
  let growthFactor = 1 // running Π_{i=1..t} (1 + g_i)
  let oeAtHorizon = oe_ps
  for (let t = 1; t <= horizon; t += 1) {
    let g_t = g
    if (fadeApplies && t > plateauEnd) {
      const k = t - plateauEnd // 1..fadeYears
      g_t = g + (terminal_g - g) * (k / fadeYears)
    }
    growthFactor *= 1 + g_t
    const oe_t = oe_ps * growthFactor
    stage1 += oe_t / Math.pow(1 + r, t)
    if (t === horizon) oeAtHorizon = oe_t
  }
  // Gordon terminal off the FADED year-H owner earnings.
  const terminal = ((oeAtHorizon * (1 + terminal_g)) / (r - terminal_g)) / Math.pow(1 + r, horizon)
  return { stage1, terminal, fair_value: stage1 + terminal }
}

/** Rich two-stage valuation result (Phase 1.5 terminal share + Phase 1.6 cap flag). */
export type TwoStageValuationResult = {
  /** Raw two-stage fair value per share; undefined when the absurd-error guard fired (units bug). */
  fair_value?: number
  /** Terminal (Gordon) value as a % of total intrinsic value (Phase 1.5) — the dominant-uncertainty flag. */
  terminal_value_pct_of_iv: number
  /** Phase 1.6: raw fair value exceeded `ceiling_multiple × OE` — a SURFACED sanity flag, not a truncation. */
  cap_exceeded: boolean
  /** Phase 1.6: raw fair value reached the absurd-error guard (`absurd_multiple × OE`) → value discarded. */
  absurd: boolean
}

/**
 * Rich two-stage DCF (buffett-valuation-method-v2 Step 4 / Part D Steps 2 + 4 + 6).
 *
 * Stage 1 grows owner earnings on a FADED path (Part D Step 2): the near-term g compounds flat over the
 * plateau years then glides LINEARLY down to the terminal rate over the trailing `fade_years` years, so by
 * year H the per-year rate equals the terminal rate. The Gordon terminal attaches off the faded year-H OE:
 *
 *   OE_t = OE_ps × Π_{i=1..t}(1+g_i),  g_i fades from g → terminal over the last F years
 *   FV_ps = Σ_{t=1..H} OE_t/(1+r)^t  +  [ OE_H × (1+g_t) / (r − g_t) ] / (1+r)^H
 *
 * Fade applies only downward (g > terminal); a low/no-growth name compounds flat. `fade_years` defaults to
 * the config `growth_fade_years` so existing callers pick up the fade with no signature change.
 *
 * Phase 1.5: also surfaces `terminal_value_pct_of_iv` (Gordon terminal ÷ total IV) — the dominant
 * uncertainty; the caller flags > 0.65 (feeds the MoS-widening).
 * Phase 1.6: the OE multiple is NO LONGER a silent cap. `cap_exceeded` is set (and the value KEPT) when
 * the raw value exceeds `ceiling_multiple × OE`; only at/above `absurd_multiple × OE` is the value DISCARDED
 * (`absurd: true`, `fair_value` undefined) as a units-error guard. `horizon` defaults to 10.
 */
export function twoStageValuation(args: {
  oe_ps: number
  g: number
  terminal_g: number
  discount: number
  ceiling_multiple: number
  /** Absurd-error guard multiple; defaults to the strategy's fv_absurd_multiple (100×). */
  absurd_multiple?: number
  horizon?: number
  /** Trailing stage-1 fade years; defaults to the config `growth_fade_years` (Part D Step 2). */
  fade_years?: number
}): TwoStageValuationResult {
  const horizon = args.horizon ?? 10
  const absurd_multiple = args.absurd_multiple ?? 100
  const fade_years = args.fade_years ?? VALUATION_PARAMS.growth_fade_years
  const { stage1, terminal, fair_value } = twoStageRaw({ oe_ps: args.oe_ps, g: args.g, terminal_g: args.terminal_g, discount: args.discount, horizon, fade_years })
  const total = stage1 + terminal
  const terminal_value_pct_of_iv = total > 0 && Number.isFinite(total) ? terminal / total : 0
  const cap_exceeded = Number.isFinite(fair_value) && fair_value > args.ceiling_multiple * args.oe_ps
  const absurd = !Number.isFinite(fair_value) || fair_value >= absurd_multiple * args.oe_ps
  return {
    ...(absurd ? {} : { fair_value }),
    terminal_value_pct_of_iv,
    cap_exceeded,
    absurd,
  }
}

/**
 * Two-stage fair value per share (back-compat scalar). Keeps the LEGACY behavior of capping at
 * `ceiling_multiple × OE` (used by /strategy and /learn worked examples + regression tests). New harness
 * callers use `twoStageValuation` (Phase 1.6: cap is a surfaced flag, not a truncation). Stage 1 uses the
 * Part D Step 2 linear growth fade; `fade_years` defaults to the config `growth_fade_years`. `horizon`
 * defaults to 10.
 */
export function twoStageFairValuePerShare(args: {
  oe_ps: number
  g: number
  terminal_g: number
  discount: number
  ceiling_multiple: number
  horizon?: number
  /** Trailing stage-1 fade years; defaults to the config `growth_fade_years` (Part D Step 2). */
  fade_years?: number
}): number {
  const horizon = args.horizon ?? 10
  const fade_years = args.fade_years ?? VALUATION_PARAMS.growth_fade_years
  const { fair_value } = twoStageRaw({ oe_ps: args.oe_ps, g: args.g, terminal_g: args.terminal_g, discount: args.discount, horizon, fade_years })
  return Math.min(fair_value, args.ceiling_multiple * args.oe_ps)
}

const rawBuffettMungerStrategy = {
  id: 'buffett-munger',
  name: 'Buffett-Munger Quality Compounder',
  version: '1.0.0',
  certification_status: 'draft',
  description: 'Default long-term quality investing policy requiring Shariah screening, owner earnings durability, balance-sheet safety, and valuation discipline.',
  research: {
    required_specialists: [
      {
        id: 'moat',
        name: 'Moat specialist',
        mandate: 'Assess durable competitive advantage, reinvestment runway, pricing power, and evidence of business quality.',
        required: true,
      },
      {
        id: 'financials',
        name: 'Financial quality specialist',
        mandate: 'Normalize owner earnings (NI+D&A−maint capex−SBC−ΔWC), ROIC, reinvestment rate, free cash conversion, cyclicality, and accounting quality.',
        required: true,
      },
      {
        id: 'risk',
        name: 'Risk specialist',
        mandate: 'Identify permanent-capital-loss risks, leverage fragility, disruption, regulation, and thesis breakers.',
        required: true,
      },
      {
        id: 'management',
        name: 'Management specialist',
        mandate: 'Evaluate capital allocation, incentives, candor, insider alignment, and stewardship history.',
        required: true,
      },
      {
        id: 'valuation',
        name: 'Valuation specialist',
        mandate: 'Estimate the owner-earnings bridge (NI+D&A−maint capex−SBC−ΔWC), ROIC, reinvestment rate, and produce a GROUNDED sustainable-growth band: anchor on reinvestment × incremental-ROIC, cross-check against demonstrated growth, cite moat-durability + reinvestment-runway evidence, and estimate HONESTLY (do not lowball). When growth is capital-light (brand/network/operating-leverage, low reinvestment) supply a CITED capital_light_argument (the claimed sustainable growth + its grounded source). Argue the band DOWN freely; a band-UP above the reinvestment×ROIC identity REQUIRES a citation. The harness derives fair value and the verdict from this band (conservatism lives in the required-growth gap).',
        required: true,
      },
      {
        id: 'synthesis',
        name: 'Synthesis specialist',
        mandate: 'Reconcile specialist findings into a final policy-constrained recommendation and open-questions list.',
        required: true,
      },
    ],
  },
  hard_gates: [
    {
      id: 'shariah_compliant_or_conditional',
      name: 'Shariah compliant or conditionally investable',
      severity: 'blocking',
      fact_key: 'shariah_status',
      check: 'shariah_compliant_or_conditional',
      description: 'Investment may proceed only when Shariah status is COMPLIANT or, when allowed by policy, CONDITIONAL.',
    },
    {
      id: 'positive_owner_earnings',
      name: 'Positive owner earnings',
      severity: 'blocking',
      fact_key: 'owner_earnings_positive',
      check: 'boolean_true',
      description: 'Normalized owner earnings must be positive.',
    },
    {
      id: 'leverage_safe',
      name: 'Safe leverage',
      severity: 'blocking',
      fact_key: 'leverage_safe',
      check: 'boolean_true',
      description: 'Debt and fixed obligations must not create unacceptable balance-sheet fragility.',
    },
    {
      id: 'valuation_complete',
      name: 'Valuation complete',
      severity: 'blocking',
      fact_key: 'valuation_complete',
      check: 'boolean_true',
      description: 'A complete valuation and margin-of-safety assessment must be available before certification.',
    },
    {
      id: 'source_coverage_complete',
      name: 'Source coverage complete',
      severity: 'warning',
      fact_key: 'source_coverage_complete',
      check: 'boolean_true',
      description: 'Primary-source coverage should be complete enough to support the research record.',
    },
  ],
  valuation: {
    // EVERY valuation constant below is sourced from the versioned VALUATION_PARAMS config
    // (valuation-recalibration-spec §1: one versioned config, no hardcoded valuation constants).
    // F.13 — UNIFORM valuation params across every investable business: base MoS 25%, terminal g 1.5%,
    // stage-1 horizon 10yr (the monopoly tier no longer loosens valuation; it is a durability signal that
    // routes through the moat-durability input). 10% flat discount (constitutional, untouched), 18× FV cap.
    discount_rate: VALUATION_PARAMS.discount_rate,
    equity_premium: VALUATION_PARAMS.equity_premium,
    ten_year_treasury_default: VALUATION_PARAMS.ten_year_treasury_default,
    base_margin_of_safety: VALUATION_PARAMS.base_margin_of_safety,
    margin_of_safety_widening: {
      high_terminal_value_share: VALUATION_PARAMS.margin_of_safety_widening.high_terminal_value_share,
      low_maint_capex_confidence: VALUATION_PARAMS.margin_of_safety_widening.low_maint_capex_confidence,
      weak_moat_durability: VALUATION_PARAMS.margin_of_safety_widening.weak_moat_durability,
      sensitivity_dispersion_max: VALUATION_PARAMS.margin_of_safety_widening.sensitivity_dispersion_max,
      cap: VALUATION_PARAMS.margin_of_safety_widening.cap,
    },
    // valuation-core revision — THE single conservatism knob as a required growth-rate GAP (growth-points,
    // PROVISIONAL/V8-owned; see VALUATION_PARAMS.required_growth_gap). Conservatism lives here, not in the band.
    required_growth_gap: {
      base_gap: VALUATION_PARAMS.required_growth_gap.base_gap,
      widening: {
        high_terminal_value_share: VALUATION_PARAMS.required_growth_gap.widening.high_terminal_value_share,
        low_maint_capex_confidence: VALUATION_PARAMS.required_growth_gap.widening.low_maint_capex_confidence,
        weak_moat_durability: VALUATION_PARAMS.required_growth_gap.widening.weak_moat_durability,
        sensitivity_dispersion_max: VALUATION_PARAMS.required_growth_gap.widening.sensitivity_dispersion_max,
        cap: VALUATION_PARAMS.required_growth_gap.widening.cap,
      },
    },
    terminal_value_share_flag: VALUATION_PARAMS.terminal_value_share_flag,
    terminal_growth: VALUATION_PARAMS.terminal_growth,
    stage1_horizon: VALUATION_PARAMS.stage1_horizon,
    growth_fade_years: VALUATION_PARAMS.growth_fade_years,
    single_growth_cap: VALUATION_PARAMS.single_growth_cap,
    gdp_growth_threshold: VALUATION_PARAMS.gdp_growth_threshold,
    valuation_multiple_ceiling: VALUATION_PARAMS.fv_cap_multiple,
    fv_absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    min_investable_moat: 'wide',
    valuation_required: true,
  },
  shariah: {
    required: true,
    allow_conditional: true,
    accepted_statuses: ['COMPLIANT', 'CONDITIONAL'],
    prohibited_statuses: ['NON_COMPLIANT'],
  },
  portfolio: {
    max_positions: 20,
    max_position_weight: 0.15,
    cash_buffer_minimum: 0.03,
    concentration_style: 'concentrated',
    // Conviction-tiered full position size by investable moat class.
    // All values are ≤ max_position_weight (0.15).
    // narrow/moderate are rejected before sizing, so only investable classes appear here.
    target_weight_by_moat: {
      wide: 0.06,
      monopoly: 0.10,
    },
    // Price-laddered entry tranches: scale into a position across three price levels.
    // Fractions are proportions of the target_weight_by_moat weight; they sum to 1.0.
    // CONFIG ONLY — enforcement/execution logic is future work.
    entry_tranches: [
      { id: 'T1', fraction: 0.40, trigger: 'at_buy_price' },
      { id: 'T2', fraction: 0.30, trigger: 'pct_below_buy_price', pct: 0.10 },
      { id: 'T3', fraction: 0.30, trigger: 'pct_below_buy_price', pct: 0.20 },
    ],
  },
} satisfies StrategyContract

export const buffettMungerStrategy = strategyContractSchema.parse(rawBuffettMungerStrategy)

/**
 * Look up the conviction-tiered target full position weight for a given moat class.
 * Only investable moat classes (wide, monopoly) have target weights.
 * narrow and moderate are rejected before sizing is considered.
 * Throws if called for a non-investable moat class.
 */
export function targetWeightForMoatClass(strategy: StrategyContract, moatClass: MoatClass): number {
  const weights = strategy.portfolio.target_weight_by_moat as TargetWeightByMoat | undefined
  if (!weights) {
    throw new Error(`Strategy '${strategy.id}' has no target_weight_by_moat in its portfolio policy.`)
  }
  const weight = (weights as Record<string, number>)[moatClass]
  if (weight === undefined) {
    throw new Error(`No target weight for moat class '${moatClass}' — only investable classes (wide, monopoly) have target weights.`)
  }
  return weight
}
