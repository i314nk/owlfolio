import { createElement, type ReactNode } from 'react'
import type { Metadata } from 'next'

import './globals.css'
import { AppShell } from '../components/designSystem'
import { localeDir, resolveLocale, resolveTheme } from '@owlfolio/shared'

import { getOnboardingState } from '../lib/onboarding'
import { resolveActiveModeStatus } from '../lib/resolveActiveModeStatus'
import { resolveModelSwitcher } from '../lib/resolveModelSwitcher'

export const metadata: Metadata = {
  title: 'Owner’s Manual Command Center',
  description: 'Local Shariah-by-design investment workflow dashboard',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const onboarding = await getOnboardingState()
  const activeModeStatus = await resolveActiveModeStatus(onboarding.config)
  const modelSwitcher = await resolveModelSwitcher(onboarding.config)
  const theme = resolveTheme(onboarding.config.appearance)
  const locale = resolveLocale(onboarding.config.language)

  return createElement(
    'html',
    { 'data-owl-theme': theme, dir: localeDir(locale), lang: locale },
    createElement(
      'body',
      null,
      createElement(
        AppShell,
        {
          isSetupComplete: onboarding.is_initialized,
          activeModeStatus,
          theme,
          locale,
          ...(modelSwitcher === undefined ? {} : { modelSwitcher }),
        },
        children,
      ),
    ),
  )
}
