import { describe, it, expect } from 'vitest'

import { ownerEarningsPerShareSeries } from '../secEdgar'
import type { AnnualFacts } from '../secEdgar'

// Buffett-Munger gap-closing Phase 1.1: per-year owner-earnings-per-share series.
// OE/share = (net income + D&A − maintenance capex − SBC) / diluted shares, with maintenance capex as
// the simple-floor proxy min(D&A, capex) for THIS series (the Greenwald proxy is Phase 1.2). D-SBC: SBC
// is subtracted and shares are the CURRENT diluted count, held flat per year (no forward dilution) —
// avoiding the double-count.
const yr = (fiscal_year: number, o: Partial<AnnualFacts>): AnnualFacts => ({ fiscal_year, currency: 'USD', ...o })

describe('ownerEarningsPerShareSeries', () => {
  it('computes (NI + D&A − min(D&A,capex) − SBC)/diluted_shares per year', () => {
    const out = ownerEarningsPerShareSeries([
      // 2024: maint = min(200,150)=150 → OE = 1000+200−150−50 = 1000 → /100 = 10.0
      yr(2024, { net_income_musd: 1000, d_and_a_musd: 200, capex_musd: 150, sbc_musd: 50, diluted_shares_m: 100 }),
      // 2025: maint = min(220,400)=220 → OE = 1200+220−220−60 = 1140 → /100 = 11.4
      yr(2025, { net_income_musd: 1200, d_and_a_musd: 220, capex_musd: 400, sbc_musd: 60, diluted_shares_m: 100 }),
    ])
    expect(out.map((r) => r.fiscal_year)).toEqual([2024, 2025])
    expect(out[0]!.oe_ps).toBeCloseTo(10.0, 6)
    expect(out[1]!.oe_ps).toBeCloseTo(11.4, 6)
  })

  it('treats missing SBC as zero', () => {
    const out = ownerEarningsPerShareSeries([
      yr(2025, { net_income_musd: 500, d_and_a_musd: 100, capex_musd: 100, diluted_shares_m: 50 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.oe_ps).toBeCloseTo(10, 6) // (500+100−100−0)/50
  })

  it('skips a year missing a required field or with non-positive shares (fail-closed)', () => {
    const out = ownerEarningsPerShareSeries([
      yr(2023, { net_income_musd: 100, d_and_a_musd: 10, capex_musd: 10, diluted_shares_m: 0 }), // shares 0 → skip
      yr(2024, { net_income_musd: 100, capex_musd: 10, diluted_shares_m: 10 }), // missing D&A → skip
      yr(2025, { net_income_musd: 100, d_and_a_musd: 10, capex_musd: 10, diluted_shares_m: 10 }), // ok → (100+10−10−0)/10
    ])
    expect(out.map((r) => r.fiscal_year)).toEqual([2025])
    expect(out[0]!.oe_ps).toBeCloseTo(10, 6)
  })
})
