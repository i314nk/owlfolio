import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// F.2 discount-provenance projection: the analysis event's valuation block carries discount_inputs as the
// COMPLIANT risk-free SAVINGS rate (risk_free_rate / risk_free_basis) + equity_premium. LEGACY-TOLERANT:
// events written BEFORE the F.2 anchor swap carried the retired 10y-Treasury shape
// (ten_year_treasury / ten_year_treasury_basis); those must still project — the legacy Treasury figure maps
// into risk_free_rate / risk_free_basis so old dossiers keep rendering a discount provenance (append-only
// replay must never throw or drop the field).
// ---------------------------------------------------------------------------

const RC = 'rc_discount_proj'

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
    payload: {
      research_case_id: RC,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      valuation,
    },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — F.2 discount provenance', () => {
  it('projects the F.2 risk_free_rate / risk_free_basis (compliant savings) shape', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        discount_rate: 0.085,
        discount_inputs: { risk_free_rate: 0.03, risk_free_basis: 'compliant_savings', equity_premium: 0.055 },
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.discount_inputs?.risk_free_rate).toBeCloseTo(0.03, 10)
    expect(rc.valuation?.discount_inputs?.risk_free_basis).toBe('compliant_savings')
    expect(rc.valuation?.discount_inputs?.equity_premium).toBe(0.055)
  })

  it('projects the config_default basis when failed closed to savings_rate_default', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        discount_rate: 0.075,
        discount_inputs: { risk_free_rate: 0.02, risk_free_basis: 'config_default', equity_premium: 0.055 },
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.valuation?.discount_inputs?.risk_free_basis).toBe('config_default')
    expect(rc.valuation?.discount_inputs?.risk_free_rate).toBeCloseTo(0.02, 10)
  })

  it('legacy-tolerant: a pre-F.2 event carrying the retired ten_year_treasury shape still projects', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        discount_rate: 0.10,
        // The retired Treasury-anchor shape (pre-F.2). Replay must NOT throw and must NOT drop the field.
        discount_inputs: { ten_year_treasury: 0.045, ten_year_treasury_basis: 'config_default', equity_premium: 0.055 },
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    // The legacy Treasury figure maps into the F.2 risk_free fields so old dossiers still render provenance.
    expect(rc.valuation?.discount_inputs?.risk_free_rate).toBeCloseTo(0.045, 10)
    expect(rc.valuation?.discount_inputs?.risk_free_basis).toBe('config_default')
    expect(rc.valuation?.discount_inputs?.equity_premium).toBe(0.055)
    // The rest of the case still projects (replay did not throw).
    expect(rc.investment_verdict).toBe('WATCH')
  })
})
