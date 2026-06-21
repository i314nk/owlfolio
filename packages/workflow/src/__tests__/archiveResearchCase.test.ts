import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'

import { archiveResearchCase, createResearchCase } from '../researchWorkflow'

// Append-only ARCHIVE (option-b: hide-without-mutate). archiveResearchCase appends a single
// `research_case_archived` event that marks the case archived WITHOUT mutating prior research events. The
// case still projects (marked archived: true). Idempotent via the deterministic idempotency_key.

async function seedCase(store: InMemoryEventStore): Promise<string> {
  await createResearchCase(store, {
    research_case_id: 'rc_archive_001',
    company_id: 'company_arc',
    ticker: 'ARC',
    strategy_id: 'buffett-munger',
    actor_id: 'user_local',
  })
  return 'rc_archive_001'
}

describe('archiveResearchCase (option-b append-only archive)', () => {
  it('appends a research_case_archived event that marks the case archived (case still projects)', async () => {
    const store = new InMemoryEventStore()
    const caseId = await seedCase(store)

    const archived = await archiveResearchCase(store, {
      research_case_id: caseId,
      reason: 'stale run',
      actor_id: 'user_local',
    })

    expect(archived.event_type).toBe('research_case_archived')
    expect(archived.aggregate_type).toBe('research_case')
    expect(archived.actor_type).toBe('user')
    expect(archived.research_case_id).toBe(caseId)
    expect(archived.reason).toBe('stale run')
    expect(typeof archived.archived_at).toBe('string')

    const projected = projectResearchCases(await store.list()).find((c) => c.research_case_id === caseId)
    expect(projected?.archived).toBe(true)
  })

  it('is idempotent — re-archiving the same case yields a single event via the idempotency_key', async () => {
    const store = new InMemoryEventStore()
    const caseId = await seedCase(store)

    await archiveResearchCase(store, { research_case_id: caseId, reason: 'first', actor_id: 'user_local' })
    await archiveResearchCase(store, { research_case_id: caseId, reason: 'second', actor_id: 'user_local' })

    const archiveEvents = (await store.list()).filter((e) => e.event_type === 'research_case_archived')
    expect(archiveEvents).toHaveLength(1)
  })

  it('does not remove or mutate the prior research_case_created event (append-only integrity)', async () => {
    const store = new InMemoryEventStore()
    const caseId = await seedCase(store)
    await archiveResearchCase(store, { research_case_id: caseId, reason: 'stale', actor_id: 'user_local' })

    const events = await store.list()
    const created = events.filter((e) => e.event_type === 'research_case_created')
    expect(created).toHaveLength(1)
    expect(events.map((e) => e.event_type)).toEqual(['research_case_created', 'research_case_archived'])
  })
})
