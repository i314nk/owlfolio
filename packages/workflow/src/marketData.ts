import { assertPublicHttpUrl } from './sourceGrounding.js'

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
 * Map a PriceQuoteSymbol to the Stooq symbol string, or return undefined
 * for exchanges not covered by Stooq (AE-DFM, AE-ADX, SA-TADAWUL, etc.).
 */
function toStooqSymbol(symbol: PriceQuoteSymbol): string | undefined {
  const ticker = symbol.ticker.toLowerCase()
  const market = symbol.market?.toUpperCase()

  // Unsupported exchanges — return early without fetching
  const unsupported = new Set(['AE-DFM', 'AE-ADX', 'SA-TADAWUL'])
  if (market !== undefined && unsupported.has(market)) {
    return undefined
  }

  if (market === undefined || market === 'US') {
    return `${ticker}.us`
  }
  if (market === 'UK') {
    return `${ticker}.uk`
  }
  if (market === 'DE') {
    return `${ticker}.de`
  }
  if (market === 'JP') {
    return `${ticker}.jp`
  }
  if (market === 'HK') {
    return `${ticker}.hk`
  }

  // All other markets not explicitly mapped → unsupported
  return undefined
}

const STOOQ_DEFAULT_TIMEOUT_MS = 12_000

/**
 * Keyless CSV price source backed by Stooq (https://stooq.com).
 * Fail-closed: any fetch/parse error returns available:false, never throws.
 * SSRF-guarded via assertPublicHttpUrl.
 */
export class StooqPriceSource implements PriceSource {
  readonly id = 'stooq'

  async getQuote(symbol: PriceQuoteSymbol, deps?: MarketDataDeps): Promise<PriceQuote> {
    const stooqSym = toStooqSymbol(symbol)
    if (stooqSym === undefined) {
      return { available: false, reason: 'exchange not covered by stooq', source: 'stooq' }
    }

    const rawUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcv&h&e=csv`

    // SSRF guard — stooq.com is a public host but we still assert to maintain the pattern
    let url: URL
    try {
      url = assertPublicHttpUrl(rawUrl)
    } catch (err) {
      return {
        available: false,
        reason: `url guard failed: ${err instanceof Error ? err.message : String(err)}`,
        source: 'stooq',
      }
    }

    const timeoutMs = deps?.timeoutMs ?? STOOQ_DEFAULT_TIMEOUT_MS
    const fetchFn = deps?.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)

    try {
      const response = await fetchFn(url.toString(), { signal: controller.signal })
      if (!response.ok) {
        return { available: false, reason: `http ${response.status}`, source: 'stooq' }
      }
      const text = await response.text()
      return parseStooqCsv(text, symbol.ticker)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { available: false, reason: `fetch error: ${reason}`, source: 'stooq' }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Parse the Stooq CSV response.
 *
 * Header: Symbol,Date,Time,Open,High,Low,Close,Volume
 * Valid data row has a numeric Close != N/D and a real Date != N/D.
 */
function parseStooqCsv(csv: string, ticker: string): PriceQuote {
  const lines = csv.trim().split(/\r?\n/)
  // lines[0] = header, lines[1] = data row (typically)
  if (lines.length < 2) {
    return { available: false, reason: 'symbol not found', source: 'stooq' }
  }

  const header = lines[0]
  if (header === undefined) {
    return { available: false, reason: 'symbol not found', source: 'stooq' }
  }

  const cols = header.split(',').map((c) => c.trim().toLowerCase())
  const dateIdx = cols.indexOf('date')
  const closeIdx = cols.indexOf('close')

  if (dateIdx === -1 || closeIdx === -1) {
    return { available: false, reason: 'unexpected csv format', source: 'stooq' }
  }

  const dataLine = lines[1]
  if (dataLine === undefined || dataLine.trim() === '') {
    return { available: false, reason: 'symbol not found', source: 'stooq' }
  }

  const cells = dataLine.split(',')
  const dateCell = cells[dateIdx]?.trim()
  const closeCell = cells[closeIdx]?.trim()

  if (dateCell === undefined || closeCell === undefined || dateCell === 'N/D' || closeCell === 'N/D') {
    return { available: false, reason: `symbol not found: ${ticker}`, source: 'stooq' }
  }

  const price = Number(closeCell)
  if (!Number.isFinite(price) || price <= 0) {
    return { available: false, reason: `non-numeric close for ${ticker}: ${closeCell}`, source: 'stooq' }
  }

  // Stooq always returns USD for US symbols; for others we'd need mapping.
  // For now, currency is 'USD' for .us symbols — caller can override if needed.
  const currency = 'USD'

  return {
    available: true,
    price_per_share: price,
    currency,
    as_of: dateCell,
    source: 'stooq',
  }
}

export const defaultPriceSource: PriceSource = new StooqPriceSource()

/**
 * Convenience wrapper: resolve current price for a symbol using the given
 * source (defaults to defaultPriceSource / StooqPriceSource).
 */
export async function resolveCurrentPrice(
  symbol: PriceQuoteSymbol,
  deps?: MarketDataDeps,
  source: PriceSource = defaultPriceSource,
): Promise<PriceQuote> {
  return source.getQuote(symbol, deps)
}
