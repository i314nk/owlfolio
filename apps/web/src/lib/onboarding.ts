import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig, MarketUniverseConfig, ProviderSelection, ShariahDefaults } from '@owlfolio/shared'

import { loadAppConfig, resolveProjectRootFromCwd, resolveSourceLedgerPath, saveAppConfig } from './appConfigStore'
import { resetDefaultDemoStore, resolveDemoLedgerPath } from './demo'
import { seedDemoLedger } from './demoSeed'
import { getProviderOptions, type ProviderReadiness } from './providerReadiness'
import { buildProviderStatusRows } from './providerStatus'

type OnboardingEnv = {
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PERSONAL_LEDGER_PATH?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
  CODEX_ACCESS_TOKEN?: string
  OWLFOLIO_CODEX_AUTH_PATH?: string
  CODEX_HOME?: string
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
    support_level: row.effective_support_level,
    is_ready: row.is_ready,
    auth_source: row.auth_source,
    status_label: row.status_label,
  }
}

export async function initializeSelectedMode(update: OnboardingConfigUpdate = {}, options: OnboardingOptions = {}): Promise<AppConfig> {
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

export async function getOnboardingProviderOptions(options: OnboardingOptions = {}) {
  const rowsByProvider = new Map((await buildProviderStatusRows({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })).map((row) => [row.provider_id, row]))

  return getProviderOptions().map((provider) => {
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
