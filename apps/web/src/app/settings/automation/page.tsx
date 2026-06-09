import { createElement } from 'react'

import { mergeAutomationSettings } from '@owlfolio/shared'

import { AutomationSettingsPanel } from '../../../components/AutomationSettingsPanel'
import { PageHeader } from '../../../components/designSystem'
import { getOnboardingState } from '../../../lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function AutomationSettingsPage() {
  const state = await getOnboardingState()
  const automation = mergeAutomationSettings(state.config.automation)

  return createElement(
    'main',
    { className: 'owl-workflow-page owl-automation-settings-page' },
    createElement(PageHeader, {
      eyebrow: 'Settings',
      title: 'Settings / Pipeline Automation',
      description: 'Configure which research-pipeline stages run automatically and at what cadence. Cadence settings take effect when the local worker runs — they do not imply live trading or automatic investment decisions.',
    }),
    createElement(AutomationSettingsPanel, { initialAutomation: automation }),
  )
}
