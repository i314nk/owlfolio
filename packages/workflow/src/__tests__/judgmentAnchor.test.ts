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

describe('computeMoatAnchor — mechanical anchor from computable rows (M1, M2)', () => {
  it('high-ROIC + tight-margin series -> M1=2, M2=2, anchor sub-score 4 -> MODERATE anchor (capped)', () => {
    const anchor = computeMoatAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['M1']).toBe(2)
    expect(anchor.row_scores['M2']).toBe(2)
    expect(anchor.sub_score).toBe(4)
    // SUBSTITUTION BOUNDARY: a perfect computable sub-score (4/4) anchors at MODERATE, NOT wide. The quant
    // corroborates but cannot SUBSTITUTE for a grounded qualitative moat thesis — wide/monopoly are
    // reachable only when the cite-verified qualitative rows (M3-M6) lift the grounded-row-sum. (Was 'wide'
    // — that asserted the hole: the moat gate passing on EDGAR quant alone.)
    expect(anchor.anchor_tier).toBe('moderate')
  })

  it('low-ROIC + swinging-margin series -> M1=0, M2=0, anchor sub-score 0 -> narrow anchor', () => {
    const anchor = computeMoatAnchor(lowRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['M1']).toBe(0)
    expect(anchor.row_scores['M2']).toBe(0)
    expect(anchor.sub_score).toBe(0)
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
