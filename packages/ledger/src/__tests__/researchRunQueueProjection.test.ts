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

  it('surfaces re-run lineage (supersedes + version) so the worker creates the new case correctly', () => {
    const [run] = projectPendingResearchRuns([
      evt({ payload: { research_case_id: 'rc1', ticker: 'T', supersedes_research_case_id: 'rc_old', version: 3 } }),
    ])
    expect(run?.supersedes_research_case_id).toBe('rc_old')
    expect(run?.version).toBe(3)
  })

  it('tolerates legacy requests with no lineage fields (backward-compat: omit, not default-stamp)', () => {
    const [run] = projectPendingResearchRuns([evt({ payload: { research_case_id: 'rc1', ticker: 'T' } })])
    expect(run).not.toHaveProperty('supersedes_research_case_id')
    expect(run).not.toHaveProperty('version')
  })
})
