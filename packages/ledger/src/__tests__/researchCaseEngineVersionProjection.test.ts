import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Engine-version marker projection: the run's reasoning vintage (engine_version) — and optional
// engine_commit provenance — are stamped under valuation.judgment on the `buffett_munger_analysis_drafted`
// event and projected onto the case. Legacy-tolerant: a pre-versioning analysis event WITHOUT the marker
// still projects (engine_version undefined, NOT a current-engine default), so a stale run is surfaced.
// ---------------------------------------------------------------------------

const RC = 'rc_engine_ver_proj'

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

function analysisDrafted(judgment: Record<string, unknown> | undefined): LedgerEventEnvelope<unknown> {
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
      valuation: judgment === undefined ? {} : { judgment },
    },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — engine-version marker', () => {
  it('projects engine_version when stamped under valuation.judgment', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ rubric_version: 'judgment-rubrics-x', engine_version: 'valuation-x / judgment-x' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.judgment?.engine_version).toBe('valuation-x / judgment-x')
  })

  it('projects engine_commit when stamped', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ rubric_version: 'r', engine_version: 'v / j', engine_commit: 'abc1234' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.judgment?.engine_commit).toBe('abc1234')
  })

  it('legacy-tolerant: a judgment WITHOUT engine_version projects undefined (not a default), no throw', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ rubric_version: 'judgment-rubrics-legacy', moat: { proposed_tier: 'wide' } }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.judgment?.rubric_version).toBe('judgment-rubrics-legacy')
    expect(rc.valuation?.judgment?.engine_version).toBeUndefined()
    expect(rc.valuation?.judgment?.engine_commit).toBeUndefined()
    // The rest of the analysis projection is unaffected.
    expect(rc.investment_verdict).toBe('WATCH')
  })

  it('legacy-tolerant: an analysis event with NO judgment block still projects (no throw)', () => {
    const cases = projectResearchCases([created(), analysisDrafted(undefined)])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.judgment).toBeUndefined()
    expect(rc.investment_verdict).toBe('WATCH')
  })
})
