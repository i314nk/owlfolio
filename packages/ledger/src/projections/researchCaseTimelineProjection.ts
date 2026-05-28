import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseTimelineEntry = {
  event_id: string
  event_type: string
  actor_type: LedgerEventEnvelope<unknown>['actor_type']
  actor_id?: string
  actor_label: string
  created_at: string
  summary: string
  source_ids: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function eventBelongsToResearchCase(event: LedgerEventEnvelope<unknown>, researchCaseId: string): boolean {
  if (event.aggregate_type === 'research_case' && event.aggregate_id === researchCaseId) {
    return true
  }

  if (event.correlation_id === researchCaseId) {
    return true
  }

  return isRecord(event.payload) && getString(event.payload, 'research_case_id') === researchCaseId
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

function summarizeEvent(event: LedgerEventEnvelope<unknown>): string {
  if (!isRecord(event.payload)) {
    return event.event_type
  }

  if (event.event_type === 'research_case_created') {
    return `Created research case for ${getString(event.payload, 'ticker') ?? event.aggregate_id}`
  }

  if (event.event_type === 'buffett_munger_analysis_drafted') {
    return `${getString(event.payload, 'investment_verdict') ?? 'UNKNOWN'} / ${
      getString(event.payload, 'strategy_compliance') ?? 'UNKNOWN'
    } / Shariah ${getString(event.payload, 'shariah_status') ?? 'UNKNOWN'}`
  }

  if (event.event_type === 'decision_drafted') {
    return `Drafted ${getString(event.payload, 'decision') ?? 'UNKNOWN'} decision`
  }

  if (event.event_type === 'watchlist_draft_created') {
    return `Created watchlist draft for ${getString(event.payload, 'ticker') ?? event.aggregate_id}`
  }

  return event.event_type
}

export function projectResearchCaseTimeline(
  events: LedgerEventEnvelope<unknown>[],
  researchCaseId: string,
): ResearchCaseTimelineEntry[] {
  return events.filter((event) => eventBelongsToResearchCase(event, researchCaseId)).map((event) => ({
    event_id: event.event_id,
    event_type: event.event_type,
    actor_type: event.actor_type,
    ...(event.actor_id === undefined ? {} : { actor_id: event.actor_id }),
    actor_label: actorLabel(event),
    created_at: event.created_at,
    summary: summarizeEvent(event),
    source_ids: [...event.source_ids],
  }))
}
