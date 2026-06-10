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
      description: 'Tune what your agent does autonomously — the research engine, monitoring cadences, and what stays user-confirmed. Cadence settings take effect when the local worker runs; they do not imply live trading or automatic investment decisions.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createElement(AutomationSettingsPanel, { initialAutomation: automation }),
  )
}
