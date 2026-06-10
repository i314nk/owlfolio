import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetTickerCacheForTests, fetchCompanyFundamentals, resolveCik } from '../secEdgar'

beforeEach(() => {
  // The ticker map is cached module-side; reset so fail-closed fetch-error tests are not masked
  // by a cache populated by an earlier test.
  __resetTickerCacheForTests()
})

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, '..', '__fixtures__', 'sec-edgar')

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'))
}

const tickersFixture = fixture('company-tickers.json')
const factsFixture = fixture('cost-companyfacts.json')
const subsFixture = fixture('cost-submissions.json')

/**
 * Build a fake fetch that routes SEC URLs to the captured fixtures. Any unexpected URL throws so a
 * test that accidentally tries to hit the network fails loudly rather than silently passing.
 */
function fakeFetch(overrides: Record<string, { ok?: boolean; status?: number; json?: unknown } | 'throw'> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const [match, behavior] of Object.entries(overrides)) {
      if (url.includes(match)) {
        if (behavior === 'throw') throw new Error(`network down: ${url}`)
        return {
          ok: behavior.ok ?? true,
          status: behavior.status ?? 200,
          json: async () => behavior.json,
        } as Response
      }
    }
    if (url.includes('company_tickers.json')) {
      return { ok: true, status: 200, json: async () => tickersFixture } as Response
    }
    if (url.includes('/api/xbrl/companyfacts/')) {
      return { ok: true, status: 200, json: async () => factsFixture } as Response
    }
    if (url.includes('/submissions/')) {
      return { ok: true, status: 200, json: async () => subsFixture } as Response
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as unknown as typeof fetch
}

describe('resolveCik', () => {
  it('resolves a known ticker to a zero-padded 10-digit CIK', async () => {
    const cik = await resolveCik('COST', { fetchImpl: fakeFetch() })
    expect(cik).toBe('0000909832')
  })

  it('is case-insensitive on the ticker', async () => {
    const cik = await resolveCik('cost', { fetchImpl: fakeFetch() })
    expect(cik).toBe('0000909832')
  })

  it('returns undefined for an unknown ticker', async () => {
    const cik = await resolveCik('NOTAREALTICKER', { fetchImpl: fakeFetch() })
    expect(cik).toBeUndefined()
  })

  it('returns undefined fail-closed when the tickers fetch errors', async () => {
    const cik = await resolveCik('COST', { fetchImpl: fakeFetch({ 'company_tickers.json': 'throw' }) })
    expect(cik).toBeUndefined()
  })
})

describe('fetchCompanyFundamentals (COST FY2025, fixture-driven)', () => {
  it('parses the latest-annual primary-filing numbers in $millions / share-millions', async () => {
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.cik).toBe('0000909832')
    expect(f.entity_name).toBe('COSTCO WHOLESALE CORP /NEW')

    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.net_income_musd).toBeCloseTo(8099, 1)
    expect(la.revenue_musd).toBeCloseTo(275235, 1)
    expect(la.d_and_a_musd).toBeCloseTo(2426, 1)
    expect(la.capex_musd).toBeCloseTo(5498, 1)
    expect(la.sbc_musd).toBeCloseTo(860, 1)
    expect(la.diluted_shares_m).toBeCloseTo(444.8, 1)
  })

  it('builds the latest 10-K archive URL from submissions', async () => {
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const tenK = f.filings.find((x) => x.form === '10-K')
    expect(tenK).toBeDefined()
    expect(tenK?.url).toMatch(/cost-20250831\.htm$/)
    expect(tenK?.url).toContain('https://www.sec.gov/Archives/edgar/data/909832/')
    expect(tenK?.url).toContain('000090983225000101')
  })

  it('exposes a multi-year annual series (>=10 yrs), newest first', async () => {
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.annual_series.length).toBeGreaterThanOrEqual(10)
    // newest -> oldest
    expect(f.annual_series[0]?.fiscal_year).toBe(2025)
    const years = f.annual_series.map((a) => a.fiscal_year)
    for (let i = 1; i < years.length; i++) {
      expect(years[i]! < years[i - 1]!).toBe(true)
    }
  })

  it('de-dupes by fiscal year, taking the value from the latest filed date', async () => {
    // FY2025 has 3 entries in the fixture (re-filings); the latest-filed value (8099M) must win.
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    const fy2025 = f?.annual_series.find((a) => a.fiscal_year === 2025)
    expect(fy2025?.net_income_musd).toBeCloseTo(8099, 1)
  })

  it('accepts a CIK directly (skips the ticker map)', async () => {
    const f = await fetchCompanyFundamentals('0000909832', { fetchImpl: fakeFetch({ 'company_tickers.json': 'throw' }) })
    expect(f).toBeDefined()
    expect(f?.latest_annual.fiscal_year).toBe(2025)
  })

  it('leaves a field undefined when its concept is absent', async () => {
    // Strip ShareBasedCompensation from the facts to simulate a missing concept.
    const facts = JSON.parse(JSON.stringify(factsFixture)) as { facts: { 'us-gaap': Record<string, unknown> } }
    delete facts.facts['us-gaap']['ShareBasedCompensation']
    const f = await fetchCompanyFundamentals('COST', {
      fetchImpl: fakeFetch({ 'companyfacts/': { json: facts } }),
    })
    expect(f).toBeDefined()
    expect(f?.latest_annual.sbc_musd).toBeUndefined()
    // other concepts still parse
    expect(f?.latest_annual.net_income_musd).toBeCloseTo(8099, 1)
  })

  it('returns undefined for an unknown ticker (fail-closed)', async () => {
    const f = await fetchCompanyFundamentals('NOTAREALTICKER', { fetchImpl: fakeFetch() })
    expect(f).toBeUndefined()
  })

  it('returns undefined fail-closed when companyfacts fetch errors', async () => {
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch({ 'companyfacts/': 'throw' }) })
    expect(f).toBeUndefined()
  })

  it('returns undefined fail-closed on a non-200 companyfacts response', async () => {
    const f = await fetchCompanyFundamentals('COST', {
      fetchImpl: fakeFetch({ 'companyfacts/': { ok: false, status: 403 } }),
    })
    expect(f).toBeUndefined()
  })

  it('still returns fundamentals (no filings) when submissions fetch errors', async () => {
    // Submissions failure should not lose the structured XBRL facts — it just yields no 10-K URL.
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch({ '/submissions/': 'throw' }) })
    expect(f).toBeDefined()
    expect(f?.latest_annual.fiscal_year).toBe(2025)
    expect(f?.filings).toEqual([])
  })
})
