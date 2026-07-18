'use client'

import { createElement, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

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
 * One-click acknowledge-and-discard for a failed run (option-b append-only archive): POSTs the
 * existing /api/research/<caseId>/archive route, so the case leaves every active surface (pipeline
 * counts, runs, Faults, the library) while the ledger keeps the full record. Human-authored with an
 * inline confirm — failures leave the board by a decision, never a timer.
 */
export function ArchiveRunButton({ caseId, ticker }: { caseId: string; ticker: string }): ReactNode {
  const router = useSafeRouter()
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onConfirm(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    try {
      const res = await fetch(`/api/research/${encodeURIComponent(caseId)}/archive`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => undefined) as { error?: string } | undefined
        setError(body?.error ?? `Archive failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed')
      setSubmitting(false)
    }
  }

  if (confirming) {
    return createElement(
      'span',
      { style: { alignItems: 'center', display: 'inline-flex', flexWrap: 'wrap', gap: '0.4rem' }, 'data-testid': 'archive-run-confirm' },
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } },
        `Acknowledge and discard the failed ${ticker} run? It leaves the boards; the ledger keeps the record.`,
      ),
      createElement(
        'button',
        { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: submitting, onClick: () => void onConfirm() },
        submitting ? 'Archiving…' : 'Confirm archive',
      ),
      createElement(
        'button',
        { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: submitting, onClick: () => setConfirming(false) },
        'Cancel',
      ),
      error === undefined
        ? null
        : createElement('span', { 'data-testid': 'archive-run-error', style: { color: 'var(--owl-color-risk-bright, var(--owl-color-risk-soft))', fontSize: 'var(--owl-text-sm)' } }, error),
    )
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: 'owl-button owl-button-secondary owl-focusable',
      'data-testid': 'archive-run-button',
      onClick: () => {
        setError(undefined)
        setConfirming(true)
      },
    },
    'Archive',
  )
}
