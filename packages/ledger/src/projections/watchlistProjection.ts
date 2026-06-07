import type { LedgerEventEnvelope } from '../eventEnvelope'

export type WatchlistProjection = {
  watchlist_item_id: string
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  strategy_version?: string
  user_approved: boolean
  created_by_actor_type?: string
  created_by_actor_id?: string
  confirmed_by_actor_type?: string
  confirmed_by_actor_id?: string
  thesis_summary?: string
  shariah_gate_decision_id?: string
  shariah_gate_status?: string
  shariah_gate_allowed?: boolean
  shariah_gate_reasons?: string[]
  shariah_required_source_ids?: string[]
  shariah_missing_evidence?: string[]
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

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

type ShariahGateDecisionProjection = {
  decision_id: string
  target_id: string
  status?: string
  allowed?: boolean
  reasons: string[]
  required_source_ids: string[]
  missing_evidence: string[]
  created_at: string
}

function projectShariahGateDecisions(events: LedgerEventEnvelope<unknown>[]): Map<string, ShariahGateDecisionProjection> {
  const decisions = new Map<string, ShariahGateDecisionProjection>()

  for (const event of events) {
    if (event.event_type !== 'shariah_gate_decision_recorded' || !isRecord(event.payload)) {
      continue
    }
    const targetId = getString(event.payload, 'target_id')
    if (targetId === undefined) {
      continue
    }
    const existing = decisions.get(targetId)
    if (existing !== undefined && existing.created_at > event.created_at) {
      continue
    }
    const decision: ShariahGateDecisionProjection = {
      decision_id: getString(event.payload, 'gate_decision_id') ?? event.aggregate_id,
      target_id: targetId,
      reasons: getStringArray(event.payload, 'reasons'),
      required_source_ids: getStringArray(event.payload, 'required_source_ids'),
      missing_evidence: getStringArray(event.payload, 'missing_evidence'),
      created_at: event.created_at,
    }
    const status = getString(event.payload, 'status')
    if (status !== undefined) {
      decision.status = status
    }
    const allowed = getBoolean(event.payload, 'allowed')
    if (allowed !== undefined) {
      decision.allowed = allowed
    }
    decisions.set(targetId, decision)
  }

  return decisions
}

function applyShariahGateDecision(target: WatchlistProjection, decision: ShariahGateDecisionProjection | undefined): void {
  if (decision === undefined) {
    return
  }
  target.shariah_gate_decision_id = decision.decision_id
  if (decision.status !== undefined) {
    target.shariah_gate_status = decision.status
  }
  if (decision.allowed !== undefined) {
    target.shariah_gate_allowed = decision.allowed
  }
  target.shariah_gate_reasons = decision.reasons
  target.shariah_required_source_ids = decision.required_source_ids
  target.shariah_missing_evidence = decision.missing_evidence
}

function applyString(
  target: WatchlistProjection,
  key: keyof Pick<WatchlistProjection, 'company_id' | 'ticker' | 'strategy_id' | 'strategy_version' | 'thesis_summary'>,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

export function projectWatchlist(events: LedgerEventEnvelope<unknown>[]): WatchlistProjection[] {
  const watchlist = new Map<string, WatchlistProjection>()
  const shariahGateDecisions = projectShariahGateDecisions(events)

  for (const event of events) {
    if (
      (event.event_type !== 'watchlist_draft_created' && event.event_type !== 'watchlist_draft_confirmed')
      || !isRecord(event.payload)
    ) {
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

    const userApproved = event.event_type === 'watchlist_draft_confirmed'
      ? true
      : getBoolean(event.payload, 'user_approved')
    if (userApproved !== undefined) {
      watchlistItem.user_approved = userApproved
    }

    applyString(watchlistItem, 'company_id', getString(event.payload, 'company_id'))
    applyString(watchlistItem, 'ticker', getString(event.payload, 'ticker'))
    applyString(watchlistItem, 'strategy_id', getString(event.payload, 'strategy_id'))
    applyString(watchlistItem, 'strategy_version', getString(event.payload, 'strategy_version'))
    applyString(watchlistItem, 'thesis_summary', getString(event.payload, 'thesis_summary'))

    if (event.event_type === 'watchlist_draft_created') {
      watchlistItem.created_by_actor_type = getString(event.payload, 'created_by_actor_type') ?? event.actor_type
      const createdByActorId = getString(event.payload, 'created_by_actor_id') ?? event.actor_id
      if (createdByActorId !== undefined) {
        watchlistItem.created_by_actor_id = createdByActorId
      }
    }

    if (event.event_type === 'watchlist_draft_confirmed') {
      watchlistItem.confirmed_by_actor_type = getString(event.payload, 'confirmed_by_actor_type') ?? event.actor_type
      const confirmedByActorId = getString(event.payload, 'confirmed_by_actor_id') ?? event.actor_id
      if (confirmedByActorId !== undefined) {
        watchlistItem.confirmed_by_actor_id = confirmedByActorId
      }
    }

    watchlist.set(event.aggregate_id, watchlistItem)
  }

  for (const item of watchlist.values()) {
    applyShariahGateDecision(item, shariahGateDecisions.get(item.watchlist_item_id))
  }

  return [...watchlist.values()]
}
