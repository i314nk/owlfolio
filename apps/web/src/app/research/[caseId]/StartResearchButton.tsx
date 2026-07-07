'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// NOTE: this file uses `createElement` rather than JSX to match the repo convention — the apps/web Next
// tsconfig sets `jsx: preserve`, so any component IMPORTED under vitest must avoid JSX syntax to
// transform correctly (see ResearchCasePanel / PipelineObservatory, both createElement-only and unit-tested).

export type StartResearchButtonProps = {
  caseId: string
}

// A router-shaped seam so the POST+navigate logic is unit-testable without a DOM.
export type StartResearchRouter = {
  refresh: () => void
}

/**
 * POST to /api/research/[caseId]/start-run and, on success, refresh the page so the spinner view takes
 * over (the worker is now running the research). On error, show an inline message.
 */
export async function submitStartResearch(
  deps: { fetch: typeof fetch; router: StartResearchRouter; caseId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch(`/api/research/${deps.caseId}/start-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message =
        typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string'
          ? (body as Record<string, unknown>).error as string
          : 'Failed to start research'
      return { ok: false, error: message }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to start the research run' }
  }
}

export function StartResearchButton({ caseId }: StartResearchButtonProps): ReactNode {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onClick(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    const result = await submitStartResearch({ fetch, router, caseId })
    if (!result.ok) {
      setError(result.error)
    }
    setSubmitting(false)
  }

  const buttonStyle: CSSProperties = {
    cursor: submitting ? 'not-allowed' : 'pointer',
    opacity: submitting ? 0.6 : 1,
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } as CSSProperties },
    createElement(
      'button',
      {
        type: 'button',
        className: 'owl-button owl-button-primary owl-focusable',
        style: buttonStyle,
        disabled: submitting,
        'data-testid': 'start-research',
        onClick: () => void onClick(),
      },
      submitting ? 'Starting…' : 'Start deep-dive research',
    ),
    error === undefined
      ? null
      : createElement(
          'p',
          {
            'data-testid': 'start-research-error',
            style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } as CSSProperties,
          },
          error,
        ),
  )
}
