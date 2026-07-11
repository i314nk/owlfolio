'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// NOTE: createElement (not JSX) per the repo convention (jsx: preserve).

type PanelRouter = { refresh: () => void }

/** POST a contribution record; unit-testable without a DOM. */
export async function submitPassiveContribution(
  deps: { fetch: typeof fetch; router: PanelRouter; amount: number; instrument?: string; note?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch('/api/passive/contributions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: deps.amount,
        ...(deps.instrument !== undefined && deps.instrument.trim() !== '' ? { instrument: deps.instrument } : {}),
        ...(deps.note !== undefined && deps.note.trim() !== '' ? { note: deps.note } : {}),
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = (body as { error?: { message?: string } }).error?.message ?? 'Unable to record the contribution'
      return { ok: false, error: message }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to record the contribution' }
  }
}

function useSafeRouter(): PanelRouter {
  try {
    return useRouter()
  } catch {
    return { refresh: () => { window.location.reload() } }
  }
}

const helperStyle: CSSProperties = { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0 }

/** B7: record a DCA contribution already made elsewhere (user-authored; append-only; no execution). */
export function PassiveContributionForm(): ReactNode {
  const router = useSafeRouter()
  const [amount, setAmount] = useState('')
  const [instrument, setInstrument] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const parsed = Number(amount)
  const valid = Number.isFinite(parsed) && parsed > 0

  async function onSubmit(): Promise<void> {
    if (!valid) {
      setError('Enter the positive amount you contributed.')
      return
    }
    setSubmitting(true)
    setError(undefined)
    const result = await submitPassiveContribution({ fetch, router, amount: parsed, instrument })
    if (result.ok) {
      setAmount('')
      setInstrument('')
    } else {
      setError(result.error)
    }
    setSubmitting(false)
  }

  return createElement(
    'div',
    { 'data-testid': 'passive-contribution-form', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
    createElement('label', { htmlFor: 'contribution-amount', style: helperStyle }, 'Record a contribution'),
    createElement('input', {
      id: 'contribution-amount',
      'data-testid': 'passive-contribution-amount',
      className: 'owl-input owl-focusable',
      inputMode: 'decimal',
      placeholder: 'amount',
      style: { maxWidth: '7rem' },
      value: amount,
      onChange: (event: { target: { value: string } }) => setAmount(event.target.value),
    }),
    createElement('input', {
      id: 'contribution-instrument',
      'data-testid': 'passive-contribution-instrument',
      className: 'owl-input owl-focusable',
      placeholder: 'index fund (optional)',
      style: { maxWidth: '14rem' },
      value: instrument,
      onChange: (event: { target: { value: string } }) => setInstrument(event.target.value),
    }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'owl-button owl-button-secondary owl-focusable',
        disabled: submitting,
        'data-testid': 'passive-contribution-save',
        onClick: () => void onSubmit(),
      },
      submitting ? 'Recording…' : 'Record',
    ),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'passive-contribution-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
