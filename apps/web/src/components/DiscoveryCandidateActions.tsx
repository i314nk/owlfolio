'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** The subset of next/navigation's router these actions use — a testable seam. */
export type DiscoveryCandidateActionsRouter = {
  refresh: () => void
}

function useSafeRouter(): DiscoveryCandidateActionsRouter {
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

export type DiscoveryCandidateActionsDeps = {
  fetch?: typeof fetch
  router?: DiscoveryCandidateActionsRouter
}

export type DiscoveryCandidateActionsProps = {
  candidateId: string
  status: string
  deps?: DiscoveryCandidateActionsDeps
}

/**
 * Action buttons for a discovery candidate: accept, reject, or promote, depending on status.
 * POSTs to the appropriate /api/discovery/candidates/[id]/{accept,reject,promote} endpoint.
 */
export function DiscoveryCandidateActions({ candidateId, status, deps }: DiscoveryCandidateActionsProps): ReactNode {
  const routerFromHook = useSafeRouter()
  const router = deps?.router ?? routerFromHook
  const fetchFn = deps?.fetch ?? fetch

  const [submitting, setSubmitting] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  async function doAction(action: 'accept' | 'reject' | 'promote', body?: Record<string, unknown>): Promise<void> {
    setSubmitting(action)
    setError(undefined)
    setNote(undefined)
    try {
      const doFetch = fetchFn.bind(globalThis)
      const response = await doFetch(`/api/discovery/candidates/${candidateId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const parsed = await response.json().catch(() => ({}))
      if (response.ok) {
        router.refresh()
        if (action === 'promote' && typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).research_case_id === 'string') {
          const researchCaseId = (parsed as Record<string, unknown>).research_case_id as string
          setNote(researchCaseId)
        } else {
          setNote('Done')
        }
      } else {
        setError(
          typeof parsed.error === 'string' && parsed.error.length > 0
            ? parsed.error
            : `Action ${action} failed — try again later.`,
        )
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : `Unable to ${action} candidate`)
    }
    setSubmitting(undefined)
  }

  if (status !== 'discovered' && status !== 'queued_for_quick_screen') {
    return null
  }

  const isSubmitting = submitting !== undefined

  const rejectButton = createElement(
    'button',
    {
      type: 'button',
      className: 'owl-button owl-button-secondary owl-focusable',
      style: { cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 } as CSSProperties,
      disabled: isSubmitting,
      'data-testid': 'reject',
      onClick: () => void doAction('reject', { reason: '' }),
    },
    'Reject',
  )

  const primaryButton = status === 'discovered'
    ? createElement(
        'button',
        {
          type: 'button',
          className: 'owl-button owl-button-secondary owl-focusable',
          style: { cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 } as CSSProperties,
          disabled: isSubmitting,
          'data-testid': 'accept',
          onClick: () => void doAction('accept'),
        },
        'Accept for screening',
      )
    : createElement(
        'button',
        {
          type: 'button',
          className: 'owl-button owl-button-secondary owl-focusable',
          style: { cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 } as CSSProperties,
          disabled: isSubmitting,
          'data-testid': 'promote',
          onClick: () => void doAction('promote'),
        },
        'Promote to research case',
      )

  const noteEl = note === undefined
    ? null
    : note !== 'Done'
      ? createElement(
          'p',
          { 'data-testid': 'candidate-action-note', style: noteStyle },
          'Promoted — ',
          createElement('a', { href: `/research/${note}`, style: { color: 'var(--owl-color-gold-bright)' } }, 'View research case'),
        )
      : createElement('p', { 'data-testid': 'candidate-action-note', style: noteStyle }, 'Done')

  return createElement(
    'div',
    { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', marginTop: '0.4rem' } },
    primaryButton,
    rejectButton,
    noteEl,
    error === undefined
      ? null
      : createElement(
          'p',
          { 'data-testid': 'candidate-action-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          error,
        ),
  )
}
