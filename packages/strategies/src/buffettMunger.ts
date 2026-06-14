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
 * Returns the flat discount rate (10%) for all investable moat classes.
 * The certainty difference between wide and monopoly is captured by the moat-tiered margin of safety, not the discount rate.
 */
export function discountRate(strategy: StrategyContract): number {
  return strategy.valuation.discount_rate
}

/**
 * Returns the margin of safety for the given investable moat class.
 * wide → 30%, monopoly → 20%.
 * Throws if called for a non-investable moat class (narrow, moderate).
 */
export function marginOfSafetyForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  const mos = (strategy.valuation.margin_of_safety_by_moat as Record<string, number>)[moatClass]
  if (mos === undefined) {
    throw new Error(`No margin of safety for moat class '${moatClass}' — only investable classes (wide, monopoly) have margin of safety values.`)
  }
  return mos
}

/**
 * Returns the terminal-stage growth rate (g_t) for the given investable moat class.
 * Recalibrated: monopoly → 2.5%, wide → 1.5%. Used by the two-stage DCF terminal value.
 * Throws if called for a non-investable moat class (narrow, moderate).
 */
export function terminalGrowthForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  const gt = (strategy.valuation.terminal_growth_by_moat as Record<string, number>)[moatClass]
  if (gt === undefined) {
    throw new Error(`No terminal growth for moat class '${moatClass}' — only investable classes (wide, monopoly) have terminal growth values.`)
  }
  return gt
}

/**
 * Returns the moat-dependent stage-1 (explicit) DCF horizon in years.
 * Recalibrated: monopoly → 15 (a true monopoly earns credit past year 10), wide → 10.
 * Throws if called for a non-investable moat class (narrow, moderate).
 */
export function stage1HorizonForMoat(strategy: StrategyContract, moatClass: MoatClass): number {
  const horizon = (strategy.valuation.stage1_horizon_by_moat as Record<string, number>)[moatClass]
  if (horizon === undefined) {
    throw new Error(`No stage-1 horizon for moat class '${moatClass}' — only investable classes (wide, monopoly) have horizon values.`)
  }
  return horizon
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
 *   3. the named ~20% forecasting-humility cap (`single_growth_cap`, a PLACEHOLDER set at calibration) —
 *      a backstop behind the durable-source requirement, never a license,
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
 * Two-stage fair value per share (buffett-valuation-method-v2 Step 4, recalibrated per
 * valuation-recalibration-spec §1 to a moat-dependent stage-1 horizon).
 *
 *   FV_ps = Σ_{t=1..H} [ OE_ps × (1+g)^t / (1+r)^t ]
 *         + [ OE_ps × (1+g)^H × (1+g_t) / (r − g_t) ] / (1+r)^H
 *   FV_ps = min(FV_ps, ceiling_multiple × OE_ps)
 *
 * Stage 1 grows OE at credited g for H years (H = horizon, moat-dependent: monopoly 15, wide 10);
 * Stage 2 fades to terminal g_t and discounts from year H. Flat discount r (always 10%). The ceiling
 * is a genuine independent brake. `horizon` defaults to 10 for backward compatibility.
 */
export function twoStageFairValuePerShare(args: {
  oe_ps: number
  g: number
  terminal_g: number
  discount: number
  ceiling_multiple: number
  horizon?: number
}): number {
  const { oe_ps, g, terminal_g, discount: r, ceiling_multiple } = args
  const horizon = args.horizon ?? 10
  let stage1 = 0
  for (let t = 1; t <= horizon; t += 1) {
    stage1 += (oe_ps * Math.pow(1 + g, t)) / Math.pow(1 + r, t)
  }
  const terminal = ((oe_ps * Math.pow(1 + g, horizon) * (1 + terminal_g)) / (r - terminal_g)) / Math.pow(1 + r, horizon)
  const fv = stage1 + terminal
  return Math.min(fv, ceiling_multiple * oe_ps)
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
        mandate: 'Estimate owner-earnings bridge (NI+D&A−maint capex−SBC−ΔWC), ROIC, reinvestment rate; harness computes fair value at flat 10% discount with moat-tiered margin of safety.',
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
    // Recalibrated defaults: terminal g 2.5%/1.5%, stage-1 horizon monopoly 15yr/wide 10yr,
    // MOS 15%/25%, 10% flat discount (constitutional, untouched), 18× FV cap, growth bands untouched.
    discount_rate: VALUATION_PARAMS.discount_rate,
    margin_of_safety_by_moat: {
      wide: VALUATION_PARAMS.margin_of_safety_by_moat.wide,
      monopoly: VALUATION_PARAMS.margin_of_safety_by_moat.monopoly,
    },
    terminal_growth_by_moat: {
      wide: VALUATION_PARAMS.terminal_growth_by_moat.wide,
      monopoly: VALUATION_PARAMS.terminal_growth_by_moat.monopoly,
    },
    stage1_horizon_by_moat: {
      wide: VALUATION_PARAMS.stage1_horizon_by_moat.wide,
      monopoly: VALUATION_PARAMS.stage1_horizon_by_moat.monopoly,
    },
    single_growth_cap: VALUATION_PARAMS.single_growth_cap,
    gdp_growth_threshold: VALUATION_PARAMS.gdp_growth_threshold,
    valuation_multiple_ceiling: VALUATION_PARAMS.fv_cap_multiple,
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
