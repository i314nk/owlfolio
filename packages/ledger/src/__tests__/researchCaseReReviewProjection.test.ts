import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Re-review projection: the thesis DIFF (research_case_re_review_recorded) folds into a DEDICATED
// re_review field — newest wins — and NEVER touches the decision-time fields (specialist findings,
// thesis, verdict). Point-in-time integrity: the dossier's decision basis is immutable; the re-review
// is a later observation ABOUT it.
// ---------------------------------------------------------------------------

const RC = 'rc_rr_proj'

function evt(over: Partial<LedgerEventEnvelope<unknown>> & { event_id: string; event_type: string; payload: unknown }): LedgerEventEnvelope<unknown> {
  return {
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'test-provider',
    source_ids: [],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
    ...over,
  } as LedgerEventEnvelope<unknown>
}

function seed(): LedgerEventEnvelope<unknown>[] {
  return [
    evt({ event_id: 'e1', event_type: 'research_case_created', actor_type: 'user', actor_id: 'user_local', payload: { research_case_id: RC, ticker: 'COST', company_id: 'company_cost' } }),
    evt({ event_id: 'e2', event_type: 'decision_drafted', payload: { research_case_id: RC, decision: 'WATCH', thesis_summary: 'Membership compounder.' } }),
  ]
}

function reReview(id: string, assessment: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return evt({
    event_id: `evt_rr_${id}`,
    event_type: 'research_case_re_review_recorded',
    created_at: createdAt,
    payload: {
      re_review_id: id,
      research_case_id: RC,
      ticker: 'COST',
      assessment,
      trigger_assessments: [{ trigger: 'Renewal < 88%', tripped: 'no', evidence_citation: 'rr_8k_1', reasoning: 'r' }],
      changed_dimensions: [],
      narrative: 'n',
      prior_thesis_summary: 'Membership compounder.',
      new_filings: [{ form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/x/8k.htm', weight: 'strong' }],
      skipped_filings: [],
      prior_corpus_size: 3,
      checked_at: '2026-07-05T00:00:00.000Z',
      reviewed_by_actor_type: 'provider',
      reviewed_by_actor_id: 'openrouter',
    },
  })
}

describe('research_case_re_review_recorded projection', () => {
  it('folds into the dedicated re_review field (newest wins) without touching decision-time fields', () => {
    const cases = projectResearchCases([
      ...seed(),
      reReview('rr_a', 'INTACT', '2026-07-05T00:00:00.000Z'),
      reReview('rr_b', 'WEAKENED', '2026-07-06T00:00:00.000Z'),
    ])
    const c = cases.find((x) => x.research_case_id === RC)!
    expect(c.re_review).toBeDefined()
    expect(c.re_review!.assessment).toBe('WEAKENED')
    expect(c.re_review!.re_review_id).toBe('rr_b')
    expect(c.re_review!.new_filings).toHaveLength(1)
    expect(c.re_review!.trigger_assessments).toHaveLength(1)
    // Decision-time fields untouched.
    expect(c.thesis_summary).toBe('Membership compounder.')
    expect(c.specialist_findings ?? []).toHaveLength(0)
  })

  it('absent event → re_review undefined (legacy cases unaffected)', () => {
    const c = projectResearchCases(seed()).find((x) => x.research_case_id === RC)!
    expect(c.re_review).toBeUndefined()
  })
})
