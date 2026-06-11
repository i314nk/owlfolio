'use client'

import { createElement, useState, type CSSProperties, type FormEvent } from 'react'

/**
 * Client island for curating the calibration universe from /calibration (Rule 1: the UI is a projection of
 * the ledger; the user's clicks author ledger events). Renders:
 *   - an "Add ticker" form (ticker required; optional company + market) → POST /api/calibration/universe/add;
 *   - per-row remove (×) controls → POST /api/calibration/universe/remove;
 *   - an inline "Add" affordance for each suggested addition.
 * Each action records a user-authored member add/remove event and reloads so the SSR projection re-renders.
 * Curation is REVERSIBLE list-editing recorded immediately — there is no draft-for-confirmation step.
 */

const labelStyle: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-gold)',
}

const inputStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  color: 'var(--owl-color-text)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.5rem',
  padding: '0.45rem 0.6rem',
  fontSize: 'var(--owl-text-sm)',
}

const primaryButtonStyle: CSSProperties = {
  background: 'var(--owl-color-gold)',
  color: '#1a1205',
  border: 'none',
  borderRadius: '0.6rem',
  padding: '0.5rem 1rem',
  fontWeight: 700,
  fontSize: 'var(--owl-text-sm)',
  cursor: 'pointer',
}

async function postUniverse(path: string, body: Record<string, unknown>): Promise<string | undefined> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    return typeof payload.error === 'string' ? payload.error : 'Request failed'
  }
  return undefined
}

/** The Add-ticker form. */
export function CalibrationUniverseAddForm() {
  const [ticker, setTicker] = useState('')
  const [company, setCompany] = useState('')
  const [market, setMarket] = useState<'US' | 'intl'>('US')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (ticker.trim().length === 0) {
      setError('A ticker is required.')
      return
    }
    setBusy(true)
    setError(undefined)
    const message = await postUniverse('/api/calibration/universe/add', {
      ticker: ticker.trim(),
      ...(company.trim().length === 0 ? {} : { company: company.trim() }),
      market,
    }).catch((caught: unknown) => (caught instanceof Error ? caught.message : 'Request failed'))
    if (message !== undefined) {
      setBusy(false)
      setError(message)
      return
    }
    window.location.reload()
  }

  return createElement(
    'form',
    { onSubmit: submit, 'aria-label': 'Add a calibration-universe ticker', style: { display: 'grid', gap: '0.55rem', maxWidth: '34rem' } },
    createElement(
      'div',
      { style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
      createElement(
        'label',
        { style: { display: 'grid', gap: '0.25rem' } },
        createElement('span', { style: labelStyle }, 'Ticker'),
        createElement('input', {
          name: 'ticker',
          value: ticker,
          required: true,
          'aria-label': 'Ticker',
          placeholder: 'e.g. FDS',
          onChange: (e: { target: { value: string } }) => setTicker(e.target.value),
          style: { ...inputStyle, width: '8rem', textTransform: 'uppercase' },
        }),
      ),
      createElement(
        'label',
        { style: { display: 'grid', gap: '0.25rem' } },
        createElement('span', { style: labelStyle }, 'Company (optional)'),
        createElement('input', {
          name: 'company',
          value: company,
          'aria-label': 'Company (optional)',
          placeholder: 'e.g. FactSet',
          onChange: (e: { target: { value: string } }) => setCompany(e.target.value),
          style: { ...inputStyle, width: '12rem' },
        }),
      ),
      createElement(
        'label',
        { style: { display: 'grid', gap: '0.25rem' } },
        createElement('span', { style: labelStyle }, 'Market'),
        createElement(
          'select',
          {
            name: 'market',
            value: market,
            'aria-label': 'Market',
            onChange: (e: { target: { value: string } }) => setMarket(e.target.value === 'intl' ? 'intl' : 'US'),
            style: inputStyle,
          },
          createElement('option', { value: 'US' }, 'US'),
          createElement('option', { value: 'intl' }, 'intl'),
        ),
      ),
      createElement(
        'button',
        { type: 'submit', className: 'owl-focusable', disabled: busy, style: { ...primaryButtonStyle, opacity: busy ? 0.7 : 1 } },
        busy ? 'Adding…' : 'Add ticker',
      ),
    ),
    error === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-danger, #f87171)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}

/** Per-row remove (×) control for a universe name. */
export function CalibrationUniverseRemoveButton({ ticker }: { ticker: string }) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    const message = await postUniverse('/api/calibration/universe/remove', { ticker }).catch(
      (caught: unknown) => (caught instanceof Error ? caught.message : 'Request failed'),
    )
    if (message !== undefined) {
      setBusy(false)
      return
    }
    window.location.reload()
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: 'owl-focusable',
      onClick: remove,
      disabled: busy,
      'aria-label': `Remove ${ticker} from the calibration universe`,
      title: `Remove ${ticker}`,
      style: {
        background: 'transparent',
        color: 'var(--owl-color-quiet)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: '0.4rem',
        padding: '0.15rem 0.5rem',
        cursor: 'pointer',
        fontSize: 'var(--owl-text-sm)',
        opacity: busy ? 0.6 : 1,
      },
    },
    busy ? '…' : '×',
  )
}

/** Inline "Add" affordance for a suggested addition (researched / 13F-discovered name). */
export function CalibrationUniverseSuggestionAddButton({ ticker, company }: { ticker: string; company?: string }) {
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    const message = await postUniverse('/api/calibration/universe/add', {
      ticker,
      ...(company === undefined ? {} : { company }),
    }).catch((caught: unknown) => (caught instanceof Error ? caught.message : 'Request failed'))
    if (message !== undefined) {
      setBusy(false)
      return
    }
    window.location.reload()
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: 'owl-focusable',
      onClick: add,
      disabled: busy,
      'aria-label': `Add ${ticker} to the calibration universe`,
      style: {
        background: 'transparent',
        color: 'var(--owl-color-gold)',
        border: '1px solid var(--owl-color-gold)',
        borderRadius: '0.4rem',
        padding: '0.15rem 0.6rem',
        cursor: 'pointer',
        fontSize: 'var(--owl-text-sm)',
        fontWeight: 600,
        opacity: busy ? 0.6 : 1,
      },
    },
    busy ? 'Adding…' : 'Add',
  )
}
