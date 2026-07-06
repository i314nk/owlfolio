'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** The subset of next/navigation's router these actions use — a testable seam. */
export type RefreshPricesRouter = {
  refresh: () => void
}

/**
 * useRouter, tolerant of running OUTSIDE an app-router mount (static server render in unit tests,
 * where panels render via renderToStaticMarkup with no router context). In the app it is the real
 * router; outside it degrades to a location-based shim — the button only navigates on user
 * interaction, which never happens in a static render.
 */
function useSafeRouter(): RefreshPricesRouter {
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

export type RefreshPricesDeps = {
  fetch: typeof fetch
  router: RefreshPricesRouter
}

/**
 * On-demand price refresh — POSTs to /api/prices/refresh, then refreshes the page on success.
 * No confirm step: price refresh is read-only/zero-spend, a single click triggers the POST.
 */
export function RefreshPricesButton(
  { deps }: { deps?: RefreshPricesDeps } = {},
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
      const response = await doFetch('/api/prices/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok) {
        const refreshed: string[] = body.refreshed ?? []
        const buyZoneHits: string[] = body.buy_zone_hits ?? []
        router.refresh()
        setNote(
          `Refreshed ${refreshed.length}${buyZoneHits.length > 0 ? ' · ' + String(buyZoneHits.length) + ' entered buy zone' : ''}`,
        )
      } else {
        setError(
          typeof body.error === 'string' && body.error.length > 0
            ? body.error
            : 'Price refresh failed — try again later.',
        )
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to refresh prices')
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
        'data-testid': 'refresh-prices',
        onClick: () => void onClick(),
      },
      submitting ? 'Refreshing…' : 'Refresh prices',
    ),
    note === undefined ? null : createElement('p', { 'data-testid': 'refresh-prices-note', style: noteStyle }, note),
    error === undefined
      ? null
      : createElement(
          'p',
          { 'data-testid': 'refresh-prices-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          error,
        ),
  )
}
