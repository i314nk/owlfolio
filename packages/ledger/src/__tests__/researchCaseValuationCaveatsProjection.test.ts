import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// LIVE FIND (V, rc_v_1783859004568): the engine emits HONEST unpriced reasons on the analysis payload
// (valuation.valuation_caveats — e.g. "diluted shares missing") and harness-degradation notes
// (valuation.degraded_flags — e.g. "shariah_ratios_unverified: market_cap_unavailable"), but NEITHER
// was projected — the dossier showed an empty Pillar 4 with no explanation. Project both (additive).
// ---------------------------------------------------------------------------

const RC = 'rc_val_caveats_proj'

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

function analysisDrafted(valuation: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_analysis_${RC}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: { research_case_id: RC, investment_verdict: 'WATCH', valuation },
    source_ids: [],
    created_at: '2026-06-01T01:00:00.000Z',
    schema_version: 1,
  }
}

describe('valuation caveats + degraded flags projection (the honest unpriced reasons)', () => {
  it('projects valuation_caveats and degraded_flags from the valuation block', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        moat_class: 'wide',
        valuation_caveats: ['Valuation not computed: diluted shares missing or non-positive.'],
        degraded_flags: ['shariah_ratios_unverified: market_cap_unavailable'],
      }),
    ])
    const c = cases.find((x) => x.research_case_id === RC)
    expect(c?.valuation?.valuation_caveats).toEqual(['Valuation not computed: diluted shares missing or non-positive.'])
    expect(c?.valuation?.degraded_flags).toEqual(['shariah_ratios_unverified: market_cap_unavailable'])
  })

  it('legacy event without the keys projects with the fields absent', () => {
    const cases = projectResearchCases([created(), analysisDrafted({ moat_class: 'wide' })])
    const c = cases.find((x) => x.research_case_id === RC)
    expect(c?.valuation?.valuation_caveats).toBeUndefined()
    expect(c?.valuation?.degraded_flags).toBeUndefined()
  })
})
