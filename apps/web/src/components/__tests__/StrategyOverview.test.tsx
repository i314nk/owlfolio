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
  marginOfSafetyForMoat,
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

  it('renders the moat-tiered margin of safety from the contract', () => {
    const html = render()
    const wide = `${marginOfSafetyForMoat(buffettMungerStrategy, 'wide') * 100}%` // 25% (recalibrated)
    const monopoly = `${marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly') * 100}%` // 15% (recalibrated)
    expect(wide).toBe('25%')
    expect(monopoly).toBe('15%')
    expect(html).toContain('25%')
    expect(html).toContain('15%')
  })

  it('describes the two-stage DCF method (not the old single-stage equity bond)', () => {
    const html = render()
    // Two-stage framing + terminal fade + 18× cap
    expect(html).toContain('two stages')
    expect(html.toLowerCase()).toContain('terminal')
    expect(html).toContain(`${buffettMungerStrategy.valuation.valuation_multiple_ceiling}×`)
    // Incremental-ROIC eligibility threshold + runway axis
    expect(html).toContain('incremental ROIC')
    expect(html.toLowerCase()).toContain('runway')
    // No stale single-stage / equity-bond prose
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

  it('renders the position-sizing target weights and entry tranches from the contract', () => {
    const html = render()
    const targetMonopoly = `${buffettMungerStrategy.portfolio.target_weight_by_moat.monopoly * 100}%` // 10%
    expect(targetMonopoly).toBe('10%')
    expect(html).toContain('6%') // wide target weight
    for (const tranche of buffettMungerStrategy.portfolio.entry_tranches) {
      expect(html).toContain(tranche.id)
    }
  })
})
