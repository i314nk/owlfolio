'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

import {
  listBusinessItems,
  listCognitiveItems,
  type ChecklistItemDefinition,
} from '@owlfolio/strategies/checklistParams'

/**
 * The admit/promote control — the moment a drafted research case becomes a durable, user-authored
 * watchlist entry. Sign-off is INVERTED to audit-and-decide: the HARNESS marshals the analysis (a
 * pre-filled draft thesis + one read-only finding per business item) and the human just AUDITS it and
 * makes ONE decision — affirm-or-amend the thesis + a SINGLE cognitive-reflection acknowledgement.
 *
 * What the human authors here is exactly two things:
 *  - the FINAL signed thesis (pre-filled from the agent draft; affirm verbatim OR amend), and
 *  - the SINGLE acknowledgement that they reflected on the 6 cognitive bias prompts.
 * The 11 business findings are server-marshaled and rendered READ-ONLY; the client never authors or posts
 * them (the server recomputes them at sign-off). There is NO per-item input and NO per-item checkbox.
 *
 * DECISION-NEUTRAL surface: there is NO count or progress badge — any "N done", "N left", or ratio
 * readout is forbidden, because a count is a score in disguise. The promote button is enabled IFF the
 * thesis is non-empty AND the single cognitive ack is checked.
 */
export type WatchlistPromotionFormProps = {
  researchCaseId: string
  /**
   * The agent-drafted thesis the human reviews. PRE-FILLS the signed-thesis textarea (affirm-or-amend).
   * The server re-derives the same draft at sign-off and persists it as `signed_thesis_draft`; the client
   * cannot spoof it.
   */
  thesisDraft: string
  /**
   * The harness-marshaled finding per BUSINESS item (itemId -> finding), a PURE read of the research-case
   * projection resolved by the caller. Rendered as a read-only line the human audits before deciding. The
   * client NEVER posts these — the server recomputes them so a finding can't be authored or spoofed.
   */
  businessFindings: Record<string, string>
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

export function WatchlistPromotionForm({ researchCaseId, thesisDraft, businessFindings }: WatchlistPromotionFormProps) {
  // PRE-FILLED from the agent draft (audit-and-decide): the human affirms it verbatim or amends it. Still
  // required non-empty — an emptied thesis cannot be signed.
  const [signedThesis, setSignedThesis] = useState(thesisDraft)
  // The single human acknowledgement that they reflected on the 6 cognitive bias prompts. Never seeded.
  const [cognitiveAck, setCognitiveAck] = useState(false)

  // Promote is enabled IFF the thesis is non-empty AND the single cognitive ack is checked. No 17-field
  // gating, no count/score — just the two human decisions this sign-off captures.
  const canPromote = signedThesis.trim().length > 0 && cognitiveAck

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
      'Audit the marshaled analysis, then make the call: affirm or amend the thesis and acknowledge the reasoning checks.',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0 0 1rem' } },
      'The thesis below is pre-filled with the harness draft. Affirm it as-is or edit it into your own words — '
      + 'either way this is the human commitment that makes admission a real decision. It must not be empty.',
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
        'Below is the harness-marshaled analysis. Audit each business finding against the thesis and research '
        + 'brief, reflect on the reasoning checks, then acknowledge before signing off.',
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
