import { z } from 'zod'

export const strategyMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  certification_status: z.enum(['draft', 'certified', 'deprecated']),
  description: z.string().min(1),
})

export const specialistDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mandate: z.string().min(1),
  required: z.boolean().default(true),
})

export const researchPolicySchema = z.object({
  required_specialists: z.array(specialistDefinitionSchema).min(1),
})

export const gateSeveritySchema = z.enum(['blocking', 'warning'])
export const gateCheckSchema = z.enum([
  'shariah_compliant_or_conditional',
  'boolean_true',
])

export const hardGateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  severity: gateSeveritySchema,
  fact_key: z.string().min(1),
  check: gateCheckSchema,
  description: z.string().min(1),
})

export const moatClassSchema = z.enum(['narrow', 'moderate', 'wide', 'monopoly', 'inevitable'])
export type MoatClass = z.infer<typeof moatClassSchema>

export const valuationPolicySchema = z.object({
  hurdle_rates: z.object({
    wide: z.number().positive(),
    monopoly: z.number().positive(),
    inevitable: z.number().positive(),
  }),
  min_investable_moat: moatClassSchema,
  valuation_required: z.boolean(),
})

export const shariahPolicySchema = z.object({
  required: z.boolean(),
  allow_conditional: z.boolean(),
  accepted_statuses: z.array(z.enum(['COMPLIANT', 'CONDITIONAL'])).min(1),
  prohibited_statuses: z.array(z.enum(['NON_COMPLIANT'])).min(1),
})

/** Conviction-tiered target full position weight by investable moat class. */
export const targetWeightByMoatSchema = z.object({
  wide: z.number().positive().max(1),
  monopoly: z.number().positive().max(1),
  inevitable: z.number().positive().max(1),
})

export type TargetWeightByMoat = z.infer<typeof targetWeightByMoatSchema>

/** A single price-laddered entry tranche. */
export const entryTrancheSchema = z.discriminatedUnion('trigger', [
  z.object({
    id: z.string().min(1),
    fraction: z.number().positive().max(1),
    trigger: z.literal('at_buy_price'),
  }),
  z.object({
    id: z.string().min(1),
    fraction: z.number().positive().max(1),
    trigger: z.literal('pct_below_buy_price'),
    pct: z.number().positive().max(1),
  }),
])

export type EntryTranche = z.infer<typeof entryTrancheSchema>

export const portfolioPolicySchema = z.object({
  max_positions: z.number().int().positive(),
  max_position_weight: z.number().positive().max(1),
  cash_buffer_minimum: z.number().min(0).max(1),
  concentration_style: z.enum(['concentrated', 'diversified']),
  target_weight_by_moat: targetWeightByMoatSchema,
  entry_tranches: z.array(entryTrancheSchema).min(1),
})

export const strategyContractSchema = strategyMetadataSchema.extend({
  research: researchPolicySchema,
  hard_gates: z.array(hardGateSchema).min(1),
  valuation: valuationPolicySchema,
  shariah: shariahPolicySchema,
  portfolio: portfolioPolicySchema,
})

export type StrategyMetadata = z.infer<typeof strategyMetadataSchema>
export type SpecialistDefinition = z.infer<typeof specialistDefinitionSchema>
export type HardGate = z.infer<typeof hardGateSchema>
export type ValuationPolicy = z.infer<typeof valuationPolicySchema>
export type ShariahPolicy = z.infer<typeof shariahPolicySchema>
export type PortfolioPolicy = z.infer<typeof portfolioPolicySchema>
export type StrategyContract = z.infer<typeof strategyContractSchema>
