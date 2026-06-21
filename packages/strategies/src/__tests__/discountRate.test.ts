import { describe, expect, it } from 'vitest'
import { discountRate, buffettMungerStrategy } from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// F.2 ANCHOR SWAP: the discount = the COMPLIANT risk-free SAVINGS rate (Mudarabah expected profit) + a
// fixed UNIFORM equity premium. The old interest-bearing 10y Treasury anchor is RETIRED — a compliant
// investor's true risk-free is the savings rate they could actually hold, not Treasury. Global config,
// never an agent input, NO quality knob — the same rate for every business.
describe('discountRate (F.2 — compliant savings rate + uniform equity premium)', () => {
  it('config carries an equity_premium and a fail-closed savings_rate_default', () => {
    expect(VALUATION_PARAMS.equity_premium).toBe(0.055)
    expect(VALUATION_PARAMS.savings_rate_default).toBe(0.02)
  })

  it('with no risk-free rate supplied, falls back to the savings_rate_default + equity premium (= 7.5%)', () => {
    expect(discountRate(buffettMungerStrategy)).toBeCloseTo(0.075, 10)
  })

  it('discount = the supplied compliant risk-free (savings) rate + the uniform equity premium', () => {
    // e.g. savings 2.5% + 5.5% premium = 8.0%
    expect(discountRate(buffettMungerStrategy, 0.025)).toBeCloseTo(0.08, 10)
    // savings 3.0% + 5.5% = 8.5%
    expect(discountRate(buffettMungerStrategy, 0.03)).toBeCloseTo(0.085, 10)
  })

  it('fails closed to the savings_rate_default when the risk-free rate is non-finite / non-positive', () => {
    expect(discountRate(buffettMungerStrategy, Number.NaN)).toBeCloseTo(0.075, 10)
    expect(discountRate(buffettMungerStrategy, 0)).toBeCloseTo(0.075, 10)
    expect(discountRate(buffettMungerStrategy, -0.01)).toBeCloseTo(0.075, 10)
  })

  it('is the SAME premium regardless of moat — no quality knob in the discount', () => {
    // discountRate takes no moat argument at all; identical for every business.
    expect(discountRate(buffettMungerStrategy, 0.02)).toBe(discountRate(buffettMungerStrategy, 0.02))
  })
})
