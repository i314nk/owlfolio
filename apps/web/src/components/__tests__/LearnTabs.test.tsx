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
  it('exposes the harness-spec tabs in order, including the sources and CLI tabs', () => {
    expect(LEARN_TABS.map((tab) => tab.id)).toEqual([
      'strategy',
      'swarm',
      'sources',
      'judgment',
      'lifecycle',
      'shariah',
      'tiering',
      'cli',
    ])
  })

  it('documents the grounded document set: annual by Item, interim narrative, proxy, and the text/numbers boundary', () => {
    const html = render('sources')
    // The document set
    expect(html).toContain('10-K')
    expect(html).toContain('20-F')
    expect(html).toContain('8-K')
    expect(html).toContain('10-Q')
    expect(html).toContain('6-K')
    expect(html).toContain('DEF 14A')
    // Readable by Item + the governing principle
    expect(html).toContain('read_source')
    expect(html).toContain('Ground the text; quarantine the numbers')
  })

  it('documents the grounding pipeline: propose/verify split, SHA-256 + source ledger, lane whitelist, fail-closed reads', () => {
    const html = render('sources')
    expect(html).toContain('SHA-256')
    expect(html).toContain('source ledger')
    expect(html).toContain('SSRF')
    // The one-line invariant
    expect(html).toContain('may propose')
    expect(html).toContain('harness')
    // Cross-run auditability via immutable URLs
    expect(html).toContain('immutable')
    expect(html).toContain('re-fetch')
  })

  it('documents the circle-gate hardening: k-sample unanimous agreement + grounded evidence floors, settings-tunable', () => {
    const html = render('judgment')
    expect(html).toContain('unanimous')
    expect(html).toContain('evidence floor')
    expect(html).toContain('Settings')
  })

  it('documents model selection: reasoning-only picker + curated recommendations by tier', () => {
    const html = render('tiering')
    expect(html).toContain('reasoning models the harness can actually drive')
    expect(html).toContain('Recommended for the job')
    // A curated T1 recommendation is rendered live from the catalog.
    expect(html).toContain('anthropic/claude-opus-4.8')
    // Tier headings present.
    expect(html).toContain('T1 — Frontier')
    expect(html).toContain('T3 — Cheap / high-volume')
  })

  it('documents the CLI: the short owlfolio command, the commands, and its dry-run boundary', () => {
    const html = render('cli')
    // The short, hermes-style entrypoint is the headline form.
    expect(html).toContain('owlfolio ')
    expect(html).toContain('owlfolio doctor')
    // The zero-setup pnpm alternative and the PATH setup are documented too.
    expect(html).toContain('corepack pnpm owlfolio')
    expect(html).toContain('OWLFOLIO_PROJECT_DIR')
    // The CLI never authors irreversible transitions.
    expect(html).toContain('never executes an investment action')
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

  it('E2c: renders the live BOOK-model params (FCF, comps-anchored exit, 15% required return, 30/50 margins)', () => {
    const html = render('strategy')
    const lower = html.toLowerCase()
    // Owner rule (2026-07-12): the fixed exit band is retired — the exit multiple is anchored to
    // the model's own NAMED comparables (median, tilted conservative); no band renders.
    expect(html).not.toContain('8–20×')
    expect(html.toLowerCase()).toContain('named comparables')
    expect(html).toContain('15%')
    expect(html).toContain('30%')
    expect(html).toContain('50%')
    // The book reframe: the harness computes the intrinsic value; the model's two cited judgments.
    expect(lower).toContain('cfo − capex')
    expect(lower).toContain('exit multiple')
    expect(lower).toContain('margin of safety')
    expect(lower).not.toContain('market-implied growth') // F: the implied lens is retired
    // FCF is honest fail-closed (no proxy).
    expect(lower).toContain('fail-closed')
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
    // No roadmap language: deferred/later-phase promises are gone (owner, 2026-07-18).
    expect(html).not.toContain('deferred')
    // Cheapness only on an already-wonderful business; uncertainty vs permanent-loss + bear case.
    expect(html).toContain('already-wonderful')
    expect(html).toContain('permanent-loss risk')
    expect(html).toContain('bear case')
    // Admit human-decided: signed thesis (not pre-filled) + computed buy-below.
    expect(html).toContain('signed thesis')
    expect(html).toContain('never pre-filled')
    expect(html).toContain('computed')
    // No roadmap language — the honest-scope caveat states what IS, without deferred promises.
    expect(html).toContain('admit is human-decided')
    expect(html).not.toContain('admit-recommendation panel')
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
    // Honesty: deteriorating watched name flagged; the human-authored prune (Remove from watchlist)
    // SHIPPED — the copy names it instead of the stale "no prune action yet" gap.
    expect(html.toLowerCase()).toContain('deteriorating')
    expect(html.toLowerCase()).toContain('remove from watchlist')
    expect(html.toLowerCase()).not.toContain('no prune action yet')
    expect(html.toLowerCase()).toContain('screened out')
    // The SHIPPED thesis re-review is part of the lifecycle story: the filings-since-decision delta
    // diffed against the recorded thesis, in verdict vocabulary, human-fired today (no scheduler).
    expect(html.toLowerCase()).toContain('check-in') // renamed from 'thesis re-review' (owner, Phase 4)
    expect(html.toLowerCase()).toContain('since a decision')
    expect(html.toLowerCase()).toContain('intact, weakened, broken')
    expect(html.toLowerCase()).toContain('inconclusive')
    // Human-fired launch points named; no roadmap "yet" language (owner, 2026-07-18).
    expect(html.toLowerCase()).toContain('you launch it from the dossier')
    expect(html.toLowerCase()).not.toContain('no scheduler fires it yet')
  })

  it('describes the four model tiers including the compute-everything T0 rule', () => {
    const html = render('tiering')
    expect(html).toContain('T1')
    expect(html).toContain('T0')
    expect(html.toLowerCase()).toContain('if it can be computed, compute it')
    // Honest status (owner): the tiered setup is DESIGN, not proven behavior — live testing so far
    // ran through OpenRouter with a single routed model.
    expect(html.toLowerCase()).toContain('not been exercised end-to-end')
    expect(html.toLowerCase()).toContain('openrouter with a single routed model')
  })
})
