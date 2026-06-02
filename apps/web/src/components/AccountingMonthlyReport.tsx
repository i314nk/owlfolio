import { createElement, type CSSProperties } from 'react'

import type { AccountingHoldingSnapshot, AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import type { AppAccountingReport } from '../lib/accounting'
import { OwlButtonLink, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type AccountingMonthlyReportProps = {
  report: AppAccountingReport
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
}

const heroStyle: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(124, 140, 255, 0.12) 0%, rgba(10, 132, 255, 0.08) 100%)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
}

const cardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
  padding: '1.25rem',
}

const metricGridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
}

export function AccountingMonthlyReport({ report }: AccountingMonthlyReportProps) {
  const current = report.current_period_snapshot
  const missingCount = current.missing_valuation_holding_ids.length

  return createElement(
    'section',
    { style: shellStyle },
    createElement(
      'header',
      { style: heroStyle },
      createElement('p', { style: { color: '#4338ca', fontWeight: 900, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Accounting'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Monthly accounting report'),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '1rem', margin: 0 } },
        `Current period summary for ${formatMonth(current.period_end)}. Projected NAV is shown as of ${current.period_end} from manual valuations and placeholder cash in the durable event ledger.`,
      ),
    ),
    createAccountingStatusPanel(current),
    missingCount === 0 ? null : createMissingValuationAlert(missingCount),
    createElement(
      'section',
      { 'aria-label': 'Current period summary', style: cardStyle },
      createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Current period summary'),
      createElement(
        'div',
        { style: metricGridStyle },
        metric('Period', `${current.period_start} → ${current.period_end}`),
        metric('Projected NAV (manual valuations)', `${formatMoney(current.nav, current.currency)} as of ${current.period_end}`),
        metric('Current value (manual valuations)', formatMoney(current.current_value, current.currency)),
        metric('Invested cost basis', formatMoney(current.invested_cost_basis, current.currency)),
        metric('Unrealized P&L', formatMoney(current.unrealized_gain_loss, current.currency)),
        metric('Cash balance (placeholder)', `${formatMoney(current.cash_balance, current.currency)} (${current.cash_ledger_status})`),
        metric('Deposits (untracked)', formatMoney(current.deposits, current.currency)),
        metric('Withdrawals (untracked)', formatMoney(current.withdrawals, current.currency)),
        metric('Fees (untracked)', `${formatMoney(0, current.currency)} placeholder`),
        metric('Dividends (untracked)', `${formatMoney(0, current.currency)} placeholder`),
      ),
      createElement('p', { style: { color: '#9aa4b7', fontSize: '0.92rem', margin: '1rem 0 0' } }, 'Fees and dividends are not modeled yet; treat all cash-flow totals as manual placeholders until dedicated ledger events exist.'),
    ),
    createAccountingDataCoverage(current),
    createElement(
      'section',
      { 'aria-label': 'Accounting holdings', style: cardStyle },
      createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Holdings in current snapshot'),
      current.holdings.length === 0
        ? createEmptyHoldingsState(current)
        : createElement(
          'div',
          { style: { display: 'grid', gap: '0.75rem' } },
          ...current.holdings.map((holding) => holdingCard(holding)),
        ),
    ),
    createSnapshotHistory(report.snapshot_history),
    createElement(
      'section',
      { 'aria-label': 'Accounting limitations', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.1)', borderColor: 'rgba(251, 191, 36, 0.32)' } },
      createElement('h2', { style: { fontSize: '1.1rem', margin: '0 0 0.75rem' } }, 'Current limitations'),
      createElement(
        'ul',
        { style: { color: '#fbbf24', display: 'grid', gap: '0.4rem', margin: 0, paddingLeft: '1.25rem' } },
        ...report.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
      ),
    ),
  )
}

function createAccountingStatusPanel(current: AccountingSnapshotProjection) {
  const valuationBadge = getValuationCoverageBadge(current)

  return createElement(
    'section',
    { 'aria-label': 'Accounting report status', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' } },
      createElement('h2', { style: { fontSize: '1.15rem', margin: 0 } }, 'Draft accounting report'),
      createElement(StatusBadge, { tone: 'draft' }, 'Manual / projected'),
      createElement(StatusBadge, { tone: valuationBadge.tone }, valuationBadge.label),
    ),
    createElement('p', { style: { color: '#f8fafc', fontWeight: 800, margin: '0 0 0.45rem' } }, `NAV freshness: as of ${current.period_end}`),
    createElement(
      'p',
      { style: { color: '#9aa4b7', lineHeight: 1.55, margin: '0 0 0.75rem' } },
      'This report is projection-derived from the local ledger. Calculated valuation totals are separated from cash-flow inputs that are still untracked, placeholder, or manual-only in the alpha.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
      createElement(SourceChip, { id: current.snapshot_id, label: 'Snapshot ID' }),
      createElement('span', { style: { color: '#9aa4b7', fontFamily: 'var(--owl-font-mono)', fontSize: '0.72rem' } }, `Generated ${current.updated_at}`),
    ),
  )
}

function getValuationCoverageBadge(current: AccountingSnapshotProjection): { label: string; tone: 'manual' | 'neutral' | 'warning' } {
  if (current.holdings.length === 0) {
    return { label: 'No holdings yet', tone: 'neutral' }
  }

  if (current.missing_valuation_holding_ids.length > 0) {
    return { label: 'Valuations incomplete', tone: 'warning' }
  }

  return { label: 'Valuations current', tone: 'manual' }
}

function createAccountingDataCoverage(current: AccountingSnapshotProjection) {
  const missingCount = current.missing_valuation_holding_ids.length

  return createElement(
    'section',
    { 'aria-label': 'Accounting data provenance', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 0.75rem' } }, 'Data provenance'),
    createElement(
      'ul',
      { style: { color: '#cbd5e1', display: 'grid', gap: '0.55rem', lineHeight: 1.5, margin: 0, paddingLeft: '1.25rem' } },
      createElement('li', null, `Manual valuation event coverage: ${current.holdings.length} ${current.holdings.length === 1 ? 'holding' : 'holdings'} in snapshot; ${missingCount} missing ${missingCount === 1 ? 'valuation' : 'valuations'}.`),
      createElement('li', null, `Cash ledger events: not modeled yet — cash balance is marked ${current.cash_ledger_status}.`),
      createElement('li', null, 'Deposits and withdrawals: untracked manual placeholder totals until dedicated cash-flow ledger events exist.'),
      createElement('li', null, 'Dividends and fees: not modeled yet; $0.00 is a placeholder, not a confirmed economic zero.'),
      createElement('li', null, 'Broker sync: not connected for this local alpha; values are user-entered or projected from ledger events.'),
    ),
  )
}

function createEmptyHoldingsState(current: AccountingSnapshotProjection) {
  return createElement(
    'div',
    { style: { color: '#9aa4b7', display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: { color: '#fbbf24', fontWeight: 900, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Zero-total empty state'),
    createElement('p', { style: { margin: 0 } }, 'No holdings are present for this accounting period yet.'),
    createElement('p', { style: { fontWeight: 800, margin: 0 } }, `Zero totals are expected until you open a holding and record a manual valuation. Current projected NAV: ${formatMoney(current.nav, current.currency)}.`),
    createElement('p', { style: { margin: 0 } }, 'Next step: open a holding, record lot data, then add a manual valuation snapshot.'),
    createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Source/audit preview: future cash, dividend, fee, and valuation events will appear here with ledger links.'),
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.25rem' } },
      createElement(OwlButtonLink, { href: '/portfolio', variant: 'primary' }, 'Open portfolio'),
      createElement(OwlButtonLink, { href: '/audit', variant: 'secondary' }, 'View audit trail'),
    ),
  )
}

function createMissingValuationAlert(missingCount: number) {
  return createElement(
    'section',
    { 'aria-label': 'Missing valuations', style: { ...cardStyle, background: 'rgba(239, 68, 68, 0.1)', borderColor: '#fecaca' } },
    createElement('h2', { style: { color: '#fecaca', fontSize: '1.1rem', margin: '0 0 0.4rem' } }, 'Missing valuations'),
    createElement(
      'p',
      { style: { color: '#fca5a5', fontWeight: 800, margin: 0 } },
      `${missingCount} ${missingCount === 1 ? 'holding needs' : 'holdings need'} a valuation before NAV is complete`,
    ),
  )
}

function createSnapshotHistory(snapshots: AccountingSnapshotProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Snapshot history', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Snapshot history'),
    snapshots.length === 0
      ? createElement(
        'div',
        { style: { color: '#9aa4b7', display: 'grid', gap: '0.4rem' } },
        createElement('p', { style: { margin: 0 } }, 'No accounting snapshots have been recorded yet.'),
        createElement('p', { style: { margin: 0 } }, 'Audit/source links preview: recorded monthly snapshots, valuation sources, and future cash-flow events will appear here.'),
      )
      : createElement(
        'ol',
        { style: { display: 'grid', gap: '0.6rem', margin: 0, paddingLeft: '1.25rem' } },
        ...snapshots.map((snapshot) => createElement(
          'li',
          { key: snapshot.snapshot_id },
          `${snapshot.period_end}: ${formatMoney(snapshot.nav, snapshot.currency)} projected NAV, ${snapshot.missing_valuation_holding_ids.length} missing valuations. Audit/source links preview: ${snapshot.snapshot_id}`,
        )),
      ),
  )
}

function holdingCard(holding: AccountingHoldingSnapshot) {
  const label = holding.ticker ?? holding.holding_id
  return createElement(
    'article',
    { style: { border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('h3', { style: { fontSize: '1.2rem', margin: '0 0 0.5rem' } }, label),
    createElement('p', { style: { color: '#cbd5e1', margin: '0.25rem 0' } }, `Shares: ${formatNumber(holding.shares)}`),
    createElement('p', { style: { color: '#cbd5e1', margin: '0.25rem 0' } }, `Cost basis: ${formatMoney(holding.cost_basis, holding.currency)}`),
    holding.valuation_status === 'valued'
      ? createElement('p', { style: { color: '#cbd5e1', margin: '0.25rem 0' } }, `Current value: ${formatMoney(holding.current_value ?? 0, holding.currency)}`)
      : createElement('p', { style: { color: '#fca5a5', fontWeight: 800, margin: '0.25rem 0' } }, 'Valuation missing'),
    holding.unrealized_gain_loss === undefined
      ? null
      : createElement('p', { style: { color: '#cbd5e1', margin: '0.25rem 0' } }, `Unrealized P&L: ${formatMoney(holding.unrealized_gain_loss, holding.currency)}`),
    holding.latest_valuation_at === undefined
      ? null
      : createElement('p', { style: { color: '#9aa4b7', margin: '0.25rem 0 0' } }, `Manual valuation freshness: ${holding.latest_valuation_at}`),
  )
}

function metric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('p', { style: { color: '#9aa4b7', fontSize: '0.78rem', fontWeight: 900, margin: 0, textTransform: 'uppercase' } }, label),
    createElement('p', { style: { color: '#f7f8ff', fontSize: '1.25rem', fontWeight: 900, margin: '0.35rem 0 0' } }, value),
  )
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { currency, style: 'currency' }).format(value)
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(new Date(`${date}T00:00:00.000Z`))
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
}
