import { describe, expect, it } from 'vitest'
import {
  AAOIFI_DEBT_RATIO_MAX,
  AAOIFI_CASH_SECURITIES_RATIO_MAX,
  AAOIFI_IMPERMISSIBLE_INCOME_MAX,
  computeShariahFinancialRatios,
} from '../shariahFinancialRatios'

// ---------------------------------------------------------------------------
// computeShariahFinancialRatios — AAOIFI-style financial-ratio layer
//   debt / market cap            < 30%
//   (cash + securities) / mktcap < 30%
//   impermissible income / rev   < 5%
// The lane's SECTOR verdict is a separate hard stop; this is the FINANCIAL layer.
// "judgment proposes, code computes": the LLM identifies impermissible income;
// the harness recomputes every ratio + verdict + purification %.
// ---------------------------------------------------------------------------
describe('computeShariahFinancialRatios', () => {
  it('exposes the AAOIFI thresholds', () => {
    expect(AAOIFI_DEBT_RATIO_MAX).toBe(0.3)
    expect(AAOIFI_CASH_SECURITIES_RATIO_MAX).toBe(0.3)
    expect(AAOIFI_IMPERMISSIBLE_INCOME_MAX).toBe(0.05)
  })

  it('COST-like clean balance sheet with trace impermissible income → CONDITIONAL (purify)', () => {
    // EDGAR (FY): debt 5788, cash+sec 15284, revenue 275235; market cap ≈ 968 × 444.8 ≈ 430,646 ($M).
    // Impermissible income ≈ 0.4% of revenue (interest income on cash) ≈ 1101 $M.
    const result = computeShariahFinancialRatios({
      interest_bearing_debt: 5788,
      cash_and_securities: 15284,
      total_revenue: 275235,
      market_cap: 430646,
      impermissible_income: 0.004 * 275235,
    })
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    expect(result.debt_ratio).toBeCloseTo(0.0134, 3)
    expect(result.cash_securities_ratio).toBeCloseTo(0.0355, 3)
    expect(result.impermissible_income_pct).toBeCloseTo(0.004, 4)
    expect(result.verdict).toBe('CONDITIONAL')
    expect(result.purification_pct).toBeCloseTo(0.004, 4)
  })

  it('debt / market cap >= 30% → FAIL (hard breach)', () => {
    const result = computeShariahFinancialRatios({
      interest_bearing_debt: 60_000,
      cash_and_securities: 5_000,
      total_revenue: 100_000,
      market_cap: 150_000, // 60000/150000 = 40% > 30%
      impermissible_income: 0,
    })
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    expect(result.debt_ratio).toBeCloseTo(0.4, 6)
    expect(result.verdict).toBe('FAIL')
    // purification % carried even on FAIL (here 0).
    expect(result.purification_pct).toBe(0)
  })

  it('clean balance sheet with zero impermissible income → PASS (no purification)', () => {
    const result = computeShariahFinancialRatios({
      interest_bearing_debt: 1_000,
      cash_and_securities: 2_000,
      total_revenue: 50_000,
      market_cap: 200_000,
      impermissible_income: 0,
    })
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    expect(result.verdict).toBe('PASS')
    expect(result.purification_pct).toBe(0)
  })

  it('cash + securities / market cap >= 30% → FAIL', () => {
    const result = computeShariahFinancialRatios({
      interest_bearing_debt: 0,
      cash_and_securities: 35_000,
      total_revenue: 50_000,
      market_cap: 100_000, // 35% > 30%
      impermissible_income: 0,
    })
    expect(result.computable && result.verdict).toBe('FAIL')
  })

  it('impermissible income / revenue >= 5% → FAIL', () => {
    const result = computeShariahFinancialRatios({
      interest_bearing_debt: 0,
      cash_and_securities: 0,
      total_revenue: 100_000,
      market_cap: 500_000,
      impermissible_income: 6_000, // 6% > 5%
    })
    expect(result.computable && result.verdict).toBe('FAIL')
  })

  it('divide-by-zero / missing inputs → computable:false (caller falls back to lane verdict)', () => {
    const zeroMarketCap = computeShariahFinancialRatios({
      interest_bearing_debt: 5_000,
      cash_and_securities: 1_000,
      total_revenue: 100_000,
      market_cap: 0,
      impermissible_income: 0,
    })
    expect(zeroMarketCap.computable).toBe(false)

    const zeroRevenue = computeShariahFinancialRatios({
      interest_bearing_debt: 5_000,
      cash_and_securities: 1_000,
      total_revenue: 0,
      market_cap: 100_000,
      impermissible_income: 0,
    })
    expect(zeroRevenue.computable).toBe(false)

    const nanInput = computeShariahFinancialRatios({
      interest_bearing_debt: Number.NaN,
      cash_and_securities: 1_000,
      total_revenue: 100_000,
      market_cap: 100_000,
      impermissible_income: 0,
    })
    expect(nanInput.computable).toBe(false)
  })
})
