import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider, ProviderRunRequest } from '@owlfolio/providers'
import { z } from 'zod'

import {
  createResearchCase,
  draftDecision,
  type BuffettMungerAnalysisDrafted,
  type CreateResearchCaseCommand,
  type DecisionDrafted,
  type InvestmentVerdict,
  type ShariahStatus,
  type StrategyCompliance,
  type ValuationStatus,
} from './researchWorkflow'
import { resolveResearchStrategyRef } from './researchStrategyRef'
import {
  buffettMungerDeepDiveLanes,
  completeDeepDive,
  draftDeepDiveSynthesis,
  draftQuickScreen,
  queueDeepDive,
  recordSpecialistFinding,
  startDeepDive,
  type DeepDiveCompleted,
  type DeepDiveQueued,
  type DeepDiveStarted,
  type DeepDiveSynthesisDrafted,
  type QuickScreenDrafted,
  type SpecialistFindingRecorded,
} from './strategyResearchPipeline'
import { ingestManualSourceBundle, type SourceLedgerBundle } from './sourceLedger'

const QuickScreenSchema = z.object({
  summary: z.string().min(1),
  business_quality: z.string().min(1),
  moat: z.string().min(1),
  management_capital_allocation: z.string().min(1),
  financial_quality: z.string().min(1),
  shariah_data_availability: z.string().min(1),
  red_flags: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  deep_dive_recommendation: z.enum(['pass', 'reject', 'needs_data', 'deep_dive_candidate']),
})

const OwnerEarningsValuationSchema = z.object({
  summary: z.string().min(1),
  normalized_owner_earnings: z.string().min(1),
  assumptions: z.array(z.string().min(1)).min(1),
  fair_value_range: z.string().min(1),
  buy_price_range: z.string().min(1),
  margin_of_safety: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
})

const ClaudeBuffettMungerResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  quick_screen: QuickScreenSchema.optional(),
  owner_earnings_valuation: OwnerEarningsValuationSchema.optional(),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  source_records: z.array(
    z.object({
      source_id: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      excerpt: z.string().min(1),
      citation_locator: z.string().optional(),
      content_hash: z.string().optional(),
    }),
  ).min(1),
})

type ResearchEventStore = EventStore<LedgerEventEnvelope<unknown>>

type QuickScreenStructured = z.infer<typeof QuickScreenSchema>
type OwnerEarningsValuationStructured = z.infer<typeof OwnerEarningsValuationSchema>

type ClaudeAnalysisPayload = {
  research_case_id: string
  company_id: string
  ticker: string
  investment_verdict: InvestmentVerdict
  strategy_compliance: StrategyCompliance
  shariah_status: Exclude<ShariahStatus, 'UNKNOWN'>
  valuation_status: ValuationStatus
  next_required_action: string
  thesis_summary: string
  evidence_summary: string
  valuation_rationale: string
  shariah_rationale: string
  quick_screen: QuickScreenStructured
  owner_earnings_valuation: OwnerEarningsValuationStructured
  risks: string[]
  open_questions: string[]
}

export type RunClaudeBuffettMungerResearchCommand = CreateResearchCaseCommand & {
  model_id: string
  source_ledger_path: string
  analysis_idempotency_key: string
  decision_id: string
  decision_idempotency_key?: string
}

export type ClaudeResearchWorkflowResult = {
  research_case: Awaited<ReturnType<typeof createResearchCase>>
  quick_screen: QuickScreenDrafted
  deep_dive: {
    queued: DeepDiveQueued
    started: DeepDiveStarted
    findings: SpecialistFindingRecorded[]
    synthesis: DeepDiveSynthesisDrafted
    completed: DeepDiveCompleted
  }
  analysis: BuffettMungerAnalysisDrafted
  decision: DecisionDrafted
  source_bundle: SourceLedgerBundle
}

function nowIso(): string {
  return new Date().toISOString()
}

function eventId(prefix: string, id: string): string {
  return `${prefix}_${id}`
}

function mergeEventPayload<TPayload extends object>(
  event: LedgerEventEnvelope<TPayload>,
): LedgerEventEnvelope<TPayload> & TPayload {
  return { ...event, ...event.payload }
}

function buildRequest(command: RunClaudeBuffettMungerResearchCommand, provider: Provider): ProviderRunRequest {
  return {
    run_id: `run_${command.research_case_id}_claude_research`,
    provider_id: provider.provider_id,
    model_id: command.model_id,
    task_kind: 'structured-output',
    prompt: [
      `You are the Buffett-Munger research specialist for Owlfolio research case ${command.research_case_id}.`,
      `Analyze ticker ${command.ticker} (${command.company_id}) under the default Buffett-Munger policy.`,
      'Quick Screen is a single-agent business-quality gate only: cover business quality, moat, management/capital allocation, financial quality, red flags, Shariah/data availability, and a deep-dive recommendation.',
      'Do not reject or pass primarily on valuation in quick screen. Main valuation belongs in the swarm deep dive.',
      'Deep Dive must include digestible lane outputs for business quality, moat, management, financial quality, Shariah, risks, and valuation, including an owner-earnings buy-price lane with assumptions, fair value or buy-price range, margin of safety, sources, confidence, and caveats.',
      'Return a useful investment brief, not status labels only: explain the business/moat thesis, source-backed evidence, valuation rationale, Shariah rationale or missing evidence, risks, and open questions.',
      'Return only the structured fields requested by the JSON schema and avoid unsupported claims.',
      'Use source_records for the concrete primary/secondary sources that support the draft; include useful titles and excerpts for audit display.',
    ].join(' '),
    timeout_ms: 120_000,
    budget: { max_tool_calls: 0, max_tokens: 8_000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema', schema_name: 'ClaudeBuffettMungerResearch' },
  }
}

const providerBackedSpecialistLanes = buffettMungerDeepDiveLanes

function stableIdSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function confidenceFor(payload: ClaudeAnalysisPayload): 'low' | 'medium' | 'high' {
  if (payload.strategy_compliance === 'INSUFFICIENT_DATA' || payload.valuation_status === 'INSUFFICIENT_DATA') {
    return 'low'
  }
  if (payload.strategy_compliance === 'COMPLIANT' && payload.valuation_status === 'ATTRACTIVE') {
    return 'high'
  }

  return 'medium'
}

function laneSummary(lane: string, payload: ClaudeAnalysisPayload): string {
  if (lane === 'business_quality') {
    return payload.quick_screen.business_quality
  }
  if (lane === 'moat') {
    return payload.quick_screen.moat
  }
  if (lane === 'management') {
    return payload.quick_screen.management_capital_allocation
  }
  if (lane === 'financial_quality') {
    return payload.quick_screen.financial_quality
  }
  if (lane === 'risks') {
    return payload.risks.join(' ')
  }
  if (lane === 'valuation') {
    return payload.owner_earnings_valuation.summary
  }
  if (lane === 'shariah') {
    return `${payload.quick_screen.shariah_data_availability} ${payload.shariah_rationale}`
  }

  return payload.evidence_summary
}

async function appendAnalysisDraft(
  store: ResearchEventStore,
  provider: Provider,
  command: RunClaudeBuffettMungerResearchCommand,
  payload: ClaudeAnalysisPayload,
  sourceIds: string[],
): Promise<BuffettMungerAnalysisDrafted> {
  const event: LedgerEventEnvelope<ClaudeAnalysisPayload> = {
    event_id: eventId('evt_buffett_munger_analysis_drafted', command.research_case_id),
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    idempotency_key: command.analysis_idempotency_key,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload,
    source_ids: sourceIds,
    created_at: nowIso(),
    schema_version: 1,
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<ClaudeAnalysisPayload>)
}

export async function runClaudeBuffettMungerResearch(
  store: ResearchEventStore,
  provider: Provider,
  command: RunClaudeBuffettMungerResearchCommand,
): Promise<ClaudeResearchWorkflowResult> {
  const researchCase = await createResearchCase(store, command)
  const request = buildRequest(command, provider)
  const structured = await provider.structured(request, ClaudeBuffettMungerResearchSchema)

  const sourceBundle = await ingestManualSourceBundle({
    source_ledger_path: command.source_ledger_path,
    research_case_id: command.research_case_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    provider_id: provider.provider_id,
    proposed_by_actor_type: 'provider',
    proposed_by_actor_id: provider.provider_id,
    ingested_by_actor_type: 'system',
    ingested_by_actor_id: 'research_workflow',
    sources: structured.source_records.map((record) => ({
      source_id: record.source_id,
      kind: 'url',
      title: record.title,
      url: record.url,
      excerpt: record.excerpt,
      ...(record.citation_locator === undefined ? {} : { citation_locator: record.citation_locator }),
      ...(record.content_hash === undefined ? {} : { content_hash: record.content_hash }),
      metadata: {
        research_case_id: command.research_case_id,
      },
    })),
  })

  const sourceIds = sourceBundle.records.map((record) => record.source_id)
  const selectedStrategy = resolveResearchStrategyRef(command)
  const fallbackConfidence = structured.strategy_compliance === 'INSUFFICIENT_DATA' || structured.valuation_status === 'INSUFFICIENT_DATA'
    ? 'low'
    : structured.strategy_compliance === 'COMPLIANT' && structured.valuation_status === 'ATTRACTIVE'
      ? 'high'
      : 'medium'
  const quickScreenStructured: QuickScreenStructured = structured.quick_screen ?? {
    summary: structured.thesis_summary,
    business_quality: structured.thesis_summary,
    moat: structured.thesis_summary,
    management_capital_allocation: `Management and capital allocation require verification before user approval for ${command.ticker}.`,
    financial_quality: structured.evidence_summary,
    shariah_data_availability: structured.shariah_rationale,
    red_flags: structured.risks,
    confidence: fallbackConfidence,
    caveats: structured.open_questions,
    deep_dive_recommendation: 'deep_dive_candidate' as const,
  }
  const ownerEarningsValuation: OwnerEarningsValuationStructured = structured.owner_earnings_valuation ?? {
    summary: structured.valuation_rationale,
    normalized_owner_earnings: 'Needs normalized owner-earnings estimate from deep-dive evidence.',
    assumptions: ['Owner-earnings assumptions were not separately structured by the provider.'],
    fair_value_range: structured.valuation_status,
    buy_price_range: 'Pending owner-earnings buy-price workstream.',
    margin_of_safety: 'Pending',
    sources: sourceIds,
    confidence: fallbackConfidence,
    caveats: structured.open_questions,
  }
  const analysisPayload: ClaudeAnalysisPayload = {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    investment_verdict: structured.investment_verdict,
    strategy_compliance: structured.strategy_compliance,
    shariah_status: structured.shariah_status,
    valuation_status: structured.valuation_status,
    next_required_action: structured.next_required_action,
    thesis_summary: structured.thesis_summary,
    evidence_summary: structured.evidence_summary,
    valuation_rationale: structured.valuation_rationale,
    shariah_rationale: structured.shariah_rationale,
    quick_screen: quickScreenStructured,
    owner_earnings_valuation: ownerEarningsValuation,
    risks: structured.risks,
    open_questions: structured.open_questions,
  }
  const quickScreen = await draftQuickScreen(store, {
    research_case_id: command.research_case_id,
    quick_screen_id: `quick_${stableIdSegment(command.research_case_id)}`,
    company_id: command.company_id,
    ticker: command.ticker,
    ...selectedStrategy,
    screening_result: quickScreenStructured.deep_dive_recommendation,
    summary: quickScreenStructured.summary,
    business_quality: quickScreenStructured.business_quality,
    moat: quickScreenStructured.moat,
    management_capital_allocation: quickScreenStructured.management_capital_allocation,
    financial_quality: quickScreenStructured.financial_quality,
    valuation_sanity: `Valuation belongs in deep dive: ${structured.valuation_rationale}`,
    shariah_status: structured.shariah_status,
    red_flags: quickScreenStructured.red_flags,
    confidence: quickScreenStructured.confidence,
    caveats: quickScreenStructured.caveats,
    source_ids: sourceIds,
    actor_id: provider.provider_id,
    idempotency_key: `quick-screen:${command.research_case_id}:${provider.provider_id}:v1`,
  })
  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: `queue_${stableIdSegment(command.research_case_id)}`,
    ...selectedStrategy,
    source_ids: sourceIds,
    causation_id: quickScreen.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })
  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: `deep_${stableIdSegment(command.research_case_id)}`,
    ...selectedStrategy,
    specialist_lanes: providerBackedSpecialistLanes,
    source_ids: sourceIds,
    causation_id: queued.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-start:${command.research_case_id}:v1`,
  })
  const findings: SpecialistFindingRecorded[] = []
  for (const lane of providerBackedSpecialistLanes) {
    const finding = await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${stableIdSegment(command.research_case_id)}_${stableIdSegment(lane)}`,
      deep_dive_id: started.deep_dive_id,
      ...selectedStrategy,
      specialist_lane: lane,
      finding_summary: laneSummary(lane, analysisPayload),
      confidence: confidenceFor(analysisPayload),
      caveats: lane === 'valuation' ? ownerEarningsValuation.caveats : structured.open_questions,
      ...(lane === 'valuation' ? { owner_earnings_valuation: ownerEarningsValuation } : {}),
      provider_run_id: request.run_id,
      source_ids: sourceIds,
      causation_id: started.event_id,
      actor_id: provider.provider_id,
      idempotency_key: `specialist-finding:${command.research_case_id}:${lane}:v1`,
    })
    findings.push(finding)
  }
  const synthesis = await draftDeepDiveSynthesis(store, {
    research_case_id: command.research_case_id,
    synthesis_id: `synthesis_${stableIdSegment(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...selectedStrategy,
    synthesis_summary: structured.decision_reason,
    confidence: confidenceFor(analysisPayload),
    caveats: structured.open_questions,
    provider_run_id: request.run_id,
    source_ids: sourceIds,
    specialist_finding_ids: findings.map((finding) => finding.finding_id),
    causation_id: findings.at(-1)?.event_id ?? started.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-synthesis:${command.research_case_id}:v1`,
  })
  const completed = await completeDeepDive(store, {
    research_case_id: command.research_case_id,
    completion_id: `complete_${stableIdSegment(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id,
    ...selectedStrategy,
    synthesis_id: synthesis.synthesis_id,
    confidence: confidenceFor(analysisPayload),
    caveats: structured.open_questions,
    provider_run_id: request.run_id,
    source_ids: sourceIds,
    causation_id: synthesis.event_id,
    actor_id: 'research_workflow',
    idempotency_key: `deep-dive-complete:${command.research_case_id}:v1`,
  })

  const analysis = await appendAnalysisDraft(
    store,
    provider,
    command,
    analysisPayload,
    sourceIds,
  )

  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: structured.investment_verdict,
    reason: structured.decision_reason,
    thesis_summary: structured.thesis_summary,
    evidence_summary: structured.evidence_summary,
    valuation_rationale: structured.valuation_rationale,
    shariah_rationale: structured.shariah_rationale,
    risks: structured.risks,
    open_questions: structured.open_questions,
    causation_id: completed.event_id,
    source_ids: sourceIds,
    ...(command.decision_idempotency_key === undefined
      ? {}
      : { idempotency_key: command.decision_idempotency_key }),
  })

  return {
    research_case: researchCase,
    quick_screen: quickScreen,
    deep_dive: { queued, started, findings, synthesis, completed },
    analysis,
    decision,
    source_bundle: sourceBundle,
  }
}
