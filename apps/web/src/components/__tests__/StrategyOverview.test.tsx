import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/strategy',
}))

import { StrategyOverview } from '../StrategyOverview'
import {
  buffettMungerStrategy,
  discountRate,
} from '@owlfolio/strategies/buffettMunger'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'

function render(): string {
  return renderToStaticMarkup(createElement(StrategyOverview))
}

describe('StrategyOverview', () => {
  it('renders all seven specialist lanes from the live lane list', () => {
    const html = render()
    expect(buffettMungerDeepDiveLanes).toHaveLength(7)
    for (const lane of buffettMungerDeepDiveLanes) {
      expect(html).toContain(`data-lane="${lane}"`)
    }
  })

  it('describes what each lane assesses and that lanes are grounded agents', () => {
    const html = render()
    // a representative assessment phrase per the real lane focus
    expect(html).toContain('Durable competitive advantage')
    expect(html).toContain('owner-earnings bridge')
    // grounding statement appears on the lane cards
    expect(html).toContain('grounded agent')
    expect(html).toContain('cited to a harness-captured source')
  })

  it('renders the flat discount rate from the contract', () => {
    const html = render()
    const discountPct = `${discountRate(buffettMungerStrategy) * 100}%` // 10%
    expect(discountPct).toBe('10%')
    expect(html).toContain('10%')
  })

  it('renders the uniform base required growth gap from the contract (valuation-core: conservatism is the gap, not a price MoS)', () => {
    const html = render()
    // The required_growth_gap config/engine were removed (the model now proposes the verdict with cited
    // reasoning; determinism only sanity-checks). The UI renders a 3% display constant for the worked example.
    expect(html).toContain('3%')
    expect(html.toLowerCase()).toContain('required growth gap')
    expect(html.toLowerCase()).toContain('growth-points')
    // The page describes the monopoly as a durability signal, not a narrower gap.
    expect(html.toLowerCase()).toContain('durability')
    // The MoS-as-price-haircut framing is retired from the UI copy (only the explanatory code comment
    // names it, which never renders).
    expect(html).not.toContain('Base margin of safety')
    expect(html).not.toContain('× (1 −')
  })

  it('describes the two-stage DCF + the sustainable-growth band the implied growth is judged against (band/gap, not MoS price haircut)', () => {
    const html = render()
    // Two-stage framing + terminal fade.
    expect(html).toContain('two stages')
    expect(html.toLowerCase()).toContain('terminal')
    // New growth model: demonstrated owner-earnings growth under a named forecasting-humility cap.
    expect(html.toLowerCase()).toContain('humility')
    expect(html.toLowerCase()).toContain('runway')
    // Valuation-core: the decision is reverse-DCF market-implied growth vs the grounded sustainable band,
    // with the required gap as the single conservatism knob.
    expect(html.toLowerCase()).toContain('sustainable-growth band')
    expect(html.toLowerCase()).toContain('required growth gap')
    expect(html.toLowerCase()).toContain('market-implied')
    // No stale single-stage equity-bond prose.
    expect(html.toLowerCase()).not.toContain('equity bond')
    expect(html).not.toContain('OE / (')
  })

  it('renders the wide-moat gate and rejects sub-wide moats', () => {
    const html = render()
    expect(buffettMungerStrategy.valuation.min_investable_moat).toBe('wide')
    expect(html).toContain(buffettMungerStrategy.valuation.min_investable_moat)
    // narrow/moderate shown as rejected
    expect(html).toContain('No — rejected')
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

  it('renders the position-sizing target weights and entry tranches from the contract', () => {
    const html = render()
    const targetMonopoly = `${buffettMungerStrategy.portfolio.target_weight_by_moat.monopoly * 100}%` // 10%
    expect(targetMonopoly).toBe('10%')
    expect(html).toContain('6%') // wide target weight
    for (const tranche of buffettMungerStrategy.portfolio.entry_tranches) {
      expect(html).toContain(tranche.id)
    }
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
    // NO OVERCLAIM: advisory only + the anchor swap is deferred.
    expect(html).toContain('Advisory only')
    expect(html).toContain('anchor swap to this rate is deferred')
  })
})
