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
