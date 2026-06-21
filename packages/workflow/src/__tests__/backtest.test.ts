import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import type { AnnualFacts, Fundamentals } from '../secEdgar'
import type { PriceHistoryPoint } from '../marketData'
import {
  adjustFundamentalsForSplits,
  classify,
  groupBuyEpisodes,
  runValuationBacktest,
  simulateLadderDeployment,
  computeDeploymentRatio,
  type SignalLogEntry,
} from '../backtest'
import type { SplitEvent } from '../marketData'

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
  // newest → oldest, as fetchCompanyFundamentals returns. Five years so the as-of series has ≥3 OE/share
  // points from the FY2018 filing onward (the robust growth measure needs ≥3 points — fewer → month skipped).
  const annual_series: AnnualFacts[] = [
    annualEntry(2020, '2021-02-15', 100),
    annualEntry(2019, '2020-02-15', 100),
    annualEntry(2018, '2019-02-15', 100),
    annualEntry(2017, '2018-02-15', 100),
    annualEntry(2016, '2017-02-15', 100),
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

  it('light sanity signal: implied clearly below demonstrated growth → BUY, otherwise → WATCH', () => {
    // The reference fair value is the price the forward DCF implies for the as-of OE; a price well BELOW it
    // implies a much lower near-term growth than the business demonstrated → BUY (a clear dislocation). A
    // price at/above the reference implies growth at/above the demonstrated proxy → WATCH (no band/gap tier).
    const probe = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'wide',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', 5)],
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    const ref = probe.signal_log[0]!.reference_fair_value // the as-of reference fair value (ladder anchor)
    const series: PriceHistoryPoint[] = [
      priceAt('2019-03-31', ref * 0.5), // deep discount → implied growth well below demonstrated → BUY
      priceAt('2019-05-31', ref * 4), // rich → implied growth above demonstrated → WATCH
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
    expect(result.signal_log.map((e) => e.signal)).toEqual(['BUY', 'WATCH'])
    // The signal fields are implied_growth + reference_fair_value (no band/gap fields any more).
    expect(typeof result.signal_log[0]!.implied_growth).toBe('number')
    expect(result.signal_log[0]!.reference_fair_value).toBeGreaterThan(0)
    // The BUY month's implied growth sits a clear sanity margin below the demonstrated (uncapped) growth —
    // the basis the BUY signal actually compares against (re-pointed from credited_g, which only feeds FV).
    expect(result.signal_log[0]!.implied_growth).toBeLessThan(result.signal_log[0]!.demonstrated_growth)
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
    const buy = probe.signal_log[0]!.reference_fair_value
    const low = buy * 0.5
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
    const buy = probe.signal_log[0]!.reference_fair_value
    const result = runValuationBacktest({
      ticker: 'FIX',
      moat_class: 'moderate',
      runway: 'proven',
      fundamentals,
      price_series: [priceAt('2019-03-31', buy * 0.1)], // far below the reference fair value
      strategy: buffettMungerStrategy,
      params: VALUATION_PARAMS,
    })
    expect(result.signal_log[0]!.signal).toBe('PASS')
    expect(result.summary.buy_months).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// classify — the crux: the BUY threshold compares implied growth against the UNCAPPED demonstrated growth,
// NOT credited_g (capped at single_growth_cap=0.15). The old capped basis collapsed the BUY threshold for
// every quality compounder so no real dislocation could fire — the bug this guards both directions of.
// ---------------------------------------------------------------------------
describe('classify — implied-vs-DEMONSTRATED (uncapped) growth, both directions', () => {
  it('fires BUY when the market prices materially less growth than demonstrated (real dislocation)', () => {
    // demonstrated 25%, market implies 16% → 16 ≤ 25−3 = 22 → BUY. Under the OLD capped logic the basis
    // was credited_g=0.15 → threshold 0.12, so 0.16 was WATCH — that was the suppressed-compounder bug.
    expect(classify(0.16, 0.25, false)).toBe('BUY')
  })

  it('does NOT BUY a fairly-priced compounder (no blanket-BUY / over-fire)', () => {
    // demonstrated 25%, market implies ~the full 24% → 24 > 22 → WATCH (fairly priced).
    expect(classify(0.24, 0.25, false)).toBe('WATCH')
  })

  it('gated names never BUY even when cheap (record PASS)', () => {
    expect(classify(0.16, 0.25, true)).toBe('PASS')
  })

  it('low-growth (≤ cap) parity: identical behaviour to before (credited==demonstrated)', () => {
    // 5% ≤ 10−3 = 7 → BUY; demonstrated 10% is under the 15% cap, so credited_g would equal demonstrated_g
    // and the fix is a no-op for this class.
    expect(classify(0.05, 0.10, false)).toBe('BUY')
  })
})

// ---------------------------------------------------------------------------
// Integration: a HIGH-demonstrated-growth (>15%) compounder. credited_g caps at 0.15 but demonstrated_growth
// is ~0.20+, so a real dislocation month fires BUY off the uncapped basis (it would have been WATCH off the
// capped credited_g — the bug). A richly-priced month stays WATCH (no over-fire).
// ---------------------------------------------------------------------------
describe('runValuationBacktest — high-demonstrated-growth compounder fires BUY at a dislocation', () => {
  // OE/share compounds ~22%/yr (NI grows 22%, shares/D&A/capex/SBC flat) → demonstrated_growth ~0.22,
  // well above the 0.15 single_growth_cap so credited_g caps and the two bases diverge.
  function fastCompounder(): Fundamentals {
    const series: AnnualFacts[] = []
    for (let i = 6; i >= 0; i -= 1) {
      const fy = 2018 + i
      const ni = Math.round(120 * Math.pow(1.22, i))
      series.push({
        fiscal_year: fy, currency: 'USD', filed: `${fy + 1}-02-15`, period_end: `${fy}-12-31`,
        net_income_musd: ni, revenue_musd: 600, d_and_a_musd: 40, capex_musd: 30, sbc_musd: 20,
        diluted_shares_m: 100, stockholders_equity_musd: 400 + i * 50, total_debt_musd: 0,
        cash_and_securities_musd: 0, operating_income_musd: ni + 30, income_tax_expense_musd: 30,
      })
    }
    return { cik: '0000000003', entity_name: 'FastCo', currency: 'USD', latest_annual: series[0]!, annual_series: series, filings: [] }
  }

  function signalAt(close: number): SignalLogEntry {
    const r = runValuationBacktest({
      ticker: 'FAST', moat_class: 'wide', runway: 'proven', fundamentals: fastCompounder(),
      price_series: [priceAt('2025-03-31', close)], strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    return r.signal_log[0]!
  }

  it('caps credited_g at the single_growth_cap while demonstrated_growth stays uncapped (>15%)', () => {
    // Pin a mid-range solvable price purely to read the growth fields.
    const e = signalAt(40)
    expect(e.credited_g).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 6)
    expect(e.demonstrated_growth).toBeGreaterThan(0.15)
    expect(e.demonstrated_growth).toBeGreaterThan(e.credited_g)
  })

  it('a deep dislocation fires BUY off the uncapped basis (WATCH under the old capped basis = the bug)', () => {
    // Price empirically chosen (engine is pure+deterministic): implied≈0.194, which sits BELOW
    // demonstrated(0.233)−margin(0.03)=0.203 → BUY, but ABOVE credited_g(0.15)−0.03=0.12 → the old capped
    // comparison would have called this exact month WATCH. This is the suppressed-compounder bug, pinned.
    const e = signalAt(120)
    expect(e.signal).toBe('BUY')
    // The cap bit and the uncapped demonstrated basis is what fired the BUY.
    expect(e.demonstrated_growth).toBeGreaterThan(0.15)
    expect(e.demonstrated_growth).toBeGreaterThan(e.credited_g)
    expect(e.implied_growth).toBeLessThan(e.demonstrated_growth - 0.03)
    // Regression lock: the SAME month would be WATCH compared against credited_g (the capped basis = the bug).
    expect(classify(e.implied_growth, e.credited_g, false)).toBe('WATCH')
    expect(classify(e.implied_growth, e.demonstrated_growth, false)).toBe('BUY')
  })

  it('a richly-priced month stays WATCH (no blanket-BUY of every compounder)', () => {
    // F.2 — under the lower savings-anchor discount (7.5%, was 10%) a given price implies LESS growth, so the
    // richly-priced probe moves up: at 230 implied≈0.242 ≥ demonstrated(0.233) → richly priced → WATCH
    // (proves no over-fire). (The old 150 price implied ≈0.238 at the 10% discount; at 7.5% it implies
    // ≈0.162 — a genuine dislocation — so 150 now correctly fires BUY.)
    const e = signalAt(230)
    expect(e.signal).toBe('WATCH')
  })
})

// ---------------------------------------------------------------------------
// Phase 1.6 in the BACKTEST path (1.9 finding): the reference fair value uses the one-knob valuation engine —
// the 18× OE cap is a SURFACED flag, NOT a silent truncation. Previously the backtest called the legacy
// capped scalar, so every quality compounder was silently truncated to 18× and made structurally un-buyable
// (the GOOGL-never-buyable pathology, reproduced on CPRT/FDS at the 1.9 calibration).
// ---------------------------------------------------------------------------
describe('runValuationBacktest — reference fair value (cap is a flag, not a truncation) — Phase 1.6/1.9', () => {
  // A compounder whose OE/share grows ~15%/yr (above GDP) — the two-stage DCF over the wide 10yr horizon
  // exceeds 18× OE, so the legacy path would truncate. NI grows; D&A/capex/SBC/shares flat → OE/share grows.
  function growingFundamentals(): Fundamentals {
    const series: AnnualFacts[] = []
    for (let i = 6; i >= 0; i -= 1) {
      const fy = 2018 + i
      const ni = Math.round(120 * Math.pow(1.15, i)) // ~15%/yr OE growth
      series.push({
        fiscal_year: fy, currency: 'USD', filed: `${fy + 1}-02-15`, period_end: `${fy}-12-31`,
        net_income_musd: ni, revenue_musd: 600, d_and_a_musd: 40, capex_musd: 30, sbc_musd: 20,
        diluted_shares_m: 100, stockholders_equity_musd: 400 + i * 50, total_debt_musd: 0,
        cash_and_securities_musd: 0, operating_income_musd: ni + 30, income_tax_expense_musd: 30,
      })
    }
    return { cik: '0000000002', entity_name: 'Compounder Co', currency: 'USD', latest_annual: series[0]!, annual_series: series, filings: [] }
  }

  it('does NOT silently truncate the reference fair value to 18× OE — records cap_exceeded instead', () => {
    const f = growingFundamentals()
    // A solvable mid-range price (a far-out price falls outside the reverse-DCF bracket → month skipped).
    const result = runValuationBacktest({
      ticker: 'GRW', moat_class: 'wide', runway: 'proven', fundamentals: f,
      price_series: [priceAt('2025-03-31', 30)], strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    const e = result.signal_log[0]!
    // Growth is above GDP and the reference DCF blows past 18× → the cap flag fires and the value is NOT
    // chopped to 18× (implied_multiple = reference fair value / oe_ps, surfaced).
    expect(e.cap_exceeded).toBe(true)
    expect(e.implied_multiple).toBeGreaterThan(18) // would be exactly 18.0 under the legacy truncation
  })

  it('credits an above-GDP demonstrated growth (surfaced for the sanity signal, not a gap widener)', () => {
    const f = growingFundamentals()
    const result = runValuationBacktest({
      ticker: 'GRW', moat_class: 'wide', runway: 'proven', fundamentals: f,
      price_series: [priceAt('2025-03-31', 30)], strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    const e = result.signal_log[0]!
    // The retired required_growth_gap widening is GONE — the demonstrated-growth proxy is simply credited
    // (above GDP here) and surfaced; the BUY/WATCH split is implied-vs-demonstrated growth, no gap config.
    expect(e.credited_g).toBeGreaterThan(VALUATION_PARAMS.gdp_growth_threshold)
  })

  it('still discards an ABSURD (≥100× OE) value as a units-bug guard', () => {
    // Not asserting a specific fixture fires this — just that the guard path exists and is wired (the
    // legacy path had a separate IMPLAUSIBLE_BUY_PRICE guard; the one-knob absurd guard supersedes it).
    expect(VALUATION_PARAMS.fv_absurd_multiple).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Split-consistency fix (B): put as-reported EDGAR shares on TODAY's split-adjusted basis to match the
// split-adjusted price series, and (C) drop a units-artifact (near-zero) share year VISIBLY.
// ---------------------------------------------------------------------------

describe('adjustFundamentalsForSplits (B) — share basis matches the split-adjusted price series', () => {
  // A synthetic GOOGL-shaped series: a 20:1 split lands mid-history. EDGAR reports the PRE-split count
  // (~700M) for years filed before the split and the POST-split count (~13,700M) for years filed after
  // (the restated comparatives). After adjustment to today's basis, every year sits at ~13,700–14,000M.
  function googlLikeFundamentals(): Fundamentals {
    // d_and_a = capex = 0 → maintenance capex 0 → OE = NI exactly (keeps OE_ps = NI/shares as the comments
    // describe). Five years so the as-of-FY2019 series has ≥3 OE/share points for the robust growth measure.
    const mk = (fy: number, filed: string, shares: number): AnnualFacts => ({
      fiscal_year: fy,
      currency: 'USD',
      filed,
      period_end: `${fy}-12-31`,
      net_income_musd: 40000,
      d_and_a_musd: 0,
      capex_musd: 0,
      diluted_shares_m: shares,
    })
    const annual_series: AnnualFacts[] = [
      mk(2020, '2023-02-03', 13700), // filed AFTER the 2022-07 split → already post-split basis
      mk(2019, '2022-02-02', 700), // filed BEFORE the split → pre-split basis (needs ×20)
      mk(2018, '2021-02-03', 700),
      mk(2017, '2020-02-03', 700),
      mk(2016, '2019-02-03', 700),
    ]
    return { cik: '1', entity_name: 'GoogLike', currency: 'USD', latest_annual: annual_series[0]!, annual_series, filings: [] }
  }
  const splits: SplitEvent[] = [{ date: '2022-07-18', factor: 20 }]

  it('multiplies a pre-split filing year by the cumulative factor and leaves post-split years alone', () => {
    const adjusted = adjustFundamentalsForSplits(googlLikeFundamentals(), splits)
    const byFy = new Map(adjusted.annual_series.map((a) => [a.fiscal_year, a]))
    // FY2019 filed pre-split → ×20 → ~14,000M (now on today's split-adjusted basis).
    expect(byFy.get(2019)!.diluted_shares_m).toBeCloseTo(700 * 20, 0)
    expect(byFy.get(2018)!.diluted_shares_m).toBeCloseTo(700 * 20, 0)
    // FY2020 filed post-split → ×1 → unchanged.
    expect(byFy.get(2020)!.diluted_shares_m).toBeCloseTo(13700, 0)
  })

  it('removes the spurious BUY run: OE_ps on the price basis no longer fires below a ~$140 price', () => {
    // Pre-adjustment, FY2019 OE_ps = 40000/700 ≈ $57/sh inflates the buy price ~20× vs a $140 price →
    // spurious BUY. Post-adjustment OE_ps = 40000/14000 ≈ $2.86/sh → buy price well below $140 → no BUY.
    const fundamentals = adjustFundamentalsForSplits(googlLikeFundamentals(), splits)
    const price_series: PriceHistoryPoint[] = [
      { date: '2022-06-30', close: 140 }, // as-of FY2019 (filed 2022-02-02); FY2020 not yet filed
    ]
    const result = runValuationBacktest({
      ticker: 'GOOGL', moat_class: 'wide', runway: 'proven',
      fundamentals, price_series, strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    expect(result.signal_log[0]!.signal).not.toBe('BUY')

    // Control: WITHOUT adjustment the same month DOES fire BUY (the artifact we are removing).
    const unadjusted = runValuationBacktest({
      ticker: 'GOOGL', moat_class: 'wide', runway: 'proven',
      fundamentals: googlLikeFundamentals(), price_series, strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    expect(unadjusted.signal_log[0]!.signal).toBe('BUY')
  })
})

describe('runValuationBacktest sanity guard (C) — drops a near-zero share year visibly', () => {
  // A series where ONE year carries a units-artifact near-zero share count (CPRT fy2012 = 0.13M style):
  // OE_ps explodes → an absurd buy price → BUY every month. The guard must SKIP that filing's months and
  // record a visible note, never emit the artifact BUY.
  function withZeroShareYear(): Fundamentals {
    const mk = (fy: number, filed: string, shares: number): AnnualFacts => ({
      fiscal_year: fy, currency: 'USD', filed, period_end: `${fy}-12-31`,
      net_income_musd: 1000, diluted_shares_m: shares,
      stockholders_equity_musd: 400, operating_income_musd: 1200, income_tax_expense_musd: 250,
    })
    const annual_series: AnnualFacts[] = [
      mk(2013, '2014-02-15', 100),
      mk(2012, '2013-02-15', 0.13), // units artifact: ~1000× too small
      mk(2011, '2012-02-15', 100),
    ]
    return { cik: '1', entity_name: 'ZeroCo', currency: 'USD', latest_annual: annual_series[0]!, annual_series, filings: [] }
  }

  it('skips months whose as-of filing is the artifact year and records a data-quality note', () => {
    // Clean years (FY2011/FY2013): OE_ps = 1000/100 = $10/sh; a high price ($5,000) is far above any buy
    // price → WATCH, no BUY. The artifact year (FY2012, shares 0.13M) at the SAME $5,000 price would,
    // unguarded, value OE_ps ≈ $7,692/sh → an absurd buy price → BUY. The guard must drop it instead.
    const price_series: PriceHistoryPoint[] = [
      { date: '2012-06-30', close: 5000 }, // as-of FY2011 (clean) → WATCH
      { date: '2013-06-30', close: 5000 }, // as-of FY2012 (artifact — must be skipped, NOT a BUY)
      { date: '2014-06-30', close: 5000 }, // as-of FY2013 (clean) → WATCH
    ]
    const result = runValuationBacktest({
      ticker: 'ZERO', moat_class: 'wide', runway: 'proven',
      fundamentals: withZeroShareYear(), price_series, strategy: buffettMungerStrategy, params: VALUATION_PARAMS,
    })
    // The artifact month is skipped (no signal-log entry for the FY2012 as-of month).
    expect(result.signal_log.some((e) => e.filing_fy === 2012)).toBe(false)
    // and a visible per-name note names the dropped year.
    expect(result.data_quality_notes.some((n) => n.includes('2012'))).toBe(true)
    // No artifact BUY survived (the two clean months are WATCH).
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
    demonstrated_growth: 0,
    implied_growth: 0,
    reference_fair_value: buy, // the ladder anchor the deployment sim fills against
    implied_multiple: 1,
    cap_exceeded: false,
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
