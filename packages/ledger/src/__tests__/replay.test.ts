import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'
import { projectWatchlist } from '../projections/watchlistProjection'
import { projectPipeline } from '../projections/pipelineProjection'
import { projectResearchCaseTimeline } from '../projections/researchCaseTimelineProjection'

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

  // LEGACY-REPLAY: the calibration backtest loop (page, queue projection, run/universe events) was removed
  // as dead, closed-loop code, but old ledgers may still hold `calibration_run` / `calibration_universe_*`
  // events. The store does NOT enforce event types on read and the surviving general projections only key
  // off the event types they own, so these now-orphaned events must replay through them HARMLESSLY — never
  // throw and never leak into research/pipeline/timeline output. This guards against a future projection
  // assuming a closed event universe and choking on a legacy calibration event.
  it('legacy-replay: orphaned calibration events project clean through the surviving general projections', () => {
    const legacyCalibrationEvents: LedgerEventEnvelope<unknown>[] = [
      {
        event_id: 'evt_legacy_calib_run', event_type: 'calibration_run', aggregate_type: 'strategy', aggregate_id: 'buffett-munger',
        actor_type: 'worker', actor_id: 'worker_local',
        payload: { calibration_run_id: 'cal_2026_001', universe_version: 'v3', params_version: 7, summaries: [], coverage: [] },
        source_ids: [], created_at: '2026-05-27T00:05:00.000Z', schema_version: 1,
      },
      {
        event_id: 'evt_legacy_calib_member', event_type: 'calibration_universe_member_added', aggregate_type: 'strategy', aggregate_id: 'buffett-munger',
        actor_type: 'user', actor_id: 'user_local',
        payload: { ticker: 'KO', market: 'us', added_by: 'user_local' },
        source_ids: [], created_at: '2026-05-27T00:06:00.000Z', schema_version: 1,
      },
    ]
    // Interleave the orphaned calibration events with a real research-case slice.
    const mixed: LedgerEventEnvelope<unknown>[] = [...events, ...legacyCalibrationEvents]

    // None of the surviving general projections throws on the orphaned events, AND each produces output
    // IDENTICAL to the clean slice — proving the calibration events are ignored, not merely tolerated.
    expect(projectResearchCases(mixed)).toEqual(projectResearchCases(events))
    expect(projectWatchlist(mixed)).toEqual(projectWatchlist(events))
    // projectPipeline stamps a wall-clock `snapshot_at`; compare everything else.
    const { snapshot_at: _mixedAt, ...mixedPipeline } = projectPipeline(mixed)
    const { snapshot_at: _cleanAt, ...cleanPipeline } = projectPipeline(events)
    expect(mixedPipeline).toEqual(cleanPipeline)

    // And no calibration event leaks into the research-case audit timeline (one row per real, owned event).
    const timeline = projectResearchCaseTimeline(mixed, 'rc_cost_001')
    expect(timeline.some((entry) => entry.event_type.startsWith('calibration_'))).toBe(false)
    // Sanity: the real research-case state still rebuilds as expected from the mixed log.
    expect(projectResearchCases(mixed)).toHaveLength(1)
    expect(projectResearchCases(mixed)[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'watchlist_draft' })
  })
})
