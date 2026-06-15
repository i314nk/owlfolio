'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import { CHECKLIST_PARAMS, type ChecklistCategory } from '@owlfolio/strategies/checklistParams'
import { evaluateChecklistCompletion, type ChecklistAnswer } from '@owlfolio/strategies/checklist'

/**
 * The admit/promote control — the moment a drafted research case becomes a durable, user-authored
 * watchlist entry. This is where the human actually MAKES the decision, so the signed thesis must be
 * the human's own words AND the two Phase 7 hygiene checklists (business failure modes + cognitive
 * biases) must be fully ADDRESSED before sign-off.
 *
 * Integrity invariant (Task 4.3 + Phase 7 S2): the signed-thesis field and EVERY checklist item are
 * REQUIRED and NON-PREFILLED. Nothing defaults to the agent draft, and nothing — especially the
 * cognitive items — is seeded or suggested. The promote button stays DISABLED until the human types a
 * non-empty thesis AND `evaluateChecklistCompletion` reports the checklist complete (the SAME pure fn the
 * server completion-block uses).
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio
 * readout is forbidden, because a count is a score in disguise. The disabled submit + per-item "needs
 * attention" markers are the ONLY completeness signal. The checklist FORCES the question; it never
 * scores it.
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

const checklistNoteStyle: CSSProperties = {
  ...textareaStyle,
  minHeight: '3.25rem',
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

export function WatchlistPromotionForm({ researchCaseId }: WatchlistPromotionFormProps) {
  // Start EMPTY — never seeded from the agent's thesis_summary. The human must write this.
  const [signedThesis, setSignedThesis] = useState('')
  // Every checklist answer starts EMPTY — no seeding/suggestion (the cognitive items are human-only).
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>(initialAnswers)

  const hasThesis = signedThesis.trim().length > 0
  // The SAME pure, decision-neutral evaluator the server completion-block uses. It reports ONLY which
  // items are unaddressed — never a count/score.
  const completion = evaluateChecklistCompletion(answers)
  const unaddressed = new Set(completion.unaddressed)
  const canPromote = hasThesis && completion.complete

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
          { htmlFor: `checklist-note-${item.id}`, style: { color: 'var(--owl-color-text)', fontWeight: 700 } },
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
        id: `checklist-note-${item.id}`,
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
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.25rem 0 0' } },
        'Before signing off, address every quality and bias check below. Each must be considered in your own '
        + 'words — nothing here is pre-filled, and the cognitive checks are yours alone. Items still needing '
        + 'attention are marked; the promote button stays disabled until all are addressed.',
      ),
      renderChecklistGroup('business'),
      renderChecklistGroup('cognitive'),
      createElement(
        'button',
        {
          type: 'submit',
          disabled: !canPromote,
          style: {
            background: canPromote ? 'var(--owl-color-gold)' : 'rgba(148, 163, 184, 0.3)',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: canPromote ? 'pointer' : 'not-allowed',
            fontSize: 'var(--owl-text-base)',
            fontWeight: 900,
            justifySelf: 'start',
            opacity: canPromote ? 1 : 0.6,
            padding: '0.75rem 1rem',
          },
        },
        'Promote to watchlist',
      ),
    ),
  )
}
