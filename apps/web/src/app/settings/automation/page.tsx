import { createElement } from 'react'

import { mergeAutomationSettings } from '@owlfolio/shared'

import { AutomationSettingsPanel } from '../../../components/AutomationSettingsPanel'
import { RouteHeader } from '../../../components/designSystem'
import { getOnboardingState } from '../../../lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function AutomationSettingsPage() {
  const state = await getOnboardingState()
  const automation = mergeAutomationSettings(state.config.automation)

  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide owl-automation-settings-page' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: 'Settings',
      title: 'Settings / Pipeline Automation',
      description: 'Configure which research-pipeline stages run automatically and at what cadence. Cadence settings take effect when the local worker runs — they do not imply live trading or automatic investment decisions.',
    }),
    createElement(AutomationSettingsPanel, { initialAutomation: automation }),
  )
}
