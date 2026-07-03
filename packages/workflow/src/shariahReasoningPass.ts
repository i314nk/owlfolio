import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { ProposedSourcesSchema, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import { runValidatedAgent, type RequiredFieldCheck } from './runValidatedAgent'
import type { GroundingDeps, CapturedSource } from './sourceGrounding'
import type { RedTeamLaneDigest } from './redTeamPass'

// ---------------------------------------------------------------------------
// Dedicated FOCUSED Shariah-reasoning call (mirrors valuationReasoningPass).
//
// The Shariah compliance overlay is moved from a parallel deep-dive lane into a
// dedicated focused pass so it can be run independently, retried under
// runValidatedAgent, and grounded with the same cite-check discipline as the
// valuation reasoning pass. The model supplies ONLY the judgment inputs:
//   - sector_status: segment-revenue-confirmed compliance verdict
//   - impermissible_income: $M of non-permissible income (null = undetermined)
//   - sector_citation: source_id of the verified primary source backing the sector judgment
//
// The harness OWNS the AAOIFI debt/cash/impermissible ratio computation,
// verdict determination, and purification % — the model must NOT compute them.
// Grounded + cite-checked; if it cannot ground, fails closed to UNDETERMINED.
// ---------------------------------------------------------------------------

// The dedicated call's judgment schema: the three Shariah overlay fields the model supplies.
export const ShariahReasoningJudgmentSchema = z.object({
  sector_status: z.enum(['compliant', 'conditional', 'non_compliant']),
  // $M of non-permissible income; null = undetermined (NOT separately disclosed). NEVER guess 0.
  // 0 ONLY when the filing affirmatively shows zero impermissible income.
  // A false 0 produces a falsely-clean compliance verdict (fail-OPEN); null fails closed to UNDETERMINED.
  impermissible_income: z.number().min(0).nullable(),
  // GROUNDING: source_id of a VERIFIED primary source confirming the sector/segment basis (real id, not prose).
  sector_citation: z.string().min(1),
})
export type ShariahReasoning = z.infer<typeof ShariahReasoningJudgmentSchema>

// The focused agent emits the shariah_judgment + proposed_sources (so it grounds/cites its own sources).
export const ShariahReasoningAgentSchema = z.object({
  shariah_judgment: ShariahReasoningJudgmentSchema,
  proposed_sources: ProposedSourcesSchema,
})
export type ShariahReasoningAnalysis = z.infer<typeof ShariahReasoningAgentSchema>

export type RunShariahReasoningPassArgs = {
  research_case_id: string
  ticker: string
  /** The model the focused call runs on. Defaults to the synthesis/decision model. */
  model_id: string
  /** Compact lane digest so the focused call can reason from the lanes' findings. */
  laneDigest: RedTeamLaneDigest[]
  /** The verified source corpus (source_ids) the focused call must cite from. */
  corpusSourceIds: string[]
  /**
   * The harness's already-content-hash-verified primary EDGAR source_id(s) the focused call should cite
   * for the sector_citation (the SAME alignment steering the moat/circle/valuation passes use — cite the
   * id the harness reliably verifies, do NOT fetch a self-archive URL). May be empty.
   */
  preVerifiedSourceIds: string[]
}

/** Outcome of the dedicated Shariah-reasoning call. `ok` carries the shariah_judgment; `failed` means
 *  retries were exhausted (the caller leaves Shariah grounding unmet → the visible UNDETERMINED fallback). */
export type ShariahReasoningOutcome =
  | { status: 'ok'; shariah_judgment: ShariahReasoning; verified_ids: string[]; captured: CapturedSource[] }
  | { status: 'failed'; reason: string; attempts: number }

export function buildShariahReasoningPrompt(args: RunShariahReasoningPassArgs): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const corpus = args.corpusSourceIds.join(', ')
  const preVerified = args.preVerifiedSourceIds.filter((id) => id.trim().length > 0)
  const steer = preVerified.length > 0
    ? `STEER (citation alignment): for the sector_citation, cite the harness-verified `
      + `primary source_id(s) [${preVerified.join(', ')}] (e.g. sec_edgar_10k_<cik>_fy<year>) — these are already `
      + `fetched + content-verified by the harness. Do NOT fetch or cite your OWN SEC archive URL for the primary `
      + `10-K (it fetches unreliably and will FAIL the cite-check). `
    : ''
  return (
    `You are the Buffett-Munger Shariah-compliance overlay agent for ${args.ticker}. Your FOCUSED, REQUIRED job `
    + `is to produce a grounded shariah_judgment covering the sector/segment compliance verdict and the dollar `
    + `amount of impermissible income — GROUNDED on primary filings, CITED to verified sources.\n\n`
    + `Lane findings (the shared narrative to assess from):\n${laneLines}\n\n`
    + `Produce a single shariah_judgment with:\n`
    + `  - sector_status: 'compliant' | 'conditional' | 'non_compliant' — confirmed with segment revenue data, NOT `
    + `asserted from the business name alone. Conditional means the sector is permissible but has non-trivial `
    + `borderline activity.\n`
    + `  - impermissible_income: the dollar amount in $MILLIONS of non-permissible income (interest income on cash `
    + `+ prohibited-segment revenue). Set to that $M figure ONLY IF the filing discloses it or lets you quantify `
    + `it. Set to 0 ONLY when the filing AFFIRMATIVELY shows zero impermissible income. If the filing does NOT `
    + `provide a separately quantifiable impermissible-income line, set impermissible_income to null `
    + `(undetermined) — DO NOT default to 0: a false 0 produces a falsely-clean compliance verdict (the harness `
    + `then reports 0% purification / fully compliant on data you never actually found). null is an ACCEPTED, `
    + `complete answer; the harness fails closed to UNDETERMINED rather than clean.\n`
    + `  - sector_citation: REQUIRED — the source_id of a VERIFIED primary source confirming the sector/segment `
    + `basis (a real grounded source_id, NOT prose).\n\n`
    + `GROUNDING (non-negotiable): the harness deterministically cite-checks sector_citation against the grounded `
    + `corpus and FAILS CLOSED when it is absent or does not verify. Available corpus source_ids: ${corpus}. `
    + `${steer}Return your sources in proposed_sources with real URLs.\n`
    + `RATIO/PURIFICATION OWNERSHIP (the harness owns the AAOIFI ratios, not you): the harness recomputes the `
    + `AAOIFI debt/cash/impermissible ratios + verdict + purification % from the primary filings + market cap. `
    + `do NOT compute the ratios or purification yourself — your job is to supply the grounded judgment inputs `
    + `(sector_status, impermissible_income, sector_citation) so the harness can do the arithmetic correctly.\n`
    + `EXAMPLE (disclosed): {"shariah_judgment":{"sector_status":"compliant","impermissible_income":128.0,`
    + `"sector_citation":"sec_edgar_10k_<cik>_fy<year>"}}.`
    + ` EXAMPLE (not separately disclosed): {"shariah_judgment":{"sector_status":"compliant",`
    + `"impermissible_income":null,"sector_citation":"sec_edgar_10k_<cik>_fy<year>"}}.`
  )
}

/**
 * Run the dedicated Shariah-reasoning call under schema-validation + retry. The shariah_judgment (with
 * sector_citation grounded) is the sole required output, so the retry FORCES it. On success returns the
 * grounded shariah_judgment + its verified ids + captured sources; on exhaustion returns `failed` so the
 * caller leaves the Shariah grounding gate unmet (the visible UNDETERMINED fallback; the run still
 * completes). Grounding/citation verification is unchanged (delegated to runGroundedAgent inside
 * runValidatedAgent); the caller re-runs the deterministic cite-check on the result so an ungrounded
 * focused citation does NOT count.
 */
export async function runShariahReasoningPass(
  provider: Provider,
  args: RunShariahReasoningPassArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<ShariahReasoningOutcome> {
  const requiredFields: RequiredFieldCheck<ShariahReasoningAnalysis>[] = [
    {
      name: 'shariah_judgment.sector_status',
      present: (a) => ['compliant', 'conditional', 'non_compliant'].includes(a.shariah_judgment?.sector_status ?? ''),
      hint: 'the sector compliance verdict confirmed with segment revenue (compliant | conditional | non_compliant)',
    },
    {
      name: 'shariah_judgment.impermissible_income',
      // null is a valid present value (undetermined — not guessed as 0); only truly undefined/missing fails
      present: (a) => a.shariah_judgment?.impermissible_income !== undefined,
      hint: 'the dollar amount in $M of non-permissible income, or null if not separately disclosed (null is accepted)',
    },
    {
      name: 'shariah_judgment.sector_citation',
      present: (a) => (a.shariah_judgment?.sector_citation ?? '').length > 0,
      hint: 'the source_id of a VERIFIED primary source confirming the sector/segment basis (a real grounded source_id, not prose)',
    },
  ]
  try {
    const validated = await runValidatedAgent(
      provider,
      {
        run_id: `run_${args.research_case_id}_shariah_reasoning`,
        model_id: args.model_id,
        prompt: buildShariahReasoningPrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerShariahReasoning',
      },
      ShariahReasoningAgentSchema,
      {
        ...(deps.ground === undefined ? {} : { ground: deps.ground }),
        ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
        requiredFields,
      },
    )
    if (validated.status === 'ok') {
      return {
        status: 'ok',
        shariah_judgment: validated.result.analysis.shariah_judgment,
        verified_ids: validated.result.verified_ids,
        captured: validated.result.captured,
      }
    }
    return { status: 'failed', reason: validated.reason, attempts: validated.attempts }
  } catch (error) {
    // Provider/timeout error after retries — degrade visibly (the caller keeps Shariah grounding unmet).
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), attempts: 0 }
  }
}
