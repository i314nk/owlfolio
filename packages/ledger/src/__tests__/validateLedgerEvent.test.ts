import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '../sqliteEventStore'

async function withTempDb<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-ledger-validation-'))
  try {
    return await fn(join(dir, 'ledger.sqlite'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('SQLite ledger event validation', () => {
  it('throws an event-specific error when source_ids_json is not a string array', async () => {
    await withTempDb(async (dbPath) => {
      const db = new DatabaseSync(dbPath)
      try {
        db.exec(`
          CREATE TABLE ledger_events (
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
          PRAGMA user_version = 1;
        `)

        db.prepare(`
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
        `).run(
          'evt_bad_sources',
          'research_case_created',
          'research_case',
          'rc_cost_001',
          null,
          null,
          null,
          'user',
          'user_local',
          '{"ticker":"COST","strategy_id":"buffett-munger"}',
          '"not-an-array"',
          '2026-05-28T00:00:00.000Z',
          1,
        )
      } finally {
        db.close()
      }

      const store = new SQLiteEventStore(dbPath)
      try {
        await expect(store.list()).rejects.toThrow(/evt_bad_sources/)
        await expect(store.list()).rejects.toThrow(/source_ids_json/)
      } finally {
        store.close()
      }
    })
  })

  it('throws when a row claims a newer schema_version than the code supports', async () => {
    await withTempDb(async (dbPath) => {
      const db = new DatabaseSync(dbPath)
      try {
        db.exec(`
          CREATE TABLE ledger_events (
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
          PRAGMA user_version = 1;
        `)

        db.prepare(`
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
        `).run(
          'evt_future_schema',
          'research_case_created',
          'research_case',
          'rc_cost_001',
          null,
          null,
          null,
          'user',
          'user_local',
          '{"ticker":"COST","strategy_id":"buffett-munger"}',
          '[]',
          '2026-05-28T00:00:00.000Z',
          999,
        )
      } finally {
        db.close()
      }

      const store = new SQLiteEventStore(dbPath)
      try {
        await expect(store.list()).rejects.toThrow(/evt_future_schema/)
        await expect(store.list()).rejects.toThrow(/schema_version/)
      } finally {
        store.close()
      }
    })
  })

  it('throws when actor_type is not one of the supported ledger actor types', async () => {
    await withTempDb(async (dbPath) => {
      const db = new DatabaseSync(dbPath)
      try {
        db.exec(`
          CREATE TABLE ledger_events (
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
          PRAGMA user_version = 1;
        `)

        db.prepare(`
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
        `).run(
          'evt_bad_actor_type',
          'research_case_created',
          'research_case',
          'rc_cost_001',
          null,
          null,
          null,
          'hacker',
          'user_local',
          '{"ticker":"COST","strategy_id":"buffett-munger"}',
          '[]',
          '2026-05-28T00:00:00.000Z',
          1,
        )
      } finally {
        db.close()
      }

      const store = new SQLiteEventStore(dbPath)
      try {
        await expect(store.list()).rejects.toThrow(/evt_bad_actor_type/)
        await expect(store.list()).rejects.toThrow(/actor_type/)
      } finally {
        store.close()
      }
    })
  })

  it('throws when aggregate_type is not one of the supported ledger aggregate types', async () => {
    await withTempDb(async (dbPath) => {
      const db = new DatabaseSync(dbPath)
      try {
        db.exec(`
          CREATE TABLE ledger_events (
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
          PRAGMA user_version = 1;
        `)

        db.prepare(`
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
        `).run(
          'evt_bad_aggregate_type',
          'research_case_created',
          'not_real',
          'rc_cost_001',
          null,
          null,
          null,
          'user',
          'user_local',
          '{"ticker":"COST","strategy_id":"buffett-munger"}',
          '[]',
          '2026-05-28T00:00:00.000Z',
          1,
        )
      } finally {
        db.close()
      }

      const store = new SQLiteEventStore(dbPath)
      try {
        await expect(store.list()).rejects.toThrow(/evt_bad_aggregate_type/)
        await expect(store.list()).rejects.toThrow(/aggregate_type/)
      } finally {
        store.close()
      }
    })
  })
})
