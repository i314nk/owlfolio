import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  demonstratedOwnerEarningsGrowth,
  ownerEarningsPerShareSeries,
  type AnnualFacts,
} from '../secEdgar'

// ---------------------------------------------------------------------------------------------------
// Part-D valuation CONFORMANCE guardrail (workflow side).
//
// Sibling to packages/strategies/src/__tests__/partDConformance.test.ts. This file guards the two
// Part-D steps whose mechanics live in workflow:
//   Step 1 — owner-earnings-per-share formula (secEdgar.ts), and
//   Step 2 — the robust demonstrated-growth measure used by the live swarm (the legacy calibration backtest
//            that once mirrored this measure was removed as dead, closed-loop code).
// Each assertion names the Part-D step it guards. Fixtures are synthetic + deterministic (no network).
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..')

const yr = (fiscal_year: number, o: Partial<AnnualFacts>): AnnualFacts =>
  ({ fiscal_year, currency: 'USD', ...o })

describe('Part-D conformance: Step 1 — owner earnings = NI + D&A − min(D&A,capex) − SBC, flat shares', () => {
  it('oe_ps = (NI + D&A − min(D&A,capex) − SBC) / diluted_shares for a synthetic year', () => {
    // Part D Step 1: owner earnings = net income + D&A − maintenance capex (simple-floor proxy
    // min(D&A,capex) here) − SBC, after-tax/after-D&A. EBITDA is banned.
    const ni = 1000, da = 200, capex = 350, sbc = 60, shares = 100
    const expected = (ni + da - Math.min(da, capex) - sbc) / shares // = (1000+200−200−60)/100 = 9.4
    const out = ownerEarningsPerShareSeries([
      yr(2024, { net_income_musd: ni, d_and_a_musd: da, capex_musd: capex, sbc_musd: sbc, diluted_shares_m: shares }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.oe_ps).toBeCloseTo(expected, 9)
  })

  it('SBC is SUBTRACTED from owner earnings (raising SBC lowers oe_ps by exactly ΔSBC/shares)', () => {
    // Part D Step 1: stock-based comp is a real owner cost and must be subtracted once (the D-SBC rule).
    const common = { net_income_musd: 1000, d_and_a_musd: 200, capex_musd: 350, diluted_shares_m: 100 }
    const noSbc = ownerEarningsPerShareSeries([yr(2024, { ...common, sbc_musd: 0 })])[0]!.oe_ps
    const withSbc = ownerEarningsPerShareSeries([yr(2024, { ...common, sbc_musd: 80 })])[0]!.oe_ps
    expect(noSbc - withSbc).toBeCloseTo(80 / 100, 9) // exactly ΔSBC / shares
  })

  it('uses the per-year diluted count and does NOT grow the share count forward (flat shares)', () => {
    // Part D Step 1: shares are the year's CURRENT diluted count held flat — no forward dilution projected,
    // so the dilution cost is counted once via SBC, never compounded into a growing share base.
    // Two identical years differing ONLY by their own diluted_shares_m must each divide by their own count;
    // year 2's oe_ps must reflect year 2's shares, not a forward-projected/blended base.
    const out = ownerEarningsPerShareSeries([
      yr(2024, { net_income_musd: 600, d_and_a_musd: 100, capex_musd: 100, sbc_musd: 0, diluted_shares_m: 100 }),
      yr(2025, { net_income_musd: 600, d_and_a_musd: 100, capex_musd: 100, sbc_musd: 0, diluted_shares_m: 120 }),
    ])
    // OE numerator is identical (600) both years; oe_ps differs purely by each year's own share count.
    expect(out[0]!.oe_ps).toBeCloseTo(600 / 100, 9)
    expect(out[1]!.oe_ps).toBeCloseTo(600 / 120, 9)
  })

  it('treats a missing SBC tag as zero (fail-open only on the absent optional field)', () => {
    // Part D Step 1: SBC absent (filer did not tag it) → treated as 0, the rest of the formula still holds.
    const out = ownerEarningsPerShareSeries([
      yr(2025, { net_income_musd: 500, d_and_a_musd: 100, capex_musd: 100, diluted_shares_m: 50 }),
    ])
    expect(out[0]!.oe_ps).toBeCloseTo((500 + 100 - 100 - 0) / 50, 9)
  })
})

describe('Part-D conformance: Step 2 — robust growth measure (fail-closed on a short series)', () => {
  it('demonstratedOwnerEarningsGrowth returns insufficient_data / undefined for a <3-point series', () => {
    // Part D Step 2: the robust log-linear measure needs ≥3 positive OE/share points; fewer → fail-closed
    // (no whipsaw from a single outlier year, and no misleading g=0 valuation off a 2-point stub).
    const twoPoints = [
      yr(2023, { net_income_musd: 600, d_and_a_musd: 100, capex_musd: 100, diluted_shares_m: 100 }),
      yr(2024, { net_income_musd: 700, d_and_a_musd: 100, capex_musd: 100, diluted_shares_m: 100 }),
    ]
    const r = demonstratedOwnerEarningsGrowth(twoPoints)
    expect(r.method).toBe('insufficient_data')
    expect(r.growth).toBeUndefined()
  })

  it('computes a robust positive growth for a clean ≥3-point compounding series', () => {
    // Part D Step 2: with enough positive history the measure yields the demonstrated OE/share CAGR
    // (the honest, falsifiable near-history rate the cap + above-GDP coupling are applied to downstream).
    const series = [2021, 2022, 2023, 2024, 2025].map((fy, i) =>
      yr(fy, { net_income_musd: 600 * Math.pow(1.1, i), d_and_a_musd: 100, capex_musd: 100, diluted_shares_m: 100 }),
    )
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.method).toBe('log_linear_regression')
    expect(r.growth).toBeGreaterThan(0)
  })
})

describe('Part-D conformance: Step 2 — the robust measure is wired in the live swarm', () => {
  // The live growth-measure invariant. These are SOURCE-LEVEL assertions (a grep over the committed source)
  // guarding that the live researchSwarm sources its growth from `demonstratedOwnerEarningsGrowth` and does
  // NOT take the growth path from the endpoint `ownerEarningsCagr` (which a single outlier year can whipsaw).
  // If a future edit reintroduces the endpoint-CAGR growth path, this trips. (The legacy calibration backtest
  // once mirrored this same measure; it was removed as dead code, so only the live path is guarded now.)
  const swarmSrc = readFileSync(join(srcDir, 'researchSwarm.ts'), 'utf8')

  it('researchSwarm.ts sources its growth from demonstratedOwnerEarningsGrowth', () => {
    // Part D Step 2: the LIVE growth path uses the robust measure.
    expect(swarmSrc).toContain('demonstratedOwnerEarningsGrowth')
  })

  it('the swarm does NOT take the growth PATH from the endpoint ownerEarningsCagr', () => {
    // Part D Step 2: the endpoint CAGR is the legacy, outlier-whipsawed measure; it must not be the source
    // of the forward growth path. (Importing/exporting the symbol is fine; CALLING it as the growth source is
    // the regression we guard. We assert the symbol is not invoked in the live file.)
    expect(swarmSrc).not.toMatch(/ownerEarningsCagr\s*\(/)
  })
})
