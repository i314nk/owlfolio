import { describe, it, expect } from 'vitest'

import { fetchTenYearTreasuryYield, DEFAULT_TEN_YEAR_TREASURY_YIELD } from '../marketData'

// Buffett-Munger gap-closing Phase 1.4: Treasury-anchored discount input.
// The 10y Treasury yield feeds discount = tenYearTreasury + equity_premium (global config, never an
// agent input). Fetched from Yahoo's ^TNX (quotes 10× the yield, e.g. 42.5 → 4.25%). FAIL-CLOSED to a
// documented default (DEFAULT_TEN_YEAR_TREASURY_YIELD) on any fetch/parse error.
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('fetchTenYearTreasuryYield', () => {
  it('parses ^TNX (10× yield) into a decimal yield', async () => {
    const fetchImpl = (async () => jsonResponse({
      chart: { result: [{ meta: { regularMarketPrice: 42.5 } }], error: null },
    })) as unknown as typeof fetch
    const r = await fetchTenYearTreasuryYield({ fetchImpl })
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.yield).toBeCloseTo(0.0425, 6)
      expect(r.source).toBe('yahoo')
    }
  })

  it('fails closed to the documented default on an HTTP error', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const r = await fetchTenYearTreasuryYield({ fetchImpl })
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.fallback_yield).toBe(DEFAULT_TEN_YEAR_TREASURY_YIELD)
    }
  })

  it('fails closed when the fetch throws (never throws itself)', async () => {
    const fetchImpl = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const r = await fetchTenYearTreasuryYield({ fetchImpl })
    expect(r.available).toBe(false)
    if (!r.available) expect(r.fallback_yield).toBe(DEFAULT_TEN_YEAR_TREASURY_YIELD)
  })

  it('fails closed on an implausible yield (non-positive or absurdly large)', async () => {
    const tooBig = (async () => jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 9999 } }], error: null } })) as unknown as typeof fetch
    const r1 = await fetchTenYearTreasuryYield({ fetchImpl: tooBig })
    expect(r1.available).toBe(false)
    const zero = (async () => jsonResponse({ chart: { result: [{ meta: { regularMarketPrice: 0 } }], error: null } })) as unknown as typeof fetch
    const r2 = await fetchTenYearTreasuryYield({ fetchImpl: zero })
    expect(r2.available).toBe(false)
  })

  it('documents the default at ~4.5%', () => {
    expect(DEFAULT_TEN_YEAR_TREASURY_YIELD).toBe(0.045)
  })
})
