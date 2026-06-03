import type { ActorType, AggregateType, LedgerEventEnvelope } from './eventEnvelope'

export const MAX_SUPPORTED_EVENT_SCHEMA_VERSION = 1

type LedgerEventRecord = Record<string, unknown>

const supportedAggregateTypes = new Set<AggregateType>([
  'strategy',
  'company',
  'research_case',
  'watchlist_item',
  'holding',
  'decision',
  'accounting_snapshot',
  'purification_entry',
  'cash_account',
  'provider_run',
  'scheduled_task',
])

const supportedActorTypes = new Set<ActorType>(['user', 'system', 'provider', 'worker'])

function requireString(value: unknown, key: string, eventId: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ledger event ${eventId}: ${key} must be a non-empty string`)
  }

  return value
}

function optionalString(value: unknown, key: string, eventId: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ledger event ${eventId}: ${key} must be undefined or a non-empty string`)
  }

  return value
}

function parseJson(text: unknown, key: string, eventId: string): unknown {
  const raw = requireString(text, key, eventId)

  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`Invalid ledger event ${eventId}: ${key} is not valid JSON`)
  }
}

function requireStringArray(value: unknown, eventId: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid ledger event ${eventId}: source_ids_json must decode to string[]`)
  }

  return [...value]
}

function requireAggregateType(value: unknown, eventId: string): AggregateType {
  const aggregateType = requireString(value, 'aggregate_type', eventId)

  if (!supportedAggregateTypes.has(aggregateType as AggregateType)) {
    throw new Error(`Invalid ledger event ${eventId}: aggregate_type ${aggregateType} is not supported`)
  }

  return aggregateType as AggregateType
}

function requireActorType(value: unknown, eventId: string): ActorType {
  const actorType = requireString(value, 'actor_type', eventId)

  if (!supportedActorTypes.has(actorType as ActorType)) {
    throw new Error(`Invalid ledger event ${eventId}: actor_type ${actorType} is not supported`)
  }

  return actorType as ActorType
}

export function validateLedgerEventRow(row: LedgerEventRecord): LedgerEventEnvelope<unknown> {
  const eventId = requireString(row.event_id, 'event_id', 'unknown-event')
  const schemaVersion = row.schema_version

  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > MAX_SUPPORTED_EVENT_SCHEMA_VERSION) {
    throw new Error(`Invalid ledger event ${eventId}: schema_version ${String(schemaVersion)} is not supported`)
  }

  const payload = parseJson(row.payload_json, 'payload_json', eventId)
  const sourceIds = requireStringArray(parseJson(row.source_ids_json, 'source_ids_json', eventId), eventId)
  const causationId = optionalString(row.causation_id, 'causation_id', eventId)
  const correlationId = optionalString(row.correlation_id, 'correlation_id', eventId)
  const idempotencyKey = optionalString(row.idempotency_key, 'idempotency_key', eventId)
  const actorId = optionalString(row.actor_id, 'actor_id', eventId)

  return {
    event_id: eventId,
    event_type: requireString(row.event_type, 'event_type', eventId),
    aggregate_type: requireAggregateType(row.aggregate_type, eventId),
    aggregate_id: requireString(row.aggregate_id, 'aggregate_id', eventId),
    ...(causationId === undefined ? {} : { causation_id: causationId }),
    ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
    ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
    actor_type: requireActorType(row.actor_type, eventId),
    ...(actorId === undefined ? {} : { actor_id: actorId }),
    payload,
    source_ids: sourceIds,
    created_at: requireString(row.created_at, 'created_at', eventId),
    schema_version: Number(schemaVersion),
  }
}
