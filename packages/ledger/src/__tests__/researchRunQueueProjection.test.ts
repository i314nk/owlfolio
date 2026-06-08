import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectPendingResearchRuns } from '../projections/researchRunQueueProjection'

const evt = (over: Partial<LedgerEventEnvelope<Record<string, unknown>>>): LedgerEventEnvelope<Record<string, unknown>> => ({
  event_id: 'e', event_type: 'research_run_requested', aggregate_type: 'research_case',
  aggregate_id: 'rc1', actor_type: 'user', payload: { research_case_id: 'rc1', ticker: 'T' },
  source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1, ...over,
}) as LedgerEventEnvelope<Record<string, unknown>>

describe('projectPendingResearchRuns', () => {
  it('returns requested runs that have not been claimed', () => {
    const pending = projectPendingResearchRuns([evt({})])
    expect(pending.map((p) => p.research_case_id)).toEqual(['rc1'])
  })
  it('excludes runs already claimed', () => {
    const pending = projectPendingResearchRuns([
      evt({ event_id: 'e1' }),
      evt({ event_id: 'e2', event_type: 'research_run_claimed', payload: { research_case_id: 'rc1', run_id: 'r' } }),
    ])
    expect(pending).toHaveLength(0)
  })
})
