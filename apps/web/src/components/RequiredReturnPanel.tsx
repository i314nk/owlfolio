'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// Subpath import (browser-safe; the shared root re-exports node:fs helpers).
import { REQUIRED_RETURN_MAX, REQUIRED_RETURN_MIN, type ValuationConfig } from '@owlfolio/shared/appConfig'

// NOTE: createElement (not JSX) per the repo convention (jsx: preserve).

export type RequiredReturnPanelProps = {
  initialValuation: ValuationConfig
  /** True when the required return is USER-SET; false = the flat 15% strategy default is in effect. */
  configured: boolean
}

type PanelRouter = { refresh: () => void }

/** POST the required-return update; unit-testable without a DOM (mirrors submitSavingsAnchor). */
export async function submitRequiredReturn(
  deps: { fetch: typeof fetch; router: PanelRouter; ratePercent: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch('/api/settings/valuation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ required_return: deps.ratePercent / 100 }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = (body as { error?: { message?: string } }).error?.message ?? 'Unable to save the required return'
      return { ok: false, error: message }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to save the required return' }
  }
}

function useSafeRouter(): PanelRouter {
  try {
    return useRouter()
  } catch {
    return { refresh: () => { window.location.reload() } }
  }
}

const helperStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  margin: 0,
  maxWidth: '46rem',
}

const pct = (v: number): string => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`

/**
 * Phase 4 (book alignment): the REQUIRED RETURN — the flat rate the 10-year FCF valuation discounts
 * at. The book's default is 15% ("anything less, you might as well buy the index"): it doubles as
 * the active-vs-passive hurdle. One user-owned number; margins (30% buy / 50% load-up) stay uniform.
 */
export function RequiredReturnPanel({ initialValuation, configured }: RequiredReturnPanelProps): ReactNode {
  const router = useSafeRouter()
  const [ratePercent, setRatePercent] = useState<string>((initialValuation.required_return * 100).toFixed(2).replace(/\.?0+$/, ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const parsed = Number(ratePercent)
  const parsedValid = Number.isFinite(parsed) && parsed >= REQUIRED_RETURN_MIN * 100 && parsed <= REQUIRED_RETURN_MAX * 100

  async function onSave(): Promise<void> {
    if (!parsedValid) {
      setError(`Enter a percentage between ${REQUIRED_RETURN_MIN * 100} and ${REQUIRED_RETURN_MAX * 100}.`)
      return
    }
    setSubmitting(true)
    setError(undefined)
    setSaved(false)
    const result = await submitRequiredReturn({ fetch, router, ratePercent: parsed })
    if (result.ok) {
      setSaved(true)
    } else {
      setError(result.error)
    }
    setSubmitting(false)
  }

  return createElement(
    'section',
    { 'aria-label': 'Required return', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' }, 'data-testid': 'required-return-panel' },
    createElement('p', { className: 'owl-section-accent' }, 'Valuation & capital'),
    createElement('h3', { className: 'owl-section-title', style: { margin: 0 } }, 'Required return (the valuation discount)'),
    createElement(
      'p',
      { style: helperStyle },
      'The flat annual return every buy candidate must clear — the 10-year free-cash-flow projection is '
      + 'discounted at this rate. The strategy default is 15%: anything less and you might as well dollar-cost-average '
      + 'the index. The margins stay uniform on top of it: buy at ≥30% below intrinsic value, load up at ≥50%.',
    ),
    !configured
      ? createElement(
          'p',
          { style: { ...helperStyle, color: 'var(--owl-color-gold-bright)' }, 'data-testid': 'required-return-default-note' },
          `Currently using the strategy default (${pct(initialValuation.required_return)}).`,
        )
      : null,
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('label', { htmlFor: 'required-return-rate', style: helperStyle }, 'Required return (%/yr)'),
      createElement('input', {
        id: 'required-return-rate',
        'data-testid': 'required-return-input',
        className: 'owl-input owl-focusable',
        inputMode: 'decimal',
        style: { maxWidth: '7rem' },
        value: ratePercent,
        onChange: (event: { target: { value: string } }) => {
          setRatePercent(event.target.value)
          setSaved(false)
        },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'owl-button owl-button-secondary owl-focusable',
          disabled: submitting,
          'data-testid': 'required-return-save',
          onClick: () => void onSave(),
        },
        submitting ? 'Saving…' : 'Save required return',
      ),
      saved ? createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, 'Saved — future valuations discount at the new rate.') : null,
    ),
    createElement(
      'p',
      { style: helperStyle },
      'Applies to FUTURE runs only — recorded dossiers keep the required return they were valued at (append-only). '
      + (initialValuation.required_return_set_at !== undefined ? `Last set ${initialValuation.required_return_set_at.slice(0, 10)}.` : ''),
    ),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'required-return-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
