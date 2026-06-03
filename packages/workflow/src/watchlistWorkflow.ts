import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

type WatchlistEventStore = EventStore<LedgerEventEnvelope<unknown>>

type WatchlistDraftCreatedPayload = {
  watchlist_item_id: string
  research_case_id: string
  decision_id: string
  company_id: string
  ticker: string
  strategy_id: string
  thesis_summary: string
  user_approved: false
  created_by_actor_type: ActorType
  created_by_actor_id: string
}

export type WatchlistDraftCreated = LedgerEventEnvelope<WatchlistDraftCreatedPayload> & WatchlistDraftCreatedPayload

export type ConfirmWatchlistDraftCommand = {
  watchlist_item_id: string
  research_case_id: string
  decision_id: string
  company_id: string
  ticker: string
  strategy_id: string
  thesis_summary: string
  actor_id: string
  idempotency_key?: string
}

type WatchlistDraftConfirmedPayload = {
  watchlist_item_id: string
  research_case_id: string
  user_approved: true
  confirmed_by_actor_type: ActorType
  confirmed_by_actor_id: string
}

export type WatchlistDraftConfirmed = LedgerEventEnvelope<WatchlistDraftConfirmedPayload> & WatchlistDraftConfirmedPayload

export type ApproveWatchlistDraftCommand = {
  watchlist_item_id: string
  research_case_id: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function mergeEventPayload<TPayload extends object>(
  event: LedgerEventEnvelope<TPayload>,
): LedgerEventEnvelope<TPayload> & TPayload {
  return { ...event, ...event.payload }
}

export async function confirmWatchlistDraft(
  store: WatchlistEventStore,
  command: ConfirmWatchlistDraftCommand,
): Promise<WatchlistDraftCreated> {
  const payload: WatchlistDraftCreatedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    company_id: command.company_id,
    ticker: command.ticker,
    strategy_id: command.strategy_id,
    thesis_summary: command.thesis_summary,
    user_approved: false,
    created_by_actor_type: 'user',
    created_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<WatchlistDraftCreatedPayload> = {
    event_id: `evt_watchlist_draft_created_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: command.decision_id,
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

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftCreatedPayload>)
}

export async function approveWatchlistDraft(
  store: WatchlistEventStore,
  command: ApproveWatchlistDraftCommand,
): Promise<WatchlistDraftConfirmed> {
  const payload: WatchlistDraftConfirmedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    user_approved: true,
    confirmed_by_actor_type: 'user',
    confirmed_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<WatchlistDraftConfirmedPayload> = {
    event_id: `evt_watchlist_draft_confirmed_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
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

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftConfirmedPayload>)
}
