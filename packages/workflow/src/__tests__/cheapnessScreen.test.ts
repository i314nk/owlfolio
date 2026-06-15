import { describe, expect, it } from 'vitest'

import { screenCheapness } from '../cheapnessScreen'
import { ownerEarningsPerShareSeries, type AnnualFacts, type Fundamentals } from '../secEdgar'

/**
 * Fixture builder: a single-year fundamentals payload whose latest annual carries meaningful SBC and a
 * maintenance-capex haircut (capex > D&A) so a NAIVE NI-based "owner earnings" (e.g. NI + D&A) would
 * differ materially from the Phase-1 normalized OE (NI + D&A − min(D&A,capex) − SBC). This lets the
 * no-drift test prove the screen reads the Phase-1 series rather than recomputing a shortcut.
 */
function makeFundamentals(overrides?: Partial<AnnualFacts>, omit?: (keyof AnnualFacts)[]): Fundamentals {
  const latest: AnnualFacts = {
    fiscal_year: 2024,
    currency: 'USD',
    net_income_musd: 1000,
    d_and_a_musd: 200,
    capex_musd: 300, // capex > D&A ⇒ maintenance capex = min(200,300) = 200
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
  // Phase-1 normalized OE/share = (1000 + 200 − min(200,300) − 150) / 100 = 850/100 = 8.5
  // → total normalized OE = 8.5 × 100 shares = 850 musd.
  const PHASE1_OE_MUSD = 850

  it('surfaces a gate-passing cheap name', () => {
    const fundamentals = makeFundamentals()
    // EV = market_cap + debt − cash = 10,000 + 500 − 200 = 10,300; yield = 850/10,300 ≈ 0.0825 ≥ 1/18.
    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 10_000,
      gate_passing: true,
    })
    expect(result.surfaced).toBe(true)
    expect(result.cheap).toBe(true)
    expect(result.owner_earnings_musd).toBe(PHASE1_OE_MUSD)
    expect(result.ev_musd).toBe(10_300)
    expect(result.owner_earnings_yield).toBeCloseTo(850 / 10_300, 6)
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
    // Big market cap ⇒ tiny yield ⇒ not cheap. EV ≈ 50,300; yield = 850/50,300 ≈ 0.0169 < 1/18.
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
    const phase1Series = ownerEarningsPerShareSeries(fundamentals.annual_series)
    const phase1Latest = phase1Series[phase1Series.length - 1]!
    const dilutedShares = fundamentals.latest_annual.diluted_shares_m!
    const phase1OeMusd = phase1Latest.oe_ps * dilutedShares

    // A naive NI+D&A OE (no maint-capex haircut, no SBC) would be (1000+200)×100 = 120,000 — clearly different.
    const naiveOeMusd = (1000 + 200) * 100
    expect(phase1OeMusd).not.toBe(naiveOeMusd)

    const result = screenCheapness({
      fundamentals,
      market_cap_musd: 1_000_000,
      gate_passing: true,
    })
    expect(result.owner_earnings_musd).toBe(phase1OeMusd)
    expect(result.owner_earnings_musd).not.toBe(naiveOeMusd)
  })

  it('fails closed when OE ≤ 0', () => {
    const fundamentals = makeFundamentals({ net_income_musd: -2000 })
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
