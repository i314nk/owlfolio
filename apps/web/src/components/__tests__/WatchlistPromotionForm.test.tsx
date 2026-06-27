import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WatchlistPromotionForm } from '../WatchlistPromotionForm'

// ---------------------------------------------------------------------------
// Review-and-promote: the dossier above is the analysis; the control is a single explicit
// "Promote to watchlist" button. NO signed-thesis textarea, NO read-only checklist fieldsets, NO
// cognitive-reflection checkbox. The button is always enabled — the human's click IS the commitment.
// ---------------------------------------------------------------------------

function render() {
  return renderToStaticMarkup(
    createElement(WatchlistPromotionForm, { researchCaseId: 'rc_test_001' }),
  )
}

describe('WatchlistPromotionForm — review-and-promote', () => {
  it('posts to the watchlist route', () => {
    const html = render()
    expect(html).toContain('action="/api/research/rc_test_001/watchlist"')
    expect(html).toContain('method="post"')
  })

  it('renders a single Promote to watchlist button that is always enabled', () => {
    const html = render()
    expect(html).toContain('Promote to watchlist')
    expect(html).toMatch(/<button[^>]*type="submit"/)
    // The button is never disabled — there is no gating.
    expect(html).not.toMatch(/<button[^>]*disabled/)
  })

  it('renders NO thesis textarea, NO checklist fieldsets, and NO cognitive checkbox', () => {
    const html = render()
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('name="signed_thesis"')
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('name="cognitive_reflection_acknowledged"')
    expect(html).not.toContain('Business failure modes')
    expect(html).not.toContain('Cognitive biases')
    // No per-item author inputs of any kind.
    expect(html).not.toContain('checklist_note[')
    expect(html).not.toContain('checklist_addressed[')
  })

  it('renders NO count/progress badge — decision-neutral', () => {
    const html = render()
    expect(html).not.toMatch(/\bof 17\b/)
    expect(html).not.toMatch(/\d+\s*\/\s*17/)
    expect(html).not.toMatch(/\bremaining\b/i)
    expect(html).not.toMatch(/\d+\s+of\s+\d+/)
  })

  it('the component SOURCE contains no checklist imports or per-item author inputs', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../WatchlistPromotionForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toContain('listBusinessItems')
    expect(source).not.toContain('listCognitiveItems')
    expect(source).not.toContain('checklist_note[')
    expect(source).not.toContain('checklist_addressed[')
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\bremaining\b/i)
  })
})
