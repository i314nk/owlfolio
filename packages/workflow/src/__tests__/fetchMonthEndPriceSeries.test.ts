import { describe, expect, it } from 'vitest'
import { fetchMonthEndPriceSeries } from '../marketData'

// Synthetic Yahoo chart JSON (range=10y&interval=1mo shape). We do NOT hit Yahoo: a fake fetchImpl
// returns this fixture so the parsing + month-end reduction + ascending sort are deterministic.
function fakeYahooChart(timestamps: number[], closes: Array<number | null>, currency = 'USD') {
  return {
    chart: {
      result: [
        {
          meta: { currency },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  }
}

// UTC seconds for the last day of a few months.
const T = {
  jan2020: Math.floor(Date.UTC(2020, 0, 31) / 1000),
  feb2020: Math.floor(Date.UTC(2020, 1, 28) / 1000),
  feb2020_late: Math.floor(Date.UTC(2020, 1, 29) / 1000),
  mar2020: Math.floor(Date.UTC(2020, 2, 31) / 1000),
}

function fetchReturning(json: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
}

describe('fetchMonthEndPriceSeries', () => {
  it('parses the Yahoo chart fixture into ascending month-end closes', async () => {
    const json = fakeYahooChart(
      [T.jan2020, T.feb2020, T.feb2020_late, T.mar2020],
      [100, 90, 95, 110],
    )
    const out = await fetchMonthEndPriceSeries('CPRT', 10, { fetchImpl: fetchReturning(json) })
    expect(out.available).toBe(true)
    if (!out.available) return
    // Feb collapses to the LAST observed close of the month (95 on the 29th), ascending by date.
    expect(out.points.map((p) => p.date)).toEqual(['2020-01-31', '2020-02-29', '2020-03-31'])
    expect(out.points.map((p) => p.close)).toEqual([100, 95, 110])
    expect(out.currency).toBe('USD')
  })

  it('skips null closes (Yahoo gaps)', async () => {
    const json = fakeYahooChart([T.jan2020, T.feb2020, T.mar2020], [100, null, 110])
    const out = await fetchMonthEndPriceSeries('CPRT', 10, { fetchImpl: fetchReturning(json) })
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.points.map((p) => p.date)).toEqual(['2020-01-31', '2020-03-31'])
  })

  it('fails closed on an empty result', async () => {
    const json = { chart: { result: [], error: null } }
    const out = await fetchMonthEndPriceSeries('NOPE', 10, { fetchImpl: fetchReturning(json) })
    expect(out.available).toBe(false)
  })
})
