import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { listBusinessItems, listCognitiveItems } from '@owlfolio/strategies/checklistParams'

import { WatchlistPromotionForm } from '../WatchlistPromotionForm'

// ---------------------------------------------------------------------------
// Audit-and-decide admission: the harness marshals the analysis and the human AUDITS it and makes ONE
// decision. The signed-thesis textarea is PRE-FILLED with the agent draft (affirm-or-amend). The 11
// business items render READ-ONLY (prompt + marshaled finding) — NO per-item input, NO per-item checkbox.
// The 6 cognitive items render as read-only reflection prompts gated by EXACTLY ONE acknowledgement
// checkbox. Promote is enabled IFF thesis non-empty AND the single cognitive ack is checked. NO 17-field
// gating, NO count/progress badge.
// ---------------------------------------------------------------------------

const THESIS_DRAFT = 'Adobe is a wide-moat software franchise worth admitting at the frozen buy-below.'

function businessFindings(): Record<string, string> {
  const findings: Record<string, string> = {}
  for (const item of listBusinessItems()) findings[item.id] = `Marshaled finding for ${item.id}.`
  return findings
}

function render(overrides: Partial<{ thesisDraft: string; businessFindings: Record<string, string> }> = {}) {
  return renderToStaticMarkup(
    createElement(WatchlistPromotionForm, {
      researchCaseId: 'rc_test_001',
      thesisDraft: overrides.thesisDraft ?? THESIS_DRAFT,
      businessFindings: overrides.businessFindings ?? businessFindings(),
    }),
  )
}

describe('WatchlistPromotionForm — audit-and-decide admission', () => {
  it('posts to the admit route', () => {
    const html = render()
    expect(html).toContain('action="/api/research/rc_test_001/watchlist"')
    expect(html).toContain('method="post"')
  })

  it('PRE-FILLS the signed-thesis textarea with the agent draft (affirm-or-amend)', () => {
    const html = render()
    const escaped = THESIS_DRAFT.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
    expect(html).toContain(escaped)
    // The thesis field still posts as signed_thesis.
    expect(html).toContain('name="signed_thesis"')
  })

  it('renders ALL business items READ-ONLY: prompt + marshaled finding, NO per-item input', () => {
    const findings = businessFindings()
    const html = render({ businessFindings: findings })
    for (const item of listBusinessItems()) {
      const escapedPrompt = item.prompt.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
      expect(html).toContain(escapedPrompt)
      // A stable testid carries the read-only marshaled finding.
      expect(html).toContain(`data-testid="checklist-finding-${item.id}"`)
      expect(html).toContain(findings[item.id]!)
    }
    // The OLD per-item author inputs are GONE — the human never authors a finding.
    expect(html).not.toContain('checklist_note[')
    expect(html).not.toContain('checklist_addressed[')
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

  it('disables promote initially — thesis pre-filled but the cognitive ack is unchecked', () => {
    // The ack starts false, so even with a pre-filled thesis the button is disabled until ack is checked.
    const html = render()
    expect(html).toMatch(/<button[^>]*disabled/)
    // No checkbox starts checked (the ack is a real human decision, never seeded).
    expect(html).not.toContain('checked')
  })

  it('gates promote on BOTH the thesis and the single ack — an empty draft keeps it disabled', () => {
    // With no thesis at all the button must be disabled regardless of the (still-unchecked) ack.
    const html = render({ thesisDraft: '' })
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

  it('the component SOURCE contains no count/progress patterns and no per-item author inputs', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../WatchlistPromotionForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/of 17/)
    expect(source).not.toMatch(/\/17/)
    expect(source).not.toMatch(/\bremaining\b/i)
    expect(source).not.toMatch(/\d+\s+of\s+\d+/)
    expect(source).not.toMatch(/\{[^}]*\.length[^}]*\}\s*(of|\/)/)
    // The human never authors a finding/affirmation per item in this audit-and-decide form.
    expect(source).not.toContain('checklist_note[')
    expect(source).not.toContain('checklist_addressed[')
  })
})
