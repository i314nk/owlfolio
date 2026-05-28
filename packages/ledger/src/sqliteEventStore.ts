import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { AggregateType, LedgerEventEnvelope } from './eventEnvelope'
import { cloneAndFreeze, type EventStore } from './eventStore'
import { runLedgerMigrations } from './sqliteMigrations'

type LedgerEventRow = {
  event_id: string
  event_type: string
  aggregate_type: AggregateType
  aggregate_id: string
  causation_id: string | null
  correlation_id: string | null
  idempotency_key: string | null
  actor_type: LedgerEventEnvelope<unknown>['actor_type']
  actor_id: string | null
  payload_json: string
  source_ids_json: string
  created_at: string
  schema_version: number
}

function ensureParentDirectory(dbPath: string): void {
  if (dbPath === ':memory:') {
    return
  }

  mkdirSync(dirname(dbPath), { recursive: true })
}

function rowToEvent<TEvent extends LedgerEventEnvelope<unknown>>(row: LedgerEventRow): TEvent {
  return cloneAndFreeze({
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    ...(row.causation_id === null ? {} : { causation_id: row.causation_id }),
    ...(row.correlation_id === null ? {} : { correlation_id: row.correlation_id }),
    ...(row.idempotency_key === null ? {} : { idempotency_key: row.idempotency_key }),
    actor_type: row.actor_type,
    ...(row.actor_id === null ? {} : { actor_id: row.actor_id }),
    payload: JSON.parse(row.payload_json) as unknown,
    source_ids: JSON.parse(row.source_ids_json) as string[],
    created_at: row.created_at,
    schema_version: row.schema_version,
  } satisfies LedgerEventEnvelope<unknown>) as TEvent
}

export class SQLiteEventStore<TEvent extends LedgerEventEnvelope<unknown> = LedgerEventEnvelope<unknown>>
  implements EventStore<TEvent>
{
  private readonly db: DatabaseSync

  constructor(dbPath = ':memory:') {
    ensureParentDirectory(dbPath)
    this.db = new DatabaseSync(dbPath)
    runLedgerMigrations(this.db)
  }

  async append(event: TEvent): Promise<TEvent> {
    if (event.idempotency_key !== undefined) {
      const existing = this.findByIdempotencyKey(event.idempotency_key)
      if (existing !== undefined) {
        return existing
      }
    }

    try {
      this.db
        .prepare(`
          INSERT INTO ledger_events (
            event_id,
            event_type,
            aggregate_type,
            aggregate_id,
            causation_id,
            correlation_id,
            idempotency_key,
            actor_type,
            actor_id,
            payload_json,
            source_ids_json,
            created_at,
            schema_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.event_id,
          event.event_type,
          event.aggregate_type,
          event.aggregate_id,
          event.causation_id ?? null,
          event.correlation_id ?? null,
          event.idempotency_key ?? null,
          event.actor_type,
          event.actor_id ?? null,
          JSON.stringify(event.payload),
          JSON.stringify(event.source_ids),
          event.created_at,
          event.schema_version,
        )
    } catch (error) {
      if (event.idempotency_key !== undefined) {
        const existing = this.findByIdempotencyKey(event.idempotency_key)
        if (existing !== undefined) {
          return existing
        }
      }

      throw error
    }

    return cloneAndFreeze(event)
  }

  async list(): Promise<TEvent[]> {
    return this.db
      .prepare('SELECT * FROM ledger_events ORDER BY sequence ASC')
      .all()
      .map((row) => rowToEvent(row as LedgerEventRow))
  }

  async listByAggregate(aggregateType: AggregateType, aggregateId: string): Promise<TEvent[]> {
    return this.db
      .prepare('SELECT * FROM ledger_events WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY sequence ASC')
      .all(aggregateType, aggregateId)
      .map((row) => rowToEvent(row as LedgerEventRow))
  }

  close(): void {
    this.db.close()
  }

  private findByIdempotencyKey(idempotencyKey: string): TEvent | undefined {
    const row = this.db
      .prepare('SELECT * FROM ledger_events WHERE idempotency_key = ? ORDER BY sequence ASC LIMIT 1')
      .get(idempotencyKey) as LedgerEventRow | undefined

    return row === undefined ? undefined : rowToEvent(row)
  }
}
