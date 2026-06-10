// SEC EDGAR fundamentals feed.
//
// Pulls PRIMARY-filing data (structured XBRL companyfacts + the latest 10-K filing URL) for a US
// company so the research swarm can ground on raw filings instead of dropping when IR/news is
// blocked. Mirrors marketData.ts conventions: injectable fetch, SSRF guard (here narrowed to the
// two SEC hosts), explicit timeouts, and FAIL-CLOSED behaviour — any error returns undefined and
// never throws to the caller, so the swarm runs exactly as today when EDGAR is unavailable.
//
// Values are converted to Owlfolio's owner-earnings-bridge convention: dollars -> MILLIONS (/1e6),
// shares -> MILLIONS (/1e6).

import { assertPublicHttpUrl } from './sourceGrounding'

const SEC_ALLOWED_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const SEC_DEFAULT_TIMEOUT_MS = 15_000
const SEC_DEFAULT_USER_AGENT = 'Owlfolio research (local)'

export type SecEdgarDeps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

export type AnnualFacts = {
  fiscal_year: number
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
}

export type FilingRef = {
  form: string
  filed: string
  url: string
}

export type Fundamentals = {
  cik: string
  entity_name: string
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

type CompanyFacts = {
  cik?: number
  entityName?: string
  facts?: {
    'us-gaap'?: Record<string, { units?: Record<string, XbrlFact[]> }>
  }
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
function annualByFiscalYear(facts: CompanyFacts, concept: string): Map<number, number> {
  const out = new Map<number, number>()
  const unitMap = facts.facts?.['us-gaap']?.[concept]?.units
  if (unitMap === undefined) return out
  // pick the first unit bucket (USD or shares — each concept has a single relevant unit)
  const entries: XbrlFact[] = []
  for (const bucket of Object.values(unitMap)) {
    if (Array.isArray(bucket)) entries.push(...bucket)
  }

  // end-date -> {val, filed}; latest filed wins for a given period end.
  const byEnd = new Map<string, { val: number; filed: string }>()
  for (const e of entries) {
    if (e.form !== '10-K') continue
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

const USD_TO_MUSD = 1e6
const SHARES_TO_M = 1e6

function toMusd(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / USD_TO_MUSD
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

function buildAnnualSeries(facts: CompanyFacts): AnnualFacts[] {
  const netIncome = annualByFiscalYear(facts, 'NetIncomeLoss')
  const revenueContract = annualByFiscalYear(facts, 'RevenueFromContractWithCustomerExcludingAssessedTax')
  const revenues = annualByFiscalYear(facts, 'Revenues')
  const dAndA = annualByFiscalYear(facts, 'DepreciationDepletionAndAmortization')
  const capex = annualByFiscalYear(facts, 'PaymentsToAcquirePropertyPlantAndEquipment')
  const sbc = annualByFiscalYear(facts, 'ShareBasedCompensation')
  const dilutedShares = annualByFiscalYear(facts, 'WeightedAverageNumberOfDilutedSharesOutstanding')
  const sharesOut = annualByFiscalYear(facts, 'CommonStockSharesOutstanding')
  const ltDebtNoncurrent = annualByFiscalYear(facts, 'LongTermDebtNoncurrent')
  const ltDebtCurrent = annualByFiscalYear(facts, 'LongTermDebtCurrent')
  const debtCombined = annualByFiscalYear(facts, 'DebtLongtermAndShorttermCombinedAmount')
  const cash = annualByFiscalYear(facts, 'CashAndCashEquivalentsAtCarryingValue')
  const shortTermInv = annualByFiscalYear(facts, 'ShortTermInvestments')
  const marketableCurrent = annualByFiscalYear(facts, 'MarketableSecuritiesCurrent')
  const interest = annualByFiscalYear(facts, 'InterestExpense')

  // Union of all fiscal years observed across the OE-bridge concepts.
  const allYears = new Set<number>()
  for (const m of [netIncome, revenueContract, revenues, dAndA, capex, sbc, dilutedShares]) {
    for (const fy of m.keys()) allYears.add(fy)
  }

  const series: AnnualFacts[] = []
  for (const fy of [...allYears].sort((a, b) => b - a)) {
    // total debt: prefer combined; else sum the long-term components.
    const totalDebtRaw = debtCombined.get(fy) ?? sumOptional(ltDebtNoncurrent.get(fy), ltDebtCurrent.get(fy))
    // cash + securities: cash plus whichever short-term-securities concept is present.
    const cashRaw = sumOptional(cash.get(fy), shortTermInv.get(fy) ?? marketableCurrent.get(fy))

    series.push({
      fiscal_year: fy,
      ...optional('net_income_musd', toMusd(netIncome.get(fy))),
      ...optional('revenue_musd', toMusd(revenueContract.get(fy) ?? revenues.get(fy))),
      ...optional('d_and_a_musd', toMusd(dAndA.get(fy))),
      ...optional('capex_musd', toMusd(capex.get(fy))),
      ...optional('sbc_musd', toMusd(sbc.get(fy))),
      ...optional('diluted_shares_m', toMshares(dilutedShares.get(fy))),
      ...optional('shares_outstanding_m', toMshares(sharesOut.get(fy))),
      ...optional('total_debt_musd', toMusd(totalDebtRaw)),
      ...optional('cash_and_securities_musd', toMusd(cashRaw)),
      ...optional('interest_expense_musd', toMusd(interest.get(fy))),
    })
  }
  return series
}

// exactOptionalPropertyTypes helper: only spread the key when the value is defined.
function optional<K extends string>(key: K, value: number | undefined): Record<K, number> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
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
    if (forms[i] !== '10-K') continue
    const accession = accessions[i]
    const doc = docs[i]
    const filed = dates[i]
    if (typeof accession !== 'string' || typeof doc !== 'string') continue
    const accNoDashes = accession.replace(/-/g, '')
    filings.push({
      form: '10-K',
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

  const annual_series = buildAnnualSeries(facts)
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
    latest_annual,
    annual_series,
    filings,
  }
}

/** Test-only hook to reset the module-level ticker cache. */
export function __resetTickerCacheForTests(): void {
  tickerCache = undefined
}
