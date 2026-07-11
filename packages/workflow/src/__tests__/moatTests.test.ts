import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import { computeMoatTests, MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR } from '../moatTests'

// ---------------------------------------------------------------------------------------------------
// S2 (Phase 3 pillars): the owner's three NAMED moat tests as a pure-T0 module over the EDGAR annual
// series. Owner definitions (locked 2026-07-11):
//   Capital efficiency — ROIC bands: >=15% excellent (likely moat), 10–15% solid, <10% weak.
//   Two-engine — revenue growing AND operating margins improving (holding within a noise dead-band).
//   Standout — gross margin clearly above INDUSTRY PEERS; the peer half is a labeled model judgment
//   (S3), so this module computes ONLY the company side (level/median/trend) — never a peer verdict.
// Each test fails closed independently: a filer missing an input yields { computable: false, reason }
// for THAT test while the others still compute. The block never gates a verdict by itself.
// ---------------------------------------------------------------------------------------------------

/** Build a synthetic annual row. ROIC proxy = operating income (tax 0) / stockholders equity. */
function year(fy: number, f: Partial<AnnualFacts>): AnnualFacts {
  return { fiscal_year: fy, currency: 'USD', ...f }
}

/** N-year series (oldest→newest input, returned newest-first like the EDGAR adapter). */
function series(rows: Array<Partial<AnnualFacts> & { fy: number }>): AnnualFacts[] {
  return rows.map(({ fy, ...f }) => year(fy, f)).sort((a, b) => b.fiscal_year - a.fiscal_year)
}

/** A clean 6-year compounder: revenue growing, margins improving, ROIC ~20%. */
function compounder(): AnnualFacts[] {
  return series([2020, 2021, 2022, 2023, 2024, 2025].map((fy, i) => ({
    fy,
    revenue_musd: 1000 * Math.pow(1.08, i),
    operating_income_musd: 1000 * Math.pow(1.08, i) * (0.25 + 0.01 * i), // margin 25% → 30%
    income_tax_expense_musd: 0,
    stockholders_equity_musd: 1000 * Math.pow(1.08, i) * (0.25 + 0.01 * i) * 5, // ROIC = opinc/equity = 20% every year
    gross_profit_musd: 1000 * Math.pow(1.08, i) * 0.55,
    net_income_musd: 100,
  })))
}

describe('computeMoatTests — capital efficiency (ROIC bands)', () => {
  it('grades ~20% median ROIC as excellent with the window stats recorded', () => {
    const t = computeMoatTests(compounder()).capital_efficiency
    expect(t.computable).toBe(true)
    if (!t.computable) return
    expect(t.band).toBe('excellent')
    expect(t.median_roic).toBeCloseTo(0.2, 2)
    expect(t.latest_roic).toBeCloseTo(0.2, 2)
    expect(t.years_used).toBe(6)
    expect(t.note.length).toBeGreaterThan(0)
  })

  it('grades 10–15% as solid and <10% as weak (band edges: 0.15 → excellent, 0.10 → solid)', () => {
    const at = (roic: number) => series([2020, 2021, 2022, 2023, 2024].map((fy) => ({
      fy, operating_income_musd: roic * 1000, income_tax_expense_musd: 0, stockholders_equity_musd: 1000, revenue_musd: 2000,
    })))
    const grade = (roic: number) => {
      const t = computeMoatTests(at(roic)).capital_efficiency
      return t.computable ? t.band : 'n/a'
    }
    expect(grade(0.15)).toBe('excellent') // >=15% excellent (inclusive)
    expect(grade(0.149)).toBe('solid')
    expect(grade(0.10)).toBe('solid') // >=10% solid (inclusive)
    expect(grade(0.099)).toBe('weak')
  })

  it('fails closed below 5 usable ROIC years while the other tests still compute', () => {
    const s = compounder().map((a, i) => (i < 3 ? a : { ...a, stockholders_equity_musd: undefined as unknown as number }))
    const cleaned = s.map((a) => { const { stockholders_equity_musd, ...rest } = a; return stockholders_equity_musd === undefined ? rest as AnnualFacts : a })
    const r = computeMoatTests(cleaned)
    expect(r.capital_efficiency.computable).toBe(false)
    if (!r.capital_efficiency.computable) expect(r.capital_efficiency.reason).toMatch(/5/)
    expect(r.two_engine.computable).toBe(true) // revenue + operating margin unaffected
    expect(r.standout.computable).toBe(true)
  })
})

describe('computeMoatTests — two-engine (revenue growth + margin trend)', () => {
  it('passes the compounder: revenue engine on (8% CAGR), margin engine on (+100bps/yr)', () => {
    const t = computeMoatTests(compounder()).two_engine
    expect(t.computable).toBe(true)
    if (!t.computable) return
    expect(t.revenue_engine).toBe(true)
    expect(t.margin_engine).toBe(true)
    expect(t.passes).toBe(true)
    expect(t.revenue_cagr).toBeCloseTo(0.08, 2)
    expect(t.margin_trend_bps_per_year).toBeCloseTo(100, 0)
  })

  it('flat margins survive the ±dead-band (holding is not a fail); declining beyond it fails the engine', () => {
    const flat = series([2020, 2021, 2022, 2023, 2024].map((fy, i) => ({
      fy, revenue_musd: 1000 * Math.pow(1.05, i), operating_income_musd: 1000 * Math.pow(1.05, i) * 0.30,
    })))
    const tFlat = computeMoatTests(flat).two_engine
    expect(tFlat.computable && tFlat.margin_engine).toBe(true)
    expect(tFlat.computable && tFlat.passes).toBe(true)

    const declining = series([2020, 2021, 2022, 2023, 2024].map((fy, i) => ({
      fy, revenue_musd: 1000 * Math.pow(1.05, i), operating_income_musd: 1000 * Math.pow(1.05, i) * (0.30 - 0.01 * i), // −100bps/yr
    })))
    const tDecl = computeMoatTests(declining).two_engine
    expect(tDecl.computable && tDecl.margin_engine).toBe(false)
    expect(tDecl.computable && tDecl.passes).toBe(false)
    expect(MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR).toBe(25) // pinned constant (owner sanity-checked)
  })

  it('shrinking revenue fails the revenue engine even with improving margins', () => {
    const shrink = series([2020, 2021, 2022, 2023, 2024].map((fy, i) => ({
      fy, revenue_musd: 1000 * Math.pow(0.97, i), operating_income_musd: 1000 * Math.pow(0.97, i) * (0.25 + 0.01 * i),
    })))
    const t = computeMoatTests(shrink).two_engine
    expect(t.computable && t.revenue_engine).toBe(false)
    expect(t.computable && t.passes).toBe(false)
  })

  it('fails closed below 5 usable margin years', () => {
    const t = computeMoatTests(series([{ fy: 2024, revenue_musd: 100, operating_income_musd: 20 }, { fy: 2025, revenue_musd: 110, operating_income_musd: 23 }])).two_engine
    expect(t.computable).toBe(false)
  })
})

describe('computeMoatTests — standout (company-side gross margin only)', () => {
  it('records latest/median/trend of the gross-margin series with the gross_margin basis', () => {
    const t = computeMoatTests(compounder()).standout
    expect(t.computable).toBe(true)
    if (!t.computable) return
    expect(t.basis).toBe('gross_margin')
    expect(t.gross_margin_latest).toBeCloseTo(0.55, 3)
    expect(t.gross_margin_median).toBeCloseTo(0.55, 3)
    expect(Math.abs(t.gross_margin_trend_bps_per_year)).toBeLessThan(1)
    // The company side NEVER asserts a peer verdict — that is the S3 labeled model judgment.
    expect(t.note).toMatch(/peer/i)
  })

  it('fails closed when the filer does not tag gross profit (and the others still compute)', () => {
    const noGp = compounder().map((a) => { const { gross_profit_musd: _gp, ...rest } = a; return rest as AnnualFacts })
    const r = computeMoatTests(noGp)
    expect(r.standout.computable).toBe(false)
    if (!r.standout.computable) expect(r.standout.reason).toMatch(/gross profit/i)
    expect(r.capital_efficiency.computable).toBe(true)
    expect(r.two_engine.computable).toBe(true)
  })
})
