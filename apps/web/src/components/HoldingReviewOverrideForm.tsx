'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import {
  listBusinessItems,
  listCognitiveItems,
  type ChecklistItemDefinition,
} from '@owlfolio/strategies/checklistParams'

/**
 * The OVERRIDE re-underwrite sign-off control — the co-equal twin of HoldingReviewChecklistConfirm. The
 * override writes the SAME confirmed thesis state as confirm, but the human AUTHORS their own thesis values
 * (thesis_health / action_stance / rationale / evidence_summary / uncertainty / next_review_at) instead of
 * applying the provider draft — those authored fields are the human's substitute judgment and STAY.
 *
 * Sign-off is INVERTED to audit-and-decide just like confirm: the HARNESS marshals the 11 business findings
 * (rendered READ-ONLY; the client never authors or posts them) and the 6 cognitive items render as read-only
 * reflection prompts gated by EXACTLY ONE acknowledgement checkbox. Gating only confirm and not override
 * would reopen the exact gap Phase 7 closed (a sign-off that signs off on nothing).
 *
 * The override button stays DISABLED until BOTH the required authored thesis fields are filled AND the
 * single cognitive acknowledgement is checked.
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio readout
 * is forbidden, because a count is a score in disguise.
 */
export type HoldingReviewOverrideFormProps = {
  holdingId: string
  reviewId: string
  defaultThesisHealth: string
  defaultActionStance: string
  defaultNextReviewAt: string
  /**
   * The harness-marshaled finding per BUSINESS item (itemId -> finding), a PURE read of the HELD name's
   * research-case projection resolved by the caller. Rendered as a read-only line the human audits before
   * overriding. The client NEVER posts these — the server recomputes them so a finding can't be authored or
   * spoofed.
   */
  businessFindings: Record<string, string>
}

const labelStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 800,
  letterSpacing: '0.1em',
  margin: '0 0 0.5rem',
  textTransform: 'uppercase',
}

const fieldLabelStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  display: 'grid',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 700,
  gap: '0.3rem',
}

const inputStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.6rem',
  color: '#f7f8ff',
  fontSize: 'var(--owl-text-base)',
  padding: '0.55rem 0.7rem',
  width: '100%',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  borderRadius: '0.85rem',
  lineHeight: 1.5,
  minHeight: '3.25rem',
  resize: 'vertical',
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

const THESIS_HEALTH_VALUES = ['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE']
const ACTION_STANCE_VALUES = ['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE']

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

export function HoldingReviewOverrideForm({
  holdingId,
  reviewId,
  defaultThesisHealth,
  defaultActionStance,
  defaultNextReviewAt,
  businessFindings,
}: HoldingReviewOverrideFormProps) {
  // The user-authored thesis fields the override substitutes for the provider draft. Free-text fields start
  // EMPTY (an override is a real decision, not a rubber stamp); selects/date default to a sensible starting
  // value but are still user-confirmed.
  const [thesisHealth, setThesisHealth] = useState(defaultThesisHealth)
  const [actionStance, setActionStance] = useState(defaultActionStance)
  const [rationale, setRationale] = useState('')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [uncertainty, setUncertainty] = useState('')
  const [nextReviewAt, setNextReviewAt] = useState(defaultNextReviewAt)

  // The single human acknowledgement that they reflected on the 6 cognitive bias prompts. Never seeded.
  const [cognitiveAck, setCognitiveAck] = useState(false)

  const thesisFieldsComplete =
    rationale.trim().length > 0
    && evidenceSummary.trim().length > 0
    && uncertainty.trim().length > 0
    && nextReviewAt.trim().length > 0
  // Submit is gated on BOTH the authored override thesis fields AND the single cognitive ack.
  const canOverride = thesisFieldsComplete && cognitiveAck

  function renderSelect(label: string, name: string, values: string[], value: string, onChange: (next: string) => void): ReactNode {
    return createElement(
      'label',
      { key: name, style: fieldLabelStyle },
      label,
      createElement(
        'select',
        {
          name,
          value,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          style: inputStyle,
        },
        ...values.map((option) => createElement('option', { key: option, value: option }, option)),
      ),
    )
  }

  function renderTextarea(label: string, name: string, value: string, onChange: (next: string) => void, placeholder: string): ReactNode {
    return createElement(
      'label',
      { key: name, style: fieldLabelStyle },
      label,
      createElement('textarea', {
        name,
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        placeholder,
        style: textareaStyle,
      }),
    )
  }

  function renderDateInput(label: string, name: string, value: string, onChange: (next: string) => void): ReactNode {
    return createElement(
      'label',
      { key: name, style: fieldLabelStyle },
      label,
      createElement('input', {
        name,
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        placeholder: 'YYYY-MM-DD',
        style: inputStyle,
      }),
    )
  }

  return createElement(
    'form',
    {
      id: 'holding-review-path-override',
      action: `/api/portfolio/${holdingId}/review/${reviewId}/override`,
      method: 'post',
      style: {
        background: 'rgba(214, 178, 94, 0.12)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: 'var(--owl-radius-panel)',
        display: 'grid',
        gap: '0.6rem',
        padding: '1rem 1.1rem',
      },
    },
    createElement('p', { style: labelStyle }, 'Re-underwrite override sign-off'),
    createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Apply user override'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      'Applies your edited values instead of the provider draft and records a user-authored audit event.',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.25rem 0 0' } },
      'An override is a real re-underwrite, not a shortcut. Author every required thesis field below — these '
      + 'are your substitute judgment and stay. Then audit the harness-marshaled findings, reflect on the '
      + 'reasoning checks, and acknowledge before signing off. The button stays disabled until your thesis '
      + 'fields are filled and the reflection is acknowledged.',
    ),
    renderSelect('Override thesis health', 'thesis_health', THESIS_HEALTH_VALUES, thesisHealth, setThesisHealth),
    renderSelect('Override action stance', 'action_stance', ACTION_STANCE_VALUES, actionStance, setActionStance),
    renderTextarea('Override rationale (required)', 'rationale', rationale, setRationale, 'Your own re-underwrite rationale.'),
    renderTextarea('Override evidence summary (required)', 'evidence_summary', evidenceSummary, setEvidenceSummary, 'The evidence you reviewed.'),
    renderTextarea('Override uncertainty (required)', 'uncertainty', uncertainty, setUncertainty, 'What remains uncertain.'),
    renderDateInput('Override next review date (required)', 'next_review_at', nextReviewAt, setNextReviewAt),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.25rem 0 0' } },
      'Below is the harness-marshaled analysis. Audit each business finding against your authored thesis, '
      + 'reflect on the reasoning checks, then acknowledge before signing off.',
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
        disabled: !canOverride,
        style: {
          background: canOverride ? 'var(--owl-color-gold)' : 'rgba(148, 163, 184, 0.3)',
          border: 0,
          borderRadius: '999px',
          color: '#1b1505',
          cursor: canOverride ? 'pointer' : 'not-allowed',
          fontSize: 'var(--owl-text-base)',
          fontWeight: 900,
          justifySelf: 'start',
          opacity: canOverride ? 1 : 0.6,
          padding: '0.75rem 1rem',
        },
      },
      'Apply user override',
    ),
  )
}
