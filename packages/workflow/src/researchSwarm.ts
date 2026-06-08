import { z, type ZodType } from 'zod'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider } from '@owlfolio/providers'
import { groundProposedSources, type CapturedSource, type GroundingDeps, type ProposedSource } from './sourceGrounding'
import { createResearchCase, draftDecision } from './researchWorkflow'
import {
  buffettMungerDeepDiveLanes,
  draftQuickScreen,
  queueDeepDive,
  startDeepDive,
  recordSpecialistFinding,
  draftDeepDiveSynthesis,
  completeDeepDive,
} from './strategyResearchPipeline'
import { ingestManualSourceBundle } from './sourceLedger'
import { resolveResearchStrategyRef } from './researchStrategyRef'

export const ProposedSourceSchema = z.object({
  source_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  excerpt: z.string().min(1),
  citation_locator: z.string().optional(),
})
export const ProposedSourcesSchema = z.array(ProposedSourceSchema).min(1)

export type GroundFn = (
  sources: z.infer<typeof ProposedSourcesSchema>,
  deps?: GroundingDeps,
) => Promise<{
  captured: CapturedSource[]
  verified_ids: string[]
}>

export type GroundedAgentRequest = {
  run_id: string
  model_id: string
  prompt: string
  timeout_ms: number
}

export type GroundedAgentResult<T> = {
  analysis: T & { proposed_sources: z.infer<typeof ProposedSourcesSchema> }
  captured: CapturedSource[]
  verified_ids: string[]
}

export async function runGroundedAgent<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<GroundedAgentResult<T>> {
  const ground = deps.ground ?? groundProposedSources
  const analysis = await provider.structured(
    {
      run_id: request.run_id,
      model_id: request.model_id,
      task_kind: 'structured-output',
      prompt: request.prompt,
      timeout_ms: request.timeout_ms,
      budget: { max_tool_calls: 0, max_tokens: 8_000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: 'GroundedAgent' },
    },
    schema,
  )
  // Cast: Zod infers `citation_locator?: string | undefined` but ProposedSource uses
  // exactOptionalPropertyTypes (`citation_locator?: string`). The runtime shapes are
  // identical — absent vs. explicitly undefined is only a type distinction.
  const { captured, verified_ids } = await ground(
    analysis.proposed_sources as ProposedSource[],
    deps.grounding,
  )
  return { analysis, captured, verified_ids }
}

export type LaneOutcome = {
  lane: string
  finding_summary: string
  confidence: 'low' | 'medium' | 'high'
  caveats: string[]
  verified_ids: string[]
}

export type LaneSwarmResult = LaneOutcome & { status: 'complete' | 'incomplete' }

export async function runLaneSwarm(
  lanes: readonly string[],
  runLane: (lane: string) => Promise<LaneOutcome>,
  opts: { concurrency?: number } = {},
): Promise<LaneSwarmResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const results: LaneSwarmResult[] = new Array(lanes.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < lanes.length) {
      const index = cursor++
      const lane = lanes[index]
      if (lane === undefined) continue
      try {
        results[index] = { ...(await runLane(lane)), status: 'complete' }
      } catch (error) {
        results[index] = {
          lane,
          finding_summary: `${lane} lane did not complete: ${(error as Error).message}. Verify before any user decision.`,
          confidence: 'low',
          caveats: ['Lane incomplete — not investment-grade; re-run before relying on it.'],
          verified_ids: [],
          status: 'incomplete',
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, lanes.length) }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Swarm orchestrator type aliases
// ---------------------------------------------------------------------------

type SwarmStore = EventStore<LedgerEventEnvelope<unknown>>

// ---------------------------------------------------------------------------
// Per-stage Zod schemas (each includes proposed_sources for grounding)
// ---------------------------------------------------------------------------

const QuickScreenAgentSchema = z.object({
  summary: z.string().min(1),
  business_quality: z.string().min(1),
  moat: z.string().min(1),
  management_capital_allocation: z.string().min(1),
  financial_quality: z.string().min(1),
  valuation_sanity: z.string().min(1),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'PENDING']),
  red_flags: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  screening_result: z.enum(['pass', 'reject', 'needs_data', 'deep_dive_candidate']),
  proposed_sources: ProposedSourcesSchema,
})

const LaneAgentSchema = z.object({
  finding_summary: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

const DecisionAgentSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

// ---------------------------------------------------------------------------
// Command type
// ---------------------------------------------------------------------------

export type RunStrategyResearchSwarmCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  actor_id: string
  idempotency_key?: string
  model_id: string
  decision_id: string
  source_ledger_path: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function swarmSeg(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runStrategyResearchSwarm(
  store: SwarmStore,
  provider: Provider,
  command: RunStrategyResearchSwarmCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number } = {},
) {
  const strategyRef = resolveResearchStrategyRef(command)
  const accumulated = new Map<string, CapturedSource>()
  const remember = (captured: CapturedSource[]) => captured.forEach((c) => accumulated.set(c.source_id, c))

  // ---- Create research case ----
  const researchCase = await createResearchCase(store, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    ...(command.strategy_version === undefined ? {} : { strategy_version: command.strategy_version }),
    actor_id: command.actor_id,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })

  // ---- Quick screen agent ----
  const qs = await runGroundedAgent(provider, {
    run_id: `run_${command.research_case_id}_quick_screen`,
    model_id: command.model_id,
    prompt: `You are the Buffett-Munger quick-screen agent for ${command.ticker} (${command.company_id}). `
      + `Assess business quality, moat, management/capital allocation, financial quality, Shariah/data availability, red flags, and a deep-dive recommendation. `
      + `Gather your own primary/secondary sources and return them in proposed_sources with real URLs.`,
    timeout_ms: AGENT_TIMEOUT_MS,
  }, QuickScreenAgentSchema, deps)
  remember(qs.captured)

  // I1: fail-closed if quick screen produced no verifiable sources
  if (qs.verified_ids.length === 0) {
    throw new Error(`Quick screen for ${command.ticker} produced no verifiable sources (fail-closed).`)
  }

  const quickScreen = await draftQuickScreen(store, {
    research_case_id: command.research_case_id,
    quick_screen_id: `quick_${swarmSeg(command.research_case_id)}`,
    company_id: command.company_id,
    ticker: command.ticker,
    ...strategyRef,
    screening_result: qs.analysis.screening_result,
    summary: qs.analysis.summary,
    business_quality: qs.analysis.business_quality,
    moat: qs.analysis.moat,
    management_capital_allocation: qs.analysis.management_capital_allocation,
    financial_quality: qs.analysis.financial_quality,
    valuation_sanity: qs.analysis.valuation_sanity,
    shariah_status: qs.analysis.shariah_status,
    red_flags: qs.analysis.red_flags,
    confidence: qs.analysis.confidence,
    caveats: qs.analysis.caveats,
    source_ids: qs.verified_ids,
    actor_id: provider.provider_id,
    idempotency_key: `quick-screen:${command.research_case_id}:v1`,
  })

  // ---- Queue and start deep dive ----
  const lanes = buffettMungerDeepDiveLanes

  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: `queue_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    source_ids: qs.verified_ids,
    causation_id: quickScreen.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })

  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: `deep_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    specialist_lanes: lanes,
    source_ids: qs.verified_ids,
    causation_id: queued.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-start:${command.research_case_id}:v1`,
  })

  // ---- Per-lane swarm ----
  const laneResults = await runLaneSwarm(lanes, async (lane) => {
    const agent = await runGroundedAgent(provider, {
      run_id: `run_${command.research_case_id}_${swarmSeg(lane)}`,
      model_id: command.model_id,
      prompt: `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
        + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs.`,
      timeout_ms: AGENT_TIMEOUT_MS,
    }, LaneAgentSchema, deps)
    remember(agent.captured)
    return {
      lane,
      finding_summary: agent.analysis.finding_summary,
      confidence: agent.analysis.confidence,
      caveats: agent.analysis.caveats,
      verified_ids: agent.verified_ids,
    }
  }, { concurrency: deps.laneConcurrency ?? 4 })

  // ---- Record specialist findings ----
  // C1: only record findings for lanes with at least one verified source id;
  // lanes with zero verified ids (incomplete or all-sources-unverified) are
  // skipped and noted so incompleteness surfaces in synthesis caveats.
  const findings: Awaited<ReturnType<typeof recordSpecialistFinding>>[] = []
  const laneNotes: string[] = []
  for (const lane of laneResults) {
    if (lane.verified_ids.length === 0) {
      const reason = lane.status === 'incomplete' ? 'incomplete' : 'no verifiable sources'
      laneNotes.push(`${lane.lane}: skipped (${reason})`)
      continue
    }
    findings.push(await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${swarmSeg(command.research_case_id)}_${swarmSeg(lane.lane)}`,
      deep_dive_id: started.deep_dive_id,
      ...strategyRef,
      specialist_lane: lane.lane,
      finding_summary: lane.finding_summary,
      confidence: lane.confidence,
      caveats: lane.status === 'incomplete' ? [...lane.caveats, 'status:incomplete'] : lane.caveats,
      source_ids: lane.verified_ids,
      causation_id: started.event_id,
      actor_id: provider.provider_id,
      idempotency_key: `specialist-finding:${command.research_case_id}:${lane.lane}:v1`,
    }))
  }

  // C1 edge case: if NO lane produced a recorded finding, abort before synthesis
  if (findings.length === 0) {
    throw new Error(`No specialist lane produced a verifiable source for ${command.ticker}; research aborted (fail-closed).`)
  }

  // ---- Synthesis + decision agent ----
  const dec = await runGroundedAgent(provider, {
    run_id: `run_${command.research_case_id}_synthesis`,
    model_id: command.model_id,
    prompt: `You are the Buffett-Munger synthesis+decision agent for ${command.ticker}. `
      + `Using the lane findings, produce a verdict, thesis, evidence, valuation rationale, Shariah rationale, risks, open questions, and a synthesis summary. `
      + `Cite sources in proposed_sources with real URLs.`,
    timeout_ms: AGENT_TIMEOUT_MS,
  }, DecisionAgentSchema, deps)
  remember(dec.captured)

  const allVerified = [
    ...new Set([
      ...qs.verified_ids,
      ...findings.flatMap((f) => f.source_ids),
      ...dec.verified_ids,
    ]),
  ]

  // I1: fail-closed if synthesis has no verifiable sources
  if (allVerified.length === 0) {
    throw new Error(`Synthesis for ${command.ticker} has no verifiable sources (fail-closed).`)
  }

  // I3: derive synthesis confidence from lane outcomes
  const synthesisConfidence = (laneNotes.length > 0 || findings.some((f) => f.confidence === 'low')) ? 'low' : 'medium'

  // I3: append lane notes to caveats so incompleteness is not silently dropped
  const synthesisCaveats = laneNotes.length > 0
    ? [...dec.analysis.open_questions, ...laneNotes]
    : dec.analysis.open_questions

  const synthesis = await draftDeepDiveSynthesis(store, {
    research_case_id: command.research_case_id,
    synthesis_id: `synthesis_${swarmSeg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...strategyRef,
    synthesis_summary: dec.analysis.synthesis_summary,
    confidence: synthesisConfidence,
    caveats: synthesisCaveats,
    source_ids: allVerified,
    specialist_finding_ids: findings.map((f) => f.finding_id),
    causation_id: findings.at(-1)?.event_id ?? started.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-synthesis:${command.research_case_id}:v1`,
  })

  const completed = await completeDeepDive(store, {
    research_case_id: command.research_case_id,
    completion_id: `complete_${swarmSeg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...strategyRef,
    synthesis_id: synthesis.synthesis_id,
    confidence: synthesisConfidence,
    caveats: synthesisCaveats,
    source_ids: allVerified,
    causation_id: synthesis.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-complete:${command.research_case_id}:v1`,
  })

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: dec.analysis.investment_verdict,
    reason: dec.analysis.decision_reason,
    thesis_summary: dec.analysis.thesis_summary,
    evidence_summary: dec.analysis.evidence_summary,
    valuation_rationale: dec.analysis.valuation_rationale,
    shariah_rationale: dec.analysis.shariah_rationale,
    risks: dec.analysis.risks,
    open_questions: dec.analysis.open_questions,
    causation_id: completed.event_id,
    source_ids: allVerified,
    idempotency_key: `decision:${command.research_case_id}:v1`,
  })

  // ---- Persist source bundle ----
  const captured = [...accumulated.values()]
  if (captured.length > 0) {
    await ingestManualSourceBundle({
      source_ledger_path: command.source_ledger_path,
      research_case_id: command.research_case_id,
      ticker: command.ticker,
      strategy_id: command.strategy_id,
      provider_id: provider.provider_id,
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: provider.provider_id,
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      sources: captured.map((c) => ({
        source_id: c.source_id,
        kind: 'url' as const,
        title: c.title,
        url: c.url,
        excerpt: c.excerpt,
        availability: c.availability,
        ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
        metadata: {
          research_case_id: command.research_case_id,
          ...(c.http_status === undefined ? {} : { http_status: c.http_status }),
        },
      })),
    })
  }

  return {
    research_case: researchCase,
    quick_screen: quickScreen,
    deep_dive: { queued, started, findings, synthesis, completed },
    decision,
  }
}
