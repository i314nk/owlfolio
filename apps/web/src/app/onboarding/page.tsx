import { createElement } from 'react'

import { OnboardingWizard } from './OnboardingWizard'
import { getOnboardingProviderOptions, getOnboardingState, getProviderReadinessSnapshot } from '../../lib/onboarding'

export default async function OnboardingPage() {
  const state = await getOnboardingState()
  const readiness = await getProviderReadinessSnapshot(state.config)

  return createElement(OnboardingWizard, {
    initialConfig: state.config,
    initialIsInitialized: state.is_initialized,
    initialReadiness: readiness,
    providerOptions: await getOnboardingProviderOptions(),
  })
}
