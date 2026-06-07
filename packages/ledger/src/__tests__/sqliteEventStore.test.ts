import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'
import { SQLiteEventStore } from '../sqliteEventStore'

type ResearchPayload = { ticker: string; strategy_id: string }
type ResearchEvent = LedgerEventEnvelope<ResearchPayload>

function researchCaseEvent(overrides: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    event_id: 'evt_research_created_1',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-27T00:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }
}

async function withTempDb<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-ledger-'))
  try {
    return await fn(join(dir, 'events.sqlite'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('SQLiteEventStore', () => {
  it('implements the EventStore append/list/listByAggregate contract durably', async () => {
    await withTempDb(async (dbPath) => {
      const store: SQLiteEventStore<ResearchEvent> = new SQLiteEventStore<ResearchEvent>(dbPath)
      let reopened: SQLiteEventStore<ResearchEvent> | undefined
      try {
        const event = researchCaseEvent()

        await store.append(event)
        reopened = new SQLiteEventStore<ResearchEvent>(dbPath)

        expect(await reopened.list()).toEqual([event])
        expect(await reopened.listByAggregate('research_case', 'rc_cost_001')).toEqual([event])
        expect(projectResearchCases(await reopened.list())).toMatchObject([
          { research_case_id: 'rc_cost_001', stage: 'discovered', ticker: 'COST', strategy_id: 'buffett-munger' },
        ])
      } finally {
        reopened?.close()
        store.close()
      }
    })
  })

  it('preserves idempotency across reopened SQLite stores with a unique idempotency key', async () => {
    await withTempDb(async (dbPath) => {
      const firstStore = new SQLiteEventStore<ResearchEvent>(dbPath)
      let reopenedStore: SQLiteEventStore<ResearchEvent> | undefined
      try {
        const first = researchCaseEvent({
          event_id: 'evt_first',
          idempotency_key: 'research-case:COST:buffett-munger',
        })
        const duplicate = researchCaseEvent({
          event_id: 'evt_duplicate',
          idempotency_key: 'research-case:COST:buffett-munger',
          payload: { ticker: 'COST', strategy_id: 'changed' },
        })

        await firstStore.append(first)
        reopenedStore = new SQLiteEventStore<ResearchEvent>(dbPath)
        const appendedDuplicate = await reopenedStore.append(duplicate)

        expect(appendedDuplicate).toEqual(first)
        expect(await reopenedStore.list()).toEqual([first])
      } finally {
        reopenedStore?.close()
        firstStore.close()
      }
    })
  })

  it('rejects invalid runtime event shapes before writing an unreadable row', async () => {
    await withTempDb(async (dbPath) => {
      const store = new SQLiteEventStore<ResearchEvent>(dbPath)
      try {
        const invalidEvent = {
          ...researchCaseEvent({ event_id: 'evt_bad_write' }),
          actor_type: 'hacker',
        } as unknown as ResearchEvent

        await expect(store.append(invalidEvent)).rejects.toThrow(/evt_bad_write/)
        await expect(store.append(invalidEvent)).rejects.toThrow(/actor_type/)
        expect(await store.list()).toEqual([])
      } finally {
        store.close()
      }
    })
  })
})
