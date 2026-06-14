import { describe, expect, it } from 'vitest'
import { discountRate, buffettMungerStrategy } from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// Buffett-Munger gap-closing Phase 1.4: discount = 10y Treasury + a fixed UNIFORM equity premium.
// Global config, never an agent input, NO quality knob — the same rate for every business.
describe('discountRate (Phase 1.4 — Treasury + uniform equity premium)', () => {
  it('config carries an equity_premium and a default 10y Treasury', () => {
    expect(VALUATION_PARAMS.equity_premium).toBe(0.055)
    expect(VALUATION_PARAMS.ten_year_treasury_default).toBe(0.045)
  })

  it('with no live Treasury supplied, falls back to default Treasury + equity premium (= 10%, unchanged)', () => {
    expect(discountRate(buffettMungerStrategy)).toBeCloseTo(0.10, 10)
  })

  it('discount = live 10y Treasury + the uniform equity premium', () => {
    // e.g. Treasury 4.0% + 5.5% premium = 9.5%
    expect(discountRate(buffettMungerStrategy, 0.04)).toBeCloseTo(0.095, 10)
    // Treasury 5.0% + 5.5% = 10.5%
    expect(discountRate(buffettMungerStrategy, 0.05)).toBeCloseTo(0.105, 10)
  })

  it('is the SAME premium regardless of moat — no quality knob in the discount', () => {
    // discountRate takes no moat argument at all; identical for every business.
    expect(discountRate(buffettMungerStrategy, 0.045)).toBe(discountRate(buffettMungerStrategy, 0.045))
  })
})
