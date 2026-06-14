import { describe, it, expect } from 'vitest'

import { estimateMaintenanceCapex } from '../secEdgar'
import type { AnnualFacts } from '../secEdgar'

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
})
