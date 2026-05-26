import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '../eventStore'

describe('ledger idempotency', () => {
  it('does not duplicate retried worker/provider events', async () => {
    const store = new InMemoryEventStore()
    const event = { event_id: 'evt_analysis_first', event_type: 'buffett_munger_analysis_drafted', aggregate_type: 'research_case' as const, aggregate_id: 'rc_cost_001', idempotency_key: 'provider-run:mock:rc_cost_001:v1', actor_type: 'provider' as const, actor_id: 'mock-provider', payload: { investment_verdict: 'WATCH' }, source_ids: ['src_cost_10k_2025'], created_at: '2026-05-27T00:01:00.000Z', schema_version: 1 }
    await store.append(event)
    await store.append({ ...event, event_id: 'evt_analysis_retry' })
    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.event_id).toBe('evt_analysis_first')
  })
})
