'use client'

import { createElement, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { OWL_LOCALES, localeDir, type OwlLocale } from '@owlfolio/shared/appConfig'

import { t } from '../lib/i18n'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** useRouter, tolerant of static server renders (unit tests) — mirrors ThemeSwitcher. */
function useSafeRouter(): { refresh: () => void } {
  try {
    return useRouter()
  } catch {
    return { refresh: () => { window.location.reload() } }
  }
}

/**
 * The top-right language quick-switcher (i18n S1, 2026-07-17). Persists to the local app config,
 * applies lang + dir on <html> instantly, and router.refresh() re-renders the server layout so
 * the chrome strings follow.
 */
export function LanguageSwitcher({ current }: { current: OwlLocale }): ReactNode {
  const router = useSafeRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  async function onChange(language: string): Promise<void> {
    setSaving(true)
    setError(false)
    const prevLang = document.documentElement.lang
    const prevDir = document.documentElement.dir
    document.documentElement.lang = language
    document.documentElement.dir = localeDir(language as OwlLocale)
    try {
      const doFetch = fetch.bind(globalThis)
      const response = await doFetch('/api/settings/language', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      router.refresh()
    } catch {
      setError(true)
      document.documentElement.lang = prevLang
      document.documentElement.dir = prevDir
    }
    setSaving(false)
  }

  return createElement(
    'label',
    { className: 'owl-shell-context-chip', style: { alignItems: 'center', display: 'inline-flex', gap: '0.4rem' } },
    createElement('span', { className: 'owl-shell-context-label' }, t(current, 'language')),
    createElement(
      'select',
      {
        'aria-label': 'UI language',
        className: 'owl-focusable',
        'data-testid': 'language-switcher',
        defaultValue: current,
        disabled: saving,
        onChange: (event: { target: { value: string } }) => void onChange(event.target.value),
        style: {
          background: 'var(--owl-color-panel-deep)',
          border: '1px solid var(--owl-color-border)',
          borderRadius: '0.4rem',
          color: 'var(--owl-color-text)',
          cursor: saving ? 'progress' : 'pointer',
          font: 'inherit',
          fontSize: 'var(--owl-text-xs)',
          padding: '0.1rem 0.35rem',
        },
      },
      ...OWL_LOCALES.map((l) => createElement('option', { key: l.id, value: l.id }, l.label)),
    ),
    error ? createElement('span', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-2xs)' } }, '!') : null,
  )
}
