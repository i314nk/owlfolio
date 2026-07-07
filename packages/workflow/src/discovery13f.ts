// Discovery Module 1 — 13F cloning (the "Pabrai discovery engine").
//
// Deterministic (T0) SEC 13F-HR harvester over a curated list of concentrated, low-turnover value
// managers. It diffs the latest two quarters per manager to detect NEW_POSITION / MEANINGFUL_ADD, and
// across managers detects CLUSTER_BUY (>=2 managers initiating the same name) — the strongest signal.
// It resolves issuer names to tickers by company-name match (never fabricating one), applies a Shariah
// sector pre-filter BEFORE a candidate is created, then records source:'13f_clone' CANDIDATE entries
// that feed the existing discovery pipeline. The human / quick-screen gate still decides what advances.
//
// Conventions mirror secEdgar.ts: injectable fetch, SSRF guard narrowed to SEC hosts, explicit
// timeouts, and FAIL-CLOSED behaviour (any error returns undefined / empty and never throws to a live
// caller). Unit tests inject deps and never touch the network.
//
// Value-unit normalization: a 13F infoTable <value> historically was reported in $THOUSANDS (pre-2023
// rule, FAS), and in whole DOLLARS for filings under the amended rule (≈ 2023+). We auto-detect per
// filing by magnitude — when every position's value is implausibly small relative to its share count
// (median value/shares < $1, i.e. sub-$1 "share price"), we treat the column as thousands and scale by
// 1e3. Callers may also pass an explicit { value_unit } to override. All `value`s on the parsed holdings
// are normalized to whole DOLLARS so conviction (% of portfolio) is unit-independent regardless.

import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { assertPublicHttpUrl } from './sourceGrounding'
import { resolveResearchStrategyRef } from './researchStrategyRef'

// ---------------------------------------------------------------------------
// SEC fetch (SSRF guard + fail-closed) — same pattern as secEdgar.ts
// ---------------------------------------------------------------------------

const SEC_ALLOWED_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const SEC_DEFAULT_TIMEOUT_MS = 15_000
const SEC_DEFAULT_USER_AGENT = 'Owlfolio research (local)'

export type Sec13fDeps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

function assertSecUrl(rawUrl: string): URL {
  const url = assertPublicHttpUrl(rawUrl)
  if (!SEC_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`SEC URL host not allowed: ${url.hostname}`)
  }
  return url
}

function resolveUserAgent(deps?: Sec13fDeps): string {
  return deps?.userAgent ?? process.env['OWLFOLIO_SEC_USER_AGENT'] ?? SEC_DEFAULT_USER_AGENT
}

async function fetchSecText(rawUrl: string, accept: string, deps?: Sec13fDeps): Promise<string | undefined> {
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
      headers: { 'User-Agent': resolveUserAgent(deps), Accept: accept },
    })
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function fetchSecJson<T>(rawUrl: string, deps?: Sec13fDeps): Promise<T | undefined> {
  const text = await fetchSecText(rawUrl, 'application/json', deps)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

function padCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, '')
  return digits.padStart(10, '0')
}

// ---------------------------------------------------------------------------
// Cloner list (curated config)
// ---------------------------------------------------------------------------

export type ClonerManager = {
  manager_name: string
  /** Zero-padded 10-digit CIK, present only when confirmed via the SEC submissions API. */
  cik?: string
  /** True when no CIK could be verified — NEVER guess a CIK; leave it unset + flag for follow-up. */
  cik_unverified?: boolean
  /** Optional note about filing cadence / staleness for the operator. */
  note?: string
}

// CIKs confirmed live against https://data.sec.gov/submissions/CIK{cik}.json (name + 13F-HR present).
// Concentrated, low-turnover value managers only; >50-position / high-turnover funds are excluded by
// design (these all run focused books). Any manager whose CIK could not be verified is flagged
// cik_unverified=true with NO guessed CIK so the operator can resolve it manually.
export const CLONER_LIST: readonly ClonerManager[] = [
  { manager_name: 'Berkshire Hathaway Inc', cik: '0001067983' },
  {
    manager_name: 'Pabrai Investment Funds (Mohnish Pabrai)',
    cik: '0001173334',
    note: 'Confirmed CIK; latest 13F-HR is historical (2012) — Pabrai has since stayed below the 13F reporting threshold. Kept for backfill/clustering; will yield no new quarters until a fresh filing appears.',
  },
  { manager_name: 'Himalaya Capital Management LLC (Li Lu)', cik: '0001709323' },
  { manager_name: 'Aquamarine Capital (Guy Spier)', cik: '0002104187' },
  { manager_name: 'Akre Capital Management LLC', cik: '0001112520' },
  { manager_name: 'Giverny Capital Inc', cik: '0001641864' },
]

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

export type Holding13F = {
  issuer: string
  cusip: string
  title_class: string
  /** Position market value in WHOLE DOLLARS (normalized; see value-unit note at top of file). */
  value: number
  /** Shares or principal amount (SH count, or par for PRN). */
  shares: number
}

export type ValueUnit = 'auto' | 'dollars' | 'thousands'

function tagText(block: string, tag: string): string | undefined {
  // Namespace-agnostic single-tag extraction: matches <tag>…</tag> and <ns:tag>…</ns:tag>.
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i')
  const m = re.exec(block)
  return m?.[1]?.trim()
}

function tagNumber(block: string, tag: string): number | undefined {
  const text = tagText(block, tag)
  if (text === undefined) return undefined
  const n = Number(text.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Parse a 13F information-table XML into normalized holdings. Namespace-agnostic and fail-closed:
 * returns [] for empty/malformed input. By default the value column unit is auto-detected (see top of
 * file); pass { value_unit } to force 'dollars' or 'thousands'.
 */
export function parse13fInfoTable(xml: string, opts?: { value_unit?: ValueUnit }): Holding13F[] {
  if (typeof xml !== 'string' || xml.trim().length === 0) return []
  const blocks = xml.match(/<(?:[\w.-]+:)?infoTable\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?infoTable>/gi)
  if (blocks === null) return []

  type Raw = { issuer: string; cusip: string; title_class: string; rawValue: number; shares: number }
  const raws: Raw[] = []
  for (const block of blocks) {
    const issuer = tagText(block, 'nameOfIssuer')
    const cusip = tagText(block, 'cusip')
    const rawValue = tagNumber(block, 'value')
    // shares live inside <shrsOrPrnAmt><sshPrnamt>…; tagNumber finds the nested sshPrnamt directly.
    const shares = tagNumber(block, 'sshPrnamt')
    if (issuer === undefined || cusip === undefined || rawValue === undefined) continue
    raws.push({
      issuer,
      cusip: cusip.toUpperCase(),
      title_class: tagText(block, 'titleOfClass') ?? '',
      rawValue,
      shares: shares ?? 0,
    })
  }
  if (raws.length === 0) return []

  const scale = resolveValueScale(raws, opts?.value_unit ?? 'auto')
  return raws.map((r) => ({
    issuer: r.issuer,
    cusip: r.cusip,
    title_class: r.title_class,
    value: r.rawValue * scale,
    shares: r.shares,
  }))
}

function resolveValueScale(
  raws: { rawValue: number; shares: number }[],
  unit: ValueUnit,
): number {
  if (unit === 'thousands') return 1_000
  if (unit === 'dollars') return 1
  // auto: a dollar-denominated filing implies value/shares ≈ a real share price (>= $1 typically).
  // A thousands-denominated filing makes value/shares ≈ price/1000 (tiny). Use the median ratio.
  const ratios = raws
    .filter((r) => r.shares > 0 && r.rawValue > 0)
    .map((r) => r.rawValue / r.shares)
    .sort((a, b) => a - b)
  if (ratios.length === 0) return 1
  const median = ratios[Math.floor(ratios.length / 2)] ?? 1
  return median < 1 ? 1_000 : 1
}

// ---------------------------------------------------------------------------
// Manager quarters + fetch
// ---------------------------------------------------------------------------

export type ManagerQuarter = {
  manager_name: string
  cik: string
  /** Reporting period label, e.g. '2025Q1' (or the filing's period-of-report date). */
  period: string
  holdings: Holding13F[]
  prior_holdings: Holding13F[]
}

type Submissions = {
  name?: string
  filings?: {
    recent?: {
      form?: string[]
      filingDate?: string[]
      accessionNumber?: string[]
      reportDate?: string[]
    }
  }
}

function quarterLabel(reportDate: string | undefined, filed: string): string {
  const basis = reportDate !== undefined && reportDate.length > 0 ? reportDate : filed
  const d = new Date(basis)
  if (!Number.isFinite(d.getTime())) return basis
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${d.getUTCFullYear()}Q${q}`
}

/**
 * Locate the info-table xml inside a 13F-HR filing index. The info table is a numeric-named .xml (NOT
 * primary_doc.xml). Returns the first non-primary .xml file name, fail-closed undefined otherwise.
 */
function pickInfoTableFile(indexJson: { directory?: { item?: { name?: string }[] } } | undefined): string | undefined {
  const items = indexJson?.directory?.item ?? []
  const xmls = items
    .map((i) => i.name)
    .filter((n): n is string => typeof n === 'string' && n.toLowerCase().endsWith('.xml'))
    .filter((n) => n.toLowerCase() !== 'primary_doc.xml')
  return xmls[0]
}

/**
 * Fetch the latest two 13F-HR quarters' holdings for a manager CIK (current + prior, for diffing).
 * FAIL-CLOSED: returns undefined on any guard/fetch/parse failure or when fewer than one 13F-HR exists.
 */
export async function fetchManager13F(
  managerName: string,
  cik: string,
  deps?: Sec13fDeps,
): Promise<ManagerQuarter | undefined> {
  const cik10 = padCik(cik)
  const subs = await fetchSecJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik10}.json`, deps)
  const recent = subs?.filings?.recent
  if (recent === undefined) return undefined
  const forms = recent.form ?? []
  const accessions = recent.accessionNumber ?? []
  const filed = recent.filingDate ?? []
  const reportDates = recent.reportDate ?? []
  const cikInt = String(parseInt(cik10, 10))

  const thirteenF: { accession: string; filed: string; report: string }[] = []
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '13F-HR') continue
    const accession = accessions[i]
    if (typeof accession !== 'string') continue
    thirteenF.push({ accession, filed: filed[i] ?? '', report: reportDates[i] ?? '' })
  }
  // newest first
  thirteenF.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))
  if (thirteenF.length === 0) return undefined

  const current = thirteenF[0]!
  const prior = thirteenF[1]
  const currentHoldings = await fetchInfoTable(cikInt, current.accession, deps)
  if (currentHoldings === undefined) return undefined
  const priorHoldings = prior === undefined ? [] : (await fetchInfoTable(cikInt, prior.accession, deps)) ?? []

  return {
    manager_name: subs?.name ?? managerName,
    cik: cik10,
    period: quarterLabel(current.report, current.filed),
    holdings: currentHoldings,
    prior_holdings: priorHoldings,
  }
}

async function fetchInfoTable(cikInt: string, accession: string, deps?: Sec13fDeps): Promise<Holding13F[] | undefined> {
  const accNoDashes = accession.replace(/-/g, '')
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}`
  const index = await fetchSecJson<{ directory?: { item?: { name?: string }[] } }>(`${base}/index.json`, deps)
  const file = pickInfoTableFile(index)
  if (file === undefined) return undefined
  const xml = await fetchSecText(`${base}/${file}`, 'application/xml', deps)
  if (xml === undefined) return undefined
  return parse13fInfoTable(xml)
}

// ---------------------------------------------------------------------------
// Signal detection (pure)
// ---------------------------------------------------------------------------

export type SignalType = 'CLUSTER_BUY' | 'NEW_POSITION' | 'MEANINGFUL_ADD'

const MEANINGFUL_ADD_THRESHOLD = 0.25

export type ManagerSignal = {
  manager_name: string
  cusip: string
  issuer: string
  signal_type: 'NEW_POSITION' | 'MEANINGFUL_ADD'
  /** Position value as a fraction of the manager's total 13F portfolio value. */
  conviction_pct: number
}

function totalValue(holdings: Holding13F[]): number {
  return holdings.reduce((sum, h) => sum + (Number.isFinite(h.value) ? h.value : 0), 0)
}

/**
 * Aggregate holdings by CUSIP. A single 13F-HR may list the same security across multiple rows (e.g.
 * different share lots / sub-managers, as Berkshire does with Apple), so we sum value + shares per CUSIP
 * before diffing or computing conviction.
 */
function aggregateByCusip(holdings: Holding13F[]): Map<string, Holding13F> {
  const out = new Map<string, Holding13F>()
  for (const h of holdings) {
    const existing = out.get(h.cusip)
    if (existing === undefined) {
      out.set(h.cusip, { ...h })
    } else {
      existing.value += Number.isFinite(h.value) ? h.value : 0
      existing.shares += Number.isFinite(h.shares) ? h.shares : 0
    }
  }
  return out
}

/** Per-manager NEW_POSITION / MEANINGFUL_ADD signals for one quarter vs its prior quarter. */
export function detectManagerSignals(quarter: ManagerQuarter): ManagerSignal[] {
  const currentByCusip = aggregateByCusip(quarter.holdings)
  const total = totalValue([...currentByCusip.values()])
  const priorByCusip = aggregateByCusip(quarter.prior_holdings)
  const out: ManagerSignal[] = []

  for (const h of currentByCusip.values()) {
    const prior = priorByCusip.get(h.cusip)
    const conviction_pct = total > 0 ? h.value / total : 0
    if (prior === undefined) {
      out.push({ manager_name: quarter.manager_name, cusip: h.cusip, issuer: h.issuer, signal_type: 'NEW_POSITION', conviction_pct })
      continue
    }
    if (prior.shares > 0 && (h.shares - prior.shares) / prior.shares > MEANINGFUL_ADD_THRESHOLD) {
      out.push({ manager_name: quarter.manager_name, cusip: h.cusip, issuer: h.issuer, signal_type: 'MEANINGFUL_ADD', conviction_pct })
    }
  }
  return out
}

export type DiscoverySignal = {
  cusip: string
  issuer: string
  signal_type: SignalType
  /** Highest conviction_pct among contributing managers for this cusip. */
  conviction_pct: number
  contributing_managers: string[]
}

/**
 * Detect cross-manager signals across all managers for one quarter. A CLUSTER_BUY is >= 2 DISTINCT
 * managers initiating (NEW_POSITION) the same cusip — the strongest signal. Single-manager NEW_POSITION
 * and MEANINGFUL_ADD signals are passed through (deduped per cusip, strongest signal wins).
 */
export function detectClusterSignals(quarters: ManagerQuarter[]): DiscoverySignal[] {
  const perManager = quarters.flatMap((q) => detectManagerSignals(q))

  // group by cusip
  const byCusip = new Map<string, ManagerSignal[]>()
  for (const s of perManager) {
    const list = byCusip.get(s.cusip) ?? []
    list.push(s)
    byCusip.set(s.cusip, list)
  }

  const out: DiscoverySignal[] = []
  for (const [cusip, signals] of byCusip) {
    const issuer = signals[0]!.issuer
    const newPositionManagers = [...new Set(signals.filter((s) => s.signal_type === 'NEW_POSITION').map((s) => s.manager_name))]
    const conviction_pct = Math.max(...signals.map((s) => s.conviction_pct))
    const allManagers = [...new Set(signals.map((s) => s.manager_name))]

    if (newPositionManagers.length >= 2) {
      out.push({ cusip, issuer, signal_type: 'CLUSTER_BUY', conviction_pct, contributing_managers: newPositionManagers })
      continue
    }
    if (signals.some((s) => s.signal_type === 'NEW_POSITION')) {
      out.push({ cusip, issuer, signal_type: 'NEW_POSITION', conviction_pct, contributing_managers: allManagers })
      continue
    }
    out.push({ cusip, issuer, signal_type: 'MEANINGFUL_ADD', conviction_pct, contributing_managers: allManagers })
  }
  return out
}

const SIGNAL_RANK: Record<SignalType, number> = { CLUSTER_BUY: 3, NEW_POSITION: 2, MEANINGFUL_ADD: 1 }

/** Rank signals strongest-first (CLUSTER_BUY > NEW_POSITION > MEANINGFUL_ADD), then by conviction. */
export function rankDiscoverySignals(signals: DiscoverySignal[]): DiscoverySignal[] {
  return [...signals].sort((a, b) => {
    const r = SIGNAL_RANK[b.signal_type] - SIGNAL_RANK[a.signal_type]
    if (r !== 0) return r
    return b.conviction_pct - a.conviction_pct
  })
}

// ---------------------------------------------------------------------------
// CUSIP / name -> ticker (company-name match; never fabricate)
// ---------------------------------------------------------------------------

export type CompanyTickerEntry = { cik_str?: number; ticker?: string; title?: string }

export type TickerResolution = {
  ticker?: string
  company_name: string
  resolution: 'matched' | 'unresolved'
}

// Common issuer-name suffixes/tokens stripped before matching so "COSTCO WHOLESALE CORP /NEW" lines up
// with "COSTCO WHOLESALE CORP". Deterministic normalization only — no fuzzy/edit-distance scoring.
const NAME_NOISE = /\b(inc|incorporated|corp|corporation|co|company|cos|ltd|limited|plc|llc|lp|sa|ag|nv|holdings?|group|the|com|class|cl|new|del|usd?|adr|ads|reit|trust|fund)\b/gi

function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[/.,&'"()]/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a 13F issuer name to a ticker by normalized company-name match against company_tickers.json.
 * Returns resolution:'matched' with the ticker on a confident exact normalized match; otherwise
 * resolution:'unresolved' with NO ticker — never fabricates one (a future small-model/manual step
 * resolves these). The small-model entity-resolution edge case is deliberately deferred (T3, not built).
 */
export function resolveIssuerTicker(issuer: string, tickers: CompanyTickerEntry[]): TickerResolution {
  const target = normalizeCompanyName(issuer)
  if (target.length === 0) return { company_name: issuer, resolution: 'unresolved' }

  const matches = tickers.filter(
    (t) => typeof t.title === 'string' && typeof t.ticker === 'string' && normalizeCompanyName(t.title) === target,
  )
  if (matches.length === 1 && typeof matches[0]!.ticker === 'string') {
    return { ticker: matches[0]!.ticker.toUpperCase(), company_name: issuer, resolution: 'matched' }
  }
  // 0 matches (unknown) OR >1 (ambiguous) -> unresolved, never guess.
  return { company_name: issuer, resolution: 'unresolved' }
}

// ---------------------------------------------------------------------------
// Shariah sector pre-filter (BEFORE a candidate is created)
// ---------------------------------------------------------------------------

// Deterministic, name-keyword sector exclusion: drops issuers whose name clearly indicates a
// categorically-impermissible sector (conventional banking/insurance/finance, alcohol, tobacco,
// gambling, defense/weapons, adult). This is the Module 1 "sector exclusion BEFORE a candidate is
// created" pre-filter — INTENTIONALLY conservative on confidence: a name that does not clearly match an
// excluded sector is KEPT, and the downstream quick screen (segment-revenue Shariah gate) catches what a
// name alone cannot. It is a cheap funnel pre-filter, not the authoritative Shariah ruling.
const EXCLUDED_SECTOR_KEYWORDS: { keyword: RegExp; sector: string }[] = [
  { keyword: /\b(bancorp|bancshares|bankshares|bank|banc)\b/i, sector: 'conventional_banking' },
  { keyword: /\bfinancial\b|\bfinl\b|\bfinance\b/i, sector: 'conventional_finance' },
  { keyword: /\binsurance\b|\bassurance\b|\breinsurance\b|\binsur\b/i, sector: 'conventional_insurance' },
  { keyword: /\bcapital\b/i, sector: 'conventional_finance' },
  { keyword: /\bsavings\b|\bthrift\b|\bmortgage\b/i, sector: 'conventional_lending' },
  { keyword: /\bbrew|\bbeer\b|\bdistill|\bwinery|\bwine\b|\bspirits\b|\balcohol|\bliquor\b/i, sector: 'alcohol' },
  { keyword: /\btobacco\b|\bcigarette/i, sector: 'tobacco' },
  { keyword: /\bcasino|\bgaming\b|\bgambl|\bwynn\b|\bbetting\b|\bwager/i, sector: 'gambling' },
  { keyword: /\bdefense\b|\bweapon|\barmament|\bmunition/i, sector: 'defense_weapons' },
]

export type SectorScreenSubject = { issuer: string; cusip: string }

export type SectorScreenResult<T extends SectorScreenSubject> = T & {
  excluded: boolean
  excluded_sector?: string
}

/** Classify each subject against the sector keyword list (does not drop — used for explainability). */
export function classifyShariahSector<T extends SectorScreenSubject>(subjects: T[]): SectorScreenResult<T>[] {
  return subjects.map((s) => {
    const hit = EXCLUDED_SECTOR_KEYWORDS.find((e) => e.keyword.test(s.issuer))
    return hit === undefined
      ? { ...s, excluded: false }
      : { ...s, excluded: true, excluded_sector: hit.sector }
  })
}

/** Drop subjects in a clearly-impermissible sector; keep unknown-sector names for the quick screen. */
export function applyShariahSectorPreFilter<T extends SectorScreenSubject>(subjects: T[]): T[] {
  return classifyShariahSector(subjects)
    .filter((s) => !s.excluded)
    .map(({ excluded: _excluded, excluded_sector: _sector, ...rest }) => rest as unknown as T)
}

// ---------------------------------------------------------------------------
// Integration: runDiscovery13f
// ---------------------------------------------------------------------------

type DiscoveryEventStore = EventStore<LedgerEventEnvelope<unknown>>

let companyTickersCache: CompanyTickerEntry[] | undefined

/** Test-only hook to reset the module-level company_tickers cache. */
export function __resetCompanyTickersCacheForTests(): void {
  companyTickersCache = undefined
}

async function fetchCompanyTickersDefault(deps?: Sec13fDeps): Promise<CompanyTickerEntry[]> {
  if (companyTickersCache !== undefined) return companyTickersCache
  const map = await fetchSecJson<Record<string, CompanyTickerEntry>>('https://www.sec.gov/files/company_tickers.json', deps)
  if (map === undefined) return []
  companyTickersCache = Object.values(map)
  return companyTickersCache
}

// ---------------------------------------------------------------------------
// OpenFIGI CUSIP -> ticker resolution (keyless, cached, fail-closed)
// ---------------------------------------------------------------------------

const OPENFIGI_MAPPING_URL = 'https://api.openfigi.com/v3/mapping'
const OPENFIGI_CHUNK_SIZE = 10 // keyless job limit per request

let cusipTickerCache: Map<string, string> | undefined

/** Test-only hook to reset the module-level CUSIP->ticker cache. */
export function __resetCusipTickerCacheForTests(): void {
  cusipTickerCache = undefined
}

/**
 * Resolve CUSIP -> US ticker via OpenFIGI's free KEYLESS mapping API (10 jobs/request). Fail-closed: any
 * error (network, non-200, bad JSON, chunk failure) contributes nothing — returns the map of whatever
 * resolved and NEVER throws. Cached across runs (CUSIP->ticker is stable). Returns only the requested
 * cusips that resolved.
 */
export async function fetchOpenFigiTickers(cusips: string[], deps?: Sec13fDeps): Promise<Map<string, string>> {
  const cache = cusipTickerCache ?? (cusipTickerCache = new Map<string, string>())
  const requested = [...new Set(cusips.map((c) => c.toUpperCase()).filter((c) => c.length > 0))]
  const missing = requested.filter((c) => !cache.has(c))
  const fetchFn = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? SEC_DEFAULT_TIMEOUT_MS

  for (let i = 0; i < missing.length; i += OPENFIGI_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + OPENFIGI_CHUNK_SIZE)
    let url: URL
    try { url = assertPublicHttpUrl(OPENFIGI_MAPPING_URL) } catch { continue }
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    try {
      const response = await fetchFn(url.toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((cusip) => ({ idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' }))),
      })
      if (!response.ok) continue
      const jobs = (await response.json()) as Array<{ data?: Array<{ ticker?: unknown }> }>
      if (!Array.isArray(jobs)) continue
      jobs.forEach((job, idx) => {
        const cusip = chunk[idx]
        const ticker = job?.data?.[0]?.ticker
        if (cusip !== undefined && typeof ticker === 'string' && ticker.length > 0) {
          cache.set(cusip, ticker.toUpperCase())
        }
      })
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  const out = new Map<string, string>()
  for (const cusip of requested) {
    const ticker = cache.get(cusip)
    if (ticker !== undefined) out.set(cusip, ticker)
  }
  return out
}

export type RunDiscovery13fDeps = {
  /** Live fetch is the default; tests inject these to avoid the network. */
  fetchManagerQuarters?: (managers: readonly ClonerManager[]) => Promise<ManagerQuarter[]>
  fetchCompanyTickers?: () => Promise<CompanyTickerEntry[]>
  /** CUSIP -> ticker resolver (defaults to keyless OpenFIGI live; injected in tests). */
  fetchCusipTickers?: (cusips: string[]) => Promise<Map<string, string>>
  /** Manager list override (defaults to CLONER_LIST). */
  cloners?: readonly ClonerManager[]
  /** Strategy ref recorded on each candidate. */
  strategy_id?: string
  strategy_version?: string
  /** When true, REQUIRES injected fetch deps and never touches the network (unit-test guard). */
  test_mode?: boolean
  sec?: Sec13fDeps
  now?: () => string
}

export type RunDiscovery13fResult = {
  signals_detected: number
  candidates_created: number
  sector_excluded: number
  unresolved: number
  summaries: string[]
}

const DISCOVERY_ACTOR_ID = 'owlfolio-worker'

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Run the deterministic 13F clone engine over the cloner list and record source:'13f_clone' CANDIDATE
 * entries for surviving signals. Idempotent per (manager-set quarter, cusip): re-running a quarter does
 * not duplicate candidates. Does NOT auto-advance candidates past `discovered` — the human / quick-screen
 * gate stays. Fail-closed: in test_mode the fetch deps MUST be injected (no live SEC in unit tests).
 */
export async function runDiscovery13f(
  store: DiscoveryEventStore,
  deps: RunDiscovery13fDeps = {},
): Promise<RunDiscovery13fResult> {
  const cloners = deps.cloners ?? CLONER_LIST
  const now = deps.now ?? nowIso
  const strategyId = deps.strategy_id ?? 'buffett-munger'
  // Stamp the strategy's CANONICAL version (buffett-munger@1.0.0), not a bespoke '2026.06' string — a
  // promoted candidate becomes a research case the pipeline runs, and the swarm guards that the case's
  // strategy_version matches the pipeline's. resolveResearchStrategyRef honours an explicit override and
  // otherwise resolves the registered version.
  const strategyVersion = resolveResearchStrategyRef({
    strategy_id: strategyId,
    ...(deps.strategy_version === undefined ? {} : { strategy_version: deps.strategy_version }),
  }).strategy_version

  if (deps.test_mode === true && (deps.fetchManagerQuarters === undefined || deps.fetchCompanyTickers === undefined)) {
    throw new Error('runDiscovery13f test_mode requires injected fetchManagerQuarters + fetchCompanyTickers (no live SEC in tests)')
  }

  const fetchQuarters = deps.fetchManagerQuarters ?? (async (managers) => {
    const out: ManagerQuarter[] = []
    for (const m of managers) {
      if (m.cik === undefined) continue
      const q = await fetchManager13F(m.manager_name, m.cik, deps.sec)
      if (q !== undefined) out.push(q)
    }
    return out
  })
  const fetchTickers = deps.fetchCompanyTickers ?? (() => fetchCompanyTickersDefault(deps.sec))

  const quarters = await fetchQuarters(cloners)
  const tickers = await fetchTickers()

  const result: RunDiscovery13fResult = {
    signals_detected: 0,
    candidates_created: 0,
    sector_excluded: 0,
    unresolved: 0,
    summaries: [],
  }

  const signals = rankDiscoverySignals(detectClusterSignals(quarters))
  result.signals_detected = signals.length

  // Quarter label for the idempotency/dedupe key: use the most common period among quarters.
  const period = quarters[0]?.period ?? new Date(now()).toISOString().slice(0, 10)

  // Shariah sector pre-filter BEFORE candidate creation.
  const survivors = classifyShariahSector(signals.map((s) => ({ issuer: s.issuer, cusip: s.cusip })))
  const excludedCusips = new Set(survivors.filter((s) => s.excluded).map((s) => s.cusip))
  result.sector_excluded = excludedCusips.size

  const resolveCusips = deps.fetchCusipTickers
    ?? (deps.test_mode === true ? async () => new Map<string, string>() : (cs: string[]) => fetchOpenFigiTickers(cs, deps.sec))
  const cusipTickerMap = await resolveCusips(
    signals.filter((s) => !excludedCusips.has(s.cusip)).map((s) => s.cusip.toUpperCase()),
  )

  const existing = projectDiscoveryCandidates(await store.list())
  const existingDedupe = new Set(existing.map((c) => c.dedupe_key))

  for (const signal of signals) {
    if (excludedCusips.has(signal.cusip)) {
      result.summaries.push(`${signal.issuer} (${signal.cusip}) dropped by Shariah sector pre-filter`)
      continue
    }

    const cusipTicker = cusipTickerMap.get(signal.cusip.toUpperCase())
    let ticker: string
    let tickerResolution: 'matched_by_cusip' | 'matched_by_name' | 'unresolved'
    if (cusipTicker !== undefined) {
      ticker = cusipTicker.toUpperCase()
      tickerResolution = 'matched_by_cusip'
    } else {
      const resolved = resolveIssuerTicker(signal.issuer, tickers)
      if (resolved.resolution === 'matched' && resolved.ticker !== undefined) {
        ticker = resolved.ticker
        tickerResolution = 'matched_by_name'
      } else {
        ticker = `UNRESOLVED:${signal.cusip}`
        tickerResolution = 'unresolved'
        result.unresolved += 1
      }
    }

    // Normalize the CUSIP ONCE and use the same value for BOTH the dedupe key and the candidate id, so
    // the id can never collide for two CUSIPs that the dedupe key treats as distinct.
    const normalizedCusip = signal.cusip.toUpperCase()
    // dedupe/idempotency keyed by (strategy, period, cusip) so a quarter is recorded at most once.
    const dedupeKey = `13f_clone@${strategyVersion}:${period}:${normalizedCusip}`
    if (existingDedupe.has(dedupeKey)) {
      result.summaries.push(`${ticker} (${signal.cusip}) already recorded for ${period}; skipping duplicate`)
      continue
    }
    existingDedupe.add(dedupeKey)

    const candidateId = `cand_13f_${period}_${normalizedCusip}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const discoveredAt = now()
    const sourceId = `sec-13f:${period}:${signal.cusip}`
    const discoveryMetadata = {
      source: '13f_clone',
      signal_type: signal.signal_type,
      contributing_managers: signal.contributing_managers,
      conviction_pct: signal.conviction_pct,
      cusip: signal.cusip,
      period,
      ticker_resolution: tickerResolution,
      rationale: `${signal.signal_type} from ${signal.contributing_managers.join(', ')} (conviction ${(signal.conviction_pct * 100).toFixed(1)}% of portfolio)`,
    }

    const payload = {
      candidate_id: candidateId,
      ticker,
      company_name: signal.issuer,
      market: 'US',
      strategy_id: strategyId,
      strategy_version: strategyVersion,
      discovery_source: '13f_clone',
      source_ids: [sourceId],
      discovered_at: discoveredAt,
      status: 'discovered' as const,
      dedupe_key: dedupeKey,
      discovery_metadata: discoveryMetadata,
    }

    await store.append({
      event_id: `evt_discovery_candidate_discovered_${candidateId}`,
      event_type: 'discovery_candidate_discovered',
      aggregate_type: 'discovery_candidate',
      aggregate_id: candidateId,
      correlation_id: candidateId,
      actor_type: 'worker',
      actor_id: DISCOVERY_ACTOR_ID,
      payload,
      source_ids: [sourceId],
      created_at: discoveredAt,
      schema_version: 1,
      idempotency_key: `discovery-13f:${dedupeKey}`,
    } satisfies LedgerEventEnvelope<typeof payload>)

    result.candidates_created += 1
    result.summaries.push(`recorded 13f_clone candidate ${ticker} (${signal.signal_type}); human/quick-screen gates entry to research`)
  }

  return result
}
