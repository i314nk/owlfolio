import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { InvestmentVerdict } from './researchWorkflow'
import { resolveResearchStrategyRef, type ResearchStrategyRef } from './researchStrategyRef'

export { defaultResearchStrategyRef } from './researchStrategyRef'

export type QuickScreenResult = 'pass' | 'reject' | 'needs_data' | 'deep_dive_candidate'
export type QuickScreenShariahStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING'
export type QuickScreenConfidence = 'low' | 'medium' | 'high'
export type DeepDiveConfidence = QuickScreenConfidence
export type DeepDiveSpecialistLane = string

export const buffettMungerDeepDiveLanes = [
  'business_quality',
  'moat',
  'management',
  'financial_quality',
  'shariah',
  'risks',
] as const satisfies readonly DeepDiveSpecialistLane[]

export type OwnerEarningsValuationPayload = {
  summary?: string
  normalized_owner_earnings?: string
  assumptions?: string[]
  fair_value_range?: string
  buy_price_range?: string
  margin_of_safety?: string
  sources?: string[]
  confidence?: DeepDiveConfidence
  caveats?: string[]
}

type ResearchPipelineEventStore = EventStore<LedgerEventEnvelope<unknown>>

type StrategyPipelinePayloadBase = ResearchStrategyRef & {
  research_case_id: string
  source_ids: string[]
  candidate_id?: string
  provider_run_id?: string
}

type QuickScreenDraftedPayload = StrategyPipelinePayloadBase & {
  quick_screen_id: string
  company_id: string
  ticker: string
  screening_result: QuickScreenResult
  summary: string
  business_quality: string
  moat: string
  management_capital_allocation: string
  financial_quality: string
  valuation_sanity: string
  shariah_status: QuickScreenShariahStatus
  red_flags: string[]
  confidence: QuickScreenConfidence
  caveats: string[]
}

export type QuickScreenDrafted = LedgerEventEnvelope<QuickScreenDraftedPayload> & QuickScreenDraftedPayload

export type DraftQuickScreenCommand = ResearchStrategyRef & {
  research_case_id: string
  quick_screen_id: string
  company_id: string
  ticker: string
  screening_result: QuickScreenResult
  summary: string
  business_quality: string
  moat: string
  management_capital_allocation: string
  financial_quality: string
  valuation_sanity: string
  shariah_status: QuickScreenShariahStatus
  red_flags: string[]
  confidence: QuickScreenConfidence
  caveats: string[]
  source_ids: string[]
  actor_id: string
  idempotency_key?: string
}

type DeepDiveQueuedPayload = StrategyPipelinePayloadBase & {
  queue_id: string
}

export type DeepDiveQueued = LedgerEventEnvelope<DeepDiveQueuedPayload> & DeepDiveQueuedPayload

export type QueueDeepDiveCommand = ResearchStrategyRef & {
  research_case_id: string
  queue_id: string
  candidate_id?: string
  source_ids: string[]
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

type DeepDiveStartedPayload = StrategyPipelinePayloadBase & {
  deep_dive_id: string
  specialist_lanes: DeepDiveSpecialistLane[]
}

export type DeepDiveStarted = LedgerEventEnvelope<DeepDiveStartedPayload> & DeepDiveStartedPayload

export type StartDeepDiveCommand = ResearchStrategyRef & {
  research_case_id: string
  deep_dive_id: string
  candidate_id?: string
  specialist_lanes: readonly DeepDiveSpecialistLane[]
  source_ids: string[]
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

type SpecialistFindingRecordedPayload = StrategyPipelinePayloadBase & {
  finding_id: string
  deep_dive_id: string
  specialist_lane: DeepDiveSpecialistLane
  finding_summary: string
  confidence: DeepDiveConfidence
  caveats: string[]
  owner_earnings_valuation?: OwnerEarningsValuationPayload
}

export type SpecialistFindingRecorded = LedgerEventEnvelope<SpecialistFindingRecordedPayload> & SpecialistFindingRecordedPayload

export type RecordSpecialistFindingCommand = ResearchStrategyRef & {
  research_case_id: string
  finding_id: string
  deep_dive_id: string
  candidate_id?: string
  specialist_lane: DeepDiveSpecialistLane
  finding_summary: string
  confidence: DeepDiveConfidence
  caveats: string[]
  owner_earnings_valuation?: OwnerEarningsValuationPayload
  provider_run_id?: string
  source_ids: string[]
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

type DeepDiveSynthesisDraftedPayload = StrategyPipelinePayloadBase & {
  synthesis_id: string
  deep_dive_id: string
  synthesis_summary: string
  specialist_finding_ids: string[]
  confidence: DeepDiveConfidence
  caveats: string[]
}

export type DeepDiveSynthesisDrafted = LedgerEventEnvelope<DeepDiveSynthesisDraftedPayload> & DeepDiveSynthesisDraftedPayload

export type DraftDeepDiveSynthesisCommand = ResearchStrategyRef & {
  research_case_id: string
  synthesis_id: string
  deep_dive_id: string
  candidate_id?: string
  synthesis_summary: string
  confidence: DeepDiveConfidence
  caveats: string[]
  provider_run_id?: string
  source_ids: string[]
  specialist_finding_ids: string[]
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

type DeepDiveCompletedPayload = StrategyPipelinePayloadBase & {
  completion_id: string
  deep_dive_id: string
  synthesis_id: string
  confidence: DeepDiveConfidence
  caveats: string[]
}

export type DeepDiveCompleted = LedgerEventEnvelope<DeepDiveCompletedPayload> & DeepDiveCompletedPayload

export type CompleteDeepDiveCommand = ResearchStrategyRef & {
  research_case_id: string
  completion_id: string
  deep_dive_id: string
  candidate_id?: string
  synthesis_id: string
  confidence: DeepDiveConfidence
  caveats: string[]
  provider_run_id?: string
  source_ids: string[]
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export type RunDeterministicDeepDiveSwarmCommand = ResearchStrategyRef & {
  research_case_id: string
  queue_id: string
  deep_dive_id: string
  synthesis_id: string
  completion_id: string
  candidate_id?: string
  specialist_lanes: readonly DeepDiveSpecialistLane[]
  source_ids: string[]
  causation_id: string
  actor_id: string
  provider_run_id?: string
}

export type DeterministicDeepDiveSwarmResult = {
  queued: DeepDiveQueued
  started: DeepDiveStarted
  findings: SpecialistFindingRecorded[]
  synthesis: DeepDiveSynthesisDrafted
  completed: DeepDiveCompleted
}

type StrategyDecisionDraftedPayload = StrategyPipelinePayloadBase & {
  decision_id: string
  decision: InvestmentVerdict
  decision_summary: string
}

export type StrategyDecisionDrafted = LedgerEventEnvelope<StrategyDecisionDraftedPayload> & StrategyDecisionDraftedPayload

export type DraftStrategyDecisionCommand = ResearchStrategyRef & {
  research_case_id: string
  decision_id: string
  decision: InvestmentVerdict
  decision_summary: string
  source_ids: string[]
  causation_id: string
  actor_id: string
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

function requireSourceIds(sourceIds: readonly string[]): string[] {
  const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim())
  if (normalizedSourceIds.length === 0 || normalizedSourceIds.some((sourceId) => sourceId.length === 0)) {
    throw new Error('Research pipeline events require at least one non-empty source id')
  }

  return normalizedSourceIds
}

function requireNonEmptyString(value: string, key: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error(`Research pipeline requires non-empty ${key}`)
  }

  return normalized
}

function optionalNonEmptyString(value: string | undefined, key: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireNonEmptyString(value, key)
}

function normalizeStringList(values: readonly string[], key: string): string[] {
  const normalizedValues = values.map((value) => value.trim())
  if (normalizedValues.some((value) => value.length === 0)) {
    throw new Error(`Research pipeline ${key} entries must be non-empty strings`)
  }

  return normalizedValues
}

function normalizeNonEmptyStringList(values: readonly string[], key: string): string[] {
  const normalizedValues = normalizeStringList(values, key)
  if (normalizedValues.length === 0) {
    throw new Error(`Research pipeline requires at least one ${key} entry`)
  }

  return normalizedValues
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined
  }

  return [...value]
}

async function requireMatchingResearchCaseStrategy(
  store: ResearchPipelineEventStore,
  payload: StrategyPipelinePayloadBase,
): Promise<void> {
  const researchCaseEvents = await store.listByAggregate('research_case', payload.research_case_id)
  const createdEvent = researchCaseEvents.find(
    (event) => event.event_type === 'research_case_created' && isRecord(event.payload),
  )

  if (createdEvent === undefined || !isRecord(createdEvent.payload)) {
    throw new Error(`Research pipeline event requires existing research case ${payload.research_case_id}`)
  }

  const researchCaseStrategyId = getString(createdEvent.payload, 'strategy_id')
  const researchCaseStrategyVersion = getString(createdEvent.payload, 'strategy_version')
  if (researchCaseStrategyId === undefined || researchCaseStrategyVersion === undefined) {
    throw new Error(`Research case ${payload.research_case_id} is missing its strategy identity`)
  }

  if (payload.strategy_id !== researchCaseStrategyId || payload.strategy_version !== researchCaseStrategyVersion) {
    throw new Error(
      `Research pipeline strategy ${payload.strategy_id}@${payload.strategy_version} does not match research case strategy ${researchCaseStrategyId}@${researchCaseStrategyVersion}`,
    )
  }
}

function pipelinePayloadBase(
  command: ResearchStrategyRef & {
    research_case_id: string
    source_ids: readonly string[]
    candidate_id?: string
    provider_run_id?: string
  },
): StrategyPipelinePayloadBase {
  const selectedStrategy = resolveResearchStrategyRef(command)
  const candidateId = optionalNonEmptyString(command.candidate_id, 'candidate_id')
  const providerRunId = optionalNonEmptyString(command.provider_run_id, 'provider_run_id')

  return {
    research_case_id: command.research_case_id,
    ...selectedStrategy,
    source_ids: requireSourceIds(command.source_ids),
    ...(candidateId === undefined ? {} : { candidate_id: candidateId }),
    ...(providerRunId === undefined ? {} : { provider_run_id: providerRunId }),
  }
}

async function requireDeepDiveCandidateQuickScreen(
  store: ResearchPipelineEventStore,
  command: QueueDeepDiveCommand,
): Promise<void> {
  const researchCaseEvents = await store.listByAggregate('research_case', command.research_case_id)
  const quickScreenEvent = researchCaseEvents.find(
    (event) => event.event_id === command.causation_id && event.event_type === 'quick_screen_drafted' && isRecord(event.payload),
  )

  if (quickScreenEvent === undefined || !isRecord(quickScreenEvent.payload)) {
    throw new Error(`Deep dive queue requires a causative quick-screen event for ${command.research_case_id}`)
  }

  if (getString(quickScreenEvent.payload, 'screening_result') !== 'deep_dive_candidate') {
    throw new Error('Deep dive queue requires a quick-screen deep-dive candidate')
  }
}

type PipelineEventWithPayload = LedgerEventEnvelope<Record<string, unknown>>

async function requireCausativePipelineEvent(
  store: ResearchPipelineEventStore,
  researchCaseId: string,
  causationId: string,
  eventType: string,
  errorMessage: string,
): Promise<PipelineEventWithPayload> {
  const researchCaseEvents = await store.listByAggregate('research_case', researchCaseId)
  const event = researchCaseEvents.find(
    (candidate) => candidate.event_id === causationId && candidate.event_type === eventType && isRecord(candidate.payload),
  )

  if (event === undefined || !isRecord(event.payload)) {
    throw new Error(errorMessage)
  }

  return event as PipelineEventWithPayload
}

function requireMatchingDeepDiveId(payload: Record<string, unknown>, deepDiveId: string, errorMessage: string): void {
  if (getString(payload, 'deep_dive_id') !== deepDiveId) {
    throw new Error(errorMessage)
  }
}

function requireMatchingCandidateId(
  payload: Record<string, unknown>,
  candidateId: string | undefined,
  errorMessage: string,
): void {
  const payloadCandidateId = getString(payload, 'candidate_id')
  if (payloadCandidateId !== undefined && candidateId === undefined) {
    throw new Error(errorMessage)
  }
  if (candidateId !== undefined && payloadCandidateId !== undefined && candidateId !== payloadCandidateId) {
    throw new Error(errorMessage)
  }
}

async function requireNoDeepDiveEvents(
  store: ResearchPipelineEventStore,
  researchCaseId: string,
  deepDiveId: string,
  eventTypes: readonly string[],
  errorMessage: string,
): Promise<void> {
  const eventTypeSet = new Set(eventTypes)
  const researchCaseEvents = await store.listByAggregate('research_case', researchCaseId)
  const hasLaterEvent = researchCaseEvents.some((event) => {
    if (!eventTypeSet.has(event.event_type) || !isRecord(event.payload)) {
      return false
    }

    return getString(event.payload, 'deep_dive_id') === deepDiveId
  })

  if (hasLaterEvent) {
    throw new Error(errorMessage)
  }
}

async function requireQueuedDeepDive(
  store: ResearchPipelineEventStore,
  command: StartDeepDiveCommand,
): Promise<void> {
  const queued = await requireCausativePipelineEvent(
    store,
    command.research_case_id,
    command.causation_id,
    'queued_for_deep_dive',
    'Deep dive start requires a queued deep-dive event',
  )
  requireMatchingCandidateId(queued.payload, command.candidate_id, 'Deep dive start candidate id must match the queued deep-dive event')
  await requireNoDeepDiveEvents(
    store,
    command.research_case_id,
    command.deep_dive_id,
    ['deep_dive_started', 'specialist_finding_recorded', 'deep_dive_synthesis_drafted', 'deep_dive_completed'],
    'Deep dive start cannot be appended after the deep dive has already advanced',
  )
}

async function requireStartedDeepDiveLane(
  store: ResearchPipelineEventStore,
  command: RecordSpecialistFindingCommand,
): Promise<void> {
  const started = await requireCausativePipelineEvent(
    store,
    command.research_case_id,
    command.causation_id,
    'deep_dive_started',
    'Specialist finding requires a started deep-dive event',
  )
  requireMatchingDeepDiveId(started.payload, command.deep_dive_id, 'Specialist finding requires a matching started deep-dive event')
  requireMatchingCandidateId(started.payload, command.candidate_id, 'Specialist finding candidate id must match the started deep-dive event')

  await requireNoDeepDiveEvents(
    store,
    command.research_case_id,
    command.deep_dive_id,
    ['deep_dive_synthesis_drafted', 'deep_dive_completed'],
    'Specialist finding cannot be recorded after deep-dive synthesis or completion',
  )

  const specialistLanes = getStringArray(started.payload, 'specialist_lanes') ?? []
  if (!specialistLanes.includes(command.specialist_lane.trim())) {
    throw new Error('Specialist finding requires a started specialist lane')
  }
}

async function requireRecordedSpecialistFindings(
  store: ResearchPipelineEventStore,
  command: DraftDeepDiveSynthesisCommand,
  specialistFindingIds: readonly string[],
): Promise<void> {
  const causativeFinding = await requireCausativePipelineEvent(
    store,
    command.research_case_id,
    command.causation_id,
    'specialist_finding_recorded',
    'Deep-dive synthesis requires a causative specialist finding',
  )
  requireMatchingDeepDiveId(causativeFinding.payload, command.deep_dive_id, 'Deep-dive synthesis requires a causative specialist finding')
  requireMatchingCandidateId(causativeFinding.payload, command.candidate_id, 'Deep-dive synthesis candidate id must match the causative specialist finding')
  const causativeFindingId = getString(causativeFinding.payload, 'finding_id')
  if (causativeFindingId === undefined || !specialistFindingIds.includes(causativeFindingId)) {
    throw new Error('Deep-dive synthesis requires a causative specialist finding included in the synthesis')
  }

  await requireNoDeepDiveEvents(
    store,
    command.research_case_id,
    command.deep_dive_id,
    ['deep_dive_synthesis_drafted', 'deep_dive_completed'],
    'Deep-dive synthesis cannot be drafted after synthesis or completion',
  )

  const researchCaseEvents = await store.listByAggregate('research_case', command.research_case_id)
  const matchingFindingIds = new Set(
    researchCaseEvents
      .filter((event) => event.event_type === 'specialist_finding_recorded' && isRecord(event.payload))
      .filter((event) => {
        if (!isRecord(event.payload)) {
          return false
        }
        return (
          getString(event.payload, 'deep_dive_id') === command.deep_dive_id
          && (command.candidate_id === undefined || getString(event.payload, 'candidate_id') === undefined || getString(event.payload, 'candidate_id') === command.candidate_id)
        )
      })
      .map((event) => isRecord(event.payload) ? getString(event.payload, 'finding_id') : undefined)
      .filter((findingId): findingId is string => findingId !== undefined),
  )

  if (specialistFindingIds.some((findingId) => !matchingFindingIds.has(findingId))) {
    throw new Error('Deep-dive synthesis requires recorded specialist findings for every finding id')
  }
}

async function requireMatchingDeepDiveSynthesis(
  store: ResearchPipelineEventStore,
  command: CompleteDeepDiveCommand,
): Promise<void> {
  const synthesis = await requireCausativePipelineEvent(
    store,
    command.research_case_id,
    command.causation_id,
    'deep_dive_synthesis_drafted',
    'Deep-dive completion requires a matching deep-dive synthesis',
  )
  requireMatchingDeepDiveId(synthesis.payload, command.deep_dive_id, 'Deep-dive completion requires a matching deep-dive synthesis')
  if (getString(synthesis.payload, 'synthesis_id') !== command.synthesis_id) {
    throw new Error('Deep-dive completion requires a matching deep-dive synthesis')
  }
  requireMatchingCandidateId(synthesis.payload, command.candidate_id, 'Deep-dive completion candidate id must match the deep-dive synthesis')
  await requireNoDeepDiveEvents(
    store,
    command.research_case_id,
    command.deep_dive_id,
    ['deep_dive_completed'],
    'Deep-dive completion cannot be appended after completion',
  )
}

async function appendPipelineEvent<TPayload extends StrategyPipelinePayloadBase>(
  store: ResearchPipelineEventStore,
  event: LedgerEventEnvelope<TPayload>,
): Promise<LedgerEventEnvelope<TPayload> & TPayload> {
  await requireMatchingResearchCaseStrategy(store, event.payload)
  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<TPayload>)
}

export async function draftQuickScreen(
  store: ResearchPipelineEventStore,
  command: DraftQuickScreenCommand,
): Promise<QuickScreenDrafted> {
  const payload: QuickScreenDraftedPayload = {
    ...pipelinePayloadBase(command),
    quick_screen_id: command.quick_screen_id,
    company_id: command.company_id,
    ticker: command.ticker,
    screening_result: command.screening_result,
    summary: requireNonEmptyString(command.summary, 'summary'),
    business_quality: requireNonEmptyString(command.business_quality, 'business_quality'),
    moat: requireNonEmptyString(command.moat, 'moat'),
    management_capital_allocation: requireNonEmptyString(command.management_capital_allocation, 'management_capital_allocation'),
    financial_quality: requireNonEmptyString(command.financial_quality, 'financial_quality'),
    valuation_sanity: requireNonEmptyString(command.valuation_sanity, 'valuation_sanity'),
    shariah_status: command.shariah_status,
    red_flags: normalizeStringList(command.red_flags, 'red_flags'),
    confidence: command.confidence,
    caveats: normalizeStringList(command.caveats, 'caveats'),
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_quick_screen_drafted', command.quick_screen_id),
    event_type: 'quick_screen_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    correlation_id: command.research_case_id,
    actor_type: 'provider',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function queueDeepDive(
  store: ResearchPipelineEventStore,
  command: QueueDeepDiveCommand,
): Promise<DeepDiveQueued> {
  await requireDeepDiveCandidateQuickScreen(store, command)
  const payload: DeepDiveQueuedPayload = {
    ...pipelinePayloadBase(command),
    queue_id: requireNonEmptyString(command.queue_id, 'queue_id'),
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_queued_for_deep_dive', command.queue_id),
    event_type: 'queued_for_deep_dive',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

/**
 * Finds an already-appended `deep_dive_started` event for this exact deep dive
 * (matched by research case + deterministic deep_dive_id), if any.
 */
async function findStartedDeepDive(
  store: ResearchPipelineEventStore,
  researchCaseId: string,
  deepDiveId: string,
): Promise<LedgerEventEnvelope<DeepDiveStartedPayload> | undefined> {
  const normalizedDeepDiveId = deepDiveId.trim()
  if (normalizedDeepDiveId.length === 0) {
    return undefined
  }
  const researchCaseEvents = await store.listByAggregate('research_case', researchCaseId)
  const match = researchCaseEvents.find(
    (event) =>
      event.event_type === 'deep_dive_started'
      && isRecord(event.payload)
      && getString(event.payload, 'deep_dive_id') === normalizedDeepDiveId,
  )
  return match as LedgerEventEnvelope<DeepDiveStartedPayload> | undefined
}

export async function startDeepDive(
  store: ResearchPipelineEventStore,
  command: StartDeepDiveCommand,
): Promise<DeepDiveStarted> {
  // Idempotent start: a duplicate or retry trigger for a deep dive that has
  // already started (and may have advanced to findings/synthesis) is a no-op
  // that returns the existing start event — NOT an "already advanced" rejection.
  // This keeps concurrent worker ticks / re-enqueues from failing a healthy run.
  // The advance-guard below still protects the first, genuine start.
  const existingStart = await findStartedDeepDive(store, command.research_case_id, command.deep_dive_id)
  if (existingStart !== undefined) {
    return mergeEventPayload(existingStart)
  }

  await requireQueuedDeepDive(store, command)
  const payload: DeepDiveStartedPayload = {
    ...pipelinePayloadBase(command),
    deep_dive_id: requireNonEmptyString(command.deep_dive_id, 'deep_dive_id'),
    specialist_lanes: normalizeNonEmptyStringList(command.specialist_lanes, 'specialist_lanes'),
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_deep_dive_started', command.deep_dive_id),
    event_type: 'deep_dive_started',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'worker',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function recordSpecialistFinding(
  store: ResearchPipelineEventStore,
  command: RecordSpecialistFindingCommand,
): Promise<SpecialistFindingRecorded> {
  await requireStartedDeepDiveLane(store, command)
  const payload: SpecialistFindingRecordedPayload = {
    ...pipelinePayloadBase(command),
    finding_id: requireNonEmptyString(command.finding_id, 'finding_id'),
    deep_dive_id: requireNonEmptyString(command.deep_dive_id, 'deep_dive_id'),
    specialist_lane: requireNonEmptyString(command.specialist_lane, 'specialist_lane'),
    finding_summary: requireNonEmptyString(command.finding_summary, 'finding_summary'),
    confidence: command.confidence,
    caveats: normalizeStringList(command.caveats, 'caveats'),
    ...(command.owner_earnings_valuation === undefined
      ? {}
      : { owner_earnings_valuation: command.owner_earnings_valuation }),
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_specialist_finding_recorded', command.finding_id),
    event_type: 'specialist_finding_recorded',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'provider',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function draftDeepDiveSynthesis(
  store: ResearchPipelineEventStore,
  command: DraftDeepDiveSynthesisCommand,
): Promise<DeepDiveSynthesisDrafted> {
  const payload: DeepDiveSynthesisDraftedPayload = {
    ...pipelinePayloadBase(command),
    synthesis_id: requireNonEmptyString(command.synthesis_id, 'synthesis_id'),
    deep_dive_id: requireNonEmptyString(command.deep_dive_id, 'deep_dive_id'),
    synthesis_summary: requireNonEmptyString(command.synthesis_summary, 'synthesis_summary'),
    specialist_finding_ids: normalizeNonEmptyStringList(command.specialist_finding_ids, 'specialist_finding_ids'),
    confidence: command.confidence,
    caveats: normalizeStringList(command.caveats, 'caveats'),
  }
  await requireRecordedSpecialistFindings(store, command, payload.specialist_finding_ids)

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_deep_dive_synthesis_drafted', command.synthesis_id),
    event_type: 'deep_dive_synthesis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function completeDeepDive(
  store: ResearchPipelineEventStore,
  command: CompleteDeepDiveCommand,
): Promise<DeepDiveCompleted> {
  await requireMatchingDeepDiveSynthesis(store, command)
  const payload: DeepDiveCompletedPayload = {
    ...pipelinePayloadBase(command),
    completion_id: requireNonEmptyString(command.completion_id, 'completion_id'),
    deep_dive_id: requireNonEmptyString(command.deep_dive_id, 'deep_dive_id'),
    synthesis_id: requireNonEmptyString(command.synthesis_id, 'synthesis_id'),
    confidence: command.confidence,
    caveats: normalizeStringList(command.caveats, 'caveats'),
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_deep_dive_completed', command.completion_id),
    event_type: 'deep_dive_completed',
    aggregate_type: 'research_case',
    aggregate_id: command.research_case_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

function stableIdSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export async function runDeterministicDeepDiveSwarm(
  store: ResearchPipelineEventStore,
  command: RunDeterministicDeepDiveSwarmCommand,
): Promise<DeterministicDeepDiveSwarmResult> {
  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id,
    queue_id: command.queue_id,
    ...(command.candidate_id === undefined ? {} : { candidate_id: command.candidate_id }),
    strategy_id: command.strategy_id,
    strategy_version: command.strategy_version,
    source_ids: command.source_ids,
    causation_id: command.causation_id,
    actor_id: command.actor_id,
  })
  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id,
    deep_dive_id: command.deep_dive_id,
    ...(command.candidate_id === undefined ? {} : { candidate_id: command.candidate_id }),
    strategy_id: command.strategy_id,
    strategy_version: command.strategy_version,
    specialist_lanes: command.specialist_lanes,
    source_ids: command.source_ids,
    causation_id: queued.event_id,
    actor_id: command.actor_id,
  })
  const findings: SpecialistFindingRecorded[] = []
  for (const lane of normalizeNonEmptyStringList(command.specialist_lanes, 'specialist_lanes')) {
    const finding = await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${stableIdSegment(command.deep_dive_id)}_${stableIdSegment(lane)}`,
      deep_dive_id: command.deep_dive_id,
      ...(command.candidate_id === undefined ? {} : { candidate_id: command.candidate_id }),
      specialist_lane: lane,
      strategy_id: command.strategy_id,
      strategy_version: command.strategy_version,
      finding_summary: `${lane} lane completed deterministic source review for ${command.research_case_id}.`,
      confidence: 'medium',
      caveats: ['Deterministic mock specialist finding; verify before user decision'],
      ...(command.provider_run_id === undefined ? {} : { provider_run_id: command.provider_run_id }),
      source_ids: command.source_ids,
      causation_id: started.event_id,
      actor_id: command.actor_id,
    })
    findings.push(finding)
  }
  const synthesis = await draftDeepDiveSynthesis(store, {
    research_case_id: command.research_case_id,
    synthesis_id: command.synthesis_id,
    deep_dive_id: command.deep_dive_id,
    ...(command.candidate_id === undefined ? {} : { candidate_id: command.candidate_id }),
    strategy_id: command.strategy_id,
    strategy_version: command.strategy_version,
    synthesis_summary: `Synthesized ${findings.length} deterministic specialist lanes for ${command.research_case_id}.`,
    confidence: 'medium',
    caveats: ['Deterministic mock sequential deep-dive; verify before user decision'],
    ...(command.provider_run_id === undefined ? {} : { provider_run_id: command.provider_run_id }),
    source_ids: command.source_ids,
    specialist_finding_ids: findings.map((finding) => finding.finding_id),
    causation_id: findings.at(-1)?.event_id ?? started.event_id,
    actor_id: command.actor_id,
  })
  const completed = await completeDeepDive(store, {
    research_case_id: command.research_case_id,
    completion_id: command.completion_id,
    deep_dive_id: command.deep_dive_id,
    ...(command.candidate_id === undefined ? {} : { candidate_id: command.candidate_id }),
    synthesis_id: command.synthesis_id,
    strategy_id: command.strategy_id,
    strategy_version: command.strategy_version,
    confidence: 'medium',
    caveats: ['Deterministic mock sequential deep-dive; verify before user decision'],
    ...(command.provider_run_id === undefined ? {} : { provider_run_id: command.provider_run_id }),
    source_ids: command.source_ids,
    causation_id: synthesis.event_id,
    actor_id: command.actor_id,
  })

  return { queued, started, findings, synthesis, completed }
}

export async function draftStrategyDecision(
  store: ResearchPipelineEventStore,
  command: DraftStrategyDecisionCommand,
): Promise<StrategyDecisionDrafted> {
  const payload: StrategyDecisionDraftedPayload = {
    ...pipelinePayloadBase(command),
    decision_id: command.decision_id,
    decision: command.decision,
    decision_summary: command.decision_summary,
  }

  return await appendPipelineEvent(store, {
    event_id: eventId('evt_strategy_decision_drafted', command.decision_id),
    event_type: 'strategy_decision_drafted',
    aggregate_type: 'decision',
    aggregate_id: command.decision_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}
