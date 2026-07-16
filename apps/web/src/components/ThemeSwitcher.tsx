'use client'

import { createElement, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// The appConfig SUBPATH: the shared index re-exports runtimeBackup (node:fs), which a client
// bundle cannot chunk — appConfig is pure types/constants.
import { OWL_THEMES, type OwlThemeId } from '@owlfolio/shared/appConfig'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** useRouter, tolerant of static server renders (unit tests) — mirrors RunDiscoveryButton. */
function useSafeRouter(): { refresh: () => void } {
  try {
    return useRouter()
  } catch {
    return { refresh: () => { window.location.reload() } }
  }
}

/**
 * The top-right palette quick-switcher (owner, 2026-07-16). Persists to the local app config via
 * POST /api/settings/appearance, applies instantly on the client (the data-owl-theme attribute),
 * and router.refresh() re-renders the server layout so SSR agrees on the next navigation.
 */
export function ThemeSwitcher({ current }: { current: OwlThemeId }): ReactNode {
  const router = useSafeRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  async function onChange(theme: string): Promise<void> {
    setSaving(true)
    setError(false)
    document.documentElement.setAttribute('data-owl-theme', theme)
    try {
      const doFetch = fetch.bind(globalThis)
      const response = await doFetch('/api/settings/appearance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      router.refresh()
    } catch {
      setError(true)
      document.documentElement.setAttribute('data-owl-theme', current)
    }
    setSaving(false)
  }

  return createElement(
    'label',
    { className: 'owl-shell-context-chip', style: { alignItems: 'center', display: 'inline-flex', gap: '0.4rem', marginLeft: 'auto' } },
    createElement('span', { className: 'owl-shell-context-label' }, 'Palette'),
    createElement(
      'select',
      {
        'aria-label': 'UI color palette',
        className: 'owl-focusable',
        'data-testid': 'theme-switcher',
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
      ...OWL_THEMES.map((t) => createElement('option', { key: t.id, value: t.id }, t.label)),
    ),
    error ? createElement('span', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-2xs)' } }, 'not saved') : null,
  )
}
