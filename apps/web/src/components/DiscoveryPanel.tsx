import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'

import {
  extractDiscoverySignal,
  type DiscoveryCandidateProjection,
} from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import type {
  Discovery13fHolding,
  Discovery13fQuarter,
} from '@owlfolio/ledger/projections/discovery13fProjection'
import { CLONER_LIST } from '@owlfolio/workflow/discovery13f'

import { titleCaseEntityName } from '../lib/entityName'
import { DiscoveryCandidateActions } from './DiscoveryCandidateActions'
import { RunDiscoveryButton } from './RunDiscoveryButton'

export type DiscoveryPanelRunStatus = {
  last_run_status: string
  last_result_summary?: string
  last_started_at?: string
}

export type DiscoveryPanelProps = {
  candidates: DiscoveryCandidateProjection[]
  runStatus?: DiscoveryPanelRunStatus
  /** Roster-filtered latest quarter per manager (buys + sells ride each quarter). */
  quarters: Discovery13fQuarter[]
  /** Tickers currently HELD — the matrix flags these and routes to the portfolio, never to triage. */
  heldTickers: string[]
  /** Tickers currently WATCHED — flagged, routed to the watchlist instead of triage. */
  watchedTickers: string[]
}

const mono2xs = { fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } as const

type MatrixSignal = 'NEW_POSITION' | 'MEANINGFUL_ADD' | 'EXIT' | 'MEANINGFUL_TRIM'

export type MatrixCell = {
  signal: MatrixSignal
  /** % of the manager's book (buys: current position; sells: the unwound prior position). */
  conviction_pct: number
  period: string
}

export type MatrixRow = {
  key: string
  ticker?: string
  issuer: string
  cells: Map<string, MatrixCell>
  buying: number
  selling: number
}

/**
 * The action matrix behind the heat map (owner-approved 2026-07-16): one row per name a tracked
 * manager acted on this quarter, one cell per manager. Buys come from v2 quarter snapshots
 * (legacy v1 snapshots contribute sells only until the next harvest re-emits). Rows rank by how
 * many managers acted — cluster activity floats to the top. Pure and exported for tests.
 */
export function buildActionMatrix(quarters: Discovery13fQuarter[]): MatrixRow[] {
  const rows = new Map<string, MatrixRow>()
  const rowFor = (ticker: string | undefined, cusip: string, issuer: string): MatrixRow => {
    const key = ticker ?? cusip
    const existing = rows.get(key)
    if (existing !== undefined) return existing
    const row: MatrixRow = { key, ...(ticker === undefined ? {} : { ticker }), issuer, cells: new Map(), buying: 0, selling: 0 }
    rows.set(key, row)
    return row
  }
  for (const quarter of quarters) {
    for (const buy of quarter.buys) {
      const row = rowFor(buy.ticker, buy.cusip, buy.issuer)
      row.cells.set(quarter.cik, { signal: buy.signal_type, conviction_pct: buy.conviction_pct, period: quarter.period })
      row.buying += 1
    }
    for (const sell of quarter.sells) {
      const row = rowFor(sell.ticker, sell.cusip, sell.issuer)
      row.cells.set(quarter.cik, { signal: sell.signal_type, conviction_pct: sell.prior_conviction_pct, period: quarter.period })
      row.selling += 1
    }
  }
  return [...rows.values()].sort((a, b) =>
    (b.buying + b.selling) - (a.buying + a.selling)
    || b.buying - a.buying
    || a.key.localeCompare(b.key))
}

/** 'Scion Asset Management (Michael Burry)' → 'MB' — the matrix column initials. */
export function investorInitials(managerName: string): string {
  const investor = /\(([^)]+)\)\s*$/.exec(managerName)?.[1] ?? managerName
  return investor.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 2)
}

/**
 * The 13F discovery page (owner-approved 2026-07-16): tracked value superinvestors, their latest
 * portfolios, and one action heat-map matrix of their latest buys and sells — an IDEA SOURCE
 * feeding the research funnel, never a copy signal. Honesty rails everywhere: quarterly filings
 * with up to a 45-day lag ("as of <report> · filed <filed>"), long US equities only, no
 * performance numbers, no auto-promotion, no prices. Server component (createElement, no JSX);
 * triage actions stay in the client component.
 */
export function DiscoveryPanel({ candidates, runStatus, quarters, heldTickers, watchedTickers }: DiscoveryPanelProps) {
  const discovered = candidates.filter((c) => c.status === 'discovered')
  const queued = candidates.filter((c) => c.status === 'queued_for_quick_screen')
  const resolved = candidates.filter((c) => c.status === 'rejected' || c.status === 'promoted_to_research_case')
  const homes: NameHomes = {
    held: new Set(heldTickers.map((t) => t.toUpperCase())),
    watched: new Set(watchedTickers.map((t) => t.toUpperCase())),
  }

  const runStatusLine = runStatus?.last_run_status === 'running'
    ? 'Running…'
    : runStatus?.last_result_summary ?? 'Never run'

  const matrix = buildActionMatrix(quarters)
  const matrixTickers = new Set(matrix.flatMap((row) => (row.ticker === undefined ? [] : [row.ticker.toUpperCase()])))
  const leftoverDiscovered = discovered.filter((c) => !matrixTickers.has(c.ticker.toUpperCase()))

  return createElement(
    Fragment,
    null,
    createSummaryHeader(runStatusLine),
    createActionMatrixSection(matrix, quarters, discovered, homes),
    leftoverDiscovered.length === 0 ? null : createLeftoverCandidatesSection(leftoverDiscovered),
    // Manager portfolios — compact expandable cards per tracked manager's latest quarter.
    createElement(
      'section',
      { 'aria-label': 'Manager portfolios', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `Manager portfolios · ${quarters.length}`),
      quarters.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No manager quarters harvested yet. Run the harvest to snapshot the tracked portfolios.')
        : createElement('div', { className: 'owl-row-list' }, ...quarters.map((q) => createManagerCard(q))),
      ...createUnfiledManagerNotes(quarters),
    ),
    // Screening + resolved — the existing triage tail.
    createElement(
      'section',
      { 'aria-label': 'Screening queue', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `Screening · ${queued.length}`),
      queued.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No candidates in screening.')
        : createElement(
            'div',
            { className: 'owl-row-list' },
            ...queued.map((c) => createCandidateCard(c)),
          ),
    ),
    createElement(
      'section',
      { 'aria-label': 'Resolved candidates', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement(
        'details',
        { suppressHydrationWarning: true },
        createElement(
          'summary',
          { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } },
          `Resolved · ${resolved.length}`,
        ),
        resolved.length === 0
          ? createElement('p', { className: 'owl-row-helper', style: { margin: '0.5rem 0 0' } }, 'No resolved candidates.')
          : createElement(
              'div',
              { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-2)' } },
              ...resolved.map((c) => createResolvedCard(c)),
            ),
      ),
    ),
  )
}

function createSummaryHeader(runStatusLine: string) {
  return createElement(
    'section',
    { 'aria-label': 'What 13F discovery is', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, '13F discovery'),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0, maxWidth: '52rem' } },
      'A small set of concentrated, low-turnover value superinvestors file their US stock holdings with the SEC every quarter (form 13F). '
      + 'This page monitors those portfolios and surfaces their latest buys and sells as research IDEAS — every candidate still goes through your own gate, analysis, and decision.',
    ),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0, maxWidth: '52rem' } },
      'Know the limits: filings arrive up to 45 days after the quarter ends, cover long US equities only (no cost basis, no shorts, no international, no timing inside the quarter), and give no reasons. Nothing here is a buy or sell instruction.',
    ),
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, runStatusLine),
    createElement(RunDiscoveryButton),
  )
}

// ---------------------------------------------------------------------------
// The action heat-map matrix
// ---------------------------------------------------------------------------

const CELL_GREEN = '74, 222, 128'
const CELL_RED = '248, 113, 113'
const CELL_AMBER = '251, 191, 36'

function cellColor(cell: MatrixCell): { color: string; glyph: string } {
  const rgb = cell.signal === 'EXIT' ? CELL_RED : cell.signal === 'MEANINGFUL_TRIM' ? CELL_AMBER : CELL_GREEN
  // Intensity buckets by % of the manager's book: ≥5% full, 2–5% mid, <2% faint.
  const alpha = cell.conviction_pct >= 0.05 ? 1 : cell.conviction_pct >= 0.02 ? 0.72 : 0.45
  return { color: `rgba(${rgb}, ${alpha})`, glyph: cell.signal === 'EXIT' || cell.signal === 'MEANINGFUL_TRIM' ? '▼' : '▲' }
}

function cellTitle(cell: MatrixCell, managerDisplay: string): string {
  const what = cell.signal === 'NEW_POSITION' ? 'NEW position'
    : cell.signal === 'MEANINGFUL_ADD' ? 'added >25% to the position'
    : cell.signal === 'EXIT' ? 'EXITED the position'
    : 'trimmed >25% of the position'
  const conviction = `${(cell.conviction_pct * 100).toFixed(1)}% of the book${cell.signal === 'EXIT' || cell.signal === 'MEANINGFUL_TRIM' ? ' (prior quarter)' : ''}`
  return `${managerDisplay}: ${what} — ${conviction} · 13F ${cell.period}`
}

function matrixGridStyle(managerCount: number): CSSProperties {
  return {
    alignItems: 'center',
    display: 'grid',
    gap: '0.15rem 0.35rem',
    gridTemplateColumns: `minmax(10rem, 1fr) repeat(${managerCount}, minmax(1.5rem, 2rem)) minmax(6.5rem, auto)`,
  }
}

type NameHomes = { held: Set<string>; watched: Set<string> }

function createActionMatrixSection(
  matrix: MatrixRow[],
  quarters: Discovery13fQuarter[],
  discovered: DiscoveryCandidateProjection[],
  homes: NameHomes,
) {
  const managers = CLONER_LIST.filter((m) => m.cik !== undefined)
  const quarterByCik = new Map(quarters.map((q) => [q.cik, q]))
  const latestPeriod = quarters.reduce((max, q) => (q.period > max ? q.period : max), '')
  const laggards = quarters.filter((q) => q.period < latestPeriod)
  const candidateByTicker = new Map(discovered.map((c) => [c.ticker.toUpperCase(), c]))

  const header = createElement(
    'div',
    { style: matrixGridStyle(managers.length) },
    createElement('span', { key: 'lbl', style: { ...mono2xs, color: 'var(--owl-color-quiet)', fontWeight: 400 } }, 'TICKER — COMPANY'),
    ...managers.map((m) => {
      const q = m.cik === undefined ? undefined : quarterByCik.get(m.cik)
      return createElement(
        'span',
        {
          key: m.cik,
          style: { ...mono2xs, color: q === undefined ? 'var(--owl-color-quiet)' : 'var(--owl-color-muted)', textAlign: 'center' },
          title: `${shortManagerName(m.manager_name)}${q === undefined ? ' — no filing harvested' : ` · 13F ${q.period}`}`,
        },
        investorInitials(m.manager_name),
      )
    }),
    createElement('span', { key: 'sum' }),
  )

  return createElement(
    'section',
    { 'aria-label': 'Manager actions', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, `Manager actions · ${matrix.length} names`),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0 } },
      'Every name a tracked manager bought into, added to, trimmed, or exited in their latest filing — one column per investor, names with the most action on top. '
      + 'Green ▲ new/add, red ▼ exit, amber ▼ trim; a deeper color means a bigger share of that manager’s book. The filing gives no reasons — an idea to research, never a copy trade.',
    ),
    laggards.length > 0
      ? createElement(
          'p',
          { className: 'owl-row-helper', style: { margin: 0 } },
          `Latest quarter: ${latestPeriod}. Lagging filers: ${laggards.map((q) => `${shortManagerName(q.manager_name)} (${q.period})`).join(', ')}.`,
        )
      : null,
    matrix.length === 0
      ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No manager actions harvested yet. Run the harvest to check the latest filings.')
      : createElement(
          'div',
          { style: { display: 'grid', gap: '0.1rem', overflowX: 'auto' } },
          header,
          ...matrix.map((row) => createMatrixRow(row, managers, homes, candidateByTicker)),
        ),
  )
}

function createMatrixRow(
  row: MatrixRow,
  managers: typeof CLONER_LIST[number][],
  homes: NameHomes,
  candidateByTicker: Map<string, DiscoveryCandidateProjection>,
) {
  const ticker = row.ticker?.toUpperCase()
  const home: 'held' | 'watched' | undefined = ticker !== undefined && homes.held.has(ticker)
    ? 'held'
    : ticker !== undefined && homes.watched.has(ticker) ? 'watched' : undefined
  const flagged = home !== undefined
  const summaryChip = row.buying > 0 && row.selling > 0
    ? createElement('span', { key: 's', style: { ...mono2xs, color: 'var(--owl-color-muted)' } }, 'MIXED')
    : row.buying > 0
      ? createElement('span', { key: 's', style: { ...mono2xs, color: `rgba(${CELL_GREEN}, 1)` } }, `${row.buying} BUYING`)
      : createElement('span', { key: 's', style: { ...mono2xs, color: `rgba(${CELL_RED}, 1)` } }, `${row.selling} SELLING`)

  const summary = createElement(
    'summary',
    { className: 'owl-focusable', style: { ...matrixGridStyle(managers.length), cursor: 'pointer', listStyle: 'none' } },
    createElement(
      'span',
      { key: 'id', style: { alignItems: 'baseline', display: 'flex', gap: '0.4rem', minWidth: 0 } },
      createElement('span', { style: { color: 'var(--owl-color-text)', fontWeight: 700, whiteSpace: 'nowrap' } }, row.ticker ?? 'UNRESOLVED'),
      createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, titleCaseEntityName(row.issuer)),
    ),
    ...managers.map((m) => {
      const cell = m.cik === undefined ? undefined : row.cells.get(m.cik)
      if (cell === undefined) {
        return createElement('span', { key: m.cik, style: { color: 'var(--owl-color-quiet)', opacity: 0.5, textAlign: 'center' } }, '·')
      }
      const { color, glyph } = cellColor(cell)
      return createElement(
        'span',
        { key: m.cik, style: { color, fontWeight: 800, textAlign: 'center' }, title: cellTitle(cell, shortManagerName(m.manager_name)) },
        glyph,
      )
    }),
    createElement(
      'span',
      { key: 'sum', style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', whiteSpace: 'nowrap' } },
      summaryChip,
      flagged ? createElement('span', { key: 'own', style: { ...mono2xs, color: CELL_AMBER_TEXT } }, home === 'held' ? '⚑ YOU HOLD' : '⚑ WATCHED') : null,
    ),
  )

  // ONE HOME PER NAME: a held or watched name already has its research home — the expansion routes
  // there instead of offering admission triage (a held name must never be 'accepted for screening').
  const candidate = row.ticker === undefined || home !== undefined ? undefined : candidateByTicker.get(row.ticker.toUpperCase())
  const homeLine = home === undefined
    ? null
    : createElement(
        'p',
        { className: 'owl-row-helper', style: { margin: 0 } },
        home === 'held' ? 'You hold this name — review your own thesis: ' : 'Already on your watchlist: ',
        createElement('a', { href: home === 'held' ? '/portfolio' : '/watchlist', style: { color: 'var(--owl-color-gold-bright)' } }, home === 'held' ? 'open the portfolio' : 'open the watchlist'),
      )
  const details = createElement(
    'div',
    { className: 'owl-workflow-card', style: { display: 'grid', gap: '0.35rem', margin: '0.3rem 0 0.5rem' } },
    ...managers.flatMap((m) => {
      const cell = m.cik === undefined ? undefined : row.cells.get(m.cik)
      if (cell === undefined) return []
      return [createElement('p', { key: m.cik, className: 'owl-row-helper', style: { margin: 0 } }, cellTitle(cell, shortManagerName(m.manager_name)))]
    }),
    homeLine,
    candidate === undefined
      ? null
      : createElement(DiscoveryCandidateActions, { candidateId: candidate.candidate_id, status: candidate.status }),
  )

  return createElement(
    'details',
    { key: row.key, 'data-matrix-row': row.ticker ?? row.key, suppressHydrationWarning: true },
    summary,
    details,
  )
}

const CELL_AMBER_TEXT = `rgba(${CELL_AMBER}, 1)`

function createLeftoverCandidatesSection(leftovers: DiscoveryCandidateProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Other pending candidates', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
    createElement(
      'details',
      { suppressHydrationWarning: true },
      createElement(
        'summary',
        { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } },
        `Other pending candidates · ${leftovers.length}`,
      ),
      createElement(
        'p',
        { className: 'owl-row-helper', style: { margin: '0.5rem 0 0' } },
        'Earlier-harvest candidates whose name is not in the current action matrix (e.g. from managers no longer tracked). Triage or leave them.',
      ),
      createElement('div', { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-2)' } }, ...leftovers.map((c) => createCandidateCard(c))),
    ),
  )
}

// ---------------------------------------------------------------------------
// Manager cards
// ---------------------------------------------------------------------------

function asOfLine(quarterOrPeriod: { period: string; report_date?: string; filed_date?: string }): string {
  const asOf = quarterOrPeriod.report_date ?? quarterOrPeriod.period
  return quarterOrPeriod.filed_date === undefined ? `as of ${asOf}` : `as of ${asOf} · filed ${quarterOrPeriod.filed_date}`
}

function fmtFilingValue(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/** The roster (firm + investor) name for a harvested quarter — legacy events stamped the SEC filer name. */
function displayManagerName(quarter: Discovery13fQuarter): string {
  const roster = CLONER_LIST.find((m) => m.cik === quarter.cik)
  return shortManagerName(roster?.manager_name ?? quarter.manager_name)
}

function createManagerCard(quarter: Discovery13fQuarter) {
  const top10 = quarter.top_holdings.slice(0, 10)
  return createElement(
    'details',
    { key: quarter.cik, className: 'owl-collapsible-card', 'data-manager-card': quarter.cik, suppressHydrationWarning: true },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      createElement('span', { key: 'name', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-lg)', fontWeight: 800 } }, displayManagerName(quarter)),
      createElement(
        'span',
        { key: 'figures', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-base)', whiteSpace: 'nowrap' } },
        `${fmtFilingValue(quarter.total_value)} · ${quarter.position_count} positions`,
      ),
      createElement('span', { key: 'spacer', style: { flex: '1 0 0.5rem' } }),
      createElement('span', { key: 'asof', style: { ...mono2xs, color: 'var(--owl-color-muted)', fontWeight: 400 } }, asOfLine(quarter).toUpperCase()),
    ),
    createElement(
      'div',
      { className: 'owl-workflow-card', style: { display: 'grid', gap: '0.4rem', marginTop: '0.5rem' } },
      createElement('p', { className: 'owl-section-accent', style: { margin: 0 } }, `Top ${top10.length} holdings (${asOfLine(quarter)})`),
      ...top10.map((h) => createHoldingLine(h, quarter.total_value)),
      quarter.sells.length > 0
        ? createElement(
            'p',
            { className: 'owl-row-helper', style: { margin: '0.4rem 0 0' } },
            `Sold this quarter: ${quarter.sells.map((s) => `${s.ticker ?? titleCaseEntityName(s.issuer)} (${s.signal_type === 'EXIT' ? 'exit' : 'trim'})`).join(', ')}`,
          )
        : null,
    ),
  )
}

function createHoldingLine(holding: Discovery13fHolding, totalValue: number) {
  const pct = totalValue > 0 ? `${((holding.value / totalValue) * 100).toFixed(1)}%` : '—'
  const changeColor = holding.change === 'NEW' || holding.change === 'ADD' ? '#4ade80' : holding.change === 'TRIM' ? '#fbbf24' : 'var(--owl-color-quiet)'
  return createElement(
    'p',
    { key: holding.cusip, style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', margin: 0 } },
    createElement('span', { key: 't', style: { color: 'var(--owl-color-text)', fontWeight: 700, minWidth: '4.5rem' } }, holding.ticker ?? '—'),
    createElement('span', { key: 'n', style: { color: 'var(--owl-color-muted)', flex: '0 1 auto', fontSize: 'var(--owl-text-sm)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, titleCaseEntityName(holding.issuer)),
    createElement('span', { key: 'spacer', style: { flex: '1 0 0.5rem' } }),
    createElement('span', { key: 'v', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', whiteSpace: 'nowrap' } }, `${pct} · ${fmtFilingValue(holding.value)}`),
    holding.change !== 'UNCHANGED'
      ? createElement('span', { key: 'c', style: { ...mono2xs, color: changeColor } }, holding.change)
      : null,
  )
}

/**
 * Tracked managers with NO harvested quarter render as honest muted notes — a dormant filer
 * (Pabrai: below the reporting threshold since 2012) must never look like a live, current book.
 */
function createUnfiledManagerNotes(quarters: Discovery13fQuarter[]): ReactNode[] {
  const harvestedCiks = new Set(quarters.map((q) => q.cik))
  return CLONER_LIST
    .filter((m) => m.cik === undefined || !harvestedCiks.has(m.cik))
    .map((m) => createElement(
      'p',
      { key: m.manager_name, className: 'owl-row-helper', style: { margin: 0 } },
      `${shortManagerName(m.manager_name)} — ${m.note ?? (m.cik === undefined ? 'tracked, but the SEC CIK is unverified; no filings harvested.' : 'tracked; no quarter harvested yet.')}`,
    ))
}

/** 'HIMALAYA CAPITAL MANAGEMENT LLC (LI LU)' → 'Himalaya Capital Management (Li Lu)' — display only. */
function shortManagerName(name: string): string {
  return titleCaseEntityName(name.replace(/,?\s+(LLC|LP|L\.P\.|INC\.?|LTD\.?)\s*(?=\(|$)/i, ' ').replace(/\s{2,}/g, ' ').trim())
}

function createCandidateCard(candidate: DiscoveryCandidateProjection) {
  const signal = extractDiscoverySignal(candidate.discovery_metadata)

  return createElement(
    'div',
    { key: candidate.candidate_id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, `${candidate.ticker} — ${candidate.company_name}`),
      signal !== undefined
        ? createElement(
            'p',
            { className: 'owl-row-helper' },
            `${signal.signal_type} · ${signal.contributing_managers.map(shortManagerName).join(', ')}`,
          )
        : null,
      createElement(DiscoveryCandidateActions, { candidateId: candidate.candidate_id, status: candidate.status }),
    ),
  )
}

function createResolvedCard(candidate: DiscoveryCandidateProjection) {
  const isPromoted = candidate.status === 'promoted_to_research_case'

  return createElement(
    'div',
    { key: candidate.candidate_id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, `${candidate.ticker} — ${candidate.company_name}`),
      isPromoted && candidate.research_case_id !== undefined
        ? createElement(
            'p',
            { className: 'owl-row-helper' },
            'Promoted — ',
            createElement('a', { href: `/research/${candidate.research_case_id}`, style: { color: 'var(--owl-color-gold-bright)' } }, 'View research case'),
          )
        : createElement('p', { className: 'owl-row-helper' }, isPromoted ? 'Promoted to research case' : 'Rejected'),
    ),
  )
}
