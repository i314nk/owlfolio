import { createElement } from 'react'

import { CommandCenter } from '../components/CommandCenter'
import { getSetupAwareCommandCenter } from '../lib/demo'
import { getOnboardingState } from '../lib/onboarding'

export default async function HomePage() {
  const state = await getOnboardingState()
  const dashboard = await getSetupAwareCommandCenter(state)

  return createElement(CommandCenter, { dashboard })
}
