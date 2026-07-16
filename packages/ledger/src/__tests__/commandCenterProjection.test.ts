import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import type { CommandCenterApprovalQueueItem } from '../projections/commandCenterProjection'
import { priorityRank, projectCommandCenterSummary } from '../projections/commandCenterProjection'

function makeQueueItem(
  overrides: Partial<CommandCenterApprovalQueueItem> & Pick<CommandCenterApprovalQueueItem, 'id' | 'decision_type'>,
): CommandCenterApprovalQueueItem {
  return {
    group_label: 'group',
    title: overrides.id,
    actor_label: 'provider',
    href: '/',
    audit_event_id: overrides.id,
    source_ids: [],
    before_summary: 'before',
    after_summary: 'after',
    shariah_impact: 'PASS — allowed.',
    accounting_impact: 'none',
    ...overrides,
  }
}

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
      next_recommended_action: 'COST is a legacy unconfirmed watchlist draft — re-admit from research',
      recent_activity: [
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
        { event_id: 'evt_analysis', label: 'buffett_munger_analysis_drafted by provider:mock-provider' },
        { event_id: 'evt_created', label: 'research_case_created by user:user_local' },
      ],
      approval_queue: [
        {
          id: 'watchlist:wl_cost_001',
          decision_type: 'watchlist_confirmation',
          group_label: 'Watchlist confirmations',
          title: 'COST watchlist draft',
          actor_label: 'user:user_local',
          target_label: 'COST',
          href: '/watchlist#wl_cost_001',
          audit_event_id: 'evt_watchlist',
          source_ids: ['src_cost_10k_2025'],
          before_summary: 'COST is not user-confirmed for monitoring yet.',
          after_summary: 'Confirm COST as a user-approved watchlist item before worker monitoring or portfolio actions.',
          shariah_impact: 'Shariah gate decision pending.',
          accounting_impact: 'No accounting or holding state changes until a user opens a holding.',
          approve_action_label: 'Legacy unconfirmed draft — re-admit from research',
        },
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

  it('moves from confirmed watchlist monitoring to the held-thesis prompt after a user records the initial holding', () => {
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
      next_recommended_action: 'Check in held names against new filings (quarterly cadence)',
      recent_activity: [
        { event_id: 'evt_holding_opened', label: 'holding_opened by user:user_local' },
        { event_id: 'evt_watchlist_confirmed', label: 'watchlist_draft_confirmed by user:user_local' },
        { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
      ],
    })
  })

  it('adds worker proposals that require human approval without counting auto-approved actions', () => {
    const summary = projectCommandCenterSummary([
      ...events,
      {
        event_id: 'evt_worker_run_completed',
        event_type: 'scheduled_task_run_completed',
        aggregate_type: 'scheduled_task',
        aggregate_id: 'task_watchlist_monitor',
        actor_type: 'worker',
        actor_id: 'watchlist-monitor',
        payload: {
          scheduled_task_id: 'task_watchlist_monitor',
          task_kind: 'watchlist_monitor',
          run_id: 'run_watchlist_monitor_001',
          result_summary: 'watchlist_monitor dry-run: 1 confirmed watchlist item monitored; no buy/sell/portfolio action taken',
          observations: ['COST remains in watchlist monitor queue'],
          provider_run_ids: ['provider_run_watchlist_001'],
          approval_gates: ['open_holding_requires_user_confirmation'],
          human_approval_required: true,
          auto_approved_actions: 0,
        },
        source_ids: ['evt_watchlist'],
        created_at: '2026-05-28T00:20:00.000Z',
        schema_version: 1,
      },
    ])

    expect(summary.approval_queue).toContainEqual(expect.objectContaining({
      id: 'worker:task_watchlist_monitor:run_watchlist_monitor_001',
      decision_type: 'worker_proposal',
      group_label: 'Worker proposals',
      title: 'watchlist_monitor worker proposal',
      actor_label: 'worker:watchlist-monitor',
      href: '/audit?event_id=evt_worker_run_completed#evt_worker_run_completed',
      audit_event_id: 'evt_worker_run_completed',
      source_ids: ['evt_watchlist'],
      provider_run_ids: ['provider_run_watchlist_001'],
      before_summary: 'Worker dry-run did not change portfolio, watchlist, accounting, or trading state.',
      after_summary: 'watchlist_monitor dry-run: 1 confirmed watchlist item monitored; no buy/sell/portfolio action taken',
      shariah_impact: 'Approval gates: open_holding_requires_user_confirmation.',
      accounting_impact: 'Auto-approved actions recorded by the worker: 0.',
    }))
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

describe('priorityRank', () => {
  it('ranks blocking Shariah gates above confirmations and reminders (review items retired)', () => {
    const blockingGate = makeQueueItem({ id: 'gate', decision_type: 'watchlist_confirmation', shariah_impact: 'HARAM — blocked.' })
    const pendingGate = makeQueueItem({ id: 'pending-gate', decision_type: 'watchlist_confirmation', shariah_impact: 'Shariah gate decision pending.' })
    const confirmation = makeQueueItem({ id: 'confirm', decision_type: 'watchlist_confirmation', shariah_impact: 'PASS — allowed.' })
    const legacyReview = makeQueueItem({ id: 'review', decision_type: 'holding_review' })
    const reminder = makeQueueItem({ id: 'reminder', decision_type: 'worker_proposal' })

    expect(priorityRank(blockingGate)).toBe(1)
    expect(priorityRank(pendingGate)).toBe(1)
    expect(priorityRank(confirmation)).toBe(2)
    // REVIEW RETIRED (2026-07-14): no producer emits holding_review items; a legacy literal ranks informational.
    expect(priorityRank(legacyReview)).toBe(4)
    expect(priorityRank(reminder)).toBe(4)
  })

  it('sorts a mixed queue gates -> confirmations -> reminders (stable within a rank)', () => {
    const reminder = makeQueueItem({ id: 'reminder', decision_type: 'worker_proposal' })
    const confirmationA = makeQueueItem({ id: 'confirm-a', decision_type: 'watchlist_confirmation', shariah_impact: 'PASS — allowed.' })
    const confirmationB = makeQueueItem({ id: 'confirm-b', decision_type: 'watchlist_confirmation', shariah_impact: 'PASS — allowed.' })
    const gate = makeQueueItem({ id: 'gate', decision_type: 'watchlist_confirmation', shariah_impact: 'HARAM — blocked.' })

    const sorted = [reminder, confirmationA, confirmationB, gate]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => priorityRank(left.item) - priorityRank(right.item) || left.index - right.index)
      .map((entry) => entry.item.id)

    expect(sorted).toEqual(['gate', 'confirm-a', 'confirm-b', 'reminder'])
  })
})
