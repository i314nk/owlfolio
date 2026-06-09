import { strategyContractSchema, type MoatClass, type StrategyContract } from './strategyContract'

/** Moat classes that pass the wide-moat gate (investable). */
const INVESTABLE_MOAT_CLASSES = new Set<MoatClass>(['wide', 'monopoly', 'inevitable'])

/**
 * Returns true when the given moat class meets the strategy's minimum investable moat gate.
 * narrow and moderate are rejected; wide, monopoly, and inevitable are investable.
 */
export function moatPassesGate(strategy: StrategyContract, moatClass: MoatClass): boolean {
  const min = strategy.valuation.min_investable_moat
  // Use the ordered investable set relative to the configured minimum
  const investable = INVESTABLE_MOAT_CLASSES
  // If the minimum is not in the investable set, fall back to set membership check
  if (!investable.has(min)) {
    return false
  }
  return investable.has(moatClass)
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
        mandate: 'Assess durable competitive advantage, reinvestment runway, pricing power, and evidence of business inevitability.',
        required: true,
      },
      {
        id: 'financials',
        name: 'Financial quality specialist',
        mandate: 'Normalize owner earnings, returns on capital, free cash conversion, cyclicality, and accounting quality.',
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
        mandate: 'Estimate conservative intrinsic value, margin of safety, and hurdle-rate fit by moat class.',
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
    hurdle_rates: {
      wide: 0.15,
      monopoly: 0.12,
      inevitable: 0.10,
    },
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
  },
} satisfies StrategyContract

export const buffettMungerStrategy = strategyContractSchema.parse(rawBuffettMungerStrategy)

/**
 * Look up the hurdle rate for a given moat class from the strategy contract.
 * The harness (not the model) calls this to deterministically derive hurdle_rate
 * from the model-supplied moat_class.
 * Only investable moat classes (wide, monopoly, inevitable) have hurdle rates.
 * Throws if called for a non-investable moat class (narrow, moderate).
 */
export function hurdleRateForMoatClass(strategy: StrategyContract, moatClass: MoatClass): number {
  const rate = (strategy.valuation.hurdle_rates as Record<string, number>)[moatClass]
  if (rate === undefined) {
    throw new Error(`No hurdle rate for moat class '${moatClass}' — only investable classes (wide, monopoly, inevitable) have hurdle rates.`)
  }
  return rate
}
