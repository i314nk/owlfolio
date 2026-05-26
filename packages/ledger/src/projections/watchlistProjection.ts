import type { LedgerEventEnvelope } from '../eventEnvelope'

export type WatchlistProjection = {
  watchlist_item_id: string
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  user_approved: boolean
  created_by_actor_type?: string
  created_by_actor_id?: string
  thesis_summary?: string
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function applyString(
  target: WatchlistProjection,
  key: keyof Pick<WatchlistProjection, 'company_id' | 'ticker' | 'strategy_id' | 'thesis_summary'>,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

export function projectWatchlist(events: LedgerEventEnvelope<unknown>[]): WatchlistProjection[] {
  const watchlist = new Map<string, WatchlistProjection>()

  for (const event of events) {
    if (event.event_type !== 'watchlist_draft_created' || !isRecord(event.payload)) {
      continue
    }

    const researchCaseId = getString(event.payload, 'research_case_id') ?? event.correlation_id
    if (researchCaseId === undefined) {
      continue
    }

    const existing = watchlist.get(event.aggregate_id)
    const watchlistItem =
      existing ??
      {
        watchlist_item_id: event.aggregate_id,
        research_case_id: researchCaseId,
        user_approved: false,
        updated_at: event.created_at,
      }

    watchlistItem.research_case_id = researchCaseId
    watchlistItem.updated_at = event.created_at

    const userApproved = getBoolean(event.payload, 'user_approved')
    if (userApproved !== undefined) {
      watchlistItem.user_approved = userApproved
    }

    applyString(watchlistItem, 'company_id', getString(event.payload, 'company_id'))
    applyString(watchlistItem, 'ticker', getString(event.payload, 'ticker'))
    applyString(watchlistItem, 'strategy_id', getString(event.payload, 'strategy_id'))
    applyString(watchlistItem, 'thesis_summary', getString(event.payload, 'thesis_summary'))
    watchlistItem.created_by_actor_type = getString(event.payload, 'created_by_actor_type') ?? event.actor_type
    const createdByActorId = getString(event.payload, 'created_by_actor_id') ?? event.actor_id
    if (createdByActorId !== undefined) {
      watchlistItem.created_by_actor_id = createdByActorId
    }

    watchlist.set(event.aggregate_id, watchlistItem)
  }

  return [...watchlist.values()]
}
