import { createElement } from 'react'

import { ProviderKeysPanel } from '../../../components/ProviderKeysPanel'
import { ActiveModeIndicator } from '../../../components/ActiveModeIndicator'
import { GuidedSetupPanel } from '../../../components/GuidedSetupPanel'
import { BoundariesFooter } from '../../../components/designSystem'
import { getOnboardingProviderOptions, getOnboardingState, getProviderReadinessSnapshot } from '../../../lib/onboarding'
import { evaluateOnboardingGate } from '../../../lib/onboardingGate'
import { buildProviderKeysPanelProps } from '../../../lib/providerKeysView'
import { resolveProjectRootFromCwd } from '../../../lib/appConfigStore'
import { resolveModelIdForProvider } from '../../../lib/workflow'
import { resolveActiveModeStatus } from '../../../lib/resolveActiveModeStatus'
import { ProviderKeysCopyScript } from './ProviderKeysCopyScript'

export const dynamic = 'force-dynamic'

export default async function ProviderKeysSettingsPage() {
  const state = await getOnboardingState()
  const repoRoot = process.env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(process.cwd())

  const props = await buildProviderKeysPanelProps({
    ledgerPath: state.config.ledger_path,
    repoRoot,
    processEnv: process.env,
    activeProviderId: state.config.provider.provider_id,
    activeModel: resolveModelIdForProvider(state.config),
  })

  // Echo the same persistent indicator at the top of the fix destination so the current state is
  // unambiguous here too. DISPLAY ONLY — derived from config + readiness + the S4 gate.
  const activeModeStatus = await resolveActiveModeStatus(state.config)

  // Guided-setup inputs: provider options for the shared toggle/dropdown, and the S4 gate's outstanding
  // items so the end-to-end path (mode → provider → capital → run) stays visible. The frontier-LLM gate
  // item is satisfied by verified readiness for the configured provider (readiness IS the connection),
  // mirroring resolveActiveModeStatus.
  const providerOptions = await getOnboardingProviderOptions({ env: process.env })
  const configuredProviderReady = state.config.mode === 'personal-local'
    ? (await getProviderReadinessSnapshot(state.config, { env: process.env })).is_ready
    : false
  const gate = await evaluateOnboardingGate({
    ledgerPath: state.config.ledger_path,
    configuredProviderReady,
  })

  return createElement(
    'div',
    null,
    createElement(ActiveModeIndicator, { status: activeModeStatus }),
    createElement(GuidedSetupPanel, {
      initialConfig: state.config,
      initialIsInitialized: state.is_initialized,
      providerOptions,
      missingItems: gate.missing_items,
    }),
    createElement(ProviderKeysPanel, props),
    createElement(ProviderKeysCopyScript, {}),
    createElement(BoundariesFooter, {}),
  )
}
