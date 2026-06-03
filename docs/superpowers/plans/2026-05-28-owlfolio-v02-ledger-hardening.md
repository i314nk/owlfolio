# Owlfolio v0.2 Ledger Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the durable local ledger so SQLite storage is versioned, rehydration is validated, and the Command Center / Research Dossier consume ledger-owned reusable projections instead of web-local timeline logic.

**Architecture:** Keep SQLite as the single local event source, but extract schema bootstrapping into an explicit migration runner and make row rehydration fail loudly on corrupt or unsupported data. Move command-center summary and research-case timeline logic into `@owlfolio/ledger` so the web app becomes a thin consumer of deterministic read models.

**Tech Stack:** TypeScript, pnpm workspace, Node 22 `node:sqlite`, Next.js 16, React 19, Vitest, Playwright.

---

## Scope

This milestone starts immediately after `b95258f feat: add durable local ledger demo flow`.

It implements:
- versioned SQLite schema bootstrap using `PRAGMA user_version`
- migration plumbing for fresh and already-seeded local ledgers
- validation when SQLite rows are rehydrated back into event envelopes
- ledger-owned research-case timeline projection
- ledger-owned command-center summary projection
- web integration that consumes those projections

It does not implement:
- Workflow Kanban
- broker sync or trading flows
- monthly accounting/purification workflows
- multi-user auth
- remote/cloud database storage
- background daemon scheduling changes

## File structure

```text
packages/
  ledger/
    package.json                                  # add exports for new projections/helpers
    src/
      eventStore.ts                               # keep EventStore interface unchanged
      sqliteEventStore.ts                         # call migration runner + validated row parser
      sqliteMigrations.ts                         # new schema version constant + migration runner
      validateLedgerEvent.ts                      # new runtime validation for DB rows
      projections/
        commandCenterProjection.ts                # new reusable command-center summary projection
        researchCaseProjection.ts                 # existing case projection stays in place
        researchCaseTimelineProjection.ts         # new reusable timeline projection
        watchlistProjection.ts                    # existing watchlist projection stays in place
      __tests__/
        sqliteEventStore.test.ts                  # keep the durable-store contract covered alongside the new migration work
        sqliteMigrations.test.ts                  # new migration/versioning tests
        validateLedgerEvent.test.ts               # new rehydration validation tests
        commandCenterProjection.test.ts           # new reusable summary projection tests
        researchCaseTimelineProjection.test.ts    # new reusable timeline projection tests
apps/
  web/
    src/
      lib/
        demo.ts                                   # consume ledger projections instead of local helpers
      components/__tests__/
        CommandCenter.test.tsx                    # keep dashboard rendering wired to summary projection
        DurableDemoLedger.test.tsx                # keep durable demo store coverage
        ResearchWorkflowPages.test.tsx            # keep dossier timeline coverage
```

## Milestone invariants

The implementation must preserve these behaviors:
- `EventStore` stays append/list/listByAggregate only.
- Existing durable demo ledgers continue to open without data loss.
- Idempotency remains durable across reopened SQLite stores.
- Corrupt or hand-edited DB rows fail loudly with event-specific errors instead of silently producing bad projections.
- The web app still works in credential-free demo mode.
- Research dossier trust semantics remain intact: provider/system draft, user approval is visually/auditably distinct.

## Task 1: Add explicit SQLite schema versioning and migration bootstrap

**Files:**
- Create: `packages/ledger/src/sqliteMigrations.ts`
- Create: `packages/ledger/src/__tests__/sqliteMigrations.test.ts`
- Modify: `packages/ledger/src/sqliteEventStore.ts`

- [ ] **Step 1: Write the failing migration/versioning tests**

Create `packages/ledger/src/__tests__/sqliteMigrations.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { LEDGER_SCHEMA_VERSION } from '../sqliteMigrations'
import { SQLiteEventStore } from '../sqliteEventStore'
import type { LedgerEventEnvelope } from '../eventEnvelope'

function researchCaseEvent(): LedgerEventEnvelope<{ ticker: string; strategy_id: string }> {
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
})
```

- [ ] **Step 2: Run the test to verify the intended RED failure**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/sqliteMigrations.test.ts
```

Expected: FAIL because `sqliteMigrations.ts` does not exist yet and `SQLiteEventStore` does not stamp `PRAGMA user_version`.

- [ ] **Step 3: Implement migration runner and wire it into `SQLiteEventStore`**

Create `packages/ledger/src/sqliteMigrations.ts`:

```ts
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
```

Modify the `SQLiteEventStore` constructor in `packages/ledger/src/sqliteEventStore.ts`:

```ts
import { runLedgerMigrations } from './sqliteMigrations'

constructor(dbPath = ':memory:') {
  ensureParentDirectory(dbPath)
  this.db = new DatabaseSync(dbPath)
  runLedgerMigrations(this.db)
}
```

Important: remove the inline schema `db.exec(...)` block from the constructor after the migration runner is in place. Schema creation must happen only through `runLedgerMigrations()`.

- [ ] **Step 4: Re-run the migration test and the existing durable store contract test**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/sqliteMigrations.test.ts packages/ledger/src/__tests__/sqliteEventStore.test.ts
```

Expected: PASS. Fresh DBs should bootstrap cleanly, old unversioned DBs should be stamped at version `1`, and the durable store contract should still hold.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add packages/ledger/src/sqliteMigrations.ts packages/ledger/src/sqliteEventStore.ts packages/ledger/src/__tests__/sqliteMigrations.test.ts
git commit -m "feat(ledger): add sqlite schema migrations"
```

## Task 2: Validate SQLite row rehydration before returning events

**Files:**
- Create: `packages/ledger/src/validateLedgerEvent.ts`
- Create: `packages/ledger/src/__tests__/validateLedgerEvent.test.ts`
- Modify: `packages/ledger/src/sqliteEventStore.ts`

- [ ] **Step 1: Write failing tests for corrupt or unsupported rows**

Create `packages/ledger/src/__tests__/validateLedgerEvent.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the new validation test to confirm RED**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/validateLedgerEvent.test.ts
```

Expected: FAIL because `rowToEvent()` currently trusts JSON parsing and field shapes.

- [ ] **Step 3: Implement validated row parsing**

Create `packages/ledger/src/validateLedgerEvent.ts`:

```ts
import type { AggregateType, LedgerEventEnvelope } from './eventEnvelope'

export const MAX_SUPPORTED_EVENT_SCHEMA_VERSION = 1

type LedgerEventRecord = Record<string, unknown>

function requireString(row: LedgerEventRecord, key: string, eventId: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ledger event ${eventId}: ${key} must be a non-empty string`)
  }
  return value
}

function requireOptionalString(row: LedgerEventRecord, key: string, eventId: string): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ledger event ${eventId}: ${key} must be undefined or a non-empty string`)
  }
  return value
}

function requireStringArray(value: unknown, eventId: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid ledger event ${eventId}: source_ids_json must decode to string[]`)
  }
  return [...value]
}

export function validateLedgerEventRow(row: LedgerEventRecord): LedgerEventEnvelope<unknown> {
  const eventId = requireString(row, 'event_id', 'unknown-event')
  const schemaVersion = row.schema_version

  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > MAX_SUPPORTED_EVENT_SCHEMA_VERSION) {
    throw new Error(`Invalid ledger event ${eventId}: schema_version ${String(schemaVersion)} is not supported`)
  }

  let payload: unknown
  let sourceIds: unknown

  try {
    payload = JSON.parse(requireString(row, 'payload_json', eventId))
  } catch {
    throw new Error(`Invalid ledger event ${eventId}: payload_json is not valid JSON`)
  }

  try {
    sourceIds = JSON.parse(requireString(row, 'source_ids_json', eventId))
  } catch {
    throw new Error(`Invalid ledger event ${eventId}: source_ids_json is not valid JSON`)
  }

  return {
    event_id: eventId,
    event_type: requireString(row, 'event_type', eventId),
    aggregate_type: requireString(row, 'aggregate_type', eventId) as AggregateType,
    aggregate_id: requireString(row, 'aggregate_id', eventId),
    ...(requireOptionalString(row, 'causation_id', eventId) === undefined
      ? {}
      : { causation_id: requireOptionalString(row, 'causation_id', eventId) }),
    ...(requireOptionalString(row, 'correlation_id', eventId) === undefined
      ? {}
      : { correlation_id: requireOptionalString(row, 'correlation_id', eventId) }),
    ...(requireOptionalString(row, 'idempotency_key', eventId) === undefined
      ? {}
      : { idempotency_key: requireOptionalString(row, 'idempotency_key', eventId) }),
    actor_type: requireString(row, 'actor_type', eventId) as LedgerEventEnvelope<unknown>['actor_type'],
    ...(requireOptionalString(row, 'actor_id', eventId) === undefined
      ? {}
      : { actor_id: requireOptionalString(row, 'actor_id', eventId) }),
    payload,
    source_ids: requireStringArray(sourceIds, eventId),
    created_at: requireString(row, 'created_at', eventId),
    schema_version: Number(schemaVersion),
  }
}
```

Update `packages/ledger/src/sqliteEventStore.ts` so `rowToEvent()` delegates to the validator before `cloneAndFreeze()`:

```ts
import { validateLedgerEventRow } from './validateLedgerEvent'

function rowToEvent<TEvent extends LedgerEventEnvelope<unknown>>(row: LedgerEventRow): TEvent {
  return cloneAndFreeze(validateLedgerEventRow(row as unknown as Record<string, unknown>)) as TEvent
}
```

Important: keep validation centralized in one helper. Do not duplicate ad hoc JSON parsing in `list()`, `listByAggregate()`, and `findByIdempotencyKey()`.

- [ ] **Step 4: Re-run validation plus durable-store tests**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/validateLedgerEvent.test.ts packages/ledger/src/__tests__/sqliteEventStore.test.ts packages/ledger/src/__tests__/replay.test.ts
```

Expected: PASS. Corrupt rows should throw descriptive errors, while valid rows still replay deterministically.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/ledger/src/validateLedgerEvent.ts packages/ledger/src/sqliteEventStore.ts packages/ledger/src/__tests__/validateLedgerEvent.test.ts
git commit -m "feat(ledger): validate sqlite event rehydration"
```

## Task 3: Move timeline and dashboard summaries into ledger-owned projections

**Files:**
- Create: `packages/ledger/src/projections/researchCaseTimelineProjection.ts`
- Create: `packages/ledger/src/projections/commandCenterProjection.ts`
- Create: `packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts`
- Create: `packages/ledger/src/__tests__/commandCenterProjection.test.ts`
- Modify: `packages/ledger/package.json`

- [ ] **Step 1: Write failing projection tests first**

Create `packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCaseTimeline } from '../projections/researchCaseTimelineProjection'

const events: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_created',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-28T00:00:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_analysis',
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: 'rc_cost_001',
      investment_verdict: 'WATCH',
      strategy_compliance: 'PASS',
      shariah_status: 'PASS',
      valuation_status: 'FAIR',
      next_required_action: 'Review COST research case and confirm the watchlist draft',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:05:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_watchlist',
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'wl_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: true,
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:10:00.000Z',
    schema_version: 1,
  },
]

describe('projectResearchCaseTimeline', () => {
  it('returns ordered actor-attributed timeline entries for one case', () => {
    const timeline = projectResearchCaseTimeline(events, 'rc_cost_001')

    expect(timeline.map((entry) => entry.event_id)).toEqual(['evt_created', 'evt_analysis', 'evt_watchlist'])
    expect(timeline[1]).toMatchObject({
      actor_label: 'provider:mock-provider',
      summary: 'WATCH / PASS / Shariah PASS',
    })
    expect(timeline[2]?.source_ids).toEqual(['src_cost_10k_2025'])
  })
})
```

Create `packages/ledger/src/__tests__/commandCenterProjection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectCommandCenterSummary } from '../projections/commandCenterProjection'

const events: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_created',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-28T00:00:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_analysis',
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: 'rc_cost_001',
      investment_verdict: 'WATCH',
      strategy_compliance: 'PASS',
      shariah_status: 'PASS',
      valuation_status: 'FAIR',
      next_required_action: 'Review COST research case and confirm the watchlist draft',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:05:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_watchlist',
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'wl_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:10:00.000Z',
    schema_version: 1,
  },
]

describe('projectCommandCenterSummary', () => {
  it('derives pipeline counts, next action, and recent activity from ledger events', () => {
    expect(projectCommandCenterSummary(events)).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 1,
        pending_user_actions: 1,
      },
      primary_research_case_id: 'rc_cost_001',
      next_recommended_action: 'Review COST research case and confirm the watchlist draft',
      recent_activity: [
        'watchlist_draft_created by user:user_local',
        'buffett_munger_analysis_drafted by provider:mock-provider',
        'research_case_created by user:user_local',
      ],
    })
  })
})
```

- [ ] **Step 2: Run the projection tests and confirm RED**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts
```

Expected: FAIL because the new projection files and exports do not exist yet.

- [ ] **Step 3: Implement ledger-owned timeline and summary projections**

Create `packages/ledger/src/projections/researchCaseTimelineProjection.ts`:

```ts
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
```

Create `packages/ledger/src/projections/commandCenterProjection.ts`:

```ts
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'

export type CommandCenterSummary = {
  pipeline_counts: {
    research_cases: number
    watchlist_drafts: number
    pending_user_actions: number
  }
  primary_research_case_id?: string
  next_recommended_action: string
  recent_activity: string[]
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

export function projectCommandCenterSummary(events: LedgerEventEnvelope<unknown>[]): CommandCenterSummary {
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const pendingDrafts = watchlist.filter((item) => !item.user_approved).length

  return {
    pipeline_counts: {
      research_cases: researchCases.length,
      watchlist_drafts: watchlist.length,
      pending_user_actions: pendingDrafts,
    },
    ...(researchCases[0] === undefined ? {} : { primary_research_case_id: researchCases[0].research_case_id }),
    next_recommended_action: researchCases[0]?.next_required_action ?? 'Review the demo workflow status',
    recent_activity: events
      .slice(-3)
      .reverse()
      .map((event) => `${event.event_type} by ${actorLabel(event)}`),
  }
}
```

Modify `packages/ledger/package.json` exports:

```json
{
  "exports": {
    "./eventEnvelope": "./src/eventEnvelope.ts",
    "./eventStore": "./src/eventStore.ts",
    "./sqliteEventStore": "./src/sqliteEventStore.ts",
    "./projections/researchCaseProjection": "./src/projections/researchCaseProjection.ts",
    "./projections/researchCaseTimelineProjection": "./src/projections/researchCaseTimelineProjection.ts",
    "./projections/watchlistProjection": "./src/projections/watchlistProjection.ts",
    "./projections/commandCenterProjection": "./src/projections/commandCenterProjection.ts"
  }
}
```

- [ ] **Step 4: Re-run projection tests and ledger typecheck**

Run:

```bash
corepack pnpm test packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts && corepack pnpm --filter @owlfolio/ledger typecheck
```

Expected: PASS. Both projections should produce deterministic read models without importing web code.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/ledger/package.json packages/ledger/src/projections/researchCaseTimelineProjection.ts packages/ledger/src/projections/commandCenterProjection.ts packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts
git commit -m "feat(ledger): add reusable workflow projections"
```

## Task 4: Make the web demo consume the ledger projections

**Files:**
- Modify: `apps/web/src/lib/demo.ts`
- Modify: `apps/web/src/components/__tests__/DurableDemoLedger.test.tsx`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
- Modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx`

- [ ] **Step 1: Update tests so the web helper must use the new ledger projections**

In `apps/web/src/components/__tests__/DurableDemoLedger.test.tsx`, add assertions that exercise the reusable summary projection output through `getDemoCommandCenterFromStore()`:

```ts
expect(dashboard.pipeline_counts).toMatchObject({
  research_cases: 1,
  watchlist_drafts: 1,
  pending_user_actions: 1,
})
expect(dashboard.recent_activity[0]).toBe('watchlist_draft_created by user:user_local')
expect(dashboard.demo_research_case_id).toBe('rc_cost_001')
```

In `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`, add assertions that exercise the reusable timeline projection through `getDemoResearchCaseFromStore()`:

```ts
expect(researchCase.ledger_timeline.map((entry) => entry.event_type)).toEqual([
  'research_case_created',
  'buffett_munger_analysis_drafted',
  'decision_drafted',
  'watchlist_draft_created',
])
expect(researchCase.ledger_timeline[1]).toMatchObject({
  actor_label: 'provider:mock-provider',
  summary: 'WATCH / PASS / Shariah PASS',
})
expect(researchCase.source_ids).toContain('src_cost_10k_2025')
```

Keep the existing render assertions for `CommandCenter`, `ResearchCasePanel`, and the watchlist page.

- [ ] **Step 2: Run the targeted web tests and confirm RED**

Run:

```bash
corepack pnpm test apps/web/src/components/__tests__/DurableDemoLedger.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx
```

Expected: FAIL after the new expectations are added, because `apps/web/src/lib/demo.ts` still owns its own summary/timeline logic.

- [ ] **Step 3: Replace web-local projection logic with ledger imports**

Update the imports at the top of `apps/web/src/lib/demo.ts`:

```ts
import { projectCommandCenterSummary } from '@owlfolio/ledger/projections/commandCenterProjection'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
```

Then simplify `getDemoCommandCenterFromStore()`:

```ts
export async function getDemoCommandCenterFromStore(store: EventStore): Promise<DemoCommandCenter> {
  const events = await getDemoEventsFromStore(store)
  const summary = projectCommandCenterSummary(events)

  return {
    product_name: 'Owlfolio',
    setup_status: 'Setup ready',
    provider_status: 'Provider: Mock provider / demo mode',
    strategy_status: 'Strategy: Buffett-Munger certified',
    shariah_status: 'Shariah: enabled by default',
    ledger_status: 'Ledger: SQLite durable event source',
    pipeline_counts: summary.pipeline_counts,
    next_recommended_action: summary.next_recommended_action,
    demo_research_case_id: summary.primary_research_case_id ?? DEMO_RESEARCH_CASE_ID,
    recent_activity: summary.recent_activity,
  }
}
```

Update `projectDemoResearchCases()` to consume the new timeline projection and derive source IDs from it:

```ts
function projectDemoResearchCases(events: LedgerEventEnvelope<unknown>[]): DemoResearchCase[] {
  return projectResearchCases(events).map((researchCase) => {
    const timeline = projectResearchCaseTimeline(events, researchCase.research_case_id)

    return {
      ...researchCase,
      gate_checklist: demoGateChecklist.map((gate) => ({ ...gate })),
      source_ids: [...new Set(timeline.flatMap((entry) => entry.source_ids))],
      ledger_timeline: timeline,
    }
  })
}
```

Delete the now-duplicated helpers from `apps/web/src/lib/demo.ts` once the imports above replace them:
- `timelineForResearchCase()`
- `sourceIdsForResearchCase()`
- `eventBelongsToResearchCase()`
- local `actorLabel()`
- local `summarizeEvent()`
- local `getString()` / `isRecord()` that were only supporting the deleted helpers

- [ ] **Step 4: Re-run targeted tests, typecheck, and full test suite**

Run:

```bash
corepack pnpm test apps/web/src/components/__tests__/DurableDemoLedger.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx && corepack pnpm typecheck && corepack pnpm test
```

Expected: PASS. The web app should still render the same durable demo workflow, but the read models now come from `@owlfolio/ledger`.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/web/src/lib/demo.ts apps/web/src/components/__tests__/DurableDemoLedger.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx
git commit -m "refactor(web): consume ledger-owned projections"
```

## Task 5: Final verification of the hardening milestone

**Files:**
- No new source files expected.
- If `apps/web/next-env.d.ts` changes during `next build`, restore it before final status unless the generated content actually differs intentionally.

- [ ] **Step 1: Run diff hygiene and targeted ledger checks**

Run:

```bash
git diff --check && corepack pnpm test packages/ledger/src/__tests__/sqliteMigrations.test.ts packages/ledger/src/__tests__/validateLedgerEvent.test.ts packages/ledger/src/__tests__/researchCaseTimelineProjection.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts apps/web/src/components/__tests__/DurableDemoLedger.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full workspace verification**

Run:

```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e && NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

Expected: PASS. Keep the existing warning suppression behavior for `node:sqlite` intact unless a task above intentionally changed it.

- [ ] **Step 3: Run a browser smoke check on the three key routes**

Run the app:

```bash
corepack pnpm dev
```

Then verify in the browser:
- `/` shows Command Center counts, next action, and recent activity
- `/research/rc_cost_001` shows the research dossier plus ordered ledger timeline
- `/watchlist` shows the watchlist draft state without credential requirements
- browser console shows no JavaScript errors

Stop the dev server after verification.

- [ ] **Step 4: Confirm final git state**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `main` after the last milestone commit.

## Notes for the implementing agent

- Do not widen `EventStore` yet with `close()` or admin APIs; `SQLiteEventStore.close()` can remain a concrete convenience method.
- Use `PRAGMA user_version` for schema versioning before adding a more elaborate migrations table.
- Prefer small pure projection functions in `packages/ledger` over adding more stateful web helpers.
- Validation should describe the bad `event_id` in every thrown error so corrupt local DB rows are diagnosable.
- Keep `schema_version: 1` on all current seeded and workflow-generated events; this milestone hardens the storage layer, not the event schema itself.

## Self-review checklist

- Every requirement from the “ledger hardening” recommendation is covered:
  - migrations/versioning → Task 1
  - validation on rehydration → Task 2
  - reusable projections → Task 3
  - web adoption of reusable projections → Task 4
  - full regression/build/browser verification → Task 5
- No Workflow Kanban work was added.
- Existing durable ledgers are handled as a migration case instead of being invalidated.
- Tests are RED → GREEN for each task.
- Commit cadence stays small and reviewable.
