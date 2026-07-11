import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { ProposedSourcesSchema, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import { runValidatedAgent, type RequiredFieldCheck } from './runValidatedAgent'
import type { GroundingDeps, CapturedSource } from './sourceGrounding'
import type { RedTeamLaneDigest } from './redTeamPass'

// ---------------------------------------------------------------------------
// Dedicated FOCUSED valuation-reasoning call (the same decomposition that got the moat rubric + red-team
// response emitting live). The monolithic synthesis/decision schema intermittently DROPS valuation_reasoning
// (KO: the narrative reasoned "wide moat, durably predictable, but EXPENSIVE" — a clean WATCH — but the
// structured owner-earnings + assumed-growth citation fields fell out under the monolithic schema's load).
// When that happens (absent OR ungrounded) the A1 synthesis-grounding gate fail-closes to RESEARCH_MORE
// (correctly — it will not fabricate a valuation). Rather than ask the monolithic schema to carry it, we run
// a small FOCUSED grounded call whose ONLY output is valuation_reasoning: owner-earnings basis + assumed
// growth + their CITED sources, steered to the harness-verified EDGAR id. It runs ONLY as a fallback (the
// happy path — the decision agent produced a grounded valuation_reasoning — never invokes it). Grounded +
// cite-checked exactly like the other focused calls; if it ALSO cannot ground, the caller leaves grounding
// unmet → RESEARCH_MORE with a visible valuation_reasoning_retry_exhausted degradation note. Never fabricate.
// ---------------------------------------------------------------------------

// The dedicated call's schema = the valuation_reasoning fields ALONE (+ proposed_sources so it grounds/cites).
// Mirrors DecisionAgentSchema.valuation_reasoning exactly.
export const ValuationReasoningSchema = z.object({
  // Cited: the owner-earnings basis the model valued (e.g. "FY25 owner earnings $8.4B per the 10-K").
  owner_earnings_basis: z.string().min(1),
  // GROUNDING: the source_id (or content_hash) of a VERIFIED primary source backing the owner-earnings
  // figure — a real grounded source_id, NOT prose. Cite-checked against the content_hash-verified corpus.
  owner_earnings_citation: z.string().min(1),
  // The near-term growth assumed in the valuation (a fraction, e.g. 0.08).
  assumed_growth: z.number(),
  // Cited: WHY that growth is defensible (the durable-source argument).
  assumed_growth_rationale: z.string().min(1),
  // GROUNDING: the source_id (or content_hash) of a VERIFIED primary source backing the assumed-growth
  // rationale — cite-checked exactly like owner_earnings_citation.
  assumed_growth_citation: z.string().min(1),
  // OPTIONAL, legacy/tolerated: the harness owns the discount (see the DISCOUNT OWNERSHIP guard in the
  // prompt), so the model is instructed NOT to choose its own rate. Retained optional for schema
  // back-compat; a populated value is not expected and is not used to override the harness discount.
  discount_rationale: z.string().optional(),
  // ---- Phase 2 V1: the fields the monolithic synthesis used to carry (MOVED, not redesigned) ----
  // Optional in V1 (the prompt requires them; V4 tightens once the monolithic fields are dropped) so
  // the T0 side keeps its existing graceful degradation when a model omits them.
  // The model's judged buy-below price (price currency). Verbatim — the deterministic rails
  // (buy-zone clamp, absurd-implied-growth clamp, T0 MoS grade in V2) police it.
  proposed_buy_below: z.number().positive().optional(),
  // The model's qualitative read of TODAY's price vs value.
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']).optional(),
  // The judged owner-earnings bridge INPUTS (the T0 arithmetic stays harness-owned; EDGAR anchors
  // NI/D&A/SBC/shares — the model's judgment fields are maintenance capex + the proxy tier + any
  // one-off NI normalization). Mirrors the monolithic decision's block exactly.
  owner_earnings_bridge: z
    .object({
      net_income: z.number(),
      depreciation_amortization: z.number(),
      maintenance_capex: z.number(),
      maintenance_capex_proxy_tier: z.enum(['20', '50', '80']),
      stock_based_comp: z.number(),
      normalized_working_capital_change: z.number(),
      shares_outstanding: z.number(),
    })
    .optional(),
})
export type ValuationReasoning = z.infer<typeof ValuationReasoningSchema>

// The focused agent emits the valuation_reasoning + proposed_sources (so it grounds/cites its own sources).
export const ValuationReasoningAgentSchema = z.object({
  valuation_reasoning: ValuationReasoningSchema,
  proposed_sources: ProposedSourcesSchema,
})
export type ValuationReasoningAnalysis = z.infer<typeof ValuationReasoningAgentSchema>

export type RunValuationReasoningPassArgs = {
  research_case_id: string
  ticker: string
  /** The model the focused call runs on. Defaults to the synthesis/decision model. */
  model_id: string
  /** Compact lane digest so the focused call can reason from the lanes' findings. */
  laneDigest: RedTeamLaneDigest[]
  /** The verified source corpus (source_ids) the focused call must cite from. */
  corpusSourceIds: string[]
  /**
   * The harness's already-content-hash-verified primary EDGAR source_id(s) the focused call should cite for
   * the owner-earnings + assumed-growth citations (the SAME alignment steering the moat/circle use — cite the
   * id the harness reliably verifies, do NOT fetch a self-archive URL). May be empty.
   */
  preVerifiedSourceIds: string[]
  /** Phase 2 V1 (always-on stage): the RESOLVED moat/runway tiers (mechanical anchor ±1, cite-gated). */
  caseDigest?: { moat_class: string; runway: string }
  /** Phase 2 V1: the harness-fetched primary-filing NUMBERS block (the same injection the lanes get). */
  primaryFilingBlock?: string
  /** Phase 2 V1: the circle gate's grounded cashflow drivers/breakers (predictability context). */
  circleDigest?: { drivers: string[]; breakers: string[] }
}

/** Outcome of the dedicated valuation-reasoning call. `ok` carries the valuation_reasoning; `failed` means
 *  retries were exhausted (the caller leaves grounding unmet → the visible RESEARCH_MORE fallback). */
export type ValuationReasoningOutcome =
  | { status: 'ok'; valuation_reasoning: ValuationReasoning; verified_ids: string[]; captured: CapturedSource[]; usage?: { input_tokens?: number; output_tokens?: number } }
  | { status: 'failed'; reason: string; attempts: number }

export function buildValuationReasoningPrompt(args: RunValuationReasoningPassArgs): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const corpus = args.corpusSourceIds.join(', ')
  const preVerified = args.preVerifiedSourceIds.filter((id) => id.trim().length > 0)
  const steer = preVerified.length > 0
    ? `STEER (citation alignment): for the owner-earnings + assumed-growth citations, cite the harness-verified `
      + `primary source_id(s) [${preVerified.join(', ')}] (e.g. sec_edgar_10k_<cik>_fy<year>) — these are already `
      + `fetched + content-verified by the harness. Do NOT fetch or cite your OWN SEC archive URL for the primary `
      + `10-K (it fetches unreliably and will FAIL the cite-check). `
    : ''
  return (
    `You are the Buffett-Munger valuation-judgment agent for ${args.ticker}. Yours is the dedicated `
    + `valuation stage: the specialist lanes have reported and the moat tier is resolved — your FOCUSED, `
    + `REQUIRED job is to produce the grounded valuation judgment the synthesis will consume.\n\n`
    + `Lane findings (the shared narrative to value from):\n${laneLines}\n\n`
    + (args.caseDigest === undefined ? '' : `Resolved judgment tiers (mechanical anchor ±1, cite-gated): moat_class=${args.caseDigest.moat_class}, runway=${args.caseDigest.runway}.\n`)
    + (args.circleDigest === undefined ? '' : `Circle-gate grounded cashflow drivers: ${args.circleDigest.drivers.join('; ') || '(none)'} | predictability breakers: ${args.circleDigest.breakers.join('; ') || '(none)'}.\n`)
    + (args.primaryFilingBlock ?? '')
    + `\n`
    + `Produce a single valuation_reasoning:\n`
    + `  - owner_earnings_basis: the owner-earnings figure you valued, CITED.\n`
    + `  - owner_earnings_citation: REQUIRED — the source_id of a VERIFIED primary source backing it (a real `
    + `grounded source_id, NOT prose).\n`
    + `  - assumed_growth: the near-term growth you assumed (a fraction, e.g. 0.06). Estimate HONESTLY — a `
    + `growth above ~15% will be FLAGGED as implausible.\n`
    + `  - assumed_growth_rationale: WHY that growth is defensible, CITED (a durable source, not "strong execution").\n`
    + `  - assumed_growth_citation: REQUIRED — the source_id of a VERIFIED primary source backing the growth `
    + `rationale (again a real grounded source_id, NOT prose).\n`
    + `  - proposed_buy_below: the price at/below which you would buy, in the US-LISTED quote currency (USD `
    + `per ADR/share for foreign filers — NEVER the local-exchange or reporting currency) — your judged `
    + `margin-of-safety entry. The harness deterministically cross-checks it (reverse-DCF implied growth, `
    + `buy-zone coherence); an entry price that itself implies above-cap growth derates the verdict.\n`
    + `  - valuation_status: ATTRACTIVE | FAIR | EXPENSIVE | INSUFFICIENT_DATA — your qualitative read of `
    + `TODAY's price vs value (keep it coherent with your own proposed_buy_below).\n`
    + `  - owner_earnings_bridge: your judged bridge INPUTS from the filing numbers above, in the FILING'S `
    + `REPORTING currency and labeled as such in your basis text (say "DKK 100.5B", not "$100.5B", for a DKK `
    + `filer) (net_income, `
    + `depreciation_amortization, maintenance_capex + maintenance_capex_proxy_tier ('20'|'50'|'80'), `
    + `stock_based_comp, normalized_working_capital_change, shares_outstanding — $M and millions of shares). `
    + `The harness anchors NI/D&A/SBC/shares to EDGAR and bounds maintenance_capex by total capex; your real `
    + `judgments are the maintenance-vs-growth capex split AND the normalized working-capital change.\n`
    + `  - normalized_working_capital_change is a JUDGMENT, not a default: read the cash-flow statement's `
    + `"changes in operating assets and liabilities" across the last 2-3 fiscal years (read_source the `
    + `pre-verified filing, section 8) and estimate the STRUCTURAL recurring working-capital use of cash as `
    + `the business grows — normalize away one-year swings. SIGN: positive = a recurring USE of cash `
    + `(subtracts from owner earnings); negative = a structural release (adds). Enter 0 ONLY when the filing `
    + `shows working capital roughly neutral across years — and if you enter 0, SAY WHY in `
    + `owner_earnings_basis (e.g. "negative working-capital cycle; customers pay upfront"). A silent `
    + `defaulted 0 overstates owner earnings for working-capital-hungry businesses.\n\n`
    + `GROUNDING (non-negotiable): the harness deterministically cite-checks owner_earnings_citation and `
    + `assumed_growth_citation against the grounded corpus and FAILS CLOSED when either is absent or does not `
    + `verify. Available corpus source_ids: ${corpus}. ${steer}Return your sources in proposed_sources with real URLs.\n`
    + `DISCOUNT OWNERSHIP (the harness owns the discount, not you): the harness discounts owner earnings `
    + `deterministically at a single config-driven uniform rate (the compliant savings rate plus a fixed equity `
    + `premium) — the SAME for every business. Do NOT specify, assume, or assert your own discount rate, cost of `
    + `capital, WACC, or required return, and do NOT present a textbook DCF or an intrinsic-value range computed `
    + `off a self-chosen rate; that math is the harness's job. Reason about VALUE only: the owner-earnings basis, `
    + `the durability of growth, and a qualitative cheap / fair / expensive read versus today's price.\n`
    + `EXAMPLE (shape only): {"valuation_reasoning":{"owner_earnings_basis":"FY25 owner earnings $8.4B per the 10-K",`
    + `"owner_earnings_citation":"sec_edgar_10k_<cik>_fy<year>","assumed_growth":0.06,`
    + `"assumed_growth_rationale":"mid-single-digit, grounded in segment capex","assumed_growth_citation":"sec_edgar_10k_<cik>_fy<year>"}}.`
  )
}

/**
 * Run the dedicated valuation-reasoning call under schema-validation + retry. The valuation_reasoning (with
 * both citations) is the sole required field, so the retry FORCES it. On success returns the grounded
 * valuation_reasoning + its verified ids + captured sources; on exhaustion returns `failed` so the caller
 * leaves the A1 grounding gate unmet (the visible RESEARCH_MORE fallback; the run still completes). Grounding/
 * citation verification is unchanged (delegated to runGroundedAgent inside runValidatedAgent); the caller
 * re-runs the deterministic cite-check on the result so an ungrounded focused citation does NOT count.
 */
export async function runValuationReasoningPass(
  provider: Provider,
  args: RunValuationReasoningPassArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<ValuationReasoningOutcome> {
  const requiredFields: RequiredFieldCheck<ValuationReasoningAnalysis>[] = [
    // Phase 2 V4: the stage OWNS the buy-below / status / bridge — retry-forced (schema stays optional so
    // an exhausted retry degrades to the visible failed outcome instead of a hard throw).
    {
      name: 'valuation_reasoning.proposed_buy_below',
      present: (a) => typeof a.valuation_reasoning?.proposed_buy_below === 'number' && Number.isFinite(a.valuation_reasoning.proposed_buy_below) && a.valuation_reasoning.proposed_buy_below > 0,
      hint: 'the price at/below which you would buy, in the US-LISTED quote currency (a positive number)',
    },
    {
      name: 'valuation_reasoning.valuation_status',
      present: (a) => a.valuation_reasoning?.valuation_status !== undefined,
      hint: "ATTRACTIVE | FAIR | EXPENSIVE | INSUFFICIENT_DATA — your read of TODAY's price vs value",
    },
    {
      name: 'valuation_reasoning.owner_earnings_bridge',
      present: (a) => a.valuation_reasoning?.owner_earnings_bridge !== undefined,
      hint: 'your judged bridge inputs (net_income, depreciation_amortization, maintenance_capex + proxy tier, stock_based_comp, normalized_working_capital_change, shares_outstanding) in the reporting currency',
    },
    {
      name: 'valuation_reasoning.owner_earnings_citation',
      present: (a) => (a.valuation_reasoning?.owner_earnings_citation ?? '').length > 0,
      hint: 'the source_id of a VERIFIED primary source backing the owner-earnings figure (a real grounded source_id, not prose)',
    },
    {
      name: 'valuation_reasoning.assumed_growth_citation',
      present: (a) => (a.valuation_reasoning?.assumed_growth_citation ?? '').length > 0,
      hint: 'the source_id of a VERIFIED primary source backing the assumed-growth rationale (a real grounded source_id, not prose)',
    },
  ]
  try {
    const validated = await runValidatedAgent(
      provider,
      {
        run_id: `run_${args.research_case_id}_valuation_reasoning`,
        model_id: args.model_id,
        prompt: buildValuationReasoningPrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerValuationReasoning',
      },
      ValuationReasoningAgentSchema,
      {
        ...(deps.ground === undefined ? {} : { ground: deps.ground }),
        ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
        requiredFields,
      },
    )
    if (validated.status === 'ok') {
      return {
        status: 'ok',
        valuation_reasoning: validated.result.analysis.valuation_reasoning,
        verified_ids: validated.result.verified_ids,
        captured: validated.result.captured,
        ...(validated.result.usage === undefined ? {} : { usage: validated.result.usage }),
      }
    }
    return { status: 'failed', reason: validated.reason, attempts: validated.attempts }
  } catch (error) {
    // Provider/timeout error after retries — degrade visibly (the caller keeps A1 grounding unmet).
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), attempts: 0 }
  }
}
