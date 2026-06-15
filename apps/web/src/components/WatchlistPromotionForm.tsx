'use client'

import { createElement, useState, type CSSProperties } from 'react'

/**
 * The admit/promote control — the moment a drafted research case becomes a durable, user-authored
 * watchlist entry. This is where the human actually MAKES the decision, so the signed thesis must be
 * the human's own words.
 *
 * Integrity invariant (Task 4.3): the signed-thesis field is REQUIRED and NON-PREFILLED. It must NOT
 * default to the agent-drafted `thesis_summary` — a prefilled, one-click-acceptable field would just
 * recreate the rubber-stamp this control exists to prevent. The promote button stays DISABLED until the
 * human types a non-empty thesis, and the route refuses an admit with no human thesis (no auto-fallback
 * to the agent summary).
 */
export type WatchlistPromotionFormProps = {
  researchCaseId: string
}

const cardStyle: CSSProperties = {
  background: 'rgba(214, 178, 94, 0.12)',
  border: '1px solid var(--owl-color-gold)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: '1.25rem 1.4rem',
}

const labelStyle: CSSProperties = {
  color: 'var(--owl-color-accent-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 800,
  letterSpacing: '0.1em',
  margin: '0 0 0.5rem',
  textTransform: 'uppercase',
}

const textareaStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.85rem',
  color: '#f7f8ff',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.5,
  minHeight: '6rem',
  padding: '0.75rem 0.85rem',
  resize: 'vertical',
  width: '100%',
}

export function WatchlistPromotionForm({ researchCaseId }: WatchlistPromotionFormProps) {
  // Start EMPTY — never seeded from the agent's thesis_summary. The human must write this.
  const [signedThesis, setSignedThesis] = useState('')
  const hasThesis = signedThesis.trim().length > 0

  return createElement(
    'section',
    { style: cardStyle },
    createElement('p', { style: labelStyle }, 'User confirmation'),
    createElement(
      'p',
      {
        style: {
          color: 'var(--owl-color-gold-bright)',
          fontSize: 'var(--owl-text-md)',
          fontWeight: 700,
          margin: '0.35rem 0 0.75rem',
        },
      },
      'Advance this drafted decision into durable personal-local watchlist state.',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0 0 1rem' } },
      'Write your own signed thesis in your words — this is the human commitment that makes admission a real decision, not a rubber stamp. It is not pre-filled from the agent draft on purpose.',
    ),
    createElement(
      'form',
      {
        action: `/api/research/${researchCaseId}/watchlist`,
        method: 'post',
        style: { display: 'grid', gap: '0.75rem' },
      },
      createElement(
        'label',
        { style: { display: 'grid', fontWeight: 700, gap: '0.4rem' }, htmlFor: 'signed-thesis' },
        createElement('span', { style: { color: 'var(--owl-color-text)' } }, 'Your signed thesis (required)'),
        createElement('textarea', {
          'aria-label': 'Your signed thesis',
          id: 'signed-thesis',
          name: 'signed_thesis',
          onChange: (event: { target: { value: string } }) => setSignedThesis(event.target.value),
          placeholder: 'Why you are admitting this name — in your own words.',
          required: true,
          style: textareaStyle,
          value: signedThesis,
        }),
      ),
      createElement(
        'button',
        {
          type: 'submit',
          disabled: !hasThesis,
          style: {
            background: hasThesis ? 'var(--owl-color-gold)' : 'rgba(148, 163, 184, 0.3)',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: hasThesis ? 'pointer' : 'not-allowed',
            fontSize: 'var(--owl-text-base)',
            fontWeight: 900,
            justifySelf: 'start',
            opacity: hasThesis ? 1 : 0.6,
            padding: '0.75rem 1rem',
          },
        },
        'Promote to watchlist',
      ),
    ),
  )
}
