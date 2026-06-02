import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'

export type AuditActivityEvent = {
  event_id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  aggregate_label: string
  actor_label: string
  created_at: string
  source_count: number
  schema_version: number
}

export async function getAuditActivityEventsFromStore(store: EventStore): Promise<AuditActivityEvent[]> {
  return projectAuditActivityEvents(await store.list())
}

export function projectAuditActivityEvents(events: LedgerEventEnvelope<unknown>[]): AuditActivityEvent[] {
  return events
    .map((event) => ({
      event_id: event.event_id,
      event_type: event.event_type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      aggregate_label: `${event.aggregate_type} / ${event.aggregate_id}`,
      actor_label: actorLabel(event),
      created_at: event.created_at,
      source_count: event.source_ids.length,
      schema_version: event.schema_version,
    }))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.event_id.localeCompare(right.event_id))
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}
