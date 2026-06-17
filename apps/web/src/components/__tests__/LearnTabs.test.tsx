import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LearnTabs, LEARN_TABS, nextTabIndex } from '../LearnTabs'
import {
  AAOIFI_DEBT_RATIO_MAX,
  AAOIFI_CASH_SECURITIES_RATIO_MAX,
  AAOIFI_IMPERMISSIBLE_INCOME_MAX,
} from '@owlfolio/strategies/shariahFinancialRatios'

// Mirror LearnTabs' local pct() helper so the assertions pin the DERIVED value, not a
// hardcoded "30%"/"5%". This fails if EITHER a constant changes without the render updating
// OR the render drifts away from the constant.
function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits).replace(/\.0+$/, '')}%`
}

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

  it('renders the live two-stage DCF params + the R1 model-proposes-buy-below reframe on the strategy panel', () => {
    const html = render('strategy')
    const lower = html.toLowerCase()
    // Live params still render: 18× cap + flat 10% discount.
    expect(html).toContain('18×')
    expect(html).toContain('10%')
    // R1 reframe: the model proposes the verdict/valuation/buy-below with cited reasoning; the two-stage
    // DCF is a cross-check sanity reference, not the decision; a sanity-check flags absurdity, human decides.
    expect(lower).toContain('the model proposes')
    expect(lower).toContain('cited reasoning')
    expect(lower).toContain('buy-below')
    expect(lower).toContain('cross-check')
    expect(lower).toContain('sanity-check')
    // The monopoly tier no longer loosens valuation — it is described as a durability signal.
    expect(lower).toContain('durability')
    expect(lower).toContain('uniform')
    // The retired band/gap framing must NOT be reintroduced (Phase-8 tripwire — retired band/MoS terms).
    expect(lower).not.toContain('required growth gap')
    expect(lower).not.toContain('sustainable-growth band')
    expect(lower).not.toContain('sustainable band')
    expect(html).not.toContain('band_low')
    expect(html).not.toContain('growth-points')
  })

  it('describes admission discipline on the strategy panel without overclaiming', () => {
    const html = render('strategy').toLowerCase()
    expect(html).toContain('discovery is the admission operation')
    // Circle = human-set config the harness CHECKS, never agent-inferred (sector via EDGAR SIC), permissive default.
    expect(html).toContain('circle of competence')
    expect(html).toContain('checks')
    expect(html).toContain('never agent-inferred')
    expect(html).toContain('edgar sic')
    expect(html).toContain('permissive by default')
    // Size = deferred Pabrai Principle 5 axis.
    expect(html).toContain('pabrai principle 5')
    expect(html).toContain('deferred')
    // Cheapness only on an already-wonderful business; uncertainty vs permanent-loss + bear case.
    expect(html).toContain('already-wonderful')
    expect(html).toContain('permanent-loss risk')
    expect(html).toContain('bear case')
    // Admit human-decided: signed thesis (not pre-filled) + provisional-MoS buy-below.
    expect(html).toContain('signed thesis')
    expect(html).toContain('never pre-filled')
    expect(html).toContain('provisional')
    // NO OVERCLAIM: no admit-recommendation panel yet.
    expect(html).toContain('no admit-recommendation panel yet')
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

  it('live-renders the AAOIFI financial-ratio thresholds from the exported constants (no hardcode drift)', () => {
    const html = render('shariah')
    // DERIVED strings — must track the constants, not a hardcoded copy. (Currently 30% / 30% / 5%.)
    expect(html).toContain(pct(AAOIFI_DEBT_RATIO_MAX)) // debt ratio
    expect(html).toContain(pct(AAOIFI_CASH_SECURITIES_RATIO_MAX)) // cash ratio
    expect(html).toContain(pct(AAOIFI_IMPERMISSIBLE_INCOME_MAX)) // impermissible income
    // User-visible text is unchanged by this drift-proofing refactor.
    expect(pct(AAOIFI_DEBT_RATIO_MAX)).toBe('30%')
    expect(pct(AAOIFI_CASH_SECURITIES_RATIO_MAX)).toBe('30%')
    expect(pct(AAOIFI_IMPERMISSIBLE_INCOME_MAX)).toBe('5%')
  })

  it('describes the unified lifecycle and the single state-branched cadence engine on the lifecycle panel', () => {
    const html = render('lifecycle')
    // One list, one lifecycle: candidate → watched → held → exited.
    expect(html.toUpperCase()).toContain('CANDIDATE')
    expect(html.toUpperCase()).toContain('WATCHED')
    expect(html.toUpperCase()).toContain('HELD')
    expect(html.toUpperCase()).toContain('EXITED')
    // ONE cadence engine; detection state-independent; action branches on state.
    expect(html.toLowerCase()).toContain('one cadence engine')
    expect(html.toLowerCase()).toContain('does not depend on which state')
    // Stale "separate watchlist and holdings monitors" framing is replaced.
    expect(html.toLowerCase()).toContain('not separate watchlist and holdings monitors')
    // Honesty: deteriorating watched name, no prune action yet; exits are sold vs screened out.
    expect(html.toLowerCase()).toContain('deteriorating')
    expect(html.toLowerCase()).toContain('no prune action yet')
    expect(html.toLowerCase()).toContain('screened out')
  })

  it('describes the four model tiers including the compute-everything T0 rule', () => {
    const html = render('tiering')
    expect(html).toContain('T1')
    expect(html).toContain('T0')
    expect(html.toLowerCase()).toContain('if it can be computed, compute it')
  })
})
