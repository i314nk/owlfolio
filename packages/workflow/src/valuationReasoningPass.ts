import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { ProposedSourcesSchema, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import { runValidatedAgent, type RequiredFieldCheck } from './runValidatedAgent'
import type { GroundingDeps, CapturedSource } from './sourceGrounding'
import type { InversionLaneDigest } from './inversionPass'

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
  // E2 (owner-locked 2026-07-12): the owner-earnings basis + citation + judged bridge are RETIRED —
  // the harness owns the FCF basis (CFO − capex, T0 from EDGAR). The model's remaining valuation
  // judgments are the growth (cited) and the industry exit multiple (cited-or-labeled).
  // The near-term growth assumed in the valuation (a fraction, e.g. 0.08).
  assumed_growth: z.number(),
  // Cited: WHY that growth is defensible (the durable-source argument).
  assumed_growth_rationale: z.string().min(1),
  // GROUNDING: the source_id (or content_hash) of a VERIFIED primary source backing the assumed-growth
  // rationale — cite-checked against the content_hash-verified corpus.
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
  // C3 (owner-locked 2026-07-12): valuation_status is retired from the stage — the harness DERIVES
  // it arithmetically from the computed thresholds (a legacy emission is stripped as an unknown key).
  // ---- Phase 4 (book alignment): the industry-typical P/FCF EXIT MULTIPLE — the terminal value is
  // year-10 FCF × this. Cited-or-labeled (peer-standout pattern): include a citation ONLY when the
  // figure comes from a corpus-verifiable source; the harness clamps to [8, 20] and falls back to a
  // conservative 12× when absent/invalid. The model judges the multiple; the arithmetic is harness-owned.
  industry_exit_multiple: z
    .object({
      multiple: z.number().positive(),
      // What industry set / valuation norm the multiple reflects (e.g. "US warehouse-club retail
      // has traded 15–18× FCF over the last decade").
      basis_note: z.string().min(1),
      citation: z.string().optional(),
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
  laneDigest: InversionLaneDigest[]
  /** The verified source corpus (source_ids) the focused call must cite from. */
  corpusSourceIds: string[]
  /**
   * The harness's already-content-hash-verified primary EDGAR source_id(s) the focused call should cite for
   * the owner-earnings + assumed-growth citations (the SAME alignment steering the moat/circle use — cite the
   * id the harness reliably verifies, do NOT fetch a self-archive URL). May be empty.
   */
  preVerifiedSourceIds: string[]
  /** Phase 2 V1 (always-on stage): the RESOLVED moat tier (mechanical anchor ±1, cite-gated). */
  caseDigest?: { moat_class: string }
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
    ? `STEER (citation alignment): for the assumed-growth citation, cite the harness-verified `
      + `primary source_id(s) [${preVerified.join(', ')}] (e.g. sec_edgar_10k_<cik>_fy<year>) — these are already `
      + `fetched + content-verified by the harness. Do NOT fetch or cite your OWN SEC archive URL for the primary `
      + `10-K (it fetches unreliably and will FAIL the cite-check). `
    : ''
  return (
    `You are the Buffett-Munger valuation-judgment agent for ${args.ticker}. Yours is the dedicated `
    + `valuation stage: the specialist lanes have reported and the moat tier is resolved — your FOCUSED, `
    + `REQUIRED job is to produce the grounded valuation judgment the synthesis will consume.\n\n`
    + `Lane findings (the shared narrative to value from):\n${laneLines}\n\n`
    + (args.caseDigest === undefined ? '' : `Resolved judgment tier (mechanical anchor ±1, cite-gated): moat_class=${args.caseDigest.moat_class}.\n`)
    + (args.circleDigest === undefined ? '' : `Circle-gate grounded cashflow drivers: ${args.circleDigest.drivers.join('; ') || '(none)'} | predictability breakers: ${args.circleDigest.breakers.join('; ') || '(none)'}.\n`)
    + (args.primaryFilingBlock ?? '')
    + `\n`
    + `THE HARNESS OWNS THE CASH BASIS: intrinsic value is computed deterministically from the filing's `
    + `FREE CASH FLOW (cash from operations − capital expenditures, both tagged XBRL facts) — you do NOT `
    + `estimate owner earnings, maintenance capex, or working-capital normalizations. Your judgments are `
    + `the GROWTH and the EXIT MULTIPLE.\n\n`
    + `Produce a single valuation_reasoning:\n`
    + `  - assumed_growth: the near-term FREE-CASH-FLOW growth you assume (a fraction, e.g. 0.06). Estimate HONESTLY — a `
    + `growth above ~15% will be FLAGGED as implausible.\n`
    + `  - assumed_growth_rationale: WHY that growth is defensible, CITED (a durable source, not "strong execution").\n`
    + `  - assumed_growth_citation: REQUIRED — the source_id of a VERIFIED primary source backing the growth `
    + `rationale (again a real grounded source_id, NOT prose).\n`
    + `  - proposed_buy_below: the price at/below which you would buy, in the US-LISTED quote currency (USD `
    + `per ADR/share for foreign filers — NEVER the local-exchange or reporting currency) — your judged `
    + `margin-of-safety entry. The harness deterministically cross-checks it (reverse-DCF implied growth, `
    + `buy-zone coherence); an entry price that itself implies above-cap growth derates the verdict.\n`
    + `  - industry_exit_multiple: the INDUSTRY-TYPICAL price-to-free-cash-flow multiple this business `
    + `would plausibly sell for in ~10 years ({multiple, basis_note, citation?}). Name the industry norm in `
    + `basis_note; include citation ONLY if the figure comes from a corpus-verifiable source (an honest `
    + `uncited judgment is labeled model-asserted — better than a fake citation, which FAILS the cite-check). `
    + `The harness clamps to a sane band and computes the terminal value deterministically.\n`
    + `GROUNDING (non-negotiable): the harness deterministically cite-checks assumed_growth_citation `
    + `against the grounded corpus and FAILS CLOSED when it is absent or does not verify. Available corpus source_ids: ${corpus}. ${steer}Return your sources in proposed_sources with real URLs.\n`
    + `DISCOUNT OWNERSHIP (the harness owns the discount, not you): the harness discounts free cash flow `
    + `deterministically at a single config-driven uniform rate (the compliant savings rate plus a fixed equity `
    + `premium) — the SAME for every business. Do NOT specify, assume, or assert your own discount rate, cost of `
    + `capital, WACC, or required return, and do NOT present a textbook DCF or an intrinsic-value range computed `
    + `off a self-chosen rate; that math is the harness's job. Reason about VALUE only: `
    + `the durability of growth, and a qualitative cheap / fair / expensive read versus today's price.\n`
    + `EXAMPLE (shape only): {"valuation_reasoning":{"assumed_growth":0.06,`
    + `"assumed_growth_rationale":"mid-single-digit, grounded in segment capex","assumed_growth_citation":"sec_edgar_10k_<cik>_fy<year>",`
    + `"industry_exit_multiple":{"multiple":16,"basis_note":"US warehouse-club retail has traded 15-18x FCF"}}}.`
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
    // Phase 4 (book alignment): the industry P/FCF exit multiple — retry-forced; an exhausted retry
    // degrades to the harness's conservative fallback multiple (12×), never a hard throw.
    {
      name: 'valuation_reasoning.industry_exit_multiple',
      present: (a) => a.valuation_reasoning?.industry_exit_multiple !== undefined,
      hint: 'the industry-typical P/FCF exit multiple {multiple, basis_note, citation?} — cite only a corpus-verifiable source, else omit the citation',
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
