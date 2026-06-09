import { describe, expect, it, vi } from 'vitest'

import { resolveCurrentPrice, StooqPriceSource, type MarketDataDeps, type PriceQuoteSymbol } from '../marketData.js'

type FetchImpl = NonNullable<MarketDataDeps['fetchImpl']>

function makeOkFetch(body: string): FetchImpl {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(body, { status: 200 })
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

const VALID_CSV = `Symbol,Date,Time,Open,High,Low,Close,Volume
COST.US,2026-06-06,16:00:00,910.00,915.00,908.00,912.34,1234567`

const ND_CSV = `Symbol,Date,Time,Open,High,Low,Close,Volume
COST.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D`

describe('StooqPriceSource', () => {
  it('(a) US ticker with valid CSV row → available:true with parsed price/currency/as_of', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'COST' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(true)
    if (!quote.available) throw new Error('expected available')
    expect(quote.price_per_share).toBe(912.34)
    expect(quote.currency).toBe('USD')
    expect(quote.as_of).toBe('2026-06-06')
    expect(quote.source).toBe('stooq')
    expect(fetchImpl).toHaveBeenCalledOnce()

    // URL must use the .us suffix
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('cost.us')
    expect(calledUrl).toContain('stooq.com')
  })

  it('(b) market AE-DFM → available:false "not covered" and fetch NOT called', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'EMAAR', market: 'AE-DFM' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('not covered')
    expect(quote.source).toBe('stooq')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('(b) market AE-ADX → available:false and fetch NOT called', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'FAB', market: 'AE-ADX' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('not covered')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('(b) market SA-TADAWUL → available:false and fetch NOT called', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'ARAMCO', market: 'SA-TADAWUL' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('not covered')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('(c) CSV with N/D close → available:false (symbol not found)', async () => {
    const fetchImpl = makeOkFetch(ND_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'ZZZZ' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('symbol not found')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('(d) fetch throws → available:false (fail-closed)', async () => {
    const fetchImpl = makeFailFetch(new Error('network unreachable'))
    const symbol: PriceQuoteSymbol = { ticker: 'MSFT' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    if (quote.available) throw new Error('expected unavailable')
    expect(quote.reason).toContain('fetch error')
    expect(quote.source).toBe('stooq')
    // Critically: must not throw
  })

  it('(e) assertPublicHttpUrl still guards — stooq.com is a public host (passes)', async () => {
    // This test verifies the SSRF guard logic runs without blocking stooq.com.
    // We confirm the URL that would be called is on a public host.
    const source = new StooqPriceSource()
    const fetchImpl = makeOkFetch(VALID_CSV)
    await source.getQuote({ ticker: 'AAPL' }, withFetch(fetchImpl))

    // The fetch was called (not blocked by assertPublicHttpUrl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toMatch(/^https:\/\/stooq\.com\//)
  })

  it('UK market → .uk suffix', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'BARC', market: 'UK' }
    await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('barc.uk')
  })

  it('unknown market not in map → available:false and fetch NOT called', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    const symbol: PriceQuoteSymbol = { ticker: 'FOO', market: 'UNKNOWN-EXCHANGE' }
    const quote = await resolveCurrentPrice(symbol, withFetch(fetchImpl))

    expect(quote.available).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('explicit market US → .us suffix (same as undefined)', async () => {
    const fetchImpl = makeOkFetch(VALID_CSV)
    await resolveCurrentPrice({ ticker: 'COST', market: 'US' }, withFetch(fetchImpl))

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(calledUrl).toContain('cost.us')
  })
})
