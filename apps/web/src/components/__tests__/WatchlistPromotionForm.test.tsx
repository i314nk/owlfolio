import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'

import { WatchlistPromotionForm } from '../WatchlistPromotionForm'

// ---------------------------------------------------------------------------
// Phase 7 S2 — the admit form renders BOTH hygiene checklists (business + cognitive) as required,
// NON-PREFILLED inputs, with NO count/progress badge. The disabled submit + per-item "needs attention"
// markers are the ONLY completeness signal; a count would be a score in disguise.
// ---------------------------------------------------------------------------

function render() {
  return renderToStaticMarkup(createElement(WatchlistPromotionForm, { researchCaseId: 'rc_test_001' }))
}

describe('WatchlistPromotionForm — Phase 7 hygiene checklists', () => {
  it('renders every checklist item prompt, grouped into the two checklists', () => {
    const html = render()
    for (const item of CHECKLIST_PARAMS.items) {
      // The exact prompt text is shown for each item (escaped apostrophes in the static markup).
      const escapedPrompt = item.prompt.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
      expect(html).toContain(escapedPrompt)
    }
    // The two category groupings are labeled.
    expect(html).toContain('Business failure modes')
    expect(html).toContain('Cognitive biases')
  })

  it('starts every checklist answer EMPTY — no seeding (especially the cognitive items)', () => {
    const html = render()
    // Each item has a note input keyed by checklist_note[<id>]; none carry a prefilled value.
    for (const item of CHECKLIST_PARAMS.items) {
      expect(html).toContain(`checklist_note[${item.id}]`)
    }
    // No textarea/input in the rendered markup carries any non-empty value attribute for a checklist note
    // (a seeded cognitive answer would be a leak). The signed thesis also starts empty.
    expect(html).not.toMatch(/name="checklist_note\[[^"]+\]"[^>]*>[^<]/)
    // No checkbox starts checked.
    expect(html).not.toContain('checked')
  })

  it('disables submit initially (nothing addressed) — the completion-block surfaced in the UI', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it('renders NO count/progress badge — a count is a score in disguise (decision-neutral)', () => {
    const html = render()
    // None of the forbidden count/progress patterns may appear.
    expect(html).not.toMatch(/\bof 17\b/)
    expect(html).not.toMatch(/\d+\s*\/\s*17/)
    expect(html).not.toMatch(/\bremaining\b/i)
    expect(html).not.toMatch(/\d+\s+of\s+\d+/)
    expect(html).not.toMatch(/\d+\s*\/\s*\d+\s+addressed/i)
  })

  it('the component SOURCE contains no count/progress patterns (a count is a score in disguise)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../WatchlistPromotionForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\/17/)
    expect(source).not.toMatch(/\bremaining\b/i)
    expect(source).not.toMatch(/\d+\s+of\s+\d+/)
    expect(source).not.toMatch(/\{[^}]*\.length[^}]*\}\s*(of|\/)/)
  })
})
