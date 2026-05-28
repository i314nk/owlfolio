import type { DatabaseSync } from 'node:sqlite'

export const LEDGER_SCHEMA_VERSION = 1

type LedgerMigration = {
  version: number
  up(db: DatabaseSync): void
}

const migrations: LedgerMigration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ledger_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          causation_id TEXT,
          correlation_id TEXT,
          idempotency_key TEXT,
          actor_type TEXT NOT NULL,
          actor_id TEXT,
          payload_json TEXT NOT NULL,
          source_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ledger_events_idempotency_key_unique
        ON ledger_events(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS ledger_events_aggregate_idx
        ON ledger_events(aggregate_type, aggregate_id, sequence);
      `)
    },
  },
]

export function runLedgerMigrations(db: DatabaseSync): void {
  const pragma = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let currentVersion = Number(pragma.user_version ?? 0)

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue
    }

    migration.up(db)
    db.exec(`PRAGMA user_version = ${migration.version}`)
    currentVersion = migration.version
  }
}
