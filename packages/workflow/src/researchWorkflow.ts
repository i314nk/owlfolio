import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider } from '@owlfolio/providers/providerContract'

export type InvestmentVerdict = 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
export type StrategyCompliance = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'INSUFFICIENT_DATA'
export type ShariahStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN'
export type ValuationStatus = 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'

type ResearchEventStore = EventStore<LedgerEventEnvelope<unknown>>

type ResearchCaseCreatedPayload = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
}

export type ResearchCaseCreated = LedgerEventEnvelope<ResearchCaseCreatedPayload> & ResearchCaseCreatedPayload

export type CreateResearchCaseCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  actor_id: string
  idempotency_key?: string
}

type BuffettMungerAnalysisPayload = {
  research_case_id: string
  company_id: string
  ticker: string
  investment_verdict: InvestmentVerdict
  strategy_compliance: StrategyCompliance
  shariah_status: ShariahStatus
  valuation_status: ValuationStatus
  next_required_action: string
}

export type BuffettMungerAnalysisDrafted = LedgerEventEnvelope<BuffettMungerAnalysisPayload> & BuffettMungerAnalysisPayload

export type RunDemoBuffettMungerAnalysisCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  idempotency_key: string
}

type DecisionDraftedPayload = {
  research_case_id: string
  decision_id: string
  decision: InvestmentVerdict
  user_approved: false
  reason: string
}

export type DecisionDrafted = LedgerEventEnvelope<DecisionDraftedPayload> & DecisionDraftedPayload

export type DraftDecisionCommand = {
  research_case_id: string
  decision_id: string
  decision: InvestmentVerdict
  reason: string
  causation_id: string
  idempotency_key?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireEnum<T extends string>(payload: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = payload[key]
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T
  }

  throw new Error(`Provider returned invalid ${key}`)
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  throw new Error(`Provider returned invalid ${key}`)
}

function sourceIdsFrom(payload: Record<string, unknown>): string[] {
  const value = payload.source_ids
  if (!Array.isArray(value) || value.some((sourceId) => typeof sourceId !== 'string')) {
    throw new Error('Provider returned invalid source_ids')
  }

  return value
}

export async function createResearchCase(store: ResearchEventStore, command: CreateResearchCaseCommand): Promise<ResearchCaseCreated> {
  const payload: ResearchCaseCreatedPayload = {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
  }

  const event: LedgerEventEnvelope<ResearchCaseCreatedPayload> = {
    event_id: eventId('evt_research_case_created', command.research_case_id),
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<ResearchCaseCreatedPayload>)
}

export async function runDemoBuffettMungerAnalysis(
  store: ResearchEventStore,
  provider: Provider,
  command: RunDemoBuffettMungerAnalysisCommand,
): Promise<BuffettMungerAnalysisDrafted> {
  const completion = await provider.complete({
    run_id: `run_${command.research_case_id}_buffett_munger_demo`,
    model_id: 'mock-research-v1',
    prompt: `Analyze ${command.ticker} with the Buffett-Munger policy for research case ${command.research_case_id}.`,
    timeout_ms: 1000,
    budget: { max_tool_calls: 0, max_tokens: 2000 },
    tool_allowlist: [],
  })

  const parsed: unknown = JSON.parse(completion.text)
  if (!isRecord(parsed)) {
    throw new Error('Provider returned invalid analysis payload')
  }

  const payload: BuffettMungerAnalysisPayload = {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    investment_verdict: requireEnum(parsed, 'investment_verdict', ['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE'] as const),
    strategy_compliance: requireEnum(parsed, 'strategy_compliance', ['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA'] as const),
    shariah_status: requireEnum(parsed, 'shariah_status', ['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN'] as const),
    valuation_status: requireEnum(parsed, 'valuation_status', ['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA'] as const),
    next_required_action: requireString(parsed, 'next_required_action'),
  }

  const event: LedgerEventEnvelope<BuffettMungerAnalysisPayload> = {
    event_id: eventId('evt_buffett_munger_analysis_drafted', command.research_case_id),
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    idempotency_key: command.idempotency_key,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload,
    source_ids: sourceIdsFrom(parsed),
    created_at: nowIso(),
    schema_version: 1,
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<BuffettMungerAnalysisPayload>)
}

export async function draftDecision(store: ResearchEventStore, command: DraftDecisionCommand): Promise<DecisionDrafted> {
  const payload: DecisionDraftedPayload = {
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    decision: command.decision,
    user_approved: false,
    reason: command.reason,
  }

  const event: LedgerEventEnvelope<DecisionDraftedPayload> = {
    event_id: eventId('evt_decision_drafted', command.decision_id),
    event_type: 'decision_drafted',
    aggregate_type: 'decision',
    aggregate_id: command.decision_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<DecisionDraftedPayload>)
}
