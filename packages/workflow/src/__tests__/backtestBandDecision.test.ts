import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { requiredGrowthGap } from '@owlfolio/strategies/requiredGrowthGap'
import { sustainableGrowthBand } from '@owlfolio/strategies/sustainableGrowthBand'
import type { AnnualFacts, Fundamentals } from '../secEdgar'
import type { PriceHistoryPoint } from '../marketData'
import { runValuationBacktest } from '../backtest'

// ---------------------------------------------------------------------------
// MERGE-GATE slice: the backtest's per-month decision is now reverse-DCF-vs-band.
//   BUY when market_implied_growth <= band_low − required_gap (band = sustainableGrowthBand,
//   gap = requiredGrowthGap). The SignalLogEntry carries implied/band/gap (NOT FV/MoS) as the
//   decision fields; buy_price_ps is RETAINED as a derived ladder anchor.
//
// The backtest has no agent to cite economics, so the band is anchored on the DEMONSTRATED OE/share
// growth as the proxy g_fundamental (band_basis: 'demonstrated_proxy'). This APPROXIMATES the live
// agent-cited band; the validation is against this deterministic approximation.
// ---------------------------------------------------------------------------

// A compounder whose OE/share grows ~10%/yr. NI grows; D&A/capex/SBC/shares flat → OE/share grows.
function compounder(): Fundamentals {
  const series: AnnualFacts[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const fy = 2018 + i
    const ni = Math.round(120 * Math.pow(1.1, i)) // ~10%/yr OE growth
    series.push({
      fiscal_year: fy,
      currency: 'USD',
      filed: `${fy + 1}-02-15`,
      period_end: `${fy}-12-31`,
      net_income_musd: ni,
      revenue_musd: 600,
      d_and_a_musd: 40,
      capex_musd: 30,
      sbc_musd: 20,
      diluted_shares_m: 100,
      stockholders_equity_musd: 400 + i * 50,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
      operating_income_musd: ni + 30,
      income_tax_expense_musd: 30,
    })
  }
  return {
    cik: '0000000099',
    entity_name: 'Compounder Co',
    currency: 'USD',
    latest_annual: series[0]!,
    annual_series: series,
    filings: [],
  }
}

function priceAt(date: string, close: number): PriceHistoryPoint {
  return { date, close }
}

/**
 * Re-derive the as-of band/gap/buy-price by running a single-month probe at a mid-range, reliably-solvable
 * price (a price near the band-center FV; a far-out price would fall outside the reverse-DCF bracket and be
 * skipped). The band/gap/buy_price_ps fields are price-INVARIANT (they key off the as-of fundamentals only),
 * so any solvable probe price recovers the same thresholds.
 */
function bandGapFor(fundamentals: Fundamentals, asOfDate: string) {
  const probe = runValuationBacktest({
    ticker: 'PRB',
    moat_class: 'wide',
    runway: 'proven',
    fundamentals,
    price_series: [priceAt(asOfDate, 40)],
    strategy: buffettMungerStrategy,
    params: VALUATION_PARAMS,
  })
  return probe.signal_log[0]!
}

describe('runValuationBacktest — reverse-DCF-vs-band decision (merge gate)', () => {
  const fundamentals = compounder()
  const asOf = '2025-03-31' // FY2024 10-K filed 2025-02-15 → full ≥3-point series

  it('records implied/band/gap decision fields + demonstrated_proxy band_basis (no FV/MoS decision fields)', () => {
    const e = bandGapFor(fundamentals, asOf)
    expect(typeof e.implied_growth).toBe('number')
    expect(typeof e.band_low).toBe('number')
    expect(typeof e.band_high).toBe('number')
    expect(typeof e.required_gap).toBe('number')
    expect(e.band_basis).toBe('demonstrated_proxy')
    expect(e.band_low).toBeLessThanOrEqual(e.band_high)
    // buy_price_ps retained as a derived ladder anchor (price, positive).
    expect(e.buy_price_ps).toBeGreaterThan(0)
    // The decision is implied-vs-band, so the gap is the configured WIDE prior (0.03) here (no widening
    // inputs other than the above-GDP coupling, which may or may not fire depending on credited g).
    expect(e.required_gap).toBeGreaterThanOrEqual(VALUATION_PARAMS.required_growth_gap.base_gap)
  })

  it('drawdown month (price crashes) → implied growth dips below band_low − gap → BUY', () => {
    const e = bandGapFor(fundamentals, asOf)
    const buyThreshold = e.band_low - e.required_gap
    // The recorded buy_price_ps is, by construction, the price at which implied growth == buyThreshold.
    // A price BELOW it implies growth below the threshold → BUY.
    const crashed = e.buy_price_ps * 0.7
    const result = runValuationBacktest({
      ticker: 'CMP',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt(asOf, crashed)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const entry = result.signal_log[0]!
    expect(entry.signal).toBe('BUY')
    expect(entry.implied_growth).toBeLessThanOrEqual(buyThreshold + 1e-6)
  })

  it('froth month (price soars) → implied growth stays above band_low → WATCH', () => {
    const e = bandGapFor(fundamentals, asOf)
    const frothy = e.buy_price_ps * 6
    const result = runValuationBacktest({
      ticker: 'CMP',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt(asOf, frothy)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const entry = result.signal_log[0]!
    expect(entry.signal).toBe('WATCH')
    expect(entry.implied_growth).toBeGreaterThan(entry.band_low)
  })

  it('fair month (implied between threshold and band_low) → WATCH-FAIR (never auto-BUY)', () => {
    const e = bandGapFor(fundamentals, asOf)
    // Derive the price whose implied growth == band_low (the WATCH-FAIR upper edge) via the live engines.
    const band = sustainableGrowthBand(buffettMungerStrategy, {
      incremental_roic: e.credited_g,
      reinvestment_rate: 1,
      demonstrated_growth: e.credited_g,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'model_proposed',
    })
    void requiredGrowthGap // (imported to assert the gap mirror is available to callers)
    // A price between buy_price_ps (threshold) and the band_low-price sits in the WATCH-FAIR zone.
    // Use a price just above buy_price_ps so implied is just above the buy threshold but at/below band_low.
    const midPrice = e.buy_price_ps * 1.05
    const result = runValuationBacktest({
      ticker: 'CMP',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt(asOf, midPrice)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const entry = result.signal_log[0]!
    expect(band.band_low).toBeGreaterThan(e.band_low - e.required_gap)
    // implied is above the buy threshold (so not BUY) and at/below band_low (so WATCH-FAIR, not WATCH).
    expect(entry.implied_growth).toBeGreaterThan(e.band_low - e.required_gap)
    expect(entry.signal).toBe('WATCH-FAIR')
  })

  it('gated (below-wide moat) never BUYs even at a deeply crashed price', () => {
    const e = bandGapFor(fundamentals, asOf)
    const result = runValuationBacktest({
      ticker: 'CMP',
      moat_class: 'moderate',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt(asOf, e.buy_price_ps * 0.2)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.signal_log[0]!.signal).not.toBe('BUY')
    expect(result.summary.buy_months).toBe(0)
  })
})
