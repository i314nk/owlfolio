import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { Provider, ProviderRunRequest } from '@owlfolio/providers/providerContract'
import { resolveResearchStrategyRef } from './researchStrategyRef'

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
  strategy_version: string
  version: number
  supersedes_research_case_id?: string
}

export type ResearchCaseCreated = LedgerEventEnvelope<ResearchCaseCreatedPayload> & ResearchCaseCreatedPayload

export type CreateResearchCaseCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  actor_id: string
  idempotency_key?: string
  version?: number
  supersedes_research_case_id?: string
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
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
}

export type BuffettMungerAnalysisDrafted = LedgerEventEnvelope<BuffettMungerAnalysisPayload> & BuffettMungerAnalysisPayload

export type RunDemoBuffettMungerAnalysisCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  idempotency_key: string
}

/** The Arabic rendering of the six synthesis prose fields (task #88). English stays authoritative. */
export type DecisionArabicProse = {
  decision_reason: string
  thesis_summary: string
  evidence_summary: string
  valuation_rationale: string
  shariah_rationale: string
  synthesis_summary: string
}

type DecisionDraftedPayload = {
  research_case_id: string
  decision_id: string
  decision: InvestmentVerdict
  user_approved: false
  reason: string
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
  /** Arabic rendering of the prose fields, generated at analysis time when the app language is Arabic. */
  prose_ar?: DecisionArabicProse
}

export type DecisionDrafted = LedgerEventEnvelope<DecisionDraftedPayload> & DecisionDraftedPayload

type ResearchCaseArchivedPayload = {
  research_case_id: string
  archived_at: string
  reason: string
}

export type ResearchCaseArchived = LedgerEventEnvelope<ResearchCaseArchivedPayload> & ResearchCaseArchivedPayload

export type ArchiveResearchCaseCommand = {
  research_case_id: string
  reason: string
  actor_id: string
}

export type DraftDecisionCommand = {
  research_case_id: string
  decision_id: string
  decision: InvestmentVerdict
  reason: string
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
  prose_ar?: DecisionArabicProse
  causation_id: string
  idempotency_key?: string
  source_ids?: string[]
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

function buildDemoProviderRequest(command: RunDemoBuffettMungerAnalysisCommand, provider: Provider): ProviderRunRequest {
  return {
    run_id: `run_${command.research_case_id}_buffett_munger_demo`,
    provider_id: provider.provider_id,
    model_id: 'mock-research-v1',
    task_kind: 'structured-output',
    prompt: `Analyze ${command.ticker} with the Buffett-Munger policy for research case ${command.research_case_id}.`,
    timeout_ms: 1000,
    budget: { max_tool_calls: 0, max_tokens: 2000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
  }
}

export async function createResearchCase(store: ResearchEventStore, command: CreateResearchCaseCommand): Promise<ResearchCaseCreated> {
  const researchCaseEventId = eventId('evt_research_case_created', command.research_case_id)

  // Idempotent on the deterministic event id: a discovery-promoted case is created at PROMOTE time, then
  // the worker's swarm calls createResearchCase again with the SAME research_case_id when the run starts.
  // Re-appending would collide on `evt_research_case_created_${id}` (UNIQUE event_id). Return the existing
  // creation event instead. Re-runs use a fresh research_case_id, so they never hit this branch.
  const existing = (await store.list()).find((candidate) => candidate.event_id === researchCaseEventId)
  if (existing !== undefined) {
    return mergeEventPayload(existing as LedgerEventEnvelope<ResearchCaseCreatedPayload>)
  }

  const selectedStrategy = resolveResearchStrategyRef(command)
  const payload: ResearchCaseCreatedPayload = {
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    ...selectedStrategy,
    version: command.version ?? 1,
    ...(command.supersedes_research_case_id === undefined ? {} : { supersedes_research_case_id: command.supersedes_research_case_id }),
  }

  const event: LedgerEventEnvelope<ResearchCaseCreatedPayload> = {
    event_id: researchCaseEventId,
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

/**
 * Append-only ARCHIVE of a stale research run (option-b: hide-without-mutate). Appends a single
 * `research_case_archived` event so the ACTIVE research surfaces hide the case WITHOUT mutating or removing
 * any prior research event. The case STILL PROJECTS (marked `archived: true`) and its dossier still renders;
 * only the lists/active counts drop it. Idempotent via a deterministic event_id + idempotency_key —
 * re-archiving the same case is a harmless no-op (the store returns the existing event).
 */
export async function archiveResearchCase(store: ResearchEventStore, command: ArchiveResearchCaseCommand): Promise<ResearchCaseArchived> {
  const payload: ResearchCaseArchivedPayload = {
    research_case_id: command.research_case_id,
    archived_at: nowIso(),
    reason: command.reason,
  }

  const event: LedgerEventEnvelope<ResearchCaseArchivedPayload> = {
    event_id: eventId('evt_research_case_archived', command.research_case_id),
    event_type: 'research_case_archived',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    idempotency_key: `research-archived:${command.research_case_id}:v1`,
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<ResearchCaseArchivedPayload>)
}

export async function runDemoBuffettMungerAnalysis(
  store: ResearchEventStore,
  provider: Provider,
  command: RunDemoBuffettMungerAnalysisCommand,
): Promise<BuffettMungerAnalysisDrafted> {
  const completion = await provider.complete(buildDemoProviderRequest(command, provider))

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
    ...(command.thesis_summary === undefined ? {} : { thesis_summary: command.thesis_summary }),
    ...(command.evidence_summary === undefined ? {} : { evidence_summary: command.evidence_summary }),
    ...(command.valuation_rationale === undefined ? {} : { valuation_rationale: command.valuation_rationale }),
    ...(command.shariah_rationale === undefined ? {} : { shariah_rationale: command.shariah_rationale }),
    ...(command.risks === undefined ? {} : { risks: command.risks }),
    ...(command.open_questions === undefined ? {} : { open_questions: command.open_questions }),
    ...(command.prose_ar === undefined ? {} : { prose_ar: command.prose_ar }),
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
    source_ids: command.source_ids ?? [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<DecisionDraftedPayload>)
}
