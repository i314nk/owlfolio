import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { LEDGER_SCHEMA_VERSION } from '../sqliteMigrations'
import { SQLiteEventStore } from '../sqliteEventStore'

type ResearchPayload = { ticker: string; strategy_id: string }
type ResearchEvent = LedgerEventEnvelope<ResearchPayload>

function researchCaseEvent(): ResearchEvent {
  return {
    event_id: 'evt_research_created_1',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-28T00:00:00.000Z',
    schema_version: 1,
  }
}

async function withTempDb<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-ledger-migrations-'))
  try {
    return await fn(join(dir, 'ledger.sqlite'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('SQLite ledger migrations', () => {
  it('bootstraps a fresh database and stamps PRAGMA user_version', async () => {
    await withTempDb(async (dbPath) => {
      const store = new SQLiteEventStore(dbPath)
      try {
        await store.append(researchCaseEvent())
      } finally {
        store.close()
      }

      const db = new DatabaseSync(dbPath)
      try {
        const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number }
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ledger_events'")
          .get() as { name: string } | undefined

        expect(userVersion.user_version).toBe(LEDGER_SCHEMA_VERSION)
        expect(table?.name).toBe('ledger_events')
      } finally {
        db.close()
      }
    })
  })

  it('upgrades an existing pre-versioned ledger without losing rows', async () => {
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
          'evt_existing',
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
          1,
        )
      } finally {
        db.close()
      }

      const store = new SQLiteEventStore(dbPath)
      try {
        const events = await store.list()
        expect(events).toHaveLength(1)
        expect(events[0]?.event_id).toBe('evt_existing')
      } finally {
        store.close()
      }

      const reopened = new DatabaseSync(dbPath)
      try {
        const userVersion = reopened.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(userVersion.user_version).toBe(LEDGER_SCHEMA_VERSION)
      } finally {
        reopened.close()
      }
    })
  })

  it('rejects a database whose PRAGMA user_version is newer than this code supports', async () => {
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
          PRAGMA user_version = 999;
        `)
      } finally {
        db.close()
      }

      expect(() => new SQLiteEventStore(dbPath)).toThrow(/user_version/)
    })
  })

  it('closes the database handle when constructor rejects an unsupported user_version', async () => {
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
          PRAGMA user_version = 999;
        `)
      } finally {
        db.close()
      }

      expect(() => new SQLiteEventStore(dbPath)).toThrow(/user_version/)

      const openFiles = execFileSync('lsof', ['-Fn', '-p', String(process.pid)], { encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.startsWith('n'))
        .map((line) => line.slice(1))

      expect(openFiles).not.toContain(dbPath)
    })
  })
})
