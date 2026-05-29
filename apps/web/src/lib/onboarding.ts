import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig, MarketUniverseConfig, ProviderSelection, ShariahDefaults } from '@owlfolio/shared'

import { loadAppConfig, resolveProjectRootFromCwd, resolveSourceLedgerPath, saveAppConfig } from './appConfigStore'
import { resetDefaultDemoStore, resolveDemoLedgerPath } from './demo'
import { seedDemoLedger } from './demoSeed'
import { getProviderOptions, getProviderReadiness, type ProviderReadiness } from './providerReadiness'

type OnboardingEnv = {
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PERSONAL_LEDGER_PATH?: string
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
    provider: {
      ...current.provider,
      ...update.provider,
    },
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

export async function getProviderReadinessSnapshot(config: AppConfig, options: OnboardingOptions = {}): Promise<ProviderReadiness> {
  return getProviderReadiness(config.provider.provider_id, options.env ?? {})
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

export function getOnboardingProviderOptions() {
  return getProviderOptions()
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
