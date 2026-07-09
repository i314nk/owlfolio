import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { createElement } from 'react'

import { ProviderKeysPanel } from '../../../components/ProviderKeysPanel'
import { ActiveModeIndicator } from '../../../components/ActiveModeIndicator'
import { GuidedSetupPanel } from '../../../components/GuidedSetupPanel'
import { getModelCapabilityNote } from '../../../lib/modelCapability'
import { BoundariesFooter } from '../../../components/designSystem'
import { getOnboardingProviderOptions, getOnboardingState } from '../../../lib/onboarding'
import { buildProviderKeysPanelProps } from '../../../lib/providerKeysView'
import { getOpenRouterModelOptions } from '../../../lib/openRouterModelOptions'
import { resolveProjectRootFromCwd } from '../../../lib/appConfigStore'
import { resolveModelIdForProvider } from '../../../lib/workflow'
import { resolveActiveModeStatus } from '../../../lib/resolveActiveModeStatus'
import { ProviderKeysCopyScript } from './ProviderKeysCopyScript'

export const dynamic = 'force-dynamic'

/** Walk up from `dir` looking for a `.git` entry — true iff the dir is inside a git working tree. */
function isInsideGitWorkTree(dir: string): boolean {
  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, '.git'))) {
      return true
    }
    const parent = dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

export default async function ProviderKeysSettingsPage() {
  const state = await getOnboardingState()
  const repoRoot = process.env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(process.cwd())
  // The env-file safety warning only matters when the project dir is actually a git working tree; a local
  // sandbox project dir that is not a git repo can never commit secrets, so suppress the false warning.
  const repoIsGitWorkTree = isInsideGitWorkTree(repoRoot)

  const props = await buildProviderKeysPanelProps({
    ledgerPath: state.config.ledger_path,
    repoRoot,
    repoIsGitWorkTree,
    processEnv: process.env,
    activeProviderId: state.config.provider.provider_id,
    activeModel: resolveModelIdForProvider(state.config),
  })

  // Echo the same persistent indicator at the top of the fix destination so the current state is
  // unambiguous here too. DISPLAY ONLY — derived from config + readiness + the S4 gate.
  const activeModeStatus = await resolveActiveModeStatus(state.config)

  // Guided-setup input: the provider options for the shared provider/model picker. (The onboarding gate's
  // outstanding items are rendered by ProviderKeysPanel via buildProviderKeysPanelProps; capital is set on
  // the Portfolio page, surfaced as a gate hint there.)
  const providerOptions = await getOnboardingProviderOptions({ env: process.env })

  // OpenRouter's full live catalog for the searchable model picker (cached, fail-closed to the curated
  // shortlist when offline / unreachable). Only the OpenRouter connection consumes it.
  const openRouterModels = await getOpenRouterModelOptions(process.env)

  return createElement(
    'div',
    null,
    createElement(ActiveModeIndicator, { status: activeModeStatus }),
    createElement(GuidedSetupPanel, {
      initialConfig: state.config,
      initialIsInitialized: state.is_initialized,
      providerOptions,
      openRouterModels,
      // The SAVED capability verdict for the active provider+model (persisted by the probe).
      modelCapability: await getModelCapabilityNote(state.config.provider.provider_id, state.config.provider.model_id),
    }),
    createElement(ProviderKeysPanel, props),
    createElement(ProviderKeysCopyScript, {}),
    createElement(BoundariesFooter, {}),
  )
}
