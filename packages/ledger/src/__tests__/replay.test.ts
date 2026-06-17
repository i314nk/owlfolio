import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'
import { projectWatchlist } from '../projections/watchlistProjection'

const events: LedgerEventEnvelope<unknown>[] = [
  { event_id: 'evt_001', event_type: 'research_case_created', aggregate_type: 'research_case', aggregate_id: 'rc_cost_001', actor_type: 'user', actor_id: 'user_local', payload: { company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger' }, source_ids: [], created_at: '2026-05-27T00:00:00.000Z', schema_version: 1 },
  { event_id: 'evt_002', event_type: 'buffett_munger_analysis_drafted', aggregate_type: 'research_case', aggregate_id: 'rc_cost_001', actor_type: 'provider', actor_id: 'mock-provider', payload: { investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', valuation_status: 'FAIR', next_required_action: 'Confirm watchlist draft after user review' }, source_ids: ['src_cost_10k_2025'], created_at: '2026-05-27T00:01:00.000Z', schema_version: 1 },
  { event_id: 'evt_003', event_type: 'decision_drafted', aggregate_type: 'decision', aggregate_id: 'decision_cost_watch_001', causation_id: 'evt_002', correlation_id: 'rc_cost_001', actor_type: 'system', payload: { research_case_id: 'rc_cost_001', decision: 'WATCH', user_approved: false, reason: 'High quality business, valuation not yet compelling enough for buy decision.' }, source_ids: ['src_cost_10k_2025'], created_at: '2026-05-27T00:02:00.000Z', schema_version: 1 },
  { event_id: 'evt_004', event_type: 'watchlist_draft_created', aggregate_type: 'watchlist_item', aggregate_id: 'watch_cost_001', causation_id: 'evt_003', correlation_id: 'rc_cost_001', actor_type: 'user', actor_id: 'user_local', payload: { research_case_id: 'rc_cost_001', company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', user_approved: false, thesis_summary: 'Durable quality compounder; wait for better margin of safety.' }, source_ids: ['src_cost_10k_2025'], created_at: '2026-05-27T00:03:00.000Z', schema_version: 1 },
]

describe('ledger replay projections', () => {
  it('rebuilds research and watchlist state from events only', () => {
    const researchCases = projectResearchCases(events)
    const watchlist = projectWatchlist(events)

    expect(researchCases).toHaveLength(1)
    expect(researchCases[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'watchlist_draft', investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', valuation_status: 'FAIR' })
    expect(watchlist).toHaveLength(1)
    expect(watchlist[0]).toMatchObject({ watchlist_item_id: 'watch_cost_001', research_case_id: 'rc_cost_001', ticker: 'COST', strategy_id: 'buffett-munger', user_approved: false })
  })

  it('projects the flag-only implied_exit_multiple sanity output from the valuation block', () => {
    const withExitMultiple: LedgerEventEnvelope<unknown>[] = [
      events[0]!,
      {
        event_id: 'evt_002b', event_type: 'buffett_munger_analysis_drafted', aggregate_type: 'research_case', aggregate_id: 'rc_cost_001',
        actor_type: 'provider', actor_id: 'mock-provider',
        payload: {
          investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', valuation_status: 'FAIR',
          next_required_action: 'Confirm watchlist draft after user review',
          valuation: { moat_class: 'wide', implied_exit_multiple: 21.4, sanity_flags: ['sanity_implied_exit_multiple_high: today\'s price implies an exit multiple of 21.4× owner-earnings'] },
        },
        source_ids: ['src_cost_10k_2025'], created_at: '2026-05-27T00:01:00.000Z', schema_version: 1,
      },
    ]
    const [rc] = projectResearchCases(withExitMultiple)
    expect(rc?.valuation?.implied_exit_multiple).toBe(21.4)
    expect((rc?.valuation?.sanity_flags ?? []).some((f) => /exit multiple/i.test(f))).toBe(true)
  })

  it('legacy-tolerant: an analysis event whose valuation block omits implied_exit_multiple still projects (field undefined)', () => {
    const legacy: LedgerEventEnvelope<unknown>[] = [
      events[0]!,
      {
        event_id: 'evt_002c', event_type: 'buffett_munger_analysis_drafted', aggregate_type: 'research_case', aggregate_id: 'rc_cost_001',
        actor_type: 'provider', actor_id: 'mock-provider',
        payload: {
          investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', valuation_status: 'FAIR',
          next_required_action: 'x',
          // Legacy valuation block: the sanity layer existed but predates implied_exit_multiple.
          valuation: { moat_class: 'wide', reference_fair_value: 200, in_buy_zone: false },
        },
        source_ids: [], created_at: '2026-05-27T00:01:00.000Z', schema_version: 1,
      },
    ]
    const [rc] = projectResearchCases(legacy)
    expect(rc?.valuation).toBeDefined()
    expect(rc?.valuation?.reference_fair_value).toBe(200)
    expect(rc?.valuation?.implied_exit_multiple).toBeUndefined()
  })
})
