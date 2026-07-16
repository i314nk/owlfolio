import { z } from 'zod'

// Re-export the derived engine-version marker from the package index so apps/web + @owlfolio/workflow can
// import the single source of truth for the current reasoning vintage (see engineVersion.ts for why it is
// derived rather than hand-bumped).
export { ENGINE_VERSION } from './engineVersion'

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

export const moatClassSchema = z.enum(['narrow', 'moderate', 'wide', 'monopoly'])
export type MoatClass = z.infer<typeof moatClassSchema>

/** Reinvestment runway axis — a distinct axis from moat width, binding for growth credit. */
export const runwaySchema = z.enum(['proven', 'limited', 'none'])
export type Runway = z.infer<typeof runwaySchema>

export const valuationPolicySchema = z.object({
  /** Effective default discount = savings_rate_default + equity_premium (Phase 1.4 / F.2). */
  discount_rate: z.number().positive(),
  /** Fixed UNIFORM equity premium (no quality knob); discount = compliant savings rate + this (Phase 1.4 / Step 3 / F.2). */
  equity_premium: z.number().positive(),
  /** Phase 2 V2 — the UNIFORM required margin of safety (decimal discount to the reference value) the T0
   *  grade measures against. Uniform per F.13 (business quality is not a valuation-loosening lever). */
  required_margin_of_safety: z.number().positive(),
  /** Fail-closed default COMPLIANT SAVINGS rate (risk-free anchor) when the app-config rate is unavailable (F.2; Treasury anchor retired). */
  savings_rate_default: z.number().positive(),
  /** Terminal-value-share flag threshold (Phase 1.5): TV share above this is flagged. */
  terminal_value_share_flag: z.number().positive().max(1),
  /** Terminal-stage growth (g_t) — UNIFORM across every investable business (F.13); durability routes through the moat-durability input. */
  terminal_growth: z.number().positive(),
  /** Stage-1 (explicit) DCF horizon in years — UNIFORM across every investable business (F.13). */
  stage1_horizon: z.number().int().positive(),
  /**
   * Trailing stage-1 years over which near-term growth LINEARLY FADES to the terminal rate (Part D Step 2 —
   * years 6–10 of a 10-yr horizon, F=5). Fade applies only when g > terminal. 0 → flat (no fade).
   */
  growth_fade_years: z.number().int().min(0),
  /**
   * The ONE named growth backstop (Phase 1.3): a single forecasting-humility ceiling on the honest historical
   * owner-earnings growth path (0.15, re-derived 2026-06-15 from the believed-in set's robust OE/share CAGRs).
   * Replaces the old stacked band-ceilings/eligibility/max trio.
   */
  single_growth_cap: z.number().positive(),
  /** GDP-like threshold (~2.5–3%) above which growth is treated as a moat-durability claim (flagged). */
  gdp_growth_threshold: z.number().positive(),
  /** 18× OE sanity-FLAG threshold (Phase 1.6 cap_exceeded) — surfaced, never silently truncated. */
  valuation_multiple_ceiling: z.number().positive(),
  /** Absurd-error guard multiple (100×) — a value at/above this is discarded as a units bug (Phase 1.6). */
  fv_absurd_multiple: z.number().positive(),
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
  // OWNER-LOCKED (2026-07-13): retired — the book gives zones + boldness, not weight tables.
  target_weight_by_moat: targetWeightByMoatSchema.optional(),
  // OWNER-LOCKED (2026-07-13): retired — the plan shows the two book zones, not a ladder.
  entry_tranches: z.array(entryTrancheSchema).optional(),
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
