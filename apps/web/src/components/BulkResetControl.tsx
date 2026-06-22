'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// NOTE: createElement (not JSX) to match the repo convention — apps/web sets `jsx: preserve`, so any
// component imported under vitest must avoid JSX syntax (see ResearchCaseActions / DataSafetyPanel).

/** The word the operator must TYPE to arm the final, irreversible confirm. */
export const CONFIRM_WORD = 'RESET'

/**
 * Whether the final, irreversible confirm button should be enabled. The "hard to misfire" rule: the
 * operator must have typed the exact confirmation word AND no submit is in flight.
 */
export function isBulkResetConfirmEnabled({ typed, submitting }: { typed: string; submitting: boolean }): boolean {
  return typed === CONFIRM_WORD && !submitting
}

// A router-shaped seam so the POST+refresh logic is unit-testable without a DOM.
export type BulkResetRouter = {
  refresh: () => void
}

/**
 * POST the wholesale reset and refresh on success. Append-only-store-aware wholesale clear: this is the
 * DESTRUCTIVE control; the caller is responsible for the double-confirm before this runs.
 */
export async function submitBulkReset(
  deps: { fetch: typeof fetch; router: BulkResetRouter },
): Promise<{ ok: true; clearedEvents: number } | { ok: false; error: string }> {
  try {
    const response = await deps.fetch('/api/research/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json().catch(() => ({}))) as { cleared_events?: number; error?: string }
    if (!response.ok) {
      return { ok: false, error: typeof body.error === 'string' ? body.error : 'Unable to reset ledger state' }
    }
    deps.router.refresh()
    return { ok: true, clearedEvents: typeof body.cleared_events === 'number' ? body.cleared_events : 0 }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to reset ledger state' }
  }
}

const dangerCardStyle: CSSProperties = {
  border: '1px solid var(--owl-color-risk)',
  borderRadius: '0.75rem',
  display: 'grid',
  gap: 'var(--owl-space-3)',
  padding: 'var(--owl-space-4)',
}

const warningStyle: CSSProperties = {
  color: 'var(--owl-color-risk-bright)',
  fontSize: 'var(--owl-text-sm)',
  margin: 0,
  maxWidth: '40rem',
}

const inputStyle: CSSProperties = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-risk)',
  borderRadius: '0.5rem',
  color: 'var(--owl-color-text)',
  fontFamily: 'var(--owl-font-mono)',
  letterSpacing: '0.12em',
  padding: '0.5rem 0.75rem',
}

const confirmRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--owl-space-2)',
}

/**
 * DESTRUCTIVE dev/test tool — wholesale clear of all local ledger state in this environment.
 *
 * Hard-to-misfire by construction:
 *  1. A calm primary button reveals the danger section (no immediate destruction).
 *  2. The operator must read the warning AND type the confirmation word (`RESET`) before the final
 *     confirm button enables.
 *  3. Final confirm POSTs `/api/research/reset` and refreshes; the result ("cleared N events") or error
 *     is shown inline.
 *
 * Rendered ONLY when the server-side dev-tools gate is enabled (see DataSafetyPanel). It must be ABSENT in
 * normal personal-local operation.
 */
export function BulkResetControl(): ReactNode {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<number | undefined>(undefined)

  const confirmEnabled = isBulkResetConfirmEnabled({ typed, submitting })

  async function onConfirm(): Promise<void> {
    if (!confirmEnabled) return
    setSubmitting(true)
    setError(undefined)
    const outcome = await submitBulkReset({ fetch, router })
    if (outcome.ok) {
      setResult(outcome.clearedEvents)
      setArmed(false)
      setTyped('')
    } else {
      setError(outcome.error)
    }
    setSubmitting(false)
  }

  function reset(): void {
    setArmed(false)
    setTyped('')
    setError(undefined)
  }

  const heading = createElement(
    'div',
    { className: 'owl-row-main' },
    createElement('h3', { className: 'owl-row-title', style: { color: 'var(--owl-color-risk-bright)' } }, 'Developer / test tools — destructive'),
    createElement(
      'p',
      { className: 'owl-row-helper' },
      'This is a development and test aid, not part of normal operation. It clears all local ledger state in this environment — every research run, holding, capital, watchlist, and review event — and empties source bundles. App configuration (mode, provider, paths) is preserved. There is no undo.',
    ),
  )

  const trigger = armed
    ? null
    : createElement(
        'button',
        {
          type: 'button',
          className: 'owl-button owl-button-danger owl-focusable',
          'data-testid': 'bulk-reset-trigger',
          onClick: () => {
            setError(undefined)
            setResult(undefined)
            setArmed(true)
          },
        },
        'Reset all research & ledger state',
      )

  const armedNode = armed
    ? createElement(
        'div',
        { 'data-testid': 'bulk-reset-confirm', style: { display: 'grid', gap: 'var(--owl-space-3)' } as CSSProperties },
        createElement(
          'p',
          { style: warningStyle },
          'This permanently clears the entire active ledger and source bundles for this environment. This cannot be undone. To proceed, type ',
          createElement('strong', { style: { color: 'var(--owl-color-risk-bright)', fontFamily: 'var(--owl-font-mono)' } }, CONFIRM_WORD),
          ' below.',
        ),
        createElement('input', {
          type: 'text',
          'aria-label': `Type ${CONFIRM_WORD} to confirm`,
          'data-testid': 'bulk-reset-input',
          className: 'owl-focusable',
          style: inputStyle,
          value: typed,
          placeholder: CONFIRM_WORD,
          autoComplete: 'off',
          onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
        }),
        createElement(
          'div',
          { style: confirmRowStyle },
          createElement(
            'button',
            {
              type: 'button',
              className: 'owl-button owl-button-danger owl-focusable',
              'data-testid': 'bulk-reset-confirm-button',
              disabled: !confirmEnabled,
              style: { cursor: confirmEnabled ? 'pointer' : 'not-allowed', opacity: confirmEnabled ? 1 : 0.6 } as CSSProperties,
              onClick: () => void onConfirm(),
            },
            submitting ? 'Clearing…' : 'Permanently clear all state',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'owl-button owl-button-secondary owl-focusable',
              'data-testid': 'bulk-reset-cancel-button',
              disabled: submitting,
              onClick: reset,
            },
            'Cancel',
          ),
        ),
      )
    : null

  const resultNode = result === undefined
    ? null
    : createElement(
        'p',
        { 'data-testid': 'bulk-reset-result', style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } as CSSProperties },
        `Cleared ${result} event${result === 1 ? '' : 's'}. The ledger is now empty and ready for new state.`,
      )

  const errorNode = error === undefined
    ? null
    : createElement(
        'p',
        { 'data-testid': 'bulk-reset-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } as CSSProperties },
        error,
      )

  return createElement(
    'section',
    { 'aria-label': 'Developer / test tools — destructive', 'data-testid': 'bulk-reset-control', style: dangerCardStyle },
    heading,
    trigger,
    armedNode,
    resultNode,
    errorNode,
  )
}
