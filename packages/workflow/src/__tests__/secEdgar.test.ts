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
const novoFactsFixture = fixture('novo-companyfacts.json')
const novoSubsFixture = fixture('novo-submissions.json')
const cprtFactsFixture = fixture('cprt-companyfacts.json')

/**
 * Build a fake fetch that serves the trimmed CPRT companyfacts fixture for any CIK lookup and an empty
 * submissions blob (CPRT is fetched by CIK in these tests, so the ticker map is not required).
 */
function fakeCprtFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/xbrl/companyfacts/')) {
      return { ok: true, status: 200, json: async () => cprtFactsFixture } as Response
    }
    if (url.includes('/submissions/')) {
      return { ok: true, status: 200, json: async () => ({ filings: { recent: {} } }) } as Response
    }
    if (url.includes('company_tickers.json')) {
      return { ok: true, status: 200, json: async () => tickersFixture } as Response
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as unknown as typeof fetch
}

/**
 * Build a fake fetch routing the IFRS/20-F Novo fixtures (companyfacts + submissions). The shared
 * ticker map fixture already carries NVO -> CIK 0000353278.
 */
function fakeNovoFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('company_tickers.json')) {
      return { ok: true, status: 200, json: async () => tickersFixture } as Response
    }
    if (url.includes('/api/xbrl/companyfacts/')) {
      return { ok: true, status: 200, json: async () => novoFactsFixture } as Response
    }
    if (url.includes('/submissions/')) {
      return { ok: true, status: 200, json: async () => novoSubsFixture } as Response
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as unknown as typeof fetch
}

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
    // us-gaap filer reports in USD.
    expect(f.currency).toBe('USD')

    const la = f.latest_annual
    expect(la.currency).toBe('USD')
    expect(la.fiscal_year).toBe(2025)
    expect(la.net_income_musd).toBeCloseTo(8099, 1)
    expect(la.revenue_musd).toBeCloseTo(275235, 1)
    expect(la.d_and_a_musd).toBeCloseTo(2426, 1)
    expect(la.capex_musd).toBeCloseTo(5498, 1)
    expect(la.sbc_musd).toBeCloseTo(860, 1)
    expect(la.diluted_shares_m).toBeCloseTo(444.8, 1)
  })

  it('resolves the Shariah-ratio inputs (revenue via Excluding, debt via LT components, cash + securities)', async () => {
    // Regression guard for the concept-precedence broadening: COST must keep using the EXCLUDING revenue
    // variant (275235), summed LT debt components (noncurrent 5713 + current 75), and cash + short-term
    // investments (14161 + 1123) — i.e. the broadened mapping must not regress a filer that already worked.
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.revenue_musd).toBeCloseTo(275235, 1)
    expect(la.total_debt_musd).toBeCloseTo(5788, 1)
    expect(la.cash_and_securities_musd).toBeCloseTo(15284, 1)
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

describe('fetchCompanyFundamentals (NVO / Novo Nordisk — IFRS + DKK + 20-F, fixture-driven)', () => {
  it('parses ifrs-full concepts in the reporting currency (DKK), values in millions of DKK', async () => {
    const f = await fetchCompanyFundamentals('NVO', { fetchImpl: fakeNovoFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.cik).toBe('0000353278')
    expect(f.entity_name).toBe('NOVO NORDISK A/S')
    // Reporting currency is detected from the XBRL unit key, not assumed USD.
    expect(f.currency).toBe('DKK')

    const la = f.latest_annual
    expect(la.currency).toBe('DKK')
    expect(la.fiscal_year).toBe(2025)
    // ifrs-full:ProfitLoss FY2025 = 102,434,000,000 DKK -> 102434 DKK millions.
    expect(la.net_income_musd).toBeCloseTo(102434, 0)
    // ifrs-full:Revenue FY2025 = 309,064,000,000 DKK.
    expect(la.revenue_musd).toBeCloseTo(309064, 0)
    // ifrs-full:DepreciationAndAmortisationExpense FY2025 = 14,666,000,000 DKK.
    expect(la.d_and_a_musd).toBeCloseTo(14666, 0)
    // capex = PPE purchases (60,140) + intangible purchases (29,973) = 90,113 DKK millions.
    expect(la.capex_musd).toBeCloseTo(90113, 0)
    // ifrs-full:ExpenseFromSharebasedPaymentTransactionsWithEmployees FY2025 = 1,435,000,000 DKK.
    expect(la.sbc_musd).toBeCloseTo(1435, 0)
    // AdjustedWeightedAverageShares FY2025 = 4,447,700,000 -> 4447.7 share-millions.
    expect(la.diluted_shares_m).toBeCloseTo(4447.7, 1)
  })

  it('maps the incremental-ROIC inputs from ifrs-full (operating income, tax, equity, debt, cash)', async () => {
    const f = await fetchCompanyFundamentals('NVO', { fetchImpl: fakeNovoFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.operating_income_musd).toBeCloseTo(127658, 0)
    expect(la.income_tax_expense_musd).toBeCloseTo(28106, 0)
    expect(la.stockholders_equity_musd).toBeCloseTo(194047, 0)
    // total interest-bearing debt: ifrs-full:Borrowings = 130,958 DKK millions.
    expect(la.total_debt_musd).toBeCloseTo(130958, 0)
    expect(la.cash_and_securities_musd).toBeCloseTo(26464, 0)
  })

  it('builds the latest 20-F archive URL from submissions', async () => {
    const f = await fetchCompanyFundamentals('NVO', { fetchImpl: fakeNovoFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const annual = f.filings.find((x) => x.form === '20-F')
    expect(annual).toBeDefined()
    expect(annual?.url).toMatch(/nvo-20251231\.htm$/)
    expect(annual?.url).toContain('https://www.sec.gov/Archives/edgar/data/353278/')
    expect(annual?.url).toContain('000035327826000012')
  })

  it('exposes a multi-year annual series (>=5 yrs), newest first, each carrying a filed date', async () => {
    const f = await fetchCompanyFundamentals('NVO', { fetchImpl: fakeNovoFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.annual_series.length).toBeGreaterThanOrEqual(5)
    expect(f.annual_series[0]?.fiscal_year).toBe(2025)
    const years = f.annual_series.map((a) => a.fiscal_year)
    for (let i = 1; i < years.length; i++) {
      expect(years[i]! < years[i - 1]!).toBe(true)
    }
    // every year should carry a 20-F filed date (needed for the as-of backtest).
    expect(f.annual_series.every((a) => typeof a.filed === 'string' && a.filed !== '')).toBe(true)
  })
})

describe('fetchCompanyFundamentals (CPRT / Copart FY2025 — broadened concept mapping, fixture-driven)', () => {
  // CPRT exercises three filer quirks that previously left the Shariah-ratio inputs undefined:
  //  1. Revenue is tagged RevenueFromContractWithCustomerIncludingAssessedTax (the EXCLUDING variant is
  //     absent), and the `Revenues` tag carries only a 525.659M Q4 PARTIAL — precedence + the annual-
  //     duration filter must land on the 4,646.958M full-year figure, never the 525M partial.
  //  2. CPRT carries no LongTermDebt for FY2025 (term loan repaid); its only interest-bearing liability is
  //     a finance lease, so debt must fall through to FinanceLeaseLiability rather than coming back undefined.
  //  3. CPRT discontinued CashAndCashEquivalentsAtCarryingValue after FY2019; FY2025 cash sits under
  //     CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents — cash must fall through to it and add
  //     the held-to-maturity short-term securities.
  it('resolves revenue from the Including variant (4646.958), never the 525.659 partial', async () => {
    const f = await fetchCompanyFundamentals('0000900075', { fetchImpl: fakeCprtFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.cik).toBe('0000900075')
    expect(f.entity_name).toBe('COPART, INC.')
    expect(f.currency).toBe('USD')
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.revenue_musd).toBeCloseTo(4646.958, 2)
    // The 525.659M Q4 partial under `Revenues` must NEVER be selected as the annual figure.
    expect(la.revenue_musd).not.toBeCloseTo(525.659, 2)
  })

  it('resolves total debt from the finance-lease fallback when LongTermDebt is absent', async () => {
    const f = await fetchCompanyFundamentals('0000900075', { fetchImpl: fakeCprtFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    // CPRT FY2025: only interest-bearing liability is the finance lease (2.705M). Resolving (not undefined)
    // is what lets the AAOIFI debt ratio compute honestly for an effectively debt-free filer.
    expect(la.total_debt_musd).toBeCloseTo(2.705, 3)
  })

  it('resolves cash via the restricted-cash fallback plus held-to-maturity securities', async () => {
    const f = await fetchCompanyFundamentals('0000900075', { fetchImpl: fakeCprtFetch() })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    // cash 2780.531 (CashCashEquivalentsRestricted...) + HTM securities 2008.539 = 4789.07.
    expect(la.cash_and_securities_musd).toBeCloseTo(4789.07, 2)
  })
})
