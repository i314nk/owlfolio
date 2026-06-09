import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import type { GroundFn } from '@owlfolio/workflow/researchSwarm'
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
    expect(result.failed).toBe(0)
  })

  it('records a research_run_failed event and continues without throwing when the swarm fails the grounding gate', async () => {
    // Inject a ground function that always returns empty captures, forcing the
    // swarm's quick-screen fail-closed (no verified sources → no decision_drafted).
    const failingGround: GroundFn = async () => ({ captured: [], verified_ids: [] })

    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc_fail', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc_fail', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc_fail', ticker: 'FAIL', company_id: 'company_fail', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd_fail' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    // Must not throw — one failed run must not abort the loop.
    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research-fail',
      ground: failingGround,
      now: () => new Date('2026-06-08T01:00:00Z'),
    })

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // The run was claimed before the swarm ran.
    expect(types).toContain('research_run_claimed')
    // A durable failure record must exist.
    expect(types).toContain('research_run_failed')
    // No decision was produced — the swarm failed before drafting one.
    expect(types).not.toContain('decision_drafted')
    // Failure count reflects the one failed run.
    expect(result.failed).toBe(1)
    // processed counts all claimed runs including failed ones.
    expect(result.processed).toBe(1)
  })
})
