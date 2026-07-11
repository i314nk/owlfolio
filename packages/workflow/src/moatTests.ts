import type { AnnualFacts } from './secEdgar'
import { yearGrossMargin, yearOperatingMargin, yearRoic } from './annualRatios'

// ---------------------------------------------------------------------------------------------------
// The owner's three NAMED moat tests (Phase 3, locked 2026-07-11) as pure T0 arithmetic over the
// EDGAR annual series — "code computes, judgment proposes":
//   Capital efficiency — how good the business is at investing in itself, via ROIC bands:
//     >=15% excellent (likely moat), 10–15% solid, <10% weak (probably no edge).
//   Two-engine — revenue growth AND operating margins improving/holding together indicate a moat in
//     play (margins get a noise dead-band so a strong-stable margin is not failed on a −10bps slope).
//   Standout — the business clearly rises above its INDUSTRY PEERS on gross margin. Peers are not
//     harness-fetched in v1, so this module computes ONLY the company side (level/median/trend); the
//     peer comparison is the moat lane's cite-labeled judgment (S3) and the test joins the anchor
//     arithmetic only when peer-filing grounding ships.
// Each test fails closed INDEPENDENTLY ({ computable: false, reason }) so one missing input never
// silences the other tests. The block never gates a verdict by itself.
// ---------------------------------------------------------------------------------------------------

/** Minimum usable years per test — same posture as MIN_YEARS_FOR_MOAT_ANCHOR. */
export const MIN_YEARS_FOR_MOAT_TESTS = 5

/** Margin-slope noise dead-band (bps/yr). B5 (book-strict): the margin ENGINE requires EXPANSION —
 *  slope > +25bps/yr; within ±25 is 'flat'; below −25 is 'declining'. */
export const MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR = 25

export type CapitalEfficiencyTest =
  | { computable: true; band: 'excellent' | 'solid' | 'weak'; median_roic: number; latest_roic: number; years_used: number; note: string }
  | { computable: false; reason: string }

/**
 * B5 (book-strict): the four-quadrant two-engine diagnostic. The book reads each quadrant:
 *   both_engines            — revenue growing AND margins expanding → a real competitive advantage.
 *   margin_only_cutting_back — margins improve but revenue slows → often cost-cutting, not a moat.
 *   revenue_only_buying_growth — revenue grows but margins fall → likely buying growth (price cuts,
 *                              ad spend, heavy investment) — watch whether it converts.
 *   neither                 — no engine running.
 * A FLAT margin (within the ±dead-band) is not expansion — the strict book test fails it (the
 * quadrant then reads margin-side 'flat', diagnostic per the revenue side).
 */
export type TwoEngineDiagnostic = 'both_engines' | 'margin_only_cutting_back' | 'revenue_only_buying_growth' | 'neither'

export type TwoEngineTest =
  | {
      computable: true
      revenue_engine: boolean
      /** B5: TRUE only when margins are EXPANDING (slope > +dead-band) — the strict book reading. */
      margin_engine: boolean
      passes: boolean
      diagnostic: TwoEngineDiagnostic
      revenue_cagr: number
      margin_trend_bps_per_year: number
      years_used: number
      note: string
    }
  | { computable: false; reason: string }

export type StandoutTest =
  | {
      computable: true
      basis: 'gross_margin'
      gross_margin_latest: number
      gross_margin_median: number
      gross_margin_trend_bps_per_year: number
      years_used: number
      note: string
    }
  | { computable: false; reason: string }

export type MoatTests = {
  capital_efficiency: CapitalEfficiencyTest
  two_engine: TwoEngineTest
  standout: StandoutTest
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number)
}

/** OLS slope of value-per-fiscal-year over the usable points (units: value per year). */
function olsSlope(points: Array<{ x: number; y: number }>): number {
  const n = points.length
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY)
    den += (p.x - meanX) * (p.x - meanX)
  }
  return den === 0 ? 0 : num / den
}

/** Latest ≤10 fiscal years, oldest→newest (chronological), from the newest-first adapter series. */
function windowOf(series: AnnualFacts[]): AnnualFacts[] {
  return [...series].sort((a, b) => b.fiscal_year - a.fiscal_year).slice(0, 10).reverse()
}

/** Usable per-year metric points (chronological) via a per-year extractor. */
function usablePoints(window: AnnualFacts[], metric: (a: AnnualFacts) => number | undefined): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  for (const a of window) {
    const y = metric(a)
    if (y !== undefined && Number.isFinite(y)) points.push({ x: a.fiscal_year, y })
  }
  return points
}

function capitalEfficiency(window: AnnualFacts[]): CapitalEfficiencyTest {
  const points = usablePoints(window, yearRoic)
  if (points.length < MIN_YEARS_FOR_MOAT_TESTS) {
    return { computable: false, reason: `capital-efficiency needs >=${MIN_YEARS_FOR_MOAT_TESTS} usable ROIC years (have ${points.length})` }
  }
  const med = median(points.map((p) => p.y))
  const latest = (points[points.length - 1] as { y: number }).y
  const band = med >= 0.15 ? 'excellent' : med >= 0.1 ? 'solid' : 'weak'
  const bandLabel = band === 'excellent' ? 'excellent (>=15% — likely a moat)' : band === 'solid' ? 'solid (10–15% — respectable returns)' : 'weak (<10% — probably no competitive edge)'
  return {
    computable: true,
    band,
    median_roic: med,
    latest_roic: latest,
    years_used: points.length,
    note: `Median ROIC ${(med * 100).toFixed(1)}% over ${points.length} years — ${bandLabel}.`,
  }
}

function twoEngine(window: AnnualFacts[]): TwoEngineTest {
  const revenues = usablePoints(window, (a) => (a.revenue_musd !== undefined && a.revenue_musd > 0 ? a.revenue_musd : undefined))
  const margins = usablePoints(window, yearOperatingMargin)
  if (revenues.length < MIN_YEARS_FOR_MOAT_TESTS || margins.length < MIN_YEARS_FOR_MOAT_TESTS) {
    return {
      computable: false,
      reason: `two-engine needs >=${MIN_YEARS_FOR_MOAT_TESTS} usable revenue AND margin years (have ${revenues.length}/${margins.length})`,
    }
  }
  const first = revenues[0] as { x: number; y: number }
  const last = revenues[revenues.length - 1] as { x: number; y: number }
  const span = last.x - first.x
  const revenueCagr = span > 0 ? Math.pow(last.y / first.y, 1 / span) - 1 : 0
  const marginSlopeBps = olsSlope(margins) * 10_000
  const revenueEngine = revenueCagr > 0
  // B5 (book-strict, owner-locked): the margin engine requires EXPANSION beyond the noise dead-band.
  const marginEngine = marginSlopeBps > MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR
  const marginDeclining = marginSlopeBps < -MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR
  const diagnostic: TwoEngineDiagnostic = revenueEngine && marginEngine
    ? 'both_engines'
    : !revenueEngine && marginEngine
      ? 'margin_only_cutting_back'
      : revenueEngine && marginDeclining
        ? 'revenue_only_buying_growth'
        : 'neither'
  const diagnosticNote = diagnostic === 'both_engines'
    ? 'both engines running — a real competitive advantage signature'
    : diagnostic === 'margin_only_cutting_back'
      ? 'margins improve while revenue slows — often cost-cutting, not a moat'
      : diagnostic === 'revenue_only_buying_growth'
        ? 'revenue grows while margins fall — likely buying growth (price cuts / ad spend / heavy investment)'
        : revenueEngine
          ? 'revenue grows on flat margins — the strict test wants expansion'
          : 'no engine running'
  return {
    computable: true,
    revenue_engine: revenueEngine,
    margin_engine: marginEngine,
    passes: revenueEngine && marginEngine,
    diagnostic,
    revenue_cagr: revenueCagr,
    margin_trend_bps_per_year: marginSlopeBps,
    years_used: Math.min(revenues.length, margins.length),
    note: `Revenue CAGR ${(revenueCagr * 100).toFixed(1)}%/yr; operating-margin trend ${marginSlopeBps.toFixed(0)}bps/yr (expansion = > +${MARGIN_SLOPE_DEADBAND_BPS_PER_YEAR}bps/yr; the book test wants BOTH engines). Read: ${diagnosticNote}.`,
  }
}

function standout(window: AnnualFacts[]): StandoutTest {
  const points = usablePoints(window, yearGrossMargin)
  if (points.length < MIN_YEARS_FOR_MOAT_TESTS) {
    const anyGp = window.some((a) => a.gross_profit_musd !== undefined)
    return {
      computable: false,
      reason: anyGp
        ? `standout needs >=${MIN_YEARS_FOR_MOAT_TESTS} usable gross-margin years (have ${points.length})`
        : 'gross profit not tagged by this filer (neither GrossProfit nor revenue−COGS resolves)',
    }
  }
  const med = median(points.map((p) => p.y))
  const latest = (points[points.length - 1] as { y: number }).y
  const slopeBps = olsSlope(points) * 10_000
  return {
    computable: true,
    basis: 'gross_margin',
    gross_margin_latest: latest,
    gross_margin_median: med,
    gross_margin_trend_bps_per_year: slopeBps,
    years_used: points.length,
    note: `Company gross margin ${(latest * 100).toFixed(1)}% (median ${(med * 100).toFixed(1)}%, trend ${slopeBps.toFixed(0)}bps/yr). The peer comparison ("above the pack") is the moat lane's cite-labeled judgment — not computed here.`,
  }
}

/** Compute the three named moat tests over the latest ≤10 years. Pure; no I/O. */
export function computeMoatTests(series: AnnualFacts[]): MoatTests {
  const window = windowOf(series)
  return {
    capital_efficiency: capitalEfficiency(window),
    two_engine: twoEngine(window),
    standout: standout(window),
  }
}
