import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

import { HoldingReviewChecklistConfirm } from '../HoldingReviewChecklistConfirm'

// ---------------------------------------------------------------------------
// Phase 7 S3 — the re-underwrite sign-off form renders BOTH hygiene checklists (business + cognitive) as
// required, NON-PREFILLED inputs, with NO count/progress badge. The disabled submit + per-item "needs
// attention" markers are the ONLY completeness signal; a count would be a score in disguise. This is the
// re-underwrite TWIN of WatchlistPromotionForm and the UI face of the integrity fix (a confirmation that
// previously confirmed nothing now requires the checklist to be addressed).
// ---------------------------------------------------------------------------

function render() {
  return renderToStaticMarkup(
    createElement(HoldingReviewChecklistConfirm, { holdingId: 'holding_cost_001', reviewId: 'review_001' }),
  )
}

describe('HoldingReviewChecklistConfirm — Phase 7 re-underwrite sign-off checklist', () => {
  it('posts to the re-underwrite confirm route', () => {
    const html = render()
    expect(html).toContain('action="/api/portfolio/holding_cost_001/review/review_001/confirm"')
    expect(html).toContain('method="post"')
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

  it('forces shariah_drift (item 10) and data_completeness (item 11) at the re-underwrite host', () => {
    const html = render()
    // These two items are the post-admission deterioration catches re-underwrite uniquely enforces.
    expect(html).toContain('checklist_note[shariah_drift]')
    expect(html).toContain('checklist_note[data_completeness]')
  })

  it('starts every checklist answer EMPTY — no seeding (especially the cognitive items)', () => {
    const html = render()
    for (const item of CHECKLIST_PARAMS.items) {
      expect(html).toContain(`checklist_note[${item.id}]`)
    }
    expect(html).not.toMatch(/name="checklist_note\[[^"]+\]"[^>]*>[^<]/)
    expect(html).not.toContain('checked')
  })

  it('disables submit initially (nothing addressed) — the completion-block surfaced in the UI', () => {
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
      fileURLToPath(new URL('../HoldingReviewChecklistConfirm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\/17/)
    expect(source).not.toMatch(/\bremaining\b/i)
    expect(source).not.toMatch(/\d+\s+of\s+\d+/)
    expect(source).not.toMatch(/\{[^}]*\.length[^}]*\}\s*(of|\/)/)
  })
})
