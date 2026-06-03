import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectScheduledTasks } from '../projections/scheduledTaskProjection'

function event(
  event_type: string,
  payload: Record<string, unknown>,
  overrides: Partial<LedgerEventEnvelope<Record<string, unknown>>> = {},
): LedgerEventEnvelope<Record<string, unknown>> {
  const scheduledTaskId = typeof payload.scheduled_task_id === 'string' ? payload.scheduled_task_id : 'task_review_reminders_daily'
  return {
    event_id: `evt_${event_type}_${payload.run_id ?? scheduledTaskId}`,
    event_type,
    aggregate_type: 'scheduled_task',
    aggregate_id: scheduledTaskId,
    actor_type: event_type === 'scheduled_task_defined' ? 'user' : 'worker',
    actor_id: event_type === 'scheduled_task_defined' ? 'user_local' : 'owlfolio-worker',
    payload,
    source_ids: [],
    created_at: '2026-06-01T08:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }
}

describe('projectScheduledTasks', () => {
  it('projects scheduled task definitions and the latest successful dry-run lifecycle', () => {
    const events = [
      event('scheduled_task_defined', {
        scheduled_task_id: 'task_review_reminders_daily',
        task_kind: 'review_reminder',
        cadence: '0 8 * * 1-5',
        enabled: true,
        dry_run: true,
      }),
      event('scheduled_task_run_started', {
        scheduled_task_id: 'task_review_reminders_daily',
        run_id: 'run_review_001',
        started_at: '2026-06-01T08:00:00.000Z',
        attempt: 1,
        dry_run: true,
      }),
      event('scheduled_task_run_completed', {
        scheduled_task_id: 'task_review_reminders_daily',
        run_id: 'run_review_001',
        completed_at: '2026-06-01T08:00:02.000Z',
        result_summary: 'review_reminder dry-run: 1 due review; no investment action taken',
        observations: ['holding COST is due for review'],
        provider_run_ids: ['provider_run_review_001_cost'],
        approval_gates: ['holding_review_requires_user_confirmation'],
        human_approval_required: true,
        auto_approved_actions: 0,
      }),
    ]

    expect(projectScheduledTasks(events)).toEqual([
      {
        scheduled_task_id: 'task_review_reminders_daily',
        task_kind: 'review_reminder',
        cadence: '0 8 * * 1-5',
        enabled: true,
        dry_run: true,
        last_run_id: 'run_review_001',
        last_run_status: 'completed',
        last_started_at: '2026-06-01T08:00:00.000Z',
        last_completed_at: '2026-06-01T08:00:02.000Z',
        last_result_summary: 'review_reminder dry-run: 1 due review; no investment action taken',
        last_observations: ['holding COST is due for review'],
        last_provider_run_ids: ['provider_run_review_001_cost'],
        approval_gates: ['holding_review_requires_user_confirmation'],
        human_approval_required: true,
        auto_approved_actions: 0,
        failure_count: 0,
        updated_at: '2026-06-01T08:00:00.000Z',
      },
    ])
  })

  it('surfaces retry metadata and failure summaries for failed runs', () => {
    const events = [
      event('scheduled_task_defined', {
        scheduled_task_id: 'task_watchlist_monitor_daily',
        task_kind: 'watchlist_monitor',
        cadence: '0 9 * * 1-5',
        enabled: true,
        dry_run: true,
        retry_policy: { max_attempts: 2 },
      }),
      event('scheduled_task_run_started', {
        scheduled_task_id: 'task_watchlist_monitor_daily',
        run_id: 'run_watchlist_001',
        started_at: '2026-06-01T09:00:00.000Z',
        attempt: 1,
        dry_run: true,
      }),
      event('scheduled_task_run_failed', {
        scheduled_task_id: 'task_watchlist_monitor_daily',
        run_id: 'run_watchlist_001',
        failed_at: '2026-06-01T09:00:01.000Z',
        error_summary: 'Unsupported scheduled task kind: experimental_live_trade',
        attempt: 1,
        max_attempts: 2,
        retry_after: '2026-06-01T09:05:01.000Z',
      }),
    ]

    expect(projectScheduledTasks(events)).toMatchObject([
      {
        scheduled_task_id: 'task_watchlist_monitor_daily',
        task_kind: 'watchlist_monitor',
        last_run_id: 'run_watchlist_001',
        last_run_status: 'failed',
        last_error_summary: 'Unsupported scheduled task kind: experimental_live_trade',
        last_failed_at: '2026-06-01T09:00:01.000Z',
        attempt: 1,
        max_attempts: 2,
        retry_after: '2026-06-01T09:05:01.000Z',
        failure_count: 1,
      },
    ])
  })

  it('clears stale retry metadata when a later run starts or exhausts attempts', () => {
    const events = [
      event('scheduled_task_defined', {
        scheduled_task_id: 'task_experimental_live_trade',
        task_kind: 'experimental_live_trade',
        cadence: '*/5 * * * *',
        enabled: true,
        dry_run: true,
        retry_policy: { max_attempts: 2 },
      }),
      event('scheduled_task_run_started', {
        scheduled_task_id: 'task_experimental_live_trade',
        run_id: 'run_unsupported_001',
        started_at: '2026-06-01T09:00:00.000Z',
        attempt: 1,
        dry_run: true,
      }),
      event('scheduled_task_run_failed', {
        scheduled_task_id: 'task_experimental_live_trade',
        run_id: 'run_unsupported_001',
        failed_at: '2026-06-01T09:00:01.000Z',
        error_summary: 'Unsupported scheduled task kind: experimental_live_trade',
        attempt: 1,
        max_attempts: 2,
        retry_after: '2026-06-01T09:05:01.000Z',
      }),
      event('scheduled_task_run_started', {
        scheduled_task_id: 'task_experimental_live_trade',
        run_id: 'run_unsupported_002',
        started_at: '2026-06-01T09:05:01.000Z',
        attempt: 2,
        dry_run: true,
      }),
      event('scheduled_task_run_failed', {
        scheduled_task_id: 'task_experimental_live_trade',
        run_id: 'run_unsupported_002',
        failed_at: '2026-06-01T09:05:02.000Z',
        error_summary: 'Unsupported scheduled task kind: experimental_live_trade',
        attempt: 2,
        max_attempts: 2,
      }),
    ]

    expect(projectScheduledTasks(events)[0]).toMatchObject({
      scheduled_task_id: 'task_experimental_live_trade',
      last_run_id: 'run_unsupported_002',
      last_run_status: 'failed',
      attempt: 2,
      max_attempts: 2,
      failure_count: 2,
    })
    expect(projectScheduledTasks(events)[0]).not.toHaveProperty('retry_after')
  })
})
