import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Margin-of-safety audit surface: the synthesis decision's key_wrong_assumption (the SINGLE assumption
// that, if wrong, breaks the thesis) and thesis_break_triggers (observable invalidating events) are
// projected on the research case from the `buffett_munger_analysis_drafted` event. Legacy-tolerant: an
// old analysis event WITHOUT these fields still projects (fields undefined, no throw).
// ---------------------------------------------------------------------------

const RC = 'rc_mos_proj'

function created(): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_created_${RC}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: RC, ticker: 'TST', company_id: 'company_tst' },
    source_ids: [],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
  }
}

function analysisDrafted(extra: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_analysis_${RC}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: RC,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      ...extra,
    },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — margin-of-safety audit surface', () => {
  it('projects key_wrong_assumption + thesis_break_triggers when present', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        key_wrong_assumption: 'The assumed 6% durable growth holds — if pricing power erodes the thesis breaks.',
        thesis_break_triggers: [
          'Gross margin falls below 40% for two consecutive quarters.',
          'Membership renewal rate drops below 88%.',
        ],
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.key_wrong_assumption).toContain('6% durable growth')
    expect(rc.thesis_break_triggers).toEqual([
      'Gross margin falls below 40% for two consecutive quarters.',
      'Membership renewal rate drops below 88%.',
    ])
  })

  it('legacy-tolerant: an analysis event WITHOUT the fields still projects (undefined, no throw)', () => {
    const cases = projectResearchCases([created(), analysisDrafted({})])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.key_wrong_assumption).toBeUndefined()
    expect(rc.thesis_break_triggers).toBeUndefined()
    // The rest of the analysis projection is unaffected.
    expect(rc.investment_verdict).toBe('WATCH')
  })
})
