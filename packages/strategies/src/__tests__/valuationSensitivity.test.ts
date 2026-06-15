import { describe, expect, it } from 'vitest'

import { buffettMungerStrategy, discountRate } from '../buffettMunger'
import { valuationSensitivity } from '../valuationSensitivity'
import { VALUATION_PARAMS } from '../valuationParams'

const STRATEGY = buffettMungerStrategy
const DISCOUNT = discountRate(buffettMungerStrategy)
const CAP = VALUATION_PARAMS.single_growth_cap

describe('valuationSensitivity — fair-value range that widens with measurement uncertainty', () => {
  it('thin + dispersed (GOOGL-like): wide range, max band_fraction, cap-binding', () => {
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.227,
      points_used: 5,
      high_dispersion: true,
    })
    expect(r.computable).toBe(true)
    // 0.15 + 0.25 (thin) + 0.25 (dispersed) = 0.65, clamped to 0.65.
    expect(r.band_fraction).toBeCloseTo(0.65, 10)
    expect(r.cap_binding).toBe(true)
    expect(r.range_pct).toBeDefined()
    expect(r.range_pct!).toBeGreaterThan(0)
    // demonstrated (0.227) > cap (0.15) → upside bounded by cap == base.
    expect(r.growth_high).toBeCloseTo(CAP, 10)
    expect(r.growth_base).toBeCloseTo(CAP, 10)
  })

  it('full history above cap (MSFT-like): band 0.15, non-zero downside, upside capped, range_pct > 0', () => {
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.235,
      points_used: 10,
      high_dispersion: false,
    })
    expect(r.computable).toBe(true)
    expect(r.band_fraction).toBeCloseTo(0.15, 10)
    expect(r.cap_binding).toBe(true)
    // Upside is capped → equals base; downside reaches below the cap.
    expect(r.fair_value_high).toBeCloseTo(r.fair_value_base!, 6)
    expect(r.fair_value_low!).toBeLessThan(r.fair_value_base!)
    // The ±0% artifact is fixed: range is non-zero on the downside.
    expect(r.range_pct!).toBeGreaterThan(0)
  })

  it('ordering: GOOGL-like range_pct > MSFT-like range_pct (uncertainty widens the range)', () => {
    const googl = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.227,
      points_used: 5,
      high_dispersion: true,
    })
    const msft = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.235,
      points_used: 10,
      high_dispersion: false,
    })
    expect(googl.range_pct!).toBeGreaterThan(msft.range_pct!)
  })

  it('below-cap grower: cap_binding false, upside may exceed base, low < base < high', () => {
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.08,
      points_used: 10,
      high_dispersion: false,
    })
    expect(r.computable).toBe(true)
    expect(r.cap_binding).toBe(false)
    expect(r.growth_low).toBeLessThan(r.growth_base)
    expect(r.growth_high).toBeGreaterThan(r.growth_base)
    expect(r.growth_high).toBeLessThanOrEqual(CAP)
    expect(r.fair_value_low!).toBeLessThan(r.fair_value_base!)
    expect(r.fair_value_base!).toBeLessThan(r.fair_value_high!)
  })

  it('monotonic: fair_value_low <= fair_value_base <= fair_value_high', () => {
    for (const demonstrated_growth of [0.02, 0.08, 0.12, 0.227, 0.4]) {
      const r = valuationSensitivity(STRATEGY, {
        oe_ps: 10,
        demonstrated_growth,
        points_used: 6,
        high_dispersion: true,
      })
      expect(r.computable).toBe(true)
      expect(r.fair_value_low!).toBeLessThanOrEqual(r.fair_value_base!)
      expect(r.fair_value_base!).toBeLessThanOrEqual(r.fair_value_high!)
    }
  })

  it('band_fraction clamps to [0.10, 0.65]', () => {
    // Full history, clean → 0.15 (already covered); confirm the max clamp path stays at 0.65.
    const maxBand = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.1,
      points_used: 1,
      high_dispersion: true,
    })
    expect(maxBand.band_fraction).toBeCloseTo(0.65, 10)
  })

  it('discount/horizon track config defaults (uses discountRate)', () => {
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.1,
      points_used: 10,
      high_dispersion: false,
    })
    // Sanity: a positive finite fair value at the default discount.
    expect(Number.isFinite(r.fair_value_base!)).toBe(true)
    expect(r.fair_value_base!).toBeGreaterThan(0)
    expect(DISCOUNT).toBeGreaterThan(0)
  })

  it('fail-closed: oe_ps <= 0 → computable false, no throw', () => {
    expect(() =>
      valuationSensitivity(STRATEGY, {
        oe_ps: 0,
        demonstrated_growth: 0.1,
        points_used: 10,
        high_dispersion: false,
      }),
    ).not.toThrow()
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: -5,
      demonstrated_growth: 0.1,
      points_used: 10,
      high_dispersion: false,
    })
    expect(r.computable).toBe(false)
    expect(r.fair_value_base).toBeUndefined()
    expect(r.range_pct).toBeUndefined()
  })

  it('fail-closed: non-finite oe_ps or demonstrated_growth → computable false', () => {
    const badOe = valuationSensitivity(STRATEGY, {
      oe_ps: Number.NaN,
      demonstrated_growth: 0.1,
      points_used: 10,
      high_dispersion: false,
    })
    expect(badOe.computable).toBe(false)

    const badGrowth = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: Number.NaN,
      points_used: 10,
      high_dispersion: false,
    })
    expect(badGrowth.computable).toBe(false)
  })

  it('reports the uncertainty inputs verbatim', () => {
    const r = valuationSensitivity(STRATEGY, {
      oe_ps: 10,
      demonstrated_growth: 0.1,
      points_used: 7,
      high_dispersion: true,
    })
    expect(r.uncertainty.points_used).toBe(7)
    expect(r.uncertainty.high_dispersion).toBe(true)
  })
})
