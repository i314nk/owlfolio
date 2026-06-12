import { describe, expect, it, vi } from 'vitest'
import {
  cumulativeSplitFactorAfter,
  fetchSplitEvents,
  parseYahooSplits,
  type MarketDataDeps,
  type SplitEvent,
} from '../marketData'

type FetchImpl = NonNullable<MarketDataDeps['fetchImpl']>

function okFetch(body: unknown): FetchImpl {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as FetchImpl
}

// A Yahoo chart `events.splits` map keyed by the split's epoch-seconds.
function yahooSplits(splits: Array<{ date: string; numerator: number; denominator: number }>) {
  const map: Record<string, { date?: number; numerator?: number; denominator?: number }> = {}
  for (const s of splits) {
    const epoch = Math.floor(Date.UTC(
      Number(s.date.slice(0, 4)),
      Number(s.date.slice(5, 7)) - 1,
      Number(s.date.slice(8, 10)),
    ) / 1000)
    map[String(epoch)] = { date: epoch, numerator: s.numerator, denominator: s.denominator }
  }
  return { chart: { result: [{ events: { splits: map } }], error: null } }
}

describe('parseYahooSplits', () => {
  it('parses an events.splits map into ascending SplitEvent[] (GOOGL: 1998:1000 then 20:1)', () => {
    const json = yahooSplits([
      { date: '2022-07-18', numerator: 20, denominator: 1 },
      { date: '2014-04-03', numerator: 1998, denominator: 1000 },
    ])
    const out = parseYahooSplits(json, 'GOOGL')
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.splits.map((s) => s.date)).toEqual(['2014-04-03', '2022-07-18'])
    expect(out.splits[1]!.factor).toBe(20)
    expect(out.splits[0]!.factor).toBeCloseTo(1.998, 3)
  })

  it('a symbol with no splits → available:true, empty list (MSFT)', () => {
    const out = parseYahooSplits({ chart: { result: [{}], error: null } }, 'MSFT')
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.splits).toEqual([])
  })

  it('a yahoo api error → available:false', () => {
    const out = parseYahooSplits({ chart: { error: { description: 'boom' } } }, 'X')
    expect(out.available).toBe(false)
  })
})

describe('cumulativeSplitFactorAfter', () => {
  const googl: SplitEvent[] = [
    { date: '2014-04-03', factor: 1.998 },
    { date: '2022-07-18', factor: 20 },
  ]
  it('a pre-split (2019) date carries the full 20× cumulative factor', () => {
    expect(cumulativeSplitFactorAfter(googl, '2019-12-31')).toBe(20)
  })
  it('a post-split (2023) date carries factor 1 (no later splits)', () => {
    expect(cumulativeSplitFactorAfter(googl, '2023-02-03')).toBe(1)
  })
  it('a date before BOTH splits carries the product (1.998 × 20)', () => {
    expect(cumulativeSplitFactorAfter(googl, '2013-01-01')).toBeCloseTo(39.96, 2)
  })
  it('no splits → factor 1', () => {
    expect(cumulativeSplitFactorAfter([], '2020-01-01')).toBe(1)
  })
})

describe('fetchSplitEvents (fail-closed, fetch injected)', () => {
  it('fetches + parses GOOGL splits', async () => {
    const json = yahooSplits([{ date: '2022-07-18', numerator: 20, denominator: 1 }])
    const out = await fetchSplitEvents('GOOGL', 15, { fetchImpl: okFetch(json) })
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.splits).toEqual([{ date: '2022-07-18', factor: 20 }])
  })

  it('http error → available:false (never throws)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 })) as unknown as FetchImpl
    const out = await fetchSplitEvents('GOOGL', 15, { fetchImpl })
    expect(out.available).toBe(false)
  })
})
