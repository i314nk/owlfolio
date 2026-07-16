'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { submitReRun } from '../app/research/[caseId]/ResearchCaseActions'
import type { ReReviewRouter } from './ReReviewButton'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** See ReReviewButton.useSafeRouter — tolerant of static server renders in unit tests. */
function useSafeRouter(): ReReviewRouter {
  try {
    return useRouter()
  } catch {
    return {
      push: (href: string) => { window.location.href = href },
      refresh: () => { window.location.reload() },
    }
  }
}

/**
 * The one-click FULL re-analysis launch (10-K cadence, owner-approved 2026-07-14): starts a new
 * run that SUPERSEDES the given case — the boards pick the new case up automatically. Rendered
 * beside the "annual report filed" alert; one inline confirm step because it spends a full
 * provider run. Never fired automatically — the spend stays user-authored.
 */
export function RerunAnalysisButton({ caseId, ticker }: { caseId: string; ticker: string }): ReactNode {
  const router = useSafeRouter()
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onConfirm(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    const result = await submitReRun({ fetch, router, caseId, ticker })
    if (!result.ok) {
      setError(result.error)
      setSubmitting(false)
    }
    // On success submitReRun navigates to the new dossier — no local state to settle.
  }

  return createElement(
    'div',
    { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', marginTop: '0.4rem' } },
    confirming
      ? createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' }, 'data-testid': 'rerun-analysis-confirm' },
          createElement(
            'span',
            { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', maxWidth: '28rem' } },
            `Runs the FULL four-pillar analysis of ${ticker} fresh (a complete provider run — real quota) and supersedes the current case. Continue?`,
          ),
          createElement(
            'button',
            { type: 'button', className: 'owl-button owl-button-primary owl-focusable', disabled: submitting, onClick: () => void onConfirm() },
            submitting ? 'Starting…' : 'Confirm full re-analysis',
          ),
          createElement(
            'button',
            { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: submitting, onClick: () => setConfirming(false) },
            'Cancel',
          ),
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: 'owl-button owl-button-primary owl-focusable',
            style: { cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 } as CSSProperties,
            disabled: submitting,
            'data-testid': 'rerun-analysis-button',
            onClick: () => {
              setError(undefined)
              setConfirming(true)
            },
          },
          'Run full re-analysis',
        ),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'rerun-analysis-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
