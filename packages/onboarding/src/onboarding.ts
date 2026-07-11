import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppConfig, AutomationSettings, MarketUniverseConfig, ProviderSelection, ShariahDefaults } from '@owlfolio/shared'
import { mergeAutomationSettings, mergeSavingsSleeveConfig, mergeValuationConfig } from '@owlfolio/shared'

import { loadAppConfig, resolveProjectRootFromCwd, resolveSourceLedgerPath, saveAppConfig } from './appConfigStore'
import { getProviderOptions, type ProviderReadiness } from './providerReadiness'
import { buildProviderStatusRows } from './providerStatus'

type OnboardingEnv = {
  [key: string]: string | undefined
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_PERSONAL_LEDGER_PATH?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_API_KEY?: string
}

type OnboardingOptions = {
  cwd?: string
  env?: OnboardingEnv
  /** Injectable clock (ISO timestamp) for deterministic vintage stamping in tests; defaults to now. */
  now?: string
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
    // Savings sleeve: when a write touches it, route through the merge so a non-default rate change STAMPS
    // its vintage (`savings_rate_set_at`). NOTE: there is no dedicated owner-config input that sets the
    // compliant savings rate today, so in practice this only fires if a future settings write supplies one.
    ...(update.savings === undefined
      ? {}
      : {
        savings: mergeSavingsSleeveConfig(
          { ...current.savings, ...update.savings },
          {
            now: options.now ?? new Date().toISOString(),
            ...(current.savings?.savings_expected_profit_rate === undefined
              ? {}
              : { previousRate: current.savings.savings_expected_profit_rate }),
          },
        ),
      }),
    // Phase 4 (book alignment): the required-return setting — same vintage-stamping merge shape.
    ...(update.valuation === undefined
      ? {}
      : {
        valuation: mergeValuationConfig(
          { ...current.valuation, ...update.valuation },
          {
            now: options.now ?? new Date().toISOString(),
            ...(current.valuation?.required_return === undefined
              ? {}
              : { previousRate: current.valuation.required_return }),
          },
        ),
      }),
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
  const config = await updateOnboardingConfig(update, options)
  const ledgerPath = resolvePersonalLedgerPath(options)
  const sourceLedgerPath = resolveSourceLedgerPath(options)

  const initializedConfig: AppConfig = {
    ...config,
    ledger_path: ledgerPath,
    source_ledger_path: sourceLedgerPath,
    initialized_at: new Date().toISOString(),
  }

  await saveAppConfig(initializedConfig, options)
  return initializedConfig
}

/**
 * Resolve the durable ledger path for a chosen, initializable mode. `unconfigured` has no ledger.
 */
function resolveLedgerPathForMode(mode: AppConfig['mode'], options: OnboardingOptions): string | undefined {
  if (mode === 'personal-local') {
    return resolvePersonalLedgerPath(options)
  }
  return undefined
}

/**
 * Idempotent, non-destructive mode switch / re-init (two-state mode model). Unlike the first-run
 * `initializeSelectedMode`, this is safe to call on RE-ENTRY:
 *
 *  (i)  Re-selecting the CURRENT mode (already initialized) is a no-op — it appends nothing and leaves
 *       `initialized_at` UNCHANGED (other code may depend on that timestamp).
 *  (ii) Switching between `unconfigured` and `personal-local` repoints `ledger_path` WITHOUT wiping the
 *       personal ledger; its events are preserved.
 *
 * `initialized_at` is set once (first time the app leaves `unconfigured`/uninitialized) and preserved
 * thereafter.
 */
export async function switchMode(mode: AppConfig['mode'], options: OnboardingOptions = {}): Promise<AppConfig> {
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
  const appConfigPath = resolveAppConfigPathForReset(options)
  const personalLedgerPath = resolvePersonalLedgerPath(options)
  const sourceLedgerPath = resolveSourceLedgerPath(options)

  await Promise.all([
    rm(appConfigPath, { force: true }),
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
