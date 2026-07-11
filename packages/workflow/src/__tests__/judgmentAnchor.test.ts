import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import {
  computeMoatAnchor,
  computeRunwayAnchor,
} from '../judgmentAnchor'

// A 10-year series where ROIC (NOPAT/invested-capital proxy) is comfortably > 15% every year and
// operating margin is held within a tight band. operating_income/equity chosen so each year's
// ROIC = op*(1-0.21)/equity >= 0.15 (op=300, equity=1000 -> 0.237). Margin = op/revenue held ~ 0.30.
function highRoicSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const fy = 2025 - i
    // Newest year (i=0) is the largest; the business grows revenue/op/equity ~10%/yr so invested
    // capital rises (incremental ROIC computable) while ROIC and operating margin stay high + tight.
    const scale = Math.pow(1.10, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30
    const equity = 1000 * scale
    out.push({
      fiscal_year: fy,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: equity,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// A series with low ROIC every year (op tiny vs equity) and a wildly swinging margin.
function lowRoicSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const fy = 2025 - i
    const revenue = 1000
    // operating income oscillates so the margin band blows past +-300bps, ROIC ~ 0.04
    const op = i % 2 === 0 ? 50 : 120
    out.push({
      fiscal_year: fy,
      currency: 'USD',
      net_income_musd: 40,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: Math.round(op * 0.21),
      stockholders_equity_musd: 1000,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// S4 (Phase 3, owner-locked 2026-07-11): the anchor components are the owner's NAMED tests —
// CE (capital efficiency: median-ROIC bands) + TE (two-engine: revenue growth AND margins
// holding/improving) — replacing M1 (years-above-threshold ROIC) + M2 (margin stability band).
// Standout is DISPLAYED with them but NOT scored (its peer half is a labeled model judgment until
// peer-filing grounding ships). The substitution boundary is unchanged: capped at MODERATE.
describe('computeMoatAnchor — the owner\'s named tests as anchor components (CE, TE)', () => {
  it('high-ROIC + growing + FLAT-margin series -> CE=2, TE=1 (B5 strict: flat is not expansion) -> MODERATE anchor', () => {
    const anchor = computeMoatAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['CE']).toBe(2)
    // B5 (book-strict): the fixture's margins are FLAT — the margin engine requires EXPANSION, so TE=1
    // (revenue engine only). CE=2 alone still clears the moderate bar (a stable-margin compounder is
    // not anchor-punished).
    expect(anchor.row_scores['TE']).toBe(1)
    expect(anchor.sub_score).toBe(3)
    // SUBSTITUTION BOUNDARY: a perfect computable sub-score (4/4) anchors at MODERATE, NOT wide. The quant
    // corroborates but cannot SUBSTITUTE for a grounded qualitative moat thesis.
    expect(anchor.anchor_tier).toBe('moderate')
    // The note names the owner's tests and records that standout is displayed, not scored.
    expect(anchor.note).toMatch(/capital[- ]efficiency/i)
    expect(anchor.note).toMatch(/two[- ]engine/i)
    expect(anchor.note).toMatch(/standout/i)
  })

  it('low-ROIC + flat-revenue swinging-margin series -> CE=0, weak sub-score -> narrow anchor', () => {
    const anchor = computeMoatAnchor(lowRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['CE']).toBe(0)
    expect(anchor.anchor_tier).toBe('narrow')
  })

  it('fails closed to not-computable when the series is too short', () => {
    const anchor = computeMoatAnchor(highRoicSeries().slice(0, 1))
    expect(anchor.computable).toBe(false)
  })

  it('fails closed to not-computable on an empty series', () => {
    const anchor = computeMoatAnchor([])
    expect(anchor.computable).toBe(false)
  })

  // ---- BEHAVIOR DIFF vs the retired M1/M2 anchor (the owner-facing recomposition evidence) ----
  // Divergence 1 (more conservative): a weak-ROIC business whose margins are TIGHT but DECLINING
  // beyond the dead-band. Old: M1=0, M2=2 (band 250bps <= 300) -> sub 2 -> MODERATE. New: CE=0 (weak),
  // TE=1 (revenue engine only; margin engine fails at −27bps/yr) -> sub 1 -> NARROW.
  it('DIFF: weak ROIC + tight-but-declining margins anchors NARROW (was moderate under M1/M2)', () => {
    const out: AnnualFacts[] = []
    for (let i = 0; i < 10; i += 1) {
      const chron = 9 - i // 0 oldest → 9 newest
      const revenue = 1000 * Math.pow(1.05, chron)
      const margin = 0.30 - 0.0027 * chron // −27bps/yr, total band 243bps (would pass old M2)
      out.push({
        fiscal_year: 2025 - i, currency: 'USD',
        revenue_musd: revenue, operating_income_musd: revenue * margin,
        income_tax_expense_musd: revenue * margin * 0.21,
        net_income_musd: revenue * margin * 0.79,
        stockholders_equity_musd: revenue * 4, // ROIC = margin*0.79/4 ≈ 5.8% — weak
        total_debt_musd: 0, cash_and_securities_musd: 0,
      })
    }
    const anchor = computeMoatAnchor(out)
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['CE']).toBe(0)
    expect(anchor.row_scores['TE']).toBe(1)
    expect(anchor.anchor_tier).toBe('narrow')
  })

  // Divergence 2 (less punitive on one bad year): a high-median-ROIC compounder with 7/10 years above
  // 15%. Old M1 gave partial credit (1); the median-band CE grades the WHOLE window excellent (2).
  it('DIFF: 7/10 years above 15% but an excellent median grades CE=2 (was M1=1 partial credit)', () => {
    const out: AnnualFacts[] = []
    for (let i = 0; i < 10; i += 1) {
      const chron = 9 - i
      const revenue = 1000 * Math.pow(1.06, chron)
      // Three early years dip (ROIC ~12%); seven years run ~20% — median lands ~20%.
      const roicTarget = chron < 3 ? 0.12 : 0.20
      const op = revenue * 0.30
      out.push({
        fiscal_year: 2025 - i, currency: 'USD',
        revenue_musd: revenue, operating_income_musd: op,
        income_tax_expense_musd: 0,
        net_income_musd: op,
        stockholders_equity_musd: op / roicTarget,
        total_debt_musd: 0, cash_and_securities_musd: 0,
      })
    }
    const anchor = computeMoatAnchor(out)
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['CE']).toBe(2)
    expect(anchor.anchor_tier).toBe('moderate')
  })
})

describe('computeRunwayAnchor — R1 from incremental ROIC', () => {
  it('high incremental ROIC -> R1=2, proven-leaning anchor', () => {
    const anchor = computeRunwayAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['R1']).toBe(2)
  })

  it('fails closed when incremental ROIC is not computable', () => {
    const anchor = computeRunwayAnchor([])
    expect(anchor.computable).toBe(false)
  })
})

// S1 (Phase 3 pillars): the per-year ratio helpers are exported so the moat tests (S2) and the
// management talent block (S5) reuse the SAME arithmetic the anchor uses (one source of truth).
describe('S1 — exported per-year ratio helpers', () => {
  it('yearGrossMargin = gross_profit / revenue; undefined when either side is missing or revenue ≤ 0', async () => {
    const { yearGrossMargin } = await import('../judgmentAnchor')
    expect(yearGrossMargin({ fiscal_year: 2025, currency: 'USD', revenue_musd: 1000, gross_profit_musd: 420 })).toBeCloseTo(0.42, 6)
    expect(yearGrossMargin({ fiscal_year: 2025, currency: 'USD', revenue_musd: 1000 })).toBeUndefined()
    expect(yearGrossMargin({ fiscal_year: 2025, currency: 'USD', gross_profit_musd: 420 })).toBeUndefined()
    expect(yearGrossMargin({ fiscal_year: 2025, currency: 'USD', revenue_musd: 0, gross_profit_musd: 1 })).toBeUndefined()
  })
  it('yearRoic and yearOperatingMargin are exported (S2 reuses the anchor arithmetic)', async () => {
    const mod = await import('../judgmentAnchor')
    expect(typeof mod.yearRoic).toBe('function')
    expect(typeof mod.yearOperatingMargin).toBe('function')
  })
})

// B1 (Phase 4): yearFcf — the book's free cash flow (CFO − capex), shared arithmetic.
describe('B1 — yearFcf', () => {
  it('FCF = CFO − capex; undefined when either side is missing', async () => {
    const { yearFcf } = await import('../annualRatios')
    expect(yearFcf({ fiscal_year: 2025, currency: 'USD', cfo_musd: 180, capex_musd: 40 })).toBeCloseTo(140, 6)
    expect(yearFcf({ fiscal_year: 2025, currency: 'USD', cfo_musd: 180 })).toBeUndefined()
    expect(yearFcf({ fiscal_year: 2025, currency: 'USD', capex_musd: 40 })).toBeUndefined()
  })
})
