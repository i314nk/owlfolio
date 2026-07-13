import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/strategy',
}))

import { StrategyOverview } from '../StrategyOverview'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'

function render(): string {
  return renderToStaticMarkup(createElement(StrategyOverview))
}

describe('StrategyOverview', () => {
  it('renders the pillar lanes from the live lane list (S6)', () => {
    const html = render()
    expect([...buffettMungerDeepDiveLanes]).toEqual(['understand', 'moat', 'management'])
    for (const lane of buffettMungerDeepDiveLanes) {
      expect(html).toContain(`data-lane="${lane}"`)
    }
  })

  it('describes what each pillar lane assesses and that lanes are grounded agents', () => {
    const html = render()
    // a representative assessment phrase per the real lane focus
    expect(html).toContain('Durable competitive advantage')
    expect(html).toContain('How the business actually makes money')
    expect(html).toContain('retained-earnings test')
    // grounding statement appears on the lane cards
    expect(html).toContain('grounded agent')
    expect(html).toContain('cited to a harness-captured source')
  })

  it('E2c: renders the flat required return from the versioned valuation config', () => {
    const html = render()
    // The book discount: the flat 15% required return (user-settable), NOT the savings anchor.
    expect(html).toContain('15%')
    expect(html.toLowerCase()).toContain('required return')
  })

  it('reframes the decision to model-proposes-buy-below + deterministic sanity-check + human-decides (R1)', () => {
    const html = render()
    const lower = html.toLowerCase()
    // The model proposes the verdict/valuation/buy-below with cited reasoning.
    expect(lower).toContain('the model proposes')
    expect(lower).toContain('cited reasoning')
    expect(lower).toContain('buy-below')
    // A deterministic sanity-check flags absurdity but never blocks; the human audits and decides.
    expect(lower).toContain('sanity-check')
    expect(lower).toContain('audit')
    // The page describes the monopoly as a durability signal.
    expect(lower).toContain('durability')
    // The retired MoS-as-price-haircut framing stays gone (Phase-8 tripwire — guards the retired MoS terms).
    expect(html).not.toContain('Base margin of safety')
    expect(html).not.toContain('× (1 −')
    // The retired band/gap framing must NOT be reintroduced by the reframe.
    expect(lower).not.toContain('required growth gap')
    expect(lower).not.toContain('sustainable-growth band')
    expect(lower).not.toContain('sustainable band')
    expect(html).not.toContain('band_low')
    expect(html).not.toContain('growth-points')
  })

  it('E2c: teaches the BOOK model — computed IV off FCF, the two cited judgments, the 30/50 margins', () => {
    const html = render()
    const lower = html.toLowerCase()
    expect(lower).toContain('free cash flow')
    expect(lower).toContain('exit multiple')
    expect(lower).toContain('rule 7')
    expect(lower).toContain('rule 8')
    expect(lower).not.toContain('market-implied growth') // F: the implied lens is retired
    // The OE-era framing is gone.
    expect(lower).not.toContain('owner-earnings fair value')
    expect(lower).not.toContain('reverse-dcf first')
  })

  it('renders the wide-moat gate and rejects sub-wide moats', () => {
    const html = render()
    expect(buffettMungerStrategy.valuation.min_investable_moat).toBe('wide')
    expect(html).toContain(buffettMungerStrategy.valuation.min_investable_moat)
    // narrow/moderate shown as rejected
    expect(html).toContain('No — rejected')
  })

  it('documents the circle-of-competence hard gate: k-sample unanimous agreement + grounded evidence floors', () => {
    const html = render()
    expect(html).toContain('Within the circle of competence')
    expect(html).toContain('unanimous')
    expect(html).toContain('evidence floor')
  })

  it('renders the tranche ladders (cold 40/30/30 + normal 60/40) read from sizing params', () => {
    const html = render()
    // both named ladders appear
    expect(html).toContain('Cold-regime ladder')
    expect(html).toContain('Normal / warm-regime ladder')
    // each ladder's rung fractions are rendered from SIZING_PARAMS (not hardcoded)
    for (const ladderId of ['cold', 'normal'] as const) {
      for (const rung of SIZING_PARAMS.ladders[ladderId].rungs) {
        const fractionPct = `${Math.round(rung.fraction * 100)}%`
        expect(html).toContain(fractionPct)
      }
    }
    // time-completion window comes from config
    expect(html).toContain(String(SIZING_PARAMS.time_completion_months))
    // re-anchoring + time-completion rule notes
    expect(html.toLowerCase()).toContain('re-anchor')
    expect(html.toLowerCase()).toContain('time-completion')
  })

  it('describes the unified name lifecycle and the single state-branched cadence engine', () => {
    const html = render()
    // One list, one lifecycle in candidate → watched → held → exited order.
    expect(html.toLowerCase()).toContain('candidate → watched → held → exited')
    // ONE cadence engine, detection state-independent, action branches on state.
    expect(html.toLowerCase()).toContain('one cadence engine')
    expect(html.toLowerCase()).toContain('state-independent')
    // Replaces the stale "separate watchlist/holdings monitors" framing.
    expect(html.toLowerCase()).toContain('not separate watchlist and holdings monitors')
    // Honesty: deteriorating watched name has no prune action yet (later phase).
    expect(html.toLowerCase()).toContain('deteriorating')
    expect(html.toLowerCase()).toContain('no prune action yet')
    // Exit provenance — sold vs screened out are opposite.
    expect(html.toLowerCase()).toContain('screened out')
  })

  it('describes admission discipline without overclaiming (circle CHECKED not inferred, size deferred, MoS provisional, admit human-decided, no recommendation panel)', () => {
    const html = render().toLowerCase()
    // Discovery is the admission operation.
    expect(html).toContain('discovery is the admission operation')
    // Circle of competence is human-set config the harness CHECKS, never agent-inferred (sector via EDGAR SIC).
    expect(html).toContain('circle of competence')
    expect(html).toContain('checks')
    expect(html).toContain('never agent-inferred')
    expect(html).toContain('edgar sic')
    expect(html).toContain('permissive by default')
    // Size is the deferred Pabrai-Principle-5 axis, shipped permissive.
    expect(html).toContain('pabrai principle 5')
    expect(html).toContain('deferred')
    // Cheapness counts only on an already-wonderful business.
    expect(html).toContain('already-wonderful')
    // The admit judgment splits uncertainty vs permanent-loss risk + an independent bear case.
    expect(html).toContain('permanent-loss risk')
    expect(html).toContain('bear case')
    // Admit is human-decided with a signed thesis + a provisional-MoS buy-below.
    expect(html).toContain('signed thesis')
    expect(html).toContain('provisional')
    // NO OVERCLAIM: the admit-recommendation panel does NOT exist yet.
    expect(html).toContain('does not yet present an admit-recommendation panel')
  })

  it('renders the two book zones + the truck base (owner-locked: no weight table, no ladder)', () => {
    const html = render()
    expect(buffettMungerStrategy.portfolio.target_weight_by_moat).toBeUndefined()
    expect(buffettMungerStrategy.portfolio.entry_tranches).toBeUndefined()
    expect(html).toContain('load up the truck')
    expect(html).toContain('Buy zone (rule 7)')
    expect(html).toContain('Load-up zone (rule 8)')
    expect(html).toContain('risk rails')
  })

  it('renders the Phase-5 conviction-sizing discipline: no Kelly, the two caps, savings first-class, worst-case-first', () => {
    const html = render()
    // target = conviction × base weight, explicitly NOT Kelly (no probability/odds/edge).
    expect(html).toContain(`conviction × ${SIZING_PARAMS.base_target_weight * 100}%`)
    expect(html).toContain('NOT Kelly')
    expect(html).toContain('no win-probability, no odds, no edge')
    // The two distinct caps: 15% deployment vs ~22% appreciation-review.
    expect(html).toContain('Deployment cap')
    expect(html).toContain(`${SIZING_PARAMS.per_name_cap * 100}%`)
    expect(html).toContain('Appreciation review')
    expect(html).toContain(`~${SIZING_PARAMS.concentration_review_threshold * 100}%`)
    // Winners run / no force-trim.
    expect(html).toContain('winners run')
    expect(html).toContain('never force-trimmed')
    // Savings as first-class + the triple-duty rate.
    expect(html).toContain('Cash is a first-class position')
    expect(html).toContain('triple duty')
    expect(html).toContain('fat-pitch posture')
    // Worst-case-in-front discipline.
    expect(html).toContain('worst case')
    // NO OVERCLAIM: advisory only + the discount already anchors on the savings rate (F.2 shipped).
    expect(html).toContain('Advisory only')
    expect(html).toContain('The discount already anchors on this savings rate')
    expect(html).toContain('Treasury anchor is retired')
  })
})
