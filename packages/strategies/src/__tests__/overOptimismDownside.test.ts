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
// removing it, so the named cap + durability widening must be the thing that catches over-optimism. This
// test pins the CURRENT behavior of the over-optimistic case so the owner's 1.9 freeze is made against a
// known number, and so a later change to the cap / horizon / widening is a VISIBLE diff, not a silent one.
//
// FINDING (pre-freeze): with single_growth_cap = 0.20 (PLACEHOLDER) and the 10–15yr horizon, an
// over-optimistic 35% growth proposal is correctly capped to 20% AND flagged above-GDP — but 20%
// compounding over the horizon still yields a 45×/83× OE fair value, and even the widened MoS leaves a
// buy-below at ~29×/62× OE. The cap binds on the INPUT; it does not by itself prevent a high-multiple
// buy-below on the OUTPUT. Lowering the cap (the measured circle CAGRs are 5–10%, far below 20%), shortening
// the horizon, or making cap_exceeded escalate rather than warn are the owner's freeze levers.
describe('over-optimism downside boundary (F.3 asymmetric stress — pins current behavior for the 1.9 freeze)', () => {
  const oe_ps = 10
  const discount = discountRate(buffettMungerStrategy)

  it('caps an over-optimistic 35% growth proposal to the named cap and flags it above-GDP', () => {
    const g = creditedGrowth(buffettMungerStrategy, { demonstrated_growth: 0.35 })
    expect(g.growth).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10) // 0.20 PLACEHOLDER
    expect(g.cap_binds).toBe(true)
    expect(g.above_gdp).toBe(true)
  })

  it('DOCUMENTS that the capped rate over the long horizon still yields a high-multiple buy-below', () => {
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
      // The cap_exceeded flag fires (a surfaced caution), but the buy-below is still well above 18× OE —
      // the %-MoS scaled the inflated IV rather than removing it. This is the known boundary to freeze against.
      expect(v.cap_exceeded).toBe(true)
      const buyMult = ((v.fair_value ?? 0) * (1 - w.margin_of_safety)) / oe_ps
      expect(buyMult).toBeGreaterThan(18) // CURRENT behavior: an over-optimistic input still clears 18× OE
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
