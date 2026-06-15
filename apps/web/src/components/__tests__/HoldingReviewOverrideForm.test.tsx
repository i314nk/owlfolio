import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

import { HoldingReviewOverrideForm } from '../HoldingReviewOverrideForm'

// ---------------------------------------------------------------------------
// Phase 7 S3 (bypass close) — the OVERRIDE re-underwrite sign-off form is the co-equal twin of
// HoldingReviewChecklistConfirm: it writes the SAME confirmed thesis state, so it renders the SAME two
// hygiene checklists (business + cognitive) as required, NON-PREFILLED inputs, with NO count/progress badge.
// The disabled submit + per-item "needs attention" markers are the ONLY completeness signal; a count would
// be a score in disguise. Gating only confirm and not override would reopen the gap S3 closed.
// ---------------------------------------------------------------------------

function render() {
  return renderToStaticMarkup(
    createElement(HoldingReviewOverrideForm, {
      holdingId: 'holding_cost_001',
      reviewId: 'review_001',
      defaultThesisHealth: 'WATCH',
      defaultActionStance: 'RESEARCH_MORE',
      defaultNextReviewAt: '2026-10-31',
    }),
  )
}

describe('HoldingReviewOverrideForm — Phase 7 re-underwrite override sign-off checklist', () => {
  it('posts to the re-underwrite override route', () => {
    const html = render()
    expect(html).toContain('action="/api/portfolio/holding_cost_001/review/review_001/override"')
    expect(html).toContain('method="post"')
  })

  it('renders the four required override thesis fields', () => {
    const html = render()
    expect(html).toContain('name="thesis_health"')
    expect(html).toContain('name="action_stance"')
    expect(html).toContain('name="rationale"')
    expect(html).toContain('name="evidence_summary"')
    expect(html).toContain('name="uncertainty"')
    expect(html).toContain('name="next_review_at"')
  })

  it('renders every checklist item prompt, grouped into the two checklists', () => {
    const html = render()
    for (const item of CHECKLIST_PARAMS.items) {
      const escapedPrompt = item.prompt.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
      expect(html).toContain(escapedPrompt)
    }
    expect(html).toContain('Business failure modes')
    expect(html).toContain('Cognitive biases')
  })

  it('forces shariah_drift (item 10) and data_completeness (item 11) on the override path too', () => {
    const html = render()
    expect(html).toContain('checklist_note[shariah_drift]')
    expect(html).toContain('checklist_note[data_completeness]')
  })

  it('starts every checklist answer EMPTY and the required thesis text fields EMPTY — no seeding', () => {
    const html = render()
    for (const item of CHECKLIST_PARAMS.items) {
      expect(html).toContain(`checklist_note[${item.id}]`)
    }
    // No checklist note textarea (or required thesis textarea) is pre-filled with content.
    expect(html).not.toMatch(/<textarea[^>]*>[^<]/)
    expect(html).not.toContain('checked')
  })

  it('disables submit initially (thesis fields + checklist not addressed)', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it('renders NO count/progress badge — a count is a score in disguise (decision-neutral)', () => {
    const html = render()
    expect(html).not.toMatch(/\bof 17\b/)
    expect(html).not.toMatch(/\d+\s*\/\s*17/)
    expect(html).not.toMatch(/\bremaining\b/i)
    expect(html).not.toMatch(/\d+\s+of\s+\d+/)
    expect(html).not.toMatch(/\d+\s*\/\s*\d+\s+addressed/i)
  })

  it('the component SOURCE contains no count/progress patterns (a count is a score in disguise)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../HoldingReviewOverrideForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\/17/)
    expect(source).not.toMatch(/\bremaining\b/i)
    expect(source).not.toMatch(/\d+\s+of\s+\d+/)
    expect(source).not.toMatch(/\{[^}]*\.length[^}]*\}\s*(of|\/)/)
  })
})
