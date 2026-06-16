import type { AppConfig } from '@owlfolio/shared'

import { selectActiveModeStatus, type ActiveModeStatus } from './activeModeStatus'
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
 */
export async function resolveActiveModeStatus(config: AppConfig): Promise<ActiveModeStatus> {
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
