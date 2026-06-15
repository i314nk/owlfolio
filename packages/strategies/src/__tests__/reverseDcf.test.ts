import { describe, expect, it } from 'vitest'

import { buffettMungerStrategy, discountRate, twoStageValuation } from '../buffettMunger'
import { marketImpliedGrowth } from '../reverseDcf'
import { VALUATION_PARAMS } from '../valuationParams'

const DISCOUNT = discountRate(buffettMungerStrategy)
const TERMINAL_G = VALUATION_PARAMS.terminal_growth
const HORIZON = VALUATION_PARAMS.stage1_horizon
const FADE = VALUATION_PARAMS.growth_fade_years

/** Forward faded FV per share for a near-term g, inverting the SAME function used by the solver. */
function forwardFv(oe_ps: number, g: number): number {
  const r = twoStageValuation({
    oe_ps,
    g,
    terminal_g: TERMINAL_G,
    discount: DISCOUNT,
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: HORIZON,
    fade_years: FADE,
  })
  if (r.fair_value === undefined) throw new Error('forward FV undefined (absurd)')
  return r.fair_value
}

describe('marketImpliedGrowth — inverts the faded two-stage DCF', () => {
  describe('round-trip against the forward faded twoStageValuation', () => {
    const oe_ps = 5
    for (const g0 of [0.02, 0.08, 0.1, 0.15]) {
      it(`recovers g0=${g0} from its forward faded fair value`, () => {
        const price = forwardFv(oe_ps, g0)
        const result = marketImpliedGrowth({ price, oe_ps })
        expect(result.status).toBe('solved')
        expect(result.implied_growth).toBeDefined()
        expect(result.implied_growth!).toBeCloseTo(g0, 3)
      })
    }
  })

  it('is monotonic — a higher price implies a higher growth', () => {
    const oe_ps = 4
    const lowPrice = forwardFv(oe_ps, 0.05)
    const highPrice = forwardFv(oe_ps, 0.12)
    const low = marketImpliedGrowth({ price: lowPrice, oe_ps })
    const high = marketImpliedGrowth({ price: highPrice, oe_ps })
    expect(low.status).toBe('solved')
    expect(high.status).toBe('solved')
    expect(high.implied_growth!).toBeGreaterThan(low.implied_growth!)
  })

  it('sets above_cap when the implied growth exceeds single_growth_cap', () => {
    const oe_ps = 6
    // Price implying growth just above the 15% forecasting-humility cap.
    const g = VALUATION_PARAMS.single_growth_cap + 0.03
    const price = forwardFv(oe_ps, g)
    const result = marketImpliedGrowth({ price, oe_ps })
    expect(result.status).toBe('solved')
    expect(result.implied_growth!).toBeGreaterThan(VALUATION_PARAMS.single_growth_cap)
    expect(result.above_cap).toBe(true)
    expect(result.above_gdp).toBe(true)
  })

  it('does not set above_cap / above_gdp for a modest implied growth', () => {
    const oe_ps = 6
    const price = forwardFv(oe_ps, 0.02) // below gdp threshold (0.03)
    const result = marketImpliedGrowth({ price, oe_ps })
    expect(result.status).toBe('solved')
    expect(result.above_cap).toBe(false)
    expect(result.above_gdp).toBe(false)
  })

  it('returns above_range (undefined) for a price above what the model can express', () => {
    const oe_ps = 5
    // Far above any finite faded FV — into/above the absurd ceiling.
    const price = oe_ps * VALUATION_PARAMS.fv_absurd_multiple * 2
    const result = marketImpliedGrowth({ price, oe_ps })
    expect(result.status).toBe('above_range')
    expect(result.implied_growth).toBeUndefined()
    expect(result.above_cap).toBe(false)
    expect(result.above_gdp).toBe(false)
  })

  it('returns below_range (undefined) for a price below the low bracket FV', () => {
    const oe_ps = 5
    const result = marketImpliedGrowth({ price: 0.01, oe_ps })
    expect(result.status).toBe('below_range')
    expect(result.implied_growth).toBeUndefined()
  })

  it('is not_computable for non-positive price', () => {
    expect(marketImpliedGrowth({ price: 0, oe_ps: 5 }).status).toBe('not_computable')
    expect(marketImpliedGrowth({ price: -10, oe_ps: 5 }).status).toBe('not_computable')
    expect(marketImpliedGrowth({ price: Number.NaN, oe_ps: 5 }).status).toBe('not_computable')
    expect(marketImpliedGrowth({ price: Number.POSITIVE_INFINITY, oe_ps: 5 }).status).toBe('not_computable')
  })

  it('is not_computable for non-positive oe_ps', () => {
    expect(marketImpliedGrowth({ price: 100, oe_ps: 0 }).status).toBe('not_computable')
    expect(marketImpliedGrowth({ price: 100, oe_ps: -2 }).status).toBe('not_computable')
    expect(marketImpliedGrowth({ price: 100, oe_ps: Number.NaN }).status).toBe('not_computable')
  })

  it('tracks config defaults — explicit defaults match the implicit ones', () => {
    const oe_ps = 7
    const price = forwardFv(oe_ps, 0.09)
    const implicit = marketImpliedGrowth({ price, oe_ps })
    const explicit = marketImpliedGrowth({
      price,
      oe_ps,
      terminal_g: TERMINAL_G,
      discount: DISCOUNT,
      horizon: HORIZON,
      fade_years: FADE,
    })
    expect(explicit.implied_growth).toBeCloseTo(implicit.implied_growth!, 6)
  })
})
