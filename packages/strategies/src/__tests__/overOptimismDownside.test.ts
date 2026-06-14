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
// RE-DERIVED 2026-06-15 (owner decision): single_growth_cap = 0.15, a forward-FORECASTING-HUMILITY ceiling.
// The robust Phase-1 OE/share CAGRs of the believed-in set run 16–23.5%; the owner chose to let the cap
// itself carry forward-humility ("won't underwrite >15% forward") rather than honoring 20%+ inputs. An
// over-optimistic 35% proposal is capped to 15%, and TWO mechanisms then tame the output: Part D Step 2's
// stage-1 fade (g glides 15% → terminal 1.5% over years 6–10) and the single end-stage MoS (widened by the
// above-GDP / weak-moat-durability coupling). cap_exceeded stays a warn flag, no output-side hard guard.
describe('over-optimism downside boundary (F.3 asymmetric stress — cap re-derived to 0.15 + fade)', () => {
  const oe_ps = 10
  const discount = discountRate(buffettMungerStrategy)

  it('caps an over-optimistic 35% growth proposal to the named cap and flags it above-GDP', () => {
    const g = creditedGrowth(buffettMungerStrategy, { demonstrated_growth: 0.35 })
    expect(g.growth).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10) // 0.15 (re-derived 2026-06-15)
    expect(g.cap_binds).toBe(true)
    expect(g.above_gdp).toBe(true)
  })

  it('caps an over-optimistic input so the buy-below collapses to a SANE multiple (cap=0.15 + fade tame it)', () => {
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
      // At cap 0.15 the over-optimistic 35% input (capped to 15%) lands at a defensible buy-below: the faded
      // FV is ≈ 24.6× OE and the above-GDP-widened MoS (0.25 base + 0.10 weak-durability = 0.35) gives a
      // buy-multiple ≈ 16× OE — far below the ~29×/62× the old flat 0.20 path produced. The cap + the Part D
      // fade, not an output-side guard, are what contain it (cap_exceeded still fires as a warn flag).
      expect(buyMult).toBeLessThan(25)
      expect(buyMult).toBeLessThan(17)
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
