import type { AnnualFacts } from './secEdgar'
import {
  cumulativeSplitFactorAfter,
  fetchMonthEndPriceSeries,
  fetchSplitEvents,
  type MarketDataDeps,
  type PriceHistoryPoint,
  type SplitEvent,
} from './marketData'

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): Buffett's retained-earnings test — "every dollar retained should create at
// least a dollar of market value." Pure T0 over the EDGAR series + a month-end close series:
//   anchor year  = the oldest usable window year (its period_end anchors the price measurement);
//   retained/sh  = Σ over the years AFTER the anchor of (NI − dividends) / diluted shares, each
//                  year's share count split-adjusted onto TODAY's basis (Yahoo closes already are);
//   Δprice/sh    = latest close − the close nearest the anchor period_end (±45-day tolerance);
//   ratio        = Δprice/sh ÷ retained/sh; passes = ratio >= 1.
// v1 scope (owner-locked): USD-reporting + USD-priced filers, >=5 summed years — anything else is
// { computable: false, reason } and the dossier says "deferred on data", never a fabricated number.
// Missing dividend tags subtract nothing (most non-payers simply don't tag the concept); the note
// records the possible retention OVERCOUNT, which can only make the test HARDER to pass.
// ---------------------------------------------------------------------------------------------------

/** Minimum summed retention years (the anchor year is additional). */
export const MIN_YEARS_FOR_RETAINED_TEST = 5
/** Max days between the anchor period_end and the nearest close for the anchor price to count. */
export const ANCHOR_CLOSE_TOLERANCE_DAYS = 45

export type RetainedEarningsTestResult =
  | {
      computable: true
      passes: boolean
      /** Δprice/share ÷ retained/share — "$1 retained → $ratio of market value". */
      ratio: number
      retained_per_share: number
      price_change_per_share: number
      anchor_fiscal_year: number
      anchor_close: number
      latest_close: number
      years_used: number
      note: string
    }
  | { computable: false; reason: string }

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/** Pure arithmetic core — deps-free so tests pin it exactly. */
export function computeRetainedEarningsTest(args: {
  series: AnnualFacts[]
  /** Month-end closes ASCENDING (oldest → newest), split-adjusted (the Yahoo chart basis). */
  pricePoints: PriceHistoryPoint[]
  priceCurrency: string
  /** Split events ASCENDING — adjusts the as-reported share counts onto today's basis. */
  splits: SplitEvent[]
}): RetainedEarningsTestResult {
  const { series, pricePoints, priceCurrency, splits } = args

  // v1 currency scope: fundamentals and prices must both be USD (mirror the Shariah market-cap caveat).
  const nonUsd = series.find((a) => a.currency !== 'USD')
  if (nonUsd !== undefined || priceCurrency !== 'USD') {
    return { computable: false, reason: `v1 scope is USD-reporting + USD-priced filers (currency ${nonUsd?.currency ?? priceCurrency})` }
  }

  // Usable years: NI + diluted shares + period_end, newest ≤10, chronological.
  const usable = [...series]
    .filter((a) =>
      a.net_income_musd !== undefined && Number.isFinite(a.net_income_musd)
      && a.diluted_shares_m !== undefined && Number.isFinite(a.diluted_shares_m) && a.diluted_shares_m > 0
      && a.period_end !== undefined)
    .sort((a, b) => b.fiscal_year - a.fiscal_year)
    .slice(0, 10)
    .reverse()
  if (usable.length < MIN_YEARS_FOR_RETAINED_TEST + 1) {
    return { computable: false, reason: `needs >=${MIN_YEARS_FOR_RETAINED_TEST + 1} usable years (anchor + ${MIN_YEARS_FOR_RETAINED_TEST} summed; have ${usable.length})` }
  }

  const anchor = usable[0] as AnnualFacts
  const summed = usable.slice(1)

  // Anchor price: the close nearest the anchor period_end, within tolerance.
  if (pricePoints.length < 2) {
    return { computable: false, reason: 'price series too short' }
  }
  const anchorEnd = anchor.period_end as string
  let anchorPoint: PriceHistoryPoint | undefined
  for (const p of pricePoints) {
    if (anchorPoint === undefined || daysBetween(p.date, anchorEnd) < daysBetween(anchorPoint.date, anchorEnd)) {
      anchorPoint = p
    }
  }
  if (anchorPoint === undefined || daysBetween(anchorPoint.date, anchorEnd) > ANCHOR_CLOSE_TOLERANCE_DAYS) {
    return { computable: false, reason: `no anchor close within ${ANCHOR_CLOSE_TOLERANCE_DAYS} days of the anchor period_end ${anchorEnd}` }
  }
  const latestPoint = pricePoints[pricePoints.length - 1] as PriceHistoryPoint

  // Retained per share (today's split basis) over the summed years.
  let retained = 0
  let missingDividendYears = 0
  for (const y of summed) {
    const div = y.dividends_paid_musd
    if (div === undefined) missingDividendYears += 1
    const retainedMusd = (y.net_income_musd as number) - (div ?? 0)
    const sharesToday = (y.diluted_shares_m as number) * cumulativeSplitFactorAfter(splits, y.period_end ?? `${y.fiscal_year}-12-31`)
    retained += retainedMusd / sharesToday
  }
  if (!(retained > 0)) {
    return { computable: false, reason: 'nothing retained over the window (negative or zero cumulative retention)' }
  }

  const priceChange = latestPoint.close - anchorPoint.close
  const ratio = priceChange / retained
  const passes = ratio >= 1
  const divNote = missingDividendYears > 0
    ? ` ${missingDividendYears} year(s) had no dividends tagged — treated as zero payout (a possible retention overcount, which only makes the test harder to pass).`
    : ''
  return {
    computable: true,
    passes,
    ratio,
    retained_per_share: retained,
    price_change_per_share: priceChange,
    anchor_fiscal_year: anchor.fiscal_year,
    anchor_close: anchorPoint.close,
    latest_close: latestPoint.close,
    years_used: summed.length,
    note: `$1 retained → $${ratio.toFixed(2)} of market value: retained $${retained.toFixed(2)}/sh over `
      + `FY${(summed[0] as AnnualFacts).fiscal_year}–FY${(summed[summed.length - 1] as AnnualFacts).fiscal_year}; the share price moved `
      + `$${anchorPoint.close.toFixed(2)} → $${latestPoint.close.toFixed(2)} from the FY${anchor.fiscal_year} anchor.${divNote}`,
  }
}

/**
 * Fetch-and-compute orchestrator (fail-closed): month-end closes + split events via the SSRF-guarded
 * market-data path, then the pure core. Any fetch failure → { computable: false }, never a throw.
 */
export async function runRetainedEarningsTest(
  ticker: string,
  series: AnnualFacts[],
  deps?: MarketDataDeps,
  market?: string,
): Promise<RetainedEarningsTestResult> {
  const prices = await fetchMonthEndPriceSeries(ticker, 11, deps, market)
  if (!prices.available) {
    return { computable: false, reason: `price history unavailable: ${prices.reason}` }
  }
  const splits = await fetchSplitEvents(ticker, 15, deps, market)
  return computeRetainedEarningsTest({
    series,
    pricePoints: prices.points,
    priceCurrency: prices.currency,
    splits: splits.available ? splits.splits : [],
  })
}
