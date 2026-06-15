'use client'

import { createElement, useState, type CSSProperties } from 'react'

import { resolveErrorMessage } from '../app/research/new/resolveErrorMessage'

/**
 * The on-demand SIZING REQUEST control (Phase 5 S7).
 *
 * This is the human computing the sizing recommendation when considering a buy. It POSTs to
 * `/api/research/{caseId}/sizing`, which fails-closed when the provider isn't ready and rejects a case
 * that is not a watched/admittable sizing candidate (no locked buy-below / no recorded admit
 * recommendation carrying the downside floor + risk levels). On success the route emits the
 * `sizing_recommendation_recorded` OBSERVATION and the persisted recommendation is projected onto the
 * case; we reload so the read-only sizing panel renders from PERSISTED data (never recomputed here).
 *
 * It NEVER opens the holding — the buy stays the human-signed holding-open form.
 */
export type SizingRecommendationRequestProps = {
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

export function SizingRecommendationRequest({ researchCaseId, hasRecommendation = false }: SizingRecommendationRequestProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestSizing() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/research/${researchCaseId}/sizing`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(resolveErrorMessage(body))
        return
      }
      // Persisted now — reload so the projection renders the read-only recommendation.
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request the sizing recommendation')
    } finally {
      setPending(false)
    }
  }

  const buttonLabel = pending
    ? 'Computing…'
    : hasRecommendation
      ? 'Re-run sizing'
      : 'Request sizing'

  return createElement(
    'section',
    { 'aria-label': 'Sizing request', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Position sizing'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      hasRecommendation
        ? 'Re-compute the sizing recommendation on-demand against today’s price, downside floor, and the held book. It is advisory — you still author and sign the buy below; nothing auto-trades.'
        : 'No sizing recommendation has been computed yet. Request it on-demand when you are considering the buy. It leads with the worst case, applies the deployment / permanent-loss / cluster caps, and is advisory — you still author and sign the buy below.',
    ),
    createElement(
      'button',
      {
        type: 'button',
        disabled: pending,
        onClick: requestSizing,
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
