'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import { CHECKLIST_PARAMS, type ChecklistCategory } from '@owlfolio/strategies/checklistParams'
import { evaluateChecklistCompletion, type ChecklistAnswer } from '@owlfolio/strategies/checklist'

/**
 * The OVERRIDE re-underwrite sign-off control — the co-equal twin of HoldingReviewChecklistConfirm. The
 * override writes the SAME confirmed thesis state as confirm (user-authored thesis values instead of the
 * provider draft), so it is gated on the SAME two Phase 7 hygiene checklists (business failure modes +
 * cognitive biases). Gating only confirm and not override would reopen the exact gap Phase 7 S3 closed (a
 * sign-off that signs off on nothing).
 *
 * Integrity invariant (Phase 7 S3 bypass close): EVERY checklist item is REQUIRED and NON-PREFILLED; nothing
 * is seeded or suggested — especially the cognitive items. The override button stays DISABLED until BOTH the
 * required thesis fields are filled AND `evaluateChecklistCompletion` reports the checklist complete (the
 * SAME pure fn the server completion-block uses).
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio readout
 * is forbidden, because a count is a score in disguise. The disabled submit + per-item "needs attention"
 * markers are the ONLY completeness signal. The checklist FORCES the question; it never scores it.
 */
export type HoldingReviewOverrideFormProps = {
  holdingId: string
  reviewId: string
  defaultThesisHealth: string
  defaultActionStance: string
  defaultNextReviewAt: string
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

const CATEGORY_HEADINGS: Record<ChecklistCategory, string> = {
  business: 'Business failure modes',
  cognitive: 'Cognitive biases',
}

/** A human-readable label for the per-item "needs attention" marker, never a count. */
const NEEDS_ATTENTION_LABEL = 'Needs attention'

const THESIS_HEALTH_VALUES = ['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE']
const ACTION_STANCE_VALUES = ['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE']

function emptyAnswer(): ChecklistAnswer {
  return { addressed: false, note: '' }
}

/** All checklist items start EMPTY — never seeded, especially the cognitive ones. */
function initialAnswers(): Record<string, ChecklistAnswer> {
  const answers: Record<string, ChecklistAnswer> = {}
  for (const item of CHECKLIST_PARAMS.items) {
    answers[item.id] = emptyAnswer()
  }
  return answers
}

export function HoldingReviewOverrideForm({
  holdingId,
  reviewId,
  defaultThesisHealth,
  defaultActionStance,
  defaultNextReviewAt,
}: HoldingReviewOverrideFormProps) {
  // The user-authored thesis fields start EMPTY (rationale/evidence/uncertainty/date) — an override is a real
  // decision, not a rubber stamp; selects default to a sensible starting value but are still user-confirmed.
  const [thesisHealth, setThesisHealth] = useState(defaultThesisHealth)
  const [actionStance, setActionStance] = useState(defaultActionStance)
  const [rationale, setRationale] = useState('')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [uncertainty, setUncertainty] = useState('')
  const [nextReviewAt, setNextReviewAt] = useState(defaultNextReviewAt)

  // Every checklist answer starts EMPTY — no seeding/suggestion (the cognitive items are human-only).
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>(initialAnswers)

  // The SAME pure, decision-neutral evaluator the server completion-block uses. It reports ONLY which items
  // are unaddressed — never a count/score.
  const completion = evaluateChecklistCompletion(answers)
  const unaddressed = new Set(completion.unaddressed)

  const thesisFieldsComplete =
    rationale.trim().length > 0
    && evidenceSummary.trim().length > 0
    && uncertainty.trim().length > 0
    && nextReviewAt.trim().length > 0
  // Submit is gated on BOTH the override thesis fields AND the full checklist.
  const canOverride = thesisFieldsComplete && completion.complete

  function setNote(id: string, note: string): void {
    setAnswers((prev) => ({ ...prev, [id]: { addressed: prev[id]?.addressed ?? false, note } }))
  }

  function setAddressed(id: string, addressed: boolean): void {
    setAnswers((prev) => ({ ...prev, [id]: { addressed, note: prev[id]?.note ?? '' } }))
  }

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

  function renderChecklistItem(item: (typeof CHECKLIST_PARAMS.items)[number]): ReactNode {
    const answer = answers[item.id] ?? emptyAnswer()
    const needsAttention = unaddressed.has(item.id)
    return createElement(
      'div',
      {
        key: item.id,
        style: {
          border: needsAttention ? '1px solid var(--owl-color-gold)' : '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: '0.75rem',
          display: 'grid',
          gap: '0.4rem',
          padding: '0.6rem 0.75rem',
        },
      },
      createElement(
        'div',
        { style: { alignItems: 'baseline', display: 'flex', gap: '0.5rem', justifyContent: 'space-between' } },
        createElement(
          'label',
          { htmlFor: `override-checklist-note-${item.id}`, style: { color: 'var(--owl-color-text)', fontWeight: 700 } },
          item.prompt,
        ),
        // Per-item completeness marker — "Needs attention", never a count. Only shown when unaddressed.
        needsAttention
          ? createElement(
              'span',
              {
                style: {
                  color: 'var(--owl-color-gold-bright)',
                  flexShrink: 0,
                  fontSize: 'var(--owl-text-xs)',
                  fontWeight: 800,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                },
              },
              NEEDS_ATTENTION_LABEL,
            )
          : null,
      ),
      createElement('textarea', {
        'aria-label': item.prompt,
        id: `override-checklist-note-${item.id}`,
        name: `checklist_note[${item.id}]`,
        onChange: (event: { target: { value: string } }) => setNote(item.id, event.target.value),
        placeholder: 'Your reasoned note — in your own words.',
        style: textareaStyle,
        value: answer.note,
      }),
      createElement(
        'label',
        { style: { alignItems: 'center', color: 'var(--owl-color-muted)', display: 'flex', fontSize: 'var(--owl-text-sm)', gap: '0.4rem' } },
        createElement('input', {
          checked: answer.addressed,
          name: `checklist_addressed[${item.id}]`,
          onChange: (event: { target: { checked: boolean } }) => setAddressed(item.id, event.target.checked),
          type: 'checkbox',
        }),
        createElement('span', null, 'I have addressed this'),
      ),
    )
  }

  function renderChecklistGroup(category: ChecklistCategory): ReactNode {
    const items = CHECKLIST_PARAMS.items.filter((item) => item.category === category)
    return createElement(
      'fieldset',
      { key: category, style: { border: 0, margin: 0, padding: 0 } },
      createElement('legend', { style: groupHeadingStyle }, CATEGORY_HEADINGS[category]),
      createElement('div', { style: { display: 'grid', gap: '0.6rem' } }, ...items.map(renderChecklistItem)),
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
      'An override is a real re-underwrite, not a shortcut. Author every required thesis field AND address '
      + 'every quality and bias check below in your own words before signing off — nothing is pre-filled, the '
      + 'cognitive checks are yours alone. Items still needing attention are marked; the override button stays '
      + 'disabled until your thesis fields and all checks are addressed.',
    ),
    renderSelect('Override thesis health', 'thesis_health', THESIS_HEALTH_VALUES, thesisHealth, setThesisHealth),
    renderSelect('Override action stance', 'action_stance', ACTION_STANCE_VALUES, actionStance, setActionStance),
    renderTextarea('Override rationale (required)', 'rationale', rationale, setRationale, 'Your own re-underwrite rationale.'),
    renderTextarea('Override evidence summary (required)', 'evidence_summary', evidenceSummary, setEvidenceSummary, 'The evidence you reviewed.'),
    renderTextarea('Override uncertainty (required)', 'uncertainty', uncertainty, setUncertainty, 'What remains uncertain.'),
    renderDateInput('Override next review date (required)', 'next_review_at', nextReviewAt, setNextReviewAt),
    renderChecklistGroup('business'),
    renderChecklistGroup('cognitive'),
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
