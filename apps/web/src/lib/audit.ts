import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'

export type AuditActivityEvent = {
  event_id: string
  event_type: string
  event_summary: string
  aggregate_type: string
  aggregate_id: string
  aggregate_label: string
  entity_label: string
  actor_label: string
  created_at: string
  source_count: number
  source_ids: string[]
  causation_id?: string
  correlation_id?: string
  schema_version: number
  raw_event_json: string
  context_explanation: string
  before_json?: string
  after_json?: string
}

export type AuditActivityFilters = {
  correlationId?: string
  dateFrom?: string
  dateTo?: string
  eventId?: string
  eventType?: string
  actor?: string
  entity?: string
  query?: string
  schemaVersion?: string
  sourceId?: string
  timeOrder?: 'asc' | 'desc'
}

export type AuditActivityFilterOptions = {
  eventTypes: string[]
  actors: string[]
  entities: string[]
  schemaVersions: string[]
}

export type AuditActivityView = {
  activeFilters: string[]
  events: AuditActivityEvent[]
  filterOptions: AuditActivityFilterOptions
}

export async function getAuditActivityEventsFromStore(store: EventStore): Promise<AuditActivityEvent[]> {
  return projectAuditActivityEvents(await store.list())
}

export function projectAuditActivityEvents(events: LedgerEventEnvelope<unknown>[]): AuditActivityEvent[] {
  return events
    .map((event) => {
      const aggregateLabel = `${event.aggregate_type} / ${event.aggregate_id}`
      const entityLabel = entityLabelFor(event)
      const beforeAfter = beforeAfterPayload(event.payload)

      return {
        event_id: event.event_id,
        event_type: event.event_type,
        event_summary: `${humanizeEventType(event.event_type)} for ${entityLabel} on ${aggregateLabel}`,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        aggregate_label: aggregateLabel,
        entity_label: entityLabel,
        actor_label: actorLabel(event),
        created_at: event.created_at,
        source_count: event.source_ids.length,
        source_ids: [...event.source_ids],
        ...(event.causation_id === undefined ? {} : { causation_id: event.causation_id }),
        ...(event.correlation_id === undefined ? {} : { correlation_id: event.correlation_id }),
        schema_version: event.schema_version,
        raw_event_json: JSON.stringify(event, null, 2),
        context_explanation: contextExplanation(event, beforeAfter),
        ...(beforeAfter === undefined ? {} : beforeAfter),
      }
    })
    .sort(compareAuditEventsAsc)
}

export function deriveAuditActivityView(
  events: AuditActivityEvent[],
  filters: AuditActivityFilters = {},
): AuditActivityView {
  const filterOptions = {
    eventTypes: uniqueSorted(events.map((event) => event.event_type)),
    actors: uniqueSorted(events.map((event) => event.actor_label)),
    entities: uniqueSorted(events.map((event) => event.entity_label)),
    schemaVersions: uniqueSorted(events.map((event) => String(event.schema_version))),
  }

  const correlationId = normalizeFilter(filters.correlationId)
  const dateFrom = normalizeFilter(filters.dateFrom)
  const dateTo = normalizeFilter(filters.dateTo)
  const eventId = normalizeFilter(filters.eventId)
  const eventType = normalizeFilter(filters.eventType)
  const actor = normalizeFilter(filters.actor)
  const entity = normalizeFilter(filters.entity)
  const query = normalizeFilter(filters.query)
  const schemaVersion = normalizeFilter(filters.schemaVersion)
  const sourceId = normalizeFilter(filters.sourceId)

  const filteredEvents = events
    .filter((event) => eventId === undefined || includesCaseInsensitive(event.event_id, eventId))
    .filter((event) => correlationId === undefined || includesCaseInsensitive(event.correlation_id ?? '', correlationId))
    .filter((event) => sourceId === undefined || event.source_ids.some((source) => includesCaseInsensitive(source, sourceId)))
    .filter((event) => schemaVersion === undefined || String(event.schema_version) === schemaVersion)
    .filter((event) => dateFrom === undefined || event.created_at.slice(0, 10) >= dateFrom)
    .filter((event) => dateTo === undefined || event.created_at.slice(0, 10) <= dateTo)
    .filter((event) => eventType === undefined || event.event_type === eventType)
    .filter((event) => actor === undefined || event.actor_label === actor)
    .filter((event) => entity === undefined || matchesSearch(event, entity))
    .filter((event) => query === undefined || matchesSearch(event, query))
    .sort(filters.timeOrder === 'desc' ? compareAuditEventsDesc : compareAuditEventsAsc)

  return { activeFilters: activeFilterLabels(filters), events: filteredEvents, filterOptions }
}

function activeFilterLabels(filters: AuditActivityFilters): string[] {
  const labels: string[] = []
  const eventId = normalizeFilter(filters.eventId)
  const correlationId = normalizeFilter(filters.correlationId)
  const sourceId = normalizeFilter(filters.sourceId)
  const schemaVersion = normalizeFilter(filters.schemaVersion)
  const dateFrom = normalizeFilter(filters.dateFrom)
  const dateTo = normalizeFilter(filters.dateTo)
  const eventType = normalizeFilter(filters.eventType)
  const actor = normalizeFilter(filters.actor)
  const entity = normalizeFilter(filters.entity)
  const query = normalizeFilter(filters.query)

  if (eventId !== undefined) labels.push(`Event ID contains ${eventId}`)
  if (correlationId !== undefined) labels.push(`Correlation ID contains ${correlationId}`)
  if (sourceId !== undefined) labels.push(`Source ID contains ${sourceId}`)
  if (schemaVersion !== undefined) labels.push(`Schema v${schemaVersion}`)
  if (dateFrom !== undefined) labels.push(`From ${dateFrom}`)
  if (dateTo !== undefined) labels.push(`To ${dateTo}`)
  if (eventType !== undefined) labels.push(`Event type ${eventType}`)
  if (actor !== undefined) labels.push(`Actor ${actor}`)
  if (entity !== undefined) labels.push(`Entity/search ${entity}`)
  if (query !== undefined) labels.push(`Raw evidence contains ${query}`)
  if (filters.timeOrder === 'desc') labels.push('Newest first')

  return labels
}

function compareAuditEventsAsc(left: AuditActivityEvent, right: AuditActivityEvent) {
  return left.created_at.localeCompare(right.created_at) || left.event_id.localeCompare(right.event_id)
}

function compareAuditEventsDesc(left: AuditActivityEvent, right: AuditActivityEvent) {
  return right.created_at.localeCompare(left.created_at) || right.event_id.localeCompare(left.event_id)
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

function humanizeEventType(eventType: string): string {
  const label = eventType
    .split('_')
    .filter((part) => part.length > 0)
    .join(' ')

  return label.length === 0 ? eventType : label.charAt(0).toUpperCase() + label.slice(1)
}

function entityLabelFor(event: LedgerEventEnvelope<unknown>): string {
  const payloadEntity = payloadString(event.payload, [
    'ticker',
    'symbol',
    'company_id',
    'company_name',
    'holding_id',
    'watchlist_item_id',
    'decision_id',
    'research_case_id',
    'snapshot_id',
  ])

  return payloadEntity ?? event.aggregate_id
}

function payloadString(payload: unknown, keys: string[]): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

function beforeAfterPayload(payload: unknown): Pick<AuditActivityEvent, 'before_json' | 'after_json'> | undefined {
  if (!isRecord(payload) || payload.before === undefined || payload.after === undefined) {
    return undefined
  }

  return {
    before_json: JSON.stringify(payload.before, null, 2),
    after_json: JSON.stringify(payload.after, null, 2),
  }
}

function contextExplanation(
  event: LedgerEventEnvelope<unknown>,
  beforeAfter: Pick<AuditActivityEvent, 'before_json' | 'after_json'> | undefined,
): string {
  if (beforeAfter !== undefined) {
    return 'Before → after payload is present in the ledger event; values below are copied directly from the event payload.'
  }

  const causalLinks = [
    ...(event.causation_id === undefined ? [] : [`caused by ${event.causation_id}`]),
    ...(event.correlation_id === undefined ? [] : [`correlated as ${event.correlation_id}`]),
    ...(event.source_ids.length === 0 ? [] : [`sourced from ${event.source_ids.join(', ')}`]),
  ]

  if (causalLinks.length > 0) {
    return `Causal chain: ${causalLinks.join('; ')}.`
  }

  return 'No before/after payload or causal links are present; the raw ledger event remains available for auditability.'
}

function matchesSearch(event: AuditActivityEvent, searchValue: string): boolean {
  return [
    event.event_id,
    event.event_type,
    event.event_summary,
    event.aggregate_type,
    event.aggregate_id,
    event.aggregate_label,
    event.entity_label,
    event.actor_label,
    event.causation_id ?? '',
    event.correlation_id ?? '',
    ...event.source_ids,
    event.raw_event_json,
  ].some((value) => includesCaseInsensitive(value, searchValue))
}

function includesCaseInsensitive(value: string, searchValue: string): boolean {
  return value.toLowerCase().includes(searchValue.toLowerCase())
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
