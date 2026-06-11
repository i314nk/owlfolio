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
import {
  projectQuarterlyPurificationStatement,
  projectExitPurificationFinalizations,
} from '@owlfolio/ledger/projections/purificationStatement'
import { projectZakatStatement, type ZakatBaseMethod } from '@owlfolio/ledger/projections/zakatModule'
import { projectScheduledTasks, type ScheduledTaskProjection } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectForecasts, projectForecastCalibration } from '@owlfolio/ledger/projections/forecastCalibrationProjection'
import { projectPendingResearchRuns, projectPendingDeepDiveRuns } from '@owlfolio/ledger/projections/researchRunQueueProjection'
import { findLatestResearchCaseForTicker, projectResearchCases, type ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
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
import { defaultDemoAppConfig, mergeAutomationSettings, type AppConfig, type AutomationSettings } from '@owlfolio/shared'
import { draftHoldingReview, type ThesisHealth } from '@owlfolio/workflow/holdingReviewWorkflow'
import { resolveCurrentPrice, type PriceSource } from '@owlfolio/workflow/marketData'
import {
  evaluateWatchlistBuyWindow,
  evaluateTrancheTriggers,
  evaluateHoldingTranche,
  evaluateConcentration,
  evaluateAnnualRerun,
  evaluateShariahRescreen,
  evaluateShariahGrace,
  isGateClean,
  SHARIAH_GRACE_DAYS,
  type MonitorResearchCaseInput,
  type MonitorHoldingInput,
} from '@owlfolio/workflow/lifecycleMonitors'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { buildCalibrationRunEvent, type CalibrationNameSummary, type CalibrationCoverageSummary, type CalibrationTarget } from '@owlfolio/strategies/calibrationRunEvent'
import {
  loadCalibrationUniverse,
  runCalibrationBacktest,
  type CalibrationUniverse,
  type RunCalibrationBacktestDeps,
} from '@owlfolio/workflow'
import { projectPendingCalibrationRuns } from '@owlfolio/ledger/projections/calibrationRunQueueProjection'
import type { ShariahFinancialRatioInputs } from '@owlfolio/strategies/shariahFinancialRatios'
import { selectResearchCaseAction } from '@owlfolio/workflow/researchCasePolicy'
import { runStrategyResearchSwarm, runResearchDeepDivePhase, type GroundFn } from '@owlfolio/workflow/researchSwarm'
import { runDiscovery13f } from '@owlfolio/workflow/discovery13f'
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

export type DefineDefaultScheduledTasksOptions = WorkerClock & {
  automation?: AutomationSettings
}

/**
 * Injectable Shariah-ratio input source for the quarterly re-screen / grace monitors. Returns the AAOIFI
 * financial-ratio inputs (EDGAR fundamentals + 36-mo-avg market cap) for a ticker, or undefined when the
 * data is unavailable. Fail-closed + test-mode-gated: when no source is injected, the worker degrades to
 * an observation-only "no re-screen data" note and never fetches live EDGAR data on a tick.
 */
export type ShariahRatioSource = (args: { ticker: string }) => Promise<ShariahFinancialRatioInputs | undefined>

export type RunScheduledTasksOptions = WorkerClock & {
  as_of?: string
  dry_run?: boolean
  task_kind?: string
  provider?: Provider
  provider_readiness?: ProviderExecutionReadiness
  provider_model_id?: string
  run_id?: (task: ScheduledTaskProjection) => string
  priceSource?: PriceSource
  automation?: AutomationSettings
  /** Optional injectable Shariah-ratio source for the quarterly re-screen / grace monitors. */
  shariahRatioSource?: ShariahRatioSource
  /**
   * User-authored zakat methodology setting (lifecycle-spec-v3 Module 8). When provided, the quarterly
   * purification task also emits a read-only zakat statement observation at the ḥawl date. Methodology is a
   * SETTING the user authors — never an agent judgment. No auto-payment.
   */
  zakat?: {
    hawl_date: string
    currency?: string
    base_method?: ZakatBaseMethod
    net_current_assets?: number
    rate?: number
  }
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

/** thesis_health values that indicate the thesis is broken and warrant a full reanalysis */
const THESIS_BROKEN_HEALTH: ReadonlySet<ThesisHealth> = new Set<ThesisHealth>(['IMPAIRED', 'EXIT_CANDIDATE'])
const HOLDING_REVIEW_TIMEOUT_MS = 120_000
const HOLDING_REVIEW_MAX_COST_USD = 0.25
const HOLDING_REVIEW_APPROVAL_GATE = 'holding_review_requires_user_confirmation'
const OPEN_HOLDING_APPROVAL_GATE = 'open_holding_requires_user_confirmation'
const PURIFICATION_PAYMENT_APPROVAL_GATE = 'purification_payment_requires_user_confirmation'
const SELL_REVIEW_APPROVAL_GATE = 'sell_review_requires_user_authoring'
const WATCHLIST_REMOVAL_APPROVAL_GATE = 'watchlist_removal_requires_user_confirmation'

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

/** First day of the quarter that the given quarter-END date belongs to (for the purification statement). */
function quarterStartDateForEnd(quarterEnd: string): string {
  const date = new Date(`${quarterEnd}T00:00:00.000Z`)
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1)).toISOString().slice(0, 10)
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

// Concrete cron strings for each friendly cadence value.
// The daily/weekly expressions match the existing per-task defaults.
const CRON_DAILY_WATCHLIST = '0 9 * * 1-5'
const CRON_DAILY_HOLDING_REVIEW = '0 10 * * 1-5'
const CRON_DAILY_VALUATION = '0 7 * * 1-5'
const CRON_WEEKLY = '0 8 * * 1'
const CRON_MONTHLY = '0 6 1 * *'
const CRON_QUARTERLY = '0 6 1 */3 *'
const CRON_ANNUAL = '0 6 1 1 *'

type CadenceWithOff = 'off' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

/**
 * Maps a friendly cadence string to a cron expression and an enabled flag.
 * 'off' disables the task.  The `dailyCron` parameter lets each task keep its
 * own per-task daily schedule (e.g. watchlist at 09:00, valuation at 07:00).
 */
function cadenceToCron(cadence: CadenceWithOff, dailyCron: string): { enabled: boolean; cadence: string } {
  switch (cadence) {
    case 'off':
      return { enabled: false, cadence: dailyCron }
    case 'daily':
      return { enabled: true, cadence: dailyCron }
    case 'weekly':
      return { enabled: true, cadence: CRON_WEEKLY }
    case 'monthly':
      return { enabled: true, cadence: CRON_MONTHLY }
    case 'quarterly':
      return { enabled: true, cadence: CRON_QUARTERLY }
    case 'annual':
      return { enabled: true, cadence: CRON_ANNUAL }
  }
}

function defaultTaskDefinitions(automation?: AutomationSettings): ScheduledTaskPayload[] {
  const cfg = mergeAutomationSettings(automation)
  const watchlistCron = cadenceToCron(cfg.watchlist_monitoring.cadence, CRON_DAILY_WATCHLIST)
  // thesis_review drives holding_review_draft + review_reminder
  const thesisReviewCron = cadenceToCron(cfg.thesis_review.cadence, CRON_DAILY_HOLDING_REVIEW)
  // price_refresh drives portfolio_valuation_refresh (frequent market-price poll)
  const priceRefreshCron = cadenceToCron(cfg.price_refresh.cadence, CRON_DAILY_VALUATION)
  const purificationCron = cadenceToCron(cfg.purification.cadence, CRON_QUARTERLY)
  // TODO: annual reanalysis task (follow-up) — cfg.reanalysis drives the annual full-swarm; no worker task yet

  return [
    {
      scheduled_task_id: 'task_review_reminders_daily',
      task_kind: 'review_reminder',
      // review_reminder follows thesis_review cadence — it's the reminder counterpart
      cadence: thesisReviewCron.cadence,
      enabled: cfg.thesis_review.enabled && thesisReviewCron.enabled,
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
      cadence: watchlistCron.cadence,
      enabled: cfg.watchlist_monitoring.enabled && watchlistCron.enabled,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      // Holdings Monitor (lifecycle-spec-v3 Module 7) daily pass: tranche-review (T2/T3, thesis-gated),
      // >15% concentration trim-review, annual deep-re-run flag. Records holding_monitor_alert_recorded
      // OBSERVATIONS only — advisory, never an auto-trade/-trim/-advance. Follows the watchlist cadence.
      scheduled_task_id: 'task_holdings_monitor_daily',
      task_kind: 'holdings_monitor',
      cadence: watchlistCron.cadence,
      enabled: cfg.watchlist_monitoring.enabled && watchlistCron.enabled,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      // Quarterly Shariah financial-ratio re-screen (lifecycle-spec-v3 Module 6 + 7). Fail-closed: with
      // no injected Shariah-ratio source it emits an observation-only note and does NOT fetch live EDGAR
      // data. On a breach: watchlist FAIL → propose removal (draft); holding FAIL → 90-day grace; grace
      // expiry → DIVEST-REQUIRED draft. All human-gated; never an auto-removal/-exit/-advance.
      scheduled_task_id: 'task_shariah_rescreen_quarterly',
      task_kind: 'shariah_rescreen',
      cadence: purificationCron.cadence,
      enabled: cfg.purification.enabled && purificationCron.enabled,
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
      cadence: thesisReviewCron.cadence,
      enabled: cfg.thesis_review.enabled && thesisReviewCron.enabled,
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
      cadence: priceRefreshCron.cadence,
      enabled: cfg.price_refresh.enabled && priceRefreshCron.enabled,
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
      cadence: purificationCron.cadence,
      enabled: cfg.purification.enabled && purificationCron.enabled,
      dry_run: true,
      retry_policy: { max_attempts: 2, retry_delay_ms: DEFAULT_RETRY_DELAY_MS },
      safety: {
        mock_safe: true,
        auto_approve_investment_actions: false,
        auto_approve_portfolio_actions: false,
      },
    },
    {
      // Forecast resolution (lifecycle-spec-v3 Module 10 / judgment Mechanism 4). Annual cadence,
      // piggybacking the annual-report / re-run window. Surfaces DUE-but-unresolved forecasts as
      // observations; never fabricates an outcome (the human/EDGAR resolves true/false). Mock-safe.
      scheduled_task_id: 'task_forecast_resolution_annual',
      task_kind: 'forecast_resolution',
      cadence: CRON_ANNUAL,
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
      // Discovery Module 1 — 13F cloning (Pabrai engine). Quarterly cadence (~2 weeks after the 13F
      // deadline). Records source:'13f_clone' CANDIDATE observations; the human/quick-screen gates entry
      // to research. Disabled by default — opt-in via OWLFOLIO_DISCOVERY_13F_ENABLED to keep the alpha
      // dry-run/mock-safe and avoid live SEC fetches on every tick.
      scheduled_task_id: 'task_discovery_13f_quarterly',
      task_kind: 'discovery_13f',
      cadence: CRON_QUARTERLY,
      enabled: process.env['OWLFOLIO_DISCOVERY_13F_ENABLED'] === '1',
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
  { now = nowIso, automation }: DefineDefaultScheduledTasksOptions = {},
): Promise<LedgerEventEnvelope<unknown>[]> {
  const createdAt = now()
  const events: LedgerEventEnvelope<unknown>[] = []

  for (const payload of defaultTaskDefinitions(automation)) {
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

/**
 * Forecast-resolution task (lifecycle-spec-v3 Module 10 / judgment Mechanism 4).
 * Piggybacks the annual-report / re-run cadence — no new cron. T0-honest: it
 * surfaces which recorded forecasts are DUE (their resolution year has arrived)
 * but is NOT yet resolved, as OBSERVATIONS. It never fabricates a true/false
 * outcome — the human/EDGAR resolves the claim (a `forecast_resolved` event with
 * a real outcome), which the harness then scores with a Brier value. Also reports
 * the running per-lane calibration sample size + whether the >=30-resolved shading
 * threshold has been reached (the judgment spec wires shading into Synthesis).
 */
async function runForecastResolutionTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: RunScheduledTasksOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const asOf = options.as_of ?? currentDate()
  const currentYear = Number(asOf.slice(0, 4))

  const forecasts = projectForecasts(events)
  const dueUnresolved = forecasts.filter((forecast) => {
    if (forecast.resolved) return false
    const match = (forecast.resolves_on ?? '').match(/(\d{4})/)
    if (match === null) return false
    const resolutionYear = Number(match[1])
    // Annual reports land in the year AFTER the fiscal year; treat due at year+1.
    return Number.isFinite(currentYear) && currentYear >= resolutionYear + 1
  })

  const calibration = projectForecastCalibration(events)
  const observations = [
    ...dueUnresolved.map((forecast) =>
      `forecast ${forecast.forecast_id} (${forecast.lane ?? 'lane'}, p=${forecast.p ?? '?'}) is DUE to resolve on "${forecast.resolves_on}" — awaiting a human/EDGAR true/false; no outcome fabricated`,
    ),
    `calibration sample: ${calibration.total_resolved} resolved forecast(s); shading ${calibration.shading_active ? 'ELIGIBLE (>=30 resolved)' : 'not yet active (<30 resolved)'}`,
  ]

  return {
    result_summary: `forecast_resolution dry-run: ${dueUnresolved.length} forecast(s) due for resolution; ${calibration.total_resolved} resolved to date; no outcome fabricated, no investment action taken`,
    observations,
    human_approval_required: dueUnresolved.length > 0,
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

  // Deterministic buy-window pass (Module 6): records buy-window / staleness-suppression observations.
  const buyWindow = await runWatchlistBuyWindowPass(store, options)
  observations.push(...buyWindow.observations)

  return {
    result_summary: `watchlist_monitor dry-run: ${confirmedWatchlistItems.length} confirmed watchlist item(s) monitored; ${buyWindow.alerts} buy-window alert(s), ${buyWindow.appended} monitor observation(s); no buy/sell/portfolio action taken`,
    observations,
    ...(providerRunIds.length === 0 ? {} : { provider_run_ids: providerRunIds }),
    approval_gates: [OPEN_HOLDING_APPROVAL_GATE, ...buyWindow.approvalGates],
    human_approval_required: confirmedWatchlistItems.length > 0 || buyWindow.appended > 0,
    events_appended: providerEventsAppended + buyWindow.appended,
  }
}

// ---------------------------------------------------------------------------
// Lifecycle Monitors — Module 6 (Watchlist buy-window) + Module 7 (Holdings) deterministic passes.
// Every output is an OBSERVATION or a human-authored-decision DRAFT — never an auto-trade, an
// auto-trim, a watchlist removal, a holding open, or any state advance.
// ---------------------------------------------------------------------------

function eventTimestamp(options: TaskHandlerOptions): string {
  return options.now?.() ?? nowIso()
}

/** Build the deterministic monitor view of a watchlist item's linked research case. */
function monitorCaseForWatchlist(
  item: ReturnType<typeof projectWatchlist>[number],
  researchCase: ResearchCaseProjection | undefined,
): MonitorResearchCaseInput | undefined {
  if (researchCase === undefined) {
    return undefined
  }
  const valuation = researchCase.valuation
  const input: MonitorResearchCaseInput = {
    research_case_id: researchCase.research_case_id,
    updated_at: researchCase.updated_at,
    superseded: researchCase.superseded,
    ...(researchCase.ticker === undefined ? {} : { ticker: researchCase.ticker }),
    ...(valuation?.buy_price_per_share === undefined ? {} : { buy_price_per_share: valuation.buy_price_per_share }),
    ...(valuation?.fair_value_per_share === undefined ? {} : { fair_value_per_share: valuation.fair_value_per_share }),
    ...(valuation?.moat_class === undefined ? {} : { moat_class: valuation.moat_class }),
    ...(valuation?.verdict_state?.state === undefined ? {} : { verdict_state: valuation.verdict_state.state }),
    ...(researchCase.investment_verdict === undefined ? {} : { investment_verdict: researchCase.investment_verdict }),
    ...(researchCase.shariah_status === undefined ? {} : { shariah_status: researchCase.shariah_status }),
  }
  return input
}

function findResearchCaseById(cases: ResearchCaseProjection[], researchCaseId: string): ResearchCaseProjection | undefined {
  return cases.find((entry) => entry.research_case_id === researchCaseId)
}

/**
 * Daily watchlist buy-window pass (Module 6). For each confirmed watchlist item with a linked research
 * case that carries a buy price, fetches the current price (injected priceSource, fail-closed) and
 * records a `watchlist_monitor_alert_recorded` OBSERVATION: a BUY-WINDOW alert ONLY on a fresh,
 * gate-clean, cheap case; otherwise a suppressed/re-run-needed observation. Never opens a holding.
 */
async function runWatchlistBuyWindowPass(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<{ observations: string[]; appended: number; alerts: number; approvalGates: string[] }> {
  const events = await store.list()
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const cases = projectResearchCases(events)
  const items = projectWatchlist(events).filter(
    (item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id),
  )
  const existingKeys = new Set(events.map((event) => event.idempotency_key).filter((key): key is string => key !== undefined))
  const now = new Date(eventTimestamp(options))
  const asOf = options.as_of ?? now.toISOString().slice(0, 10)
  const observations: string[] = []
  const approvalGates = new Set<string>()
  let appended = 0
  let alerts = 0

  for (const item of items) {
    const monitorCase = monitorCaseForWatchlist(item, findResearchCaseById(cases, item.research_case_id))
    if (monitorCase === undefined || monitorCase.buy_price_per_share === undefined) {
      observations.push(`${labelForWatchlistItem(item)}: no linked research case buy price — buy-window not evaluated`)
      continue
    }
    const ticker = monitorCase.ticker
    if (ticker === undefined) {
      observations.push(`${labelForWatchlistItem(item)}: no ticker — buy-window not evaluated`)
      continue
    }

    const quote = await resolveCurrentPrice({ ticker }, undefined, options.priceSource)
    if (!quote.available) {
      observations.push(`${ticker}: no auto price for buy-window (${quote.reason})`)
      continue
    }

    const result = evaluateWatchlistBuyWindow(monitorCase, { current_price: quote.price_per_share, now })
    const alertKind = result.buy_window_alert ? 'buy_window' : result.suppressed ? 'buy_window_suppressed' : 'no_signal'
    const alertId = `wmon_${item.watchlist_item_id}_${asOf.replace(/[^0-9]/g, '')}`
    const idempotencyKey = `watchlist-monitor-alert:${alertId}:${quote.source}`
    if (existingKeys.has(idempotencyKey)) {
      observations.push(`${ticker}: watchlist monitor alert already recorded for ${asOf}; no duplicate`)
      continue
    }

    await store.append({
      event_id: `evt_watchlist_monitor_alert_recorded_${alertId}`,
      event_type: 'watchlist_monitor_alert_recorded',
      aggregate_type: 'watchlist_item',
      aggregate_id: item.watchlist_item_id,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: idempotencyKey,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        alert_id: alertId,
        watchlist_item_id: item.watchlist_item_id,
        research_case_id: monitorCase.research_case_id,
        ticker,
        alert_kind: alertKind,
        buy_window_alert: result.buy_window_alert,
        suppressed: result.suppressed,
        ...(result.suppression_reason === undefined ? {} : { suppression_reason: result.suppression_reason }),
        rerun_needed: result.rerun_needed,
        ...(result.discount_to_buy_pct === undefined ? {} : { discount_to_buy_pct: result.discount_to_buy_pct }),
        case_age_months: result.freshness.age_months,
        is_observation: true,
        is_recommendation: false,
        message: result.message,
      },
      source_ids: [`${quote.source}:${ticker}:${quote.as_of}`],
      created_at: eventTimestamp(options),
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    existingKeys.add(idempotencyKey)
    appended += 1
    observations.push(result.message)
    if (result.buy_window_alert) {
      alerts += 1
      approvalGates.add(OPEN_HOLDING_APPROVAL_GATE)
    }
  }

  return { observations, appended, alerts, approvalGates: [...approvalGates] }
}

/**
 * Daily holdings monitor pass (Module 7): per open holding, tranche-review triggers (T2/T3, thesis-gated),
 * >15% concentration trim-review, and the annual deep-re-run flag. Records `holding_monitor_alert_recorded`
 * OBSERVATIONS. Advisory only — never an auto-trade, auto-trim, or state advance.
 */
async function runHoldingsMonitorTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  const events = await store.list()
  const holdings = projectHoldings(events)
  const cases = projectResearchCases(events)
  const existingKeys = new Set(events.map((event) => event.idempotency_key).filter((key): key is string => key !== undefined))
  const now = new Date(eventTimestamp(options))
  const asOf = options.as_of ?? now.toISOString().slice(0, 10)
  const portfolioNav = holdings.reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)
  const observations: string[] = []
  const approvalGates = new Set<string>()
  let appended = 0

  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker)
    const researchCase = findResearchCaseById(cases, holding.research_case_id)
    const monitorHolding: MonitorHoldingInput = {
      holding_id: holding.holding_id,
      ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
      research_case_id: holding.research_case_id,
      // Entry buy price reference: the research case buy price, else the holding's cost basis.
      entry_buy_price: researchCase?.valuation?.buy_price_per_share ?? holding.cost_basis_per_share,
      ...(holding.latest_market_value === undefined ? {} : { market_value: holding.latest_market_value }),
      ...(researchCase?.updated_at === undefined ? {} : { case_updated_at: researchCase.updated_at }),
    }

    // Concentration uses the latest recorded valuation (no live fetch required).
    const concentration = evaluateConcentration(monitorHolding, { portfolio_nav: portfolioNav })

    // Tranche triggers need a current price; fail-closed if unavailable.
    let trancheTriggered: string[] = []
    let trancheAlert = false
    let trancheNote: string | undefined
    // position-sizing-spec lot-tag fields (§2/§3/§4/§5.5), populated from the rich engine when a price
    // and a case buy price are available; advisory only, the human authors the fill.
    let trancheLotTags: {
      ladder_id?: string
      tranche_id?: string
      trigger_type?: string
      buy_price_version?: string
      deployed_pct?: number
      target_weight?: number
      tranche_blocked?: boolean
      tranche_block_reason?: string
    } = {}
    if (ticker !== undefined) {
      const quote = await resolveCurrentPrice({ ticker }, undefined, options.priceSource)
      if (quote.available) {
        // Legacy price-trigger set (kept for the triggered_tranches field + backward compatibility).
        const legacy = evaluateTrancheTriggers(buffettMungerStrategy, monitorHolding, { current_price: quote.price_per_share })
        trancheTriggered = legacy.triggered_tranches
        trancheNote = legacy.thesis_gated_note

        // Rich, config-driven engine (position-sizing-spec §2–§5): re-anchored levels + time-completion +
        // discipline gates + deployed-%. The case buy price IS the current (re-anchored) buy price; its
        // version is the valuation-params version that produced it (the case does not yet persist a
        // dedicated buy_price_version — this is the stable seam). Thesis-break DETECTION is the deferred
        // T3 piece, so thesis_break_unresolved defaults false here; recheck_clean follows the gate.
        const buyPrice = monitorHolding.entry_buy_price
        if (buyPrice !== undefined && Number.isFinite(buyPrice) && buyPrice > 0) {
          const gate = isGateClean({
            ...(researchCase?.investment_verdict === undefined ? {} : { investment_verdict: researchCase.investment_verdict }),
            ...(researchCase?.shariah_status === undefined ? {} : { shariah_status: researchCase.shariah_status }),
          })
          const caseStale = researchCase?.superseded === true
          const rich = evaluateHoldingTranche(
            monitorHolding,
            {
              buy_price: buyPrice,
              buy_price_version: VALUATION_PARAMS.version,
              thesis_break_unresolved: false,
              stale: caseStale,
              ...(caseStale ? { stale_reason: 'research case superseded — re-run before any tranche' } : {}),
              recheck_clean: gate.clean,
            },
            { current_price: quote.price_per_share },
          )
          trancheAlert = rich.alert
          trancheLotTags = {
            ladder_id: rich.ladder_id,
            ...(rich.tranche_id === undefined ? {} : { tranche_id: rich.tranche_id }),
            ...(rich.trigger_type === undefined ? {} : { trigger_type: rich.trigger_type }),
            buy_price_version: rich.buy_price_version,
            deployed_pct: rich.deployed_pct,
            tranche_blocked: rich.blocked,
            ...(rich.block_reason === undefined ? {} : { tranche_block_reason: rich.block_reason }),
          }
          if (rich.alert || rich.blocked) {
            observations.push(rich.message)
          }
        } else if (legacy.tranche_review_alert) {
          trancheAlert = true
          observations.push(legacy.message)
        }
      } else {
        observations.push(`${ticker}: no auto price for tranche triggers (${quote.reason})`)
      }
    }

    const annual = monitorHolding.case_updated_at === undefined
      ? { rerun_needed: false, age_months: 0 }
      : evaluateAnnualRerun(monitorHolding.case_updated_at, { now })

    if (concentration.trim_review_alert) {
      observations.push(concentration.message)
    }
    if (annual.rerun_needed) {
      observations.push(`${holding.ticker ?? holding.holding_id}: research case is ${annual.age_months} months old — annual deep re-run needed (supersedes the prior case)`)
    }

    const hasSignal = trancheAlert || concentration.trim_review_alert || annual.rerun_needed
    if (!hasSignal) {
      observations.push(`${holding.ticker ?? holding.holding_id}: no holding monitor signal (no tranche/concentration/annual flag)`)
      continue
    }

    const alertId = `hmon_${holding.holding_id}_${asOf.replace(/[^0-9]/g, '')}`
    const idempotencyKey = `holding-monitor-alert:${alertId}`
    if (existingKeys.has(idempotencyKey)) {
      observations.push(`${holding.ticker ?? holding.holding_id}: holding monitor alert already recorded for ${asOf}; no duplicate`)
      continue
    }
    const alertKinds = [
      trancheAlert ? 'tranche_review' : undefined,
      concentration.trim_review_alert ? 'concentration_trim_review' : undefined,
      annual.rerun_needed ? 'annual_rerun' : undefined,
    ].filter((kind): kind is string => kind !== undefined)

    await store.append({
      event_id: `evt_holding_monitor_alert_recorded_${alertId}`,
      event_type: 'holding_monitor_alert_recorded',
      aggregate_type: 'holding',
      aggregate_id: holding.holding_id,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: idempotencyKey,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        alert_id: alertId,
        holding_id: holding.holding_id,
        research_case_id: holding.research_case_id,
        ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
        alert_kind: alertKinds.join('+'),
        tranche_review_alert: trancheAlert,
        triggered_tranches: trancheTriggered,
        ...(trancheNote === undefined ? {} : { thesis_gated_note: trancheNote }),
        // position-sizing-spec lot-tag fields (§2/§3/§4/§5.5) — carried so the human's confirm event can
        // record the lot tags. Present only when the rich engine ran (price + buy price available).
        ...(trancheLotTags.ladder_id === undefined ? {} : { ladder_id: trancheLotTags.ladder_id }),
        ...(trancheLotTags.tranche_id === undefined ? {} : { tranche_id: trancheLotTags.tranche_id }),
        ...(trancheLotTags.trigger_type === undefined ? {} : { trigger_type: trancheLotTags.trigger_type }),
        ...(trancheLotTags.buy_price_version === undefined ? {} : { buy_price_version: trancheLotTags.buy_price_version }),
        ...(trancheLotTags.deployed_pct === undefined ? {} : { deployed_pct: trancheLotTags.deployed_pct }),
        ...(trancheLotTags.tranche_blocked === undefined ? {} : { tranche_blocked: trancheLotTags.tranche_blocked }),
        ...(trancheLotTags.tranche_block_reason === undefined ? {} : { tranche_block_reason: trancheLotTags.tranche_block_reason }),
        trim_review_alert: concentration.trim_review_alert,
        ...(concentration.weight_pct === undefined ? {} : { weight_pct: concentration.weight_pct }),
        rerun_needed: annual.rerun_needed,
        case_age_months: annual.age_months,
        is_observation: true,
        is_recommendation: false,
        message: `${holding.ticker ?? holding.holding_id}: holding monitor — ${alertKinds.join(', ')}; advisory only, no auto-trade/-trim/-advance.`,
      },
      source_ids: [],
      created_at: eventTimestamp(options),
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    existingKeys.add(idempotencyKey)
    appended += 1
  }

  return {
    result_summary: `holdings_monitor dry-run: monitored ${holdings.length} holding(s), recorded ${appended} monitor alert(s) (tranche/concentration/annual re-run); advisory observations only, no buy/sell/trim/portfolio action taken`,
    observations,
    approval_gates: [...approvalGates],
    human_approval_required: appended > 0,
    events_appended: appended,
  }
}

/**
 * Quarterly Shariah re-screen pass (Module 6 + 7). Recomputes the AAOIFI ratios via the injected
 * ShariahRatioSource (fail-closed: no source → observation-only note, no live EDGAR fetch). On the
 * watchlist a breach flags a re-screen (FAIL → propose removal); on a holding a FAIL starts a 90-day
 * grace period, and an open grace unresolved past its deadline emits a DIVEST-REQUIRED draft (a
 * human-authored exit proposal — never an execution).
 */
async function runShariahRescreenTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  const source = options.shariahRatioSource
  const events = await store.list()
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const watchlistItems = projectWatchlist(events).filter(
    (item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id),
  )
  const existingKeys = new Set(events.map((event) => event.idempotency_key).filter((key): key is string => key !== undefined))
  const now = new Date(eventTimestamp(options))
  const asOf = options.as_of ?? now.toISOString().slice(0, 10)
  const observations: string[] = []
  const approvalGates = new Set<string>()
  let appended = 0

  if (source === undefined) {
    observations.push('shariah_rescreen: no Shariah-ratio source injected (fail-closed) — no live EDGAR re-screen performed this tick')
    return {
      result_summary: 'shariah_rescreen dry-run: no Shariah-ratio source injected; fail-closed observation only, no re-screen/grace/divest action taken',
      observations,
      approval_gates: [],
      human_approval_required: false,
      events_appended: 0,
    }
  }

  // Watchlist re-screen.
  for (const item of watchlistItems) {
    const ticker = normalizeTicker(item.ticker)
    if (ticker === undefined) {
      continue
    }
    const ratios = await source({ ticker })
    if (ratios === undefined) {
      observations.push(`${ticker}: no Shariah-ratio data available for watchlist re-screen`)
      continue
    }
    const result = evaluateShariahRescreen(ratios)
    if (!result.flagged) {
      observations.push(`${ticker}: watchlist Shariah re-screen ${result.verdict ?? 'not computable'} — no flag`)
      continue
    }
    const alertId = `wshariah_${item.watchlist_item_id}_${asOf.replace(/[^0-9]/g, '')}`
    const idempotencyKey = `watchlist-shariah-rescreen:${alertId}`
    if (existingKeys.has(idempotencyKey)) {
      continue
    }
    await store.append({
      event_id: `evt_watchlist_monitor_alert_recorded_${alertId}`,
      event_type: 'watchlist_monitor_alert_recorded',
      aggregate_type: 'watchlist_item',
      aggregate_id: item.watchlist_item_id,
      causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
      correlation_id: options.scheduled_task_run_id,
      idempotency_key: idempotencyKey,
      actor_type: 'worker',
      actor_id: WORKER_ACTOR_ID,
      payload: {
        alert_id: alertId,
        watchlist_item_id: item.watchlist_item_id,
        research_case_id: item.research_case_id,
        ticker,
        alert_kind: 'shariah_rescreen',
        buy_window_alert: false,
        suppressed: false,
        rerun_needed: false,
        shariah_verdict: result.verdict,
        propose_removal: result.propose_removal,
        is_observation: true,
        is_recommendation: false,
        message: `${ticker}: Shariah re-screen ${result.verdict} — ${result.reason}`,
      },
      source_ids: [],
      created_at: eventTimestamp(options),
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    existingKeys.add(idempotencyKey)
    appended += 1
    observations.push(`${ticker}: Shariah re-screen ${result.verdict} — ${result.reason}`)
    if (result.propose_removal) {
      approvalGates.add(WATCHLIST_REMOVAL_APPROVAL_GATE)
    }
  }

  // Holdings grace clock + divest draft.
  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker)
    if (ticker === undefined) {
      continue
    }
    const ratios = await source({ ticker })
    if (ratios === undefined) {
      observations.push(`${ticker}: no Shariah-ratio data available for holding re-screen`)
      continue
    }
    const openGrace = findOpenShariahGrace(events, holding.holding_id)
    const result = evaluateShariahGrace(
      { holding_id: holding.holding_id, ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }), research_case_id: holding.research_case_id },
      { ratios, now, ...(openGrace === undefined ? {} : { open_grace: openGrace }) },
    )

    if (result.start_grace && result.grace_deadline !== undefined) {
      const graceId = `grace_${holding.holding_id}_${asOf.replace(/[^0-9]/g, '')}`
      const idempotencyKey = `holding-shariah-grace:${graceId}`
      if (!existingKeys.has(idempotencyKey)) {
        await store.append({
          event_id: `evt_holding_shariah_grace_started_${graceId}`,
          event_type: 'holding_shariah_grace_started',
          aggregate_type: 'holding',
          aggregate_id: holding.holding_id,
          causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
          correlation_id: options.scheduled_task_run_id,
          idempotency_key: idempotencyKey,
          actor_type: 'worker',
          actor_id: WORKER_ACTOR_ID,
          payload: {
            grace_id: graceId,
            holding_id: holding.holding_id,
            ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
            started_at: eventTimestamp(options),
            deadline: result.grace_deadline,
            grace_days: SHARIAH_GRACE_DAYS,
            shariah_verdict: result.verdict,
            reason: 'AAOIFI financial-ratio breach — 90-day grace period started; resolve or author a divest before the deadline.',
            is_observation: true,
            message: result.message,
          },
          source_ids: [],
          created_at: eventTimestamp(options),
          schema_version: 1,
        } satisfies LedgerEventEnvelope<Record<string, unknown>>)
        existingKeys.add(idempotencyKey)
        appended += 1
        observations.push(result.message)
      }
    } else if (result.divest_required_draft && result.draft !== undefined) {
      const draft = result.draft
      const sellReviewId = `sellreview_${holding.holding_id}_${asOf.replace(/[^0-9]/g, '')}`
      const idempotencyKey = `holding-sell-review:${sellReviewId}`
      if (!existingKeys.has(idempotencyKey)) {
        await store.append({
          event_id: `evt_holding_sell_review_drafted_${sellReviewId}`,
          event_type: 'holding_sell_review_drafted',
          aggregate_type: 'holding',
          aggregate_id: holding.holding_id,
          causation_id: `evt_scheduled_task_run_started_${options.scheduled_task_run_id}`,
          correlation_id: options.scheduled_task_run_id,
          idempotency_key: idempotencyKey,
          actor_type: 'worker',
          actor_id: WORKER_ACTOR_ID,
          payload: {
            sell_review_id: sellReviewId,
            holding_id: holding.holding_id,
            research_case_id: holding.research_case_id,
            ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
            reason_code: draft.reason_code,
            detail: draft.detail,
            reasons: draft.reasons,
            weakest_reason: draft.weakest_reason,
            weakest_reason_note: draft.weakest_reason_note,
            is_execution: false,
            is_recommendation: false,
            requires_user_authoring: true,
            ...(draft.deferred_detection_note === undefined ? {} : { deferred_detection_note: draft.deferred_detection_note }),
            message: result.message,
          },
          source_ids: [],
          created_at: eventTimestamp(options),
          schema_version: 1,
        } satisfies LedgerEventEnvelope<Record<string, unknown>>)
        existingKeys.add(idempotencyKey)
        appended += 1
        approvalGates.add(SELL_REVIEW_APPROVAL_GATE)
        observations.push(result.message)
      }
    } else {
      observations.push(result.message)
    }
  }

  return {
    result_summary: `shariah_rescreen dry-run: re-screened ${watchlistItems.length} watchlist item(s) + ${holdings.length} holding(s), recorded ${appended} observation/draft event(s); FAIL→removal proposals/grace/divest are drafts, no removal/exit/portfolio action taken`,
    observations,
    approval_gates: [...approvalGates],
    human_approval_required: appended > 0,
    events_appended: appended,
  }
}

/**
 * Returns the most recent OPEN Shariah grace for a holding (a grace_started not yet resolved by a
 * holding_review_confirmed/overridden or a sell_review draft superseding it). For the alpha we treat the
 * latest grace_started as the open grace; resolution is a human action recorded elsewhere.
 */
function findOpenShariahGrace(
  events: LedgerEventEnvelope<unknown>[],
  holdingId: string,
): { started_at: string; deadline: string } | undefined {
  let latest: { started_at: string; deadline: string } | undefined
  for (const event of events) {
    if (event.event_type !== 'holding_shariah_grace_started') {
      continue
    }
    const payload = event.payload
    if (payload === null || typeof payload !== 'object') {
      continue
    }
    const record = payload as Record<string, unknown>
    if (record['holding_id'] !== holdingId) {
      continue
    }
    const startedAt = typeof record['started_at'] === 'string' ? record['started_at'] : event.created_at
    const deadline = typeof record['deadline'] === 'string' ? record['deadline'] : undefined
    if (deadline === undefined) {
      continue
    }
    if (latest === undefined || startedAt > latest.started_at) {
      latest = { started_at: startedAt, deadline }
    }
  }
  return latest
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
  let escalationEventsAppended = 0

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

    // Escalation: when thesis is IMPAIRED or EXIT_CANDIDATE, enqueue a new versioned
    // full swarm reanalysis (draft only — the human still decides).
    if (THESIS_BROKEN_HEALTH.has(draft.thesis_health)) {
      const ticker = holding.ticker
      if (ticker !== undefined && ticker.length > 0) {
        const escalationResult = await maybeEnqueueEscalationReanalysis(store, {
          ticker,
          holding,
          reviewDraftEventId: draft.event_id,
          thesisHealth: draft.thesis_health,
          scheduledTaskRunId: options.scheduled_task_run_id,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.automation?.research_engine_enabled === undefined
            ? {}
            : { researchEngineEnabled: options.automation.research_engine_enabled }),
        })
        observations.push(escalationResult.observation)
        escalationEventsAppended += escalationResult.eventsAppended
      }
    }
  }

  return {
    result_summary: `holding_review_draft dry-run: ${proposalEventIds.length} holding review draft proposal(s) created; no holding review confirmation or portfolio action taken`,
    observations,
    ...(proposalEventIds.length === 0 ? {} : { proposal_event_ids: proposalEventIds }),
    approval_gates: [HOLDING_REVIEW_APPROVAL_GATE],
    human_approval_required: proposalEventIds.length > 0,
    events_appended: proposalEventIds.length + escalationEventsAppended,
  }
}

type EscalationOptions = {
  ticker: string
  holding: ReturnType<typeof projectHoldings>[number]
  reviewDraftEventId: string
  thesisHealth: ThesisHealth
  scheduledTaskRunId: string
  now?: () => string
  researchEngineEnabled?: boolean
}

async function maybeEnqueueEscalationReanalysis(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: EscalationOptions,
): Promise<{ observation: string; eventsAppended: number }> {
  const { ticker, thesisHealth, reviewDraftEventId, researchEngineEnabled } = options

  // Master switch: if research engine is explicitly off, record observation but do NOT escalate.
  if (researchEngineEnabled === false) {
    return {
      observation: `${ticker}: thesis ${thesisHealth} detected — auto-reanalysis is off (research_engine_enabled=false); review manually`,
      eventsAppended: 0,
    }
  }

  // Re-read events (include the holding_review_drafted just appended) for dedup.
  const currentEvents = await store.list()

  // Dedup guard: if there is already an unclaimed research_run_requested for this ticker,
  // skip enqueuing to avoid stacking duplicate reanalysis requests per review tick.
  const pendingRuns = projectPendingResearchRuns(currentEvents as LedgerEventEnvelope<Record<string, unknown>>[])
  const alreadyPending = pendingRuns.some((run) => run.ticker.toUpperCase() === ticker.toUpperCase())
  if (alreadyPending) {
    return {
      observation: `${ticker}: thesis ${thesisHealth} detected — reanalysis already pending; skipping duplicate escalation`,
      eventsAppended: 0,
    }
  }

  // Version the new research case: supersede the latest case if one exists.
  const latestCase = findLatestResearchCaseForTicker(currentEvents, ticker)
  const action = selectResearchCaseAction({
    trigger: 'scheduled_reanalysis',
    now: new Date(options.now?.() ?? nowIso()),
    ...(latestCase !== undefined ? { latestCase: { research_case_id: latestCase.research_case_id, created_at: latestCase.updated_at, version: latestCase.version } } : {}),
  })
  const version = action === 'create_first' ? 1 : (latestCase?.version ?? 0) + 1
  const supersedesId = action === 'create_version' ? latestCase?.research_case_id : undefined

  const companyId = options.holding.company_id ?? `company_${ticker.toLowerCase()}`
  const researchCaseId = `rc_${ticker.toLowerCase()}_escalation_${options.scheduledTaskRunId}`
  const decisionId = `decision_${ticker.toLowerCase()}_escalation_${options.scheduledTaskRunId}`
  const requestedAt = options.now?.() ?? nowIso()

  await store.append({
    event_id: `evt_research_run_requested_${researchCaseId}`,
    event_type: 'research_run_requested',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    causation_id: reviewDraftEventId,
    correlation_id: researchCaseId,
    actor_type: 'worker',
    actor_id: WORKER_ACTOR_ID,
    payload: {
      research_case_id: researchCaseId,
      ticker,
      company_id: companyId,
      strategy_id: options.holding.strategy_id ?? 'buffett-munger',
      decision_id: decisionId,
      version,
      ...(supersedesId === undefined ? {} : { supersedes_research_case_id: supersedesId }),
      escalation_trigger: 'thesis_impaired_holding_review',
      escalation_thesis_health: thesisHealth,
      escalation_holding_review_event_id: reviewDraftEventId,
      escalation_holding_id: options.holding.holding_id,
      requested_by: WORKER_ACTOR_ID,
    },
    source_ids: [],
    created_at: requestedAt,
    schema_version: 1,
    idempotency_key: `escalation-reanalysis:${researchCaseId}:v1`,
  } satisfies LedgerEventEnvelope<Record<string, unknown>>)

  const versionLabel = supersedesId !== undefined ? ` v${version} (supersedes ${supersedesId})` : ` v${version}`
  return {
    observation: `${ticker}: thesis ${thesisHealth} — escalated to full reanalysis (${researchCaseId}${versionLabel}); swarm will draft, human decides`,
    eventsAppended: 1,
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
        caveat: 'Live market price from Yahoo Finance',
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

  // Quarterly purification statement (Module 9 rule 4): read-only — accrued this period, per holding,
  // cumulative unpaid. Re-list events so freshly-appended obligations this tick are included.
  const eventsWithAccruals = await store.list()
  const statementPeriodStart = quarterStartDateForEnd(asOf)
  const statement = projectQuarterlyPurificationStatement(eventsWithAccruals, {
    period_start: statementPeriodStart,
    period_end: asOf,
  })
  for (const [currency, summary] of Object.entries(statement.summary_by_currency)) {
    observations.push(
      `purification statement ${statementPeriodStart}..${asOf} (${currency}): accrued this period ${summary.accrued_this_period.toFixed(2)}, cumulative unpaid ${summary.cumulative_unpaid.toFixed(2)} across ${statement.per_holding.filter((line) => line.currency === currency).length} holding(s); human authors any disbursement`,
    )
  }

  // Exit finalization (Module 9 rule 5): lock final cumulative purification on closed holdings.
  const finalizations = projectExitPurificationFinalizations(eventsWithAccruals)
  for (const finalization of finalizations) {
    observations.push(
      `${finalization.ticker ?? finalization.holding_id} exit purification finalized (closed ${finalization.closed_at}): accrued ${finalization.final_purification_accrued.toFixed(2)} ${finalization.currency}, remaining ${finalization.final_purification_remaining.toFixed(2)}; locked into post-mortem, human authors any disbursement`,
    )
  }

  // Zakat statement (Module 8): read-only at the ḥawl date, only when a user-authored methodology setting
  // is provided. 2.5% (default) on a user-set base; the human authors the actual zakat payment.
  if (options.zakat !== undefined) {
    const zakatCurrency = options.zakat.currency ?? 'USD'
    const zakatStatement = projectZakatStatement(eventsWithAccruals, {
      hawl_date: options.zakat.hawl_date,
      currency: zakatCurrency,
      ...(options.zakat.base_method === undefined ? {} : { base_method: options.zakat.base_method }),
      ...(options.zakat.net_current_assets === undefined ? {} : { net_current_assets: options.zakat.net_current_assets }),
      ...(options.zakat.rate === undefined ? {} : { rate: options.zakat.rate }),
    })
    observations.push(
      `zakat statement (ḥawl ${zakatStatement.hawl_date}, ${zakatStatement.base_method}): base ${zakatStatement.zakatable_base.toFixed(2)} ${zakatCurrency} x ${(zakatStatement.rate * 100).toFixed(2)}% = ${zakatStatement.zakat_due.toFixed(2)} due; user-authored methodology, human authors the payment`,
    )
  }

  return {
    result_summary: `purification_projection dry-run: calculated ${appended} estimated purification obligation(s), ${projection.pending.length} pending dividend(s) need evidence, ${finalizations.length} exit finalization(s); quarterly statement + ${options.zakat === undefined ? 'no ' : ''}zakat statement; no payment or resolution marked`,
    observations,
    approval_gates: appended > 0 || projection.pending.length > 0 ? [PURIFICATION_PAYMENT_APPROVAL_GATE] : [],
    human_approval_required: appended > 0 || projection.pending.length > 0,
    events_appended: appended,
  }
}

async function runDiscovery13fTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  // Deterministic 13F clone engine over the curated cloner list. Live SEC fetches are deterministic and
  // allowed; the engine records source:'13f_clone' CANDIDATE observations only — it does NOT auto-advance
  // past `discovered`, so the human/quick-screen gate still decides what enters research.
  const result = await runDiscovery13f(store, {
    ...(options.now === undefined ? {} : { now: () => options.now!() }),
  })

  return {
    result_summary: `discovery_13f dry-run: ${result.signals_detected} 13F signal(s) detected, ${result.candidates_created} new source:13f_clone candidate(s) recorded, ${result.sector_excluded} Shariah-sector-excluded, ${result.unresolved} unresolved ticker(s); candidates stay at discovered — human/quick-screen gates entry to research`,
    observations: result.summaries,
    approval_gates: [],
    human_approval_required: result.candidates_created > 0,
    events_appended: result.candidates_created,
  }
}

async function runTaskHandler(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  task: ScheduledTaskProjection,
  options: TaskHandlerOptions,
): Promise<TaskResult> {
  if (task.task_kind === 'discovery_13f') {
    return runDiscovery13fTask(store, options)
  }

  if (task.task_kind === 'review_reminder') {
    return runReviewReminderTask(store, options)
  }

  if (task.task_kind === 'watchlist_monitor') {
    return runWatchlistMonitorTask(store, options)
  }

  if (task.task_kind === 'holdings_monitor') {
    return runHoldingsMonitorTask(store, options)
  }

  if (task.task_kind === 'shariah_rescreen') {
    return runShariahRescreenTask(store, options)
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

  if (task.task_kind === 'forecast_resolution') {
    return runForecastResolutionTask(store, options)
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

export async function runProcessDeepDiveQueueTask(
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
  const pending = projectPendingDeepDiveRuns(events as LedgerEventEnvelope<Record<string, unknown>>[])
  const ground: GroundFn = options.ground ?? (
    options.provider.provider_id === 'mock-provider'
      ? groundProposedSourcesDeterministic as unknown as GroundFn
      : groundProposedSources as unknown as GroundFn
  )
  const summaries: string[] = []
  let failed = 0

  for (const run of pending) {
    try {
      await runResearchDeepDivePhase(
        store,
        options.provider,
        {
          research_case_id: run.research_case_id,
          company_id: run.company_id ?? `company_${run.ticker.toLowerCase()}`,
          ticker: run.ticker,
          strategy_id: run.strategy_id ?? 'buffett-munger',
          model_id: run.model_id ?? 'mock',
          decision_id: run.decision_id ?? `decision_${run.research_case_id}`,
          source_ledger_path: run.source_ledger_path ?? options.source_ledger_path,
          quick_screen_source_ids: run.quick_screen_source_ids,
          quick_screen_event_id: run.quick_screen_event_id,
        },
        { ground },
      )

      summaries.push(`process_deep_dive_queue: ran deep-dive swarm for ${run.ticker} (${run.research_case_id}); decision draft created; no investment action taken`)
    } catch (error) {
      const failedAt = now().toISOString()
      await store.append({
        event_id: `evt_research_run_failed_${run.research_case_id}_deep_dive`,
        event_type: 'research_run_failed',
        aggregate_type: 'research_case',
        aggregate_id: run.research_case_id,
        causation_id: run.requested_event_id,
        correlation_id: run.research_case_id,
        idempotency_key: `research-run-failed:${run.research_case_id}:deep-dive:v1`,
        actor_type: 'worker',
        actor_id: WORKER_ACTOR_ID,
        payload: {
          research_case_id: run.research_case_id,
          run_id: `run_${run.research_case_id}_deep_dive`,
          failed_at: failedAt,
          error_summary: (error as Error).message.slice(0, 500),
        },
        source_ids: [],
        created_at: failedAt,
        schema_version: 1,
      } satisfies LedgerEventEnvelope<Record<string, unknown>>)
      failed += 1
      summaries.push(`process_deep_dive_queue: deep-dive swarm failed for ${run.ticker} (${run.research_case_id}): ${(error as Error).message.slice(0, 200)}`)
    }
  }

  return { processed: pending.length, failed, summaries }
}

/**
 * The pre-stated calibration target (valuation-recalibration-spec §3.1), recorded with every run so the
 * §3.4 anti-drift rule is enforceable (a run is calibrated against the SAME pre-stated target). Constant —
 * never derived from the run's own results.
 */
const CALIBRATION_TARGET: CalibrationTarget = {
  buys_per_year_min: 1,
  buys_per_year_max: 3,
  must_signal_windows: ['2020-03..2020-05', '2022-09..2023-01'],
  must_not_signal_windows: ['2021-01..2021-12'],
}

/**
 * Process pending calibration-run requests (valuation-recalibration-spec §3 — deliberate, enqueued, NOT a
 * default schedule). For each `calibration_run_requested` with no recorded `calibration_run`, it loads the
 * user-curated universe, runs the DETERMINISTIC, OBSERVATION-ONLY backtest over it via the tiered
 * fundamentals resolver, and records a `calibration_run` ledger event capturing the universe version +
 * params version + per-name signal summaries + the non-US COVERAGE report + the pre-stated target.
 *
 * It NEVER changes parameters (no valuation_config write) and never auto-advances any decision — it records
 * evidence. Live EDGAR + price fetches are gated behind the enqueue (this task only runs when requested),
 * keeping the default tick dry-run/mock-safe.
 */
export async function runProcessCalibrationQueueTask(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  options: {
    /** Override the universe loader (tests inject a fixture). Default: tracked config file. */
    loadUniverse?: () => CalibrationUniverse | undefined
    /** Backtest deps (tests inject offline fundamentals/price stubs). */
    backtestDeps?: RunCalibrationBacktestDeps
    now?: () => Date
  } = {},
): Promise<{ processed: number; failed: number; summaries: string[] }> {
  const now = options.now ?? (() => new Date())
  const loadUniverse = options.loadUniverse ?? (() => loadCalibrationUniverse())
  const events = await store.list()
  const pending = projectPendingCalibrationRuns(events)
  const summaries: string[] = []
  let failed = 0
  let processed = 0

  for (const run of pending) {
    const universe = loadUniverse()
    if (universe === undefined) {
      failed += 1
      summaries.push(`process_calibration_queue: calibration_run ${run.calibration_run_id} skipped — calibration universe config not found/invalid`)
      continue
    }

    try {
      const result = await runCalibrationBacktest(universe, options.backtestDeps ?? {})
      const recordedAt = now().toISOString()

      const summaryPayload: CalibrationNameSummary[] = result.summaries.map((s) => ({
        ticker: s.ticker,
        moat_class: s.moat_class,
        runway: s.runway,
        total_months: s.total_months,
        buy_months: s.buy_months,
        buys_per_year: s.buys_per_year,
        buy_episodes: s.buy_episodes,
        sanity_windows: s.sanity_windows,
        deployment_ratios: s.deployment_ratios.map((d) => ({ ladder_id: d.ladder_id, episodes: d.episodes, avg_deployment_ratio: d.avg_deployment_ratio })),
      }))
      const coveragePayload: CalibrationCoverageSummary[] = result.coverage.map((c) => ({
        ticker: c.ticker,
        company: c.company,
        market: c.market,
        ...(c.fundamentals_hint === undefined ? {} : { fundamentals_hint: c.fundamentals_hint }),
        status: c.status,
        ...(c.currency === undefined ? {} : { currency: c.currency }),
        ...(c.reason === undefined ? {} : { reason: c.reason }),
      }))

      const event = buildCalibrationRunEvent({
        event_id: `evt_calibration_run_${run.calibration_run_id}`,
        strategy_id: run.strategy_id ?? buffettMungerStrategy.id,
        params: VALUATION_PARAMS,
        universe_version: result.universe_version,
        universe: universe.names.map((n) => n.ticker),
        summaries: summaryPayload,
        coverage: coveragePayload,
        target: CALIBRATION_TARGET,
        actor_id: WORKER_ACTOR_ID,
        created_at: recordedAt,
      })
      // Record as a worker-authored observation, correlated to the request for queue de-dup.
      await store.append({
        ...event,
        actor_type: 'worker',
        causation_id: run.requested_event_id,
        correlation_id: run.calibration_run_id,
        idempotency_key: `calibration-run:${run.calibration_run_id}:v1`,
      } as LedgerEventEnvelope<unknown>)
      processed += 1
      summaries.push(
        `process_calibration_queue: ran calibration_run ${run.calibration_run_id} over universe ${result.universe_version} (${result.coverage_counts.resolved_edgar} edgar, ${result.coverage_counts.resolved_local_manual} local-manual, ${result.coverage_counts.deferred} deferred, ${result.coverage_counts.unresolved} unresolved); observation-only, no param change`,
      )
    } catch (error) {
      failed += 1
      summaries.push(`process_calibration_queue: calibration_run ${run.calibration_run_id} failed: ${(error as Error).message.slice(0, 200)}`)
    }
  }

  return { processed, failed, summaries }
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
