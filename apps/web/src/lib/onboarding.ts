import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig, AutomationSettings, MarketUniverseConfig, ProviderSelection, ShariahDefaults } from '@owlfolio/shared'
import { mergeAutomationSettings } from '@owlfolio/shared'

import { loadAppConfig, resolveProjectRootFromCwd, resolveSourceLedgerPath, saveAppConfig, shouldUseTestDemoDefault } from './appConfigStore'
import { resetDefaultDemoStore, resolveDemoLedgerPath } from './demo'
import { seedDemoLedger } from './demoSeed'
import { getProviderOptions, type ProviderReadiness } from './providerReadiness'
import { buildProviderStatusRows } from './providerStatus'

type OnboardingEnv = {
  [key: string]: string | undefined
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PERSONAL_LEDGER_PATH?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
  CODEX_ACCESS_TOKEN?: string
  OWLFOLIO_CODEX_AUTH_PATH?: string
  CODEX_HOME?: string
  GEMINI_HOME?: string
  OWLFOLIO_GEMINI_CLI_AUTH_PATH?: string
  OWLFOLIO_GEMINI_CLI_STATUS?: string
}

type OnboardingOptions = {
  cwd?: string
  env?: OnboardingEnv
}

export type OnboardingState = {
  config: AppConfig
  is_initialized: boolean
}

export type OnboardingConfigUpdate = Partial<Omit<AppConfig, 'provider' | 'shariah' | 'market_universe'>> & {
  provider?: Partial<ProviderSelection>
  shariah?: Partial<ShariahDefaults>
  market_universe?: Partial<MarketUniverseConfig>
}

/**
 * Defense-in-depth write-path guard: demo mode is retired in the user-facing product. It may only be
 * entered under the test harness (playwright e2e / vitest), gated by `shouldUseTestDemoDefault`. Any
 * other caller attempting to seed or switch into demo throws — even if a request is crafted directly.
 */
function assertModeAllowed(mode: AppConfig['mode'], options: OnboardingOptions): void {
  if (mode === 'demo' && !shouldUseTestDemoDefault((options.env ?? process.env) as OnboardingEnv)) {
    throw new Error('Demo mode is retired in production')
  }
}

export async function getOnboardingState(options: OnboardingOptions = {}): Promise<OnboardingState> {
  const config = await loadAppConfig(options)
  return {
    config,
    is_initialized: config.ledger_path !== undefined && config.initialized_at !== undefined,
  }
}

export async function updateOnboardingConfig(update: OnboardingConfigUpdate, options: OnboardingOptions = {}): Promise<AppConfig> {
  const current = await loadAppConfig(options)
  const next: AppConfig = {
    ...current,
    ...update,
    provider: mergeProviderSelection(current.provider, update.provider),
    shariah: {
      ...current.shariah,
      ...update.shariah,
    },
    market_universe: {
      ...current.market_universe,
      ...update.market_universe,
    },
  }

  await saveAppConfig(next, options)
  return next
}

function mergeProviderSelection(
  current: ProviderSelection,
  update: OnboardingConfigUpdate['provider'],
): ProviderSelection {
  if (update === undefined) {
    return current
  }

  const providerChanged = update.provider_id !== undefined && update.provider_id !== current.provider_id
  if (providerChanged && update.model_id === undefined) {
    const { model_id: _staleModelId, ...currentWithoutModel } = current
    return {
      ...currentWithoutModel,
      ...update,
    }
  }

  return {
    ...current,
    ...update,
  }
}

export async function updateAutomationSettings(partial: Partial<AutomationSettings>, options: OnboardingOptions = {}): Promise<AppConfig> {
  const current = await loadAppConfig(options)
  const next: AppConfig = {
    ...current,
    automation: mergeAutomationSettings({ ...current.automation, ...partial }),
  }
  await saveAppConfig(next, options)
  return next
}

export async function getProviderReadinessSnapshot(config: AppConfig, options: OnboardingOptions = {}): Promise<ProviderReadiness> {
  const rows = await buildProviderStatusRows({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  const row = rows.find((provider) => provider.provider_id === config.provider.provider_id)

  if (row === undefined) {
    throw new Error(`Unknown provider: ${config.provider.provider_id}`)
  }

  return {
    provider_id: row.provider_id,
    provider_surface_id: row.provider_surface_id,
    vendor_id: row.vendor_id,
    runtime_kind: row.runtime_kind,
    ...(row.auth_mode === undefined ? {} : { auth_mode: row.auth_mode }),
    ...(row.provider_readiness_state === undefined ? {} : { readiness_state: row.provider_readiness_state }),
    ...(row.credential_source_category === undefined ? {} : { credential_source_category: row.credential_source_category }),
    ...(row.credential_source_label === undefined ? {} : { credential_source_label: row.credential_source_label }),
    support_level: row.effective_support_level,
    is_ready: row.is_ready,
    auth_source: row.auth_source,
    status_label: row.status_label,
    billing_mode: row.billing_mode,
    quota_source: row.quota_source,
    quota_status: row.quota_status,
    data_policy_source: row.data_policy_source,
    retention_or_zdr_status: row.retention_or_zdr_status,
    headless_supported: row.headless_supported,
    scheduled_workflow_supported: row.scheduled_workflow_supported,
    automation_suitability: row.automation_suitability,
    ...(row.reauth_action === undefined ? {} : { reauth_action: row.reauth_action }),
  }
}

export async function initializeSelectedMode(update: OnboardingConfigUpdate = {}, options: OnboardingOptions = {}): Promise<AppConfig> {
  // Guard before any persistence so a rejected demo init never writes mode to disk.
  const prospectiveMode = update.mode ?? (await loadAppConfig(options)).mode
  assertModeAllowed(prospectiveMode, options)

  const config = await updateOnboardingConfig(update, options)
  const ledgerPath = config.mode === 'demo'
    ? resolveDemoLedgerPath({
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.env !== undefined ? { env: options.env } : {}),
      })
    : resolvePersonalLedgerPath(options)
  const sourceLedgerPath = resolveSourceLedgerPath(options)

  const initializedConfig: AppConfig = {
    ...config,
    ledger_path: ledgerPath,
    source_ledger_path: sourceLedgerPath,
    initialized_at: new Date().toISOString(),
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    if (initializedConfig.mode === 'demo') {
      await seedDemoLedger(store)
    }
  } finally {
    store.close()
  }

  await saveAppConfig(initializedConfig, options)
  return initializedConfig
}

/**
 * Resolve the durable ledger path for a chosen, initializable mode. `unconfigured` has no ledger.
 */
function resolveLedgerPathForMode(mode: AppConfig['mode'], options: OnboardingOptions): string | undefined {
  if (mode === 'demo') {
    return resolveDemoLedgerPath({
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
    })
  }
  if (mode === 'personal-local') {
    return resolvePersonalLedgerPath(options)
  }
  return undefined
}

/** Number of events currently in the ledger at `ledgerPath` (0 if new/empty). */
async function countLedgerEvents(ledgerPath: string): Promise<number> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    return (await store.list()).length
  } finally {
    store.close()
  }
}

/**
 * Idempotent, non-destructive mode switch / re-init (three-state mode model). Unlike the first-run
 * `initializeSelectedMode`, this is safe to call on RE-ENTRY:
 *
 *  (i)   Re-selecting the CURRENT mode (already initialized) is a no-op — it appends nothing, re-seeds
 *        nothing, and leaves `initialized_at` UNCHANGED (other code may depend on that timestamp).
 *  (ii)  Switching demo↔personal-local repoints `ledger_path` at the OTHER mode's ledger WITHOUT
 *        wiping or re-seeding either ledger; the previous mode's events are preserved.
 *  (iii) A demo ledger is only seeded when it is actually empty/new (it is also event-level
 *        idempotent), so an existing demo ledger is never re-seeded.
 *
 * `initialized_at` is set once (first time the app leaves `unconfigured`/uninitialized) and preserved
 * thereafter.
 */
export async function switchMode(mode: AppConfig['mode'], options: OnboardingOptions = {}): Promise<AppConfig> {
  assertModeAllowed(mode, options)
  const current = await loadAppConfig(options)

  // (i) No-op when re-selecting the already-initialized current mode.
  if (current.mode === mode && current.initialized_at !== undefined && current.ledger_path !== undefined) {
    return current
  }

  const ledgerPath = resolveLedgerPathForMode(mode, options)
  const sourceLedgerPath = resolveSourceLedgerPath(options)

  // Preserve an existing initialized_at; only stamp it the first time we leave the uninitialized
  // state. Unconfigured stays uninitialized.
  const initializedAt = current.initialized_at ?? (mode === 'unconfigured' ? undefined : new Date().toISOString())

  const next: AppConfig = {
    ...current,
    mode,
    // (ii) Repoint at the target mode's ledger; unconfigured carries no ledger.
    ...(ledgerPath === undefined ? {} : { ledger_path: ledgerPath }),
    source_ledger_path: sourceLedgerPath,
    ...(initializedAt === undefined ? {} : { initialized_at: initializedAt }),
  }

  // (iii) Seed the demo ledger only when it is empty/new (event-level idempotent regardless).
  if (mode === 'demo' && ledgerPath !== undefined) {
    if ((await countLedgerEvents(ledgerPath)) === 0) {
      const store = new SQLiteEventStore(ledgerPath)
      try {
        await seedDemoLedger(store)
      } finally {
        store.close()
      }
    }
  }

  await saveAppConfig(next, options)
  return next
}

export async function getOnboardingProviderOptions(options: OnboardingOptions = {}) {
  const rowsByProvider = new Map((await buildProviderStatusRows({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })).map((row) => [row.provider_id, row]))

  return getProviderOptions(options.env ?? process.env).map((provider) => {
    const status = rowsByProvider.get(provider.provider_id)

    return {
      ...provider,
      support_level: status?.effective_support_level ?? provider.support_level,
      description: provider.description,
    }
  })
}

export async function resetOnboardingRuntime(options: OnboardingOptions = {}): Promise<void> {
  await resetDefaultDemoStore()

  const appConfigPath = resolveAppConfigPathForReset(options)
  const demoLedgerPath = resolveDemoLedgerPath(options)
  const personalLedgerPath = resolvePersonalLedgerPath(options)
  const sourceLedgerPath = resolveSourceLedgerPath(options)

  await Promise.all([
    rm(appConfigPath, { force: true }),
    rm(demoLedgerPath, { force: true }),
    rm(personalLedgerPath, { force: true }),
    rm(sourceLedgerPath, { force: true, recursive: true }),
  ])
}

function resolvePersonalLedgerPath({ cwd = process.cwd(), env = process.env as OnboardingEnv }: OnboardingOptions = {}): string {
  if (env.OWLFOLIO_PERSONAL_LEDGER_PATH !== undefined && env.OWLFOLIO_PERSONAL_LEDGER_PATH.length > 0) {
    return env.OWLFOLIO_PERSONAL_LEDGER_PATH
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', 'personal-ledger.sqlite')
}

function resolveAppConfigPathForReset({ cwd = process.cwd(), env = process.env as OnboardingEnv }: OnboardingOptions = {}): string {
  if (env.OWLFOLIO_APP_CONFIG_PATH !== undefined && env.OWLFOLIO_APP_CONFIG_PATH.length > 0) {
    return env.OWLFOLIO_APP_CONFIG_PATH
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', 'app-config.json')
}
