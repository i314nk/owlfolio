// model-tiering-spec "Qualification Eval" — the PURE scorer + report shape.
//
// "A model touches production only after passing the golden set." This module is the deterministic,
// side-effect-free heart of that gate: given the lane outputs a model produced for the golden-set
// companies + the frozen reference answers (goldenSet.ts), it scores each pass criterion and produces
// an aggregate `qualified: boolean` + a report. The LIVE runner that actually invokes the swarm and
// writes the report lives in @owlfolio/workflow (modelQualification.ts) — kept separate so this
// scoring logic is unit-tested with no providers/IO.
//
// Pass criteria (per the spec):
//   - Moat class: EXACT match OR one (or more) tier MORE CONSERVATIVE. (More conservative = a LOWER
//     tier on MOAT_CLASS_ORDER; a MORE AGGRESSIVE tier fails.)
//   - OE bridge inputs: within ±10% of reference (per scored field; maintenance_capex only when the
//     reference froze it).
//   - Shariah status: EXACT match (no one-tier leniency — a wrong Shariah call is never "conservative").
//   - Fabricated citations: ZERO.
//   - Schema-valid on first attempt: ≥90% across all scored lane runs (an AGGREGATE criterion).

import {
  GOLDEN_SET,
  MOAT_CLASS_ORDER,
  type GoldenMoatClass,
  type GoldenSet,
  type GoldenSetCompany,
  type GoldenShariahStatus,
} from './goldenSet'

/** ±10% tolerance for OE-bridge inputs (the spec's hard band). */
export const OE_BRIDGE_TOLERANCE = 0.1
/** Minimum first-attempt schema-valid rate across all scored runs. */
export const SCHEMA_VALID_FIRST_ATTEMPT_MIN = 0.9

/**
 * The OE-bridge inputs a lane produced (company totals in MILLIONS of the reporting currency; shares in
 * M). maintenance_capex optional. `reporting_currency` is the ISO code of the monetary fields (absent ⇒
 * USD); the scorer compares ONLY against a reference in the SAME currency so an FX scale gap (e.g. a
 * DKK-reporting foreign filer vs a USD reference) is caught as a currency mismatch, not a near-miss.
 */
export type LaneOeBridge = {
  reporting_currency?: string
  net_income_musd: number
  d_and_a_musd: number
  maintenance_capex_musd?: number
  sbc_musd: number
  diluted_shares_m: number
}

/**
 * One golden-set lane run's scoreable output. The live runner extracts these from the swarm result;
 * the scorer never touches a provider. `fabricated_citation_count` is the count of cited sources the
 * harness could NOT verify against its fetched corpus (the grounding firewall already computes this).
 * `schema_valid_first_attempt` is true when the lane validated on the FIRST attempt (no retry bounce).
 */
export type LaneQualificationOutput = {
  ticker: string
  moat_class: GoldenMoatClass
  shariah_status: GoldenShariahStatus
  oe_bridge: LaneOeBridge
  fabricated_citation_count: number
  schema_valid_first_attempt: boolean
}

export type CriterionResult = {
  pass: boolean
  detail: string
}

export type OeBridgeInputResult = {
  field: keyof LaneOeBridge
  reference: number
  observed: number
  /** Relative deviation |observed-reference|/|reference|. */
  deviation: number
  pass: boolean
}

export type CompanyQualificationResult = {
  ticker: string
  company: string
  /** true when no lane output was supplied for this golden-set company (fail-closed). */
  missing: boolean
  moat: CriterionResult & { reference: GoldenMoatClass; observed?: GoldenMoatClass }
  oe_bridge: CriterionResult & { inputs: OeBridgeInputResult[] }
  shariah: CriterionResult & { reference: GoldenShariahStatus; observed?: GoldenShariahStatus }
  fabricated_citations: CriterionResult & { count: number }
  /** All PER-COMPANY criteria passed (schema-valid is scored as an aggregate, not per-company). */
  qualified: boolean
}

export type QualificationReport = {
  golden_set_version: string
  /** Fraction of scored runs that were schema-valid on the first attempt. */
  schema_valid_first_attempt_rate: number
  schema_valid_criterion: CriterionResult
  companies: CompanyQualificationResult[]
  /** Every company passed AND the aggregate schema-valid criterion passed. */
  qualified: boolean
}

/** Moat passes when observed is EXACT or MORE CONSERVATIVE (lower or equal index on the tier order). */
function scoreMoat(reference: GoldenMoatClass, observed: GoldenMoatClass | undefined): CriterionResult {
  if (observed === undefined) {
    return { pass: false, detail: 'No moat_class produced (missing) — fail-closed.' }
  }
  const refIdx = MOAT_CLASS_ORDER.indexOf(reference)
  const obsIdx = MOAT_CLASS_ORDER.indexOf(observed)
  if (obsIdx < 0) {
    return { pass: false, detail: `Unknown moat_class '${observed}'.` }
  }
  // More conservative = lower tier index. Exact (equal) or lower passes; a HIGHER (more aggressive) fails.
  const pass = obsIdx <= refIdx
  const relation = obsIdx === refIdx ? 'exact match' : obsIdx < refIdx ? 'more conservative' : 'MORE AGGRESSIVE'
  return {
    pass,
    detail: `moat ${observed} vs reference ${reference} (${relation}).`,
  }
}

/** Shariah passes only on an EXACT match — a wrong sector call is never "conservative". */
function scoreShariah(reference: GoldenShariahStatus, observed: GoldenShariahStatus | undefined): CriterionResult {
  if (observed === undefined) {
    return { pass: false, detail: 'No shariah_status produced (missing) — fail-closed.' }
  }
  const pass = observed === reference
  return { pass, detail: `shariah ${observed} vs reference ${reference} (${pass ? 'exact' : 'mismatch'}).` }
}

/** Default reporting currency when a bridge omits one (US 10-K filers report in USD). */
const DEFAULT_REPORTING_CURRENCY = 'USD'

function normalizedCurrency(value: string | undefined): string {
  return (value ?? DEFAULT_REPORTING_CURRENCY).trim().toUpperCase()
}

/**
 * OE-bridge passes when EVERY scored input is within ±10% of its reference — AND the observation is in
 * the SAME reporting currency as the reference. A currency mismatch (e.g. a DKK-reporting foreign filer
 * scored against a USD reference) is NOT a near-miss: comparing across currencies measures FX scale, not
 * judgment, so it fails-closed with a currency-named detail rather than a bogus huge deviation.
 */
function scoreOeBridge(reference: GoldenSetCompany['expected_oe_bridge'], observed: LaneOeBridge | undefined): CriterionResult & { inputs: OeBridgeInputResult[] } {
  if (observed === undefined) {
    return { pass: false, detail: 'No OE bridge produced (missing) — fail-closed.', inputs: [] }
  }
  const refCurrency = normalizedCurrency(reference.reporting_currency)
  const obsCurrency = normalizedCurrency(observed.reporting_currency)
  if (refCurrency !== obsCurrency) {
    return {
      pass: false,
      detail: `OE-bridge currency mismatch: observed in ${obsCurrency} but reference frozen in ${refCurrency} — not scored across currencies (compare in the reporting currency).`,
      inputs: [],
    }
  }
  // Only score MONETARY/share fields the reference froze (reporting_currency is metadata, not a metric;
  // maintenance_capex_musd is optional and often omitted). `reporting_currency` is filtered out so every
  // scored field is numeric.
  type NumericOeField = Exclude<keyof LaneOeBridge, 'reporting_currency'>
  const fields = (Object.keys(reference) as (keyof LaneOeBridge)[])
    .filter((f): f is NumericOeField => f !== 'reporting_currency' && reference[f] !== undefined)
  const inputs: OeBridgeInputResult[] = fields.map((field) => {
    const ref = reference[field] as number
    const obs = observed[field]
    if (obs === undefined || !Number.isFinite(obs)) {
      return { field, reference: ref, observed: NaN, deviation: Number.POSITIVE_INFINITY, pass: false }
    }
    const deviation = ref === 0 ? (obs === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(obs - ref) / Math.abs(ref)
    return { field, reference: ref, observed: obs, deviation, pass: deviation <= OE_BRIDGE_TOLERANCE }
  })
  const failed = inputs.filter((i) => !i.pass)
  return {
    pass: failed.length === 0,
    detail: failed.length === 0
      ? `All ${inputs.length} OE-bridge input(s) within ±${OE_BRIDGE_TOLERANCE * 100}%.`
      : `${failed.length}/${inputs.length} OE-bridge input(s) outside ±${OE_BRIDGE_TOLERANCE * 100}%: ${failed.map((f) => `${f.field} ${Number.isFinite(f.deviation) ? `${(f.deviation * 100).toFixed(1)}%` : 'missing'}`).join(', ')}.`,
    inputs,
  }
}

/**
 * Score a model's golden-set lane outputs against the frozen references. Pure: no IO, no provider.
 * `qualified` is true ONLY when every golden-set company passes every per-company criterion AND the
 * aggregate first-attempt schema-valid rate is ≥90%. A golden-set company with no supplied output is
 * scored MISSING → not qualified (fail-closed; a model that didn't run a name is not qualified on it).
 */
export function scoreQualification(
  outputs: LaneQualificationOutput[],
  goldenSet: GoldenSet = GOLDEN_SET,
): QualificationReport {
  const byTicker = new Map<string, LaneQualificationOutput>()
  for (const o of outputs) byTicker.set(o.ticker.trim().toUpperCase(), o)

  const companies: CompanyQualificationResult[] = goldenSet.companies.map((company) => {
    const observed = byTicker.get(company.ticker.toUpperCase())
    const missing = observed === undefined
    const moat = { ...scoreMoat(company.expected_moat_class, observed?.moat_class), reference: company.expected_moat_class, ...(observed === undefined ? {} : { observed: observed.moat_class }) }
    const oe = { ...scoreOeBridge(company.expected_oe_bridge, observed?.oe_bridge) }
    const shariah = { ...scoreShariah(company.expected_shariah_status, observed?.shariah_status), reference: company.expected_shariah_status, ...(observed === undefined ? {} : { observed: observed.shariah_status }) }
    const fabCount = observed?.fabricated_citation_count ?? 0
    const fabricated_citations = {
      pass: !missing && fabCount === 0,
      detail: missing ? 'No output (missing) — fail-closed.' : fabCount === 0 ? 'Zero fabricated citations.' : `${fabCount} fabricated citation(s) — any fabrication fails.`,
      count: fabCount,
    }
    const qualified = !missing && moat.pass && oe.pass && shariah.pass && fabricated_citations.pass
    return { ticker: company.ticker, company: company.company, missing, moat, oe_bridge: oe, shariah, fabricated_citations, qualified }
  })

  // Aggregate schema-valid-on-first-attempt rate across all SUPPLIED runs (an empty set fails closed).
  const scoredRuns = outputs.length
  const validRuns = outputs.filter((o) => o.schema_valid_first_attempt).length
  const rate = scoredRuns === 0 ? 0 : validRuns / scoredRuns
  const schema_valid_criterion: CriterionResult = {
    pass: scoredRuns > 0 && rate >= SCHEMA_VALID_FIRST_ATTEMPT_MIN,
    detail: scoredRuns === 0
      ? 'No scored runs — schema-valid rate undefined; fail-closed.'
      : `${validRuns}/${scoredRuns} runs schema-valid on first attempt (${(rate * 100).toFixed(1)}%, threshold ${(SCHEMA_VALID_FIRST_ATTEMPT_MIN * 100).toFixed(0)}%).`,
  }

  const qualified = companies.every((c) => c.qualified) && schema_valid_criterion.pass

  return {
    golden_set_version: goldenSet.version,
    schema_valid_first_attempt_rate: rate,
    schema_valid_criterion,
    companies,
    qualified,
  }
}
