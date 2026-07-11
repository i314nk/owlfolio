'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// Subpath import: the shared ROOT index re-exports runtimeBackup (node:fs) — unbundleable in a
// client chunk. appConfig alone is browser-safe.
import { SAVINGS_RATE_MAX, type SavingsSleeveConfig } from '@owlfolio/shared/appConfig'

// NOTE: createElement (not JSX) per the repo convention (jsx: preserve — see AutomationSettingsPanel).

export type SavingsAnchorPanelProps = {
  initialSavings: SavingsSleeveConfig
  /** True when the anchor is a USER-SET value; false = the fail-closed default is in effect. */
  configured: boolean
  /** The strategy's uniform equity premium (decimal) — display-only, for the derived discount line. */
  equityPremium: number
}

type SavingsRouter = { refresh: () => void }

/** POST the anchor update; unit-testable without a DOM (mirrors submitRunDeepDive). */
export async function submitSavingsAnchor(
  deps: { fetch: typeof fetch; router: SavingsRouter; ratePercent: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch('/api/settings/savings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ savings_expected_profit_rate: deps.ratePercent / 100 }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = (body as { error?: { message?: string } }).error?.message ?? 'Unable to save the savings anchor'
      return { ok: false, error: message }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to save the savings anchor' }
  }
}

function useSafeRouter(): SavingsRouter {
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

const derivedStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  margin: 0,
}

const pct = (v: number): string => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`

/**
 * The COMPLIANT SAVINGS ANCHOR (F.2): one user-owned opportunity-cost number that anchors the
 * valuation discount, the deployment hurdle, and sizing together. Deliberately NOT a raw discount
 * override — the equity premium stays a uniform strategy constant (F.13).
 */
export function SavingsAnchorPanel({ initialSavings, configured, equityPremium }: SavingsAnchorPanelProps): ReactNode {
  void equityPremium // retained in the props contract; the discount line moved to the required-return panel (Phase 4)
  const router = useSafeRouter()
  const [ratePercent, setRatePercent] = useState<string>((initialSavings.savings_expected_profit_rate * 100).toFixed(2).replace(/\.?0+$/, ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const parsed = Number(ratePercent)
  const parsedValid = Number.isFinite(parsed) && parsed >= 0 && parsed <= SAVINGS_RATE_MAX * 100
  const previewRate = parsedValid ? parsed / 100 : initialSavings.savings_expected_profit_rate

  async function onSave(): Promise<void> {
    if (!parsedValid) {
      setError(`Enter a percentage between 0 and ${SAVINGS_RATE_MAX * 100}.`)
      return
    }
    setSubmitting(true)
    setError(undefined)
    setSaved(false)
    const result = await submitSavingsAnchor({ fetch, router, ratePercent: parsed })
    if (result.ok) {
      setSaved(true)
    } else {
      setError(result.error)
    }
    setSubmitting(false)
  }

  return createElement(
    'section',
    { 'aria-label': 'Compliant savings anchor', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' }, 'data-testid': 'savings-anchor-panel' },
    createElement('p', { className: 'owl-section-accent' }, 'Valuation & capital'),
    createElement('h3', { className: 'owl-section-title', style: { margin: 0 } }, 'Compliant savings anchor'),
    createElement(
      'p',
      { style: helperStyle },
      'The EXPECTED (not guaranteed) profit rate of your Shariah-compliant savings alternative (Mudarabah). '
      + 'This number anchors the deployment hurdle and position sizing — set it to what your idle capital '
      + 'actually earns. (Phase 4: the VALUATION discount is now the separate flat required return below.)',
    ),
    !configured
      ? createElement(
          'p',
          { style: { ...helperStyle, color: 'var(--owl-color-gold-bright)' }, 'data-testid': 'savings-anchor-default-note' },
          `Currently using the fail-closed default (${pct(initialSavings.savings_expected_profit_rate)}) — valuations may be too generous if your real compliant savings yield is higher.`,
        )
      : null,
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('label', { htmlFor: 'savings-anchor-rate', style: helperStyle }, 'Expected profit rate (%/yr)'),
      createElement('input', {
        id: 'savings-anchor-rate',
        'data-testid': 'savings-anchor-input',
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
          'data-testid': 'savings-anchor-save',
          onClick: () => void onSave(),
        },
        submitting ? 'Saving…' : 'Save anchor',
      ),
      saved ? createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, 'Saved — future valuations use the new anchor.') : null,
    ),
    createElement(
      'p',
      { style: derivedStyle, 'data-testid': 'savings-anchor-derived' },
      `Deployment hurdle = ${pct(previewRate)} + ${pct(initialSavings.equity_risk_margin)} margin = ${pct(previewRate + initialSavings.equity_risk_margin)}`,
    ),
    createElement(
      'p',
      { style: helperStyle },
      'Applies to FUTURE runs only — recorded dossiers keep the discount they were valued at (append-only). '
      + (initialSavings.savings_rate_set_at !== undefined ? `Rate last set ${initialSavings.savings_rate_set_at.slice(0, 10)}.` : ''),
    ),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'savings-anchor-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
