import { createElement } from 'react'

import { mergeAutomationSettings } from '@owlfolio/shared'
import { resolveLocale } from '@owlfolio/shared/appConfig'

import { AutomationSettingsPanel } from '../../../components/AutomationSettingsPanel'
import { ShariahSettingsPanel } from '../../../components/ShariahSettingsPanel'
import { RequiredReturnPanel } from '../../../components/RequiredReturnPanel'
import { mergeValuationConfig } from '@owlfolio/shared/appConfig'
import { RouteHeader } from '../../../components/designSystem'
import { getOnboardingState } from '../../../lib/onboarding'
import { englishContentNote, t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function AutomationSettingsPage() {
  const state = await getOnboardingState()
  const automation = mergeAutomationSettings(state.config.automation)
  const locale = resolveLocale(state.config.language)
  const note = englishContentNote(locale)

  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide owl-automation-settings-page' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: t(locale, 'sa_kicker'),
      title: t(locale, 'sa_title'),
      description: t(locale, 'sa_desc'),
    }),
    createElement('hr', { className: 'owl-rule' }),
    note === undefined ? null : createElement(
      'p',
      { 'data-testid': 'english-content-note', dir: 'rtl', className: 'owl-row-helper', style: { border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: '1rem 0 0', padding: '0.6rem 0.8rem' } },
      note,
    ),
    createElement(AutomationSettingsPanel, { initialAutomation: automation }),
    createElement('hr', { className: 'owl-rule' }),
    // The Shariah screening opt-out (owner-approved 2026-07-15): fail-visible OFF, default ON.
    createElement(ShariahSettingsPanel, { initialEnabled: state.config.shariah.enabled }),
    createElement('hr', { className: 'owl-rule' }),
    // Phase 4 (book alignment): the flat required return — the valuation discount + active-vs-passive hurdle.
    createElement(RequiredReturnPanel, {
      initialValuation: mergeValuationConfig(state.config.valuation),
      configured: state.config.valuation?.required_return_set_at !== undefined,
    }),
  )
}
