import { strategyContractSchema, type MoatClass, type Runway, type StrategyContract, type TargetWeightByMoat } from './strategyContract'
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

/**
 * Credited growth g (buffett-valuation-method-v2 Step 3) — deterministic clamp.
 *
 *   raw_g = reinvestment_rate × incremental_roic
 *   g = 0 if incremental_roic <= eligibility threshold (default 10%)
 *   else g = min(raw_g, band_ceiling, max_growth)
 *
 * band_ceiling (runway sets the value, moat tier sets the ceiling):
 *   runway 'none' or 'limited'        → limited_or_none (0.02), any tier
 *   runway 'proven' + moat 'wide'     → wide_proven (0.03)  | exceptional 0.04
 *   runway 'proven' + moat 'monopoly' → monopoly_proven (0.04) | exceptional 0.05
 *
 * Historical revenue/EPS growth is NEVER an input — only reinvestment economics.
 */
export function creditedGrowth(
  strategy: StrategyContract,
  args: {
    reinvestment_rate: number
    incremental_roic: number
    runway: Runway
    moat_class: MoatClass
    runway_exceptional?: boolean
  },
): number {
  const v = strategy.valuation
  // Eligibility: growth credit only when incremental ROIC strictly exceeds the threshold.
  if (!Number.isFinite(args.incremental_roic) || args.incremental_roic <= v.growth_eligibility_incremental_roic) {
    return 0
  }

  const bands = v.growth_band_ceilings
  let bandCeiling: number
  if (args.runway === 'none' || args.runway === 'limited') {
    // Any moat tier; runway_exceptional cannot lift a non-proven runway.
    bandCeiling = bands.limited_or_none
  } else if (args.moat_class === 'monopoly') {
    bandCeiling = args.runway_exceptional ? bands.monopoly_proven_exceptional : bands.monopoly_proven
  } else if (args.moat_class === 'wide') {
    bandCeiling = args.runway_exceptional ? bands.wide_proven_exceptional : bands.wide_proven
  } else {
    // narrow/moderate are gated out before valuation; treat conservatively.
    bandCeiling = bands.limited_or_none
  }

  const raw_g = args.reinvestment_rate * args.incremental_roic
  const g = Math.min(raw_g, bandCeiling, v.max_growth)
  // Clamp to [0, max_growth] — guard against negative reinvestment_rate.
  return Math.max(0, g)
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
    growth_band_ceilings: {
      limited_or_none: VALUATION_PARAMS.growth_band_ceilings.limited_or_none,
      wide_proven: VALUATION_PARAMS.growth_band_ceilings.wide_proven,
      wide_proven_exceptional: VALUATION_PARAMS.growth_band_ceilings.wide_proven_exceptional,
      monopoly_proven: VALUATION_PARAMS.growth_band_ceilings.monopoly_proven,
      monopoly_proven_exceptional: VALUATION_PARAMS.growth_band_ceilings.monopoly_proven_exceptional,
    },
    growth_eligibility_incremental_roic: VALUATION_PARAMS.growth_eligibility_incremental_roic,
    max_growth: VALUATION_PARAMS.max_growth,
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
