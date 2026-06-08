import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { runProcessResearchQueueTask } from '../runtime'

describe('runProcessResearchQueueTask', () => {
  it('claims a pending request and runs the swarm to a decision', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc1', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc1', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc1', ticker: 'TEST', company_id: 'company_test', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd1' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research',
      now: () => new Date('2026-06-08T00:00:00Z'),
    })

    const types = (await store.list()).map((e) => e.event_type)
    expect(types).toContain('research_run_claimed')
    expect(types).toContain('decision_drafted')
    expect(result.processed).toBe(1)
  })
})
