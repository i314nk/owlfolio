import { describe, it, expect } from 'vitest'

import { estimateMaintenanceCapex, maintenanceCapexLowConfidence, ownerEarningsCagr } from '../secEdgar'
import type { AnnualFacts, OwnerEarningsPerSharePoint } from '../secEdgar'

// Buffett-Munger gap-closing Phase 1.2: dual maintenance-capex proxy.
//   - Greenwald: avg(gross PP&E / sales over the series) × Δsales$  → growth capex; maint = capex − growthCapex
//   - D&A floor: maint ≈ D&A (defensible when the asset base isn't growing in real terms)
//   - Default = the MORE CONSERVATIVE of the two (higher maintenance capex → lower owner earnings).
const yr = (fiscal_year: number, o: Partial<AnnualFacts>): AnnualFacts => ({ fiscal_year, currency: 'USD', ...o })

describe('estimateMaintenanceCapex', () => {
  it('returns the D&A floor when it is the more conservative (higher) proxy', () => {
    // Series with modest sales growth so Greenwald growth-capex is large → Greenwald maint is LOW,
    // while D&A is high → D&A floor wins (more conservative = higher maint capex).
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 800, capex_musd: 300, d_and_a_musd: 250 }),
      yr(2024, { revenue_musd: 1400, gross_ppe_musd: 1120, capex_musd: 300, d_and_a_musd: 250 }),
    ]
    // avg(grossPPE/sales) = avg(0.8, 0.8) = 0.8 ; Δsales = 400 ; growthCapex = 0.8×400 = 320
    // Greenwald maint = capex − growthCapex = 300 − 320 = -20 → floored to 0 → conservative pick = D&A 250
    const r = estimateMaintenanceCapex(series)
    expect(r.basis).toBe('d_and_a_floor')
    expect(r.maintenance_capex).toBeCloseTo(250, 6)
  })

  it('returns the Greenwald proxy when it is the more conservative (higher) proxy', () => {
    // Flat sales → Greenwald growth-capex ≈ 0 → Greenwald maint ≈ full capex (high), D&A low → Greenwald wins.
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
      yr(2024, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
    ]
    // Δsales = 0 → growthCapex = 0 → Greenwald maint = 400 ; D&A floor = 100 → conservative = Greenwald 400
    const r = estimateMaintenanceCapex(series)
    expect(r.basis).toBe('greenwald')
    expect(r.maintenance_capex).toBeCloseTo(400, 6)
  })

  it('falls back to the D&A floor when gross PP&E is unavailable (Greenwald not computable)', () => {
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, capex_musd: 400, d_and_a_musd: 180 }),
      yr(2024, { revenue_musd: 1200, capex_musd: 400, d_and_a_musd: 180 }),
    ]
    const r = estimateMaintenanceCapex(series)
    expect(r.basis).toBe('d_and_a_floor')
    expect(r.maintenance_capex).toBeCloseTo(180, 6)
  })

  it('uses the latest year capex/D&A and the period-wide avg gross-PPE/sales for the Greenwald proxy', () => {
    const series: AnnualFacts[] = [
      yr(2022, { revenue_musd: 800, gross_ppe_musd: 400, capex_musd: 100, d_and_a_musd: 90 }),
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 600, capex_musd: 120, d_and_a_musd: 95 }),
      yr(2024, { revenue_musd: 1100, gross_ppe_musd: 660, capex_musd: 130, d_and_a_musd: 100 }),
    ]
    // avg(grossPPE/sales) = avg(0.5, 0.6, 0.6) = 0.5667 ; latest Δsales = 1100−1000 = 100
    // growthCapex = 0.5667×100 = 56.67 ; Greenwald maint = 130 − 56.67 = 73.33 ; D&A floor = 100
    // conservative (higher) = D&A floor 100
    const r = estimateMaintenanceCapex(series)
    expect(r.basis).toBe('d_and_a_floor')
    expect(r.maintenance_capex).toBeCloseTo(100, 6)
  })

  it('returns not-computable when neither proxy can be derived', () => {
    const series: AnnualFacts[] = [yr(2024, { capex_musd: 100 })]
    const r = estimateMaintenanceCapex(series)
    expect(r.maintenance_capex).toBeUndefined()
    expect(r.basis).toBe('not_computable')
  })

  it('exposes BOTH proxy values + both_computable so dispersion can be measured (review: bite once)', () => {
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
      yr(2024, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
    ]
    const r = estimateMaintenanceCapex(series)
    expect(r.greenwald).toBeCloseTo(400, 6)
    expect(r.d_and_a_floor).toBeCloseTo(100, 6)
    expect(r.both_computable).toBe(true)
  })

  it('both_computable is FALSE when gross PP&E is missing (D&A-floor fallback — a data-availability event)', () => {
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, capex_musd: 400, d_and_a_musd: 180 }),
      yr(2024, { revenue_musd: 1200, capex_musd: 400, d_and_a_musd: 180 }),
    ]
    const r = estimateMaintenanceCapex(series)
    expect(r.both_computable).toBe(false)
    expect(r.greenwald).toBeUndefined()
    expect(r.d_and_a_floor).toBeCloseTo(180, 6)
  })
})

// Review (pre-1.9): maint-capex confidence must "bite once". The D&A-floor fallback (missing PP&E) ALREADY
// made the cash flow conservative; it must NOT also widen the MoS. Confidence-widening keys off genuine
// estimation DISPERSION (both proxies computed but disagree materially), never off the data-availability
// fallback. maintenanceCapexLowConfidence encodes that rule.
describe('maintenanceCapexLowConfidence (bite once — dispersion, not fallback)', () => {
  it('is FALSE when only the D&A floor computed (missing PP&E fallback — already bit the cash flow)', () => {
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, capex_musd: 400, d_and_a_musd: 180 }),
      yr(2024, { revenue_musd: 1200, capex_musd: 400, d_and_a_musd: 180 }),
    ]
    expect(maintenanceCapexLowConfidence(series)).toBe(false)
  })

  it('is FALSE when both proxies computed and AGREE closely', () => {
    // Greenwald ≈ 400, D&A ≈ 380 → ~5% gap, under the dispersion threshold → confident.
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 380 }),
      yr(2024, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 380 }),
    ]
    expect(maintenanceCapexLowConfidence(series)).toBe(false)
  })

  it('is TRUE when both proxies computed but DISAGREE materially (genuine dispersion)', () => {
    // Flat sales → Greenwald ≈ 400 ; D&A floor = 100 → ~75% gap → real estimation dispersion → widen.
    const series: AnnualFacts[] = [
      yr(2023, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
      yr(2024, { revenue_musd: 1000, gross_ppe_musd: 500, capex_musd: 400, d_and_a_musd: 100 }),
    ]
    expect(maintenanceCapexLowConfidence(series)).toBe(true)
  })

  it('is FALSE when neither proxy is computable (no basis to claim dispersion)', () => {
    expect(maintenanceCapexLowConfidence([yr(2024, { capex_musd: 100 })])).toBe(false)
  })
})

// Phase 1.3: demonstrated historical owner-earnings-per-share growth (CAGR), the honest growth-path input.
describe('ownerEarningsCagr', () => {
  const pt = (fiscal_year: number, oe_ps: number): OwnerEarningsPerSharePoint => ({ fiscal_year, oe_ps })

  it('computes the CAGR from the earliest to the latest usable point', () => {
    // 10 → 16.105 over 5 years (6 points) → CAGR = (16.105/10)^(1/5) − 1 ≈ 0.10
    const r = ownerEarningsCagr([
      pt(2019, 10), pt(2020, 11), pt(2021, 12.1), pt(2022, 13.31), pt(2023, 14.641), pt(2024, 16.105),
    ])
    expect(r).toBeCloseTo(0.10, 4)
  })

  it('returns undefined when fewer than two usable points exist', () => {
    expect(ownerEarningsCagr([pt(2024, 10)])).toBeUndefined()
    expect(ownerEarningsCagr([])).toBeUndefined()
  })

  it('returns undefined when the first or last OE/share is non-positive (CAGR undefined)', () => {
    expect(ownerEarningsCagr([pt(2020, -5), pt(2024, 10)])).toBeUndefined()
    expect(ownerEarningsCagr([pt(2020, 10), pt(2024, 0)])).toBeUndefined()
  })

  it('uses at most the last ~10 points (sorted ascending) for the window', () => {
    // 12-point series; window should be the last 10 (2015..2024). First windowed point oe=10 → last 20.
    const pts: OwnerEarningsPerSharePoint[] = []
    for (let i = 0; i < 12; i += 1) pts.push(pt(2013 + i, 8 + i)) // 8,9,...,19
    const r = ownerEarningsCagr(pts)
    // window = last 10 points: 2015(oe=10) .. 2024(oe=19); n=9 intervals → (19/10)^(1/9) − 1
    expect(r).toBeCloseTo(Math.pow(19 / 10, 1 / 9) - 1, 6)
  })
})
