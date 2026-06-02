import { createElement, type ReactNode } from 'react'
import type { Metadata } from 'next'

import { AppNavigation } from '../components/AppNavigation'

export const metadata: Metadata = {
  title: 'Owlfolio Command Center',
  description: 'Local Shariah-by-design investment workflow dashboard',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return createElement(
    'html',
    { lang: 'en' },
    createElement(
      'body',
      { style: { margin: 0 } },
      createElement(AppNavigation),
      children,
    ),
  )
}
