import type { LedgerEventEnvelope } from '../eventEnvelope'

// The 13F page's read model (owner-approved 2026-07-16): manager-quarter portfolio snapshots +
// the aggregated latest-quarter SELL side, folded from `discovery_13f_quarter_recorded` events
// (one idempotent snapshot per manager+period; the latest period per manager wins the active view;
// older snapshots remain in the ledger as history).

export type Discovery13fHolding = {
  cusip: string
  issuer: string
  ticker?: string
  value: number
  shares: number
  pct: number
  change: 'NEW' | 'ADD' | 'TRIM' | 'UNCHANGED'
}

export type Discovery13fBuy = {
  cusip: string
  issuer: string
  ticker?: string
  signal_type: 'NEW_POSITION' | 'MEANINGFUL_ADD'
  /** The position's share of the manager's book — the heat-map's intensity axis. */
  conviction_pct: number
}

export type Discovery13fSell = {
  manager_name: string
  cusip: string
  issuer: string
  ticker?: string
  signal_type: 'EXIT' | 'MEANINGFUL_TRIM'
  prior_shares: number
  current_shares: number
  prior_conviction_pct: number
}

export type Discovery13fQuarter = {
  manager_name: string
  cik: string
  period: string
  report_date?: string
  filed_date?: string
  total_value: number
  position_count: number
  top_holdings: Discovery13fHolding[]
  /** Per-manager buy signals (v2 payloads; [] on legacy v1 snapshots). */
  buys: Discovery13fBuy[]
  sells: Discovery13fSell[]
  recorded_at: string
}

export type Discovery13fAggregatedSell = {
  /** The dedupe key: the resolved ticker when present, else the cusip. */
  key: string
  ticker?: string
  issuer: string
  signal_type: 'EXIT' | 'MEANINGFUL_TRIM'
  managers: string[]
  period: string
}

export type Discovery13fProjection = {
  /** The latest snapshot per manager (by period label, then recency). */
  quarters: Discovery13fQuarter[]
  /** The latest-period sells aggregated across managers — exits outrank trims per name. */
  sells: Discovery13fAggregatedSell[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function foldHolding(value: unknown): Discovery13fHolding | undefined {
  if (!isRecord(value)) return undefined
  const cusip = str(value['cusip'])
  const issuer = str(value['issuer'])
  const change = str(value['change'])
  const ticker = str(value['ticker'])
  if (cusip === undefined || issuer === undefined) return undefined
  return {
    cusip,
    issuer,
    ...(ticker === undefined ? {} : { ticker }),
    value: num(value['value']),
    shares: num(value['shares']),
    pct: num(value['pct']),
    change: change === 'NEW' || change === 'ADD' || change === 'TRIM' ? change : 'UNCHANGED',
  }
}

function foldBuy(value: unknown): Discovery13fBuy | undefined {
  if (!isRecord(value)) return undefined
  const cusip = str(value['cusip'])
  const issuer = str(value['issuer'])
  const signal = str(value['signal_type'])
  const ticker = str(value['ticker'])
  if (cusip === undefined || issuer === undefined) return undefined
  if (signal !== 'NEW_POSITION' && signal !== 'MEANINGFUL_ADD') return undefined
  return {
    cusip,
    issuer,
    ...(ticker === undefined ? {} : { ticker }),
    signal_type: signal,
    conviction_pct: num(value['conviction_pct']),
  }
}

function foldSell(value: unknown): Discovery13fSell | undefined {
  if (!isRecord(value)) return undefined
  const cusip = str(value['cusip'])
  const issuer = str(value['issuer'])
  const managerName = str(value['manager_name'])
  const signal = str(value['signal_type'])
  if (cusip === undefined || issuer === undefined || managerName === undefined) return undefined
  if (signal !== 'EXIT' && signal !== 'MEANINGFUL_TRIM') return undefined
  const ticker = str(value['ticker'])
  return {
    manager_name: managerName,
    cusip,
    issuer,
    ...(ticker === undefined ? {} : { ticker }),
    signal_type: signal,
    prior_shares: num(value['prior_shares']),
    current_shares: num(value['current_shares']),
    prior_conviction_pct: num(value['prior_conviction_pct']),
  }
}

export type ProjectDiscovery13fOptions = {
  /**
   * Display allowlist: only quarters from these CIKs project (the live roster). Ledger events from
   * managers removed from the roster remain the audit record but leave the active boards.
   */
  ciks?: readonly string[]
}

export function projectDiscovery13f(
  events: LedgerEventEnvelope<unknown>[],
  options: ProjectDiscovery13fOptions = {},
): Discovery13fProjection {
  const latestByManager = new Map<string, Discovery13fQuarter>()
  const allowed = options.ciks === undefined ? undefined : new Set(options.ciks)

  for (const event of events) {
    if (event.event_type !== 'discovery_13f_quarter_recorded' || !isRecord(event.payload)) continue
    const p = event.payload
    const cik = str(p['cik'])
    if (cik !== undefined && allowed !== undefined && !allowed.has(cik)) continue
    const managerName = str(p['manager_name'])
    const period = str(p['period'])
    if (cik === undefined || managerName === undefined || period === undefined) continue
    const reportDate = str(p['report_date'])
    const filedDate = str(p['filed_date'])

    const quarter: Discovery13fQuarter = {
      manager_name: managerName,
      cik,
      period,
      ...(reportDate === undefined ? {} : { report_date: reportDate }),
      ...(filedDate === undefined ? {} : { filed_date: filedDate }),
      total_value: num(p['total_value']),
      position_count: num(p['position_count']),
      top_holdings: Array.isArray(p['top_holdings']) ? p['top_holdings'].flatMap((h) => foldHolding(h) ?? []) : [],
      buys: Array.isArray(p['buys']) ? p['buys'].flatMap((b) => foldBuy(b) ?? []) : [],
      sells: Array.isArray(p['sells']) ? p['sells'].flatMap((s) => foldSell(s) ?? []) : [],
      recorded_at: event.created_at,
    }
    const existing = latestByManager.get(cik)
    // Period labels (YYYYQn) sort lexicographically; ties resolve to the later event (re-harvest).
    if (existing === undefined || quarter.period >= existing.period) {
      latestByManager.set(cik, quarter)
    }
  }

  const quarters = [...latestByManager.values()].sort((a, b) => b.total_value - a.total_value)

  // The aggregated sell board: each manager's LATEST quarter contributes its sells; grouped per
  // name; EXIT outranks MEANINGFUL_TRIM when managers disagree in kind.
  const byName = new Map<string, Discovery13fAggregatedSell>()
  for (const quarter of quarters) {
    for (const sell of quarter.sells) {
      const key = sell.ticker ?? sell.cusip
      const existing = byName.get(key)
      if (existing === undefined) {
        byName.set(key, {
          key,
          ...(sell.ticker === undefined ? {} : { ticker: sell.ticker }),
          issuer: sell.issuer,
          signal_type: sell.signal_type,
          managers: [sell.manager_name],
          period: quarter.period,
        })
      } else {
        if (!existing.managers.includes(sell.manager_name)) existing.managers.push(sell.manager_name)
        if (sell.signal_type === 'EXIT') existing.signal_type = 'EXIT'
        if (quarter.period > existing.period) existing.period = quarter.period
      }
    }
  }
  const sells = [...byName.values()].sort((a, b) =>
    b.managers.length - a.managers.length
    || (a.signal_type === b.signal_type ? 0 : a.signal_type === 'EXIT' ? -1 : 1)
    || a.key.localeCompare(b.key))

  return { quarters, sells }
}
