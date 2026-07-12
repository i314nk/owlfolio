// Versioned BASE-RATE table — judgment-objectivity-layer-spec Mechanism 3 (the outside view, enforced).
//
// Any lane proposal that BEATS a base rate must carry an `exceptionality_justification`; Synthesis
// rejects inside-view narrative ("strong execution", "great management") as insufficient. The rule of
// thumb encoded downstream: the more exceptional the claim, the more the evidence must be STRUCTURAL
// rather than narrative (`min_structural_evidence` rises with rarity).
//
// Mirrors the versioned-config pattern of valuationParams.ts / judgmentRubrics.ts (a frozen typed
// object + a `version` field). Start coarse; refine annually (spec build-order item 5).

export type BaseRateId =
  | 'oe_double_digit_10yr'
  | 'roic_gt_20_decade'
  | 'monopoly_classification'
  | 'margin_expansion'
  | 'credited_g_4_5'

export type BaseRateEntry = {
  /** Stable id used to key burden flags. */
  id: BaseRateId
  /** The exceptional claim this base rate guards against. */
  claim: string
  /** The approximate base rate (the outside view). */
  base_rate_note: string
  /** The burden a proposal that beats this base rate must carry (structural evidence). */
  burden: string
  /**
   * Minimum number of STRUCTURAL exceptionality-justification items required to clear the burden.
   * Rises with rarity (more exceptional → more structural evidence). Narrative items never count.
   */
  min_structural_evidence: number
}

export type BaseRates = {
  /** Monotonic version string. Bump on any change; pairs with a logged config event. */
  version: string
  entries: readonly BaseRateEntry[]
}

/**
 * The frozen DEFAULT base-rate table (spec Mechanism 3 starter table). Bump `version` on any change.
 */
export const BASE_RATES: BaseRates = Object.freeze({
  version: 'base-rates-2026-06-mechanism-3-v1',
  entries: [
    {
      id: 'oe_double_digit_10yr',
      claim: 'Double-digit owner-earnings growth sustained for 10 years',
      base_rate_note: 'A small minority of all firms sustain double-digit OE growth over a full decade.',
      burden: 'Structural: contractual revenue, demonstrated unit reinvestment at high incremental ROIC.',
      min_structural_evidence: 2,
    },
    {
      id: 'roic_gt_20_decade',
      claim: 'ROIC stays above 20% for the next decade',
      base_rate_note: 'Most high-ROIC firms mean-revert toward the cost of capital.',
      burden: 'Identified, durable moat sources mapped to specific moat-rubric items.',
      min_structural_evidence: 2,
    },
    {
      id: 'monopoly_classification',
      claim: '"Monopoly" moat classification',
      base_rate_note: 'A monopoly-grade moat is rare.',
      burden: 'Moat rubric >=10 AND survival of the red-team attack.',
      min_structural_evidence: 2,
    },
    {
      id: 'margin_expansion',
      claim: 'Margins expand from the current level',
      base_rate_note: 'Margin-expansion claims fail more often than hold claims.',
      burden: 'A named, quantified driver — never "operating leverage" alone.',
      min_structural_evidence: 1,
    },
    {
      id: 'credited_g_4_5',
      claim: 'Cited growth of 4%+ — above the GDP-like base rate',
      base_rate_note: 'Most large firms do not compound free cash flow above GDP for a decade.',
      burden: 'Structural drivers — contractual revenue, named quantified levers — never narrative alone.',
      min_structural_evidence: 2,
    },
  ],
}) as BaseRates

/** Look up a base-rate entry by id. */
export function baseRateById(id: string): BaseRateEntry | undefined {
  return BASE_RATES.entries.find((e) => e.id === id)
}
