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
  // OPTIONAL: the model's discount-rate reasoning, if it argues one.
  discount_rationale: z.string().optional(),
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
}

/** Outcome of the dedicated valuation-reasoning call. `ok` carries the valuation_reasoning; `failed` means
 *  retries were exhausted (the caller leaves grounding unmet → the visible RESEARCH_MORE fallback). */
export type ValuationReasoningOutcome =
  | { status: 'ok'; valuation_reasoning: ValuationReasoning; verified_ids: string[]; captured: CapturedSource[] }
  | { status: 'failed'; reason: string; attempts: number }

function buildValuationReasoningPrompt(args: RunValuationReasoningPassArgs): string {
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
    `You are the Buffett-Munger valuation-reasoning agent for ${args.ticker}. The synthesis/decision agent `
    + `omitted (or failed to ground) the structured valuation_reasoning — your FOCUSED, REQUIRED job is to `
    + `produce it grounded.\n\n`
    + `Lane findings (the shared narrative to value from):\n${laneLines}\n\n`
    + `Produce a single valuation_reasoning:\n`
    + `  - owner_earnings_basis: the owner-earnings figure you valued, CITED.\n`
    + `  - owner_earnings_citation: REQUIRED — the source_id of a VERIFIED primary source backing it (a real `
    + `grounded source_id, NOT prose).\n`
    + `  - assumed_growth: the near-term growth you assumed (a fraction, e.g. 0.06). Estimate HONESTLY — a `
    + `growth above ~15% will be FLAGGED as implausible.\n`
    + `  - assumed_growth_rationale: WHY that growth is defensible, CITED (a durable source, not "strong execution").\n`
    + `  - assumed_growth_citation: REQUIRED — the source_id of a VERIFIED primary source backing the growth `
    + `rationale (again a real grounded source_id, NOT prose).\n\n`
    + `GROUNDING (non-negotiable): the harness deterministically cite-checks owner_earnings_citation and `
    + `assumed_growth_citation against the grounded corpus and FAILS CLOSED when either is absent or does not `
    + `verify. Available corpus source_ids: ${corpus}. ${steer}Return your sources in proposed_sources with real URLs.\n`
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
      }
    }
    return { status: 'failed', reason: validated.reason, attempts: validated.attempts }
  } catch (error) {
    // Provider/timeout error after retries — degrade visibly (the caller keeps A1 grounding unmet).
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), attempts: 0 }
  }
}
