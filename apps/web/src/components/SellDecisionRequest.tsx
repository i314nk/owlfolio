'use client'

import { createElement, useState, type CSSProperties } from 'react'

import { MINIMUM_HOLD_TRIGGERS, type MinimumHoldTrigger } from '@owlfolio/strategies/minimumHoldGuard'

import { resolveErrorMessage } from '../app/research/new/resolveErrorMessage'

/**
 * The on-demand SELL DECISION REQUEST control (Phase 6 S8b).
 *
 * This is the human computing the sell decision for a HELD name. It POSTs to
 * `/api/research/{caseId}/sell-decision` with the chosen minimum-hold `trigger` (and, only for the
 * `better_opportunity` trigger, the optional candidate / held OE yields + switching friction). The route
 * fails-closed when the provider isn't ready and rejects a non-held name. On success the route emits the
 * advisory `holding_sell_review_drafted` OBSERVATION and the persisted recommendation is projected onto the
 * case; we reload so the read-only sell panel renders from PERSISTED data (never recomputed here).
 *
 * It NEVER closes the holding — the exit stays the human-authored close form. There is no auto-sell here.
 */
export type SellDecisionRequestProps = {
  researchCaseId: string
  /** True once a recommendation is already persisted — the control then offers a re-run instead. */
  hasRecommendation?: boolean
}

/**
 * Human-facing copy for each minimum-hold trigger. The OPTION VALUES are NOT hardcoded here — they are
 * derived from the canonical `MINIMUM_HOLD_TRIGGERS` set (single source of WHICH triggers exist). This map
 * supplies only the LABELS (UI copy, which belongs in the web layer).
 *
 * The `Record<MinimumHoldTrigger, string>` typing is the ANTI-DRIFT GUARD: adding a member to the
 * `MinimumHoldTrigger` union forces a COMPILE ERROR here until a label is supplied, so the picker can never
 * silently omit a trigger. Do NOT loosen this to `Partial<Record<…>>` or `Record<string, string>`.
 */
const TRIGGER_LABELS: Record<MinimumHoldTrigger, string> = {
  thesis_broke: 'Thesis broke',
  valuation_inverted: 'Valuation inverted',
  better_opportunity: 'Better opportunity',
  original_mistake: 'Original mistake',
}

const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  display: 'grid',
  gap: '0.6rem',
  padding: '1.25rem 1.4rem',
}

const labelStyle: CSSProperties = {
  color: 'var(--owl-color-accent-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 800,
  letterSpacing: '0.1em',
  margin: 0,
  textTransform: 'uppercase',
}

const fieldLabelStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  display: 'grid',
  fontSize: 'var(--owl-text-sm)',
  gap: '0.25rem',
}

const inputStyle: CSSProperties = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.5rem',
  color: 'var(--owl-color-text)',
  font: 'inherit',
  fontSize: 'var(--owl-text-base)',
  padding: '0.5rem 0.7rem',
}

/** Parse an optional numeric field; empty → undefined, otherwise the finite number (or undefined). */
function optionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

export function SellDecisionRequest({ researchCaseId, hasRecommendation = false }: SellDecisionRequestProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<string>('thesis_broke')
  const [candidateYield, setCandidateYield] = useState('')
  const [heldYield, setHeldYield] = useState('')
  const [switchingFriction, setSwitchingFriction] = useState('')

  const isBetterOpportunity = trigger === 'better_opportunity'

  async function requestSellDecision() {
    setPending(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { trigger }
      if (isBetterOpportunity) {
        const candidate = optionalNumber(candidateYield)
        if (candidate !== undefined) body.candidate_oe_yield = candidate
        const held = optionalNumber(heldYield)
        if (held !== undefined) body.held_oe_yield = held
        const friction = optionalNumber(switchingFriction)
        if (friction !== undefined) body.switching_friction = friction
      }
      const response = await fetch(`/api/research/${researchCaseId}/sell-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const failure = await response.json().catch(() => null)
        setError(resolveErrorMessage(failure))
        return
      }
      // Persisted now — reload so the projection renders the read-only sell decision.
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request the sell decision')
    } finally {
      setPending(false)
    }
  }

  const buttonLabel = pending
    ? 'Computing…'
    : hasRecommendation
      ? 'Re-run sell decision'
      : 'Request sell decision'

  return createElement(
    'section',
    { 'aria-label': 'Sell decision request', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Sell decision'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      hasRecommendation
        ? 'Re-compute the sell decision on-demand against today’s price and the current grounded risk fields. It leads with the worst case and is advisory — the close is human-authored; nothing auto-sells.'
        : 'No sell decision has been computed yet. Request it on-demand against a minimum-hold trigger. It leads with the worst case, runs the fixable-vs-permanent judgment + the minimum-hold guard, and is advisory — the close is human-authored; nothing auto-sells.',
    ),
    createElement(
      'label',
      { style: fieldLabelStyle },
      'Minimum-hold trigger',
      createElement(
        'select',
        {
          'aria-label': 'Minimum-hold trigger',
          value: trigger,
          disabled: pending,
          onChange: (event: { target: { value: string } }) => setTrigger(event.target.value),
          style: inputStyle,
        },
        ...MINIMUM_HOLD_TRIGGERS.map((value) =>
          createElement('option', { key: value, value }, TRIGGER_LABELS[value]),
        ),
      ),
    ),
    // better_opportunity reveals the optional net-OE-yield inputs (the only trigger that consumes them).
    !isBetterOpportunity ? null : createElement(
      'div',
      {
        'data-testid': 'better-opportunity-inputs',
        style: { display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' },
      },
      createElement(
        'label',
        { style: fieldLabelStyle },
        'Candidate OE yield (e.g. 0.08)',
        createElement('input', {
          'aria-label': 'Candidate OE yield',
          type: 'number',
          step: '0.001',
          inputMode: 'decimal',
          value: candidateYield,
          disabled: pending,
          onChange: (event: { target: { value: string } }) => setCandidateYield(event.target.value),
          style: inputStyle,
        }),
      ),
      createElement(
        'label',
        { style: fieldLabelStyle },
        'Held OE yield (e.g. 0.05)',
        createElement('input', {
          'aria-label': 'Held OE yield',
          type: 'number',
          step: '0.001',
          inputMode: 'decimal',
          value: heldYield,
          disabled: pending,
          onChange: (event: { target: { value: string } }) => setHeldYield(event.target.value),
          style: inputStyle,
        }),
      ),
      createElement(
        'label',
        { style: fieldLabelStyle },
        'Switching friction (e.g. 0.01)',
        createElement('input', {
          'aria-label': 'Switching friction',
          type: 'number',
          step: '0.001',
          inputMode: 'decimal',
          value: switchingFriction,
          disabled: pending,
          onChange: (event: { target: { value: string } }) => setSwitchingFriction(event.target.value),
          style: inputStyle,
        }),
      ),
    ),
    createElement(
      'button',
      {
        type: 'button',
        disabled: pending,
        onClick: requestSellDecision,
        style: {
          background: pending ? 'rgba(148, 163, 184, 0.3)' : 'var(--owl-color-accent)',
          border: 0,
          borderRadius: '999px',
          color: '#ffffff',
          cursor: pending ? 'not-allowed' : 'pointer',
          font: 'inherit',
          fontSize: 'var(--owl-text-base)',
          fontWeight: 900,
          justifySelf: 'start',
          opacity: pending ? 0.6 : 1,
          padding: '0.7rem 1.1rem',
        },
      },
      buttonLabel,
    ),
    error === null ? null : createElement(
      'p',
      {
        role: 'alert',
        style: { color: '#fca5a5', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 },
      },
      createElement('strong', null, 'Not computed: '),
      error,
    ),
  )
}
