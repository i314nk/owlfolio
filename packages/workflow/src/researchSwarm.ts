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
import { buffettMungerStrategy, discountRate, marginOfSafetyForMoat, moatPassesGate } from '@owlfolio/strategies/buffettMunger'

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
  schema_name?: string
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
      response_format: { kind: 'json-schema', schema_name: request.schema_name ?? 'GroundedAgent' },
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

const OwnerEarningsBridgeSchema = z.object({
  // All per-share, judgment-grounded by the valuation specialist.
  net_income: z.number(),
  depreciation_amortization: z.number(),
  maintenance_capex: z.number(),
  maintenance_capex_proxy_tier: z.enum(['20', '50', '80']),
  stock_based_comp: z.number(),
  // SIGNED: positive = WC is a use of cash (reduces OE); negative = structural WC release (adds to OE)
  normalized_working_capital_change: z.number(),
})

const DecisionAgentSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  // Model-supplied valuation judgment fields (harness computes fair value and buy_price from these)
  moat_class: z.enum(['narrow', 'moderate', 'wide', 'monopoly']),
  growth_assumptions: z.string().min(1),
  // Owner-earnings bridge — per-share, judgment-grounded
  owner_earnings_bridge: OwnerEarningsBridgeSchema,
  // ROIC inputs
  roic: z.number(),
  reinvestment_rate: z.number(),
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
  version?: number
  supersedes_research_case_id?: string
  /** Controls deep-dive gating.
   *  'automatic' (default): quick screen → deep dive → decision in one run.
   *  'review': quick screen → pause (deep_dive_approval_pending) → return without running deep dive.
   */
  quick_screen_approval?: 'automatic' | 'review'
}

export type RunResearchDeepDivePhaseCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  model_id: string
  decision_id: string
  source_ledger_path: string
  /** Source ids from the quick screen — used to seed queueDeepDive */
  quick_screen_source_ids: string[]
  /** event_id of the quick_screen_drafted event — used as causation_id */
  quick_screen_event_id: string
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
// Helpers for mapping shariah status
// ---------------------------------------------------------------------------

function toAnalysisShariahStatus(
  rawShariahStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING',
): 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' {
  // Map qs.analysis.shariah_status (which may be 'PENDING') to the valid analysis set
  // (COMPLIANT | CONDITIONAL | NON_COMPLIANT | UNKNOWN). PENDING -> CONDITIONAL.
  if (rawShariahStatus === 'COMPLIANT') return 'COMPLIANT'
  if (rawShariahStatus === 'NON_COMPLIANT') return 'NON_COMPLIANT'
  if (rawShariahStatus === 'CONDITIONAL') return 'CONDITIONAL'
  return 'CONDITIONAL' // PENDING maps to CONDITIONAL (data available but not yet resolved)
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
    ...(command.version === undefined ? {} : { version: command.version }),
    ...(command.supersedes_research_case_id === undefined ? {} : { supersedes_research_case_id: command.supersedes_research_case_id }),
  })

  // ---- Quick screen agent (Shariah-first gate) ----
  // The quick screen is a two-step gate:
  //   1. Shariah compliance: if NON_COMPLIANT, reject immediately — do not run the deep dive.
  //   2. Business quality: if clearly not worth investigating, reject.
  // Only 'deep_dive_candidate' cases with non-NON_COMPLIANT Shariah status proceed to the expensive deep dive.
  const qs = await runGroundedAgent(provider, {
    run_id: `run_${command.research_case_id}_quick_screen`,
    model_id: command.model_id,
    prompt: `You are the Buffett-Munger quick-screen gate agent for ${command.ticker} (${command.company_id}). `
      + `This is a two-step gate — NOT a full analysis. Keep responses brief; the deep dive handles detail.\n\n`
      + `STEP 1 — Shariah permissibility: assess whether the company's primary business is permissible under `
      + `Islamic finance principles. If the core business is clearly haram (e.g. conventional banking, alcohol, `
      + `weapons, tobacco, adult content), set shariah_status to 'NON_COMPLIANT' and screening_result to 'reject'. `
      + `If the business is clearly halal or the status is uncertain/conditional, set shariah_status accordingly `
      + `('COMPLIANT', 'CONDITIONAL', or 'PENDING') and continue to step 2.\n\n`
      + `STEP 2 (only if not NON_COMPLIANT) — Business quality worth-investigating check: is this company `
      + `worth a deep dive under Buffett-Munger criteria? If clearly inadequate (e.g. no durable business, `
      + `chronic losses, terminal industry), set screening_result to 'reject'. Otherwise set screening_result `
      + `to 'deep_dive_candidate'.\n\n`
      + `Return a brief assessment in each field. Do NOT perform per-dimension deep analysis — that is the deep dive's job. `
      + `Gather primary/secondary sources and return them in proposed_sources with real URLs.`,
    timeout_ms: AGENT_TIMEOUT_MS,
    schema_name: 'BuffettMungerQuickScreen',
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

  const analysisShariahStatus = toAnalysisShariahStatus(qs.analysis.shariah_status)

  // ---- Shariah-first gate: short-circuit if rejected at quick screen ----
  // Reject if: Shariah NON_COMPLIANT OR business quality clearly inadequate (screening_result = 'reject').
  const isRejected =
    qs.analysis.screening_result === 'reject' || qs.analysis.shariah_status === 'NON_COMPLIANT'

  if (isRejected) {
    // Determine the rejection reason for the brief thesis/evidence/rationale
    const rejectionReason = qs.analysis.shariah_status === 'NON_COMPLIANT'
      ? `Rejected at quick screen: Shariah non-compliant — ${qs.analysis.summary}`
      : `Rejected at quick screen: business quality insufficient — ${qs.analysis.summary}`

    // Strategy compliance on the analysis: NON_COMPLIANT if Shariah rejected, else INSUFFICIENT_DATA
    const strategyCompliance: 'NON_COMPLIANT' | 'INSUFFICIENT_DATA' =
      qs.analysis.shariah_status === 'NON_COMPLIANT' ? 'NON_COMPLIANT' : 'INSUFFICIENT_DATA'

    const shortCircuitAnalysisEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: quickScreen.event_id,
      actor_type: 'provider',
      actor_id: provider.provider_id,
      payload: {
        research_case_id: command.research_case_id,
        company_id: command.company_id,
        ticker: command.ticker,
        investment_verdict: 'PASS',
        strategy_compliance: strategyCompliance,
        shariah_status: analysisShariahStatus,
        valuation_status: 'INSUFFICIENT_DATA',
        next_required_action: 'No further research required; case rejected at quick screen.',
        quick_screen: {
          summary: qs.analysis.summary,
          business_quality: qs.analysis.business_quality,
          moat: qs.analysis.moat,
          management_capital_allocation: qs.analysis.management_capital_allocation,
          financial_quality: qs.analysis.financial_quality,
          valuation_sanity: qs.analysis.valuation_sanity,
          screening_result: qs.analysis.screening_result,
          confidence: qs.analysis.confidence,
        },
      },
      source_ids: qs.verified_ids,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `analysis:${command.research_case_id}:v1`,
    }
    const shortCircuitAnalysis = await store.append(shortCircuitAnalysisEvent)

    const shortCircuitDecision = await draftDecision(store, {
      research_case_id: command.research_case_id,
      decision_id: command.decision_id,
      decision: 'PASS',
      reason: rejectionReason,
      thesis_summary: rejectionReason,
      evidence_summary: rejectionReason,
      valuation_rationale: 'Not assessed — case rejected at quick screen.',
      shariah_rationale: qs.analysis.summary,
      risks: qs.analysis.red_flags,
      open_questions: qs.analysis.caveats,
      causation_id: quickScreen.event_id,
      source_ids: qs.verified_ids,
      idempotency_key: `decision:${command.research_case_id}:v1`,
    })

    // Persist source bundle for the quick-screen-only captured sources
    const capturedSoFar = [...accumulated.values()]
    if (capturedSoFar.length > 0) {
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
        sources: capturedSoFar.map((c) => ({
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
      analysis: shortCircuitAnalysis,
      decision: shortCircuitDecision,
    }
  }

  // ---- Review gate: if quick_screen_approval === 'review', pause here ----
  if ((command.quick_screen_approval ?? 'automatic') === 'review') {
    // Persist quick-screen sources before pausing
    const capturedSoFar = [...accumulated.values()]
    if (capturedSoFar.length > 0) {
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
        sources: capturedSoFar.map((c) => ({
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

    const pendingEvent: LedgerEventEnvelope<unknown> = {
      event_id: `evt_deep_dive_approval_pending_${command.research_case_id}`,
      event_type: 'deep_dive_approval_pending',
      aggregate_type: 'research_case',
      aggregate_id: command.research_case_id,
      correlation_id: command.research_case_id,
      causation_id: quickScreen.event_id,
      actor_type: 'system',
      actor_id: 'research_workflow',
      payload: {
        research_case_id: command.research_case_id,
        ticker: command.ticker,
        company_id: command.company_id,
        quick_screen_source_ids: qs.verified_ids,
        quick_screen_event_id: quickScreen.event_id,
        decision_id: command.decision_id,
        source_ledger_path: command.source_ledger_path,
        strategy_id: command.strategy_id,
        model_id: command.model_id,
      },
      source_ids: qs.verified_ids,
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `deep-dive-approval-pending:${command.research_case_id}:v1`,
    }
    await store.append(pendingEvent)

    return {
      research_case: researchCase,
      quick_screen: quickScreen,
      awaiting_deep_dive_approval: true,
    }
  }

  // ---- Automatic mode: run deep dive immediately ----
  const deepDiveResult = await runResearchDeepDivePhase(store, provider, {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    ...(command.strategy_version === undefined ? {} : { strategy_version: command.strategy_version }),
    model_id: command.model_id,
    decision_id: command.decision_id,
    source_ledger_path: command.source_ledger_path,
    quick_screen_source_ids: qs.verified_ids,
    quick_screen_event_id: quickScreen.event_id,
  }, { ...deps, accumulated })

  return {
    research_case: researchCase,
    quick_screen: quickScreen,
    ...deepDiveResult,
  }
}

// ---------------------------------------------------------------------------
// Deep-dive phase (extracted so it can be called independently)
// ---------------------------------------------------------------------------

export async function runResearchDeepDivePhase(
  store: SwarmStore,
  provider: Provider,
  command: RunResearchDeepDivePhaseCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number; accumulated?: Map<string, CapturedSource> } = {},
) {
  const strategyRef = resolveResearchStrategyRef(command)
  const accumulated = deps.accumulated ?? new Map<string, CapturedSource>()
  const remember = (captured: CapturedSource[]) => captured.forEach((c) => accumulated.set(c.source_id, c))

  const lanes = buffettMungerDeepDiveLanes

  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: `queue_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    source_ids: command.quick_screen_source_ids,
    causation_id: command.quick_screen_event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })

  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: `deep_${swarmSeg(command.research_case_id)}`,
    ...strategyRef,
    specialist_lanes: lanes,
    source_ids: command.quick_screen_source_ids,
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
      schema_name: 'BuffettMungerLaneFinding',
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
    schema_name: 'BuffettMungerSynthesisDecision',
  }, DecisionAgentSchema, deps)
  remember(dec.captured)

  const allVerified = [
    ...new Set([
      ...command.quick_screen_source_ids,
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

  // ---- Harness-computed valuation (Design B: equity-bond capitalization with ROIC-gated growth) ----
  // OE = NI + D&A - maint_capex - SBC - dNWC  (dNWC is signed: positive=use of cash reduces OE)
  // g = (ROIC > discount) ? min(reinvestment_rate * ROIC, terminal_growth_cap) : 0
  // fair_value = min(OE / (discount - g), valuation_multiple_ceiling * OE)
  // buy_price = round(fair_value * (1 - MoS), 2)  where MoS = marginOfSafetyForMoat(strategy, moat)
  const moatClass = dec.analysis.moat_class
  const moat_passes_gate = moatPassesGate(buffettMungerStrategy, moatClass)

  const bridge = dec.analysis.owner_earnings_bridge
  const normalized_owner_earnings_per_share =
    bridge.net_income
    + bridge.depreciation_amortization
    - bridge.maintenance_capex
    - bridge.stock_based_comp
    - bridge.normalized_working_capital_change  // signed: subtract (positive = use of cash, negative = release)

  const discount = discountRate(buffettMungerStrategy)
  const roic = dec.analysis.roic
  const reinvestment_rate = dec.analysis.reinvestment_rate
  const terminal_growth_cap = buffettMungerStrategy.valuation.terminal_growth_cap
  const valuation_multiple_ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling

  let buy_price_per_share: number | undefined
  let fair_value_per_share: number | undefined
  let effective_growth_rate: number
  let margin_of_safety: number | undefined

  // Compute g: credit growth only when ROIC > discount rate
  if (roic > discount) {
    effective_growth_rate = Math.min(reinvestment_rate * roic, terminal_growth_cap)
  } else {
    effective_growth_rate = 0
  }

  if (moat_passes_gate) {
    // Equity-bond capitalization: OE / (discount - g), floored at discount > g (guaranteed since g <= 3% < 10%)
    const capitalizedValue = normalized_owner_earnings_per_share / (discount - effective_growth_rate)
    const ceilingValue = valuation_multiple_ceiling * normalized_owner_earnings_per_share
    fair_value_per_share = Math.min(capitalizedValue, ceilingValue)
    margin_of_safety = marginOfSafetyForMoat(buffettMungerStrategy, moatClass)
    buy_price_per_share = Math.round(fair_value_per_share * (1 - margin_of_safety) * 100) / 100
  }

  // Apply moat gate: if moat is below wide, override verdict to PASS regardless of model output
  const gatedVerdict = moat_passes_gate
    ? dec.analysis.investment_verdict
    : 'PASS' as const
  const gatedReason = moat_passes_gate
    ? dec.analysis.decision_reason
    : `Moat below the wide-moat gate (${moatClass}) — pass.`

  // ---- Emit buffett_munger_analysis_drafted ----
  const analysisEvent: LedgerEventEnvelope<unknown> = {
    event_id: `evt_buffett_munger_analysis_drafted_${command.research_case_id}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    causation_id: completed.event_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload: {
      research_case_id: command.research_case_id,
      company_id: command.company_id,
      ticker: command.ticker,
      investment_verdict: gatedVerdict,
      strategy_compliance: dec.analysis.strategy_compliance,
      shariah_status: undefined, // will be set below
      valuation_status: dec.analysis.valuation_status,
      next_required_action: moat_passes_gate ? dec.analysis.next_required_action : gatedReason,
      quick_screen: undefined, // populated below
      valuation: {
        moat_class: moatClass,
        moat_passes_gate,
        discount_rate: discount,
        growth_assumptions: dec.analysis.growth_assumptions,
        growth_rate: effective_growth_rate,
        roic,
        reinvestment_rate,
        owner_earnings_bridge: bridge,
        normalized_owner_earnings_per_share,
        ...(fair_value_per_share !== undefined ? { fair_value_per_share } : {}),
        ...(margin_of_safety !== undefined ? { margin_of_safety } : {}),
        ...(buy_price_per_share !== undefined ? { buy_price_per_share } : {}),
        value_basis: 'equity_bond',
      },
    },
    source_ids: allVerified,
    created_at: new Date().toISOString(),
    schema_version: 1,
    idempotency_key: `analysis:${command.research_case_id}:v1`,
  }

  // Resolve shariah status from ledger (quick screen event stored there)
  // We need to recover the quick-screen analysis — re-read from ledger or use an in-memory flag.
  // Since this function can be called independently, we re-read the quick-screen event.
  const qsEventFromStore = (await store.list()).find(
    (e) => e.event_id === command.quick_screen_event_id,
  )
  const qsPayload = qsEventFromStore?.payload as Record<string, unknown> | undefined
  const rawShariahStatus = qsPayload?.['shariah_status'] as 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING' | undefined
  const analysisShariahStatusForPhase: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' =
    rawShariahStatus === 'COMPLIANT' ? 'COMPLIANT'
    : rawShariahStatus === 'NON_COMPLIANT' ? 'NON_COMPLIANT'
    : rawShariahStatus === 'CONDITIONAL' ? 'CONDITIONAL'
    : 'CONDITIONAL'

  const analysisFinalPayload = {
    ...(analysisEvent.payload as Record<string, unknown>),
    shariah_status: analysisShariahStatusForPhase,
    quick_screen: {
      summary: String(qsPayload?.['summary'] ?? ''),
      business_quality: String(qsPayload?.['business_quality'] ?? ''),
      moat: String(qsPayload?.['moat'] ?? ''),
      management_capital_allocation: String(qsPayload?.['management_capital_allocation'] ?? ''),
      financial_quality: String(qsPayload?.['financial_quality'] ?? ''),
      valuation_sanity: String(qsPayload?.['valuation_sanity'] ?? ''),
      screening_result: String(qsPayload?.['screening_result'] ?? ''),
      confidence: String(qsPayload?.['confidence'] ?? ''),
    },
  }

  const analysis = await store.append({ ...analysisEvent, payload: analysisFinalPayload })

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: gatedVerdict,
    reason: gatedReason,
    thesis_summary: dec.analysis.thesis_summary,
    evidence_summary: dec.analysis.evidence_summary,
    valuation_rationale: moat_passes_gate ? dec.analysis.valuation_rationale : `Moat gate rejected: ${moatClass} is below the minimum investable moat (wide). No buy price computed.`,
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
    deep_dive: { queued, started, findings, synthesis, completed },
    analysis,
    decision,
  }
}
