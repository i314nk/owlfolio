import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { listBusinessItems, listCognitiveItems } from '@owlfolio/strategies/checklistParams'

import { HoldingReviewChecklistConfirm } from '../HoldingReviewChecklistConfirm'
import { HoldingReviewOverrideForm } from '../HoldingReviewOverrideForm'

// ---------------------------------------------------------------------------
// The harness-marshaled FINDINGS read-layer renders beside each BUSINESS item in the two re-underwrite forms
// (audit-and-decide). Both re-underwrite forms have now migrated off the old per-item evidence/answer
// contract to the same findings + single-cognitive-ack surface the admission form uses: one read-only
// `checklist-finding-${id}` per business item, NO per-item input, cognitive items render NO finding, and the
// only completeness signal is the disabled submit gated on the single cognitive ack — never a count badge.
//
// The ADMISSION form (WatchlistPromotionForm) has its own contract covered by WatchlistPromotionForm.test.tsx.
// ---------------------------------------------------------------------------

function businessFindings(): Record<string, string> {
  const findings: Record<string, string> = {}
  for (const item of listBusinessItems()) findings[item.id] = `Marshaled finding for ${item.id}.`
  return findings
}

const renderers: Array<{ name: string; render: (findings: Record<string, string>) => string }> = [
  {
    name: 'HoldingReviewChecklistConfirm (re-underwrite confirm)',
    render: (findings) => renderToStaticMarkup(createElement(HoldingReviewChecklistConfirm, {
      holdingId: 'h_1',
      reviewId: 'rev_1',
      businessFindings: findings,
    })),
  },
  {
    name: 'HoldingReviewOverrideForm (re-underwrite override)',
    render: (findings) => renderToStaticMarkup(createElement(HoldingReviewOverrideForm, {
      holdingId: 'h_1',
      reviewId: 'rev_1',
      defaultThesisHealth: 'WATCH',
      defaultActionStance: 'HOLD',
      defaultNextReviewAt: '2026-01-01',
      businessFindings: findings,
    })),
  },
]

for (const { name, render } of renderers) {
  describe(`${name} — marshaled findings (audit-and-decide)`, () => {
    it('renders the marshaled finding beside every business item, read-only', () => {
      const findings = businessFindings()
      const html = render(findings)
      for (const item of listBusinessItems()) {
        expect(html).toContain(`checklist-finding-${item.id}`)
        expect(html).toContain(findings[item.id]!)
      }
      expect(html).toContain('Marshaled finding:')
    })

    it('renders NO finding line for cognitive items (human-only reflection)', () => {
      const html = render(businessFindings())
      for (const item of listCognitiveItems()) {
        expect(html).not.toContain(`checklist-finding-${item.id}`)
      }
    })

    it('keeps the invariants: no per-item author input, disabled submit, NO count badge', () => {
      const html = render(businessFindings())
      // Submit stays disabled until the single cognitive ack is checked.
      expect(html).toMatch(/<button[^>]*disabled/)
      // The human never authors a per-item finding/affirmation.
      expect(html).not.toContain('checklist_note[')
      expect(html).not.toContain('checklist_addressed[')
      // No count/progress readout — a count is a score in disguise.
      expect(html).not.toMatch(/\d+\s+of\s+\d+/)
      expect(html).not.toMatch(/\d+\s*\/\s*\d+/)
      expect(html).not.toMatch(/\bremaining\b/i)
    })

    it('renders EXACTLY ONE checkbox — the single cognitive acknowledgement', () => {
      const html = render(businessFindings())
      const checkboxes = html.match(/type="checkbox"/g) ?? []
      expect(checkboxes).toHaveLength(1)
      expect(html).toContain('name="cognitive_reflection_acknowledged"')
    })
  })
}
