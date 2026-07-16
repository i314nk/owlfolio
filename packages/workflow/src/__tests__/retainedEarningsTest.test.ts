import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import { computeRetainedEarningsTest } from '../retainedEarningsTest'

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): Buffett's retained-earnings test — every dollar management RETAINS
// (NI − dividends) should create at least a dollar of market value over time. Pure T0:
//   anchor year = the oldest usable window year; retained/share summed over the years AFTER it
//   (split-adjusted to today's basis); market-value change/share = anchor-date close → latest close
//   (Yahoo closes are already split-adjusted). passes = Δprice/share ÷ retained/share >= 1.
// Guards (v1, owner-locked): USD-reporting + USD-priced filers only, >=5 summed years, an anchor
// close within ±45 days of the anchor period_end — anything else { computable:false } ("deferred on
// data"), never a fabricated number.
// ---------------------------------------------------------------------------------------------------

/** rows oldest→newest input; returned newest-first like the adapter. */
function series(rows: Array<{ fy: number; ni: number; div?: number; shares: number; end: string }>): AnnualFacts[] {
  return rows
    .map((r) => ({
      fiscal_year: r.fy, currency: 'USD', net_income_musd: r.ni,
      ...(r.div !== undefined ? { dividends_paid_musd: r.div } : {}),
      diluted_shares_m: r.shares, period_end: r.end,
    }))
    .sort((a, b) => b.fiscal_year - a.fiscal_year)
}

function monthly(points: Array<[string, number]>): Array<{ date: string; close: number }> {
  return points.map(([date, close]) => ({ date, close }))
}

// 6 usable years (2019 anchor + 2020–2024 summed). Retains $2/share/yr (NI 300, div 100, 100M shares).
const BASE = series([
  { fy: 2019, ni: 300, div: 100, shares: 100, end: '2019-12-28' },
  { fy: 2020, ni: 300, div: 100, shares: 100, end: '2020-12-28' },
  { fy: 2021, ni: 300, div: 100, shares: 100, end: '2021-12-28' },
  { fy: 2022, ni: 300, div: 100, shares: 100, end: '2022-12-28' },
  { fy: 2023, ni: 300, div: 100, shares: 100, end: '2023-12-28' },
  { fy: 2024, ni: 300, div: 100, shares: 100, end: '2024-12-28' },
])

describe('computeRetainedEarningsTest', () => {
  it('passes when retained dollars created more than a dollar of market value each', () => {
    // Retained 2020–2024 = 5 × $2.00 = $10/share; price moved 100 → 118 (+$18) → ratio 1.8.
    const r = computeRetainedEarningsTest({
      series: BASE,
      pricePoints: monthly([['2019-12-31', 100], ['2022-06-30', 105], ['2025-06-30', 118]]),
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable).toBe(true)
    if (!r.computable) return
    expect(r.retained_per_share).toBeCloseTo(10, 5)
    expect(r.price_change_per_share).toBeCloseTo(18, 5)
    expect(r.ratio).toBeCloseTo(1.8, 5)
    expect(r.passes).toBe(true)
    expect(r.years_used).toBe(5)
    expect(r.note).toMatch(/\$1 retained/i)
  })

  it('fails the test (still computable) when retention created less than a dollar each', () => {
    const r = computeRetainedEarningsTest({
      series: BASE,
      pricePoints: monthly([['2019-12-31', 100], ['2025-06-30', 104]]),
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable && r.passes).toBe(false)
    expect(r.computable && r.ratio).toBeCloseTo(0.4, 5)
  })

  it('split-adjusts the historical share counts (a 2:1 split mid-window must not double the retained/share)', () => {
    // Same economics as BASE, but pre-2023 years report HALF the share count (pre-split basis) and
    // dividends/NI unchanged → as-reported retained/share doubles for those years. The 2:1 split on
    // 2022-06-01 must bring them onto today's basis (×2 shares → same $2.00/share retained).
    const preSplit = series([
      { fy: 2019, ni: 300, div: 100, shares: 50, end: '2019-12-28' },
      { fy: 2020, ni: 300, div: 100, shares: 50, end: '2020-12-28' },
      { fy: 2021, ni: 300, div: 100, shares: 50, end: '2021-12-28' },
      { fy: 2022, ni: 300, div: 100, shares: 100, end: '2022-12-28' },
      { fy: 2023, ni: 300, div: 100, shares: 100, end: '2023-12-28' },
      { fy: 2024, ni: 300, div: 100, shares: 100, end: '2024-12-28' },
    ])
    const r = computeRetainedEarningsTest({
      series: preSplit,
      pricePoints: monthly([['2019-12-31', 100], ['2025-06-30', 118]]),
      priceCurrency: 'USD',
      splits: [{ date: '2022-06-01', factor: 2 }],
    })
    expect(r.computable).toBe(true)
    if (!r.computable) return
    expect(r.retained_per_share).toBeCloseTo(10, 5) // NOT 14 (which the unadjusted counts would give)
  })

  it('missing dividends tags are treated as zero retention-reducers with the overcount noted', () => {
    const noDiv = series([
      { fy: 2019, ni: 200, shares: 100, end: '2019-12-28' },
      { fy: 2020, ni: 200, shares: 100, end: '2020-12-28' },
      { fy: 2021, ni: 200, shares: 100, end: '2021-12-28' },
      { fy: 2022, ni: 200, shares: 100, end: '2022-12-28' },
      { fy: 2023, ni: 200, shares: 100, end: '2023-12-28' },
      { fy: 2024, ni: 200, shares: 100, end: '2024-12-28' },
    ])
    const r = computeRetainedEarningsTest({
      series: noDiv,
      pricePoints: monthly([['2019-12-31', 100], ['2025-06-30', 111]]),
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable).toBe(true)
    if (!r.computable) return
    expect(r.retained_per_share).toBeCloseTo(10, 5) // 5 × $2.00 (NI only)
    expect(r.note).toMatch(/no dividends tagged/i)
  })

  it('fails closed on a non-USD reporting currency (v1 scope)', () => {
    const dkk = BASE.map((a) => ({ ...a, currency: 'DKK' }))
    const r = computeRetainedEarningsTest({
      series: dkk,
      pricePoints: monthly([['2019-12-31', 100], ['2025-06-30', 118]]),
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable).toBe(false)
    if (!r.computable) expect(r.reason).toMatch(/currency/i)
  })

  it('fails closed when no anchor close sits within ±45 days of the anchor period_end', () => {
    const r = computeRetainedEarningsTest({
      series: BASE,
      pricePoints: monthly([['2022-06-30', 105], ['2025-06-30', 118]]), // series starts years after the anchor
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable).toBe(false)
    if (!r.computable) expect(r.reason).toMatch(/anchor/i)
  })

  it('fails closed below 5 summed years', () => {
    const r = computeRetainedEarningsTest({
      series: BASE.slice(0, 4), // newest 4 rows → 3 summed years
      pricePoints: monthly([['2021-12-31', 100], ['2025-06-30', 118]]),
      priceCurrency: 'USD',
      splits: [],
    })
    expect(r.computable).toBe(false)
  })
})
