import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import type { AnnualFacts, Fundamentals } from '../secEdgar'
import type { PriceHistoryPoint } from '../marketData'
import {
  groupBuyEpisodes,
  runValuationBacktest,
  simulateLadderDeployment,
  computeDeploymentRatio,
  type SignalLogEntry,
} from '../backtest'

// ---------------------------------------------------------------------------
// Synthetic fixtures — a small 3-year annual series with KNOWN filed dates and a
// hand-made monthly price series, so the as-of OE logic + signal mapping + episode
// grouping are deterministic and assertable without hitting EDGAR/Yahoo.
// ---------------------------------------------------------------------------

// Each year: NI=120, D&A=40, capex=30, SBC=20 → maintenance_capex=min(D&A,capex)=30
//   OE_total = 120 + 40 − 30 − 20 − 0(ΔNWC) = 110 ; shares=100 → OE_ps = 1.10
// The three filings carry identical OE so the as-of step is observable purely by which
// filing is "available" at a given month (filed date gate), and FV/buy are constant.
function annualEntry(fy: number, filed: string, shares: number): AnnualFacts {
  return {
    fiscal_year: fy,
    currency: 'USD',
    filed,
    period_end: `${fy}-12-31`,
    net_income_musd: 120,
    revenue_musd: 600,
    d_and_a_musd: 40,
    capex_musd: 30,
    sbc_musd: 20,
    diluted_shares_m: shares,
    // invested-capital + NOPAT proxies so incremental ROIC is computable as-of each filing
    stockholders_equity_musd: 400 + (fy - 2018) * 50,
    total_debt_musd: 0,
    cash_and_securities_musd: 0,
    operating_income_musd: 150,
    income_tax_expense_musd: 30,
  }
}

function buildFundamentals(): Fundamentals {
  // newest → oldest, as fetchCompanyFundamentals returns
  const annual_series: AnnualFacts[] = [
    annualEntry(2020, '2021-02-15', 100),
    annualEntry(2019, '2020-02-15', 100),
    annualEntry(2018, '2019-02-15', 100),
  ]
  return {
    cik: '0000000001',
    entity_name: 'Fixture Co',
    currency: 'USD',
    latest_annual: annual_series[0]!,
    annual_series,
    filings: [],
  }
}

// Monthly price series spanning before-and-after each filing.
function priceAt(date: string, close: number): PriceHistoryPoint {
  return { date, close }
}

describe('runValuationBacktest — as-of OE + signal mapping (wide moat fixture)', () => {
  const fundamentals = buildFundamentals()

  it('skips months before the first 10-K is filed (no OE available)', () => {
    const price_series: PriceHistoryPoint[] = [
      priceAt('2019-01-31', 5), // before 2018 10-K filed (2019-02-15)
      priceAt('2019-03-31', 5), // after 2018 10-K filed
    ]
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series,
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    // first month skipped, only the second produced a signal entry
    expect(result.signal_log).toHaveLength(1)
    expect(result.signal_log[0]!.date).toBe('2019-03-31')
    expect(result.signal_log[0]!.filing_fy).toBe(2018)
    expect(result.summary.skipped_months_no_filing).toBe(1)
  })

  it('picks the latest filing whose filed date <= the month (as-of step advances)', () => {
    const price_series: PriceHistoryPoint[] = [
      priceAt('2020-01-31', 5), // 2019 10-K (filed 2020-02-15) NOT yet filed → latest available is FY2018
      priceAt('2020-03-31', 5), // 2019 10-K now filed → latest is FY2019
      priceAt('2021-03-31', 5), // 2020 10-K filed 2021-02-15 → latest is FY2020
    ]
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series,
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.signal_log[0]!.filing_fy).toBe(2018)
    expect(result.signal_log[1]!.filing_fy).toBe(2019)
    expect(result.signal_log[2]!.filing_fy).toBe(2020)
  })

  it('maps price below buy → BUY, between buy and FV → WATCH-FAIR, above FV → WATCH', () => {
    // Establish FV/buy from a single month, then probe three prices.
    const probe = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', 5)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const entry = probe.signal_log[0]!
    const buy = entry.buy_price_ps
    const fv = entry.fair_value_ps
    expect(fv).toBeGreaterThan(buy)

    const series: PriceHistoryPoint[] = [
      priceAt('2019-03-31', buy * 0.9), // below buy
      priceAt('2019-04-30', (buy + fv) / 2), // between
      priceAt('2019-05-31', fv * 1.5), // above FV
    ]
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: series,
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.signal_log.map((e) => e.signal)).toEqual(['BUY', 'WATCH-FAIR', 'WATCH'])
  })

  it('groups consecutive BUY months into one episode and computes buys/yr', () => {
    const probe = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', 5)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const buy = probe.signal_log[0]!.buy_price_ps
    const low = buy * 0.8
    const high = buy * 5
    // BUY, BUY (one episode), WATCH, BUY (second episode)
    const series: PriceHistoryPoint[] = [
      priceAt('2019-03-31', low),
      priceAt('2019-04-30', low),
      priceAt('2019-05-31', high),
      priceAt('2019-06-30', low),
    ]
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: series,
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.summary.buy_months).toBe(3)
    expect(result.summary.buy_episodes).toHaveLength(2)
    expect(result.summary.buy_episodes[0]!.start).toBe('2019-03-31')
    expect(result.summary.buy_episodes[0]!.end).toBe('2019-04-30')
    expect(result.summary.buy_episodes[0]!.months).toBe(2)
    expect(result.summary.buy_episodes[1]!.start).toBe('2019-06-30')
  })

  it('gates below-wide moats to never BUY (always WATCH/PASS)', () => {
    const probe = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', 5)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const buy = probe.signal_log[0]!.buy_price_ps
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'moderate',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', buy * 0.1)], // far below any buy price
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.signal_log[0]!.signal).toBe('PASS')
    expect(result.summary.buy_months).toBe(0)
  })
})

describe('groupBuyEpisodes', () => {
  it('returns no episodes for an all-WATCH log', () => {
    expect(
      groupBuyEpisodes([
        { date: '2020-01-31', signal: 'WATCH' },
        { date: '2020-02-29', signal: 'WATCH' },
      ]),
    ).toEqual([])
  })

  it('treats a single isolated BUY as a one-month episode', () => {
    const episodes = groupBuyEpisodes([
      { date: '2020-01-31', signal: 'WATCH' },
      { date: '2020-02-29', signal: 'BUY' },
      { date: '2020-03-31', signal: 'WATCH' },
    ])
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ start: '2020-02-29', end: '2020-02-29', months: 1 })
  })
})

// ---------------------------------------------------------------------------
// position-sizing-spec §7 — deployment-ratio metric (pinned values)
// ---------------------------------------------------------------------------

function step(date: string, price: number, buy: number, signal: SignalLogEntry['signal']): SignalLogEntry {
  return {
    date,
    price,
    oe_ps: 1,
    credited_g: 0,
    fair_value_ps: buy / 0.85,
    buy_price_ps: buy,
    implied_multiple: 1,
    signal,
    filing_fy: 2020,
  }
}

describe('simulateLadderDeployment — fill simulation against a price path', () => {
  it('cold ladder: price grinds to −20% over months → full deployment (1.0)', () => {
    // buy=100; T1@buy (entry), T2@90, T3@80. Price walks down to 80.
    const steps = [
      { date: '2020-01-31', price: 100, buy_price_ps: 100, signal: 'BUY' as const },
      { date: '2020-02-29', price: 92, buy_price_ps: 100, signal: 'BUY' as const },
      { date: '2020-03-31', price: 88, buy_price_ps: 100, signal: 'BUY' as const }, // T2 hits (≤90)
      { date: '2020-04-30', price: 79, buy_price_ps: 100, signal: 'BUY' as const }, // T3 hits (≤80)
    ]
    expect(simulateLadderDeployment(steps, 'cold')).toBe(1)
  })

  it('cold ladder: price never drops, never enough clean months → only T1 (0.40)', () => {
    // Price always ABOVE buy → no price trigger, no time-completion (time needs ≤ buy).
    const steps = [
      { date: '2020-01-31', price: 101, buy_price_ps: 100, signal: 'BUY' as const },
      { date: '2020-02-29', price: 105, buy_price_ps: 100, signal: 'BUY' as const },
    ]
    expect(simulateLadderDeployment(steps, 'cold')).toBe(0.40)
  })

  it('normal ladder: 7 months at 2% below buy → time-completion fills T2 (1.0)', () => {
    // buy=100; price 98 (below buy, above the −10% level 90). 6 clean months → T2 by time-completion.
    const steps = Array.from({ length: 8 }, (_unused, i) => ({
      date: `2020-0${i + 1}-15`,
      price: 98,
      buy_price_ps: 100,
      signal: 'BUY' as const,
    }))
    // normal = 60/40; T1 entry + T2 via time-completion = 1.0
    expect(simulateLadderDeployment(steps, 'normal')).toBe(1)
  })
})

describe('computeDeploymentRatio — mean deployment across BUY episodes', () => {
  it('averages two episodes (full + partial) to a pinned 0.7', () => {
    const log: SignalLogEntry[] = [
      // Episode 1: walks to −20% → cold full (1.0)
      step('2020-01-31', 100, 100, 'BUY'),
      step('2020-02-29', 88, 100, 'BUY'),
      step('2020-03-31', 79, 100, 'BUY'),
      // gap (not BUY) splits the episodes
      step('2020-04-30', 130, 100, 'WATCH'),
      // Episode 2: one BUY month then recovers above buy → cold T1 only (0.40)
      step('2020-05-31', 100, 100, 'BUY'),
      step('2020-06-30', 140, 100, 'WATCH'),
    ]
    const cold = computeDeploymentRatio(log, 'cold')
    expect(cold.episodes).toBe(2)
    // (1.0 + 0.40) / 2 = 0.70
    expect(cold.avg_deployment_ratio).toBe(0.7)
  })

  it('returns 0 with no BUY episodes', () => {
    const log: SignalLogEntry[] = [step('2020-01-31', 130, 100, 'WATCH')]
    expect(computeDeploymentRatio(log, 'cold').avg_deployment_ratio).toBe(0)
    expect(computeDeploymentRatio(log, 'cold').episodes).toBe(0)
  })
})
