'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import {
  listBusinessItems,
  listCognitiveItems,
  type ChecklistItemDefinition,
} from '@owlfolio/strategies/checklistParams'

/**
 * The re-underwrite CONFIRM sign-off control — the moment a human AFFIRMS a provider-drafted Buffett-Munger
 * holding review into durable portfolio state (holding_review_confirmed). Sign-off is INVERTED to
 * audit-and-decide (the re-underwrite TWIN of WatchlistPromotionForm): the HARNESS marshals the analysis
 * (one read-only finding per business item) and the human just AUDITS it and makes ONE decision — a SINGLE
 * cognitive-reflection acknowledgement. Confirm APPLIES the provider draft as-is, so the human authors NO
 * thesis here; the only thing they post is the single acknowledgement.
 *
 * The 11 business findings are server-marshaled and rendered READ-ONLY; the client never authors or posts
 * them (the server recomputes them at sign-off). There is NO per-item input and NO per-item checkbox. The 6
 * cognitive items render as read-only reflection prompts gated by EXACTLY ONE acknowledgement checkbox.
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio readout
 * is forbidden, because a count is a score in disguise. The confirm button is enabled IFF the single
 * cognitive ack is checked.
 */
export type HoldingReviewChecklistConfirmProps = {
  holdingId: string
  reviewId: string
  /**
   * The harness-marshaled finding per BUSINESS item (itemId -> finding), a PURE read of the HELD name's
   * research-case projection resolved by the caller. Rendered as a read-only line the human audits before
   * affirming. The client NEVER posts these — the server recomputes them so a finding can't be authored or
   * spoofed.
   */
  businessFindings: Record<string, string>
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

const groupHeadingStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 800,
  letterSpacing: '0.04em',
  margin: '1.1rem 0 0.5rem',
  textTransform: 'uppercase',
}

/** Read-only marshaled-finding line style — a calm, secondary readout, never an input. */
const findingLineStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  lineHeight: 1.4,
  margin: 0,
  wordBreak: 'break-word',
}

const itemCardStyle: CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '0.75rem',
  display: 'grid',
  gap: '0.4rem',
  padding: '0.6rem 0.75rem',
}

const promptStyle: CSSProperties = { color: 'var(--owl-color-text)', fontWeight: 700 }

/** One READ-ONLY business item: the prompt + the harness's marshaled finding. No input, no checkbox. */
function renderBusinessItem(item: ChecklistItemDefinition, findings: Record<string, string>): ReactNode {
  const finding = findings[item.id] ?? 'No marshaled finding available in this case.'
  return createElement(
    'div',
    { key: item.id, style: itemCardStyle },
    createElement('p', { style: promptStyle }, item.prompt),
    createElement(
      'p',
      { 'data-testid': `checklist-finding-${item.id}`, style: findingLineStyle },
      `Marshaled finding: ${finding}`,
    ),
  )
}

/** One READ-ONLY cognitive reflection prompt. The human reflects; there is no per-item input. */
function renderCognitiveItem(item: ChecklistItemDefinition): ReactNode {
  return createElement(
    'div',
    { key: item.id, style: itemCardStyle },
    createElement('p', { style: promptStyle }, item.prompt),
  )
}

export function HoldingReviewChecklistConfirm({ holdingId, reviewId, businessFindings }: HoldingReviewChecklistConfirmProps) {
  // The single human acknowledgement that they reflected on the 6 cognitive bias prompts. Never seeded.
  const [cognitiveAck, setCognitiveAck] = useState(false)

  // Confirm APPLIES the provider draft — the human authors no thesis here, so the only gate is the single
  // cognitive acknowledgement. No 17-field gating, no count/score.
  const canConfirm = cognitiveAck

  return createElement(
    'form',
    {
      id: 'holding-review-path-confirm',
      action: `/api/portfolio/${holdingId}/review/${reviewId}/confirm`,
      method: 'post',
      style: {
        background: 'rgba(22, 163, 74, 0.10)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: 'var(--owl-radius-panel)',
        display: 'grid',
        gap: '0.75rem',
        padding: '1rem 1.1rem',
      },
    },
    createElement('p', { style: labelStyle }, 'Re-underwrite sign-off'),
    createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Apply provider draft'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      'Applies the provider-authored thesis health, action stance, and next review date to portfolio state.',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.25rem 0 0' } },
      'A re-underwrite is a real decision, not a rubber stamp. Below is the harness-marshaled analysis. Audit '
      + 'each business finding against the provider draft and the original thesis, reflect on the reasoning '
      + 'checks, then acknowledge before signing off. This is the moment to catch any drift since admission.',
    ),
    createElement(
      'fieldset',
      { style: { border: 0, margin: 0, padding: 0 } },
      createElement('legend', { style: groupHeadingStyle }, 'Business failure modes'),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.6rem' } },
        ...listBusinessItems().map((item) => renderBusinessItem(item, businessFindings)),
      ),
    ),
    createElement(
      'fieldset',
      { style: { border: 0, margin: 0, padding: 0 } },
      createElement('legend', { style: groupHeadingStyle }, 'Cognitive biases'),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.6rem' } },
        ...listCognitiveItems().map(renderCognitiveItem),
      ),
    ),
    createElement(
      'label',
      {
        style: {
          alignItems: 'center',
          color: 'var(--owl-color-text)',
          display: 'flex',
          fontSize: 'var(--owl-text-sm)',
          fontWeight: 700,
          gap: '0.5rem',
        },
      },
      createElement('input', {
        checked: cognitiveAck,
        name: 'cognitive_reflection_acknowledged',
        onChange: (event: { target: { checked: boolean } }) => setCognitiveAck(event.target.checked),
        type: 'checkbox',
      }),
      createElement('span', null, 'I have reflected on these reasoning checks for my own thinking.'),
    ),
    createElement(
      'button',
      {
        type: 'submit',
        disabled: !canConfirm,
        style: {
          background: canConfirm ? 'var(--owl-color-accent)' : 'rgba(148, 163, 184, 0.3)',
          border: 0,
          borderRadius: '999px',
          color: '#ffffff',
          cursor: canConfirm ? 'pointer' : 'not-allowed',
          fontSize: 'var(--owl-text-base)',
          fontWeight: 900,
          justifySelf: 'start',
          opacity: canConfirm ? 1 : 0.6,
          padding: '0.75rem 1rem',
        },
      },
      'Apply provider draft',
    ),
  )
}
