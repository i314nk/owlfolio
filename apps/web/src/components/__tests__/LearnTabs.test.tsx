import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LearnTabs, LEARN_TABS, nextTabIndex } from '../LearnTabs'

function render(initialTabId?: string): string {
  const props = initialTabId === undefined ? {} : { initialTabId }
  return renderToStaticMarkup(createElement(LearnTabs, props))
}

describe('LearnTabs', () => {
  it('exposes the six harness-spec tabs in order', () => {
    expect(LEARN_TABS.map((tab) => tab.id)).toEqual([
      'strategy',
      'swarm',
      'judgment',
      'lifecycle',
      'shariah',
      'tiering',
    ])
  })

  it('renders an accessible tablist with one tab per spec area', () => {
    const html = render()
    expect(html).toContain('role="tablist"')
    const tabCount = (html.match(/role="tab"/g) ?? []).length
    expect(tabCount).toBe(LEARN_TABS.length)
    for (const tab of LEARN_TABS) {
      // Labels are HTML-escaped in the SSR string (e.g. "&" -> "&amp;").
      expect(html).toContain(tab.label.replace(/&/g, '&amp;'))
    }
  })

  it('marks every tab with aria-selected and pairs each panel to its tab', () => {
    const html = render()
    // Each tab controls a panel, each panel is labelled by its tab.
    for (const tab of LEARN_TABS) {
      expect(html).toContain(`id="learn-tab-${tab.id}"`)
      expect(html).toContain(`aria-controls="learn-panel-${tab.id}"`)
      expect(html).toContain(`aria-labelledby="learn-tab-${tab.id}"`)
    }
    const selectedCount = (html.match(/aria-selected="true"/g) ?? []).length
    expect(selectedCount).toBe(1)
  })

  it('selects the first tab by default and shows its panel', () => {
    const html = render()
    expect(html).toContain(`id="learn-tab-strategy" aria-selected="true"`)
    // Default panel is visible (not hidden); others are hidden.
    expect(html).toContain('id="learn-panel-strategy"')
    expect(html).not.toContain('id="learn-panel-strategy" aria-labelledby="learn-tab-strategy" tabindex="0" hidden=""')
    expect(html).toContain('id="learn-panel-swarm" aria-labelledby="learn-tab-swarm" tabindex="0" hidden=""')
  })

  it('honours an explicit initial tab and shows that panel instead', () => {
    const html = render('swarm')
    expect(html).toContain(`id="learn-tab-swarm" aria-selected="true"`)
    expect(html).toContain(`id="learn-tab-strategy" aria-selected="false"`)
    expect(html).not.toContain('id="learn-panel-swarm" aria-labelledby="learn-tab-swarm" tabindex="0" hidden=""')
    expect(html).toContain('id="learn-panel-strategy" aria-labelledby="learn-tab-strategy" tabindex="0" hidden=""')
  })

  it('cycles the active index with arrow-key direction (keyboard nav helper)', () => {
    const last = LEARN_TABS.length - 1
    expect(nextTabIndex(0, 'ArrowRight', LEARN_TABS.length)).toBe(1)
    expect(nextTabIndex(0, 'ArrowLeft', LEARN_TABS.length)).toBe(last) // wraps
    expect(nextTabIndex(last, 'ArrowRight', LEARN_TABS.length)).toBe(0) // wraps
    expect(nextTabIndex(2, 'Home', LEARN_TABS.length)).toBe(0)
    expect(nextTabIndex(2, 'End', LEARN_TABS.length)).toBe(last)
    expect(nextTabIndex(2, 'a', LEARN_TABS.length)).toBe(2) // ignored key
  })

  it('renders the live two-stage DCF params on the strategy panel', () => {
    const html = render('strategy')
    // F.13 — UNIFORM base MoS 25% for every investable moat + 18x cap + flat 10% discount (live valuationParams)
    expect(html).toContain('25%')
    expect(html).toContain('18×')
    expect(html).toContain('10%')
    // The monopoly tier no longer loosens valuation — it is described as a durability signal.
    expect(html.toLowerCase()).toContain('durability')
    expect(html.toLowerCase()).toContain('uniform')
  })

  it('states the grounding invariant on the swarm panel', () => {
    const html = render('swarm')
    expect(html).toContain('content-hashed')
    expect(html.toLowerCase()).toContain('the harness computes')
  })

  it('keeps the honest Shariah boundary (a screening aid, not a fatwa)', () => {
    const html = render('shariah')
    expect(html.toLowerCase()).toContain('not a')
    expect(html.toLowerCase()).toContain('fatwa')
  })

  it('describes the four model tiers including the compute-everything T0 rule', () => {
    const html = render('tiering')
    expect(html).toContain('T1')
    expect(html).toContain('T0')
    expect(html.toLowerCase()).toContain('if it can be computed, compute it')
  })
})
