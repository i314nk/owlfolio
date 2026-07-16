import { createElement, Fragment, type ReactNode } from 'react'

import {
  extractDiscoverySignal,
  type DiscoveryCandidateProjection,
} from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import type {
  Discovery13fAggregatedSell,
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
  quarters: Discovery13fQuarter[]
  sells: Discovery13fAggregatedSell[]
  /** Uppercased tickers currently HELD or WATCHED — flags the sell rows that touch the user's own names. */
  heldOrWatchedTickers: string[]
}

const mono2xs = { fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } as const

/**
 * The 13F discovery page (owner-approved 2026-07-16): tracked value superinvestors, their latest
 * portfolios, latest buys, latest sells — an IDEA SOURCE feeding the research funnel, never a copy
 * signal. Honesty rails everywhere: quarterly filings with up to a 45-day lag ("as of <report> ·
 * filed <filed>"), long US equities only, no performance numbers, no auto-promotion, no prices.
 * Server component (createElement, no JSX); triage actions stay in the client component.
 */
export function DiscoveryPanel({ candidates, runStatus, quarters, sells, heldOrWatchedTickers }: DiscoveryPanelProps) {
  const discovered = candidates.filter((c) => c.status === 'discovered')
  const queued = candidates.filter((c) => c.status === 'queued_for_quick_screen')
  const resolved = candidates.filter((c) => c.status === 'rejected' || c.status === 'promoted_to_research_case')
  const held = new Set(heldOrWatchedTickers.map((t) => t.toUpperCase()))

  const runStatusLine = runStatus?.last_run_status === 'running'
    ? 'Running…'
    : runStatus?.last_result_summary ?? 'Never run'

  return createElement(
    Fragment,
    null,
    createSummaryHeader(runStatusLine),
    // Latest buys — the signal inbox feeding the research funnel (human-triaged, never auto-promoted).
    createElement(
      'section',
      { 'aria-label': 'Latest buys', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `Latest buys · ${discovered.length}`),
      createElement(
        'p',
        { className: 'owl-row-helper', style: { margin: 0 } },
        'New or meaningfully increased positions detected in the latest filings. Each is an idea for YOUR research funnel — accept it into screening or reject it; nothing is bought or promoted automatically.',
      ),
      discovered.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No new buy signals. Run the harvest to check the latest filings.')
        : createElement(
            'div',
            { className: 'owl-row-grid-3' },
            ...discovered.map((c) => createCandidateCard(c)),
          ),
    ),
    // Latest sells — exits and meaningful trims, with the user's own names flagged.
    createElement(
      'section',
      { 'aria-label': 'Latest sells', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, `Latest sells · ${sells.length}`),
      createElement(
        'p',
        { className: 'owl-row-helper', style: { margin: 0 } },
        'Positions a tracked manager exited or trimmed by more than 25% in their latest filing. The filing gives no reason — a sell can be valuation, rebalancing, or redemptions. Names you hold or watch are flagged; review your own thesis, never copy the sell.',
      ),
      sells.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No exits or meaningful trims in the latest harvested quarters.')
        : createElement('div', { className: 'owl-row-grid-3' }, ...sells.map((s) => createSellRow(s, held))),
    ),
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

function asOfLine(quarterOrPeriod: { period: string; report_date?: string; filed_date?: string }): string {
  const asOf = quarterOrPeriod.report_date ?? quarterOrPeriod.period
  return quarterOrPeriod.filed_date === undefined ? `as of ${asOf}` : `as of ${asOf} · filed ${quarterOrPeriod.filed_date}`
}

function fmtFilingValue(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function sellChip(signal: 'EXIT' | 'MEANINGFUL_TRIM'): ReactNode {
  return createElement(
    'span',
    { key: 'sig', style: { ...mono2xs, color: signal === 'EXIT' ? 'var(--owl-color-risk-bright)' : '#fbbf24' } },
    signal === 'EXIT' ? 'EXIT' : 'TRIM >25%',
  )
}

function createSellRow(sell: Discovery13fAggregatedSell, held: Set<string>) {
  const flagged = sell.ticker !== undefined && held.has(sell.ticker.toUpperCase())
  return createElement(
    'div',
    { key: sell.key, className: 'owl-row owl-row-top', 'data-sell-row': sell.ticker ?? sell.key },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement(
        'h3',
        { className: 'owl-row-title', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
        createElement('span', { key: 't', style: { fontWeight: 800 } }, sell.ticker ?? 'UNRESOLVED'),
        createElement('span', { key: 'n', style: { color: 'var(--owl-color-muted)', flex: '0 1 auto', fontSize: 'var(--owl-text-md)', fontWeight: 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `— ${titleCaseEntityName(sell.issuer)}`),
        createElement('span', { key: 'spacer', style: { flex: '1 0 0.5rem' } }),
        sellChip(sell.signal_type),
        flagged
          ? createElement('span', { key: 'own', style: { ...mono2xs, color: '#fbbf24' } }, 'YOU HOLD/WATCH THIS')
          : null,
      ),
      createElement(
        'p',
        { className: 'owl-row-helper', style: { margin: 0 } },
        `${sell.managers.map(shortManagerName).join(', ')} · 13F ${sell.period}`,
      ),
    ),
  )
}

function createManagerCard(quarter: Discovery13fQuarter) {
  const top10 = quarter.top_holdings.slice(0, 10)
  return createElement(
    'details',
    { key: quarter.cik, className: 'owl-collapsible-card', 'data-manager-card': quarter.cik, suppressHydrationWarning: true },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      createElement('span', { key: 'name', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-lg)', fontWeight: 800 } }, shortManagerName(quarter.manager_name)),
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
