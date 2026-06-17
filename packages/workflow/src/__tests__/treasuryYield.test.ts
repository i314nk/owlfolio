import { describe, it, expect } from 'vitest'

import { fetchTenYearTreasuryYield, DEFAULT_TEN_YEAR_TREASURY_YIELD } from '../marketData'

// Buffett-Munger gap-closing Phase 1.4: Treasury-anchored discount input.
// The 10y Treasury yield feeds discount = tenYearTreasury + equity_premium (global config, never an
// agent input). Fetched from Yahoo's ^TNX, which quotes the yield AS A PERCENT (e.g. 4.428 → 4.428%,
// confirmed live 2026-06) → decimal via /100. (The earlier /1000 was a scale bug: it produced 0.004428,
// a ~10x-low anchor that inflated forward fair values and corrupted market-implied growth.) FAIL-CLOSED
// to a documented default (DEFAULT_TEN_YEAR_TREASURY_YIELD) on any fetch/parse error.
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('fetchTenYearTreasuryYield', () => {
  it('parses ^TNX (percent quote) into a decimal yield via /100', async () => {
    // Real ^TNX regularMarketPrice is the yield in percent (live 4.428), NOT 10x it.
    const fetchImpl = (async () => jsonResponse({
      chart: { result: [{ meta: { regularMarketPrice: 4.428 } }], error: null },
    })) as unknown as typeof fetch
    const r = await fetchTenYearTreasuryYield({ fetchImpl })
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.yield).toBeCloseTo(0.04428, 6) // 4.428% — was 0.004428 under the /1000 bug
      expect(r.source).toBe('yahoo')
    }
  })

  it('rejects a 10x-too-large quote as implausible (the old /1000 scale would have masked it)', async () => {
    // If Yahoo ever returned 44.28 (10x), /100 → 0.4428 > TNX_MAX_PLAUSIBLE_YIELD → fail closed, not a silent 0.04428.
    const fetchImpl = (async () => jsonResponse({
      chart: { result: [{ meta: { regularMarketPrice: 44.28 } }], error: null },
    })) as unknown as typeof fetch
    const r = await fetchTenYearTreasuryYield({ fetchImpl })
    expect(r.available).toBe(false)
    if (!r.available) expect(r.fallback_yield).toBe(DEFAULT_TEN_YEAR_TREASURY_YIELD)
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
