import { describe, expect, it, vi } from 'vitest'

import { fetchFxRateToUsd, fetchPriceHistory, marketCapInReportingCurrency, resolveCurrentPrice, YahooPriceSource, type MarketDataDeps, type PriceQuoteSymbol } from '../marketData.js'

type FetchImpl = NonNullable<MarketDataDeps['fetchImpl']>

function makeOkFetch(body: unknown): FetchImpl {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as FetchImpl
}

function makeHttpErrorFetch(status: number): FetchImpl {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response('', { status })
  }) as unknown as FetchImpl
}

function makeFailFetch(error: Error): FetchImpl {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    throw error
  }) as unknown as FetchImpl
}

function withFetch(fetchImpl: FetchImpl): MarketDataDeps {
  return { fetchImpl }
}

/** Build a well-formed Yahoo chart response */
function yahooOkResponse(opts: {
  ticker?: string
  price: number
  currency: string
  regularMarketTime: number
}): unknown {
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: opts.price,
            currency: opts.currency,
            regularMarketTime: opts.regularMarketTime,
            fullExchangeName: 'NasdaqGS',
          },
        },
      ],
      error: null,
    },
  }
}

/** Unix timestamp for 2026-06-06T20:00:00Z (market close approximate) */
const TS_2026_06_06 = 1749254400 // new Date('2026-06-06T20:00:00Z').getTime()/1000 = 1749254400

describe('YahooPriceSource', () => {
  it('(a) US ticker with valid meta → available:true with price/currency(USD)/as_of', async () => {
    const body = yahooOkResponse({ price: 912.34, currency: 'USD', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: 'COST' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(true)
    if (!quote.available) throw new Error('expected available')
    expect(quote.price_per_share).toBe(912.34)
    expect(quote.currency).toBe('USD')
    expect(quote.as_of).toBe(new Date(TS_2026_06_06 * 1000).toISOString())
    expect(quote.source).toBe('yahoo')
    expect(fetchImpl).toHaveBeenCalledOnce()

    // URL must contain the ticker (no suffix for US) and Yahoo host
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('COST')
    expect(calledUrl).toContain('query1.finance.yahoo.com')
    expect(calledUrl).not.toContain('.AE')
    expect(calledUrl).not.toContain('.SR')
    expect(calledUrl).not.toContain('.L')

    // User-Agent header must be set
    const calledInit = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit | undefined
    const headers = calledInit?.headers as Record<string, string> | undefined
    expect(headers?.['User-Agent']).toBe('Mozilla/5.0')
  })

  it('(b) market AE-DFM EMAAR → available:true, AED, symbol EMAAR.AE in URL', async () => {
    const body = yahooOkResponse({ price: 5.42, currency: 'AED', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: 'EMAAR', market: 'AE-DFM' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(true)
    if (!quote.available) throw new Error('expected available')
    expect(quote.currency).toBe('AED')
    expect(quote.price_per_share).toBe(5.42)
    expect(fetchImpl).toHaveBeenCalledOnce()

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('EMAAR.AE')
  })

  it('(c) market SA-TADAWUL → available:true, SAR, symbol 2222.SR in URL', async () => {
    const body = yahooOkResponse({ price: 29.10, currency: 'SAR', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: '2222', market: 'SA-TADAWUL' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(true)
    if (!quote.available) throw new Error('expected available')
    expect(quote.currency).toBe('SAR')
    expect(fetchImpl).toHaveBeenCalledOnce()

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('2222.SR')
  })

  it('(d) market UK → symbol has .L suffix in URL', async () => {
    const body = yahooOkResponse({ price: 210.50, currency: 'GBp', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: 'BARC', market: 'UK' }
    await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('BARC.L')
  })

  it('(e) market AE-ADX → available:false "not covered", fetch NOT called', async () => {
    const fetchImpl = makeOkFetch({})
    const symbol: PriceQuoteSymbol = { ticker: 'FAB', market: 'AE-ADX' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('not covered')
    expect(quote.source).toBe('yahoo')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('(f) unknown market not in map → available:false and fetch NOT called', async () => {
    const fetchImpl = makeOkFetch({})
    const symbol: PriceQuoteSymbol = { ticker: 'FOO', market: 'UNKNOWN-EXCHANGE' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('(g) chart.error present → available:false with reason from error', async () => {
    const body = { chart: { result: null, error: { code: 'Not Found', description: 'No fundamentals data found' } } }
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: 'ZZZZ' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('yahoo error')
    expect(quote.source).toBe('yahoo')
  })

  it('(h) chart result is empty array → available:false symbol not found', async () => {
    const body = { chart: { result: [], error: null } }
    const fetchImpl = makeOkFetch(body)
    const symbol: PriceQuoteSymbol = { ticker: 'GONE' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('symbol not found')
  })

  it('(i) regularMarketPrice is missing → available:false', async () => {
    const body = {
      chart: {
        result: [{ meta: { currency: 'USD', regularMarketTime: TS_2026_06_06 } }],
        error: null,
      },
    }
    const fetchImpl = makeOkFetch(body)
    const quote = await resolveCurrentPrice({ ticker: 'MSFT' }, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('missing or non-positive price')
  })

  it('(j) regularMarketPrice is zero or negative → available:false', async () => {
    const body = yahooOkResponse({ price: 0, currency: 'USD', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    const quote = await resolveCurrentPrice({ ticker: 'MSFT' }, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
  })

  it('(k) fetch throws → available:false (fail-closed), never throws', async () => {
    const fetchImpl = makeFailFetch(new Error('network unreachable'))
    const symbol: PriceQuoteSymbol = { ticker: 'MSFT' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('fetch error')
    expect(quote.source).toBe('yahoo')
  })

  it('(l) http 404 → available:false', async () => {
    const fetchImpl = makeHttpErrorFetch(404)
    const quote = await resolveCurrentPrice({ ticker: 'MSFT' }, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toBe('http 404')
  })

  it('(m) assertPublicHttpUrl still guards — query1.finance.yahoo.com is a public host (passes)', async () => {
    const source = new YahooPriceSource()
    const body = yahooOkResponse({ price: 400.0, currency: 'USD', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    await source.getQuote({ ticker: 'AAPL' }, withFetch(fetchImpl))

    // Fetch was called — not blocked by assertPublicHttpUrl
    expect(fetchImpl).toHaveBeenCalledOnce()
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toMatch(/^https:\/\/query1\.finance\.yahoo\.com\//)
  })

  it('(n) explicit market US → no suffix (same as undefined)', async () => {
    const body = yahooOkResponse({ price: 100.0, currency: 'USD', regularMarketTime: TS_2026_06_06 })
    const fetchImpl = makeOkFetch(body)
    await resolveCurrentPrice({ ticker: 'COST', market: 'US' }, withFetch(fetchImpl))

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('COST')
    expect(calledUrl).not.toContain('COST.')
  })
})

/** Build a well-formed Yahoo chart history response */
function yahooSeriesResponse(opts: {
  currency: string
  timestamps: number[]
  closes: Array<number | null>
}): unknown {
  return {
    chart: {
      result: [
        {
          meta: { currency: opts.currency },
          timestamp: opts.timestamps,
          indicators: { quote: [{ close: opts.closes }] },
        },
      ],
      error: null,
    },
  }
}

describe('fetchPriceHistory', () => {
  // 2026-06-04, 2026-06-05, 2026-06-06 (UTC) close timestamps
  const TS_A = Math.floor(Date.UTC(2026, 5, 4, 20) / 1000)
  const TS_B = Math.floor(Date.UTC(2026, 5, 5, 20) / 1000)
  const TS_C = Math.floor(Date.UTC(2026, 5, 6, 20) / 1000)

  it('valid series → available:true with parsed {date, close} points and currency', async () => {
    const body = yahooSeriesResponse({
      currency: 'USD',
      timestamps: [TS_A, TS_B, TS_C],
      closes: [30.0, 31.5, 32.25],
    })
    const fetchImpl = makeOkFetch(body)
    const result = await fetchPriceHistory({ ticker: 'SPUS' }, { range: '1mo' }, withFetch(fetchImpl))

    expect(result.available).toBe(true)
    if (!result.available) throw new Error('expected available')
    expect(result.currency).toBe('USD')
    expect(result.points).toHaveLength(3)
    expect(result.points[0]).toEqual({ date: '2026-06-04', close: 30.0 })
    expect(result.points[2]).toEqual({ date: '2026-06-06', close: 32.25 })

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('SPUS')
    expect(calledUrl).toContain('range=1mo')
    expect(calledUrl).toContain('query1.finance.yahoo.com')
    const calledInit = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit | undefined
    const headers = calledInit?.headers as Record<string, string> | undefined
    expect(headers?.['User-Agent']).toBe('Mozilla/5.0')
  })

  it('skips null closes (Yahoo gaps)', async () => {
    const body = yahooSeriesResponse({
      currency: 'USD',
      timestamps: [TS_A, TS_B, TS_C],
      closes: [30.0, null, 32.25],
    })
    const result = await fetchPriceHistory({ ticker: 'SPUS' }, undefined, withFetch(makeOkFetch(body)))

    expect(result.available).toBe(true)
    if (!result.available) throw new Error('expected available')
    expect(result.points).toHaveLength(2)
    expect(result.points.map((p) => p.date)).toEqual(['2026-06-04', '2026-06-06'])
  })

  it('empty series → available:false', async () => {
    const body = yahooSeriesResponse({ currency: 'USD', timestamps: [], closes: [] })
    const result = await fetchPriceHistory({ ticker: 'SPUS' }, undefined, withFetch(makeOkFetch(body)))

    expect(result.available).toBe(false)
    if (result.available) throw new Error('expected unavailable')
    expect(result.reason).toContain('no history')
  })

  it('fetch throws → available:false (fail-closed), never throws', async () => {
    const result = await fetchPriceHistory({ ticker: 'SPUS' }, undefined, withFetch(makeFailFetch(new Error('network down'))))

    expect(result.available).toBe(false)
    if (result.available) throw new Error('expected unavailable')
    expect(result.reason).toContain('fetch error')
  })

  it('http error → available:false', async () => {
    const result = await fetchPriceHistory({ ticker: 'SPUS' }, undefined, withFetch(makeHttpErrorFetch(503)))

    expect(result.available).toBe(false)
    if (result.available) throw new Error('expected unavailable')
    expect(result.reason).toBe('http 503')
  })

  it('uncovered exchange (AE-ADX) → available:false, fetch NOT called', async () => {
    const fetchImpl = makeOkFetch({})
    const result = await fetchPriceHistory({ ticker: 'FAB', market: 'AE-ADX' }, undefined, withFetch(fetchImpl))

    expect(result.available).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Task 1 — fetchFxRateToUsd
// ---------------------------------------------------------------------------

describe('fetchFxRateToUsd', () => {
  it('returns 1 for USD with no fetch', async () => {
    const fetchImpl = makeOkFetch({})
    const rate = await fetchFxRateToUsd('USD', withFetch(fetchImpl))
    expect(rate).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('parses the DKKUSD=X chart meta into the rate', async () => {
    const body = {
      chart: {
        result: [{ meta: { regularMarketPrice: 0.145, currency: 'USD', regularMarketTime: 1 } }],
        error: null,
      },
    }
    const fetchImpl = makeOkFetch(body)
    const rate = await fetchFxRateToUsd('DKK', withFetch(fetchImpl))
    expect(rate).toBeCloseTo(0.145, 4)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('DKKUSD%3DX')
    expect(calledUrl).toContain('query1.finance.yahoo.com')
  })

  it('returns undefined on fetch error', async () => {
    const result = await fetchFxRateToUsd('DKK', withFetch(makeFailFetch(new Error('net'))))
    expect(result).toBeUndefined()
  })

  it('returns undefined on missing meta (empty JSON)', async () => {
    const result = await fetchFxRateToUsd('DKK', withFetch(makeOkFetch({})))
    expect(result).toBeUndefined()
  })

  it('returns undefined on http error', async () => {
    const result = await fetchFxRateToUsd('DKK', withFetch(makeHttpErrorFetch(404)))
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Task 2 — marketCapInReportingCurrency
// ---------------------------------------------------------------------------

describe('marketCapInReportingCurrency', () => {
  it('passes USD market cap through unchanged when reporting currency is USD', () => {
    expect(marketCapInReportingCurrency(13000, 'USD', 1)).toBe(13000)
  })

  it('divides a USD market cap by the FX rate to get the reporting currency', () => {
    expect(marketCapInReportingCurrency(13000, 'DKK', 0.145)).toBeCloseTo(13000 / 0.145, 2)
  })

  it('returns undefined for a missing rate', () => {
    expect(marketCapInReportingCurrency(13000, 'DKK', undefined)).toBeUndefined()
  })

  it('returns undefined for a zero rate', () => {
    expect(marketCapInReportingCurrency(13000, 'DKK', 0)).toBeUndefined()
  })

  it('returns undefined for a negative rate', () => {
    expect(marketCapInReportingCurrency(13000, 'DKK', -1)).toBeUndefined()
  })
})

