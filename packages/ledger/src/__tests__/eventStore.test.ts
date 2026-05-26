import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '../eventStore'
import type { LedgerEventEnvelope } from '../eventEnvelope'

type ResearchPayload = { ticker: string; strategy_id: string }

function researchCaseEvent(overrides: Partial<LedgerEventEnvelope<ResearchPayload>> = {}): LedgerEventEnvelope<ResearchPayload> {
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

describe('InMemoryEventStore', () => {
  it('appends and reads immutable event envelopes', async () => {
    const store = new InMemoryEventStore()
    const event = researchCaseEvent()

    const appended = await store.append(event)

    expect(appended).toEqual(event)
    expect(await store.list()).toEqual([event])
    expect(await store.listByAggregate('research_case', 'rc_cost_001')).toEqual([event])
  })

  it('deduplicates repeated appends with the same idempotency key', async () => {
    const store = new InMemoryEventStore()
    const first = researchCaseEvent({
      event_id: 'evt_first',
      idempotency_key: 'research-case:COST:buffett-munger',
    })
    const duplicate = researchCaseEvent({
      event_id: 'evt_duplicate',
      idempotency_key: 'research-case:COST:buffett-munger',
      payload: { ticker: 'COST', strategy_id: 'changed' },
    })

    const appendedFirst = await store.append(first)
    const appendedDuplicate = await store.append(duplicate)

    expect(appendedDuplicate).toEqual(appendedFirst)
    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.event_id).toBe('evt_first')
  })

  it('exposes no update or delete mutation API', () => {
    const store = new InMemoryEventStore()
    expect('update' in store).toBe(false)
    expect('delete' in store).toBe(false)
    expect('remove' in store).toBe(false)
  })
})
