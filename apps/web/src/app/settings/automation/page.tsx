import { createElement } from 'react'

import { DEFAULT_SAVINGS_SLEEVE, mergeAutomationSettings } from '@owlfolio/shared'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'

import { AutomationSettingsPanel } from '../../../components/AutomationSettingsPanel'
import { SavingsAnchorPanel } from '../../../components/SavingsAnchorPanel'
import { RequiredReturnPanel } from '../../../components/RequiredReturnPanel'
import { mergeValuationConfig } from '@owlfolio/shared/appConfig'
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
    createElement('hr', { className: 'owl-rule' }),
    // Phase 4 (book alignment): the flat required return — the valuation discount + active-vs-passive hurdle.
    createElement(RequiredReturnPanel, {
      initialValuation: mergeValuationConfig(state.config.valuation),
      configured: state.config.valuation?.required_return_set_at !== undefined,
    }),
    createElement('hr', { className: 'owl-rule' }),
    // The compliant savings anchor (F.2): the user-owned number behind the deployment hurdle + sizing.
    createElement(SavingsAnchorPanel, {
      initialSavings: state.config.savings ?? DEFAULT_SAVINGS_SLEEVE,
      configured: state.config.savings?.savings_rate_set_at !== undefined,
      equityPremium: buffettMungerStrategy.valuation.equity_premium,
    }),
  )
}
