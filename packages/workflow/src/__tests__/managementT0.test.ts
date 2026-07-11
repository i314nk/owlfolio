import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import { buildManagementTalentBlock, computeManagementTalentT0 } from '../managementT0'

// S5 (Phase 3 pillars): the owner's three TALENT criteria as a deterministic observation block —
// ROIC, dividends & buybacks discipline, debt management — injected into the management lane
// (the model reconciles; it never re-derives). Each sub-block fails closed independently.

function year(fy: number, f: Partial<AnnualFacts>): AnnualFacts {
  return { fiscal_year: fy, currency: 'USD', ...f }
}

function goodSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 6; i += 1) {
    out.push(year(2025 - i, {
      net_income_musd: 1000,
      revenue_musd: 5000,
      operating_income_musd: 1300,
      income_tax_expense_musd: 0,
      stockholders_equity_musd: 6500, // IC = 6500+1000−1500 = 6000 → ROIC ≈ 21.7%
      dividends_paid_musd: 300,
      buybacks_musd: 400,
      sbc_musd: 250,
      total_debt_musd: 1000,
      cash_and_securities_musd: 1500,
      interest_expense_musd: 50,
    }))
  }
  return out
}

describe('computeManagementTalentT0', () => {
  it('computes all three sub-blocks on a clean series', () => {
    const t0 = computeManagementTalentT0(goodSeries())
    expect(t0.roic.computable && t0.roic.band).toBe('excellent')
    expect(t0.roic.computable && t0.roic.median_roic).toBeCloseTo(0.21667, 3) // 1300/(6500+1000−1500)
    if (!t0.payout.computable) throw new Error('payout should compute')
    expect(t0.payout.dividend_paying_years).toBe(6)
    expect(t0.payout.buyback_years).toBe(6)
    expect(t0.payout.payout_ratio_latest).toBeCloseTo(0.7, 3) // (300+400)/1000
    expect(t0.payout.buybacks_below_sbc).toBe(false)
    if (!t0.debt.computable) throw new Error('debt should compute')
    expect(t0.debt.net_debt_musd).toBe(-500)
    expect(t0.debt.interest_coverage).toBeCloseTo(26, 0)
  })

  it('flags buybacks that only mop up SBC dilution', () => {
    const s = goodSeries().map((a) => ({ ...a, buybacks_musd: 100, sbc_musd: 250 }))
    const t0 = computeManagementTalentT0(s)
    expect(t0.payout.computable && t0.payout.buybacks_below_sbc).toBe(true)
  })

  it('fails each sub-block closed independently', () => {
    const bare = [2021, 2022, 2023, 2024, 2025].map((fy) => year(fy, { net_income_musd: 100 }))
    const t0 = computeManagementTalentT0(bare)
    expect(t0.roic.computable).toBe(false)
    expect(t0.payout.computable).toBe(true) // NI exists; zero tagged payouts = zero paying years
    expect(t0.payout.computable && t0.payout.dividend_paying_years).toBe(0)
    expect(t0.debt.computable).toBe(false)
  })
})

describe('buildManagementTalentBlock', () => {
  it('renders the reconcile-contract block with all three criteria + the retained-earnings line', () => {
    const block = buildManagementTalentBlock(computeManagementTalentT0(goodSeries()), {
      computable: true, passes: true, ratio: 1.8, retained_per_share: 10, price_change_per_share: 18,
      anchor_fiscal_year: 2019, anchor_close: 100, latest_close: 118, years_used: 5,
      note: '$1 retained → $1.80 of market value: retained $10.00/sh over FY2020–FY2024; the share price moved $100.00 → $118.00 from the FY2019 anchor.',
    })
    expect(block).toMatch(/reconcile with these/i)
    expect(block).toMatch(/ROIC: median 21\.7%/)
    expect(block).toMatch(/dividends paid in 6\/6/)
    expect(block).toMatch(/interest coverage 26×/)
    expect(block).toMatch(/Retained-earnings test \(Buffett\): PASSES/)
  })

  it('renders honest not-computable lines (never fabricated numbers)', () => {
    const block = buildManagementTalentBlock(
      computeManagementTalentT0([year(2025, {})]),
      { computable: false, reason: 'price history unavailable: fetch failed' },
    )
    expect(block).toMatch(/ROIC: not computable/)
    expect(block).toMatch(/deferred on data/i)
  })
})

// B4 (book alignment): the two NAMED debt ratios — debt-to-equity (<1 conservative / >2 warning)
// and the current ratio (≥2 healthy / ≥1 ok / <1 red flag) — rendered with the book's bands.
describe('B4 — debt-to-equity + current ratio', () => {
  it('computes both ratios and renders the book bands in the block', () => {
    const s = goodSeries().map((a) => ({ ...a, current_assets_musd: 900, current_liabilities_musd: 400 }))
    const t0 = computeManagementTalentT0(s)
    if (!t0.debt.computable) throw new Error('debt should compute')
    expect(t0.debt.debt_to_equity).toBeCloseTo(1000 / 6500, 4)
    expect(t0.debt.current_ratio).toBeCloseTo(2.25, 4)
    const block = buildManagementTalentBlock(t0)
    expect(block).toMatch(/debt\/equity 0\.15 \(conservative <1\)/)
    expect(block).toMatch(/current ratio 2\.25 \(healthy ≥2\)/)
  })

  it('renders the red-flag band and omits D/E on negative equity (never a misleading negative ratio)', () => {
    const s = goodSeries().map((a) => ({ ...a, stockholders_equity_musd: -500, current_assets_musd: 300, current_liabilities_musd: 400 }))
    const t0 = computeManagementTalentT0(s)
    if (!t0.debt.computable) throw new Error('debt should compute')
    expect(t0.debt.debt_to_equity).toBeUndefined()
    expect(t0.debt.current_ratio).toBeCloseTo(0.75, 4)
    expect(buildManagementTalentBlock(t0)).toMatch(/RED FLAG <1/)
  })
})
