import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ScheduledTaskKind = 'review_reminder' | 'watchlist_monitor' | string
export type ScheduledTaskRunStatus = 'never_run' | 'running' | 'completed' | 'failed'

export type ScheduledTaskProjection = {
  scheduled_task_id: string
  task_kind: ScheduledTaskKind
  cadence: string
  enabled: boolean
  dry_run: boolean
  retry_policy?: { max_attempts?: number; retry_delay_ms?: number }
  last_run_id?: string
  last_run_status: ScheduledTaskRunStatus
  last_started_at?: string
  last_completed_at?: string
  last_failed_at?: string
  last_result_summary?: string
  last_error_summary?: string
  last_observations?: string[]
  last_provider_run_ids?: string[]
  approval_gates?: string[]
  human_approval_required?: boolean
  auto_approved_actions?: number
  attempt?: number
  max_attempts?: number
  retry_after?: string
  failure_count: number
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined
  }

  return [...value]
}

function getRetryPolicy(payload: Record<string, unknown>): { max_attempts?: number; retry_delay_ms?: number } | undefined {
  const retryPolicy = payload.retry_policy
  if (!isRecord(retryPolicy)) {
    return undefined
  }

  const maxAttempts = getNumber(retryPolicy, 'max_attempts')
  const retryDelayMs = getNumber(retryPolicy, 'retry_delay_ms')
  return {
    ...(maxAttempts === undefined ? {} : { max_attempts: maxAttempts }),
    ...(retryDelayMs === undefined ? {} : { retry_delay_ms: retryDelayMs }),
  }
}

function newTaskFromDefinition(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): ScheduledTaskProjection | undefined {
  const scheduledTaskId = getString(payload, 'scheduled_task_id') ?? event.aggregate_id
  const taskKind = getString(payload, 'task_kind')
  const cadence = getString(payload, 'cadence')
  if (taskKind === undefined || cadence === undefined) {
    return undefined
  }

  const task: ScheduledTaskProjection = {
    scheduled_task_id: scheduledTaskId,
    task_kind: taskKind,
    cadence,
    enabled: getBoolean(payload, 'enabled') ?? true,
    dry_run: getBoolean(payload, 'dry_run') ?? true,
    last_run_status: 'never_run',
    failure_count: 0,
    updated_at: event.created_at,
  }
  const retryPolicy = getRetryPolicy(payload)
  if (retryPolicy !== undefined) {
    task.retry_policy = retryPolicy
  }
  return task
}

function ensureTask(
  tasks: Map<string, ScheduledTaskProjection>,
  event: LedgerEventEnvelope<unknown>,
  payload: Record<string, unknown>,
): ScheduledTaskProjection | undefined {
  const scheduledTaskId = getString(payload, 'scheduled_task_id') ?? event.aggregate_id
  const existing = tasks.get(scheduledTaskId)
  if (existing !== undefined) {
    return existing
  }

  const taskKind = getString(payload, 'task_kind') ?? 'unknown'
  const task: ScheduledTaskProjection = {
    scheduled_task_id: scheduledTaskId,
    task_kind: taskKind,
    cadence: getString(payload, 'cadence') ?? 'manual',
    enabled: true,
    dry_run: getBoolean(payload, 'dry_run') ?? true,
    last_run_status: 'never_run',
    failure_count: 0,
    updated_at: event.created_at,
  }
  tasks.set(scheduledTaskId, task)
  return task
}

function applyDefinition(task: ScheduledTaskProjection, event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): void {
  task.task_kind = getString(payload, 'task_kind') ?? task.task_kind
  task.cadence = getString(payload, 'cadence') ?? task.cadence
  task.enabled = getBoolean(payload, 'enabled') ?? task.enabled
  task.dry_run = getBoolean(payload, 'dry_run') ?? task.dry_run
  const retryPolicy = getRetryPolicy(payload)
  if (retryPolicy !== undefined) {
    task.retry_policy = retryPolicy
  }
  task.updated_at = event.created_at
}

function applyStarted(task: ScheduledTaskProjection, event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): void {
  const runId = getString(payload, 'run_id')
  if (runId !== undefined) {
    task.last_run_id = runId
  }
  task.last_run_status = 'running'
  task.last_started_at = getString(payload, 'started_at') ?? event.created_at
  const attempt = getNumber(payload, 'attempt')
  if (attempt !== undefined) {
    task.attempt = attempt
  }
  task.dry_run = getBoolean(payload, 'dry_run') ?? task.dry_run
  delete task.retry_after
  delete task.last_provider_run_ids
  delete task.approval_gates
  delete task.human_approval_required
  task.updated_at = event.created_at
}

function applyCompleted(task: ScheduledTaskProjection, event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): void {
  const runId = getString(payload, 'run_id')
  if (runId !== undefined) {
    task.last_run_id = runId
  }
  task.last_run_status = 'completed'
  task.last_completed_at = getString(payload, 'completed_at') ?? event.created_at
  const resultSummary = getString(payload, 'result_summary')
  if (resultSummary !== undefined) {
    task.last_result_summary = resultSummary
  }
  const observations = getStringArray(payload, 'observations')
  if (observations !== undefined) {
    task.last_observations = observations
  }
  const providerRunIds = getStringArray(payload, 'provider_run_ids')
  if (providerRunIds !== undefined) {
    task.last_provider_run_ids = providerRunIds
  }
  const approvalGates = getStringArray(payload, 'approval_gates')
  if (approvalGates !== undefined) {
    task.approval_gates = approvalGates
  }
  const humanApprovalRequired = getBoolean(payload, 'human_approval_required')
  if (humanApprovalRequired !== undefined) {
    task.human_approval_required = humanApprovalRequired
  }
  const autoApprovedActions = getNumber(payload, 'auto_approved_actions')
  if (autoApprovedActions !== undefined) {
    task.auto_approved_actions = autoApprovedActions
  }
  task.failure_count = 0
  delete task.attempt
  delete task.max_attempts
  delete task.last_error_summary
  delete task.last_failed_at
  delete task.retry_after
  task.updated_at = event.created_at
}

function applyFailed(task: ScheduledTaskProjection, event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): void {
  const runId = getString(payload, 'run_id')
  if (runId !== undefined) {
    task.last_run_id = runId
  }
  task.last_run_status = 'failed'
  task.last_failed_at = getString(payload, 'failed_at') ?? event.created_at
  const errorSummary = getString(payload, 'error_summary')
  if (errorSummary !== undefined) {
    task.last_error_summary = errorSummary
  }
  const attempt = getNumber(payload, 'attempt')
  if (attempt !== undefined) {
    task.attempt = attempt
  }
  const maxAttempts = getNumber(payload, 'max_attempts')
  if (maxAttempts !== undefined) {
    task.max_attempts = maxAttempts
  }
  const retryAfter = getString(payload, 'retry_after')
  if (retryAfter !== undefined) {
    task.retry_after = retryAfter
  } else {
    delete task.retry_after
  }
  task.failure_count += 1
  task.updated_at = event.created_at
}

export function projectScheduledTasks(events: LedgerEventEnvelope<unknown>[]): ScheduledTaskProjection[] {
  const tasks = new Map<string, ScheduledTaskProjection>()

  for (const event of events) {
    if (event.aggregate_type !== 'scheduled_task' || !isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'scheduled_task_defined') {
      const defined = newTaskFromDefinition(event, event.payload)
      if (defined === undefined) {
        continue
      }

      const existing = tasks.get(defined.scheduled_task_id)
      if (existing === undefined) {
        tasks.set(defined.scheduled_task_id, defined)
      } else {
        applyDefinition(existing, event, event.payload)
      }
      continue
    }

    const task = ensureTask(tasks, event, event.payload)
    if (task === undefined) {
      continue
    }

    if (event.event_type === 'scheduled_task_run_started') {
      applyStarted(task, event, event.payload)
    }
    if (event.event_type === 'scheduled_task_run_completed') {
      applyCompleted(task, event, event.payload)
    }
    if (event.event_type === 'scheduled_task_run_failed') {
      applyFailed(task, event, event.payload)
    }
  }

  return [...tasks.values()]
}
