import type { AppConfig } from '@owlfolio/shared'

import { selectActiveModeStatus, type ActiveModeStatus } from './activeModeStatus'
import { isUnconfiguredForUser } from './modeView'
import { getProviderReadinessSnapshot } from './onboarding'
import { evaluateOnboardingGate } from './onboardingGate'
import { resolveModelIdForProvider } from './workflow'

/**
 * Server-side resolver for the persistent active-mode/provider/model indicator (onboarding S2).
 *
 * Pulls the pure `selectActiveModeStatus` inputs from the REAL sources of truth and nothing else:
 *  - mode / provider_id / model_id          → app config
 *  - provider-connected                      → `getProviderReadinessSnapshot` (is the active provider usable)
 *  - capital-set                             → the S4 onboarding gate's `investable_capital` missing-item
 *                                              (ledger `projectInvestableCapital`); readiness does NOT cover capital
 *
 * DISPLAY ONLY: no init, no switch, no mutation. `unconfigured` / `demo` short-circuit before any
 * readiness or ledger work, since neither needs the provider or the gate to be resolved.
 *
 * Production honesty: a persisted `demo` config (the test-only deterministic harness) must NOT present
 * itself to a real user as a configured "Demo · mock-provider (sample data)" workspace. Outside the
 * test harness `isUnconfiguredForUser` collapses it to the honest "not set up — connect a provider"
 * indicator (the nav indicator is mounted app-wide). Under playwright/vitest demo stays a legitimate
 * configured mode so the e2e/unit demo path keeps rendering.
 */
export async function resolveActiveModeStatus(
  config: AppConfig,
  env: { readonly [key: string]: string | undefined } = process.env,
): Promise<ActiveModeStatus> {
  if (isUnconfiguredForUser(config, env)) {
    return selectActiveModeStatus({
      mode: 'unconfigured',
      providerConnected: false,
      capitalSet: false,
      providerId: config.provider.provider_id,
      modelId: resolveModelIdForProvider(config),
    })
  }

  if (config.mode !== 'personal-local') {
    return selectActiveModeStatus({
      mode: config.mode,
      providerConnected: false,
      capitalSet: false,
      providerId: config.provider.provider_id,
      modelId: resolveModelIdForProvider(config),
    })
  }

  const readiness = await getProviderReadinessSnapshot(config)
  const providerConnected = readiness.is_ready

  const gate = await evaluateOnboardingGate({
    ledgerPath: config.ledger_path,
    configuredProviderReady: providerConnected,
  })
  const capitalSet = !gate.missing_items.some((item) => item.id === 'investable_capital')

  return selectActiveModeStatus({
    mode: config.mode,
    providerConnected,
    capitalSet,
    providerId: config.provider.provider_id,
    modelId: resolveModelIdForProvider(config),
  })
}
