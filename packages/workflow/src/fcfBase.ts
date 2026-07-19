import { yearFcf } from './annualRatios'
import type { AnnualFacts } from './secEdgar'

// ---------------------------------------------------------------------------------------------------
// FCF BASE NORMALIZATION (owner, 2026-07-19 — the KO $8.16 finding).
//
// The book's DCF projects "current free cash flow" forward, and the harness fed it the LATEST EDGAR
// year raw. KO's FY2024/FY2025 operating cash flow carried multi-billion DISCLOSED one-offs (the IRS
// tax-litigation deposit, the fairlife contingent-consideration payment): CFO ran 11.6B → 6.8B →
// 7.4B, so a grounded-but-poisoned FCF0 of 5.3B priced a ~$70 stock at $8.16 intrinsic. The engine's
// arithmetic was exact; the base year was the lie.
//
// The fix is ANOMALY-TRIGGERED, not a blanket average: a healthy grower's latest year IS the honest
// base (a median would systematically punish growth), so the latest year stays FCF0 UNLESS it
// deviates from the recent-window median beyond the threshold — then the MEDIAN becomes the base and
// the caller flags the switch as a FACT. Symmetric by design: a windfall year is trimmed exactly like
// a depressed one. Pure T0 arithmetic — no model judgment anywhere in the base.
// ---------------------------------------------------------------------------------------------------

export type FcfBaseResolution = {
  /** The FCF0 the valuation uses ($M, reporting currency). */
  fcf_musd: number
  /** 'latest_year' (the normal case) | 'median_window' (anomaly-triggered normalization). */
  basis: 'latest_year' | 'median_window'
  /** The latest computable year's own facts (always recorded — the provenance anchor). */
  latest: { fiscal_year: number; fcf_musd: number; cfo_musd?: number; capex_musd?: number }
  /** Median FCF over the window — present when ≥ 3 computable years exist. */
  median_musd?: number
  /** Ascending fiscal years in the median window. */
  window_fiscal_years?: number[]
  /** (latest − median) / |median| — recorded whenever the median is computable. */
  deviation?: number
}

export type ResolveFcfBaseOptions = {
  /** Most-recent computable years considered for the median (default 5). */
  window?: number
  /** |deviation| beyond which the median replaces the latest year as FCF0 (default 0.25). */
  anomalyThreshold?: number
}

export function resolveFcfBase(series: AnnualFacts[], options: ResolveFcfBaseOptions = {}): FcfBaseResolution | undefined {
  const window = options.window ?? 5
  const threshold = options.anomalyThreshold ?? 0.25

  const computable = [...series]
    .sort((a, b) => b.fiscal_year - a.fiscal_year)
    .flatMap((a) => {
      const fcf = yearFcf(a)
      return fcf === undefined ? [] : [{ facts: a, fcf }]
    })
  const latestRow = computable[0]
  if (latestRow === undefined) return undefined

  const latest: FcfBaseResolution['latest'] = {
    fiscal_year: latestRow.facts.fiscal_year,
    fcf_musd: latestRow.fcf,
    ...(latestRow.facts.cfo_musd === undefined ? {} : { cfo_musd: latestRow.facts.cfo_musd }),
    ...(latestRow.facts.capex_musd === undefined ? {} : { capex_musd: latestRow.facts.capex_musd }),
  }

  const windowRows = computable.slice(0, window)
  if (windowRows.length < 3) {
    return { fcf_musd: latestRow.fcf, basis: 'latest_year', latest }
  }

  const sorted = windowRows.map((row) => row.fcf).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  const windowYears = windowRows.map((row) => row.facts.fiscal_year).sort((a, b) => a - b)
  const deviation = median !== 0 ? (latestRow.fcf - median) / Math.abs(median) : 0
  const anomalous = Math.abs(deviation) > threshold

  return {
    fcf_musd: anomalous ? median : latestRow.fcf,
    basis: anomalous ? 'median_window' : 'latest_year',
    latest,
    median_musd: median,
    window_fiscal_years: windowYears,
    deviation,
  }
}
