import { describe, expect, it } from 'vitest'

import type { Fundamentals, AnnualFacts } from '../secEdgar'
import type { PriceHistoryPoint, PriceHistoryResult } from '../marketData'
import { runCalibrationBacktest } from '../calibrationRun'
import type { CalibrationUniverse } from '../calibrationUniverse'

// A tiny but valuation-usable fundamentals series with filed dates, in USD.
function annual(fy: number, filed: string): AnnualFacts {
  return {
    fiscal_year: fy,
    currency: 'USD',
    filed,
    period_end: `${fy}-12-31`,
    net_income_musd: 120,
    revenue_musd: 1000,
    d_and_a_musd: 40,
    capex_musd: 30,
    sbc_musd: 20,
    diluted_shares_m: 100,
  }
}

function fundamentals(name: string, currency = 'USD'): Fundamentals {
  return {
    cik: '',
    entity_name: name,
    currency,
    latest_annual: annual(2015, '2016-02-15'),
    annual_series: [annual(2013, '2014-02-15'), annual(2014, '2015-02-15'), annual(2015, '2016-02-15')],
    filings: [{ form: '10-K', filed: '2016-02-15', url: 'https://example.com' }],
  }
}

// Deterministic monthly prices: deeply cheap then expensive, to produce at least one BUY episode.
function priceSeries(): PriceHistoryPoint[] {
  const points: PriceHistoryPoint[] = []
  for (let year = 2016; year <= 2018; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, '0')
      // first year cheap (BUY-ish at low multiples), later years expensive.
      const close = year === 2016 ? 5 : 40
      points.push({ date: `${year}-${mm}-28`, close })
    }
  }
  return points
}

const universe: CalibrationUniverse = {
  version: 'calibration-universe-test-1',
  names: [
    { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' },
    { ticker: 'TABREED', company: 'Tabreed', market: 'intl', fundamentals_hint: 'local_manual' },
    { ticker: 'GHOST', company: 'Unresolvable Co', market: 'intl', fundamentals_hint: 'local_manual' },
  ],
}

function priceResult(points: PriceHistoryPoint[], currency = 'USD'): PriceHistoryResult {
  return { available: true, currency, points }
}

describe('runCalibrationBacktest', () => {
  it('classifies coverage per name: edgar / local-manual / unresolved', async () => {
    const result = await runCalibrationBacktest(universe, {
      // CPRT resolves via EDGAR; TABREED via local-manual; GHOST resolves nowhere.
      localProvider: {
        resolve: async (ticker) => (ticker.toUpperCase() === 'TABREED' ? fundamentals('Tabreed') : undefined),
      },
      edgarProvider: {
        resolve: async (ticker) => (ticker.toUpperCase() === 'CPRT' ? fundamentals('Copart') : undefined),
      },
      priceFetcher: async () => priceResult(priceSeries()),
    })

    const byTicker = new Map(result.coverage.map((c) => [c.ticker, c]))
    expect(byTicker.get('CPRT')?.status).toBe('resolved_edgar')
    expect(byTicker.get('TABREED')?.status).toBe('resolved_local_manual')
    expect(byTicker.get('GHOST')?.status).toBe('unresolved')
    // unresolved names carry an honest reason and are NOT fabricated into a summary.
    expect(byTicker.get('GHOST')?.reason).toMatch(/no fundamentals|unresolved|fail-closed/i)
    expect(result.summaries.some((s) => s.ticker === 'GHOST')).toBe(false)
  })

  it('aggregates a per-name signal summary + deployment ratios for resolved names', async () => {
    const result = await runCalibrationBacktest(universe, {
      localProvider: { resolve: async (t) => (t.toUpperCase() === 'TABREED' ? fundamentals('Tabreed') : undefined) },
      edgarProvider: { resolve: async (t) => (t.toUpperCase() === 'CPRT' ? fundamentals('Copart') : undefined) },
      priceFetcher: async () => priceResult(priceSeries()),
    })

    const cprt = result.summaries.find((s) => s.ticker === 'CPRT')
    expect(cprt).toBeDefined()
    expect(cprt?.total_months).toBeGreaterThan(0)
    expect(cprt?.buy_months).toBeGreaterThan(0)
    // The per-ladder deployment ratios are surfaced (position-sizing-spec §7).
    expect(cprt?.deployment_ratios.map((d) => d.ladder_id).sort()).toEqual(['cold', 'normal'])
  })

  it('records the universe version + coverage counts in the aggregate', async () => {
    const result = await runCalibrationBacktest(universe, {
      localProvider: { resolve: async (t) => (t.toUpperCase() === 'TABREED' ? fundamentals('Tabreed') : undefined) },
      edgarProvider: { resolve: async (t) => (t.toUpperCase() === 'CPRT' ? fundamentals('Copart') : undefined) },
      priceFetcher: async () => priceResult(priceSeries()),
    })
    expect(result.universe_version).toBe('calibration-universe-test-1')
    expect(result.coverage_counts).toEqual({ resolved_edgar: 1, resolved_local_manual: 1, unresolved: 1 })
  })

  it('flags a currency mismatch as unresolved (no silent cross-currency valuation)', async () => {
    const result = await runCalibrationBacktest(
      { version: 'v', names: [{ ticker: 'NVO', company: 'Novo', market: 'intl', fundamentals_hint: 'edgar' }] },
      {
        localProvider: { resolve: async () => undefined },
        edgarProvider: { resolve: async () => fundamentals('Novo Nordisk', 'DKK') },
        priceFetcher: async () => priceResult(priceSeries(), 'USD'),
      },
    )
    const nvo = result.coverage.find((c) => c.ticker === 'NVO')
    expect(nvo?.status).toBe('unresolved')
    expect(nvo?.reason).toMatch(/currency/i)
  })
})
