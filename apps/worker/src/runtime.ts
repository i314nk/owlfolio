import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

import { type EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectCommandCenterSummary } from '@owlfolio/ledger/projections/commandCenterProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import {
  projectAaoifiDividendPurificationCalculations,
  type AaoifiDividendPurificationCalculation,
} from '@owlfolio/ledger/projections/purificationProjection'
import { projectScheduledTasks, type ScheduledTaskProjection } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectPendingResearchRuns } from '@owlfolio/ledger/projections/researchRunQueueProjection'
import {
  getProviderCatalog,
  redactProviderDiagnostic,
  runProviderTask,
  type CertificationReport,
  type CertificationTarget,
  type Provider,
  type ProviderAuthMode,
  type ProviderRunResult,
  type ProviderRuntimeKind,
  type ProviderSurfaceId,
  type ProviderVendorId,
  type ProviderWorkflowRole,
} from '@owlfolio/providers'
import { defaultDemoAppConfig, type AppConfig } from '@owlfolio/shared'
import { draftHoldingReview } from '@owlfolio/workflow/holdingReviewWorkflow'
import { resolveCurrentPrice, type PriceSource } from '@owlfolio/workflow/marketData'
import { runStrategyResearchSwarm, type GroundFn } from '@owlfolio/workflow/researchSwarm'
import { groundProposedSources, groundProposedSourcesDeterministic } from '@owlfolio/workflow/sourceGrounding'

export type WorkerRuntimeEnv = {
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_LEDGER_PATH?: string
  OWLFOLIO_SOURCE_LEDGER_PATH?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
}

export type WorkerRuntimePathsOptions = {
  cwd?: string
  env?: WorkerRuntimeEnv
}

export type WorkerRuntimePaths = {
  project_dir: string
  config_path: string
  ledger_path: string
  source_ledger_path: string
  provider_certification_dir: string
  config: AppConfig
}

export type ProviderExecutionReadiness = {
  provider_id: string
  is_ready: boolean
  status_label: string
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
}

export type WorkerClock = {
  now?: () => string
}

export type DefineDefaultScheduledTasksOptions = WorkerClock

export type RunScheduledTasksOptions = WorkerClock & {
  as_of?: string
  dry_run?: boolean
  task_kind?: string
  provider?: Provider
  provider_readiness?: ProviderExecutionReadiness
  provider_model_id?: string
  run_id?: (task: ScheduledTaskProjection) => string
  priceSource?: PriceSource
}

export type RunScheduledTasksResult = {
  considered: number
  completed: number
  failed: number
  skipped: number
  events_appended: number
  summaries: string[]
}

type TaskResult = {
  result_summary: string
  observations: string[]
  provider_run_ids?: string[]
  proposal_event_ids?: string[]
  approval_gates?: string[]
  human_approval_required?: boolean
  events_appended?: number
  missing_data_holding_ids?: string[]
}

type TaskHandlerOptions = RunScheduledTasksOptions & {
  scheduled_task_run_id: string
}

type ScheduledTaskPayload = {
  scheduled_task_id: string
  task_kind: string
  cadence: string
  enabled: boolean
  dry_run: true
  retry_policy: { max_attempts: number; retry_delay_ms: number }
  timeout_ms?: number
  max_cost_usd?: number
  safety: {
    mock_safe: true
    auto_approve_investment_actions: false
    auto_approve_portfolio_actions: false
  }
}

const WORKER_ACTOR_ID = 'owlfolio-worker'
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000
const HOLDING_REVIEW_TIMEOUT_MS = 120_000
const HOLDING_REVIEW_MAX_COST_USD = 0.25
const HOLDING_REVIEW_APPROVAL_GATE = 'holding_review_requires_user_confirmation'
const OPEN_HOLDING_APPROVAL_GATE = 'open_holding_requires_user_confirmation'
const PURIFICATION_PAYMENT_APPROVAL_GATE = 'purification_payment_requires_user_confirmation'

function nowIso(): string {
  return new Date().toISOString()
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function previousQuarterEndDate(now: string): string {
  const date = new Date(now)
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 0)).toISOString().slice(0, 10)
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function resolveProjectRootFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, '') || cwd
  let current = normalized
  const { root } = parse(normalized)

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (current === root) {
      return normalized
    }

    const parent = dirname(current)
    if (parent === current) {
      return normalized
    }

    current = parent
  }
}

function resolveConfigPath(projectDir: string, env: WorkerRuntimeEnv): string {
  if (env.OWLFOLIO_APP_CONFIG_PATH !== undefined && env.OWLFOLIO_APP_CONFIG_PATH.length > 0) {
    return env.OWLFOLIO_APP_CONFIG_PATH
  }

  return join(projectDir, 'data', 'app-config.json')
}

async function loadConfig(configPath: string): Promise<AppConfig> {
  if (!existsSync(configPath)) {
    return defaultDemoAppConfig()
  }

  return JSON.parse(await readFile(configPath, 'utf8')) as AppConfig
}

export async function resolveWorkerRuntimePaths({
  cwd = process.cwd(),
  env = process.env as WorkerRuntimeEnv,
}: WorkerRuntimePathsOptions = {}): Promise<WorkerRuntimePaths> {
  const projectDir = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  const configPath = resolveConfigPath(projectDir, env)
  const config = await loadConfig(configPath)
  const ledgerPath = env.OWLFOLIO_LEDGER_PATH
    ?? config.ledger_path
    ?? join(projectDir, 'data', 'owlfolio-ledger.sqlite')
  const sourceLedgerPath = env.OWLFOLIO_SOURCE_LEDGER_PATH
    ?? config.source_ledger_path
    ?? join(projectDir, 'data', 'source-ledger')
  const providerCertificationDir = env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
    ?? join(projectDir, 'data', 'provider-certifications')

  await mkdir(dirname(ledgerPath), { recursive: true })
  await mkdir(sourceLedgerPath, { recursive: true })
  await mkdir(providerCertificationDir, { recursive: true })

  return {
    project_dir: projectDir,
    config_path: configPath,
    ledger_path: ledgerPath,
    source_ledger_path: sourceLedgerPath,
    provider_certification_dir: providerCertificationDir,
    config,
  }
}

export async function resolveWorkerProviderReadiness({
  provider_id,
  provider_certification_dir,
  provider_model_id,
}: {
  provider_id: string
  provider_certification_dir: string
  provider_model_id?: string
}): Promise<ProviderExecutionReadiness> {
  const provider = getProviderCatalog().find((entry) => entry.provider_id === provider_id)
  if (provider === undefined) {
    return {
      provider_id,
      is_ready: false,
      status_label: `Unknown provider ${provider_id}; scheduled workflow execution is blocked`,
    }
  }

  const expectedTarget: CertificationTarget = {
    provider_surface_id: provider.provider_surface_id,
    vendor_id: provider.vendor_id,
    runtime_kind: provider.runtime_kind,
    auth_mode: provider.auth_mode,
    model_id: provider_model_id ?? provider.default_model_id,
    workflow_role: 'scheduled_monitoring_dry_run',
    schema_version: 1,
  }
  const report = await readLatestCertificationReport(provider_certification_dir, provider_id)
  const reportTarget = report?.target
  const target = reportTarget ?? expectedTarget
  const base = {
    provider_id,
    provider_surface_id: target.provider_surface_id,
    vendor_id: target.vendor_id,
    runtime_kind: target.runtime_kind,
    auth_mode: target.auth_mode,
    workflow_role: target.workflow_role,
  }

  if (!provider.automation.scheduled_workflow_supported) {
    return {
      ...base,
      is_ready: false,
      status_label: `${provider.label} is not certified for scheduled workflows (${provider.automation.automation_suitability})`,
    }
  }

  if (report === undefined && provider.auth_mode !== 'built_in_demo') {
    return {
      ...base,
      is_ready: false,
      status_label: `No certification report found for ${provider.label}; scheduled provider execution is blocked until current readiness is certified`,
    }
  }

  if (report !== undefined && report.run_status !== 'completed') {
    return {
      ...base,
      is_ready: false,
      status_label: redactProviderDiagnostic(report.not_run_reason ?? report.summary ?? `certification run status is ${report.run_status}`),
    }
  }

  if (report?.support_level === 'unsupported') {
    return {
      ...base,
      is_ready: false,
      status_label: redactProviderDiagnostic(report.not_run_reason ?? report.summary),
    }
  }

  if (report !== undefined && reportTarget === undefined && provider.auth_mode !== 'built_in_demo') {
    return {
      ...base,
      is_ready: false,
      status_label: `${provider.label} certification report is missing target metadata; scheduled provider execution is blocked until target-specific certification is recorded`,
    }
  }

  if (report !== undefined && reportTarget !== undefined) {
    const mismatchedFields = certificationTargetMismatches(reportTarget, expectedTarget)
    if (mismatchedFields.length > 0) {
      return {
        ...base,
        is_ready: false,
        status_label: `${provider.label} certification target mismatch for ${mismatchedFields.join(', ')}; expected workflow_role scheduled_monitoring_dry_run and matching provider surface/auth/runtime/model before scheduled provider execution is blocked`,
      }
    }
  }

  return {
    ...base,
    is_ready: true,
    status_label: report === undefined ? `${provider.label} uses built-in demo execution.` : report.summary,
  }
}

function certificationTargetMismatches(actual: CertificationTarget, expected: CertificationTarget): string[] {
  const fields: (keyof Pick<CertificationTarget,
    'provider_surface_id' | 'vendor_id' | 'runtime_kind' | 'auth_mode' | 'model_id' | 'workflow_role'
  >)[] = ['provider_surface_id', 'vendor_id', 'runtime_kind', 'auth_mode', 'model_id', 'workflow_role']

  return fields.filter((field) => actual[field] !== expected[field])
}

async function readLatestCertificationReport(
  providerCertificationDir: string,
  providerId: string,
): Promise<CertificationReport | undefined> {
  try {
    return JSON.parse(await readFile(join(providerCertificationDir, `${providerId}.latest.json`), 'utf8')) as CertificationReport
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function assertProviderReadyForExecution(provider: Provider, readiness: ProviderExecutionReadiness | undefined): void {
  if (readiness === undefined) {
    throw new Error(`Provider ${provider.provider_id} is not ready: provider readiness was not checked`)
  }
  if (readiness.provider_id !== provider.provider_id) {
    throw new Error(`Provider ${provider.provider_id} is not ready: readiness was checked for ${readiness.provider_id}`)
  }
  if (!readiness.is_ready) {
    throw new Error(`Provider ${provider.provider_id} is not ready: ${readiness.status_label}`)
  }
}

function scheduledTaskEvent<TPayload extends Record<string, unknown>>(
  eventType: 'scheduled_task_defined' | 'scheduled_task_run_started' | 'scheduled_task_run_completed' | 'scheduled_task_run_failed',
  scheduledTaskId: string,
  payload: TPayload,
  createdAt: string,
  options: {
    event_id: string
    actor_type: LedgerEventEnvelope<unknown>['actor_type']
    actor_id: string
    causation_id?: string
    correlation_id?: string
    idempotency_key?: string
  },
): LedgerEventEnvelope<TPayload> {
  return {
    event_id: options.event_id,
    event_type: eventType,
    aggregate_type: 'scheduled_task',
    aggregate_id: scheduledTaskId,
    ...(options.causation_id === undefined ? {} : { causation_id: options.causation_id }),
    ...(options.correlation_id === undefined ? {} : { correlation_id: options.correlation_id }),
    ...(options.idempotency_key === undefined ? {} : { idempotency_key: options.idempotency_key }),
    actor_type: options.actor_type,
    actor_id: options.actor_id,
    payload,
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function providerRunEvent<TPayload extends Record<string, unknown>>(
  eventType: 'provider_run_started' | 'provider_run_completed' | 'provider_run_failed',
  providerRunId: string,
  payload: TPayload,
  createdAt: string,
  options: {
    event_id: string
    actor_type: LedgerEventEnvelope<unknown>['actor_type']
    actor_id: string
    causation_id?: string
    correlation_id?: string
    idempotency_key?: string
  },
): LedgerEventEnvelope<TPayload> {
  return {
    event_id: options.event_id,
    event_type: eventType,
    aggregate_type: 'provider_run',
    aggregate_id: providerRunId,
    ...(options.causation_id === undefined ? {} : { causation_id: options.causation_id }),
    ...(options.correlation_id === undefined ? {} : { correlation_id: options.correlation_id }),
    ...(options.idempotency_key === undefined ? {} : { idempotency_key: options.idempotency_key }),
    actor_type: options.actor_type,
    actor_id: options.actor_id,
    payload,
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function defaultTaskDefinitions(): ScheduledTaskPayload[] {
  return [
    {
      scheduled_task_id: 'task_review_reminders_daily',
      task_kind: 'review_reminder',
      cadence: '0 8 * * 1-5',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      scheduled_task_id: 'task_watchlist_monitor_daily',
      task_kind: 'watchlist_monitor',
      cadence: '0 9 * * 1-5',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      scheduled_task_id: 'task_holding_review_drafts_daily',
      task_kind: 'holding_review_draft',
      cadence: '0 10 * * 1-5',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      timeout_ms: HOLDING_REVIEW_TIMEOUT_MS,
      max_cost_usd: HOLDING_REVIEW_MAX_COST_USD,
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      scheduled_task_id: 'task_portfolio_valuation_refresh_daily',
      task_kind: 'portfolio_valuation_refresh',
      cadence: '0 7 * * 1-5',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      scheduled_task_id: 'task_purification_projection_quarterly',
      task_kind: 'purification_projection',
      cadence: '0 6 1 */3 *',
      enabled: true,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
  ]
}

export async function defineDefaultScheduledTasks(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  { now = nowIso }: DefineDefaultScheduledTasksOptions = {},
): Promise<LedgerEventEnvelope<unknown>[]> {
  const createdAt = now()
  const events: LedgerEventEnvelope<unknown>[] = []

  for (const payload of defaultTaskDefinitions()) {
    const event = scheduledTaskEvent(
      'scheduled_task_defined',
      payload.scheduled_task_id,
      payload,
      createdAt,
      {
        event_id: `evt_scheduled_task_defined_${payload.scheduled_task_id}`,
        actor_type: 'user',
        actor_id: 'system-defaults',
        idempotency_key: `scheduled-task-definition:${payload.scheduled_task_id}:v1`,
      },
    )
    events.push(await store.append(event as LedgerEventEnvelope<unknown>))
  }

  return events
}

function runIdFor(task: ScheduledTaskProjection, now: string): string {
  return `run_${task.scheduled_task_id}_${now.replace(/[^0-9]/g, '').slice(0, 14)}`
}

function labelForWatchlistItem(item: ReturnType<typeof projectWatchlist>[number]): string {
  return item.ticker ?? item.company_id ?? item.watchlist_item_id
}

async function runReviewReminderTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: RunScheduledTasksOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const asOf = options.as_of ?? currentDate()
  const summary = projectCommandCenterSummary(events, { as_of: asOf })
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const confirmedWatchlistItems = projectWatchlist(events).filter(
    (item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id),
  )
  const duePrompts = summary.holding_review_prompts.filter((prompt) => prompt.status === 'due')
  const upcomingPrompts = summary.holding_review_prompts.filter((prompt) => prompt.status === 'upcoming')
  const observations = [
    ...duePrompts.map((prompt) => `holding ${prompt.label} is due for review`),
    ...upcomingPrompts.map((prompt) => `holding ${prompt.label} review is upcoming on ${prompt.next_review_at}`),
    ...confirmedWatchlistItems.map((item) => `watchlist ${labelForWatchlistItem(item)} should be reviewed for buy-zone/thesis changes; opening a holding requires user approval`),
  ]

  return {
    result_summary: `review_reminder dry-run: ${duePrompts.length} due holding review(s), ${upcomingPrompts.length} upcoming holding review(s), ${confirmedWatchlistItems.length} confirmed watchlist review reminder(s); no investment action taken`,
    observations,
    approval_gates: [HOLDING_REVIEW_APPROVAL_GATE, OPEN_HOLDING_APPROVAL_GATE],
    human_approval_required: observations.length > 0,
  }
}

function providerRunIdFor(scheduledTaskRunId: string, watchlistItemId: string): string {
  return `provider_${scheduledTaskRunId}_${watchlistItemId}`
}

function providerExecutionMetadata(readiness: ProviderExecutionReadiness | undefined): Partial<Pick<ProviderExecutionReadiness,
  'provider_surface_id' | 'vendor_id' | 'runtime_kind' | 'auth_mode' | 'workflow_role'
>> {
  if (readiness === undefined) {
    return {}
  }

  return {
    ...(readiness.provider_surface_id === undefined ? {} : { provider_surface_id: readiness.provider_surface_id }),
    ...(readiness.vendor_id === undefined ? {} : { vendor_id: readiness.vendor_id }),
    ...(readiness.runtime_kind === undefined ? {} : { runtime_kind: readiness.runtime_kind }),
    ...(readiness.auth_mode === undefined ? {} : { auth_mode: readiness.auth_mode }),
    ...(readiness.workflow_role === undefined ? {} : { workflow_role: readiness.workflow_role }),
  }
}

function buildWatchlistMonitorPrompt(item: ReturnType<typeof projectWatchlist>[number]): string {
  const label = labelForWatchlistItem(item)
  return [
    `Review ticker ${label} for Owlfolio watchlist monitoring.`,
    'Assess buy-zone, thesis drift, valuation status, and material source updates.',
    'Do not recommend or execute any portfolio action without explicit human approval.',
  ].join(' ')
}

async function appendProviderRun(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  provider: Provider,
  item: ReturnType<typeof projectWatchlist>[number],
  options: TaskHandlerOptions,
): Promise<ProviderRunResult> {
  const providerRunId = providerRunIdFor(options.scheduled_task_run_id, item.watchlist_item_id)
  const modelId = options.provider_model_id ?? 'mock-buffett-munger-monitor'
  const providerMetadata = providerExecutionMetadata(options.provider_readiness)
  const startedAt = options.now?.() ?? nowIso()
  const request = {
    run_id: providerRunId,
    provider_id: provider.provider_id,
    ...providerMetadata,
    model_id: modelId,
    task_kind: 'tool-loop' as const,
    prompt: buildWatchlistMonitorPrompt(item),
    timeout_ms: 120_000,
    budget: { max_tool_calls: 3, max_tokens: 1_200 },
    tool_allowlist: ['source.fetch'],
    response_format: { kind: 'text' as const },
  }

  await store.append(providerRunEvent(
    'provider_run_started',
    providerRunId,
    {
      provider_run_id: providerRunId,
      provider_id: provider.provider_id,
      ...providerMetadata,
      model_id: modelId,
      task_kind: request.task_kind,
      watchlist_item_id: item.watchlist_item_id,
      started_at: startedAt,
      dry_run: true,
    },
    startedAt,
    {
      event_id: `evt_provider_run_started_${providerRunId}`,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: `provider-run:${providerRunId}:started`,
    },
  ) as LedgerEventEnvelope<unknown>)

  try {
    const providerResult = await runProviderTask(provider, request)
    const completedAt = options.now?.() ?? nowIso()
    await store.append(providerRunEvent(
      'provider_run_completed',
      providerRunId,
      {
        provider_run_id: providerRunId,
        provider_id: provider.provider_id,
        ...providerMetadata,
        model_id: modelId,
        watchlist_item_id: item.watchlist_item_id,
        completed_at: completedAt,
        finish_reason: providerResult.finish_reason,
        observations: providerResult.observations.map((observation) => observation.message),
        tool_call_count: providerResult.tool_calls.length,
        approval_gates: [OPEN_HOLDING_APPROVAL_GATE],
        human_approval_required: true,
        auto_approved_actions: 0,
        dry_run: true,
      },
      completedAt,
      {
        event_id: `evt_provider_run_completed_${providerRunId}`,
        actor_type: 'provider',
        actor_id: provider.provider_id,
        causation_id: `evt_provider_run_started_${providerRunId}`,
        correlation_id: options.scheduled_task_run_id,
        idempotency_key: `provider-run:${providerRunId}:completed`,
      },
    ) as LedgerEventEnvelope<unknown>)
    return providerResult
  } catch (error) {
    const failedAt = options.now?.() ?? nowIso()
    await store.append(providerRunEvent(
      'provider_run_failed',
      providerRunId,
      {
        provider_run_id: providerRunId,
        provider_id: provider.provider_id,
        ...providerMetadata,
        model_id: modelId,
        watchlist_item_id: item.watchlist_item_id,
        failed_at: failedAt,
        error_summary: redactProviderDiagnostic(error),
        approval_gates: [OPEN_HOLDING_APPROVAL_GATE],
        human_approval_required: true,
        auto_approved_actions: 0,
        dry_run: true,
      },
      failedAt,
      {
        event_id: `evt_provider_run_failed_${providerRunId}`,
        actor_type: 'provider',
        actor_id: provider.provider_id,
        causation_id: `evt_provider_run_started_${providerRunId}`,
        correlation_id: options.scheduled_task_run_id,
        idempotency_key: `provider-run:${providerRunId}:failed`,
      },
    ) as LedgerEventEnvelope<unknown>)
    throw error
  }
}

async function runWatchlistMonitorTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const confirmedWatchlistItems = projectWatchlist(events).filter(
    (item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id),
  )
  const observations = confirmedWatchlistItems.map(
    (item) => `${labelForWatchlistItem(item)} remains on the confirmed watchlist for mock-safe monitoring`,
  )
  const providerRunIds: string[] = []
  let providerEventsAppended = 0

  if (options.provider !== undefined) {
    assertProviderReadyForExecution(options.provider, options.provider_readiness)
    for (const item of confirmedWatchlistItems) {
      const providerResult = await appendProviderRun(store, options.provider, item, options)
      const providerRunId = providerRunIdFor(options.scheduled_task_run_id, item.watchlist_item_id)
      providerRunIds.push(providerRunId)
      providerEventsAppended += 2
      observations.push(`${labelForWatchlistItem(item)} provider monitor completed with ${providerResult.tool_calls.length} source tool call(s); portfolio action requires user approval`)
    }
  }

  return {
    result_summary: `watchlist_monitor dry-run: ${confirmedWatchlistItems.length} confirmed watchlist item(s) monitored; no buy/sell/portfolio action taken`,
    observations,
    ...(providerRunIds.length === 0 ? {} : { provider_run_ids: providerRunIds }),
    approval_gates: [OPEN_HOLDING_APPROVAL_GATE],
    human_approval_required: confirmedWatchlistItems.length > 0,
    events_appended: providerEventsAppended,
  }
}

function reviewIdFor(holdingId: string, asOf: string): string {
  return `review_${holdingId}_${asOf.replace(/[^0-9]/g, '')}`
}

async function runHoldingReviewDraftTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  if (options.provider === undefined || options.provider_readiness === undefined) {
    throw new Error('holding_review_draft requires a certified provider readiness check before creating proposal events')
  }
  assertProviderReadyForExecution(options.provider, options.provider_readiness)

  const events = await store.list()
  const asOf = options.as_of ?? currentDate()
  const dueHoldings = projectHoldings(events).filter((holding) => {
    if (holding.pending_review_id !== undefined) {
      return false
    }
    return holding.next_review_at !== undefined && holding.next_review_at <= asOf
  })
  const proposalEventIds: string[] = []
  const observations: string[] = []
  const modelId = options.provider_model_id ?? 'mock-buffett-munger-monitor'

  for (const holding of dueHoldings) {
    const draft = await draftHoldingReview(store, options.provider, {
      holding_id: holding.holding_id,
      review_id: reviewIdFor(holding.holding_id, asOf),
      model_id: modelId,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      idempotency_key: `holding-review-draft:${holding.holding_id}:${asOf}`,
    })
    proposalEventIds.push(draft.event_id)
    observations.push(`${holding.ticker ?? holding.company_id ?? holding.holding_id} holding review draft proposal created; confirmation requires user approval`)
  }

  return {
    result_summary: `holding_review_draft dry-run: ${proposalEventIds.length} holding review draft proposal(s) created; no holding review confirmation or portfolio action taken`,
    observations,
    ...(proposalEventIds.length === 0 ? {} : { proposal_event_ids: proposalEventIds }),
    approval_gates: [HOLDING_REVIEW_APPROVAL_GATE],
    human_approval_required: proposalEventIds.length > 0,
    events_appended: proposalEventIds.length,
  }
}

function normalizeTicker(ticker: string | undefined): string | undefined {
  const normalized = ticker?.trim().toUpperCase()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function valuationSnapshotId(holdingId: string, asOf: string): string {
  return `scheduled_${holdingId}_${asOf.replace(/[^0-9]/g, '')}`
}

async function runPortfolioValuationRefreshTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const holdings = projectHoldings(events)
  const asOf = options.as_of ?? currentDate()
  const checkedAt = options.now?.() ?? nowIso()
  const observations: string[] = []
  const missingDataHoldingIds: string[] = []
  const existingValuationKeys = new Set(events.map((event) => event.idempotency_key).filter((key): key is string => key !== undefined))
  let refreshed = 0

  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker)
    if (ticker === undefined) {
      missingDataHoldingIds.push(holding.holding_id)
      observations.push(`${holding.company_id ?? holding.holding_id}: no ticker; manual valuation required`)
      continue
    }

    // TODO: thread exchange/market from holding intake
    const quote = await resolveCurrentPrice({ ticker }, undefined, options.priceSource)

    if (!quote.available) {
      missingDataHoldingIds.push(holding.holding_id)
      observations.push(`${ticker}: no auto price (manual valuation required) — ${quote.reason}`)
      continue
    }

    const valuationSource = quote.source
    const valuationKey = `holding-valuation:${holding.holding_id}:${asOf}:${valuationSource}`
    if (existingValuationKeys.has(valuationKey)) {
      observations.push(`${ticker} valuation already refreshed from ${valuationSource} for ${asOf}; no duplicate valuation event appended`)
      continue
    }

    const snapshotId = valuationSnapshotId(holding.holding_id, asOf)
    const marketValue = roundMoney(quote.price_per_share * holding.shares)
    await store.append({
      event_id: `evt_holding_valuation_recorded_${snapshotId}`,
      event_type: 'holding_valuation_recorded',
      aggregate_type: 'holding',
      aggregate_id: holding.holding_id,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: valuationKey,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        snapshot_id: snapshotId,
        holding_id: holding.holding_id,
        price_per_share: quote.price_per_share,
        shares: holding.shares,
        market_value: marketValue,
        currency: holding.currency,
        valued_at: asOf,
        valuation_source: valuationSource,
        price_checked_at: quote.as_of,
        confidence: 'market',
        caveat: 'Live market close from Stooq',
        missing_data: [],
        valued_by_actor_type: 'worker',
        valued_by_actor_id: WORKER_ACTOR_ID,
      },
      source_ids: [`${valuationSource}:${ticker}:${quote.as_of}`],
      created_at: checkedAt,
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    existingValuationKeys.add(valuationKey)
    refreshed += 1
    observations.push(`${ticker} valuation refreshed from ${valuationSource} at $${quote.price_per_share.toFixed(2)}; factual valuation update only`)
  }

  return {
    result_summary: `portfolio_valuation_refresh dry-run: refreshed ${refreshed} holding valuation(s), ${missingDataHoldingIds.length} holding(s) missing price data; no investment decision or portfolio action taken`,
    observations,
    approval_gates: [],
    human_approval_required: false,
    events_appended: refreshed,
    missing_data_holding_ids: missingDataHoldingIds,
  }
}

function purificationObligationId(calculation: AaoifiDividendPurificationCalculation): string {
  return `purify_${calculation.calculation_id}`
}

function purificationObligationEventId(calculation: AaoifiDividendPurificationCalculation): string {
  return `evt_purification_obligation_recorded_${purificationObligationId(calculation)}`
}

async function runPurificationProjectionTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const calculatedAt = options.now?.() ?? nowIso()
  const asOf = options.as_of ?? previousQuarterEndDate(calculatedAt)
  const projection = projectAaoifiDividendPurificationCalculations(events, { as_of: asOf, calculated_at: calculatedAt })
  const existingKeys = new Set(events.map((event) => event.idempotency_key).filter((key): key is string => key !== undefined))
  const observations: string[] = []
  let appended = 0

  for (const calculation of projection.calculations) {
    const idempotencyKey = `purification-obligation:${calculation.calculation_id}`
    if (existingKeys.has(idempotencyKey)) {
      observations.push(`${calculation.holding_id} purification calculation ${calculation.calculation_id} already projected; no duplicate obligation appended`)
      continue
    }

    const obligationId = purificationObligationId(calculation)
    await store.append({
      event_id: purificationObligationEventId(calculation),
      event_type: 'purification_obligation_recorded',
      aggregate_type: 'purification_entry',
      aggregate_id: obligationId,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: idempotencyKey,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        obligation_id: obligationId,
        calculation_id: calculation.calculation_id,
        holding_id: calculation.holding_id,
        ...(calculation.company_id === undefined ? {} : { company_id: calculation.company_id }),
        ...(calculation.ticker === undefined ? {} : { ticker: calculation.ticker }),
        ...(calculation.company_name === undefined ? {} : { company_name: calculation.company_name }),
        amount: calculation.purification_amount,
        purification_amount: calculation.purification_amount,
        currency: calculation.currency,
        period_start: calculation.period_start,
        period_end: calculation.period_end,
        policy_basis: calculation.policy_basis,
        policy_version: calculation.policy_version,
        ...(calculation.standard_reference === undefined ? {} : { standard_reference: calculation.standard_reference }),
        calculation_method: calculation.calculation_method,
        reason: 'AAOIFI dividend non-compliant income purification estimate; payment requires explicit user confirmation.',
        shariah_evaluation_id: calculation.shariah_evaluation_id,
        dividend_event_id: calculation.dividend_event_id,
        dividend_id: calculation.dividend_id,
        dividend_income_amount: calculation.dividend_income_amount,
        non_compliant_income_ratio: calculation.non_compliant_income_ratio,
        impurity_rate: calculation.purification_ratio,
        purification_ratio: calculation.purification_ratio,
        holding_period_basis: calculation.holding_period_basis,
        source_filing_period_start: calculation.source_filing_period_start,
        source_filing_period_end: calculation.source_filing_period_end,
        ...(calculation.source_filing_type === undefined ? {} : { source_filing_type: calculation.source_filing_type }),
        ...(calculation.source_filing_date === undefined ? {} : { source_filing_date: calculation.source_filing_date }),
        ...(calculation.evidence_summary === undefined ? {} : { evidence_summary: calculation.evidence_summary }),
        policy_source_ids: calculation.policy_source_ids,
        source_ids: calculation.source_ids,
        caveats: calculation.caveats,
        calculated_at: calculation.calculated_at,
        next_calculation_at: calculation.next_calculation_at,
        requires_user_confirmation: calculation.requires_user_confirmation,
        requires_scholar_review: calculation.requires_scholar_review,
      },
      source_ids: calculation.source_ids,
      created_at: calculatedAt,
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    existingKeys.add(idempotencyKey)
    appended += 1
    observations.push(`${calculation.ticker ?? calculation.holding_id} purification obligation ${obligationId} projected from dividend ${calculation.dividend_id}; payment requires user confirmation`)
  }

  for (const pending of projection.pending) {
    observations.push(`${pending.holding_id ?? pending.dividend_id ?? pending.dividend_event_id ?? 'dividend'} purification calculation pending evidence: ${pending.missing_evidence.join(', ')}`)
  }

  return {
    result_summary: `purification_projection dry-run: calculated ${appended} estimated purification obligation(s), ${projection.pending.length} pending dividend(s) need evidence; no payment or resolution marked`,
    observations,
    approval_gates: appended > 0 || projection.pending.length > 0 ? [PURIFICATION_PAYMENT_APPROVAL_GATE] : [],
    human_approval_required: appended > 0 || projection.pending.length > 0,
    events_appended: appended,
  }
}

async function runTaskHandler(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  task: ScheduledTaskProjection,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  if (task.task_kind === 'review_reminder') {
    return runReviewReminderTask(store, options)
  }

  if (task.task_kind === 'watchlist_monitor') {
    return runWatchlistMonitorTask(store, options)
  }

  if (task.task_kind === 'holding_review_draft') {
    return runHoldingReviewDraftTask(store, options)
  }

  if (task.task_kind === 'portfolio_valuation_refresh') {
    return runPortfolioValuationRefreshTask(store, options)
  }

  if (task.task_kind === 'purification_projection') {
    return runPurificationProjectionTask(store, options)
  }

  throw new Error(`Unsupported scheduled task kind: ${task.task_kind}`)
}

function retryDelayMs(task: ScheduledTaskProjection): number {
  return task.retry_policy?.retry_delay_ms ?? DEFAULT_RETRY_DELAY_MS
}

function maxAttempts(task: ScheduledTaskProjection): number {
  return task.retry_policy?.max_attempts ?? task.max_attempts ?? 1
}

function retryAfter(failedAt: string, task: ScheduledTaskProjection): string | undefined {
  const attempt = task.failure_count + 1
  const max = maxAttempts(task)
  if (attempt >= max) {
    return undefined
  }

  return new Date(new Date(failedAt).getTime() + retryDelayMs(task)).toISOString()
}

function retrySkipReason(task: ScheduledTaskProjection, now: string): string | undefined {
  if (task.last_run_status !== 'failed') {
    return undefined
  }

  const max = maxAttempts(task)
  if (task.failure_count >= max) {
    return `${task.scheduled_task_id} skipped: retry attempts exhausted after ${task.failure_count} failure(s)`
  }

  if (task.retry_after !== undefined && new Date(now).getTime() < new Date(task.retry_after).getTime()) {
    return `${task.scheduled_task_id} skipped: retry opens at ${task.retry_after}`
  }

  return undefined
}

function latestQuarterlyCadenceDueAt(now: string, taskDefinedAt: string): string | undefined {
  const nowDate = new Date(now)
  const definedDate = new Date(taskDefinedAt)
  if (!Number.isFinite(nowDate.getTime()) || !Number.isFinite(definedDate.getTime())) {
    return undefined
  }

  const currentQuarterMonth = Math.floor(nowDate.getUTCMonth() / 3) * 3
  const currentQuarterRun = new Date(Date.UTC(nowDate.getUTCFullYear(), currentQuarterMonth, 1, 6))
  const candidate = nowDate.getTime() >= currentQuarterRun.getTime()
    ? currentQuarterRun
    : new Date(Date.UTC(nowDate.getUTCFullYear(), currentQuarterMonth - 3, 1, 6))

  if (candidate.getTime() < definedDate.getTime()) {
    return undefined
  }

  return candidate.toISOString()
}

function cadenceSkipReason(task: ScheduledTaskProjection, now: string, explicitlyRequested: boolean): string | undefined {
  if (explicitlyRequested) {
    return undefined
  }

  if (task.task_kind === 'purification_projection' && task.cadence === '0 6 1 */3 *') {
    const dueAt = latestQuarterlyCadenceDueAt(now, task.updated_at)
    const lastCompletedAt = task.last_completed_at === undefined ? undefined : new Date(task.last_completed_at)
    if (dueAt === undefined || (lastCompletedAt !== undefined && Number.isFinite(lastCompletedAt.getTime()) && lastCompletedAt.getTime() >= new Date(dueAt).getTime())) {
      return `${task.scheduled_task_id} skipped: not due until quarterly cadence ${task.cadence}`
    }
  }

  return undefined
}

export async function runProcessResearchQueueTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: {
    provider: Provider
    source_ledger_path: string
    ground?: GroundFn
    now?: () => Date
  },
): Promise<{ processed: number; failed: number; summaries: string[] }> {
  const now = options.now ?? (() => new Date())
  const events = await store.list()
  const pending = projectPendingResearchRuns(events as LedgerEventEnvelope<Record<string, unknown>>[])
  // Cast: groundProposedSources/groundProposedSourcesDeterministic accept `ProposedSource[]`
  // (with exactOptionalPropertyTypes), while GroundFn is typed over z.infer<ProposedSourcesSchema>
  // which infers `citation_locator?: string | undefined`. The runtime shapes are identical.
  const ground: GroundFn = options.ground ?? (
    options.provider.provider_id === 'mock-provider'
      ? groundProposedSourcesDeterministic as unknown as GroundFn
      : groundProposedSources as unknown as GroundFn
  )
  const summaries: string[] = []
  let failed = 0

  for (const run of pending) {
    const claimedAt = now().toISOString()
    const claimedEvent = await store.append({
      event_id: `evt_research_run_claimed_${run.research_case_id}`,
      event_type: 'research_run_claimed',
      aggregate_type: 'research_case',
      aggregate_id: run.research_case_id,
      causation_id: run.requested_event_id,
      correlation_id: run.research_case_id,
      idempotency_key: `research-run-claim:${run.research_case_id}:v1`,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        research_case_id: run.research_case_id,
        run_id: `run_${run.research_case_id}`,
        claimed_at: claimedAt,
        worker_id: WORKER_ACTOR_ID,
      },
      source_ids: [],
      created_at: claimedAt,
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)

    try {
      await runStrategyResearchSwarm(
        store,
        options.provider,
        {
          research_case_id: run.research_case_id,
          company_id: run.company_id ?? `company_${run.ticker.toLowerCase()}`,
          ticker: run.ticker,
          strategy_id: run.strategy_id ?? 'buffett-munger',
          actor_id: 'user_local',
          idempotency_key: `swarm:${run.research_case_id}:v1`,
          model_id: run.model_id ?? 'mock',
          decision_id: run.decision_id ?? `decision_${run.research_case_id}`,
          source_ledger_path: options.source_ledger_path,
        },
        { ground },
      )

      summaries.push(`process_research_queue: ran swarm for ${run.ticker} (${run.research_case_id}); decision draft created; no investment action taken`)
    } catch (error) {
      // The run was already claimed above and stays claimed (no auto-retry).
      // A re-run requires a new research_run_requested event; this is acceptable
      // for the alpha — fail-closed real providers are the common case.
      const failedAt = now().toISOString()
      await store.append({
        event_id: `evt_research_run_failed_${run.research_case_id}`,
        event_type: 'research_run_failed',
        aggregate_type: 'research_case',
        aggregate_id: run.research_case_id,
        causation_id: claimedEvent.event_id,
        correlation_id: run.research_case_id,
        idempotency_key: `research-run-failed:${run.research_case_id}:v1`,
        actor_type: 'worker',
        actor_id: WORKER_ACTOR_ID,
        payload: {
          research_case_id: run.research_case_id,
          run_id: `run_${run.research_case_id}`,
          failed_at: failedAt,
          error_summary: (error as Error).message.slice(0, 500),
        },
        source_ids: [],
        created_at: failedAt,
        schema_version: 1,
      } satisfies LedgerEventEnvelope<Record<string, unknown>>)
      failed += 1
      summaries.push(`process_research_queue: swarm failed for ${run.ticker} (${run.research_case_id}): ${(error as Error).message.slice(0, 200)}`)
      // Do NOT rethrow — one failed run must not abort the remaining pending runs.
    }
  }

  return { processed: pending.length, failed, summaries }
}

export async function runScheduledTasks(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: RunScheduledTasksOptions = {},
): Promise<RunScheduledTasksResult> {
  const dryRun = options.dry_run ?? true
  const eventsBefore = await store.list()
  const tasks = projectScheduledTasks(eventsBefore).filter(
    (task) => task.enabled && (options.task_kind === undefined || task.task_kind === options.task_kind),
  )
  const result: RunScheduledTasksResult = {
    considered: tasks.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    events_appended: 0,
    summaries: [],
  }

  for (const task of tasks) {
    const startedAt = options.now?.() ?? nowIso()
    const retryReason = retrySkipReason(task, startedAt)
    if (retryReason !== undefined) {
      result.skipped += 1
      result.summaries.push(retryReason)
      continue
    }

    const cadenceReason = cadenceSkipReason(task, startedAt, options.task_kind !== undefined)
    if (cadenceReason !== undefined) {
      result.skipped += 1
      result.summaries.push(cadenceReason)
      continue
    }

    if (!dryRun || !task.dry_run) {
      result.skipped += 1
      result.summaries.push(`${task.scheduled_task_id} skipped: worker currently allows only dry-run scheduled tasks`)
      continue
    }

    const runId = options.run_id?.(task) ?? runIdFor(task, startedAt)
    const attempt = task.failure_count + 1
    await store.append(scheduledTaskEvent(
      'scheduled_task_run_started',
      task.scheduled_task_id,
      {
        scheduled_task_id: task.scheduled_task_id,
        run_id: runId,
        started_at: startedAt,
        attempt,
        ...(task.timeout_ms === undefined ? {} : { timeout_ms: task.timeout_ms }),
        ...(task.max_cost_usd === undefined ? {} : { max_cost_usd: task.max_cost_usd }),
        dry_run: true,
      },
      startedAt,
      {
        event_id: `evt_scheduled_task_run_started_${runId}`,
        actor_type: 'worker',
        actor_id: WORKER_ACTOR_ID,
        correlation_id: task.scheduled_task_id,
        idempotency_key: `scheduled-task-run:${runId}:started`,
      },
    ) as LedgerEventEnvelope<unknown>)
    result.events_appended += 1

    try {
      const taskResult = await runTaskHandler(store, task, { ...options, scheduled_task_run_id: runId })
      const completedAt = options.now?.() ?? nowIso()
      await store.append(scheduledTaskEvent(
        'scheduled_task_run_completed',
        task.scheduled_task_id,
        {
          scheduled_task_id: task.scheduled_task_id,
          run_id: runId,
          completed_at: completedAt,
          result_summary: taskResult.result_summary,
          observations: taskResult.observations,
          ...(taskResult.provider_run_ids === undefined ? {} : { provider_run_ids: taskResult.provider_run_ids }),
          ...(taskResult.proposal_event_ids === undefined ? {} : { proposal_event_ids: taskResult.proposal_event_ids }),
          ...(taskResult.approval_gates === undefined ? {} : { approval_gates: taskResult.approval_gates }),
          ...(taskResult.missing_data_holding_ids === undefined ? {} : { missing_data_holding_ids: taskResult.missing_data_holding_ids }),
          human_approval_required: taskResult.human_approval_required ?? false,
          auto_approved_actions: 0,
          dry_run: true,
        },
        completedAt,
        {
          event_id: `evt_scheduled_task_run_completed_${runId}`,
          actor_type: 'worker',
          actor_id: WORKER_ACTOR_ID,
          causation_id: `evt_scheduled_task_run_started_${runId}`,
          correlation_id: task.scheduled_task_id,
          idempotency_key: `scheduled-task-run:${runId}:completed`,
        },
      ) as LedgerEventEnvelope<unknown>)
      result.completed += 1
      result.events_appended += 1 + (taskResult.events_appended ?? 0)
      result.summaries.push(taskResult.result_summary)
    } catch (error) {
      const failedAt = options.now?.() ?? nowIso()
      const retryAt = retryAfter(failedAt, task)
      await store.append(scheduledTaskEvent(
        'scheduled_task_run_failed',
        task.scheduled_task_id,
        {
          scheduled_task_id: task.scheduled_task_id,
          run_id: runId,
          failed_at: failedAt,
          error_summary: redactProviderDiagnostic(error),
          attempt,
          max_attempts: maxAttempts(task),
          ...(retryAt === undefined ? {} : { retry_after: retryAt }),
          dry_run: true,
        },
        failedAt,
        {
          event_id: `evt_scheduled_task_run_failed_${runId}`,
          actor_type: 'worker',
          actor_id: WORKER_ACTOR_ID,
          causation_id: `evt_scheduled_task_run_started_${runId}`,
          correlation_id: task.scheduled_task_id,
          idempotency_key: `scheduled-task-run:${runId}:failed`,
        },
      ) as LedgerEventEnvelope<unknown>)
      result.failed += 1
      result.events_appended += 1
      result.summaries.push(redactProviderDiagnostic(error))
    }
  }

  return result
}
