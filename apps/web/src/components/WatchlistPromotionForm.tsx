'use client'

import { createElement, type CSSProperties } from 'react'

/**
 * The promote-to-watchlist control — the moment a drafted research case becomes a durable, user-authored
 * watchlist entry. This is REVIEW-AND-PROMOTE: the dossier above (the bear case, the key wrong assumption,
 * and the thesis-break triggers) is the analysis the decision rests on. The human reviews it and, when
 * ready, makes ONE explicit commitment — clicking "Promote to watchlist". That click IS the human-authored
 * transition.
 *
 * There is deliberately NO required signed-thesis textarea, NO checklist completion gate, and NO
 * cognitive-reflection toggle here: the ceremony was removed, the substance (the dossier) stays. The
 * server sources the audit/thesis provenance for the ledger event; the human's job is the decision, not
 * re-authoring the analysis. DECISION-NEUTRAL: no count/score/progress readout. The button is always
 * enabled (no gating).
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

export function WatchlistPromotionForm({ researchCaseId }: WatchlistPromotionFormProps) {
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
      'Promote this name to your watchlist when ready.',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0 0 1rem' } },
      "You've reviewed the dossier above — the bear case, the key wrong assumption, and the thesis-break "
      + 'triggers. Promote this name to your watchlist when ready.',
    ),
    createElement(
      'form',
      {
        action: `/api/research/${researchCaseId}/watchlist`,
        method: 'post',
        style: { display: 'grid', gap: '0.75rem' },
      },
      createElement(
        'button',
        {
          type: 'submit',
          style: {
            background: 'var(--owl-color-gold)',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: 'var(--owl-text-base)',
            fontWeight: 900,
            justifySelf: 'start',
            padding: '0.75rem 1rem',
          },
        },
        'Promote to watchlist',
      ),
    ),
  )
}
