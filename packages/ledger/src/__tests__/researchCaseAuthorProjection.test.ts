import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Defense-in-depth UI honesty: the research-case projection records WHICH provider
// actually authored the run, so a placeholder/mock run can never masquerade as a real
// grounded dossier. The authoring provider is the `buffett_munger_analysis_drafted`
// event's `actor_id` (canonical analysis author), falling back to the
// `specialist_finding_recorded` events' `actor_id`. Only set when actor_type === 'provider'.
// ---------------------------------------------------------------------------

const RC = 'rc_author_proj'

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

function analysisDrafted(
  actor: { actor_type: LedgerEventEnvelope<unknown>['actor_type']; actor_id?: string },
): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_analysis_${RC}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: actor.actor_type,
    ...(actor.actor_id !== undefined ? { actor_id: actor.actor_id } : {}),
    payload: {
      research_case_id: RC,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
    },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

function specialistFinding(
  actor: { actor_type: LedgerEventEnvelope<unknown>['actor_type']; actor_id?: string },
): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_finding_${RC}`,
    event_type: 'specialist_finding_recorded',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: actor.actor_type,
    ...(actor.actor_id !== undefined ? { actor_id: actor.actor_id } : {}),
    payload: {
      research_case_id: RC,
      finding_id: `finding_${RC}`,
      specialist_lane: 'business_quality',
      finding_summary: 'Durable business.',
    },
    source_ids: [],
    created_at: '2026-06-02T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — authored_by_provider_id', () => {
  it('records mock-provider when the analysis was authored by the mock provider', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ actor_type: 'provider', actor_id: 'mock-provider' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBe('mock-provider')
  })

  it('records the real provider id when the analysis was authored by a real provider', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ actor_type: 'provider', actor_id: 'openai' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBe('openai')
  })

  it('prefers the analysis event actor_id over the specialist-finding actor_id', () => {
    const cases = projectResearchCases([
      created(),
      specialistFinding({ actor_type: 'provider', actor_id: 'mock-provider' }),
      analysisDrafted({ actor_type: 'provider', actor_id: 'openai' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBe('openai')
  })

  it('falls back to the specialist-finding actor_id when no analysis event is present', () => {
    const cases = projectResearchCases([
      created(),
      specialistFinding({ actor_type: 'provider', actor_id: 'mock-provider' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBe('mock-provider')
  })

  it('leaves authored_by_provider_id undefined when the author is not a provider', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ actor_type: 'user', actor_id: 'user_local' }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBeUndefined()
  })

  it('leaves authored_by_provider_id undefined when there is no authoring event', () => {
    const cases = projectResearchCases([created()])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.authored_by_provider_id).toBeUndefined()
  })
})
