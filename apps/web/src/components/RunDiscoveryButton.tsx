'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** The subset of next/navigation's router these actions use — a testable seam. */
export type RunDiscoveryRouter = {
  refresh: () => void
}

/**
 * useRouter, tolerant of running OUTSIDE an app-router mount (static server render in unit tests,
 * where panels render via renderToStaticMarkup with no router context). In the app it is the real
 * router; outside it degrades to a location-based shim — the button only navigates on user
 * interaction, which never happens in a static render.
 */
function useSafeRouter(): RunDiscoveryRouter {
  try {
    return useRouter()
  } catch {
    return {
      refresh: () => { window.location.reload() },
    }
  }
}

const noteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.04em',
  margin: 0,
}

export type RunDiscoveryDeps = {
  fetch: typeof fetch
  router: RunDiscoveryRouter
}

/**
 * On-demand discovery run — POSTs to /api/discovery/run, then refreshes the page on success.
 * No confirm step: discovery harvest is a read-only/zero-spend operation.
 */
export function RunDiscoveryButton(
  { deps }: { deps?: RunDiscoveryDeps } = {},
): ReactNode {
  const routerFromHook = useSafeRouter()
  const router = deps?.router ?? routerFromHook
  const fetchFn = deps?.fetch ?? fetch

  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onClick(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    setNote(undefined)
    try {
      const doFetch = fetchFn.bind(globalThis)
      const response = await doFetch('/api/discovery/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok) {
        router.refresh()
        setNote('Discovery started — refreshing…')
      } else {
        setError(
          typeof body.error === 'string' && body.error.length > 0
            ? body.error
            : 'Discovery run failed — try again later.',
        )
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to start discovery')
    }
    setSubmitting(false)
  }

  return createElement(
    'div',
    { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', marginTop: '0.4rem' } },
    createElement(
      'button',
      {
        type: 'button',
        className: 'owl-button owl-button-secondary owl-focusable',
        style: { cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 } as CSSProperties,
        disabled: submitting,
        'data-testid': 'run-discovery',
        onClick: () => void onClick(),
      },
      submitting ? 'Running…' : 'Run discovery',
    ),
    note === undefined ? null : createElement('p', { 'data-testid': 'run-discovery-note', style: noteStyle }, note),
    error === undefined
      ? null
      : createElement(
          'p',
          { 'data-testid': 'run-discovery-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          error,
        ),
  )
}
