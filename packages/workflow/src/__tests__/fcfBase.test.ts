import { describe, expect, it } from 'vitest'

import { resolveFcfBase } from '../fcfBase'
import type { AnnualFacts } from '../secEdgar'

// FCF BASE NORMALIZATION (owner, 2026-07-19 — the KO $8.16 finding): the DCF's FCF0 was the latest
// EDGAR year RAW, and KO's FY2024/FY2025 CFO carried multi-billion one-offs (IRS deposit, fairlife
// earnout) — a grounded-but-poisoned base priced a ~$70 stock at $8.16. The fix is anomaly-triggered:
// the latest year stays the base (the book's "current FCF") UNLESS it deviates from the window
// median beyond the threshold — then the MEDIAN is the base and a FACT flag says so. Pure T0.

function year(fy: number, cfo: number, capex: number): AnnualFacts {
  return { fiscal_year: fy, currency: 'USD', cfo_musd: cfo, capex_musd: capex }
}

describe('resolveFcfBase', () => {
  it('a clean growing series keeps the LATEST year as the base (no punishment for growth)', () => {
    const base = resolveFcfBase([
      year(2025, 13335, 5498), // 7837
      year(2024, 11339, 4710), // 6629
      year(2023, 11068, 4323), // 6745
    ])
    expect(base?.basis).toBe('latest_year')
    expect(base?.fcf_musd).toBe(7837)
    expect(base?.latest.fiscal_year).toBe(2025)
    expect(base?.median_musd).toBe(6745)
    // Deviation is recorded even when below the trigger — provenance, not silence.
    expect(base?.deviation).toBeCloseTo((7837 - 6745) / 6745, 6)
  })

  it('KO-like: a one-off-depressed latest year switches the base to the window MEDIAN', () => {
    const base = resolveFcfBase([
      year(2025, 7408, 2112),  // 5296  ← depressed (fairlife earnout)
      year(2024, 6805, 2064),  // 4741  ← depressed (IRS deposit)
      year(2023, 11599, 1852), // 9747
      year(2022, 11018, 1484), // 9534
      year(2021, 12625, 1367), // 11258
    ])
    expect(base?.basis).toBe('median_window')
    expect(base?.fcf_musd).toBe(9534)
    expect(base?.latest.fcf_musd).toBe(5296)
    expect(base?.window_fiscal_years).toEqual([2021, 2022, 2023, 2024, 2025])
    expect(base?.deviation).toBeLessThan(-0.25)
  })

  it('a one-off-INFLATED latest year is trimmed the same way (symmetry)', () => {
    const base = resolveFcfBase([
      year(2025, 20000, 2000), // 18000 ← windfall
      year(2024, 10000, 2000), // 8000
      year(2023, 9500, 2000),  // 7500
      year(2022, 9000, 2000),  // 7000
    ])
    expect(base?.basis).toBe('median_window')
    expect(base?.fcf_musd).toBe((8000 + 7500) / 2)
  })

  it('the window caps at 5 most-recent computable years', () => {
    const base = resolveFcfBase([
      year(2025, 3000, 1000), year(2024, 3000, 1000), year(2023, 3000, 1000),
      year(2022, 3000, 1000), year(2021, 3000, 1000),
      year(2020, 99999, 0), year(2019, 99999, 0),
    ])
    expect(base?.window_fiscal_years).toEqual([2021, 2022, 2023, 2024, 2025])
    expect(base?.median_musd).toBe(2000)
  })

  it('fewer than 3 computable years → latest_year, no median, no anomaly switch', () => {
    const base = resolveFcfBase([year(2025, 1000, 400), year(2024, 9000, 400)])
    expect(base?.basis).toBe('latest_year')
    expect(base?.fcf_musd).toBe(600)
    expect(base?.median_musd).toBeUndefined()
    expect(base?.deviation).toBeUndefined()
  })

  it('years without computable CFO−capex are skipped; none computable → undefined (honestly unpriced)', () => {
    const partial = resolveFcfBase([
      { fiscal_year: 2025, currency: 'USD', cfo_musd: 5000 } as AnnualFacts, // no capex
      year(2024, 4000, 1000),
    ])
    expect(partial?.latest.fiscal_year).toBe(2024)
    expect(resolveFcfBase([{ fiscal_year: 2025, currency: 'USD' } as AnnualFacts])).toBeUndefined()
    expect(resolveFcfBase([])).toBeUndefined()
  })
})
