import { createElement, type CSSProperties } from 'react'

import type { AccountingHoldingSnapshot, AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import type { AppAccountingReport } from '../lib/accounting'

export type AccountingMonthlyReportProps = {
  report: AppAccountingReport
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
}

const heroStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
  border: '1px solid #dbeafe',
  borderRadius: '1.25rem',
  padding: '1.5rem',
}

const cardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
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
        { style: { color: '#475569', fontSize: '1rem', margin: 0 } },
        `Current period summary for ${formatMonth(current.period_end)}. Uses the accounting snapshot projection from the durable event ledger.`,
      ),
    ),
    missingCount === 0 ? null : createMissingValuationAlert(missingCount),
    createElement(
      'section',
      { 'aria-label': 'Current period summary', style: cardStyle },
      createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Current period summary'),
      createElement(
        'div',
        { style: metricGridStyle },
        metric('Period', `${current.period_start} → ${current.period_end}`),
        metric('NAV', formatMoney(current.nav, current.currency)),
        metric('Current value', formatMoney(current.current_value, current.currency)),
        metric('Invested cost basis', formatMoney(current.invested_cost_basis, current.currency)),
        metric('Unrealized P&L', formatMoney(current.unrealized_gain_loss, current.currency)),
        metric('Cash balance', `${formatMoney(current.cash_balance, current.currency)} (${current.cash_ledger_status})`),
        metric('Deposits', formatMoney(current.deposits, current.currency)),
        metric('Withdrawals', formatMoney(current.withdrawals, current.currency)),
      ),
    ),
    createElement(
      'section',
      { 'aria-label': 'Accounting holdings', style: cardStyle },
      createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Holdings in current snapshot'),
      current.holdings.length === 0
        ? createElement('p', { style: { color: '#475569', margin: 0 } }, 'No holdings are present for this accounting period yet.')
        : createElement(
          'div',
          { style: { display: 'grid', gap: '0.75rem' } },
          ...current.holdings.map((holding) => holdingCard(holding)),
        ),
    ),
    createSnapshotHistory(report.snapshot_history),
    createElement(
      'section',
      { 'aria-label': 'Accounting limitations', style: { ...cardStyle, background: '#fffbeb', borderColor: '#fde68a' } },
      createElement('h2', { style: { fontSize: '1.1rem', margin: '0 0 0.75rem' } }, 'Current limitations'),
      createElement(
        'ul',
        { style: { color: '#92400e', display: 'grid', gap: '0.4rem', margin: 0, paddingLeft: '1.25rem' } },
        ...report.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
      ),
    ),
  )
}

function createMissingValuationAlert(missingCount: number) {
  return createElement(
    'section',
    { 'aria-label': 'Missing valuations', style: { ...cardStyle, background: '#fef2f2', borderColor: '#fecaca' } },
    createElement('h2', { style: { color: '#991b1b', fontSize: '1.1rem', margin: '0 0 0.4rem' } }, 'Missing valuations'),
    createElement(
      'p',
      { style: { color: '#7f1d1d', fontWeight: 800, margin: 0 } },
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
      ? createElement('p', { style: { color: '#475569', margin: 0 } }, 'No accounting snapshots have been recorded yet.')
      : createElement(
        'ol',
        { style: { display: 'grid', gap: '0.6rem', margin: 0, paddingLeft: '1.25rem' } },
        ...snapshots.map((snapshot) => createElement(
          'li',
          { key: snapshot.snapshot_id },
          `${snapshot.period_end}: ${formatMoney(snapshot.nav, snapshot.currency)} NAV, ${snapshot.missing_valuation_holding_ids.length} missing valuations`,
        )),
      ),
  )
}

function holdingCard(holding: AccountingHoldingSnapshot) {
  const label = holding.ticker ?? holding.holding_id
  return createElement(
    'article',
    { style: { border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('h3', { style: { fontSize: '1.2rem', margin: '0 0 0.5rem' } }, label),
    createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Shares: ${formatNumber(holding.shares)}`),
    createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Cost basis: ${formatMoney(holding.cost_basis, holding.currency)}`),
    holding.valuation_status === 'valued'
      ? createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Current value: ${formatMoney(holding.current_value ?? 0, holding.currency)}`)
      : createElement('p', { style: { color: '#b91c1c', fontWeight: 800, margin: '0.25rem 0' } }, 'Valuation missing'),
    holding.unrealized_gain_loss === undefined
      ? null
      : createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Unrealized P&L: ${formatMoney(holding.unrealized_gain_loss, holding.currency)}`),
    holding.latest_valuation_at === undefined
      ? null
      : createElement('p', { style: { color: '#64748b', margin: '0.25rem 0 0' } }, `Latest valuation: ${holding.latest_valuation_at}`),
  )
}

function metric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('p', { style: { color: '#64748b', fontSize: '0.78rem', fontWeight: 900, margin: 0, textTransform: 'uppercase' } }, label),
    createElement('p', { style: { color: '#0f172a', fontSize: '1.25rem', fontWeight: 900, margin: '0.35rem 0 0' } }, value),
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
