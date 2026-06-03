import { createElement, type ReactNode } from 'react'
import type { Metadata } from 'next'

import './globals.css'
import { AppShell } from '../components/designSystem'

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
      null,
      createElement(AppShell, null, children),
    ),
  )
}
