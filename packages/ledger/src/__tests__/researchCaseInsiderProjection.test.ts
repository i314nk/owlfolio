import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Insider-transaction summary (Form 4, §3.3): the deterministic per-ticker summary computed during the
// deep dive is carried on the `buffett_munger_analysis_drafted` event and projected onto the case, so the
// dossier can render it model-independently. Legacy-tolerant: an analysis event WITHOUT it still projects.
// ---------------------------------------------------------------------------

const RC = 'rc_insider_proj'

function created(): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_created_${RC}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: RC, ticker: 'V', company_id: 'company_v' },
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
    payload: { research_case_id: RC, investment_verdict: 'WATCH', ...extra },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — insider Form 4 summary', () => {
  it('projects the insider summary (discretionary + mechanical + cluster) when present', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        insider_summary: {
          as_of: '2026-06-30',
          window_months: 12,
          discretionary_buy_shares: 0,
          discretionary_sell_shares: 169332,
          discretionary_buy_value: 0,
          discretionary_sell_value: 57279146.22,
          distinct_buyers: 0,
          distinct_sellers: 6,
          officer_director_sell_shares: 169332,
          ten_percent_owner_sell_shares: 0,
          mechanical_disposed_shares: 155970,
          cluster: { window_days: 90, discretionary_sell_count: 5, distinct_sellers: 2, net_sell_value: 24898270.67 },
          window_truncated: true,
        },
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.insider_summary).toBeDefined()
    expect(rc.insider_summary?.discretionary_sell_shares).toBe(169332)
    expect(rc.insider_summary?.distinct_sellers).toBe(6)
    expect(rc.insider_summary?.mechanical_disposed_shares).toBe(155970)
    expect(rc.insider_summary?.window_truncated).toBe(true)
    expect(rc.insider_summary?.cluster?.distinct_sellers).toBe(2)
    expect(rc.insider_summary?.cluster?.net_sell_value).toBe(24898270.67)
  })

  it('is undefined for an analysis event without an insider summary (legacy-tolerant)', () => {
    const cases = projectResearchCases([created(), analysisDrafted({})])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.insider_summary).toBeUndefined()
  })
})
