import { describe, expect, it } from 'vitest'
import {
  buffettMungerStrategy,
  creditedGrowth,
  twoStageFairValuePerShare,
  terminalGrowthForMoat,
  marginOfSafetyForMoat,
} from '../buffettMunger'

// ---------------------------------------------------------------------------
// Two-stage DCF valuation contract params (buffett-valuation-method-v2)
// ---------------------------------------------------------------------------
describe('Buffett-Munger two-stage DCF contract params', () => {
  it('flat 10% discount rate', () => {
    expect(buffettMungerStrategy.valuation.discount_rate).toBe(0.1)
  })

  it('moat-tiered MoS: monopoly 20%, wide 30%', () => {
    expect(buffettMungerStrategy.valuation.margin_of_safety_by_moat).toEqual({ wide: 0.3, monopoly: 0.2 })
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.2)
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'wide')).toBe(0.3)
  })

  it('terminal growth by moat: monopoly 2%, wide 1%', () => {
    expect(buffettMungerStrategy.valuation.terminal_growth_by_moat).toEqual({ monopoly: 0.02, wide: 0.01 })
    expect(terminalGrowthForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.02)
    expect(terminalGrowthForMoat(buffettMungerStrategy, 'wide')).toBe(0.01)
  })

  it('18x OE valuation multiple ceiling (was 20x)', () => {
    expect(buffettMungerStrategy.valuation.valuation_multiple_ceiling).toBe(18)
  })

  it('growth eligibility threshold (incremental ROIC > 10%) and 5% absolute max', () => {
    expect(buffettMungerStrategy.valuation.growth_eligibility_incremental_roic).toBe(0.1)
    expect(buffettMungerStrategy.valuation.max_growth).toBe(0.05)
  })

  it('growth band ceilings by runway/moat tier', () => {
    expect(buffettMungerStrategy.valuation.growth_band_ceilings).toEqual({
      limited_or_none: 0.02,
      wide_proven: 0.03,
      wide_proven_exceptional: 0.04,
      monopoly_proven: 0.04,
      monopoly_proven_exceptional: 0.05,
    })
  })

  it('no longer carries the legacy terminal_growth_cap', () => {
    expect((buffettMungerStrategy.valuation as Record<string, unknown>).terminal_growth_cap).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// creditedGrowth — deterministic clamp (Step 3)
// ---------------------------------------------------------------------------
describe('creditedGrowth (Step 3 banded clamp)', () => {
  const g = (args: Parameters<typeof creditedGrowth>[1]) => creditedGrowth(buffettMungerStrategy, args)

  it('ineligible when incremental_roic <= 10% → g = 0', () => {
    expect(g({ reinvestment_rate: 0.5, incremental_roic: 0.1, runway: 'proven', moat_class: 'wide' })).toBe(0)
    expect(g({ reinvestment_rate: 0.5, incremental_roic: 0.08, runway: 'proven', moat_class: 'monopoly' })).toBe(0)
    // exactly at boundary 0.10 is NOT > 0.10 → ineligible
    expect(g({ reinvestment_rate: 1.0, incremental_roic: 0.1, runway: 'proven', moat_class: 'monopoly' })).toBe(0)
  })

  it('COST-like: reinv 0.43 × inc-ROIC 0.20 = raw 0.086 → clamped to wide+proven ceiling 0.03', () => {
    expect(g({ reinvestment_rate: 0.43, incremental_roic: 0.2, runway: 'proven', moat_class: 'wide' })).toBeCloseTo(0.03, 10)
  })

  it('runway none/limited caps at 0.02 for any moat tier', () => {
    expect(g({ reinvestment_rate: 0.43, incremental_roic: 0.2, runway: 'none', moat_class: 'monopoly' })).toBe(0.02)
    expect(g({ reinvestment_rate: 0.43, incremental_roic: 0.2, runway: 'limited', moat_class: 'wide' })).toBe(0.02)
    // even runway_exceptional cannot lift a none/limited runway above 0.02
    expect(g({ reinvestment_rate: 0.43, incremental_roic: 0.2, runway: 'none', moat_class: 'monopoly', runway_exceptional: true })).toBe(0.02)
  })

  it('wide + proven: ceiling 0.03; exceptional lifts to 0.04', () => {
    expect(g({ reinvestment_rate: 1.0, incremental_roic: 0.5, runway: 'proven', moat_class: 'wide' })).toBe(0.03)
    expect(g({ reinvestment_rate: 1.0, incremental_roic: 0.5, runway: 'proven', moat_class: 'wide', runway_exceptional: true })).toBe(0.04)
  })

  it('monopoly + proven: ceiling 0.04; exceptional lifts to 0.05 (absolute max)', () => {
    expect(g({ reinvestment_rate: 1.0, incremental_roic: 0.5, runway: 'proven', moat_class: 'monopoly' })).toBe(0.04)
    expect(g({ reinvestment_rate: 1.0, incremental_roic: 0.5, runway: 'proven', moat_class: 'monopoly', runway_exceptional: true })).toBe(0.05)
  })

  it('never exceeds the 5% absolute max', () => {
    expect(g({ reinvestment_rate: 2.0, incremental_roic: 0.9, runway: 'proven', moat_class: 'monopoly', runway_exceptional: true })).toBe(0.05)
  })

  it('raw growth binds when below the band ceiling', () => {
    // reinv 0.10 × inc-ROIC 0.20 = 0.02 raw < wide+proven ceiling 0.03 → g = 0.02
    expect(g({ reinvestment_rate: 0.1, incremental_roic: 0.2, runway: 'proven', moat_class: 'wide' })).toBeCloseTo(0.02, 10)
  })
})

// ---------------------------------------------------------------------------
// twoStageFairValuePerShare — Step 4 formula
// ---------------------------------------------------------------------------
describe('twoStageFairValuePerShare (Step 4 two-stage DCF)', () => {
  it('COST validation: OE/sh 18.97, g 0.03, g_t 0.01, r 0.10 → FV ≈ 245', () => {
    const oe_ps = 8440 / 444.8 // ≈ 18.9748
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(oe_ps).toBeCloseTo(18.97, 1)
    expect(fv).toBeCloseTo(244.87, 0)
    // Stage 1 ≈ 134, Stage 2 ≈ 110, well under the 18× cap of ≈ 341
    expect(fv).toBeLessThan(18 * oe_ps)
    expect(fv).toBeGreaterThan(200)
    // implied multiple ≈ 12.9×
    expect(fv / oe_ps).toBeCloseTo(12.9, 1)
  })

  it('g=0 → FV equals the two-stage value with flat stage 1 (no growth credit)', () => {
    const oe_ps = 8440 / 444.8
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    // Stage 1 flat OE for 10 yrs + Gordon terminal at g_t; ≈ 198.7 (close to Gordon oe*(1.01)/0.09 ≈ 213)
    expect(fv).toBeCloseTo(198.69, 0)
    expect(fv).toBeLessThan(oe_ps * 1.01 / 0.09) // below pure Gordon because stage 1 doesn't grow
  })

  it('18× OE ceiling binds when credited growth is high', () => {
    // A deliberately high g (above the policy max) drives the raw two-stage value above 18× OE.
    const oe_ps = 20
    const raw = twoStageFairValuePerShare({ oe_ps, g: 0.09, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 1000 })
    expect(raw / oe_ps).toBeGreaterThan(18)
    const capped = twoStageFairValuePerShare({ oe_ps, g: 0.09, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 18 })
    expect(capped).toBe(18 * oe_ps)
  })

  it('monopoly terminal (g_t 0.02) yields a higher FV than wide terminal (g_t 0.01)', () => {
    const oe_ps = 18.97
    const mono = twoStageFairValuePerShare({ oe_ps, g: 0.04, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 18 })
    const wide = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(mono).toBeGreaterThan(wide)
  })

  it('per-share values are sane — never ~100× off (units guard)', () => {
    const oe_ps = 18.97
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(fv).toBeLessThan(oe_ps * 18 + 1)
    expect(fv).toBeGreaterThan(oe_ps)
  })
})
