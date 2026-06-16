import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { listBusinessItems, listCognitiveItems } from '@owlfolio/strategies/checklistParams'

import { HoldingReviewChecklistConfirm } from '../HoldingReviewChecklistConfirm'

// ---------------------------------------------------------------------------
// Audit-and-decide re-underwrite CONFIRM (AFFIRM): the harness marshals the analysis and the human AUDITS it
// and makes ONE decision. Confirm APPLIES the provider draft, so there is NO human-authored thesis here. The
// 11 business items render READ-ONLY (prompt + marshaled finding) — NO per-item input, NO per-item checkbox.
// The 6 cognitive items render as read-only reflection prompts gated by EXACTLY ONE acknowledgement
// checkbox. Confirm is enabled IFF the single cognitive ack is checked. NO 17-field gating, NO count badge.
// ---------------------------------------------------------------------------

function businessFindings(): Record<string, string> {
  const findings: Record<string, string> = {}
  for (const item of listBusinessItems()) findings[item.id] = `Marshaled finding for ${item.id}.`
  return findings
}

function render(overrides: Partial<{ businessFindings: Record<string, string> }> = {}) {
  return renderToStaticMarkup(
    createElement(HoldingReviewChecklistConfirm, {
      holdingId: 'holding_cost_001',
      reviewId: 'review_001',
      businessFindings: overrides.businessFindings ?? businessFindings(),
    }),
  )
}

describe('HoldingReviewChecklistConfirm — audit-and-decide re-underwrite confirm', () => {
  it('posts to the re-underwrite confirm route', () => {
    const html = render()
    expect(html).toContain('action="/api/portfolio/holding_cost_001/review/review_001/confirm"')
    expect(html).toContain('method="post"')
  })

  it('renders ALL business items READ-ONLY: prompt + marshaled finding, NO per-item input', () => {
    const findings = businessFindings()
    const html = render({ businessFindings: findings })
    for (const item of listBusinessItems()) {
      const escapedPrompt = item.prompt.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
      expect(html).toContain(escapedPrompt)
      expect(html).toContain(`data-testid="checklist-finding-${item.id}"`)
      expect(html).toContain(findings[item.id]!)
    }
    expect(html).toContain('Business failure modes')
    expect(html).toContain('Cognitive biases')
    // The OLD per-item author inputs are GONE — the human never authors a finding.
    expect(html).not.toContain('checklist_note[')
    expect(html).not.toContain('checklist_addressed[')
  })

  it('still surfaces shariah_drift and data_completeness findings at the re-underwrite host', () => {
    const html = render()
    // These post-admission deterioration catches read as marshaled findings the human audits.
    expect(html).toContain('data-testid="checklist-finding-shariah_drift"')
    expect(html).toContain('data-testid="checklist-finding-data_completeness"')
  })

  it('renders the cognitive items as read-only reflection prompts (no per-item input)', () => {
    const html = render()
    for (const item of listCognitiveItems()) {
      const escapedPrompt = item.prompt.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
      expect(html).toContain(escapedPrompt)
    }
  })

  it('renders EXACTLY ONE checkbox — the single cognitive acknowledgement', () => {
    const html = render()
    const checkboxes = html.match(/type="checkbox"/g) ?? []
    expect(checkboxes).toHaveLength(1)
    expect(html).toContain('name="cognitive_reflection_acknowledged"')
  })

  it('disables confirm initially — the cognitive ack is unchecked (no thesis to author on confirm)', () => {
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled/)
    // No checkbox starts checked (the ack is a real human decision, never seeded).
    expect(html).not.toContain('checked')
  })

  it('renders NO count/progress badge — a count is a score in disguise (decision-neutral)', () => {
    const html = render()
    expect(html).not.toMatch(/\bof 17\b/)
    expect(html).not.toMatch(/\d+\s*\/\s*17/)
    expect(html).not.toMatch(/\bremaining\b/i)
    expect(html).not.toMatch(/\d+\s+of\s+\d+/)
    expect(html).not.toMatch(/\d+\s*\/\s*\d+\s+addressed/i)
  })

  it('the component SOURCE contains no count/progress patterns and no per-item author inputs', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../HoldingReviewChecklistConfirm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\/17/)
    expect(source).not.toMatch(/\bremaining\b/i)
    expect(source).not.toMatch(/\d+\s+of\s+\d+/)
    expect(source).not.toMatch(/\{[^}]*\.length[^}]*\}\s*(of|\/)/)
    expect(source).not.toContain('checklist_note[')
    expect(source).not.toContain('checklist_addressed[')
  })
})
