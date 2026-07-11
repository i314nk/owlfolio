import { describe, expect, it } from 'vitest'

import { screenCheapness } from '../cheapnessScreen'
import { fcfPerShareSeries, type AnnualFacts, type Fundamentals } from '../secEdgar'

/**
 * Fixture builder: a single-year fundamentals payload whose latest annual carries meaningful SBC and a
 * distinct CFO so a NAIVE NI-based cash proxy would differ materially from the book FCF
 * (CFO − capex). This lets the
 * no-drift test prove the screen reads the Phase-1 series rather than recomputing a shortcut.
 */
function makeFundamentals(overrides?: Partial<AnnualFacts>, omit?: (keyof AnnualFacts)[]): Fundamentals {
  const latest: AnnualFacts = {
    fiscal_year: 2024,
    currency: 'USD',
    net_income_musd: 1000,
    d_and_a_musd: 200,
    capex_musd: 300,
    cfo_musd: 1200, // E2: FCF = 1200 − 300 = 900
    sbc_musd: 150, // meaningful SBC, subtracted by Phase-1 OE
    diluted_shares_m: 100,
    total_debt_musd: 500,
    cash_and_securities_musd: 200,
    ...overrides,
  }
  for (const key of omit ?? []) delete latest[key]
  return {
    cik: '0000000001',
    entity_name: 'Test Co',
    currency: 'USD',
    latest_annual: latest,
    annual_series: [latest],
    filings: [],
  }
}

describe('screenCheapness', () => {
  // E2: the book FCF = CFO 1200 − capex 300 = 900 musd (no proxy, no SBC assumptions).
  const BOOK_FCF_MUSD = 900

  it('surfaces a gate-passing cheap name', () => {
    const fundamentals = makeFundamentals()
    // EV = market_cap + debt − cash = 10,000 + 500 − 200 = 10,300; yield = 900/10,300 ≈ 0.0874 ≥ 1/20.
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 10_000,
      gate_passing: true,
    })
    expect(result.surfaced).toBe(true)
    expect(result.cheap).toBe(true)
    expect(result.fcf_musd).toBe(BOOK_FCF_MUSD)
    expect(result.ev_musd).toBe(10_300)
    expect(result.fcf_yield).toBeCloseTo(900 / 10_300, 6)
  })

  it('does NOT surface a cheap-but-not-gate-passing name (cheapness alone is not the signal)', () => {
    const fundamentals = makeFundamentals()
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 10_000,
      gate_passing: false,
    })
    expect(result.cheap).toBe(true) // still cheap, transparently
    expect(result.surfaced).toBe(false) // but not surfaced — fails the gate
  })

  it('does NOT surface a gate-passing but expensive name', () => {
    const fundamentals = makeFundamentals()
    // Big market cap ⇒ tiny yield ⇒ not cheap. EV ≈ 50,300; yield = 900/50,300 ≈ 0.0179 < 1/20.
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 50_000,
      gate_passing: true,
    })
    expect(result.cheap).toBe(false)
    expect(result.surfaced).toBe(false)
  })

  it('uses the Phase-1 normalized OE (no-drift discipline gate, not a shortcut)', () => {
    const fundamentals = makeFundamentals()
    const bookSeries = fcfPerShareSeries(fundamentals.annual_series)
    const bookLatest = bookSeries[bookSeries.length - 1]!
    const dilutedShares = fundamentals.latest_annual.diluted_shares_m!
    const bookFcfMusd = bookLatest.oe_ps * dilutedShares

    // A naive NI-based cash proxy (NI + D&A) would be (1000+200) = 1,200 musd — different from CFO − capex.
    const naiveMusd = 1000 + 200
    expect(bookFcfMusd).not.toBe(naiveMusd)

    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 1_000_000,
      gate_passing: true,
    })
    expect(result.fcf_musd).toBe(bookFcfMusd)
    expect(result.fcf_musd).not.toBe(naiveMusd)
  })

  it('fails closed when FCF ≤ 0', () => {
    const fundamentals = makeFundamentals({ cfo_musd: 100 }) // FCF = 100 − 300 = −200
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 1_000_000,
      gate_passing: true,
    })
    expect(result.surfaced).toBe(false)
    expect(result.cheap).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('fails closed when EV ≤ 0', () => {
    const fundamentals = makeFundamentals({ total_debt_musd: 0, cash_and_securities_musd: 10_000 })
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 5_000, // EV = 5,000 + 0 − 10,000 = −5,000 ≤ 0
      gate_passing: true,
    })
    expect(result.surfaced).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('fails closed when the OE series has no usable point (missing inputs)', () => {
    const fundamentals = makeFundamentals(undefined, ['diluted_shares_m'])
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 1_000_000,
      gate_passing: true,
    })
    expect(result.surfaced).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('does not throw on fully missing inputs', () => {
    const fundamentals = makeFundamentals(undefined, [
      'net_income_musd',
      'd_and_a_musd',
      'capex_musd',
      'diluted_shares_m',
    ])
    expect(() =>
      screenCheapness({ fundamentals, market_cap_musd: 1_000_000, gate_passing: true }),
    ).not.toThrow()
  })
})
