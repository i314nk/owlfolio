import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetTickerCacheForTests, demonstratedOwnerEarningsGrowth, fetchCompanyFundamentals, ownerEarningsCagr, ownerEarningsPerShareSeries, resolveCik, type AnnualFacts } from '../secEdgar'

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
const wmtFactsFixture = fixture('wmt-companyfacts.json')
const msftFactsFixture = fixture('msft-companyfacts.json')
const googlFactsFixture = fixture('googl-companyfacts.json')
const maFactsFixture = fixture('ma-companyfacts.json')
const tmFactsFixture = fixture('tm-companyfacts.json')

/** A fetch that serves the given trimmed companyfacts fixture for any CIK lookup + empty submissions. */
function fakeFactsFetch(factsBlob: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/xbrl/companyfacts/')) {
      return { ok: true, status: 200, json: async () => factsBlob } as Response
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

  it('surfaces the SIC code + description from submissions onto Fundamentals', async () => {
    const submissions = {
      cik: '0000909832',
      name: 'COSTCO WHOLESALE CORP /NEW',
      sic: '7372',
      sicDescription: 'Services-Prepackaged Software',
      filings: { recent: {} },
    }
    const f = await fetchCompanyFundamentals('COST', {
      fetchImpl: fakeFetch({ '/submissions/': { json: submissions } }),
    })
    expect(f).toBeDefined()
    expect(f?.sic).toBe('7372')
    expect(f?.sic_description).toBe('Services-Prepackaged Software')
  })

  it('trims a padded SIC value but does not coerce/pad it', async () => {
    const submissions = {
      sic: '  7372  ',
      sicDescription: '  Services-Prepackaged Software  ',
      filings: { recent: {} },
    }
    const f = await fetchCompanyFundamentals('COST', {
      fetchImpl: fakeFetch({ '/submissions/': { json: submissions } }),
    })
    expect(f?.sic).toBe('7372')
    expect(f?.sic_description).toBe('Services-Prepackaged Software')
  })

  it('leaves SIC fields undefined (fail-open) when submissions lack them', async () => {
    // The captured COST submissions fixture carries no top-level sic/sicDescription.
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch() })
    expect(f).toBeDefined()
    expect(f?.sic).toBeUndefined()
    expect(f?.sic_description).toBeUndefined()
  })

  it('leaves SIC fields undefined (fail-open) when the submissions fetch errors', async () => {
    const f = await fetchCompanyFundamentals('COST', { fetchImpl: fakeFetch({ '/submissions/': 'throw' }) })
    expect(f).toBeDefined()
    // Structured facts still returned; SIC simply absent (never fabricated).
    expect(f?.latest_annual.fiscal_year).toBe(2025)
    expect(f?.sic).toBeUndefined()
    expect(f?.sic_description).toBeUndefined()
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

describe('fetchCompanyFundamentals — broadened concept coverage (latest-year-aware resolution)', () => {
  // FIX CLASS 1: D&A variant + latest-year preference. Walmart's `DepreciationDepletionAndAmortization`
  // FROZE at FY2019; the current D&A sits under `DepreciationAmortizationAndAccretionNet`. firstPopulated
  // would have returned the stale concept (it is non-empty); resolveLatestYearGroup must prefer the variant
  // reporting the most recent fiscal year. SBC likewise resolves via AllocatedShareBasedCompensationExpense.
  it('WMT: D&A resolves via the AccretionNet variant (not the frozen DDA concept), SBC via Allocated', async () => {
    const f = await fetchCompanyFundamentals('0000104169', { fetchImpl: fakeFactsFetch(wmtFactsFixture) })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2026)
    // Walmart FY2026 D&A = 14,203M via DepreciationAmortizationAndAccretionNet (NOT the 10,678M FY2019 stale).
    expect(la.d_and_a_musd).toBeCloseTo(14203, 0)
    expect(la.d_and_a_musd).not.toBeCloseTo(10678, 0)
    // SBC via AllocatedShareBasedCompensationExpense (ShareBasedCompensation is absent for Walmart).
    expect(la.sbc_musd).toBeCloseTo(3603, 0)
  })

  // FIX CLASS 2: summed split D&A. Microsoft tags only `Depreciation` (22,000M) and
  // `AmortizationOfIntangibleAssets` (6,000M), no combined concept. The summed-group fallback must yield
  // 28,000M — the true cash-flow D&A — rather than leaving the field undefined.
  it('MSFT: D&A resolves via the summed Depreciation + AmortizationOfIntangibleAssets fallback', async () => {
    const f = await fetchCompanyFundamentals('0000789019', { fetchImpl: fakeFactsFetch(msftFactsFixture) })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.d_and_a_musd).toBeCloseTo(28000, 0)
    expect(la.revenue_musd).toBeCloseTo(281724, 0)
  })

  // FIX CLASS 3: revenue via `Revenues` over a frozen ASC-606 contract concept. Alphabet's
  // `RevenueFromContractWithCustomerExcludingAssessedTax` froze at FY2024 (350,018M); FY2025 (402,836M) is
  // tagged only under `Revenues`. resolveLatestYearGroup must prefer `Revenues` by recency even though the
  // contract concept is higher-precedence (it wins ties, not staleness).
  it('GOOGL: revenue resolves to the current Revenues figure, not the frozen contract concept', async () => {
    const f = await fetchCompanyFundamentals('0001652044', { fetchImpl: fakeFactsFetch(googlFactsFixture) })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.revenue_musd).toBeCloseTo(402836, 0)
    expect(la.revenue_musd).not.toBeCloseTo(350018, 0)
    expect(la.net_income_musd).toBeCloseTo(132170, 0)
  })

  // FIX CLASS 4 (net income fallback): Mastercard's `NetIncomeLoss` froze at FY2013; the current bottom line
  // is tagged under `ProfitLoss`. The net-income precedence list must fall through to it by recency, AND
  // revenue must resolve to the current `Revenues` total.
  it('MA: net income resolves via ProfitLoss when NetIncomeLoss is frozen', async () => {
    const f = await fetchCompanyFundamentals('0001141391', { fetchImpl: fakeFactsFetch(maFactsFixture) })
    expect(f).toBeDefined()
    if (f === undefined) return
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.net_income_musd).toBeCloseTo(14968, 0)
    expect(la.revenue_musd).toBeCloseTo(32791, 0)
  })

  // FIX CLASS 5: latest-annual taxonomy selection (the Toyota stale-FY2020 bug). Toyota's `us-gaap` facts
  // FREEZE at FY2020 while its `ifrs-full` facts run to FY2025 (it converted reporting bases). pickTaxonomy
  // must choose the taxonomy with the more RECENT annual data, so latest_annual is FY2025 (JPY) rather than
  // a five-year-stale FY2020 us-gaap period. Capex/SBC are genuinely untagged under ifrs-full -> undefined
  // (fail-closed), and must NOT be mislabelled from a partial component.
  it('TM: picks the current ifrs-full taxonomy over the stale FY2020 us-gaap bucket', async () => {
    const f = await fetchCompanyFundamentals('0001094517', { fetchImpl: fakeFactsFetch(tmFactsFixture) })
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.currency).toBe('JPY')
    const la = f.latest_annual
    expect(la.fiscal_year).toBe(2025)
    expect(la.revenue_musd).toBeCloseTo(48036704, 0)
    expect(la.net_income_musd).toBeCloseTo(4789755, 0)
    expect(la.d_and_a_musd).toBeCloseTo(2251233, 0)
    // No clean PP&E-purchase concept under ifrs-full -> capex honestly undefined (requireFirst guard prevents
    // a wrong-magnitude intangibles-only fill); SBC likewise untagged.
    expect(la.capex_musd).toBeUndefined()
    expect(la.sbc_musd).toBeUndefined()
  })
})

describe('annual_series spans concept transitions (per-year per-field resolution)', () => {
  const M = 1_000_000 // values are stored raw in the XBRL; the adapter divides $ and shares by 1e6.
  // Build a us-gaap annual fact array for one concept: one full-year (10-K) duration fact per year.
  // `scale` defaults to 1e6 so the test inputs read in $millions / share-millions; pass 1 for a ratio (EPS).
  function annualFacts(values: Record<number, number>, unit = 'USD', scale = M): unknown {
    const units: Record<string, unknown[]> = { [unit]: [] }
    for (const [yearStr, val] of Object.entries(values)) {
      const year = Number(yearStr)
      ;(units[unit] as unknown[]).push({
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        val: val * scale,
        form: '10-K',
        fy: year,
        fp: 'FY',
        filed: `${year + 1}-02-15`,
        frame: `CY${year}`,
      })
    }
    return { label: 'x', units }
  }
  // Build an instant (balance-sheet) fact array for one concept: one period-end fact per year.
  function instantFacts(values: Record<number, number>, unit = 'USD', scale = M): unknown {
    const units: Record<string, unknown[]> = { [unit]: [] }
    for (const [yearStr, val] of Object.entries(values)) {
      const year = Number(yearStr)
      ;(units[unit] as unknown[]).push({ end: `${year}-12-31`, val: val * scale, form: '10-K', fy: year, fp: 'FY', filed: `${year + 1}-02-15` })
    }
    return { label: 'x', units }
  }

  // FIX: a filer that SWITCHED its revenue tag mid-history. The old ASC-606 contract concept carries
  // 2016-2022; the consolidated `Revenues` total carries 2023-2025 (the current tag). The series must span
  // the UNION (2016-2025), resolving each year from whichever concept reports it (per-year precedence),
  // while latest_annual stays the most-recent-year value from the new concept.
  it('spans the union of years when a filer switches the revenue concept mid-history', async () => {
    const facts = {
      entityName: 'TransitionCo',
      facts: {
        'us-gaap': {
          // old concept: 2016-2022
          RevenueFromContractWithCustomerExcludingAssessedTax: annualFacts({ 2016: 100, 2017: 110, 2018: 120, 2019: 130, 2020: 140, 2021: 150, 2022: 160 }),
          // new concept: 2023-2025 (the filer moved the consolidated total here)
          Revenues: annualFacts({ 2023: 200, 2024: 220, 2025: 240 }),
          NetIncomeLoss: annualFacts({ 2016: 10, 2017: 11, 2018: 12, 2019: 13, 2020: 14, 2021: 15, 2022: 16, 2023: 20, 2024: 22, 2025: 24 }),
          StockholdersEquity: instantFacts({ 2016: 50, 2017: 55, 2018: 60, 2019: 65, 2020: 70, 2021: 75, 2022: 80, 2023: 90, 2024: 100, 2025: 110 }),
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    if (f === undefined) return
    const years = f.annual_series.map((a) => a.fiscal_year)
    // Series spans 2016..2025 (the union), newest first.
    expect(years).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016])
    // latest_annual is the most-recent-year value, from the NEW concept.
    expect(f.latest_annual.fiscal_year).toBe(2025)
    expect(f.latest_annual.revenue_musd).toBeCloseTo(240, 0)
    // An OLD-concept year still carries its revenue (would have been dropped if the series followed only the
    // recency-winning `Revenues` group, which is the GOOGL 16-month truncation bug).
    const fy2016 = f.annual_series.find((a) => a.fiscal_year === 2016)
    expect(fy2016?.revenue_musd).toBeCloseTo(100, 0)
    const fy2022 = f.annual_series.find((a) => a.fiscal_year === 2022)
    expect(fy2022?.revenue_musd).toBeCloseTo(160, 0)
    // The boundary year (2023) is the first new-concept year.
    const fy2023 = f.annual_series.find((a) => a.fiscal_year === 2023)
    expect(fy2023?.revenue_musd).toBeCloseTo(200, 0)
  })

  // Shariah purification input: interest income extracted deterministically from XBRL (no filing has an
  // "impermissible income" line; the AAOIFI-computable proxy is disclosed interest income). MSFT-style
  // filers tag the combined `InvestmentIncomeInterestAndDividend`; the pure `InvestmentIncomeInterest`
  // is preferred when present (the combined variant conservatively overcounts by including dividends).
  it('extracts interest income per year, preferring the pure interest concept over the combined variant', async () => {
    const facts = {
      entityName: 'InterestCo',
      facts: {
        'us-gaap': {
          NetIncomeLoss: annualFacts({ 2024: 100, 2025: 110 }),
          Revenues: annualFacts({ 2024: 1000, 2025: 1100 }),
          // Pure interest tagged only for 2025; the combined variant spans both years.
          InvestmentIncomeInterest: annualFacts({ 2025: 30 }),
          InvestmentIncomeInterestAndDividend: annualFacts({ 2024: 25, 2025: 32 }),
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    if (f === undefined) return
    // 2025 resolves from the PURE interest concept (30, not the combined 32).
    expect(f.latest_annual.interest_income_musd).toBeCloseTo(30, 0)
    // 2024 falls back to the combined variant (conservative overcount accepted).
    const fy2024 = f.annual_series.find((a) => a.fiscal_year === 2024)
    expect(fy2024?.interest_income_musd).toBeCloseTo(25, 0)
  })

  // FIX (as-of staleness bug): the `filed` availability date must be FIRST-disclosure (earliest 10-K that
  // reported the period), NOT the latest comparative. A 10-K restates 2-3 prior years as comparatives, so
  // latest-filed-wins tagged every fiscal year with a filing ~2-3 yrs too late and made the as-of backtest
  // value each month on stale fundamentals (e.g. KO-as-of-2020 used the FY2017 one-time-charge trough).
  it('uses the FIRST-disclosure (earliest) filed date per fiscal year, not the latest comparative', async () => {
    // FY2020 NetIncomeLoss appears in the original FY2020 10-K (filed 2021-02-15) AND again as a comparative
    // in the FY2022 10-K (filed 2023-02-15). The availability date must be the EARLIEST.
    const facts = {
      entityName: 'FiledDateCo',
      facts: {
        'us-gaap': {
          NetIncomeLoss: {
            label: 'x',
            units: {
              USD: [
                { start: '2020-01-01', end: '2020-12-31', val: 100 * M, form: '10-K', fy: 2020, fp: 'FY', filed: '2021-02-15' },
                { start: '2020-01-01', end: '2020-12-31', val: 100 * M, form: '10-K', fy: 2022, fp: 'FY', filed: '2023-02-15' },
                { start: '2021-01-01', end: '2021-12-31', val: 110 * M, form: '10-K', fy: 2021, fp: 'FY', filed: '2022-02-15' },
                { start: '2022-01-01', end: '2022-12-31', val: 120 * M, form: '10-K', fy: 2022, fp: 'FY', filed: '2023-02-15' },
              ],
            },
          },
          StockholdersEquity: instantFacts({ 2020: 50, 2021: 55, 2022: 60 }),
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000000002', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    const fy2020 = f?.annual_series.find((a) => a.fiscal_year === 2020)
    expect(fy2020?.filed).toBe('2021-02-15') // first disclosure, NOT the 2023-02-15 comparative
  })

  // FIX (MCD units bug): a filer that, in its recent 10-Ks, RE-TAGS the weighted-average diluted-share
  // count in MILLIONS (e.g. val=751.8) for a period it previously tagged as an ABSOLUTE count
  // (val=751800000) — a 1e6 scale discontinuity within the same concept+unit. "Latest filed wins" would
  // pick the mis-scaled 751.8 and, after /1e6, produce diluted_shares_m ≈ 0.00075 → a division-by-near-
  // zero that made MCD "BUY" every month in the backtest. The resolver must reject the power-of-ten
  // scale shift and keep the consistently-scaled count, so the latest year resolves to ~751.8 MILLION.
  it('rejects a power-of-ten share-count restatement (MCD millions-vs-absolute units bug)', async () => {
    // The dominant (modal) scale is the ABSOLUTE count tagged across the older years; the recent years are
    // re-tagged in millions (val=751.8 / 741.3), a 1e6 power-of-ten artifact the resolver must rescale back.
    const shareUnits: Record<string, unknown[]> = {
      shares: [
        // older years: absolute counts (~hundreds of millions) — establish the modal magnitude
        { start: '2018-01-01', end: '2018-12-31', val: 785_600_000, form: '10-K', fy: 2018, fp: 'FY', filed: '2021-02-23' },
        { start: '2019-01-01', end: '2019-12-31', val: 764_900_000, form: '10-K', fy: 2019, fp: 'FY', filed: '2022-02-24' },
        { start: '2020-01-01', end: '2020-12-31', val: 750_100_000, form: '10-K', fy: 2020, fp: 'FY', filed: '2023-02-24' },
        // 2021: original absolute count, then a later re-tag in millions (the val is literally 751.8).
        { start: '2021-01-01', end: '2021-12-31', val: 751_800_000, form: '10-K', fy: 2021, fp: 'FY', filed: '2022-02-24' },
        { start: '2021-01-01', end: '2021-12-31', val: 751.8, form: '10-K', fy: 2023, fp: 'FY', filed: '2024-02-22' },
        // 2022: ONLY the millions-scaled value exists (no absolute sibling) — must still be rescaled.
        { start: '2022-01-01', end: '2022-12-31', val: 741.3, form: '10-K', fy: 2023, fp: 'FY', filed: '2024-02-22' },
      ],
    }
    const facts = {
      entityName: 'UnitsRestateCo',
      facts: {
        'us-gaap': {
          NetIncomeLoss: annualFacts({ 2018: 5924, 2019: 6025, 2020: 4730, 2021: 7545, 2022: 6177 }),
          Revenues: annualFacts({ 2018: 21025, 2019: 21364, 2020: 19208, 2021: 23223, 2022: 23183 }),
          WeightedAverageNumberOfDilutedSharesOutstanding: { label: 'x', units: shareUnits },
          StockholdersEquity: instantFacts({ 2018: 5000, 2019: 5000, 2020: 5000, 2021: 5000, 2022: 5000 }),
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000063908', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    if (f === undefined) return
    // 2021: the mis-scaled 751.8 restatement is rescaled back to ~751.8 MILLION (not 0.00075).
    const fy2021 = f.annual_series.find((a) => a.fiscal_year === 2021)
    expect(fy2021?.diluted_shares_m).toBeCloseTo(751.8, 1)
    // 2022: only the millions-scaled value exists; the modal absolute scale rescales it to ~741.3 MILLION.
    const fy2022 = f.annual_series.find((a) => a.fiscal_year === 2022)
    expect(fy2022?.diluted_shares_m).toBeCloseTo(741.3, 1)
    // older absolute-count years are untouched.
    const fy2020 = f.annual_series.find((a) => a.fiscal_year === 2020)
    expect(fy2020?.diluted_shares_m).toBeCloseTo(750.1, 1)
    // sanity: no near-zero share count slipped through (the original bug).
    for (const a of f.annual_series) {
      if (a.diluted_shares_m !== undefined) expect(a.diluted_shares_m).toBeGreaterThan(1)
    }
  })

  // FIX: GOOGL-style diluted-share truncation. The weighted-average diluted-share concept is only tagged for
  // the recent years (2023-2025), but diluted EPS spans the full history (2016-2025). Per-share owner
  // earnings (the backtest denominator) must be recoverable for the older years by deriving the
  // weighted-average diluted shares as net_income / diluted_EPS — a consolidated-over-consolidated figure.
  it('derives diluted shares from net income / diluted EPS for years the weighted-average concept omits', async () => {
    const facts = {
      entityName: 'EpsDeriveCo',
      facts: {
        'us-gaap': {
          NetIncomeLoss: annualFacts({ 2016: 1000, 2017: 1100, 2018: 1200, 2023: 2000, 2024: 2200, 2025: 2400 }),
          Revenues: annualFacts({ 2016: 5000, 2017: 5500, 2018: 6000, 2023: 9000, 2024: 9500, 2025: 10000 }),
          // weighted-average diluted shares only tagged for the recent years
          WeightedAverageNumberOfDilutedSharesOutstanding: annualFacts({ 2023: 200, 2024: 205, 2025: 210 }, 'shares'),
          // diluted EPS spans the full history (so shares can be derived for 2016-2018); a ratio, not $millions.
          EarningsPerShareDiluted: annualFacts({ 2016: 5, 2017: 5.5, 2018: 6, 2023: 10, 2024: 10.7, 2025: 11.4 }, 'USD/shares', 1),
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000000002', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    if (f === undefined) return
    // The recent years keep the tagged weighted-average diluted share count (unchanged).
    expect(f.latest_annual.fiscal_year).toBe(2025)
    expect(f.latest_annual.diluted_shares_m).toBeCloseTo(210, 0)
    // 2016: weighted-average concept absent -> derived = NI(1000) / EPS(5) = 200 (millions).
    const fy2016 = f.annual_series.find((a) => a.fiscal_year === 2016)
    expect(fy2016?.diluted_shares_m).toBeCloseTo(200, 0)
    const fy2018 = f.annual_series.find((a) => a.fiscal_year === 2018)
    expect(fy2018?.diluted_shares_m).toBeCloseTo(200, 0) // 1200 / 6
    // A tagged year is NOT overwritten by the derived value.
    const fy2024 = f.annual_series.find((a) => a.fiscal_year === 2024)
    expect(fy2024?.diluted_shares_m).toBeCloseTo(205, 0)
  })
})

describe('demonstratedOwnerEarningsGrowth — robust log-linear OE/share growth', () => {
  // Helper: build an AnnualFacts year whose owner-earnings/share equals exactly `oePs`.
  // ownerEarningsPerShareSeries computes OE = ni + da - min(da,capex) - sbc, OE/share = OE / shares.
  // With da === capex (maintenance capex = da, cancels) and sbc = 0: OE = ni, so OE/share = ni / shares.
  // We fix shares and set ni = oePs * shares to land OE/share on the target exactly.
  function yr(fiscal_year: number, oePs: number, shares = 100, opts?: { da?: number }): AnnualFacts {
    const da = opts?.da ?? 50
    return {
      fiscal_year,
      currency: 'USD',
      net_income_musd: oePs * shares,
      d_and_a_musd: da,
      capex_musd: da, // equal so maintenance capex cancels D&A -> OE = ni
      sbc_musd: 0,
      diluted_shares_m: shares,
    }
  }

  it('recovers a clean ~15%/yr compounder via log-linear regression', () => {
    const series: AnnualFacts[] = []
    let oe = 1
    for (let fy = 2014; fy <= 2023; fy++) {
      series.push(yr(fy, oe))
      oe *= 1.15
    }
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.method).toBe('log_linear_regression')
    expect(r.points_used).toBe(10)
    expect(r.window_years).toBe(9)
    expect(r.growth).toBeDefined()
    expect(r.growth!).toBeCloseTo(0.15, 3)
  })

  it('is NOT whipsawed by a single trough endpoint (where endpoint CAGR is)', () => {
    // A ~12%/yr trend, but the FINAL year collapses to a one-time trough.
    const series: AnnualFacts[] = []
    let oe = 2
    for (let fy = 2014; fy <= 2022; fy++) {
      series.push(yr(fy, oe))
      oe *= 1.12
    }
    // 2023: one-time charge drives OE/share to a deep trough.
    series.push(yr(2023, oe * 0.25))

    const robust = demonstratedOwnerEarningsGrowth(series)
    const endpoint = ownerEarningsCagr(ownerEarningsPerShareSeries(series))
    expect(endpoint).toBeDefined()
    // The endpoint CAGR is dragged badly negative by the trough; the robust slope stays near the trend.
    expect(endpoint!).toBeLessThan(0.0)
    expect(robust.growth).toBeDefined()
    // The robust slope stays clearly POSITIVE despite the trough (one outlier cannot flip the sign),
    // whereas the endpoint CAGR is dragged negative.
    expect(robust.growth!).toBeGreaterThan(0.02)
    // robust is materially higher (less whipsawed) than the endpoint measure.
    expect(robust.growth! - endpoint!).toBeGreaterThan(0.05)
  })

  it('is NOT whipsawed by a single spike endpoint', () => {
    // Flat ~3%/yr but the FIRST (anchor) year is an artificial peak — endpoint CAGR anchors low.
    const series: AnnualFacts[] = []
    series.push(yr(2014, 10)) // artificial peak anchor
    let oe = 3
    for (let fy = 2015; fy <= 2023; fy++) {
      series.push(yr(fy, oe))
      oe *= 1.05
    }
    const robust = demonstratedOwnerEarningsGrowth(series)
    const endpoint = ownerEarningsCagr(ownerEarningsPerShareSeries(series))
    expect(robust.growth).toBeDefined()
    expect(endpoint).toBeDefined()
    // endpoint anchors on the 10 peak -> strongly negative; robust regression rides the body of the series.
    expect(endpoint!).toBeLessThan(robust.growth!)
  })

  it('detects and back-adjusts a clean 2:1 split, recovering the true underlying rate', () => {
    // True OE/share grows 10%/yr on a pre-split basis. At FY2019 a 2:1 split doubles shares; NI continuous.
    // Pre-split shares = 100, post-split shares = 200. OE/share HALVES at the split with no earnings change.
    const series: AnnualFacts[] = []
    let oe = 1 // pre-split OE/share basis
    for (let fy = 2014; fy <= 2023; fy++) {
      const split = fy >= 2019
      const shares = split ? 200 : 100
      // ni continuous: ni = oe * 100 (pre-split economics); post-split OE/share = ni/200 = oe/2.
      const ni = oe * 100
      series.push({
        fiscal_year: fy,
        currency: 'USD',
        net_income_musd: ni,
        d_and_a_musd: 50,
        capex_musd: 50,
        sbc_musd: 0,
        diluted_shares_m: shares,
      })
      oe *= 1.1
    }
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.method).toBe('log_linear_regression')
    expect(r.flags.some((f) => /split/i.test(f))).toBe(true)
    expect(r.flags.some((f) => /2/.test(f) && /FY2019/.test(f))).toBe(true)
    expect(r.growth).toBeDefined()
    // After back-adjustment the per-share series is continuous at the true 10% rate.
    expect(r.growth!).toBeCloseTo(0.1, 2)
  })

  it('detects and back-adjusts a 7:1 split', () => {
    const series: AnnualFacts[] = []
    let oe = 1
    for (let fy = 2014; fy <= 2023; fy++) {
      const split = fy >= 2018
      const shares = split ? 700 : 100
      const ni = oe * 100
      series.push({
        fiscal_year: fy,
        currency: 'USD',
        net_income_musd: ni,
        d_and_a_musd: 50,
        capex_musd: 50,
        sbc_musd: 0,
        diluted_shares_m: shares,
      })
      oe *= 1.08
    }
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.flags.some((f) => /split/i.test(f) && /7/.test(f))).toBe(true)
    expect(r.growth!).toBeCloseTo(0.08, 2)
  })

  it('handles a reverse split (1:5)', () => {
    // Reverse split at FY2020: shares drop 5x (100 -> 20), NI continuous -> OE/share jumps 5x.
    const series: AnnualFacts[] = []
    let oe = 1
    for (let fy = 2015; fy <= 2024; fy++) {
      const reverse = fy >= 2020
      const shares = reverse ? 20 : 100
      const ni = oe * 100
      series.push({
        fiscal_year: fy,
        currency: 'USD',
        net_income_musd: ni,
        d_and_a_musd: 50,
        capex_musd: 50,
        sbc_musd: 0,
        diluted_shares_m: shares,
      })
      oe *= 1.06
    }
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.flags.some((f) => /split/i.test(f))).toBe(true)
    expect(r.growth!).toBeCloseTo(0.06, 2)
  })

  it('flags a non-split per-share discontinuity but still returns the regression value', () => {
    // OE/share drops ~3x in one year with NO share-count step AND earnings also dropped (a real
    // operational discontinuity, not a split). Must NOT be silently adjusted; residual flag set.
    const series: AnnualFacts[] = []
    let oe = 2
    for (let fy = 2014; fy <= 2019; fy++) {
      series.push(yr(fy, oe))
      oe *= 1.05
    }
    // FY2020: OE/share collapses ~3x via an earnings drop, shares unchanged.
    series.push(yr(2020, oe / 3))
    oe = oe / 3
    for (let fy = 2021; fy <= 2023; fy++) {
      oe *= 1.05
      series.push(yr(fy, oe))
    }
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.flags.some((f) => /residual_discontinuity/i.test(f))).toBe(true)
    expect(r.growth).toBeDefined()
    expect(r.method).toBe('log_linear_regression')
  })

  it('fails closed (insufficient_data) with fewer than 3 positive points', () => {
    const series: AnnualFacts[] = [yr(2022, 1), yr(2023, 1.1)]
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.method).toBe('insufficient_data')
    expect(r.growth).toBeUndefined()
  })

  it('fails closed on an empty series', () => {
    const r = demonstratedOwnerEarningsGrowth([])
    expect(r.method).toBe('insufficient_data')
    expect(r.growth).toBeUndefined()
    expect(r.points_used).toBe(0)
  })

  it('fails closed when positive points are too few after dropping non-positive OE/share', () => {
    // Only 2 positive OE/share years; the rest are negative (loss years) -> insufficient_data.
    const series: AnnualFacts[] = [
      yr(2019, -1),
      yr(2020, -2),
      yr(2021, 1),
      yr(2022, 1.2),
      yr(2023, -1),
    ]
    const r = demonstratedOwnerEarningsGrowth(series)
    expect(r.method).toBe('insufficient_data')
    expect(r.growth).toBeUndefined()
  })
})

describe('10-Q numbers are quarantined from the annual recompute (Slice B)', () => {
  it('a 10-Q fact never enters annual_series — only annual-form facts do', async () => {
    const facts = {
      cik: 1,
      entityName: 'TESTCO',
      facts: {
        'us-gaap': {
          NetIncomeLoss: {
            units: {
              USD: [
                { start: '2025-01-01', end: '2025-12-31', val: 1_000_000_000, fy: 2025, fp: 'FY', form: '10-K', filed: '2026-02-01' },
                // A 10-Q tagged with a full-year-duration period: the FORM guard (not just the duration
                // guard) must exclude it, so its huge value never lands in annual_series.
                { start: '2024-10-01', end: '2025-09-30', val: 999_000_000_000, fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-11-01' },
              ],
            },
          },
        },
      },
    }
    const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
    expect(f).toBeDefined()
    expect(f!.latest_annual.fiscal_year).toBe(2025)
    // The 10-K value (1e9 / 1e6 = 1000), NOT the 10-Q's 999,000 — interim numbers stay out of the recompute.
    expect(f!.latest_annual.net_income_musd).toBe(1000)
  })
})
