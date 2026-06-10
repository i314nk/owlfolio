// SEC EDGAR fundamentals feed.
//
// Pulls PRIMARY-filing data (structured XBRL companyfacts + the latest annual-report filing URL) for a
// company so the research swarm can ground on raw filings instead of dropping when IR/news is
// blocked. Mirrors marketData.ts conventions: injectable fetch, SSRF guard (here narrowed to the
// two SEC hosts), explicit timeouts, and FAIL-CLOSED behaviour — any error returns undefined and
// never throws to the caller, so the swarm runs exactly as today when EDGAR is unavailable.
//
// Taxonomy + currency: a US domestic filer reports under the `us-gaap` taxonomy in USD on a 10-K; a
// foreign private issuer (e.g. Novo Nordisk) reports under `ifrs-full` in its functional currency
// (e.g. DKK) on a 20-F (or 40-F for Canadian filers). This adapter reads whichever taxonomy is
// populated, detects the reporting CURRENCY from the XBRL unit key (e.g. 'USD', 'DKK'), and surfaces it
// on the result so a caller never silently mixes a non-USD fundamental with a USD price.
//
// Values are converted to Owlfolio's owner-earnings-bridge convention: monetary amounts -> MILLIONS of
// the REPORTING CURRENCY (/1e6), shares -> MILLIONS (/1e6). The `currency` field carries the unit.

import { assertPublicHttpUrl } from './sourceGrounding'

const SEC_ALLOWED_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const SEC_DEFAULT_TIMEOUT_MS = 15_000
const SEC_DEFAULT_USER_AGENT = 'Owlfolio research (local)'

export type SecEdgarDeps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

/**
 * Reporting currency ISO code as carried by the XBRL unit key (e.g. 'USD', 'DKK', 'EUR'). Kept as a
 * plain string (not a closed union) so any ISO code an EDGAR filer uses round-trips; common values are
 * 'USD' for us-gaap filers and the functional currency for ifrs-full foreign private issuers.
 */
export type ReportingCurrency = string

export type AnnualFacts = {
  fiscal_year: number
  /** Reporting currency for the monetary fields (e.g. 'USD', 'DKK'). Shares are always counts. */
  currency: ReportingCurrency
  /**
   * The date (YYYY-MM-DD) the 10-K reporting this fiscal year was filed with the SEC — i.e. the date
   * an analyst would first have had this annual data. Derived from the NetIncomeLoss filed date for the
   * fiscal year's period end (the canonical income-statement fact). Used by the calibration backtest to
   * pick the latest filing available as-of each historical month-end. May be absent if no filed date was
   * attached to the underlying fact.
   */
  filed?: string
  /** Period END date (YYYY-MM-DD) of the fiscal year, when derivable from the income-statement fact. */
  period_end?: string
  net_income_musd?: number
  revenue_musd?: number
  d_and_a_musd?: number
  capex_musd?: number
  sbc_musd?: number
  diluted_shares_m?: number
  shares_outstanding_m?: number
  total_debt_musd?: number
  cash_and_securities_musd?: number
  interest_expense_musd?: number
  /** Stockholders' equity (instant), $millions — for the invested-capital proxy. */
  stockholders_equity_musd?: number
  /** Operating income/loss (annual flow), $millions — for the NOPAT proxy. */
  operating_income_musd?: number
  /** Income tax expense/benefit (annual flow), $millions — for the effective-tax-rate NOPAT proxy. */
  income_tax_expense_musd?: number
}

export type FilingRef = {
  form: string
  filed: string
  url: string
}

export type Fundamentals = {
  cik: string
  entity_name: string
  /**
   * Reporting currency for all monetary fields in `latest_annual`/`annual_series` (e.g. 'USD' for a
   * us-gaap 10-K filer, 'DKK' for an ifrs-full 20-F filer like Novo Nordisk). A caller that values the
   * fundamentals against a market price MUST use a price quoted in the SAME currency (see backtest's
   * price_currency caveat) — never mix a non-USD fundamental with a USD ADR price.
   */
  currency: ReportingCurrency
  latest_annual: AnnualFacts
  annual_series: AnnualFacts[]
  filings: FilingRef[]
}

// ---------------------------------------------------------------------------
// SSRF guard narrowed to SEC hosts
// ---------------------------------------------------------------------------

function assertSecUrl(rawUrl: string): URL {
  const url = assertPublicHttpUrl(rawUrl)
  if (!SEC_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`SEC URL host not allowed: ${url.hostname}`)
  }
  return url
}

function resolveUserAgent(deps?: SecEdgarDeps): string {
  return deps?.userAgent
    ?? process.env['OWLFOLIO_SEC_USER_AGENT']
    ?? SEC_DEFAULT_USER_AGENT
}

/**
 * Fetch a SEC JSON document. Returns undefined fail-closed on any guard/timeout/HTTP/parse error.
 */
async function fetchSecJson<T>(rawUrl: string, deps?: SecEdgarDeps): Promise<T | undefined> {
  let url: URL
  try {
    url = assertSecUrl(rawUrl)
  } catch {
    return undefined
  }
  const fetchFn = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? SEC_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': resolveUserAgent(deps),
        'Accept': 'application/json',
      },
    })
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Ticker -> CIK
// ---------------------------------------------------------------------------

type CompanyTickersEntry = { cik_str?: number; ticker?: string; title?: string }
type CompanyTickers = Record<string, CompanyTickersEntry>

// Module-level cache for the (large-ish, slow-changing) ticker map. Keyed only by user agent so a
// test injecting a custom UA does not collide with the default. The injected fetch in tests bypasses
// the cache benefit but correctness is unaffected.
let tickerCache: CompanyTickers | undefined

function padCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, '')
  return digits.padStart(10, '0')
}

/**
 * Resolve a ticker to a zero-padded 10-digit CIK using SEC's company_tickers.json.
 * Fail-closed: returns undefined for an unknown/non-US ticker or any fetch error.
 */
export async function resolveCik(ticker: string, deps?: SecEdgarDeps): Promise<string | undefined> {
  const wanted = ticker.trim().toUpperCase()
  if (wanted.length === 0) return undefined

  let map = tickerCache
  if (map === undefined) {
    map = await fetchSecJson<CompanyTickers>('https://www.sec.gov/files/company_tickers.json', deps)
    if (map === undefined) return undefined
    tickerCache = map
  }

  for (const entry of Object.values(map)) {
    if (typeof entry?.ticker === 'string' && entry.ticker.toUpperCase() === wanted && entry.cik_str !== undefined) {
      return padCik(entry.cik_str)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// companyfacts parsing
// ---------------------------------------------------------------------------

type XbrlFact = {
  start?: string
  end?: string
  val?: number
  fy?: number
  fp?: string
  form?: string
  filed?: string
}

type TaxonomyConcepts = Record<string, { units?: Record<string, XbrlFact[]> }>

type CompanyFacts = {
  cik?: number
  entityName?: string
  facts?: {
    'us-gaap'?: TaxonomyConcepts
    'ifrs-full'?: TaxonomyConcepts
  }
}

/**
 * SEC XBRL taxonomies this adapter reads. A US domestic filer populates `us-gaap`; a foreign private
 * issuer populates `ifrs-full`. We prefer whichever is non-empty.
 */
type Taxonomy = 'us-gaap' | 'ifrs-full'

/** Annual-report form types we treat as the primary annual filing (10-K US, 20-F / 40-F foreign). */
const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F'])

function isAnnualForm(form: string | undefined): boolean {
  return typeof form === 'string' && ANNUAL_FORMS.has(form)
}

/** True when a taxonomy bucket has at least one concept with data. */
function taxonomyPopulated(t: TaxonomyConcepts | undefined): boolean {
  return t !== undefined && Object.keys(t).length > 0
}

/**
 * Pick the populated taxonomy (prefer us-gaap when both are present — US domestic filers occasionally
 * carry a few ifrs-full tags but us-gaap is canonical for them). Returns undefined when neither has data.
 */
function pickTaxonomy(facts: CompanyFacts): Taxonomy | undefined {
  if (taxonomyPopulated(facts.facts?.['us-gaap'])) return 'us-gaap'
  if (taxonomyPopulated(facts.facts?.['ifrs-full'])) return 'ifrs-full'
  return undefined
}

const NON_CURRENCY_UNITS = new Set(['shares', 'pure'])

/**
 * Detect the reporting currency from a concept's unit map: the first unit key that is not a count/ratio
 * unit (e.g. 'USD', 'DKK', 'EUR'). Returns undefined when only share/pure units are present.
 */
function currencyFromUnitMap(unitMap: Record<string, XbrlFact[]> | undefined): ReportingCurrency | undefined {
  if (unitMap === undefined) return undefined
  for (const unit of Object.keys(unitMap)) {
    if (!NON_CURRENCY_UNITS.has(unit)) return unit
  }
  return undefined
}

/**
 * Detect the filer's reporting currency by scanning the income/revenue concepts of the chosen taxonomy
 * for the first monetary unit key. Fail-closed: defaults to 'USD' only as a last resort so a us-gaap
 * filer with an oddly-shaped facts blob still behaves as today.
 */
function detectCurrency(facts: CompanyFacts, taxonomy: Taxonomy): ReportingCurrency {
  const concepts = taxonomy === 'us-gaap'
    ? ['NetIncomeLoss', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']
    : ['ProfitLoss', 'Revenue']
  const bucket = facts.facts?.[taxonomy]
  for (const c of concepts) {
    const cur = currencyFromUnitMap(bucket?.[c]?.units)
    if (cur !== undefined) return cur
  }
  return 'USD'
}

const ONE_DAY_MS = 86_400_000
// An annual flow period must span ~a year. Comparative income statements in a single 10-K are tagged
// with the FILING's fy/fp (e.g. fy:2025, fp:FY) for all three years shown, so we cannot trust fy/fp to
// identify the period — we derive the fiscal year from the period END date and use the START→END
// duration to keep only full-year (not quarterly/YTD) flow entries. Instant (balance-sheet) facts
// have no `start` and are kept as-is, keyed by their `end` date.
const ANNUAL_MIN_DAYS = 300
const ANNUAL_MAX_DAYS = 400

function periodDays(start: string, end: string): number | undefined {
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined
  return (e - s) / ONE_DAY_MS
}

/**
 * For a us-gaap concept, return a map of fiscal_year -> raw value. The fiscal year is derived from the
 * period END date's calendar year (SEC reports the period a fact covers via `end`); flow concepts are
 * filtered to ~annual durations so quarterly/YTD comparatives are excluded. When multiple filings
 * report the same period END (restatements / re-filings), the entry with the LATEST `filed` date wins.
 */
function annualByFiscalYear(facts: CompanyFacts, taxonomy: Taxonomy, concept: string): Map<number, number> {
  const out = new Map<number, number>()
  const unitMap = facts.facts?.[taxonomy]?.[concept]?.units
  if (unitMap === undefined) return out
  // pick the first unit bucket (the reporting currency or shares — each concept has a single relevant unit)
  const entries: XbrlFact[] = []
  for (const bucket of Object.values(unitMap)) {
    if (Array.isArray(bucket)) entries.push(...bucket)
  }

  // end-date -> {val, filed}; latest filed wins for a given period end.
  const byEnd = new Map<string, { val: number; filed: string }>()
  for (const e of entries) {
    if (!isAnnualForm(e.form)) continue
    if (typeof e.end !== 'string' || typeof e.val !== 'number' || !Number.isFinite(e.val)) continue
    // Flow facts have a start; require an annual duration. Instant facts have no start; keep them.
    if (typeof e.start === 'string') {
      const days = periodDays(e.start, e.end)
      if (days === undefined || days < ANNUAL_MIN_DAYS || days > ANNUAL_MAX_DAYS) continue
    }
    const filed = typeof e.filed === 'string' ? e.filed : ''
    const prior = byEnd.get(e.end)
    if (prior === undefined || filed > prior.filed) {
      byEnd.set(e.end, { val: e.val, filed })
    }
  }

  // Collapse period ends to fiscal years (year of the END date). If two period ends fall in the same
  // calendar year (rare — fiscal-period shifts), keep the later end date.
  const latestEndForYear = new Map<number, string>()
  for (const end of byEnd.keys()) {
    const fy = new Date(end).getUTCFullYear()
    const prior = latestEndForYear.get(fy)
    if (prior === undefined || end > prior) latestEndForYear.set(fy, end)
  }
  for (const [fy, end] of latestEndForYear) {
    const v = byEnd.get(end)
    if (v !== undefined) out.set(fy, v.val)
  }
  return out
}

/**
 * For a us-gaap flow concept, return a map of fiscal_year -> { filed, period_end } — the filing date
 * and period END of the 10-K that reported that fiscal year. Mirrors annualByFiscalYear's period
 * selection (latest filed wins per period end; latest period end wins per fiscal year) but surfaces the
 * filing metadata the calibration backtest needs to know which 10-K was available as-of a given month.
 */
function annualFiledMetaByFiscalYear(
  facts: CompanyFacts,
  taxonomy: Taxonomy,
  concept: string,
): Map<number, { filed: string; period_end: string }> {
  const out = new Map<number, { filed: string; period_end: string }>()
  const unitMap = facts.facts?.[taxonomy]?.[concept]?.units
  if (unitMap === undefined) return out
  const entries: XbrlFact[] = []
  for (const bucket of Object.values(unitMap)) {
    if (Array.isArray(bucket)) entries.push(...bucket)
  }

  const byEnd = new Map<string, { filed: string }>()
  for (const e of entries) {
    if (!isAnnualForm(e.form)) continue
    if (typeof e.end !== 'string' || typeof e.val !== 'number' || !Number.isFinite(e.val)) continue
    if (typeof e.start === 'string') {
      const days = periodDays(e.start, e.end)
      if (days === undefined || days < ANNUAL_MIN_DAYS || days > ANNUAL_MAX_DAYS) continue
    }
    const filed = typeof e.filed === 'string' ? e.filed : ''
    const prior = byEnd.get(e.end)
    if (prior === undefined || filed > prior.filed) {
      byEnd.set(e.end, { filed })
    }
  }

  const latestEndForYear = new Map<number, string>()
  for (const end of byEnd.keys()) {
    const fy = new Date(end).getUTCFullYear()
    const prior = latestEndForYear.get(fy)
    if (prior === undefined || end > prior) latestEndForYear.set(fy, end)
  }
  for (const [fy, end] of latestEndForYear) {
    const v = byEnd.get(end)
    if (v !== undefined && v.filed !== '') out.set(fy, { filed: v.filed, period_end: end })
  }
  return out
}

const CURRENCY_TO_MILLIONS = 1e6
const SHARES_TO_M = 1e6

function toMusd(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / CURRENCY_TO_MILLIONS
}

function toMshares(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / SHARES_TO_M
}

/**
 * Sum two optional raw-$ concepts, returning undefined only if BOTH are absent.
 * (e.g. total debt = long-term noncurrent + long-term current; either may be missing.)
 */
function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}

/**
 * Per-taxonomy concept name mapping. Each OE-bridge / incremental-ROIC input maps to a list of candidate
 * concept names tried in order (first populated wins). Some inputs are summed across multiple concepts
 * (handled explicitly in buildAnnualSeries, not here): total debt, cash+securities, capex (PPE + intangibles).
 */
type ConceptMap = {
  netIncome: string
  revenue: string[]
  dAndA: string[]
  /** Capex components summed together (PPE purchases + intangible purchases for IFRS). */
  capex: string[]
  sbc: string[]
  dilutedShares: string[]
  sharesOut: string[]
  /** Total interest-bearing debt: prefer the first combined concept; else sum the rest. */
  debtCombined: string[]
  debtComponents: string[]
  cash: string[]
  shortTermInvestments: string[]
  interest: string
  stockholdersEquity: string
  operatingIncome: string
  incomeTax: string
}

const US_GAAP_CONCEPTS: ConceptMap = {
  netIncome: 'NetIncomeLoss',
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues'],
  dAndA: ['DepreciationDepletionAndAmortization'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  sbc: ['ShareBasedCompensation'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  sharesOut: ['CommonStockSharesOutstanding'],
  debtCombined: ['DebtLongtermAndShorttermCombinedAmount'],
  debtComponents: ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  shortTermInvestments: ['ShortTermInvestments', 'MarketableSecuritiesCurrent'],
  interest: 'InterestExpense',
  stockholdersEquity: 'StockholdersEquity',
  operatingIncome: 'OperatingIncomeLoss',
  incomeTax: 'IncomeTaxExpenseBenefit',
}

// IFRS (ifrs-full) equivalents for a foreign private issuer's 20-F/40-F. Mapped per the probe of Novo
// Nordisk's companyfacts; concepts that may be absent for other filers degrade gracefully (-> undefined).
const IFRS_CONCEPTS: ConceptMap = {
  netIncome: 'ProfitLoss',
  revenue: ['Revenue'],
  // prefer the combined D&A expense; fall back to the depreciation/amortisation split if absent.
  dAndA: [
    'DepreciationAndAmortisationExpense',
    'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
  ],
  // capex = PPE purchases + intangible purchases (both summed in buildAnnualSeries).
  capex: [
    'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities',
  ],
  sbc: ['ExpenseFromSharebasedPaymentTransactionsWithEmployees'],
  // IFRS reports a basic (WeightedAverageShares) and a diluted (AdjustedWeightedAverageShares) count.
  dilutedShares: ['AdjustedWeightedAverageShares', 'WeightedAverageShares'],
  sharesOut: ['NumberOfSharesOutstanding'],
  // Total interest-bearing debt: prefer the single Borrowings rollup; else sum the LT/ST components.
  debtCombined: ['Borrowings'],
  debtComponents: ['LongtermBorrowings', 'ShorttermBorrowings'],
  cash: ['CashAndCashEquivalents'],
  shortTermInvestments: [],
  interest: 'InterestExpense',
  stockholdersEquity: 'Equity',
  operatingIncome: 'ProfitLossFromOperatingActivities',
  incomeTax: 'IncomeTaxExpenseContinuingOperations',
}

function conceptMapFor(taxonomy: Taxonomy): ConceptMap {
  return taxonomy === 'ifrs-full' ? IFRS_CONCEPTS : US_GAAP_CONCEPTS
}

/** First concept in the candidate list whose annual map is non-empty (else an empty map). */
function firstPopulated(facts: CompanyFacts, taxonomy: Taxonomy, concepts: string[]): Map<number, number> {
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    if (m.size > 0) return m
  }
  return new Map<number, number>()
}

/** Sum, per fiscal year, the annual maps of every concept in the list (capex PPE + intangibles). */
function sumConcepts(facts: CompanyFacts, taxonomy: Taxonomy, concepts: string[]): Map<number, number> {
  const out = new Map<number, number>()
  let any = false
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    if (m.size > 0) any = true
    for (const [fy, v] of m) out.set(fy, (out.get(fy) ?? 0) + v)
  }
  return any ? out : new Map<number, number>()
}

function buildAnnualSeries(facts: CompanyFacts, taxonomy: Taxonomy, currency: ReportingCurrency): AnnualFacts[] {
  const cm = conceptMapFor(taxonomy)
  const netIncome = annualByFiscalYear(facts, taxonomy, cm.netIncome)
  const revenue = firstPopulated(facts, taxonomy, cm.revenue)
  const dAndA = firstPopulated(facts, taxonomy, cm.dAndA)
  // capex: sum PPE + intangible purchases (IFRS); for us-gaap the single PPE concept.
  const capex = sumConcepts(facts, taxonomy, cm.capex)
  const sbc = firstPopulated(facts, taxonomy, cm.sbc)
  const dilutedShares = firstPopulated(facts, taxonomy, cm.dilutedShares)
  const sharesOut = firstPopulated(facts, taxonomy, cm.sharesOut)
  const debtCombined = firstPopulated(facts, taxonomy, cm.debtCombined)
  const debtComponents = sumConcepts(facts, taxonomy, cm.debtComponents)
  const cash = firstPopulated(facts, taxonomy, cm.cash)
  const shortTermInv = firstPopulated(facts, taxonomy, cm.shortTermInvestments)
  const interest = annualByFiscalYear(facts, taxonomy, cm.interest)
  const stockholdersEquity = annualByFiscalYear(facts, taxonomy, cm.stockholdersEquity)
  const operatingIncome = annualByFiscalYear(facts, taxonomy, cm.operatingIncome)
  const incomeTax = annualByFiscalYear(facts, taxonomy, cm.incomeTax)
  // Filing metadata (filed date + period end) per fiscal year. Prefer the income-statement fact; fall
  // back to revenue/D&A so a year still carries a filed date if the income fact was tagged differently.
  const filedMetaNi = annualFiledMetaByFiscalYear(facts, taxonomy, cm.netIncome)
  const filedMetaRev = cm.revenue.map((c) => annualFiledMetaByFiscalYear(facts, taxonomy, c))
  const filedMetaDa = cm.dAndA.map((c) => annualFiledMetaByFiscalYear(facts, taxonomy, c))

  // Union of all fiscal years observed across the OE-bridge concepts.
  const allYears = new Set<number>()
  for (const m of [netIncome, revenue, dAndA, capex, sbc, dilutedShares]) {
    for (const fy of m.keys()) allYears.add(fy)
  }

  const series: AnnualFacts[] = []
  for (const fy of [...allYears].sort((a, b) => b - a)) {
    // total debt: prefer combined; else sum the long-term/short-term components.
    const totalDebtRaw = debtCombined.get(fy) ?? (debtComponents.get(fy))
    // cash + securities: cash plus whichever short-term-securities concept is present.
    const cashRaw = sumOptional(cash.get(fy), shortTermInv.get(fy))
    const filedMeta = filedMetaNi.get(fy)
      ?? filedMetaRev.map((m) => m.get(fy)).find((v) => v !== undefined)
      ?? filedMetaDa.map((m) => m.get(fy)).find((v) => v !== undefined)

    series.push({
      fiscal_year: fy,
      currency,
      ...optional('filed', filedMeta?.filed),
      ...optional('period_end', filedMeta?.period_end),
      ...optional('net_income_musd', toMusd(netIncome.get(fy))),
      ...optional('revenue_musd', toMusd(revenue.get(fy))),
      ...optional('d_and_a_musd', toMusd(dAndA.get(fy))),
      ...optional('capex_musd', toMusd(capex.get(fy))),
      ...optional('sbc_musd', toMusd(sbc.get(fy))),
      ...optional('diluted_shares_m', toMshares(dilutedShares.get(fy))),
      ...optional('shares_outstanding_m', toMshares(sharesOut.get(fy))),
      ...optional('total_debt_musd', toMusd(totalDebtRaw)),
      ...optional('cash_and_securities_musd', toMusd(cashRaw)),
      ...optional('interest_expense_musd', toMusd(interest.get(fy))),
      ...optional('stockholders_equity_musd', toMusd(stockholdersEquity.get(fy))),
      ...optional('operating_income_musd', toMusd(operatingIncome.get(fy))),
      ...optional('income_tax_expense_musd', toMusd(incomeTax.get(fy))),
    })
  }
  return series
}

// exactOptionalPropertyTypes helper: only spread the key when the value is defined.
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

// ---------------------------------------------------------------------------
// submissions -> 10-K URL
// ---------------------------------------------------------------------------

type Submissions = {
  cik?: string | number
  name?: string
  filings?: {
    recent?: {
      form?: string[]
      filingDate?: string[]
      accessionNumber?: string[]
      primaryDocument?: string[]
    }
  }
}

function buildFilings(subs: Submissions | undefined, cik10: string): FilingRef[] {
  const recent = subs?.filings?.recent
  if (recent === undefined) return []
  const forms = recent.form ?? []
  const dates = recent.filingDate ?? []
  const accessions = recent.accessionNumber ?? []
  const docs = recent.primaryDocument ?? []
  const cikInt = String(parseInt(cik10, 10))

  const filings: FilingRef[] = []
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i]
    if (!isAnnualForm(form)) continue
    const accession = accessions[i]
    const doc = docs[i]
    const filed = dates[i]
    if (typeof accession !== 'string' || typeof doc !== 'string') continue
    const accNoDashes = accession.replace(/-/g, '')
    filings.push({
      form: form as string,
      filed: typeof filed === 'string' ? filed : '',
      url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${doc}`,
    })
  }
  // newest first
  filings.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))
  return filings
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Fetch structured fundamentals for a US company by ticker OR a 10-digit (or paddable) CIK.
 * FAIL-CLOSED: returns undefined on an unknown ticker, missing structured facts, or any fetch error.
 * A submissions failure degrades gracefully (no 10-K URL) but does not discard the XBRL facts.
 */
export async function fetchCompanyFundamentals(
  tickerOrCik: string,
  deps?: SecEdgarDeps,
): Promise<Fundamentals | undefined> {
  const trimmed = tickerOrCik.trim()
  if (trimmed.length === 0) return undefined

  // A pure-digit input is treated as a CIK; otherwise resolve the ticker.
  const isCik = /^\d+$/.test(trimmed)
  const cik10 = isCik ? padCik(trimmed) : await resolveCik(trimmed, deps)
  if (cik10 === undefined) return undefined

  const facts = await fetchSecJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`,
    deps,
  )
  if (facts === undefined) return undefined

  // Choose the populated taxonomy (us-gaap for US filers, ifrs-full for foreign private issuers) and
  // detect the reporting currency from the XBRL unit key. Fail-closed when neither taxonomy has data.
  const taxonomy = pickTaxonomy(facts)
  if (taxonomy === undefined) return undefined
  const currency = detectCurrency(facts, taxonomy)

  const annual_series = buildAnnualSeries(facts, taxonomy, currency)
  const latest_annual = annual_series[0]
  if (latest_annual === undefined) return undefined

  // submissions are best-effort: a failure must not lose the structured facts.
  const subs = await fetchSecJson<Submissions>(
    `https://data.sec.gov/submissions/CIK${cik10}.json`,
    deps,
  )
  const filings = buildFilings(subs, cik10)

  return {
    cik: cik10,
    entity_name: typeof facts.entityName === 'string' ? facts.entityName : trimmed.toUpperCase(),
    currency,
    latest_annual,
    annual_series,
    filings,
  }
}

// ---------------------------------------------------------------------------
// Incremental ROIC from the multi-year EDGAR series
// ---------------------------------------------------------------------------

export type IncrementalRoicResult =
  | {
      computable: true
      /** Normalized incremental ROIC (fraction), e.g. 0.20. */
      incremental_roic: number
      /** ΔNOPAT over the window ($millions). */
      delta_nopat_musd: number
      /** ΔInvested capital over the window ($millions). */
      delta_invested_capital_musd: number
      /** Fiscal years of the earliest and latest observation actually used. */
      from_fiscal_year: number
      to_fiscal_year: number
    }
  | { computable: false; reason: string }

/**
 * NOPAT proxy for one year: operating income × (1 − effective tax rate). Falls back to
 * net income + after-tax interest when operating income is unavailable. Returns undefined when the
 * inputs needed for any proxy are missing.
 *
 *   effective tax rate = income_tax / (operating_income)  clamped to [0, 0.5]; default 0.21 when
 *   operating income or tax is missing/odd.
 */
function nopatProxy(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const tax = a.income_tax_expense_musd
  if (op !== undefined && Number.isFinite(op)) {
    let rate = 0.21
    if (tax !== undefined && Number.isFinite(tax) && op > 0) {
      const implied = tax / op
      if (implied >= 0 && implied <= 0.5) rate = implied
    }
    return op * (1 - rate)
  }
  // Fallback: NI + after-tax interest (interest × (1 − 0.21)).
  const ni = a.net_income_musd
  if (ni !== undefined && Number.isFinite(ni)) {
    const interest = a.interest_expense_musd ?? 0
    return ni + (Number.isFinite(interest) ? interest * (1 - 0.21) : 0)
  }
  return undefined
}

/** Invested-capital proxy: equity + total debt − cash. Returns undefined when equity is missing. */
function investedCapitalProxy(a: AnnualFacts): number | undefined {
  const equity = a.stockholders_equity_musd
  if (equity === undefined || !Number.isFinite(equity)) return undefined
  const debt = a.total_debt_musd ?? 0
  const cash = a.cash_and_securities_musd ?? 0
  return equity + (Number.isFinite(debt) ? debt : 0) - (Number.isFinite(cash) ? cash : 0)
}

/**
 * Compute a normalized INCREMENTAL ROIC from the EDGAR multi-year series over ~`lookbackYears` years
 * (buffett-valuation-method-v2 Step 3 raw growth capacity = reinvestment_rate × incremental_roic).
 *
 *   incremental ROIC ≈ Δ(NOPAT) / Δ(invested capital)   from the earliest to the latest year in the
 *   window for which both the NOPAT and invested-capital proxies are computable.
 *
 * Honest fail-closed: returns { computable: false } when fewer than two usable years exist, when the
 * change in invested capital is non-positive (incremental ROIC undefined / nonsensical), or when the
 * result is negative or wildly large (> 1.0). The caller falls back to the lane's proposed value.
 */
export function computeIncrementalRoic(
  series: AnnualFacts[],
  opts?: { lookbackYears?: number },
): IncrementalRoicResult {
  const lookback = opts?.lookbackYears ?? 5
  // Series is newest-first; build an ascending list of years that have BOTH proxies.
  const usable = [...series]
    .map((a) => ({ fy: a.fiscal_year, nopat: nopatProxy(a), ic: investedCapitalProxy(a) }))
    .filter((x): x is { fy: number; nopat: number; ic: number } => x.nopat !== undefined && x.ic !== undefined)
    .sort((a, b) => a.fy - b.fy)

  if (usable.length < 2) {
    return { computable: false, reason: 'fewer than two years with computable NOPAT + invested-capital proxies' }
  }

  const latest = usable[usable.length - 1]!
  // Earliest within the lookback window (prefer ~lookback years back, else the oldest usable year).
  const earliest = usable.find((x) => x.fy >= latest.fy - lookback) ?? usable[0]!

  if (earliest.fy === latest.fy) {
    return { computable: false, reason: 'no distinct earlier year within the lookback window' }
  }

  const delta_nopat = latest.nopat - earliest.nopat
  const delta_ic = latest.ic - earliest.ic

  if (!(delta_ic > 0)) {
    return { computable: false, reason: 'change in invested capital is non-positive — incremental ROIC undefined' }
  }

  const incremental_roic = delta_nopat / delta_ic
  // Reject implausible proxies (negative or > 100%) — prefer the lane value + a note (caller decides).
  if (!Number.isFinite(incremental_roic) || incremental_roic < 0 || incremental_roic > 1) {
    return { computable: false, reason: `incremental ROIC proxy out of plausible range (${incremental_roic})` }
  }

  return {
    computable: true,
    incremental_roic,
    delta_nopat_musd: delta_nopat,
    delta_invested_capital_musd: delta_ic,
    from_fiscal_year: earliest.fy,
    to_fiscal_year: latest.fy,
  }
}

/** Test-only hook to reset the module-level ticker cache. */
export function __resetTickerCacheForTests(): void {
  tickerCache = undefined
}
