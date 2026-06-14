import { describe, expect, it } from 'vitest'
import {
  creditedGrowth,
  twoStageValuation,
  widenedMarginOfSafety,
  buffettMungerStrategy,
  terminalGrowthForMoat,
  stage1HorizonForMoat,
  discountRate,
} from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// F.3 ASYMMETRIC-STRESS / 1.9 downside boundary (review): a %-MoS SCALES an inflated IV rather than
// removing it, so the named growth cap is the thing that must catch over-optimism. This test guards the
// over-optimistic case so any later change to the cap / horizon / widening is a VISIBLE diff.
//
// RESOLVED at 1.9 (owner decision 2026-06-15): single_growth_cap FROZEN at 0.10 (above the circle's
// measured 5–10yr OE CAGRs — max FDS 8.2% — with headroom). At 0.20, an over-optimistic 35% proposal was
// capped to 20% but the 10–15yr horizon still yielded a 45×/83× OE fair value and a ~29×/62× OE buy-below
// (the cap bound the INPUT, not the OUTPUT). At 0.10 the same 35% proposal is capped to 10% and the
// buy-below collapses to a sane multiple — the cap fix tames over-optimism without an output-side guard
// (owner chose "lower cap is enough"; cap_exceeded stays a warn flag).
describe('over-optimism downside boundary (F.3 asymmetric stress — cap frozen at 0.10)', () => {
  const oe_ps = 10
  const discount = discountRate(buffettMungerStrategy)

  it('caps an over-optimistic 35% growth proposal to the named cap and flags it above-GDP', () => {
    const g = creditedGrowth(buffettMungerStrategy, { demonstrated_growth: 0.35 })
    expect(g.growth).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10) // 0.10 (frozen at 1.9)
    expect(g.cap_binds).toBe(true)
    expect(g.above_gdp).toBe(true)
  })

  it('caps an over-optimistic input so the buy-below collapses to a SANE multiple (cap=0.10 tames it)', () => {
    const g = creditedGrowth(buffettMungerStrategy, { demonstrated_growth: 0.35 }).growth
    for (const moat of ['wide', 'monopoly'] as const) {
      const v = twoStageValuation({
        oe_ps, g, terminal_g: terminalGrowthForMoat(buffettMungerStrategy, moat), discount,
        ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
        absurd_multiple: buffettMungerStrategy.valuation.fv_absurd_multiple,
        horizon: stage1HorizonForMoat(buffettMungerStrategy, moat),
      })
      const w = widenedMarginOfSafety(buffettMungerStrategy, {
        moat_class: moat, terminal_value_pct_of_iv: v.terminal_value_pct_of_iv, weak_moat_durability: true,
      })
      const buyMult = ((v.fair_value ?? 0) * (1 - w.margin_of_safety)) / oe_ps
      // At 0.10 the over-optimistic 35% input (capped to 10%) lands at a defensible buy-below — well below
      // the ~29×/62× OE the old 0.20 cap produced. The cap fix, not an output guard, is what contains it.
      // (cap_exceeded still fires as a warn flag on the long-horizon monopoly path; it's a caution, not a block.)
      expect(buyMult).toBeLessThan(25)
    }
  })

  it('by contrast, a REAL in-circle CAGR (~8%) yields a sane multiple under the same machinery', () => {
    const g = creditedGrowth(buffettMungerStrategy, { demonstrated_growth: 0.08 }).growth
    const v = twoStageValuation({
      oe_ps, g, terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'wide'), discount,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      absurd_multiple: buffettMungerStrategy.valuation.fv_absurd_multiple,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'wide'),
    })
    // ~8% growth (an FDS-like real compounder) lands at a defensible multiple — the cap is not even relevant.
    expect(v.fair_value! / oe_ps).toBeLessThan(20)
  })
})
