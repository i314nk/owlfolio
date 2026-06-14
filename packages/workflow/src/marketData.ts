// Yahoo Finance chart endpoint (unofficial / keyless, gray-area ToS — acceptable for local personal use only).
// The PriceSource interface allows swapping in an official/keyed provider (and a separate Gulf source for
// ADX / Abu Dhabi) later without touching any callers of resolveCurrentPrice.

import { assertPublicHttpUrl } from './sourceGrounding'

export type PriceQuoteSymbol = {
  ticker: string
  market?: string // e.g. 'US', 'UK', 'AE-DFM', 'AE-ADX', 'SA-TADAWUL'
}

export type PriceQuote =
  | { available: true; price_per_share: number; currency: string; as_of: string; source: string }
  | { available: false; reason: string; source: string }

export type MarketDataDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

export interface PriceSource {
  id: string
  getQuote(symbol: PriceQuoteSymbol, deps?: MarketDataDeps): Promise<PriceQuote>
}

/**
 * Map a PriceQuoteSymbol to the Yahoo Finance symbol string, or return undefined
 * for exchanges not covered by Yahoo (AE-ADX and other unmapped markets).
 *
 * Coverage:
 *   US / undefined  → TICKER          (e.g. MSFT)
 *   AE-DFM          → TICKER.AE       (e.g. EMAAR.AE → AED)
 *   SA-TADAWUL      → TICKER.SR       (e.g. 2222.SR → SAR)
 *   UK              → TICKER.L        (e.g. BARC.L)
 *   AE-ADX          → not covered (ADX symbols are NOT available on Yahoo Finance)
 */
function toYahooSymbol(symbol: PriceQuoteSymbol): string | undefined {
  const ticker = symbol.ticker.toUpperCase()
  const market = symbol.market?.toUpperCase()

  if (market === undefined || market === 'US') {
    return ticker
  }
  if (market === 'AE-DFM') {
    return `${ticker}.AE`
  }
  if (market === 'SA-TADAWUL') {
    return `${ticker}.SR`
  }
  if (market === 'UK') {
    return `${ticker}.L`
  }

  // AE-ADX and all other unmapped markets → not covered
  return undefined
}

const YAHOO_DEFAULT_TIMEOUT_MS = 12_000

type YahooChartMeta = {
  regularMarketPrice?: number
  currency?: string
  regularMarketTime?: number
  fullExchangeName?: string
}

type YahooChartResponse = {
  chart?: {
    result?: Array<{ meta: YahooChartMeta }>
    error?: { code?: string; description?: string } | null
  }
}

/**
 * Keyless JSON price source backed by Yahoo Finance chart API.
 * Covers US equities, DFM (.AE), Saudi Tadawul (.SR), and UK (.L).
 * ADX (Abu Dhabi) is not covered — returns available:false without fetching.
 * Fail-closed: any fetch/parse error returns available:false, never throws.
 * SSRF-guarded via assertPublicHttpUrl.
 */
export class YahooPriceSource implements PriceSource {
  readonly id = 'yahoo'

  async getQuote(symbol: PriceQuoteSymbol, deps?: MarketDataDeps): Promise<PriceQuote> {
    const yahooSym = toYahooSymbol(symbol)
    if (yahooSym === undefined) {
      return { available: false, reason: 'exchange not covered by yahoo', source: 'yahoo' }
    }

    const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`

    // SSRF guard — query1.finance.yahoo.com is a public host but we still assert to maintain the pattern
    let url: URL
    try {
      url = assertPublicHttpUrl(rawUrl)
    } catch (err) {
      return {
        available: false,
        reason: `url guard failed: ${err instanceof Error ? err.message : String(err)}`,
        source: 'yahoo',
      }
    }

    const timeoutMs = deps?.timeoutMs ?? YAHOO_DEFAULT_TIMEOUT_MS
    const fetchFn = deps?.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)

    try {
      const response = await fetchFn(url.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
      })
      if (!response.ok) {
        return { available: false, reason: `http ${response.status}`, source: 'yahoo' }
      }
      const json = await response.json() as YahooChartResponse
      return parseYahooChart(json, symbol.ticker)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { available: false, reason: `fetch error: ${reason}`, source: 'yahoo' }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Parse the Yahoo Finance chart JSON response.
 *
 * Shape: chart.result[0].meta.{ regularMarketPrice, currency, regularMarketTime }
 */
function parseYahooChart(json: YahooChartResponse, ticker: string): PriceQuote {
  const chart = json?.chart
  if (chart?.error != null) {
    const desc = chart.error.description ?? chart.error.code ?? 'api error'
    return { available: false, reason: `yahoo error: ${desc}`, source: 'yahoo' }
  }

  const result = chart?.result
  if (!Array.isArray(result) || result.length === 0) {
    return { available: false, reason: `symbol not found: ${ticker}`, source: 'yahoo' }
  }

  const meta = result[0]?.meta
  if (meta === undefined) {
    return { available: false, reason: `no meta for ${ticker}`, source: 'yahoo' }
  }

  const price = meta.regularMarketPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return { available: false, reason: `missing or non-positive price for ${ticker}`, source: 'yahoo' }
  }

  const currency = typeof meta.currency === 'string' && meta.currency.length > 0 ? meta.currency : 'USD'
  const asOf = typeof meta.regularMarketTime === 'number'
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString()

  return {
    available: true,
    price_per_share: price,
    currency,
    as_of: asOf,
    source: 'yahoo',
  }
}

// ---------------------------------------------------------------------------
// 10-year Treasury yield (Phase 1.4) — the discount anchor input.
// discount = 10y Treasury + a fixed uniform equity premium (Part D Step 3). GLOBAL config, never agent-set.
// ---------------------------------------------------------------------------

/** Documented fail-closed default 10y Treasury yield (decimal) used when the live fetch is unavailable. */
export const DEFAULT_TEN_YEAR_TREASURY_YIELD = 0.045

export type TreasuryYieldResult =
  | { available: true; yield: number; as_of: string; source: string }
  | { available: false; reason: string; fallback_yield: number; source: string }

const TNX_DEFAULT_TIMEOUT_MS = 12_000
// Plausible bounds for a decimal 10y yield (0% < y < 25%) — guards against a units/parse error.
const TNX_MAX_PLAUSIBLE_YIELD = 0.25

type YahooTnxResponse = {
  chart?: {
    result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }>
    error?: { code?: string; description?: string } | null
  }
}

/**
 * Fetch the current 10-year US Treasury yield (decimal) from Yahoo's `^TNX` index, which quotes 10× the
 * yield (e.g. 42.5 → 4.25%). Same fail-closed / SSRF-guard posture as the price path: any fetch/parse/HTTP
 * error or an implausible value returns `available: false` WITH the documented `fallback_yield` so the
 * caller can fail closed to a known default — it NEVER throws. The discount rate is global config; this is
 * the only external input behind it.
 */
export async function fetchTenYearTreasuryYield(deps?: MarketDataDeps): Promise<TreasuryYieldResult> {
  const rawUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1d'
  let url: URL
  try {
    url = assertPublicHttpUrl(rawUrl)
  } catch (err) {
    return { available: false, reason: `url guard failed: ${err instanceof Error ? err.message : String(err)}`, fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
  }
  const timeoutMs = deps?.timeoutMs ?? TNX_DEFAULT_TIMEOUT_MS
  const fetchFn = deps?.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    })
    if (!response.ok) {
      return { available: false, reason: `http ${response.status}`, fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
    }
    const json = await response.json() as YahooTnxResponse
    if (json?.chart?.error != null) {
      const desc = json.chart.error.description ?? json.chart.error.code ?? 'api error'
      return { available: false, reason: `yahoo error: ${desc}`, fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
    }
    const meta = json?.chart?.result?.[0]?.meta
    const raw = meta?.regularMarketPrice
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      return { available: false, reason: 'missing or non-positive ^TNX value', fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
    }
    const decimalYield = raw / 1000 // ^TNX quotes 10× the percent (42.5 → 4.25% → 0.0425)
    if (decimalYield <= 0 || decimalYield > TNX_MAX_PLAUSIBLE_YIELD) {
      return { available: false, reason: `implausible 10y yield ${decimalYield}`, fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
    }
    const asOf = typeof meta?.regularMarketTime === 'number'
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString()
    return { available: true, yield: decimalYield, as_of: asOf, source: 'yahoo' }
  } catch (err) {
    return { available: false, reason: `fetch error: ${err instanceof Error ? err.message : String(err)}`, fallback_yield: DEFAULT_TEN_YEAR_TREASURY_YIELD, source: 'yahoo' }
  } finally {
    clearTimeout(timer)
  }
}

export type PriceHistoryPoint = { date: string; close: number }

export type PriceHistoryResult =
  | { available: true; currency: string; points: PriceHistoryPoint[] }
  | { available: false; reason: string }

export type PriceHistoryOptions = {
  range?: string
  interval?: string
}

type YahooChartSeriesResponse = {
  chart?: {
    result?: Array<{
      meta?: { currency?: string }
      timestamp?: number[]
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>
      }
    }>
    error?: { code?: string; description?: string } | null
  }
}

const YAHOO_HISTORY_DEFAULT_RANGE = '1y'
const YAHOO_HISTORY_DEFAULT_INTERVAL = '1d'

/**
 * Fetch a daily historical close series for a symbol from the Yahoo Finance
 * chart endpoint. Same symbol mapping / fail-closed / SSRF-guard posture as the
 * quote path. Null closes (Yahoo gaps) are skipped. Never throws.
 *
 *   fetchPriceHistory({ ticker: 'SPUS' }, { range: '1y' })
 */
export async function fetchPriceHistory(
  symbol: PriceQuoteSymbol,
  opts?: PriceHistoryOptions,
  deps?: MarketDataDeps,
): Promise<PriceHistoryResult> {
  const yahooSym = toYahooSymbol(symbol)
  if (yahooSym === undefined) {
    return { available: false, reason: 'exchange not covered by yahoo' }
  }

  const range = opts?.range ?? YAHOO_HISTORY_DEFAULT_RANGE
  const interval = opts?.interval ?? YAHOO_HISTORY_DEFAULT_INTERVAL
  const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`

  let url: URL
  try {
    url = assertPublicHttpUrl(rawUrl)
  } catch (err) {
    return {
      available: false,
      reason: `url guard failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const timeoutMs = deps?.timeoutMs ?? YAHOO_DEFAULT_TIMEOUT_MS
  const fetchFn = deps?.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)

  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    })
    if (!response.ok) {
      return { available: false, reason: `http ${response.status}` }
    }
    const json = await response.json() as YahooChartSeriesResponse
    return parseYahooChartSeries(json, symbol.ticker)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { available: false, reason: `fetch error: ${reason}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse the Yahoo Finance chart JSON into a `{ date, close }[]` series.
 *
 * Shape: chart.result[0].{ timestamp[], indicators.quote[0].close[] }
 * Null closes are skipped; timestamps are UTC date (YYYY-MM-DD).
 */
function parseYahooChartSeries(json: YahooChartSeriesResponse, ticker: string): PriceHistoryResult {
  const chart = json?.chart
  if (chart?.error != null) {
    const desc = chart.error.description ?? chart.error.code ?? 'api error'
    return { available: false, reason: `yahoo error: ${desc}` }
  }

  const result = chart?.result
  if (!Array.isArray(result) || result.length === 0) {
    return { available: false, reason: `symbol not found: ${ticker}` }
  }

  const series = result[0]
  const timestamps = series?.timestamp
  const closes = series?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    return { available: false, reason: `no history for ${ticker}` }
  }

  const points: PriceHistoryPoint[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      continue
    }
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) {
      continue
    }
    points.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close })
  }

  if (points.length === 0) {
    return { available: false, reason: `no usable closes for ${ticker}` }
  }

  const currency = typeof series?.meta?.currency === 'string' && series.meta.currency.length > 0
    ? series.meta.currency
    : 'USD'

  return { available: true, currency, points }
}

/**
 * Reduce a daily/whatever-interval close series to one close per calendar month (the LAST observed
 * close of each YYYY-MM), newest-month order not guaranteed. Used to derive a 36-month average from a
 * monthly (or denser) Yahoo history without over-weighting months with more trading days.
 */
export function monthEndCloses(points: PriceHistoryPoint[]): PriceHistoryPoint[] {
  const byMonth = new Map<string, PriceHistoryPoint>()
  for (const p of points) {
    const month = p.date.slice(0, 7) // YYYY-MM
    const prior = byMonth.get(month)
    if (prior === undefined || p.date > prior.date) {
      byMonth.set(month, p)
    }
  }
  return [...byMonth.values()]
}

export type MonthEndPriceSeriesResult =
  | { available: true; currency: string; points: PriceHistoryPoint[] }
  | { available: false; reason: string }

/**
 * Fetch a ~`years`-long month-end close series (default 10 years) for the calibration backtest. Uses the
 * Yahoo chart endpoint with `range=<years>y&interval=1mo`, reduces to one close per calendar month
 * (last observed close of each YYYY-MM), and returns them in ASCENDING date order (oldest → newest) so
 * the backtest can walk history forward. Same SSRF-guard / fail-closed posture as fetchPriceHistory:
 * never throws; returns { available: false } on any failure.
 *
 *   fetchMonthEndPriceSeries('CPRT', 10)
 */
export async function fetchMonthEndPriceSeries(
  ticker: string,
  years = 10,
  deps?: MarketDataDeps,
  market?: string,
): Promise<MonthEndPriceSeriesResult> {
  const yrs = Number.isFinite(years) && years > 0 ? Math.floor(years) : 10
  const symbol: PriceQuoteSymbol = market === undefined ? { ticker } : { ticker, market }
  const history = await fetchPriceHistory(symbol, { range: `${yrs}y`, interval: '1mo' }, deps)
  if (!history.available) {
    return { available: false, reason: history.reason }
  }
  const monthly = monthEndCloses(history.points)
  if (monthly.length === 0) {
    return { available: false, reason: 'no month-end closes' }
  }
  const points = [...monthly].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { available: true, currency: history.currency, points }
}

export type AverageMarketCapResult =
  | {
      available: true
      /** Average market cap ($) = average month-end price × diluted shares. */
      market_cap: number
      /** Average price actually used. */
      average_price: number
      /** Number of month-end observations averaged. */
      months: number
      basis: 'avg_36mo_month_end_x_diluted_shares'
      currency: string
    }
  | { available: false; reason: string }

/**
 * Compute the trailing ~36-month AVERAGE market cap (valuation-recalibration-spec / buffett-pipeline
 * Lane 5: the Shariah debt/cash ratios want the 36-mo average market cap, not a spot price). Fetches
 * monthly closes, reduces to one close per month, averages them, and multiplies by diluted shares.
 *
 * `diluted_shares` is in the caller's share unit (the swarm passes EDGAR diluted shares in MILLIONS,
 * so the returned market_cap is in $MILLIONS to match the Shariah-ratio inputs). FAIL-CLOSED: returns
 * { available: false } on any history failure so the caller degrades to the spot-price market cap.
 */
export async function fetchAverageMarketCap(
  symbol: PriceQuoteSymbol,
  diluted_shares: number,
  opts?: { months?: number },
  deps?: MarketDataDeps,
): Promise<AverageMarketCapResult> {
  if (!Number.isFinite(diluted_shares) || diluted_shares <= 0) {
    return { available: false, reason: 'diluted_shares missing or non-positive' }
  }
  const history = await fetchPriceHistory(symbol, { range: '3y', interval: '1mo' }, deps)
  if (!history.available) {
    return { available: false, reason: history.reason }
  }
  const monthly = monthEndCloses(history.points)
  if (monthly.length === 0) {
    return { available: false, reason: 'no month-end closes' }
  }
  // Keep the most recent N months (default 36) by date.
  const months = opts?.months ?? 36
  const sorted = [...monthly].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const window = sorted.slice(0, months)
  const average_price = window.reduce((sum, p) => sum + p.close, 0) / window.length
  if (!Number.isFinite(average_price) || average_price <= 0) {
    return { available: false, reason: 'non-positive average price' }
  }
  return {
    available: true,
    market_cap: average_price * diluted_shares,
    average_price,
    months: window.length,
    basis: 'avg_36mo_month_end_x_diluted_shares',
    currency: history.currency,
  }
}

// ---------------------------------------------------------------------------
// Stock-split events — for split-consistent fundamentals/price comparison (backtest §split-fix)
// ---------------------------------------------------------------------------

/**
 * One stock split: the calendar date it took effect (YYYY-MM-DD, UTC) and the multiplicative share factor
 * (e.g. a 20:1 split → factor 20: the share count multiplies by 20). A reverse split has factor < 1.
 */
export type SplitEvent = { date: string; factor: number }

export type SplitEventsResult =
  | { available: true; splits: SplitEvent[] }
  | { available: false; reason: string }

type YahooSplitsResponse = {
  chart?: {
    result?: Array<{
      events?: { splits?: Record<string, { date?: number; numerator?: number; denominator?: number }> }
    }>
    error?: { code?: string; description?: string } | null
  }
}

/**
 * Fetch the stock-split history for a symbol from the Yahoo chart endpoint (`events=splits`). Used to put
 * an EDGAR as-reported share series on the SAME split-adjusted basis as Yahoo's split-adjusted price series
 * (the calibration backtest's OE-per-share vs price comparison). Same SSRF-guard / fail-closed posture as
 * the price paths: never throws; returns { available: false } on any failure. Splits are returned in
 * ASCENDING date order.
 */
export async function fetchSplitEvents(
  ticker: string,
  years = 15,
  deps?: MarketDataDeps,
  market?: string,
): Promise<SplitEventsResult> {
  const yrs = Number.isFinite(years) && years > 0 ? Math.floor(years) : 15
  const symbol: PriceQuoteSymbol = market === undefined ? { ticker } : { ticker, market }
  const yahooSym = toYahooSymbol(symbol)
  if (yahooSym === undefined) {
    return { available: false, reason: 'exchange not covered by yahoo' }
  }
  const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1mo&range=${yrs}y&events=splits`

  let url: URL
  try {
    url = assertPublicHttpUrl(rawUrl)
  } catch (err) {
    return { available: false, reason: `url guard failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const timeoutMs = deps?.timeoutMs ?? YAHOO_DEFAULT_TIMEOUT_MS
  const fetchFn = deps?.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    })
    if (!response.ok) return { available: false, reason: `http ${response.status}` }
    const json = await response.json() as YahooSplitsResponse
    return parseYahooSplits(json, ticker)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { available: false, reason: `fetch error: ${reason}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Parse the Yahoo chart `events.splits` map into an ascending SplitEvent[]. Never throws. */
export function parseYahooSplits(json: YahooSplitsResponse, ticker: string): SplitEventsResult {
  const chart = json?.chart
  if (chart?.error != null) {
    const desc = chart.error.description ?? chart.error.code ?? 'api error'
    return { available: false, reason: `yahoo error: ${desc}` }
  }
  const result = chart?.result
  if (!Array.isArray(result) || result.length === 0) {
    return { available: false, reason: `symbol not found: ${ticker}` }
  }
  const splitsMap = result[0]?.events?.splits ?? {}
  const splits: SplitEvent[] = []
  for (const s of Object.values(splitsMap)) {
    if (typeof s?.date !== 'number' || !Number.isFinite(s.date)) continue
    const num = s.numerator
    const den = s.denominator
    if (typeof num !== 'number' || typeof den !== 'number' || !(num > 0) || !(den > 0)) continue
    splits.push({ date: new Date(s.date * 1000).toISOString().slice(0, 10), factor: num / den })
  }
  splits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { available: true, splits }
}

/**
 * Cumulative split factor applied to a share count reported as-of `asOfDate` to bring it onto TODAY's
 * (latest) split-adjusted basis: the product of every split factor that took effect strictly AFTER
 * `asOfDate`. A pre-20:1-split count (factor 20 still pending) multiplies by 20; a post-split count
 * (no later splits) multiplies by 1. Pure + deterministic.
 */
export function cumulativeSplitFactorAfter(splits: ReadonlyArray<SplitEvent>, asOfDate: string): number {
  let factor = 1
  for (const s of splits) {
    if (s.date > asOfDate && Number.isFinite(s.factor) && s.factor > 0) factor *= s.factor
  }
  return factor
}

export const defaultPriceSource: PriceSource = new YahooPriceSource()

/**
 * Convenience wrapper: resolve current price for a symbol using the given
 * source (defaults to defaultPriceSource / YahooPriceSource).
 */
export async function resolveCurrentPrice(
  symbol: PriceQuoteSymbol,
  deps?: MarketDataDeps,
  source: PriceSource = defaultPriceSource,
): Promise<PriceQuote> {
  return source.getQuote(symbol, deps)
}
