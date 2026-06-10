import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { runGroundedAgentWithRetry, ProposedSourcesSchema, SynthesisResponseSchema, type SynthesisResponse, type GroundFn } from './groundedAgent'
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

const AGENT_TIMEOUT_MS = 180_000

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
