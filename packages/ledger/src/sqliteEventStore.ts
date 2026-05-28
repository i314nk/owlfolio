import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { AggregateType, LedgerEventEnvelope } from './eventEnvelope'
import { cloneAndFreeze, type EventStore } from './eventStore'
import { runLedgerMigrations } from './sqliteMigrations'
import { validateLedgerEventRow } from './validateLedgerEvent'

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
  return cloneAndFreeze(validateLedgerEventRow(row as unknown as Record<string, unknown>)) as TEvent
}

export class SQLiteEventStore<TEvent extends LedgerEventEnvelope<unknown> = LedgerEventEnvelope<unknown>>
  implements EventStore<TEvent>
{
  private readonly db: DatabaseSync

  constructor(dbPath = ':memory:') {
    ensureParentDirectory(dbPath)
    this.db = new DatabaseSync(dbPath)

    try {
      runLedgerMigrations(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
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
