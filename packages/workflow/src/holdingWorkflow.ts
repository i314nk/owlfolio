import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { resolveResearchStrategyRef } from './researchStrategyRef'

type HoldingEventStore = EventStore<LedgerEventEnvelope<unknown>>

export type HoldingOpenedPayload = {
  holding_id: string
  watchlist_item_id: string
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version: string
  thesis_summary: string
  shares: number
  cost_basis_per_share: number
  total_cost_basis: number
  currency: string
  opened_at: string
  opened_by_actor_type: ActorType
  opened_by_actor_id: string
}

export type HoldingOpened = LedgerEventEnvelope<HoldingOpenedPayload> & HoldingOpenedPayload

export type HoldingValuationRecordedPayload = {
  snapshot_id: string
  holding_id: string
  price_per_share: number
  shares: number
  market_value: number
  currency: string
  valued_at: string
  valuation_source: 'manual'
  valued_by_actor_type: ActorType
  valued_by_actor_id: string
}

export type HoldingValuationRecorded = LedgerEventEnvelope<HoldingValuationRecordedPayload> & HoldingValuationRecordedPayload

export type OpenHoldingFromWatchlistCommand = {
  holding_id: string
  watchlist_item_id: string
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  thesis_summary: string
  shares: number
  cost_basis_per_share: number
  opened_at?: string
  currency: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export type RecordHoldingValuationSnapshotCommand = {
  snapshot_id: string
  holding_id: string
  price_per_share: number
  shares?: number
  currency: string
  valued_at: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayIsoDate(): string {
  return nowIso().slice(0, 10)
}

function assertValidLotEconomics(command: OpenHoldingFromWatchlistCommand): void {
  if (!Number.isFinite(command.shares) || command.shares <= 0) {
    throw new Error('Holding shares must be greater than zero')
  }
  if (!Number.isFinite(command.cost_basis_per_share) || command.cost_basis_per_share < 0) {
    throw new Error('Cost basis per share cannot be negative')
  }
}

function assertValidValuation(command: RecordHoldingValuationSnapshotCommand): void {
  if (!Number.isFinite(command.price_per_share) || command.price_per_share < 0) {
    throw new Error('Valuation price per share cannot be negative')
  }
  if (command.shares !== undefined && (!Number.isFinite(command.shares) || command.shares <= 0)) {
    throw new Error('Valuation shares must be greater than zero')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.valued_at)) {
    throw new Error('Valuation date must use YYYY-MM-DD format')
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function mergeEventPayload<TPayload extends object>(
  event: LedgerEventEnvelope<TPayload>,
): LedgerEventEnvelope<TPayload> & TPayload {
  return { ...event, ...event.payload }
}

export async function openHoldingFromWatchlist(
  store: HoldingEventStore,
  command: OpenHoldingFromWatchlistCommand,
): Promise<HoldingOpened> {
  assertValidLotEconomics(command)
  const selectedStrategy = resolveResearchStrategyRef(command)
  const totalCostBasis = roundMoney(command.shares * command.cost_basis_per_share)
  const payload: HoldingOpenedPayload = {
    holding_id: command.holding_id,
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    company_id: command.company_id,
    ticker: command.ticker,
    ...selectedStrategy,
    thesis_summary: command.thesis_summary,
    shares: command.shares,
    cost_basis_per_share: command.cost_basis_per_share,
    total_cost_basis: totalCostBasis,
    currency: command.currency,
    opened_at: command.opened_at ?? todayIsoDate(),
    opened_by_actor_type: 'user',
    opened_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<HoldingOpenedPayload> = {
    event_id: `evt_holding_opened_${command.holding_id}`,
    event_type: 'holding_opened',
    aggregate_type: 'holding',
    aggregate_id: command.holding_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingOpenedPayload>)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function recordHoldingValuationSnapshot(
  store: HoldingEventStore,
  command: RecordHoldingValuationSnapshotCommand,
): Promise<HoldingValuationRecorded> {
  assertValidValuation(command)
  const events = await store.list()
  const opened = events
    .filter((event) => event.event_type === 'holding_opened' && event.aggregate_id === command.holding_id)
    .at(-1)
  const openedPayload = opened?.payload
  const openedShares = isRecord(openedPayload) && typeof openedPayload.shares === 'number' ? openedPayload.shares : undefined
  const openedCurrency = isRecord(openedPayload) && typeof openedPayload.currency === 'string' ? openedPayload.currency : undefined
  const shares = command.shares ?? openedShares
  if (shares === undefined || !Number.isFinite(shares) || shares <= 0) {
    throw new Error(`Unknown holding shares for valuation: ${command.holding_id}`)
  }
  if (openedCurrency !== undefined && command.currency !== openedCurrency) {
    throw new Error('Valuation currency must match holding currency')
  }

  const payload: HoldingValuationRecordedPayload = {
    snapshot_id: command.snapshot_id,
    holding_id: command.holding_id,
    price_per_share: command.price_per_share,
    shares,
    market_value: roundMoney(shares * command.price_per_share),
    currency: command.currency,
    valued_at: command.valued_at,
    valuation_source: 'manual',
    valued_by_actor_type: 'user',
    valued_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<HoldingValuationRecordedPayload> = {
    event_id: `evt_holding_valuation_recorded_${command.snapshot_id}`,
    event_type: 'holding_valuation_recorded',
    aggregate_type: 'holding',
    aggregate_id: command.holding_id,
    causation_id: command.causation_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingValuationRecordedPayload>)
}
