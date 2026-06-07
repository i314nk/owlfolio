import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectDiscoveryCandidates, type DiscoveryCandidateProjection } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { createResearchCase } from './researchWorkflow'
import { resolveResearchStrategyRef, type ResearchStrategyRef } from './researchStrategyRef'

type DiscoveryCandidateEventStore = EventStore<LedgerEventEnvelope<unknown>>

type DuplicateTargetType = 'discovery_candidate' | 'research_case' | 'watchlist_item' | 'holding'

type DuplicateTarget = {
  duplicate_target_type: DuplicateTargetType
  duplicate_target_id: string
}

type DiscoveryCandidateBasePayload = ResearchStrategyRef & {
  candidate_id: string
  ticker: string
  company_name: string
  market: string
  discovery_source: string
  source_ids: string[]
  discovered_at: string
  dedupe_key: string
}

type DiscoveryCandidateDiscoveredPayload = DiscoveryCandidateBasePayload & {
  status: 'discovered' | 'duplicate'
  duplicate_target_type?: DuplicateTargetType
  duplicate_target_id?: string
}

type DiscoveryCandidateQueuedPayload = DiscoveryCandidateBasePayload & {
  status: 'queued_for_quick_screen'
  queue_id: string
}

type DiscoveryCandidateRejectedPayload = DiscoveryCandidateBasePayload & {
  status: 'rejected'
  reason: string
}

type DiscoveryCandidatePromotedPayload = DiscoveryCandidateBasePayload & {
  status: 'promoted_to_research_case'
  research_case_id: string
  research_case_event_id: string
}

export type DiscoveryCandidateDiscovered = LedgerEventEnvelope<DiscoveryCandidateDiscoveredPayload> & DiscoveryCandidateDiscoveredPayload
export type DiscoveryCandidateQueued = LedgerEventEnvelope<DiscoveryCandidateQueuedPayload> & DiscoveryCandidateQueuedPayload
export type DiscoveryCandidateRejected = LedgerEventEnvelope<DiscoveryCandidateRejectedPayload> & DiscoveryCandidateRejectedPayload
export type DiscoveryCandidatePromoted = LedgerEventEnvelope<DiscoveryCandidatePromotedPayload> & DiscoveryCandidatePromotedPayload

export type DiscoverCandidateCommand = {
  candidate_id: string
  ticker: string
  company_name: string
  market: string
  strategy_id: string
  strategy_version?: string
  discovery_source: string
  source_ids: string[]
  discovered_at?: string
  actor_id: string
  idempotency_key?: string
}

export type QueueDiscoveryCandidateForQuickScreenCommand = {
  candidate_id: string
  queue_id: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export type RejectDiscoveryCandidateCommand = {
  candidate_id: string
  reason: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export type PromoteDiscoveryCandidateToResearchCaseCommand = {
  candidate_id: string
  research_case_id: string
  company_id?: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
  research_case_idempotency_key?: string
}

export type MockDiscoveryCandidateInput = {
  candidate_id: string
  ticker: string
  company_name: string
  market: string
}

export type RunMockStrategyDiscoveryCommand = ResearchStrategyRef & {
  discovery_source: string
  source_ids: string[]
  discovered_at?: string
  actor_id: string
  candidates: MockDiscoveryCandidateInput[]
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

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error(`Discovery candidate ${fieldName} is required`)
  }

  return normalized
}

function normalizeTicker(ticker: string): string {
  return normalizeRequiredString(ticker, 'ticker').toUpperCase()
}

function normalizeMarket(market: string): string {
  return normalizeRequiredString(market, 'market').toUpperCase()
}

function requireSourceIds(sourceIds: string[]): string[] {
  const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim())
  if (normalizedSourceIds.length === 0 || normalizedSourceIds.some((sourceId) => sourceId.length === 0)) {
    throw new Error('Discovery candidate events require at least one non-empty source id')
  }

  return normalizedSourceIds
}

function buildDedupeKey(strategy: ResearchStrategyRef, market: string, ticker: string): string {
  return `${strategy.strategy_id}@${strategy.strategy_version}:${market}:${ticker}`
}

function basePayloadFromCommand(command: DiscoverCandidateCommand): DiscoveryCandidateBasePayload {
  const selectedStrategy = resolveResearchStrategyRef(command)
  const ticker = normalizeTicker(command.ticker)
  const market = normalizeMarket(command.market)

  return {
    candidate_id: normalizeRequiredString(command.candidate_id, 'candidate id'),
    ticker,
    company_name: normalizeRequiredString(command.company_name, 'company name'),
    market,
    ...selectedStrategy,
    discovery_source: normalizeRequiredString(command.discovery_source, 'discovery source'),
    source_ids: requireSourceIds(command.source_ids),
    discovered_at: command.discovered_at ?? nowIso(),
    dedupe_key: buildDedupeKey(selectedStrategy, market, ticker),
  }
}

function basePayloadFromProjection(candidate: DiscoveryCandidateProjection): DiscoveryCandidateBasePayload {
  return {
    candidate_id: candidate.candidate_id,
    ticker: candidate.ticker,
    company_name: candidate.company_name,
    market: candidate.market,
    strategy_id: candidate.strategy_id,
    strategy_version: candidate.strategy_version,
    discovery_source: candidate.discovery_source,
    source_ids: [...candidate.source_ids],
    discovered_at: candidate.discovered_at,
    dedupe_key: candidate.dedupe_key,
  }
}

function sameStrategy(strategy: ResearchStrategyRef, candidate: { strategy_id?: string; strategy_version?: string }): boolean {
  return candidate.strategy_id === strategy.strategy_id && candidate.strategy_version === strategy.strategy_version
}

function sameTicker(ticker: string, candidate: { ticker?: string }): boolean {
  return candidate.ticker?.toUpperCase() === ticker
}

function findDuplicateTarget(events: LedgerEventEnvelope<unknown>[], payload: DiscoveryCandidateBasePayload): DuplicateTarget | undefined {
  const existingCandidates = projectDiscoveryCandidates(events).find(
    (candidate) => candidate.dedupe_key === payload.dedupe_key && candidate.candidate_id !== payload.candidate_id,
  )
  if (existingCandidates !== undefined) {
    return { duplicate_target_type: 'discovery_candidate', duplicate_target_id: existingCandidates.candidate_id }
  }

  const strategy = { strategy_id: payload.strategy_id, strategy_version: payload.strategy_version }
  const holding = projectHoldings(events).find((candidate) => sameTicker(payload.ticker, candidate) && sameStrategy(strategy, candidate))
  if (holding !== undefined) {
    return { duplicate_target_type: 'holding', duplicate_target_id: holding.holding_id }
  }

  const watchlistItem = projectWatchlist(events).find((candidate) => sameTicker(payload.ticker, candidate) && sameStrategy(strategy, candidate))
  if (watchlistItem !== undefined) {
    return { duplicate_target_type: 'watchlist_item', duplicate_target_id: watchlistItem.watchlist_item_id }
  }

  const researchCase = projectResearchCases(events).find((candidate) => sameTicker(payload.ticker, candidate) && sameStrategy(strategy, candidate))
  if (researchCase !== undefined) {
    return { duplicate_target_type: 'research_case', duplicate_target_id: researchCase.research_case_id }
  }

  return undefined
}

async function currentCandidate(store: DiscoveryCandidateEventStore, candidateId: string): Promise<DiscoveryCandidateProjection> {
  const candidate = projectDiscoveryCandidates(await store.list()).find((entry) => entry.candidate_id === candidateId)
  if (candidate === undefined) {
    throw new Error(`Unknown discovery candidate: ${candidateId}`)
  }

  return candidate
}

async function appendDiscoveryEvent<TPayload extends DiscoveryCandidateBasePayload>(
  store: DiscoveryCandidateEventStore,
  event: LedgerEventEnvelope<TPayload>,
): Promise<LedgerEventEnvelope<TPayload> & TPayload> {
  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<TPayload>)
}

export async function discoverCandidate(
  store: DiscoveryCandidateEventStore,
  command: DiscoverCandidateCommand,
): Promise<DiscoveryCandidateDiscovered> {
  const basePayload = basePayloadFromCommand(command)
  const duplicateTarget = findDuplicateTarget(await store.list(), basePayload)
  const payload: DiscoveryCandidateDiscoveredPayload = {
    ...basePayload,
    status: duplicateTarget === undefined ? 'discovered' : 'duplicate',
    ...(duplicateTarget ?? {}),
  }

  return await appendDiscoveryEvent(store, {
    event_id: eventId('evt_discovery_candidate_discovered', payload.candidate_id),
    event_type: 'discovery_candidate_discovered',
    aggregate_type: 'discovery_candidate',
    aggregate_id: payload.candidate_id,
    correlation_id: payload.candidate_id,
    actor_type: 'provider',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: payload.discovered_at,
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function queueDiscoveryCandidateForQuickScreen(
  store: DiscoveryCandidateEventStore,
  command: QueueDiscoveryCandidateForQuickScreenCommand,
): Promise<DiscoveryCandidateQueued> {
  const candidate = await currentCandidate(store, command.candidate_id)
  if (candidate.status !== 'discovered') {
    throw new Error(`Discovery candidate ${candidate.candidate_id} must be newly discovered before queueing for quick screen`)
  }

  const payload: DiscoveryCandidateQueuedPayload = {
    ...basePayloadFromProjection(candidate),
    status: 'queued_for_quick_screen',
    queue_id: normalizeRequiredString(command.queue_id, 'queue id'),
  }

  return await appendDiscoveryEvent(store, {
    event_id: eventId('evt_discovery_candidate_queued_for_quick_screen', payload.queue_id),
    event_type: 'discovery_candidate_queued_for_quick_screen',
    aggregate_type: 'discovery_candidate',
    aggregate_id: payload.candidate_id,
    causation_id: command.causation_id,
    correlation_id: payload.candidate_id,
    actor_type: 'system',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function rejectDiscoveryCandidate(
  store: DiscoveryCandidateEventStore,
  command: RejectDiscoveryCandidateCommand,
): Promise<DiscoveryCandidateRejected> {
  const candidate = await currentCandidate(store, command.candidate_id)
  if (candidate.status !== 'discovered' && candidate.status !== 'queued_for_quick_screen') {
    throw new Error(`Discovery candidate ${candidate.candidate_id} can only be rejected before terminal state`)
  }

  const payload: DiscoveryCandidateRejectedPayload = {
    ...basePayloadFromProjection(candidate),
    status: 'rejected',
    reason: normalizeRequiredString(command.reason, 'rejection reason'),
  }

  return await appendDiscoveryEvent(store, {
    event_id: eventId('evt_discovery_candidate_rejected', payload.candidate_id),
    event_type: 'discovery_candidate_rejected',
    aggregate_type: 'discovery_candidate',
    aggregate_id: payload.candidate_id,
    causation_id: command.causation_id,
    correlation_id: payload.candidate_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function promoteDiscoveryCandidateToResearchCase(
  store: DiscoveryCandidateEventStore,
  command: PromoteDiscoveryCandidateToResearchCaseCommand,
): Promise<DiscoveryCandidatePromoted> {
  const candidate = await currentCandidate(store, command.candidate_id)
  if (candidate.status !== 'queued_for_quick_screen') {
    throw new Error(`Discovery candidate ${candidate.candidate_id} must be queued for quick screen before promotion`)
  }

  const researchCase = await createResearchCase(store, {
    research_case_id: normalizeRequiredString(command.research_case_id, 'research case id'),
    company_id: command.company_id?.trim() || `company_${candidate.ticker.toLowerCase()}`,
    ticker: candidate.ticker,
    strategy_id: candidate.strategy_id,
    strategy_version: candidate.strategy_version,
    actor_id: command.actor_id,
    ...(command.research_case_idempotency_key === undefined ? {} : { idempotency_key: command.research_case_idempotency_key }),
  })
  const payload: DiscoveryCandidatePromotedPayload = {
    ...basePayloadFromProjection(candidate),
    status: 'promoted_to_research_case',
    research_case_id: researchCase.research_case_id,
    research_case_event_id: researchCase.event_id,
  }

  return await appendDiscoveryEvent(store, {
    event_id: eventId('evt_discovery_candidate_promoted_to_research_case', payload.candidate_id),
    event_type: 'discovery_candidate_promoted_to_research_case',
    aggregate_type: 'discovery_candidate',
    aggregate_id: payload.candidate_id,
    causation_id: command.causation_id,
    correlation_id: researchCase.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [...payload.source_ids],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  })
}

export async function runMockStrategyDiscovery(
  store: DiscoveryCandidateEventStore,
  command: RunMockStrategyDiscoveryCommand,
): Promise<DiscoveryCandidateDiscovered[]> {
  const selectedStrategy = resolveResearchStrategyRef(command)
  const discovered: DiscoveryCandidateDiscovered[] = []

  for (const candidate of command.candidates) {
    discovered.push(await discoverCandidate(store, {
      ...candidate,
      ...selectedStrategy,
      discovery_source: command.discovery_source,
      source_ids: command.source_ids,
      actor_id: command.actor_id,
      idempotency_key: `discovery:${selectedStrategy.strategy_id}:${selectedStrategy.strategy_version}:${candidate.market}:${candidate.ticker}:v1`,
      ...(command.discovered_at === undefined ? {} : { discovered_at: command.discovered_at }),
    }))
  }

  return discovered
}
