import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { runGroundedAgentWithRetry, ProposedSourcesSchema, SynthesisResponseSchema, type SynthesisResponse, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import { runValidatedAgent, type RequiredFieldCheck } from './runValidatedAgent'
import type { GroundingDeps } from './sourceGrounding'

// ---------------------------------------------------------------------------
// judgment-objectivity-layer-spec Mechanism 5 — Red-Team Pass (pre-Synthesis, mandatory)
//
// After the 7 deep-dive lanes complete and BEFORE synthesis, one adversarial grounded agent run
// whose ONLY mandate is to break the case. It receives a compact digest of all lane findings (incl.
// the resolved rubric tiers) + the verified source corpus, and must cite the SAME corpus (it is the
// consensus-knowing lane — like RISKS it may use ALL source categories). Synthesis then MUST answer
// its strongest objection with evidence OR accept and downgrade — "silence is not an option" (the
// deterministic enforcement lives in the orchestrator).
// ---------------------------------------------------------------------------

const WeakRubricItemSchema = z.object({
  lane: z.string().min(1),
  item: z.string().min(1),
  why: z.string().min(1),
})

const StrongestObjectionSchema = z.object({
  claim: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  // source_ids the objection rests on — must be in the verified corpus (cite-checked by the harness).
  citations: z.array(z.string().min(1)).min(1),
})

export const RedTeamAgentSchema = z.object({
  strongest_bear_case: z.string().min(1),
  weakest_rubric_items: z.array(WeakRubricItemSchema).default([]),
  moat_decay_scenario: z.string().min(1),
  growth_credit_attack: z.string().min(1),
  shared_narrative_blindspots: z.array(z.string().min(1)).default([]),
  strongest_objection: StrongestObjectionSchema,
  proposed_sources: ProposedSourcesSchema,
})

export type RedTeamAnalysis = z.infer<typeof RedTeamAgentSchema>

/** The red-team output the harness persists + hands to synthesis. */
export type RedTeamOutput = {
  status: 'complete'
  strongest_bear_case: string
  weakest_rubric_items: { lane: string; item: string; why: string }[]
  moat_decay_scenario: string
  growth_credit_attack: string
  shared_narrative_blindspots: string[]
  strongest_objection: {
    claim: string
    severity: 'low' | 'medium' | 'high'
    // Only the citations that verified against the corpus (cite-checked); never fabricated.
    citations: string[]
  }
  /** source_ids cited by the objection that were NOT in the verified corpus (recorded, never hidden). */
  uncited_objection_refs?: string[]
}

/** Degraded red-team state when the adversarial run times out / fails — the run continues. */
export type RedTeamIncomplete = {
  status: 'red_team_incomplete'
  reason: string
}

export type RedTeamResult = RedTeamOutput | RedTeamIncomplete

// Default 180s — bounds a stalled `codex exec` call (which can hang for the full per-call timeout)
// so the retry recovers instead of compounding into a multi-hour swarm hang. Override with
// OWLFOLIO_AGENT_TIMEOUT_MS. Single source of truth lives in researchSwarmSchemas.

/**
 * Compact digest of one lane finding for the red-team prompt. The red team attacks the SHARED
 * narrative, so it sees each lane's summary + confidence + the resolved moat/runway tiers.
 */
export type RedTeamLaneDigest = {
  lane: string
  finding_summary: string
  confidence: string
}

export type RunRedTeamPassArgs = {
  research_case_id: string
  ticker: string
  /** The model the red team runs on. Defaults to the lanes' model. */
  model_id: string
  laneDigest: RedTeamLaneDigest[]
  /** Resolved tiers + key valuation inputs the red team must attack. */
  caseDigest: {
    moat_class: string
    runway: string
    credited_growth_rate?: number
    incremental_roic?: number
  }
  /** The verified source corpus (source_ids) the red team must cite from. */
  corpusSourceIds: string[]
  /** Hashes/source_ids verified against the fetched corpus — used to cite-check the objection. */
  verifiedCitationHashes: ReadonlySet<string>
}

function buildRedTeamPrompt(args: RunRedTeamPassArgs): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const cg = args.caseDigest.credited_growth_rate
  const ir = args.caseDigest.incremental_roic
  const corpus = args.corpusSourceIds.join(', ')
  return (
    `You are the Buffett-Munger RED-TEAM agent for ${args.ticker}. Your ONLY job is to BREAK this case. `
    + `Do not balance, hedge, or restate the bull thesis — find the strongest reason this is a mistake.\n\n`
    + `The 7 deep-dive lanes concluded (shared narrative below). The harness resolved moat=${args.caseDigest.moat_class}, `
    + `runway=${args.caseDigest.runway}${cg !== undefined ? `, credited growth g=${(cg * 100).toFixed(1)}%` : ''}`
    + `${ir !== undefined ? `, incremental ROIC=${(ir * 100).toFixed(0)}%` : ''}.\n\n`
    + `Lane findings:\n${laneLines}\n\n`
    + `Produce: (1) the strongest BEAR case; (2) the weakest-evidenced rubric items (lane + item + why); `
    + `(3) the moat-decay scenario (how the moat erodes over 5-10 yrs); (4) the growth-credit attack (why the `
    + `credited growth / incremental-ROIC is unjustified or mean-reverts); (5) shared-narrative blind spots the `
    + `lanes all missed because they reasoned from the same documents; and (6) a SINGLE strongest_objection with a `
    + `severity and citations.\n\n`
    + `GROUNDING (non-negotiable): you may cite ANY source category (you are the consensus-knowing lane), but every `
    + `objection must be GROUNDED — strongest_objection.citations and proposed_sources must reference the verified `
    + `corpus. Available corpus source_ids: ${corpus}. Cite from these and return them in proposed_sources with real URLs. `
    + `An objection with no verifiable citation will be dropped — do not fabricate.`
  )
}

/**
 * Cite-check the strongest objection against the verified corpus: keep only citations present in the
 * verified hash set (source_id or content_hash). An objection whose citations are ALL unverified is a
 * fabricated objection — we still record the bear case but null out the strongest_objection's
 * unverifiable refs so synthesis never has to answer a fabricated claim.
 */
function citeCheckObjection(
  objection: RedTeamAnalysis['strongest_objection'],
  verified: ReadonlySet<string>,
): { citations: string[]; uncited: string[] } {
  const citations: string[] = []
  const uncited: string[] = []
  for (const c of objection.citations) {
    if (verified.has(c)) citations.push(c)
    else uncited.push(c)
  }
  return { citations, uncited }
}

/**
 * Run the adversarial red-team pass. Wrapped in {@link runGroundedAgentWithRetry} + try/catch so a
 * timeout/failure DEGRADES to `red_team_incomplete` (the run continues; synthesis notes it) rather
 * than aborting. The output is grounded + cite-checked exactly like the other lanes.
 *
 * TODO(model-tiering-spec): `args.model_id` defaults to the lanes' model today. When the model
 * registry exists, run the red team on a DIFFERENT model than the lanes (catches shared-narrative
 * error that single-model cross-checks cannot) — a one-line swap of the model_id passed in here.
 */
export async function runRedTeamPass(
  provider: Provider,
  args: RunRedTeamPassArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<RedTeamResult> {
  try {
    const agent = await runGroundedAgentWithRetry(
      provider,
      {
        run_id: `run_${args.research_case_id}_red_team`,
        model_id: args.model_id,
        prompt: buildRedTeamPrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerRedTeam',
      },
      RedTeamAgentSchema,
      deps,
    )
    const { citations, uncited } = citeCheckObjection(agent.analysis.strongest_objection, args.verifiedCitationHashes)
    return {
      status: 'complete',
      strongest_bear_case: agent.analysis.strongest_bear_case,
      weakest_rubric_items: agent.analysis.weakest_rubric_items,
      moat_decay_scenario: agent.analysis.moat_decay_scenario,
      growth_credit_attack: agent.analysis.growth_credit_attack,
      shared_narrative_blindspots: agent.analysis.shared_narrative_blindspots,
      strongest_objection: {
        claim: agent.analysis.strongest_objection.claim,
        severity: agent.analysis.strongest_objection.severity,
        citations,
      },
      ...(uncited.length > 0 ? { uncited_objection_refs: uncited } : {}),
    }
  } catch (error) {
    // Degrade, never abort: the red team is mandatory but its FAILURE must not discard a completed
    // 7-lane deep dive. Synthesis proceeds and the dossier records that the red team did not complete.
    return {
      status: 'red_team_incomplete',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

// ---------------------------------------------------------------------------
// Dedicated red-team-RESPONSE call (the focused decomposition — same pattern that got the moat rubric
// emitting live). Rather than asking the monolithic synthesis schema to ALSO carry synthesis_response
// (which a live model kept dropping — synthesis_schema_retry_exhausted), we run a tiny FOCUSED grounded
// call whose ONLY output is the synthesis_response to the red team's strongest objection. It runs ONLY
// when a live (cite-checked) objection exists; it is grounded so it can cite the corpus, and runs under
// runValidatedAgent (the retry FORCES the response). When it still fails after its attempts, the caller
// leaves synthesisResponse undefined → the existing deterministic red_team_objection_unaddressed
// enforcement fires (visible fallback, run completes).
// ---------------------------------------------------------------------------

// The dedicated call's schema = the synthesis_response ALONE (+ proposed_sources so it grounds/cites).
export const RedTeamResponseSchema = z.object({
  synthesis_response: SynthesisResponseSchema,
  proposed_sources: ProposedSourcesSchema,
})
export type RedTeamResponseAnalysis = z.infer<typeof RedTeamResponseSchema>

export type RunRedTeamResponsePassArgs = {
  research_case_id: string
  ticker: string
  /** The model the red-team-response runs on. Defaults to the synthesis model. */
  model_id: string
  /** The live, cite-checked strongest objection the response must answer. */
  strongestObjection: { claim: string; severity: string; citations: string[] }
  /** Compact lane digest so the response can reason from the lanes' findings. */
  laneDigest: RedTeamLaneDigest[]
  /** The verified source corpus (source_ids) the response must cite from. */
  corpusSourceIds: string[]
}

/** Outcome of the dedicated red-team-response call. `ok` carries the synthesis_response; `failed` means
 *  retries were exhausted (the caller falls back to the visible red_team_objection_unaddressed flag). */
export type RedTeamResponseOutcome =
  | { status: 'ok'; synthesis_response: SynthesisResponse; verified_ids: string[]; captured: import('./sourceGrounding').CapturedSource[] }
  | { status: 'failed'; reason: string; attempts: number }

function buildRedTeamResponsePrompt(args: RunRedTeamResponsePassArgs): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const corpus = args.corpusSourceIds.join(', ')
  return (
    `You are the Buffett-Munger synthesis agent answering the RED TEAM for ${args.ticker}. `
    + `The adversarial red-team pass produced a single STRONGEST OBJECTION (severity ${args.strongestObjection.severity}): `
    + `"${args.strongestObjection.claim}" [cited: ${args.strongestObjection.citations.join(', ') || 'no verified citation'}].\n\n`
    + `Lane findings (the shared narrative the objection attacks):\n${laneLines}\n\n`
    + `Produce a single synthesis_response that EITHER:\n`
    + `  - mode 'answered_with_evidence': rebut the objection with a CITED claim from the verified corpus, OR\n`
    + `  - mode 'accepted_downgraded': accept the objection and downgrade, supplying downgrade{dimension(tier|growth|verdict),from,to}.\n`
    + `Silence is not an option. GROUNDING (non-negotiable): cite the verified corpus — proposed_sources MUST reference it. `
    + `Available corpus source_ids: ${corpus}. Return them in proposed_sources with real URLs.\n`
    + `EXAMPLE (shape only): {"synthesis_response":{"mode":"accepted_downgraded","text":"FY25 capex ≫ D&A confirms a reinvestment treadmill","downgrade":{"dimension":"tier","from":"wide","to":"moderate"}}}.`
  )
}

/**
 * Run the dedicated red-team-RESPONSE call under schema-validation + retry. The synthesis_response is the
 * sole required field, so the retry FORCES it. On success returns the cited response; on exhaustion
 * returns `failed` so the caller surfaces the visible red_team_objection_unaddressed fallback (the run
 * still completes). Grounding/citation verification is unchanged (delegated to runGroundedAgent).
 */
export async function runRedTeamResponsePass(
  provider: Provider,
  args: RunRedTeamResponsePassArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<RedTeamResponseOutcome> {
  const requiredFields: RequiredFieldCheck<RedTeamResponseAnalysis>[] = [
    {
      name: 'synthesis_response',
      present: (a) => a.synthesis_response !== undefined && a.synthesis_response.text.trim().length > 0,
      hint: "answer the red-team objection with evidence (mode 'answered_with_evidence') OR accept+downgrade (mode 'accepted_downgraded')",
    },
  ]
  try {
    const validated = await runValidatedAgent(
      provider,
      {
        run_id: `run_${args.research_case_id}_red_team_response`,
        model_id: args.model_id,
        prompt: buildRedTeamResponsePrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerRedTeamResponse',
      },
      RedTeamResponseSchema,
      {
        ...(deps.ground === undefined ? {} : { ground: deps.ground }),
        ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
        requiredFields,
      },
    )
    if (validated.status === 'ok') {
      return {
        status: 'ok',
        synthesis_response: validated.result.analysis.synthesis_response,
        verified_ids: validated.result.verified_ids,
        captured: validated.result.captured,
      }
    }
    return { status: 'failed', reason: validated.reason, attempts: validated.attempts }
  } catch (error) {
    // Provider/timeout error after retries — degrade visibly (the caller flags red_team_objection_unaddressed).
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error), attempts: 0 }
  }
}

// ---------------------------------------------------------------------------
// Synthesis obligation enforcement (the "silence is not an option" teeth)
// ---------------------------------------------------------------------------

// SynthesisResponseSchema + SynthesisResponse are defined in researchSwarm.ts (it references them in
// DecisionAgentSchema at module-eval). They are re-exported here so the red-team module's public API
// stays cohesive without re-creating a circular module-eval dependency.
export { SynthesisResponseSchema, type SynthesisResponse }

/** The red-team layer the harness attaches to the analysis payload + projects to the dossier. */
export type RedTeamLayer = {
  status: 'complete' | 'red_team_incomplete'
  reason?: string
  strongest_bear_case?: string
  weakest_rubric_items?: { lane: string; item: string; why: string }[]
  moat_decay_scenario?: string
  growth_credit_attack?: string
  shared_narrative_blindspots?: string[]
  strongest_objection?: {
    claim: string
    severity: string
    citations: string[]
  }
  uncited_objection_refs?: string[]
  synthesis_response?: SynthesisResponse
  /**
   * Deterministic enforcement (Mechanism 5, "silence is not an option"): set when the red team
   * completed with a strongest_objection but synthesis provided NO usable response. The harness
   * surfaces it + appends to open_questions — an unaddressed strong objection is never dropped.
   */
  objection_unaddressed?: boolean
}

/**
 * Build the red-team layer for the analysis payload + decide whether the strongest objection went
 * unaddressed (deterministic). Rules:
 *   - If the red team is incomplete, there is no objection to address — record the degraded state.
 *   - If the red team produced a strongest_objection that survived cite-check (>=1 citation), the
 *     synthesis MUST supply a non-empty synthesis_response. If it does not, flag
 *     `objection_unaddressed` (the caller appends it to open_questions).
 *   - A `mode==='accepted_downgraded'` response carries the downgrade (recorded in the rationale).
 */
export function buildRedTeamLayer(args: {
  redTeam: RedTeamResult
  synthesisResponse?: SynthesisResponse | undefined
}): { layer: RedTeamLayer; openQuestion?: string } {
  const { redTeam, synthesisResponse } = args

  if (redTeam.status === 'red_team_incomplete') {
    return {
      layer: { status: 'red_team_incomplete', reason: redTeam.reason },
      openQuestion: `red_team_incomplete: the adversarial red-team pass did not complete (${redTeam.reason}). `
        + `The case was NOT adversarially tested — re-run before relying on the verdict.`,
    }
  }

  // An objection is "live" (requires a synthesis response) only if it survived cite-check.
  const objectionLive = redTeam.strongest_objection.citations.length > 0
  const responseUsable =
    synthesisResponse !== undefined && synthesisResponse.text.trim().length > 0

  const layer: RedTeamLayer = {
    status: 'complete',
    strongest_bear_case: redTeam.strongest_bear_case,
    weakest_rubric_items: redTeam.weakest_rubric_items,
    moat_decay_scenario: redTeam.moat_decay_scenario,
    growth_credit_attack: redTeam.growth_credit_attack,
    shared_narrative_blindspots: redTeam.shared_narrative_blindspots,
    strongest_objection: redTeam.strongest_objection,
    ...(redTeam.uncited_objection_refs !== undefined ? { uncited_objection_refs: redTeam.uncited_objection_refs } : {}),
    ...(responseUsable ? { synthesis_response: synthesisResponse } : {}),
  }

  if (objectionLive && !responseUsable) {
    layer.objection_unaddressed = true
    return {
      layer,
      openQuestion: `red_team_objection_unaddressed: the red team's strongest objection ("${redTeam.strongest_objection.claim}") `
        + `was not answered with evidence nor accepted with a downgrade. Silence is not an option — address it before relying on the verdict.`,
    }
  }

  return { layer }
}
