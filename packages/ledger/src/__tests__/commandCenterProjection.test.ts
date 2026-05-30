import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectCommandCenterSummary } from '../projections/commandCenterProjection'

const events: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_created',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-28T00:00:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_analysis',
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: 'rc_cost_001',
      investment_verdict: 'WATCH',
      strategy_compliance: 'PASS',
      shariah_status: 'PASS',
      valuation_status: 'FAIR',
      next_required_action: 'Review COST research case and confirm the watchlist draft',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:05:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_watchlist',
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'wl_cost_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      user_approved: false,
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-28T00:10:00.000Z',
    schema_version: 1,
  },
]

describe('projectCommandCenterSummary', () => {
  it('derives pipeline counts, next action, and recent activity from ledger events', () => {
    expect(projectCommandCenterSummary(events)).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 1,
        pending_user_actions: 1,
      },
      primary_research_case_id: 'rc_cost_001',
      next_recommended_action: 'Review COST research case and confirm the watchlist draft',
      recent_activity: [
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
        { event_id: 'evt_analysis', label: 'buffett_munger_analysis_drafted by provider:mock-provider' },
        { event_id: 'evt_created', label: 'research_case_created by user:user_local' },
      ],
    })
  })

  it('preserves unique event ids even when recent-activity labels repeat', () => {
    const repeated = projectCommandCenterSummary([
      ...events,
      {
        event_id: 'evt_created_again',
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_cost_002',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { ticker: 'MSFT', strategy_id: 'buffett-munger' },
        source_ids: [],
        created_at: '2026-05-28T00:11:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_created_third',
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_cost_003',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { ticker: 'GOOG', strategy_id: 'buffett-munger' },
        source_ids: [],
        created_at: '2026-05-28T00:12:00.000Z',
        schema_version: 1,
      },
    ])

    expect(repeated.recent_activity).toEqual([
      { event_id: 'evt_created_third', label: 'research_case_created by user:user_local' },
      { event_id: 'evt_created_again', label: 'research_case_created by user:user_local' },
      { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
    ])
  })
})
