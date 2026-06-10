import { describe, expect, it, vi } from 'vitest'

import { fetchAverageMarketCap, monthEndCloses, type MarketDataDeps } from '../marketData.js'
import { computeIncrementalRoic, type AnnualFacts } from '../secEdgar.js'

type FetchImpl = NonNullable<MarketDataDeps['fetchImpl']>

function okFetch(body: unknown): FetchImpl {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as FetchImpl
}

// ---------------------------------------------------------------------------
// monthEndCloses — one (latest) close per calendar month
// ---------------------------------------------------------------------------
describe('monthEndCloses', () => {
  it('keeps the last close of each YYYY-MM', () => {
    const points = [
      { date: '2024-01-05', close: 10 },
      { date: '2024-01-28', close: 12 }, // last of Jan → kept
      { date: '2024-02-15', close: 20 },
    ]
    const monthly = monthEndCloses(points)
    const byMonth = Object.fromEntries(monthly.map((p) => [p.date.slice(0, 7), p.close]))
    expect(byMonth['2024-01']).toBe(12)
    expect(byMonth['2024-02']).toBe(20)
    expect(monthly).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// fetchAverageMarketCap — avg month-end price × diluted shares (36-mo window)
// ---------------------------------------------------------------------------
describe('fetchAverageMarketCap (36-mo average market cap)', () => {
  function monthlyChart(closes: number[]): unknown {
    // One timestamp per distinct calendar month (1st of each month) starting 2021-07.
    return {
      chart: {
        result: [{
          meta: { currency: 'USD' },
          timestamp: closes.map((_, i) => Date.UTC(2021, 6 + i, 1) / 1000),
          indicators: { quote: [{ close: closes }] },
        }],
        error: null,
      },
    }
  }

  it('averages the month-end closes and multiplies by diluted shares (in $millions)', async () => {
    // 3 month-end closes: 100, 110, 120 → avg 110; diluted shares 50 (M) → 5500 ($M)
    const result = await fetchAverageMarketCap(
      { ticker: 'TEST' },
      50,
      undefined,
      { fetchImpl: okFetch(monthlyChart([100, 110, 120])) },
    )
    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.average_price).toBeCloseTo(110, 6)
      expect(result.market_cap).toBeCloseTo(5500, 6)
      expect(result.months).toBe(3)
      expect(result.basis).toBe('avg_36mo_month_end_x_diluted_shares')
    }
  })

  it('fails closed when diluted shares are non-positive', async () => {
    const result = await fetchAverageMarketCap({ ticker: 'TEST' }, 0, undefined, { fetchImpl: okFetch(monthlyChart([100])) })
    expect(result.available).toBe(false)
  })

  it('fails closed when history is unavailable', async () => {
    const result = await fetchAverageMarketCap(
      { ticker: 'TEST' },
      50,
      undefined,
      { fetchImpl: okFetch({ chart: { result: [], error: null } }) },
    )
    expect(result.available).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeIncrementalRoic — ΔNOPAT / Δinvested capital over the EDGAR series
// ---------------------------------------------------------------------------
describe('computeIncrementalRoic (from the EDGAR multi-year series)', () => {
  function year(fy: number, op: number, tax: number, equity: number, debt: number, cash: number): AnnualFacts {
    return {
      fiscal_year: fy,
      operating_income_musd: op,
      income_tax_expense_musd: tax,
      stockholders_equity_musd: equity,
      total_debt_musd: debt,
      cash_and_securities_musd: cash,
    }
  }

  it('computes ΔNOPAT/ΔIC with an effective-tax NOPAT proxy', () => {
    // FY2019: op 100, tax 21 → eff rate 0.21 → NOPAT 79; IC = 500 + 100 − 50 = 550
    // FY2023: op 200, tax 42 → eff rate 0.21 → NOPAT 158; IC = 900 + 100 − 50 = 950
    // ΔNOPAT = 79; ΔIC = 400 → incremental ROIC = 0.1975
    const series = [
      year(2023, 200, 42, 900, 100, 50),
      year(2019, 100, 21, 500, 100, 50),
    ]
    const result = computeIncrementalRoic(series)
    expect(result.computable).toBe(true)
    if (result.computable) {
      expect(result.incremental_roic).toBeCloseTo(0.1975, 6)
      expect(result.from_fiscal_year).toBe(2019)
      expect(result.to_fiscal_year).toBe(2023)
    }
  })

  it('fails closed when invested capital does not grow (ΔIC ≤ 0)', () => {
    const series = [
      year(2023, 200, 42, 400, 100, 50),
      year(2019, 100, 21, 500, 100, 50),
    ]
    const result = computeIncrementalRoic(series)
    expect(result.computable).toBe(false)
  })

  it('fails closed when fewer than two usable years', () => {
    const result = computeIncrementalRoic([year(2023, 200, 42, 900, 100, 50)])
    expect(result.computable).toBe(false)
  })

  it('rejects implausible (>100%) incremental ROIC proxies', () => {
    // Huge NOPAT jump on a tiny IC increase → > 1.0 → not computable (caller falls back to lane).
    const series = [
      year(2023, 10000, 2100, 510, 100, 50),
      year(2019, 100, 21, 500, 100, 50),
    ]
    const result = computeIncrementalRoic(series)
    expect(result.computable).toBe(false)
  })
})
