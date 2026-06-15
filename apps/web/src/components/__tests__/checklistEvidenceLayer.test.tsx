import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

import { WatchlistPromotionForm } from '../WatchlistPromotionForm'
import { HoldingReviewChecklistConfirm } from '../HoldingReviewChecklistConfirm'
import { HoldingReviewOverrideForm } from '../HoldingReviewOverrideForm'

// ---------------------------------------------------------------------------
// Phase 7 S4 — the EVIDENCE READ-LAYER renders beside each groundable BUSINESS item in BOTH the admission
// form and the two re-underwrite forms. The evidence is a read-only marshaled value (passed in by the
// caller as a pure read of the projection). Cognitive items render NO evidence. The S2/S3 invariants are
// unchanged: non-prefilled inputs, completion-blocked submit, NO count badge.
// ---------------------------------------------------------------------------

// One marshaled value per groundable business item id (the caller resolves these from the projection).
const evidence: Record<string, string> = {
  overpaying_for_quality: '0.08',
  moat_erosion: 'monopoly',
  terminal_value_optimism: '0.62',
  cyclical_peak: 'medium',
  quality_of_earnings: '{"reported_net_income_per_share":5}',
  concentration_correlation: 'sic:73',
  shariah_drift: 'COMPLIANT',
  data_completeness: '4',
}

const businessWithReads = CHECKLIST_PARAMS.items.filter((i) => i.category === 'business' && i.reads !== undefined)
const cognitiveItems = CHECKLIST_PARAMS.items.filter((i) => i.category === 'cognitive')

const renderers: Array<{ name: string; render: (ev?: Record<string, string>) => string }> = [
  {
    name: 'WatchlistPromotionForm (admission)',
    render: (ev) => renderToStaticMarkup(createElement(WatchlistPromotionForm, { researchCaseId: 'rc_1', ...(ev ? { evidence: ev } : {}) })),
  },
  {
    name: 'HoldingReviewChecklistConfirm (re-underwrite confirm)',
    render: (ev) => renderToStaticMarkup(createElement(HoldingReviewChecklistConfirm, { holdingId: 'h_1', reviewId: 'rev_1', ...(ev ? { evidence: ev } : {}) })),
  },
  {
    name: 'HoldingReviewOverrideForm (re-underwrite override)',
    render: (ev) => renderToStaticMarkup(createElement(HoldingReviewOverrideForm, { holdingId: 'h_1', reviewId: 'rev_1', defaultThesisHealth: 'WATCH', defaultActionStance: 'HOLD', defaultNextReviewAt: '2026-01-01', ...(ev ? { evidence: ev } : {}) })),
  },
]

for (const { name, render } of renderers) {
  describe(`${name} — S4 marshaled evidence`, () => {
    it('renders the marshaled evidence value beside every groundable business item', () => {
      const html = render(evidence)
      for (const item of businessWithReads) {
        expect(html).toContain(`checklist-evidence-${item.id}`)
        expect(html).toContain('Marshaled evidence:')
      }
    })

    it('renders NO evidence line for cognitive items (human-only)', () => {
      const html = render(evidence)
      for (const item of cognitiveItems) {
        expect(html).not.toContain(`checklist-evidence-${item.id}`)
      }
    })

    it('renders NO evidence at all when none is passed (graceful, additive)', () => {
      const html = render(undefined)
      expect(html).not.toContain('Marshaled evidence:')
    })

    it('keeps the S2/S3 invariants: non-prefilled inputs, disabled submit, NO count badge', () => {
      const html = render(evidence)
      // Submit stays disabled until the human addresses everything.
      expect(html).toMatch(/<button[^>]*disabled/)
      // No checklist note is prefilled and no checkbox starts checked.
      expect(html).not.toMatch(/name="checklist_note\[[^"]+\]"[^>]*>[^<]/)
      expect(html).not.toContain('checked')
      // No count/progress readout — a count is a score in disguise.
      expect(html).not.toMatch(/\d+\s+of\s+\d+/)
      expect(html).not.toMatch(/\d+\s*\/\s*\d+/)
      expect(html).not.toMatch(/\bremaining\b/i)
    })

    it('does NOT seed any checklist answer from the evidence (evidence is read-only, not a pre-fill)', () => {
      const html = render(evidence)
      // The evidence appears only in the read-only marshaled line, never inside a textarea note value.
      expect(html).not.toMatch(/name="checklist_note\[[^"]+\]"[^>]*>Marshaled/)
      // No note textarea carries the evidence value as its content.
      expect(html).not.toMatch(/<textarea[^>]*name="checklist_note\[[^"]+\]"[^>]*>sic:73/)
    })
  })
}
