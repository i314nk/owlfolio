'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

// Subpath import (browser-safe; the shared root re-exports node:fs helpers).
import { PASSIVE_SPLITS, type PassiveSleeveConfig, type PassiveSplit } from '@owlfolio/shared/appConfig'

// NOTE: createElement (not JSX) per the repo convention (jsx: preserve).

export type PassiveSleevePanelProps = {
  initialPassive: PassiveSleeveConfig
  /** True when the plan is USER-SET (vintage stamped); false = not configured yet. */
  configured: boolean
}

type PanelRouter = { refresh: () => void }

/** POST the plan update; unit-testable without a DOM (mirrors submitRequiredReturn). */
export async function submitPassivePlan(
  deps: { fetch: typeof fetch; router: PanelRouter; split: PassiveSplit; monthlyAmount: number; scheduleDay: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch('/api/settings/passive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ split: deps.split, monthly_amount: deps.monthlyAmount, schedule_day: deps.scheduleDay }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = (body as { error?: { message?: string } }).error?.message ?? 'Unable to save the passive plan'
      return { ok: false, error: message }
    }
    deps.router.refresh()
    return { ok: true }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to save the passive plan' }
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

/**
 * B7 (book alignment): the PASSIVE-SLEEVE PLAN — the book's step-2 foundation. The split
 * (passive/active), the monthly amount you can REGULARLY commit (rule 1), and the consistent
 * schedule day (rule 2). Contributions are recorded on the Passive page; there is no sell control
 * anywhere in the sleeve (rule 3).
 */
export function PassiveSleevePanel({ initialPassive, configured }: PassiveSleevePanelProps): ReactNode {
  const router = useSafeRouter()
  const [split, setSplit] = useState<PassiveSplit>(initialPassive.split)
  const [amount, setAmount] = useState<string>(initialPassive.monthly_amount > 0 ? String(initialPassive.monthly_amount) : '')
  const [day, setDay] = useState<string>(String(initialPassive.schedule_day))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const parsedAmount = Number(amount)
  const parsedDay = Number(day)
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 0
  const dayValid = Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 28

  async function onSave(): Promise<void> {
    if (!amountValid || !dayValid) {
      setError('Enter a non-negative monthly amount and a schedule day between 1 and 28.')
      return
    }
    setSubmitting(true)
    setError(undefined)
    setSaved(false)
    const result = await submitPassivePlan({ fetch, router, split, monthlyAmount: parsedAmount, scheduleDay: parsedDay })
    if (result.ok) setSaved(true)
    else setError(result.error)
    setSubmitting(false)
  }

  return createElement(
    'section',
    { 'aria-label': 'Passive sleeve plan', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' }, 'data-testid': 'passive-sleeve-panel' },
    createElement('p', { className: 'owl-section-accent' }, 'Passive foundation'),
    createElement('h3', { className: 'owl-section-title', style: { margin: 0 } }, 'Passive sleeve — the index foundation'),
    createElement(
      'p',
      { style: helperStyle },
      'Passive index investing on the side, through monthly dollar-cost averaging. Rule 1: only commit an '
      + 'amount you can commit to REGULARLY. Rule 2: buy on a consistent schedule, no matter what. '
      + 'Rule 3: treat it as a lifelong commitment — there is no sell control here, by design.',
    ),
    !configured
      ? createElement('p', { style: { ...helperStyle, color: 'var(--owl-color-gold-bright)' }, 'data-testid': 'passive-plan-default-note' }, 'No plan set yet — choose a split and a monthly amount to start the foundation.')
      : null,
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('label', { htmlFor: 'passive-split', style: helperStyle }, 'Passive / active split'),
      createElement(
        'select',
        {
          id: 'passive-split',
          'data-testid': 'passive-split-select',
          className: 'owl-input owl-focusable',
          value: split,
          onChange: (event: { target: { value: string } }) => {
            setSplit(event.target.value as PassiveSplit)
            setSaved(false)
          },
        },
        ...PASSIVE_SPLITS.map((option) => createElement('option', { key: option, value: option }, option)),
      ),
      createElement('label', { htmlFor: 'passive-amount', style: helperStyle }, 'Monthly amount'),
      createElement('input', {
        id: 'passive-amount',
        'data-testid': 'passive-amount-input',
        className: 'owl-input owl-focusable',
        inputMode: 'decimal',
        placeholder: 'e.g. 500',
        style: { maxWidth: '7rem' },
        value: amount,
        onChange: (event: { target: { value: string } }) => { setAmount(event.target.value); setSaved(false) },
      }),
      createElement('label', { htmlFor: 'passive-day', style: helperStyle }, 'Schedule day (1–28)'),
      createElement('input', {
        id: 'passive-day',
        'data-testid': 'passive-day-input',
        className: 'owl-input owl-focusable',
        inputMode: 'numeric',
        style: { maxWidth: '5rem' },
        value: day,
        onChange: (event: { target: { value: string } }) => { setDay(event.target.value); setSaved(false) },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'owl-button owl-button-secondary owl-focusable',
          disabled: submitting,
          'data-testid': 'passive-plan-save',
          onClick: () => void onSave(),
        },
        submitting ? 'Saving…' : 'Save plan',
      ),
      saved ? createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, 'Saved.') : null,
    ),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'passive-plan-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
