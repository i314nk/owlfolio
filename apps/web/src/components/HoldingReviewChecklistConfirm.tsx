'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import { CHECKLIST_PARAMS, type ChecklistCategory } from '@owlfolio/strategies/checklistParams'
import { evaluateChecklistCompletion, type ChecklistAnswer } from '@owlfolio/strategies/checklist'

/**
 * The re-underwrite sign-off control — the moment a human confirms a provider-drafted Buffett-Munger
 * holding review into durable portfolio state (holding_review_confirmed). This is the re-underwrite TWIN
 * of WatchlistPromotionForm: the same two Phase 7 hygiene checklists (business failure modes + cognitive
 * biases) must be fully ADDRESSED before sign-off.
 *
 * Integrity invariant (Phase 7 S3): a confirmation previously validated NOTHING — a human-authored
 * transition that didn't require the human to have done anything. Now EVERY checklist item is REQUIRED and
 * NON-PREFILLED; nothing is seeded or suggested — especially the cognitive items. The confirm button stays
 * DISABLED until `evaluateChecklistCompletion` reports the checklist complete (the SAME pure fn the server
 * completion-block uses). Re-underwrite is the only place post-admission deterioration (shariah_drift,
 * data_completeness) gets re-checked.
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio readout
 * is forbidden, because a count is a score in disguise. The disabled submit + per-item "needs attention"
 * markers are the ONLY completeness signal. The checklist FORCES the question; it never scores it.
 */
export type HoldingReviewChecklistConfirmProps = {
  holdingId: string
  reviewId: string
  /**
   * Phase 7 S4 — marshaled evidence per business checklist item (itemId -> persisted display value), a PURE
   * read of the HELD name's research-case projection (reached via the holding's research_case_id), resolved
   * by the caller. Read-only line beside each item; cognitive items are evidence-free by construction. Never
   * pre-fills an answer, never a count/score.
   */
  evidence?: Record<string, string>
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

const checklistNoteStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.85rem',
  color: '#f7f8ff',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.5,
  minHeight: '3.25rem',
  padding: '0.75rem 0.85rem',
  resize: 'vertical',
  width: '100%',
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

/** Read-only marshaled-evidence line style (S4) — a calm, secondary readout, never an input. */
const evidenceLineStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  lineHeight: 1.4,
  margin: 0,
  wordBreak: 'break-word',
}

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

export function HoldingReviewChecklistConfirm({ holdingId, reviewId, evidence = {} }: HoldingReviewChecklistConfirmProps) {
  // Every checklist answer starts EMPTY — no seeding/suggestion (the cognitive items are human-only).
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>(initialAnswers)

  // The SAME pure, decision-neutral evaluator the server completion-block uses. It reports ONLY which
  // items are unaddressed — never a count/score.
  const completion = evaluateChecklistCompletion(answers)
  const unaddressed = new Set(completion.unaddressed)
  const canConfirm = completion.complete

  function setNote(id: string, note: string): void {
    setAnswers((prev) => ({ ...prev, [id]: { addressed: prev[id]?.addressed ?? false, note } }))
  }

  function setAddressed(id: string, addressed: boolean): void {
    setAnswers((prev) => ({ ...prev, [id]: { addressed, note: prev[id]?.note ?? '' } }))
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
          { htmlFor: `review-checklist-note-${item.id}`, style: { color: 'var(--owl-color-text)', fontWeight: 700 } },
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
      // Phase 7 S4 — marshaled evidence (read-only, reads-only). Re-underwrite re-checks drift since
      // admission, so the held name's persisted projection value reads beside each business item.
      evidence[item.id] !== undefined
        ? createElement(
            'p',
            { 'data-testid': `checklist-evidence-${item.id}`, style: evidenceLineStyle },
            `Marshaled evidence: ${evidence[item.id]}`,
          )
        : null,
      createElement('textarea', {
        'aria-label': item.prompt,
        id: `review-checklist-note-${item.id}`,
        name: `checklist_note[${item.id}]`,
        onChange: (event: { target: { value: string } }) => setNote(item.id, event.target.value),
        placeholder: 'Your reasoned note — in your own words.',
        style: checklistNoteStyle,
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
      'A re-underwrite is a real decision, not a rubber stamp. Address every quality and bias check below in '
      + 'your own words before signing off — nothing is pre-filled, the cognitive checks are yours alone, and '
      + 'this is the moment to catch any drift since admission. Items still needing attention are marked; the '
      + 'confirm button stays disabled until all are addressed.',
    ),
    renderChecklistGroup('business'),
    renderChecklistGroup('cognitive'),
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
