// Insider forms (Form 4) — deterministic parse of SEC ownership documents (design-doc §3.3).
//
// Form 4 is STRUCTURED XML (ownershipDocument → nonDerivative/derivative transaction tables), unlike
// the narrative filings the swarm grounds elsewhere. Under "code computes, judgment proposes" the
// harness parses it deterministically and hands the model a computed summary; the model never
// re-derives the figures. Conventions mirror discovery13f.ts / secEdgar.ts: injectable fetch, SSRF
// guard narrowed to SEC hosts, explicit timeouts, and FAIL-CLOSED behaviour (any error returns
// undefined / empty and never throws to a live caller).
//
// The single most important rule: a Form 4 <transactionCode> must be classified before its shares are
// counted. Only DISCRETIONARY open-market trades (P = buy, S = sell) are a management-quality signal.
// MECHANICAL activity (M = option/RSU exercise, F = shares withheld for tax on vesting, A = grant) is
// NOT a trade and must never masquerade as a buy/sell.

import type { FilingRef } from './secEdgar'
import { assertPublicHttpUrl } from './sourceGrounding'

export type TransactionClass = 'discretionary_buy' | 'discretionary_sell' | 'mechanical' | 'other'

// ---------------------------------------------------------------------------
// Namespace-agnostic XML helpers (same regex approach as discovery13f.ts — the
// codebase parses SEC XML with regex, no DOM/XML dependency).
// ---------------------------------------------------------------------------

function tagText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i')
  const m = re.exec(block)
  return m?.[1]?.trim()
}

/** Read `<outer><value>X</value></outer>` — Form 4 wraps most scalars in a `<value>` element. */
function valueOf(block: string, outerTag: string): string | undefined {
  const sub = tagText(block, outerTag)
  if (sub === undefined) return undefined
  return tagText(sub, 'value')
}

function numberValueOf(block: string, outerTag: string): number | undefined {
  const text = valueOf(block, outerTag)
  if (text === undefined) return undefined
  const n = Number(text.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function isXmlTrue(block: string, tag: string): boolean {
  const raw = tagText(block, tag)?.toLowerCase()
  return raw === 'true' || raw === '1'
}

/**
 * Classify a Form 4 transaction code. Discretionary open-market trades (P/S) are the signal;
 * option/RSU/tax mechanics (M/F/A) are mechanical; everything else (gifts, conversions, expirations,
 * unknown/empty) is 'other'. Case-insensitive; fail-safe to 'other'.
 */
export function classifyTransactionCode(code: string): TransactionClass {
  switch (code.trim().toUpperCase()) {
    case 'P':
      return 'discretionary_buy'
    case 'S':
      return 'discretionary_sell'
    case 'M':
    case 'F':
    case 'A':
      return 'mechanical'
    default:
      return 'other'
  }
}

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

export type Form4Transaction = {
  security_title: string
  transaction_date: string
  code: string
  transaction_class: TransactionClass
  /** SEC acquired/disposed code: 'A' acquired, 'D' disposed. */
  acquired_disposed: 'A' | 'D' | undefined
  shares: number
  /** undefined when the filing gives only a footnote (price unknown) — never defaulted to 0. */
  price_per_share: number | undefined
  shares_owned_following: number | undefined
  /** 'D' direct, 'I' indirect. */
  direct_or_indirect: 'D' | 'I' | undefined
  derivative: boolean
}

export type Form4Owner = {
  name: string
  cik: string | undefined
  is_officer: boolean
  is_director: boolean
  is_ten_percent_owner: boolean
  officer_title: string | undefined
}

export type Form4Filing = {
  issuer_symbol: string | undefined
  issuer_cik: string | undefined
  period_of_report: string | undefined
  owner: Form4Owner
  transactions: Form4Transaction[]
}

// ---------------------------------------------------------------------------
// Deterministic aggregation — "code computes, judgment proposes".
// ---------------------------------------------------------------------------

export type InsiderCluster = {
  window_days: number
  discretionary_sell_count: number
  distinct_sellers: number
  /** Net $ of discretionary sales (rows with a known price) within the cluster window. */
  net_sell_value: number
}

export type InsiderSummaryComputed = {
  computable: true
  as_of: string
  window_months: number
  discretionary_buy_shares: number
  discretionary_sell_shares: number
  discretionary_buy_value: number
  discretionary_sell_value: number
  distinct_buyers: number
  distinct_sellers: number
  officer_director_sell_shares: number
  ten_percent_owner_sell_shares: number
  /** Mechanical (RSU vest / option exercise / tax-withholding) disposals, surfaced so they are never read as sales. */
  mechanical_disposed_shares: number
  cluster: InsiderCluster | undefined
  filings_considered: number
  transactions_considered: number
  /** True when the caller capped the fetched window (heavy filer) — keeps a truncated view honest. */
  window_truncated: boolean
}

export type InsiderSummary = InsiderSummaryComputed | { computable: false; reason: string }

export type ComputeInsiderSummaryOptions = {
  /** ISO date (YYYY-MM-DD) the summary is computed as of. */
  asOf: string
  /** Trailing window for the rollup. Default 12 months. */
  windowMonths?: number
  /** Rolling window for cluster detection. Default 90 days. */
  clusterWindowDays?: number
  /** True when the upstream fetch hit its cap and older filings were dropped. */
  windowTruncated?: boolean
}

function shiftIsoDate(iso: string, { months = 0, days = 0 }: { months?: number; days?: number }): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (months !== 0) d.setUTCMonth(d.getUTCMonth() - months)
  if (days !== 0) d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Fold parsed Form 4 filings into a deterministic per-ticker insider-transaction summary over a trailing
 * window. Only NON-derivative discretionary trades (P/S) feed the buy/sell tallies; mechanical activity
 * (RSU/option/tax) is surfaced separately and never counted as a sale. Returns { computable:false } when
 * there is nothing to summarize in the window (mirrors the codebase's typed "not computable" results).
 */
export function computeInsiderSummary(filings: Form4Filing[], opts: ComputeInsiderSummaryOptions): InsiderSummary {
  const windowMonths = opts.windowMonths ?? 12
  const clusterWindowDays = opts.clusterWindowDays ?? 90
  if (!Array.isArray(filings) || filings.length === 0) {
    return { computable: false, reason: 'no Form 4 filings' }
  }

  const windowCutoff = shiftIsoDate(opts.asOf, { months: windowMonths })
  const clusterCutoff = shiftIsoDate(opts.asOf, { days: clusterWindowDays })

  let buyShares = 0
  let sellShares = 0
  let buyValue = 0
  let sellValue = 0
  let officerDirectorSellShares = 0
  let tenPercentSellShares = 0
  let mechanicalDisposedShares = 0
  let considered = 0
  const buyers = new Set<string>()
  const sellers = new Set<string>()

  let clusterSellCount = 0
  let clusterSellValue = 0
  const clusterSellers = new Set<string>()

  for (const f of filings) {
    const owner = f.owner.name
    for (const t of f.transactions) {
      // Open-market discretionary trades are always non-derivative; ignore derivative rows for the signal.
      if (t.derivative) continue
      if (t.transaction_date < windowCutoff || t.transaction_date > opts.asOf) continue
      considered += 1
      const value = t.price_per_share === undefined ? 0 : t.shares * t.price_per_share
      if (t.transaction_class === 'discretionary_buy') {
        buyShares += t.shares
        buyValue += value
        buyers.add(owner)
      } else if (t.transaction_class === 'discretionary_sell') {
        sellShares += t.shares
        sellValue += value
        sellers.add(owner)
        if (f.owner.is_officer || f.owner.is_director) officerDirectorSellShares += t.shares
        if (f.owner.is_ten_percent_owner) tenPercentSellShares += t.shares
        if (t.transaction_date >= clusterCutoff) {
          clusterSellCount += 1
          clusterSellValue += value
          clusterSellers.add(owner)
        }
      } else if (t.transaction_class === 'mechanical' && t.acquired_disposed === 'D') {
        mechanicalDisposedShares += t.shares
      }
    }
  }

  if (considered === 0) {
    return { computable: false, reason: 'no Form 4 transactions in window' }
  }

  const cluster: InsiderCluster | undefined =
    clusterSellCount > 0
      ? {
          window_days: clusterWindowDays,
          discretionary_sell_count: clusterSellCount,
          distinct_sellers: clusterSellers.size,
          net_sell_value: clusterSellValue,
        }
      : undefined

  return {
    computable: true,
    as_of: opts.asOf,
    window_months: windowMonths,
    discretionary_buy_shares: buyShares,
    discretionary_sell_shares: sellShares,
    discretionary_buy_value: buyValue,
    discretionary_sell_value: sellValue,
    distinct_buyers: buyers.size,
    distinct_sellers: sellers.size,
    officer_director_sell_shares: officerDirectorSellShares,
    ten_percent_owner_sell_shares: tenPercentSellShares,
    mechanical_disposed_shares: mechanicalDisposedShares,
    cluster,
    filings_considered: filings.length,
    transactions_considered: considered,
    window_truncated: opts.windowTruncated ?? false,
  }
}

// ---------------------------------------------------------------------------
// Selection + live fetch orchestration (injectable, fail-closed).
// ---------------------------------------------------------------------------

const SEC_ALLOWED_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const SEC_DEFAULT_TIMEOUT_MS = 15_000
const SEC_DEFAULT_USER_AGENT = 'Owlfolio research (local)'

const DEFAULT_WINDOW_MONTHS = 12
const DEFAULT_MAX_FILINGS = 40

export type SecForm4Deps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
  /** Override the per-document fetch (tests inject fixtures; never touches the network). */
  fetchDocument?: (url: string) => Promise<string | undefined>
}

function assertSecUrl(rawUrl: string): URL {
  const url = assertPublicHttpUrl(rawUrl)
  if (!SEC_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`SEC URL host not allowed: ${url.hostname}`)
  }
  return url
}

function resolveUserAgent(deps?: SecForm4Deps): string {
  return deps?.userAgent ?? process.env['OWLFOLIO_SEC_USER_AGENT'] ?? SEC_DEFAULT_USER_AGENT
}

/** Fetch a Form 4 XML document. SSRF-guarded, single-shot, fail-closed to undefined (mirrors secEdgar). */
export async function fetchForm4Document(rawUrl: string, deps?: SecForm4Deps): Promise<string | undefined> {
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
      headers: { 'User-Agent': resolveUserAgent(deps), Accept: 'application/xml' },
    })
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Narrow a Form 4 filing list to the trailing window and cap the count (newest-first). Pure/fail-closed:
 * returns [] when nothing qualifies. The cap bounds the per-document fetch cost for heavy filers.
 */
export function selectRecentForm4Filings(
  filings: FilingRef[],
  opts: { asOf: string; withinMonths?: number; max?: number },
): FilingRef[] {
  if (!Array.isArray(filings) || filings.length === 0) return []
  const cutoff = shiftIsoDate(opts.asOf, { months: opts.withinMonths ?? DEFAULT_WINDOW_MONTHS })
  const inWindow = filings.filter((f) => f.filed >= cutoff && f.filed <= opts.asOf)
  const sorted = [...inWindow].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))
  return sorted.slice(0, opts.max ?? DEFAULT_MAX_FILINGS)
}

/**
 * Resolve a deterministic insider-transaction summary from a Form 4 filing list: select the recent
 * subset, fetch + parse each document (fail-closed — a document that won't fetch/parse is skipped), and
 * aggregate. Returns { computable:false } when nothing usable remains.
 */
export async function resolveInsiderSummary(
  form4Filings: FilingRef[],
  opts: { asOf: string; windowMonths?: number; clusterWindowDays?: number; max?: number },
  deps?: SecForm4Deps,
): Promise<InsiderSummary> {
  if (!Array.isArray(form4Filings) || form4Filings.length === 0) {
    return { computable: false, reason: 'no Form 4 filings' }
  }
  const windowMonths = opts.windowMonths ?? DEFAULT_WINDOW_MONTHS
  const max = opts.max ?? DEFAULT_MAX_FILINGS
  const inWindowCount = form4Filings.filter(
    (f) => f.filed >= shiftIsoDate(opts.asOf, { months: windowMonths }) && f.filed <= opts.asOf,
  ).length
  const selected = selectRecentForm4Filings(form4Filings, { asOf: opts.asOf, withinMonths: windowMonths, max })

  const fetchDocument = deps?.fetchDocument ?? ((url: string) => fetchForm4Document(url, deps))
  const parsed: Form4Filing[] = []
  for (const ref of selected) {
    const xml = await fetchDocument(ref.url)
    if (xml === undefined) continue
    const filing = parseForm4Ownership(xml)
    if (filing !== undefined) parsed.push(filing)
  }
  if (parsed.length === 0) {
    return { computable: false, reason: 'no Form 4 documents fetched/parsed' }
  }

  return computeInsiderSummary(parsed, {
    asOf: opts.asOf,
    windowMonths,
    ...(opts.clusterWindowDays !== undefined ? { clusterWindowDays: opts.clusterWindowDays } : {}),
    windowTruncated: inWindowCount > max,
  })
}

function parseTransactionBlock(block: string, derivative: boolean): Form4Transaction | undefined {
  const code = tagText(tagText(block, 'transactionCoding') ?? '', 'transactionCode')
  const shares = numberValueOf(block, 'transactionShares')
  // Required fields: a transaction without a code or a share count is unusable — skip it (fail-closed).
  if (code === undefined || shares === undefined) return undefined

  const acquiredDisposed = valueOf(block, 'transactionAcquiredDisposedCode')
  const directOrIndirect = valueOf(block, 'directOrIndirectOwnership')
  return {
    security_title: valueOf(block, 'securityTitle') ?? '',
    transaction_date: valueOf(block, 'transactionDate') ?? '',
    code,
    transaction_class: classifyTransactionCode(code),
    acquired_disposed: acquiredDisposed === 'A' || acquiredDisposed === 'D' ? acquiredDisposed : undefined,
    shares,
    price_per_share: numberValueOf(block, 'transactionPricePerShare'),
    shares_owned_following: numberValueOf(block, 'sharesOwnedFollowingTransaction'),
    direct_or_indirect: directOrIndirect === 'D' || directOrIndirect === 'I' ? directOrIndirect : undefined,
    derivative,
  }
}

function matchBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>[\\s\\S]*?</(?:[\\w.-]+:)?${tag}>`, 'gi')
  return xml.match(re) ?? []
}

/**
 * Parse a Form 4 ownershipDocument XML into a normalized filing. Namespace-agnostic and fail-closed:
 * returns undefined for empty/malformed input or a document with no reporting-owner name. Transaction
 * rows missing a code or share count are skipped, never defaulted.
 */
export function parseForm4Ownership(xml: string): Form4Filing | undefined {
  if (typeof xml !== 'string' || xml.trim().length === 0) return undefined
  if (!/ownershipDocument/i.test(xml)) return undefined

  const ownerName = tagText(xml, 'rptOwnerName')
  if (ownerName === undefined) return undefined

  const transactions: Form4Transaction[] = []
  for (const block of matchBlocks(xml, 'nonDerivativeTransaction')) {
    const tx = parseTransactionBlock(block, false)
    if (tx !== undefined) transactions.push(tx)
  }
  for (const block of matchBlocks(xml, 'derivativeTransaction')) {
    const tx = parseTransactionBlock(block, true)
    if (tx !== undefined) transactions.push(tx)
  }

  return {
    issuer_symbol: tagText(xml, 'issuerTradingSymbol'),
    issuer_cik: tagText(xml, 'issuerCik'),
    period_of_report: tagText(xml, 'periodOfReport'),
    owner: {
      name: ownerName,
      cik: tagText(xml, 'rptOwnerCik'),
      is_officer: isXmlTrue(xml, 'isOfficer'),
      is_director: isXmlTrue(xml, 'isDirector'),
      is_ten_percent_owner: isXmlTrue(xml, 'isTenPercentOwner'),
      officer_title: tagText(xml, 'officerTitle'),
    },
    transactions,
  }
}
