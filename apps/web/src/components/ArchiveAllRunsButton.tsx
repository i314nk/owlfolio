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
 * Bulk acknowledge-and-discard for the Faults board: archives EVERY listed failed run through the
 * same per-case archive route (append-only; the ledger keeps each record). One inline confirm names
 * the count; each archive is still an individual, auditable event. Partial failures are reported —
 * never silently swallowed.
 */
export function ArchiveAllRunsButton({ cases }: { cases: readonly { caseId: string; ticker: string }[] }): ReactNode {
  const router = useSafeRouter()
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = progress !== undefined

  async function onConfirm(): Promise<void> {
    setError(undefined)
    const failures: string[] = []
    for (let i = 0; i < cases.length; i++) {
      const target = cases[i]!
      setProgress(`Archiving ${i + 1}/${cases.length}…`)
      try {
        const res = await fetch(`/api/research/${encodeURIComponent(target.caseId)}/archive`, { method: 'POST' })
        if (!res.ok) failures.push(target.ticker)
      } catch {
        failures.push(target.ticker)
      }
    }
    setProgress(undefined)
    if (failures.length > 0) {
      setError(`Could not archive: ${failures.join(', ')}`)
      return
    }
    router.refresh()
  }

  if (confirming) {
    return createElement(
      'span',
      { style: { alignItems: 'center', display: 'inline-flex', flexWrap: 'wrap', gap: '0.4rem' }, 'data-testid': 'archive-all-runs-confirm' },
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } },
        `Acknowledge and discard all ${cases.length} failed runs? They leave the boards; the ledger keeps every record.`,
      ),
      createElement(
        'button',
        { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: busy, onClick: () => void onConfirm() },
        progress ?? 'Confirm archive all',
      ),
      createElement(
        'button',
        { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: busy, onClick: () => setConfirming(false) },
        'Cancel',
      ),
      error === undefined
        ? null
        : createElement('span', { 'data-testid': 'archive-all-runs-error', style: { color: 'var(--owl-color-risk-bright, var(--owl-color-risk-soft))', fontSize: 'var(--owl-text-sm)' } }, error),
    )
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: 'owl-button owl-button-secondary owl-focusable',
      'data-testid': 'archive-all-runs-button',
      onClick: () => {
        setError(undefined)
        setConfirming(true)
      },
    },
    `Archive all (${cases.length})`,
  )
}
