import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { createResearchCase } from '../researchWorkflow'

describe('createResearchCase idempotency (discovery-promote → swarm double-create)', () => {
  it('returns the existing case instead of appending a colliding research_case_created', async () => {
    const store = new InMemoryEventStore()
    const cmd = {
      research_case_id: 'rc_test',
      company_id: 'company_test',
      ticker: 'TEST',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    }
    // Promote-time creation.
    const first = await createResearchCase(store, cmd)
    // Worker/swarm re-creates the same case with a different idempotency_key — must NOT collide.
    const second = await createResearchCase(store, { ...cmd, idempotency_key: 'swarm:rc_test:v1' })

    expect(second.research_case_id).toBe('rc_test')
    expect(second.event_id).toBe(first.event_id)
    const created = (await store.list()).filter((event) => event.event_type === 'research_case_created')
    expect(created).toHaveLength(1)
  })
})
