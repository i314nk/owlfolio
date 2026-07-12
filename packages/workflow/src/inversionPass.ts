import { z } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { runGroundedAgentWithRetry, ProposedSourcesSchema, type GroundFn } from './groundedAgent'
import { AGENT_TIMEOUT_MS } from './researchSwarmSchemas'
import { isCitationGrounded, type GroundingDeps } from './sourceGrounding'
import { buffettMungerDeepDiveLanes } from './strategyResearchPipeline'

// ---------------------------------------------------------------------------
// E1 (owner call, 2026-07-12): the INVERSION PASS — the Munger lattice's own adversarial input.
// This REPLACES the two-call red team (adversarial finder + answer-or-downgrade response pass): one
// focused grounded call, pre-synthesis, whose ONLY mandate is to argue the case AGAINST itself
// (Munger: "invert, always invert") and to state the consensus view (the lattice's social-proof
// artifact). Its cite-checked output feeds the Munger lattice directly and is injected into the
// synthesis prompt so the verdict must weigh the strongest case against — but there is NO
// answer-or-downgrade obligation machinery; the lattice records the inversion, the human audits it.
// Failure DEGRADES to `inversion_incomplete` (the run continues; the lattice entry says so).
// ---------------------------------------------------------------------------

const StrongestObjectionSchema = z.object({
  claim: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  // source_ids the objection rests on — must be in the verified corpus (cite-checked by the harness).
  citations: z.array(z.string().min(1)).min(1),
})

// Social proof: the inversion agent is the consensus-knowing call, so the thesis-vs-consensus check
// rides it (zero extra provider spend). Cite-checked like the objection; an ungrounded consensus
// read carries no lattice weight. Optional at the schema level; the prompt demands it.
const ConsensusCheckSchema = z.object({
  // What the market/street consensus on this name actually is.
  consensus_view: z.string().min(1),
  // Is THIS case's thesis just the consensus, or a variant view?
  thesis_vs_consensus: z.enum(['consensus', 'variant']),
  // REQUIRED when 'variant': what the thesis knows/weighs that the consensus does not.
  variant_justification: z.string().optional(),
  citations: z.array(z.string().min(1)).default([]),
})

export const InversionAgentSchema = z.object({
  strongest_case_against: z.string().min(1),
  moat_decay_scenario: z.string().min(1),
  growth_credit_attack: z.string().min(1),
  shared_narrative_blindspots: z.array(z.string().min(1)).default([]),
  strongest_objection: StrongestObjectionSchema,
  consensus_check: ConsensusCheckSchema.optional(),
  proposed_sources: ProposedSourcesSchema,
})

export type InversionAnalysis = z.infer<typeof InversionAgentSchema>

/** The inversion output the harness persists + hands to the lattice and the synthesis prompt. */
export type InversionOutput = {
  status: 'complete'
  strongest_case_against: string
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
  /** The cite-checked thesis-vs-consensus read (the Munger-lattice social-proof artifact). */
  consensus_check?: {
    consensus_view: string
    thesis_vs_consensus: 'consensus' | 'variant'
    variant_justification?: string | undefined
    citations: string[]
    grounded: boolean
  }
}

/** Degraded state when the inversion pass times out / fails — the run continues. */
export type InversionIncomplete = {
  status: 'inversion_incomplete'
  reason: string
}

export type InversionResult = InversionOutput | InversionIncomplete

/**
 * Compact digest of one lane finding for the inversion prompt. The inversion attacks the SHARED
 * narrative, so it sees each lane's summary + confidence + the resolved moat tier.
 */
export type InversionLaneDigest = {
  lane: string
  finding_summary: string
  confidence: string
}

export type RunInversionPassArgs = {
  research_case_id: string
  ticker: string
  /** The model the inversion runs on. Defaults to the lanes' model. */
  model_id: string
  laneDigest: InversionLaneDigest[]
  /** Resolved tiers + key valuation inputs the inversion must attack. */
  caseDigest: {
    moat_class: string
    credited_growth_rate?: number
    incremental_roic?: number
  }
  /** The verified source corpus (source_ids) the inversion must cite from. */
  corpusSourceIds: string[]
  /** Hashes/source_ids verified against the fetched corpus — used to cite-check the objection. */
  verifiedCitationHashes: ReadonlySet<string>
}

function buildInversionPrompt(args: RunInversionPassArgs): string {
  const laneLines = args.laneDigest
    .map((l) => `  - ${l.lane} (${l.confidence}): ${l.finding_summary}`)
    .join('\n')
  const cg = args.caseDigest.credited_growth_rate
  const ir = args.caseDigest.incremental_roic
  const corpus = args.corpusSourceIds.join(', ')
  return (
    `You are the Munger INVERSION agent for ${args.ticker} — "invert, always invert". Your ONLY job is to `
    + `argue this case AGAINST itself. Do not balance, hedge, or restate the bull thesis — find the strongest `
    + `reason this is a mistake.\n\n`
    + `The ${buffettMungerDeepDiveLanes.length} deep-dive lanes concluded (shared narrative below). The harness resolved moat=${args.caseDigest.moat_class}`
    + `${cg !== undefined ? `, credited growth g=${(cg * 100).toFixed(1)}%` : ''}`
    + `${ir !== undefined ? `, incremental ROIC=${(ir * 100).toFixed(0)}%` : ''}.\n\n`
    + `Lane findings:\n${laneLines}\n\n`
    + `Produce: (1) the strongest CASE AGAINST (strongest_case_against); (2) the moat-decay scenario (how the `
    + `moat erodes over 5-10 yrs); (3) the growth-credit attack (why the credited growth / incremental-ROIC is `
    + `unjustified or mean-reverts); (4) shared-narrative blind spots the lanes all missed because they reasoned `
    + `from the same documents; (5) a SINGLE strongest_objection with a severity and citations; and (6) `
    + `consensus_check — the SOCIAL-PROOF test: state the actual market/street consensus on this name `
    + `(consensus_view), judge whether THIS case's thesis is just that consensus or a variant view `
    + `(thesis_vs_consensus), and — if variant — what the thesis weighs that the consensus does not `
    + `(variant_justification). Cite the consensus read (citations); an uncited consensus check carries no weight.\n\n`
    + `GROUNDING (non-negotiable): you may cite ANY source category (you are the consensus-knowing call), but every `
    + `objection must be GROUNDED — strongest_objection.citations and proposed_sources must reference the verified `
    + `corpus. Available corpus source_ids: ${corpus}. Cite from these and return them in proposed_sources with real URLs. `
    + `An objection with no verifiable citation will be dropped — do not fabricate.`
  )
}

/**
 * Cite-check the strongest objection against the verified corpus: keep only citations present in the
 * verified hash set (source_id or content_hash). An objection whose citations are ALL unverified is a
 * fabricated objection — we still record the case-against narrative but null out the objection's
 * unverifiable refs so the lattice never presents a fabricated claim as grounded.
 */
function citeCheckObjection(
  objection: InversionAnalysis['strongest_objection'],
  verified: ReadonlySet<string>,
): { citations: string[]; uncited: string[] } {
  const citations: string[] = []
  const uncited: string[] = []
  for (const c of objection.citations) {
    if (isCitationGrounded(c, verified)) citations.push(c)
    else uncited.push(c)
  }
  return { citations, uncited }
}

/**
 * Run the inversion pass. Wrapped in {@link runGroundedAgentWithRetry} + try/catch so a
 * timeout/failure DEGRADES to `inversion_incomplete` (the run continues; the lattice entry says so)
 * rather than aborting. The output is grounded + cite-checked exactly like the other lanes.
 */
export async function runInversionPass(
  provider: Provider,
  args: RunInversionPassArgs,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<InversionResult> {
  try {
    const agent = await runGroundedAgentWithRetry(
      provider,
      {
        run_id: `run_${args.research_case_id}_inversion`,
        model_id: args.model_id,
        prompt: buildInversionPrompt(args),
        timeout_ms: AGENT_TIMEOUT_MS,
        schema_name: 'BuffettMungerInversion',
      },
      InversionAgentSchema,
      deps,
    )
    const { citations, uncited } = citeCheckObjection(agent.analysis.strongest_objection, args.verifiedCitationHashes)
    return {
      status: 'complete',
      strongest_case_against: agent.analysis.strongest_case_against,
      moat_decay_scenario: agent.analysis.moat_decay_scenario,
      growth_credit_attack: agent.analysis.growth_credit_attack,
      shared_narrative_blindspots: agent.analysis.shared_narrative_blindspots,
      strongest_objection: {
        claim: agent.analysis.strongest_objection.claim,
        severity: agent.analysis.strongest_objection.severity,
        citations,
      },
      ...(uncited.length > 0 ? { uncited_objection_refs: uncited } : {}),
      // Cite-check the consensus read with the same primitive; grounded = >=1 verified citation.
      ...(agent.analysis.consensus_check === undefined
        ? {}
        : (() => {
            const cc = agent.analysis.consensus_check
            const verified = cc.citations.filter((c) => isCitationGrounded(c, args.verifiedCitationHashes))
            return {
              consensus_check: {
                consensus_view: cc.consensus_view,
                thesis_vs_consensus: cc.thesis_vs_consensus,
                ...(cc.variant_justification !== undefined ? { variant_justification: cc.variant_justification } : {}),
                citations: verified,
                grounded: verified.length > 0,
              },
            }
          })()),
    }
  } catch (error) {
    // Degrade, never abort: an inversion failure must not discard a completed deep dive. Synthesis
    // proceeds and the lattice records that the case was NOT argued against itself.
    return {
      status: 'inversion_incomplete',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The persisted inversion layer for the analysis payload (the lattice's evidence). No obligation
 * machinery: the inversion IS the record — synthesis sees the objection in its prompt; the lattice
 * marks inversion `applied` when a cite-checked objection exists, `unavailable` otherwise. An
 * incomplete pass appends ONE honesty open-question (visibility, not enforcement).
 */
export type InversionLayer = {
  status: 'complete' | 'inversion_incomplete'
  reason?: string
  strongest_case_against?: string
  moat_decay_scenario?: string
  growth_credit_attack?: string
  shared_narrative_blindspots?: string[]
  strongest_objection?: {
    claim: string
    severity: string
    citations: string[]
  }
  uncited_objection_refs?: string[]
  consensus_check?: {
    consensus_view: string
    thesis_vs_consensus: 'consensus' | 'variant'
    variant_justification?: string | undefined
    citations: string[]
    grounded: boolean
  }
}

export function buildInversionLayer(args: { inversion: InversionResult }): { layer: InversionLayer; openQuestion?: string } {
  const { inversion } = args
  if (inversion.status === 'inversion_incomplete') {
    return {
      layer: { status: 'inversion_incomplete', reason: inversion.reason },
      openQuestion: `inversion_incomplete: the inversion pass did not complete (${inversion.reason}). `
        + `The case was NOT argued against itself — re-run before relying on the verdict.`,
    }
  }
  return {
    layer: {
      status: 'complete',
      strongest_case_against: inversion.strongest_case_against,
      moat_decay_scenario: inversion.moat_decay_scenario,
      growth_credit_attack: inversion.growth_credit_attack,
      shared_narrative_blindspots: inversion.shared_narrative_blindspots,
      strongest_objection: inversion.strongest_objection,
      ...(inversion.uncited_objection_refs !== undefined ? { uncited_objection_refs: inversion.uncited_objection_refs } : {}),
      ...(inversion.consensus_check !== undefined ? { consensus_check: inversion.consensus_check } : {}),
    },
  }
}
