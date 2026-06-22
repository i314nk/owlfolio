'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { resolveErrorMessage } from '../new/resolveErrorMessage'

// NOTE: this file uses `createElement` rather than JSX to match the repo convention — the apps/web Next
// tsconfig sets `jsx: preserve`, so any component IMPORTED under vitest must avoid JSX syntax to transform
// (see ResearchCasePanel / PipelineObservatory, both createElement-only and unit-tested).

export type ResearchCaseActionsProps = {
  caseId: string
  ticker: string | undefined
  isArchived: boolean
  engineStale: boolean
}

// A router-shaped seam so the POST+navigate logic is unit-testable without a DOM. Mirrors the subset of
// next/navigation's router that these actions use.
export type ActionRouter = {
  push: (href: string) => void
  refresh: () => void
}

/**
 * Start a NEW research run that SUPERSEDES the current dossier (the "Re-run on current engine" action).
 * Append-only: this never mutates the old case — it requests a fresh run keyed to supersede the prior one,
 * so the old case drops out of active views while its dossier + ledger remain intact. On success the user
 * lands on the new dossier; on error the resolved message is returned for display.
 */
export async function submitReRun(
  deps: { fetch: typeof fetch; router: ActionRouter; caseId: string; ticker: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await deps.fetch('/api/research/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticker: deps.ticker, supersedes_research_case_id: deps.caseId }),
    })
    const body = await response.json()
    if (!response.ok) {
      return { ok: false, error: resolveErrorMessage(body) }
    }
    deps.router.push(`/research/${body.research_case_id}`)
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to start the re-run' }
  }
}

/**
 * Archive the current run (hide-via-projection). Append-only: this appends a `research_case_archived`
 * event — it never hard-deletes. On success the user returns to the research library; on error the
 * resolved message is returned for display.
 */
export async function submitArchive(
  deps: { fetch: typeof fetch; router: ActionRouter; caseId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await deps.fetch(`/api/research/${deps.caseId}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: resolveErrorMessage(body) }
    }
    deps.router.push('/research')
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to archive this run' }
  }
}

type PendingAction = 'rerun' | 'archive' | undefined

const confirmRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--owl-space-2)',
}

const noteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.04em',
}

const confirmTextStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  maxWidth: '32rem',
}

export function ResearchCaseActions({ caseId, ticker, isArchived, engineStale }: ResearchCaseActionsProps): ReactNode {
  const router = useRouter()
  const [confirming, setConfirming] = useState<PendingAction>(undefined)
  const [submitting, setSubmitting] = useState<PendingAction>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const isBusy = submitting !== undefined
  const reRunDisabled = ticker === undefined || isBusy

  async function onConfirmReRun(): Promise<void> {
    if (ticker === undefined) return
    setSubmitting('rerun')
    setError(undefined)
    const result = await submitReRun({ fetch, router, caseId, ticker })
    if (result.ok) {
      setConfirming(undefined)
    } else {
      setError(result.error)
    }
    setSubmitting(undefined)
  }

  async function onConfirmArchive(): Promise<void> {
    setSubmitting('archive')
    setError(undefined)
    const result = await submitArchive({ fetch, router, caseId })
    if (result.ok) {
      setConfirming(undefined)
    } else {
      setError(result.error)
    }
    setSubmitting(undefined)
  }

  // Stale dossier → the re-run is the recommended answer: a gold primary treatment + a short note.
  // Fresh dossier → keep it a calm secondary control.
  // Stale → gold-emphasis: the plain owl-button base + an inline gold gradient (NOT owl-button-primary,
  // whose teal would be fully overridden and misleads readers). Dark on-gold ink via the deepest panel token.
  const reRunClass = engineStale ? 'owl-button owl-focusable' : 'owl-button owl-button-secondary owl-focusable'
  const reRunStyle: CSSProperties = engineStale
    ? {
        background: 'linear-gradient(135deg, var(--owl-color-gold), var(--owl-color-gold-bright))',
        border: '1px solid var(--owl-color-gold-bright)',
        color: 'var(--owl-color-panel-deep)',
        cursor: reRunDisabled ? 'not-allowed' : 'pointer',
        opacity: reRunDisabled ? 0.6 : 1,
      }
    : { cursor: reRunDisabled ? 'not-allowed' : 'pointer', opacity: reRunDisabled ? 0.6 : 1 }

  const reRunNode = confirming === 'rerun'
    ? createElement(
        'div',
        { style: confirmRowStyle, 'data-testid': 'research-case-rerun-confirm' },
        createElement(
          'span',
          { style: confirmTextStyle },
          'This starts a NEW research run on the current engine and uses provider quota. The current dossier will be archived/superseded. Continue?',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: reRunClass,
            style: reRunStyle,
            disabled: reRunDisabled,
            onClick: () => void onConfirmReRun(),
          },
          submitting === 'rerun' ? 'Starting…' : 'Confirm re-run',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'owl-button owl-button-secondary owl-focusable',
            disabled: isBusy,
            onClick: () => setConfirming(undefined),
          },
          'Cancel',
        ),
      )
    : createElement(
        'button',
        {
          type: 'button',
          className: reRunClass,
          style: reRunStyle,
          disabled: reRunDisabled,
          'data-testid': 'research-case-rerun-button',
          ...(ticker === undefined ? { title: 'This case has no ticker, so it cannot be re-run.' } : {}),
          onClick: () => {
            setError(undefined)
            setConfirming('rerun')
          },
        },
        'Re-run on current engine',
      )

  const archiveNode = isArchived
    ? null
    : confirming === 'archive'
      ? createElement(
          'div',
          { style: confirmRowStyle, 'data-testid': 'research-case-archive-confirm' },
          createElement(
            'span',
            { style: confirmTextStyle },
            'Archive removes this run from the active research library and pipeline. It stays in the ledger and the dossier remains reachable by link. Continue?',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'owl-button owl-button-danger owl-focusable',
              style: { cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1 } as CSSProperties,
              disabled: isBusy,
              onClick: () => void onConfirmArchive(),
            },
            submitting === 'archive' ? 'Archiving…' : 'Confirm archive',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'owl-button owl-button-secondary owl-focusable',
              disabled: isBusy,
              onClick: () => setConfirming(undefined),
            },
            'Cancel',
          ),
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: 'owl-button owl-button-secondary owl-focusable',
            style: { cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1 } as CSSProperties,
            disabled: isBusy,
            'data-testid': 'research-case-archive-button',
            onClick: () => {
              setError(undefined)
              setConfirming('archive')
            },
          },
          'Archive this run',
        )

  return createElement(
    'section',
    {
      'data-testid': 'research-case-actions',
      'data-engine-stale': engineStale ? 'true' : 'false',
      style: { display: 'grid', gap: 'var(--owl-space-2)', margin: '0 0 var(--owl-space-4)' } as CSSProperties,
    },
    createElement(
      'div',
      { style: confirmRowStyle },
      reRunNode,
      engineStale && confirming !== 'rerun'
        ? createElement('span', { 'data-testid': 'research-case-rerun-stale-note', style: noteStyle }, 'older engine — refresh recommended')
        : null,
      ticker === undefined
        ? createElement('span', { 'data-testid': 'research-case-rerun-disabled-hint', style: noteStyle }, 'no ticker on this case')
        : null,
      archiveNode,
    ),
    error === undefined
      ? null
      : createElement(
          'p',
          {
            'data-testid': 'research-case-actions-error',
            style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } as CSSProperties,
          },
          error,
        ),
  )
}
