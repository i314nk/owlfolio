import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/strategy',
}))

import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'
import { LearnTabs } from '../LearnTabs'
import { StrategyOverview } from '../StrategyOverview'

// HTML-escape a prompt the way React's SSR serializer does, so substring checks against the rendered
// markup line up with prompts that contain apostrophes / ampersands.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function renderLearn(): string {
  // The Judgment Objectivity tab hosts the hygiene copy; render that tab active so its panel is non-null.
  return renderToStaticMarkup(createElement(LearnTabs, { initialTabId: 'judgment' }))
}

function renderStrategy(): string {
  return renderToStaticMarkup(createElement(StrategyOverview))
}

const businessItems = CHECKLIST_PARAMS.items.filter((item) => item.category === 'business')
const cognitiveItems = CHECKLIST_PARAMS.items.filter((item) => item.category === 'cognitive')

describe('/learn Quality & bias hygiene copy', () => {
  const html = renderLearn()

  it('renders a Quality & bias hygiene section that names BOTH checklists', () => {
    expect(html).toContain('hygiene')
    // The two checklists by their categories.
    expect(html.toLowerCase()).toContain('business')
    expect(html.toLowerCase()).toContain('cognitive')
  })

  it('renders EVERY business AND cognitive prompt from CHECKLIST_PARAMS (rendered from data, not hardcoded)', () => {
    for (const item of [...businessItems, ...cognitiveItems]) {
      expect(html, `prompt for ${item.id} must be rendered from CHECKLIST_PARAMS`).toContain(
        escapeHtml(item.prompt),
      )
    }
  })

  it('makes no overclaim: states it forces the question and does NOT score / pass-fail / auto-reject', () => {
    const lower = html.toLowerCase()
    // It must SAY it is not a gate/score (forces the question, never scores).
    expect(lower).toMatch(/forces the question|never scores|not a (score|gate)|no pass\/fail|never auto-reject/)
    // Business = agent-marshaled evidence + human affirms; cognitive = human-only (agent never pre-fills).
    expect(lower).toContain('human')
    expect(lower).toMatch(/marshal|evidence/)
    // Completion-block on admission + re-underwrite sign-off.
    expect(lower).toMatch(/completion-block|completion block/)
    expect(lower).toMatch(/admission|admit/)
    expect(lower).toMatch(/re-underwrite|re-underwrite sign-off|review/)
  })

  it('renders NO "{n} of {m} addressed" progress/score readout (copy lists items, never counts them)', () => {
    expect(html).not.toMatch(/\bof\s+17\b/i)
    expect(html).not.toMatch(/\b\d+\s+of\s+\d+\s+addressed\b/i)
    expect(html).not.toMatch(/\baddressed\b.*\bremaining\b/i)
  })
})

describe('/strategy hygiene line', () => {
  const html = renderStrategy()

  it('mentions the two hygiene checklists as a completion-block, decision-neutral', () => {
    const lower = html.toLowerCase()
    expect(lower).toMatch(/hygiene|bias check/)
    expect(lower).toMatch(/business/)
    expect(lower).toMatch(/cognitive/)
    expect(lower).toMatch(/completion-block|completion block/)
    // No overclaim: forces the question / does not score.
    expect(lower).toMatch(/forces the question|never scores|not a (score|gate)|never auto-reject/)
  })
})
