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
        confirmed_watchlist_items: 0,
        open_holdings: 0,
        pending_user_actions: 1,
      },
      primary_research_case_id: 'rc_cost_001',
      next_recommended_action: 'Review COST watchlist draft and confirm it',
      recent_activity: [
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
        { event_id: 'evt_analysis', label: 'buffett_munger_analysis_drafted by provider:mock-provider' },
        { event_id: 'evt_created', label: 'research_case_created by user:user_local' },
      ],
    })
  })

  it('moves from pending draft review to confirmed watchlist monitoring after user confirmation', () => {
    const confirmedEvents: LedgerEventEnvelope<unknown>[] = [
      ...events,
      {
        event_id: 'evt_watchlist_confirmed',
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'wl_cost_001',
        causation_id: 'evt_watchlist',
        correlation_id: 'rc_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          watchlist_item_id: 'wl_cost_001',
          research_case_id: 'rc_cost_001',
          user_approved: true,
          confirmed_by_actor_type: 'user',
          confirmed_by_actor_id: 'user_local',
        },
        source_ids: [],
        created_at: '2026-05-28T00:15:00.000Z',
        schema_version: 1,
      },
    ]

    expect(projectCommandCenterSummary(confirmedEvents)).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 1,
        open_holdings: 0,
        pending_user_actions: 0,
      },
      primary_research_case_id: 'rc_cost_001',
      next_recommended_action: 'Monitor confirmed watchlist items for buy-zone and thesis updates',
      recent_activity: [
        { event_id: 'evt_watchlist_confirmed', label: 'watchlist_draft_confirmed by user:user_local' },
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
        { event_id: 'evt_analysis', label: 'buffett_munger_analysis_drafted by provider:mock-provider' },
      ],
    })
  })

  it('moves from confirmed watchlist monitoring to holding review after a user records the initial holding', () => {
    const holdingEvents: LedgerEventEnvelope<unknown>[] = [
      ...events,
      {
        event_id: 'evt_watchlist_confirmed',
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'wl_cost_001',
        causation_id: 'evt_watchlist',
        correlation_id: 'rc_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          watchlist_item_id: 'wl_cost_001',
          research_case_id: 'rc_cost_001',
          user_approved: true,
          confirmed_by_actor_type: 'user',
          confirmed_by_actor_id: 'user_local',
        },
        source_ids: [],
        created_at: '2026-05-28T00:15:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_opened',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        causation_id: 'evt_watchlist_confirmed',
        correlation_id: 'rc_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          holding_id: 'holding_cost_001',
          watchlist_item_id: 'wl_cost_001',
          research_case_id: 'rc_cost_001',
          company_id: 'company_cost',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
          shares: 1,
          cost_basis_per_share: 0,
          currency: 'USD',
          opened_by_actor_type: 'user',
          opened_by_actor_id: 'user_local',
        },
        source_ids: [],
        created_at: '2026-05-28T00:20:00.000Z',
        schema_version: 1,
      },
    ]

    expect(projectCommandCenterSummary(holdingEvents)).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 0,
        open_holdings: 1,
        pending_user_actions: 0,
      },
      primary_research_case_id: 'rc_cost_001',
      next_recommended_action: 'Review opened holdings for thesis health and sizing',
      recent_activity: [
        { event_id: 'evt_holding_opened', label: 'holding_opened by user:user_local' },
        { event_id: 'evt_watchlist_confirmed', label: 'watchlist_draft_confirmed by user:user_local' },
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
      ],
    })
  })

  it('surfaces a pending provider-authored holding review draft for user confirmation', () => {
    const reviewEvents: LedgerEventEnvelope<unknown>[] = [
      ...events,
      {
        event_id: 'evt_watchlist_confirmed',
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'wl_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { watchlist_item_id: 'wl_cost_001', research_case_id: 'rc_cost_001', user_approved: true },
        source_ids: [],
        created_at: '2026-05-28T00:15:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_opened',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          holding_id: 'holding_cost_001',
          watchlist_item_id: 'wl_cost_001',
          research_case_id: 'rc_cost_001',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          shares: 1,
          cost_basis_per_share: 0,
          currency: 'USD',
          opened_at: '2026-05-28',
        },
        source_ids: [],
        created_at: '2026-05-28T00:20:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_review_drafted_review_cost_001',
        event_type: 'holding_review_drafted',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'provider',
        actor_id: 'mock-provider',
        payload: {
          review_id: 'review_cost_001',
          holding_id: 'holding_cost_001',
          research_case_id: 'rc_cost_001',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_health: 'HEALTHY',
          action_stance: 'HOLD',
          rationale: 'The thesis remains intact.',
          evidence_summary: 'Reviewed source ledger references.',
          uncertainty: 'Refresh after the next filing.',
          next_review_at: '2026-09-30',
          user_approved: false,
        },
        source_ids: ['src_cost_10k_2025'],
        created_at: '2026-05-28T00:25:00.000Z',
        schema_version: 1,
      },
    ]

    expect(projectCommandCenterSummary(reviewEvents)).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 0,
        open_holdings: 1,
        pending_user_actions: 1,
      },
      next_recommended_action: 'Confirm the drafted strategy review for COST',
    })
  })

  it('surfaces a due confirmed holding review as the next scheduled portfolio action', () => {
    const reviewScheduleEvents: LedgerEventEnvelope<unknown>[] = [
      {
        event_id: 'evt_created_due_review_case',
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_cost_due_review',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
        source_ids: [],
        created_at: '2026-05-28T00:00:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_opened_due_review',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_due_review',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          holding_id: 'holding_cost_due_review',
          watchlist_item_id: 'watch_cost_due_review',
          research_case_id: 'rc_cost_due_review',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          shares: 1,
          cost_basis_per_share: 812.4,
          currency: 'USD',
          opened_at: '2026-05-28',
        },
        source_ids: [],
        created_at: '2026-05-28T00:20:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_review_confirmed_due_review',
        event_type: 'holding_review_confirmed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_due_review',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          review_id: 'review_cost_due_review',
          holding_id: 'holding_cost_due_review',
          research_case_id: 'rc_cost_due_review',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_health: 'HEALTHY',
          action_stance: 'HOLD',
          rationale: 'Thesis remains intact.',
          evidence_summary: 'Reviewed source ledger references.',
          uncertainty: 'Refresh after the next filing.',
          next_review_at: '2026-09-30',
          user_approved: true,
        },
        source_ids: ['src_cost_10k_2025'],
        created_at: '2026-05-28T00:25:00.000Z',
        schema_version: 1,
      },
    ]

    expect(projectCommandCenterSummary(reviewScheduleEvents, { as_of: '2026-09-30' })).toMatchObject({
      pipeline_counts: {
        research_cases: 1,
        watchlist_drafts: 0,
        confirmed_watchlist_items: 0,
        open_holdings: 1,
        pending_user_actions: 0,
      },
      next_recommended_action: 'Run scheduled strategy review for COST (due 2026-09-30)',
      holding_review_prompts: [
        {
          holding_id: 'holding_cost_due_review',
          label: 'COST',
          next_review_at: '2026-09-30',
          status: 'due',
          days_until_review: 0,
        },
      ],
    })
  })

  it('surfaces an upcoming confirmed holding review without treating it as a pending user action', () => {
    const summary = projectCommandCenterSummary([
      {
        event_id: 'evt_holding_opened_upcoming_review',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_msft_upcoming_review',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          holding_id: 'holding_msft_upcoming_review',
          watchlist_item_id: 'watch_msft_upcoming_review',
          research_case_id: 'rc_msft_upcoming_review',
          ticker: 'MSFT',
          strategy_id: 'buffett-munger',
          shares: 3.25,
          cost_basis_per_share: 812.4,
          currency: 'USD',
          opened_at: '2026-05-31',
        },
        source_ids: [],
        created_at: '2026-05-31T00:20:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_review_overridden_upcoming_review',
        event_type: 'holding_review_overridden',
        aggregate_type: 'holding',
        aggregate_id: 'holding_msft_upcoming_review',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          review_id: 'review_msft_upcoming_review',
          holding_id: 'holding_msft_upcoming_review',
          research_case_id: 'rc_msft_upcoming_review',
          ticker: 'MSFT',
          strategy_id: 'buffett-munger',
          thesis_health: 'WATCH',
          action_stance: 'RESEARCH_MORE',
          rationale: 'User override: valuation requires another evidence pass before adding.',
          evidence_summary: 'Compared provider draft to the manual valuation snapshot and original thesis.',
          uncertainty: 'Need updated Shariah ratio review and concentration check.',
          next_review_at: '2026-10-31',
          user_approved: true,
          user_overrode_provider: true,
        },
        source_ids: ['src_msft_10k_2025'],
        created_at: '2026-05-31T00:25:00.000Z',
        schema_version: 1,
      },
    ], { as_of: '2026-05-31' })

    expect(summary.pipeline_counts.pending_user_actions).toBe(0)
    expect(summary.next_recommended_action).toBe('Next scheduled strategy review for MSFT is 2026-10-31')
    expect(summary.holding_review_prompts).toEqual([
      {
        holding_id: 'holding_msft_upcoming_review',
        label: 'MSFT',
        next_review_at: '2026-10-31',
        status: 'upcoming',
        days_until_review: 153,
      },
    ])
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
