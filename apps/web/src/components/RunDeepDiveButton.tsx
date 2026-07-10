'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { resolveErrorMessage } from '../app/research/new/resolveErrorMessage'

// NOTE: createElement (not JSX) per the repo convention — apps/web sets `jsx: preserve`, so any
// component imported under vitest must avoid JSX syntax to transform (see ResearchCasePanel).

// The router subset this action uses — a seam so the POST+refresh logic is unit-testable without a DOM.
export type DeepDiveRouter = {
  refresh: () => void
}

/**
 * Approve the deep dive for a case paused at the post-gates approval pause (deep_dive_approval:
 * 'review'). Appends deep_dive_run_requested via the API and REFRESHES the dossier in place so the
 * run-progress view takes over — never a raw-JSON navigation (the dogfood find this replaces: the
 * old plain-HTML form navigated the browser to the API response).
 */
export async function submitRunDeepDive(
  deps: { fetch: typeof fetch; router: DeepDiveRouter; caseId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Bind to the global (see submitReRun): the browser fetch rejects a non-Window `this`.
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch(`/api/research/${deps.caseId}/deep-dive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: resolveErrorMessage(body) }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to start the deep dive' }
  }
}

function useSafeRouter(): DeepDiveRouter {
  try {
    return useRouter()
  } catch {
    return {
      refresh: () => { window.location.reload() },
    }
  }
}

const buttonStyle: CSSProperties = {
  background: 'var(--owl-color-accent)',
  border: 0,
  borderRadius: '999px',
  color: '#ffffff',
  font: 'inherit',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 900,
  padding: '0.75rem 1.2rem',
}

export function RunDeepDiveButton({ caseId }: { caseId: string }): ReactNode {
  const router = useSafeRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onClick(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    const result = await submitRunDeepDive({ fetch, router, caseId })
    if (!result.ok) {
      setError(result.error)
      setSubmitting(false)
    }
    // On success the refresh re-renders the page into the run-progress view; keep the button in its
    // "Starting…" state until that happens rather than flashing back to clickable.
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.4rem' } },
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'run-deep-dive-button',
        style: { ...buttonStyle, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 },
        disabled: submitting,
        onClick: () => void onClick(),
      },
      submitting ? 'Starting deep dive…' : 'Run deep dive',
    ),
    error === undefined
      ? null
      : createElement(
          'p',
          {
            'data-testid': 'run-deep-dive-error',
            style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } as CSSProperties,
          },
          error,
        ),
  )
}
