import { createElement } from 'react'

import { ProviderKeysPanel } from '../../../components/ProviderKeysPanel'
import { BoundariesFooter } from '../../../components/designSystem'
import { getOnboardingState } from '../../../lib/onboarding'
import { buildProviderKeysPanelProps } from '../../../lib/providerKeysView'
import { resolveProjectRootFromCwd } from '../../../lib/appConfigStore'
import { resolveModelIdForProvider } from '../../../lib/workflow'
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

  return createElement(
    'div',
    null,
    createElement(ProviderKeysPanel, props),
    createElement(ProviderKeysCopyScript, {}),
    createElement(BoundariesFooter, {}),
  )
}
