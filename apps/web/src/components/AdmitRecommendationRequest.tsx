'use client'

import { createElement, useState, type CSSProperties } from 'react'

import { resolveErrorMessage } from '../app/research/new/resolveErrorMessage'

/**
 * The on-demand admit-judgment REQUEST control (Task 4.3-panel).
 *
 * This is the human computing the recommendation when considering admission. It POSTs to
 * `/api/research/{caseId}/admit-judgment`, which fails-closed when the provider isn't ready and rejects
 * a case that is not a deep-dive-complete / gate-passing admission candidate. On success the route emits
 * the `admit_judgment_recorded` OBSERVATION and the persisted recommendation is projected onto the case;
 * we reload so the read-only recommendation panel renders from PERSISTED data (never recomputed here).
 *
 * It NEVER admits the name — admission stays the human signed-thesis decision below.
 */
export type AdmitRecommendationRequestProps = {
  researchCaseId: string
  /** True once a recommendation is already persisted — the control then offers a re-run instead. */
  hasRecommendation?: boolean
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

export function AdmitRecommendationRequest({ researchCaseId, hasRecommendation = false }: AdmitRecommendationRequestProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestJudgment() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/research/${researchCaseId}/admit-judgment`, { method: 'POST' })
      if (!response.ok) {
        // Object-shaped error from the route: { error: { code, message } } (not-candidate / provider-not-ready).
        const body = await response.json().catch(() => null)
        setError(resolveErrorMessage(body))
        return
      }
      // Persisted now — reload so the projection renders the read-only recommendation.
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request the admit judgment')
    } finally {
      setPending(false)
    }
  }

  const buttonLabel = pending
    ? 'Computing…'
    : hasRecommendation
      ? 'Re-run admit judgment'
      : 'Request admit judgment'

  return createElement(
    'section',
    { 'aria-label': 'Admit judgment request', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Admit judgment'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      hasRecommendation
        ? 'Re-compute the admit recommendation on-demand against today’s fundamentals and price. The recommendation is advisory — you still admit the name yourself below.'
        : 'No admit recommendation has been computed yet. Request it on-demand when you are considering admission. It is advisory — you still admit the name yourself below.',
    ),
    createElement(
      'button',
      {
        type: 'button',
        disabled: pending,
        onClick: requestJudgment,
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
