import { createElement } from 'react'

import { ProviderKeysPanel } from '../../../components/ProviderKeysPanel'
import { ActiveModeIndicator } from '../../../components/ActiveModeIndicator'
import { BoundariesFooter } from '../../../components/designSystem'
import { getOnboardingState } from '../../../lib/onboarding'
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

  return createElement(
    'div',
    null,
    createElement(ActiveModeIndicator, { status: activeModeStatus }),
    createElement(ProviderKeysPanel, props),
    createElement(ProviderKeysCopyScript, {}),
    createElement(BoundariesFooter, {}),
  )
}
