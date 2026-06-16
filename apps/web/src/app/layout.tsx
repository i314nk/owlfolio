import { createElement, type ReactNode } from 'react'
import type { Metadata } from 'next'

import './globals.css'
import { AppShell } from '../components/designSystem'
import { getOnboardingState } from '../lib/onboarding'
import { resolveActiveModeStatus } from '../lib/resolveActiveModeStatus'

export const metadata: Metadata = {
  title: 'Owlfolio Command Center',
  description: 'Local Shariah-by-design investment workflow dashboard',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const onboarding = await getOnboardingState()
  const activeModeStatus = await resolveActiveModeStatus(onboarding.config)

  return createElement(
    'html',
    { lang: 'en' },
    createElement(
      'body',
      null,
      createElement(
        AppShell,
        { isSetupComplete: onboarding.is_initialized, activeModeStatus },
        children,
      ),
    ),
  )
}
