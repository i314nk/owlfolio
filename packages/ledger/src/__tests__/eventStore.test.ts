import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '../eventStore'
import type { LedgerEventEnvelope } from '../eventEnvelope'

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

function ignoreReadonlyMutation(mutation: () => void): void {
  try {
    mutation()
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError)
  }
}

describe('InMemoryEventStore', () => {
  it('appends and reads immutable event envelopes', async () => {
    const store = new InMemoryEventStore<ResearchEvent>()
    const event = researchCaseEvent()

    const appended = await store.append(event)

    expect(appended).toEqual(event)
    expect(await store.list()).toEqual([event])
    expect(await store.listByAggregate('research_case', 'rc_cost_001')).toEqual([event])
  })

  it('does not let mutations to the original event alter stored history', async () => {
    const store = new InMemoryEventStore<ResearchEvent>()
    const event = researchCaseEvent({ source_ids: ['src_original'] })

    await store.append(event)

    event.event_id = 'evt_mutated'
    event.payload.ticker = 'MSFT'
    event.source_ids.push('src_mutated')

    const stored = await store.list()
    expect(stored).toEqual([
      researchCaseEvent({
        source_ids: ['src_original'],
      }),
    ])
  })

  it('does not let mutations to returned event payloads or source ids alter stored history', async () => {
    const store = new InMemoryEventStore<ResearchEvent>()
    const event = researchCaseEvent({ source_ids: ['src_original'] })

    await store.append(event)

    const listedEvent = (await store.list())[0]
    expect(listedEvent).toBeDefined()
    ignoreReadonlyMutation(() => {
      listedEvent!.event_id = 'evt_mutated_from_list'
    })
    ignoreReadonlyMutation(() => {
      listedEvent!.payload.ticker = 'MSFT'
    })
    ignoreReadonlyMutation(() => {
      listedEvent!.source_ids.push('src_mutated_from_list')
    })

    const aggregateEvent = (await store.listByAggregate('research_case', 'rc_cost_001'))[0]
    expect(aggregateEvent).toBeDefined()
    ignoreReadonlyMutation(() => {
      aggregateEvent!.payload.strategy_id = 'changed'
    })
    ignoreReadonlyMutation(() => {
      aggregateEvent!.source_ids.push('src_mutated_from_aggregate_list')
    })

    expect(await store.list()).toEqual([
      researchCaseEvent({
        source_ids: ['src_original'],
      }),
    ])
  })

  it('deduplicates repeated appends by idempotency key only', async () => {
    const store = new InMemoryEventStore<ResearchEvent>()
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
    const store = new InMemoryEventStore<ResearchEvent>()
    expect('update' in store).toBe(false)
    expect('delete' in store).toBe(false)
    expect('remove' in store).toBe(false)
  })
})
