// Mechanism 3 — Base-Rate Constraints: the SYNTHESIS burden check (deterministic flagging).
//
// judgment-objectivity-layer-spec Mechanism 3: any case whose proposals BEAT a base rate (a monopoly
// classification, credited g in the 4-5% band, a >20% ROIC-sustained forecast, a margin-expansion
// claim) must carry an `exceptionality_justification` that is STRUCTURAL (cites contractual revenue,
// mapped moat-rubric items, a named quantified driver) — NOT inside-view narrative ("strong
// execution", "great management"). The harness FLAGS base-rate-beating claims lacking a structural
// justification as `base_rate_burden_unmet` (surfaced to the human + a conservative downgrade hook).
//
// This is deterministic: the harness checks the PRESENCE and STRUCTURALITY signals of the
// justification — it does NOT itself judge truth. The rule "more exceptional → more structural
// evidence" is encoded via each base rate's `min_structural_evidence` (rarer ⇒ higher).

import { baseRateById, type BaseRateId } from '@owlfolio/strategies/baseRates'

/** One exceptionality-justification item the synthesis attached to defend an exceptional claim. */
export type ExceptionalityJustification = {
  claim: string
  /** A citation hash / source id anchoring the claim to the corpus (presence signal). */
  citation_hash?: string
}

export type BaseRateBurdenInput = {
  /** Resolved moat class (monopoly beats the monopoly base rate). */
  moat_class?: string
  /** Harness-credited growth rate (4-5% band beats the credited_g base rate). */
  credited_growth_rate?: number
  /** A forecast/claim that ROIC stays >20% for the decade. */
  roic_forecast_gt_20?: boolean
  /** A claim that margins expand from the current level. */
  margin_expansion_claimed?: boolean
  /** A claim of double-digit OE growth sustained 10yr. */
  oe_double_digit_10yr_claimed?: boolean
  /** The structural-or-narrative justification items the synthesis supplied. */
  exceptionality_justifications: ExceptionalityJustification[]
}

export type BaseRateBurdenFlag = {
  base_rate_id: BaseRateId
  claim: string
  base_rate_note: string
  burden: string
  /** 'met' — enough structural evidence; 'unmet' — flagged `base_rate_burden_unmet`. */
  status: 'met' | 'unmet'
  /** Structural items required (rises with rarity) vs. how many structural items were detected. */
  required_structural_evidence: number
  structural_evidence_count: number
}

export type BaseRateBurdenResult = {
  flags: BaseRateBurdenFlag[]
  /** Count of flags with status 'unmet' — the conservative-downgrade hook fires when > 0. */
  unmet_count: number
}

// Inside-view narrative markers the spec rejects as insufficient. A justification that reads like one
// of these (and carries no structural specifics) does NOT count toward the structural burden.
const NARRATIVE_MARKERS = [
  'strong execution', 'great management', 'great team', 'best-in-class team', 'visionary',
  'operating leverage', 'strong brand', 'strong momentum', 'well positioned', 'well-positioned',
  'industry leader', 'market leader', 'high quality', 'high-quality', 'durable franchise',
]

// Structural signals: a justification is STRUCTURAL if it cites concrete, checkable structure —
// contractual revenue, a mapped rubric item, a named quantified driver (a number/percentage/unit),
// a filing/segment reference, etc. These are presence/structurality signals, not truth judgments.
const STRUCTURAL_MARKERS = [
  'contract', 'take-or-pay', 'backlog', 'rubric', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6',
  'segment', 'note ', '10-k', '10k', '20-f', 'def 14a', 'proxy', 'patent', 'regulat',
  'switching cost', 'retention', 'churn', 'incremental roic', 'reinvest', 'tam', 'price increase',
  'market share', 'capacity', 'unit econ',
]

/** A justification counts as STRUCTURAL when it carries a structural signal (and is not pure narrative). */
function isStructural(j: ExceptionalityJustification): boolean {
  const text = j.claim.toLowerCase()
  const looksNarrative = NARRATIVE_MARKERS.some((m) => text.includes(m))
  const hasStructuralMarker = STRUCTURAL_MARKERS.some((m) => text.includes(m))
  // A number/percentage adjacent to a noun is a quantified driver signal.
  const hasQuantifiedDriver = /\d/.test(text) && (hasStructuralMarker || /%|\bbps\b|\$/.test(text))
  if (hasStructuralMarker || hasQuantifiedDriver) return true
  // Pure narrative with no structural anchor never clears the burden.
  if (looksNarrative) return false
  return false
}

/**
 * Evaluate the base-rate burden for a synthesized case (Mechanism 3). For each base rate the case
 * BEATS, require `min_structural_evidence` STRUCTURAL justification items; flag `base_rate_burden_unmet`
 * (status 'unmet') when too few are present. Deterministic — presence/structurality only, no truth
 * judgment. The more exceptional the claim, the more structural items required.
 */
export function evaluateBaseRateBurden(input: BaseRateBurdenInput): BaseRateBurdenResult {
  const structuralCount = input.exceptionality_justifications.filter(isStructural).length

  const beaten: BaseRateId[] = []
  if (input.moat_class === 'monopoly') beaten.push('monopoly_classification')
  if (input.credited_growth_rate !== undefined && input.credited_growth_rate >= 0.04 - 1e-9) {
    beaten.push('credited_g_4_5')
  }
  if (input.roic_forecast_gt_20 === true) beaten.push('roic_gt_20_decade')
  if (input.margin_expansion_claimed === true) beaten.push('margin_expansion')
  if (input.oe_double_digit_10yr_claimed === true) beaten.push('oe_double_digit_10yr')

  const flags: BaseRateBurdenFlag[] = []
  for (const id of beaten) {
    const entry = baseRateById(id)
    if (entry === undefined) continue
    const required = entry.min_structural_evidence
    const met = structuralCount >= required
    flags.push({
      base_rate_id: id,
      claim: entry.claim,
      base_rate_note: entry.base_rate_note,
      burden: entry.burden,
      status: met ? 'met' : 'unmet',
      required_structural_evidence: required,
      structural_evidence_count: structuralCount,
    })
  }

  return { flags, unmet_count: flags.filter((f) => f.status === 'unmet').length }
}
