'use client'

import { createElement, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** The subset of next/navigation's router this component uses — a testable seam. */
type LiveRefreshRouter = { refresh: () => void }

/**
 * useRouter, tolerant of running OUTSIDE an app-router mount (static server render in unit tests).
 * See RefreshPricesButton.useSafeRouter — same seam; here the fallback never fires because the
 * interval only starts in a mounted browser effect.
 */
function useSafeRouter(): LiveRefreshRouter {
  try {
    return useRouter()
  } catch {
    return { refresh: () => { window.location.reload() } }
  }
}

/**
 * Makes the "live" observatory actually live: while mounted (the observatory renders it only when a
 * run is executing), re-fetches the server snapshot on an interval via router.refresh(). The
 * indicator is visible — the page never refreshes silently.
 */
export function PipelineLiveRefresh({ label, intervalMs = 5000 }: { label: string; intervalMs?: number }): ReactNode {
  const router = useSafeRouter()

  useEffect(() => {
    const timer = setInterval(() => { router.refresh() }, intervalMs)
    return () => clearInterval(timer)
  }, [router, intervalMs])

  return createElement(
    'span',
    {
      'data-testid': 'pipeline-live-refresh',
      style: {
        alignItems: 'center',
        color: 'var(--owl-color-amber)',
        display: 'inline-flex',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        gap: '0.35rem',
        letterSpacing: '0.05em',
      },
    },
    createElement('span', {
      'aria-hidden': 'true',
      style: { background: 'var(--owl-color-amber)', borderRadius: '50%', display: 'inline-block', height: '0.45rem', width: '0.45rem' },
    }),
    label,
  )
}
