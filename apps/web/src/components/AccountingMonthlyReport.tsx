import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'

import type { AccountingHoldingSnapshot, AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import type { AppAccountingReport } from '../lib/accounting'
import { humanizeCronProse } from '../lib/schedule'
import { OwlButtonLink, RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type AccountingMonthlyReportProps = {
  report: AppAccountingReport
}

type LedgerStat = {
  figureClass: string
  label: string
  value: string
}

const MONO_FONT = 'var(--owl-font-mono)'
const TABULAR: CSSProperties = { fontFamily: MONO_FONT, fontFeatureSettings: "'tnum' 1" }

/**
 * The monthly financial statement.
 *
 * An auditable accounting statement computed deterministically from the local
 * event ledger — read as the steward's monthly briefing to the principal, not a
 * trading dashboard. Leads with the period's vital signs (NAV, unrealized P&L,
 * return, cost basis, valuation coverage), then the current-period summary,
 * per-holding snapshot, snapshot history, and the data-provenance note. Returns
 * a Fragment so each section is a direct child of the route frame and inherits
 * the app's staggered reveal.
 */
export function AccountingMonthlyReport({ report }: AccountingMonthlyReportProps) {
  const current = report.current_period_snapshot
  const missingCount = current.missing_valuation_holding_ids.length

  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Accounting',
      title: 'Monthly accounting report',
      description: `Your monthly financial statement for ${formatMonth(current.period_end)}, computed deterministically from valuation, cash-flow, dividend, fee, and realized gain/loss events in the durable event ledger.`,
    }),
    createElement('hr', { className: 'owl-rule' }),
    createLedgerLine(current),
    createStatusPanel(current, report.next_scheduled_update ?? humanizeCronProse('valuation refresh cadence 0 7 * * 1-5; accounting recalculates from ledger events on load')),
    missingCount === 0 ? null : createMissingValuationAlert(missingCount),
    createCurrentPeriodSummary(current),
    createHoldingsSection(current),
    createSnapshotHistory(report.snapshot_history),
    createDataProvenance(current),
    createLearnPanel(report.limitations),
  )
}

// ── Vital signs (ledger line) ─────────────────────────────────────────────────

function createLedgerLine(current: AccountingSnapshotProjection) {
  const hasHoldings = current.holdings.length > 0
  const valuedCount = current.holdings.filter((holding) => holding.valuation_status === 'valued').length
  const unrealized = current.unrealized_gain_loss
  const returnPct = hasHoldings && current.invested_cost_basis > 0
    ? (current.unrealized_gain_loss / current.invested_cost_basis) * 100
    : undefined

  const stats: LedgerStat[] = [
    {
      figureClass: 'owl-ledger-figure-money',
      label: 'Period NAV',
      value: formatMoney(current.nav, current.currency),
    },
    {
      figureClass: signedFigureClass(hasHoldings ? unrealized : 0),
      label: 'Unrealized P&L',
      value: hasHoldings ? formatMoney(unrealized, current.currency) : '—',
    },
    {
      figureClass: returnPct === undefined ? '' : signedFigureClass(returnPct),
      label: 'Return %',
      value: returnPct === undefined ? '—' : `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
    },
    {
      figureClass: 'owl-ledger-figure-money',
      label: 'Cost basis',
      value: hasHoldings ? formatMoney(current.invested_cost_basis, current.currency) : '—',
    },
    {
      figureClass: !hasHoldings ? '' : valuedCount === current.holdings.length ? 'owl-ledger-figure-emerald' : 'owl-ledger-figure-risk',
      label: 'Valued holdings',
      value: hasHoldings ? `${valuedCount}/${current.holdings.length}` : '—',
    },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Accounting summary', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
    )),
  )
}

// ── Projection status (cadence, last/next calculation, provenance chips) ───────

function createStatusPanel(current: AccountingSnapshotProjection, nextScheduledUpdate: string) {
  const valuationBadge = getValuationCoverageBadge(current)
  const userActionRequired = current.missing_valuation_holding_ids.length === 0
    ? 'No user action required for current NAV coverage'
    : `Resolve ${current.missing_valuation_holding_ids.length} missing valuation ${current.missing_valuation_holding_ids.length === 1 ? 'record' : 'records'}: ${current.missing_valuation_holding_ids.join(', ')}`

  return createElement(
    'section',
    { 'aria-label': 'Accounting report status', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Ledger-derived statement'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement('h2', { className: 'owl-section-title', style: { marginRight: '0.35rem' } }, 'Automatically maintained accounting projection'),
      createElement(StatusBadge, { tone: 'neutral' }, 'Ledger-derived'),
      createElement(StatusBadge, { tone: valuationBadge.tone }, valuationBadge.label),
    ),
    createElement(
      'div',
      { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-1)' } },
      statusRow('Current state', `${formatMoney(current.nav, current.currency)} NAV for ${formatMonth(current.period_end)}`),
      statusRow('Last automation calculation', current.updated_at),
      statusRow('Next scheduled calculation', nextScheduledUpdate),
      statusRow('Source / caveat / confidence', 'Local ledger projection · valuation/cash-flow event coverage only · not a broker statement or tax report'),
      statusRow('User action required', userActionRequired),
    ),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0 } },
      'This report is projection-derived from the local ledger. Manual corrections are audited fallback or override records; valuation, cash-flow, dividend, fee, and realized gain/loss events remain the primary accounting inputs.',
    ),
    createElement(
      'div',
      { className: 'owl-activity-meta' },
      createElement(SourceChip, { id: current.snapshot_id, label: 'Snapshot ID' }),
      ...current.audit_event_ids.slice(0, 4).map((eventId) => createElement(SourceChip, { href: auditEventHref(eventId), id: eventId, key: `audit:${eventId}`, label: 'Audit event' })),
      ...current.source_ids.slice(0, 4).map((sourceId) => createElement(SourceChip, { id: sourceId, key: `source:${sourceId}`, label: 'Source' })),
    ),
  )
}

function statusRow(label: string, value: string) {
  return createElement(
    'div',
    { className: 'owl-row' },
    createElement('p', { className: 'owl-row-title' }, label),
    createElement('p', { className: 'owl-row-aside', style: { ...TABULAR, color: 'var(--owl-color-text)', justifyContent: 'flex-end', textAlign: 'right' } }, value),
  )
}

// ── Current period summary (cash flows) ────────────────────────────────────────

function createCurrentPeriodSummary(current: AccountingSnapshotProjection) {
  const ledgerBacked = current.cash_ledger_status === 'ledger_backed'
  const lines: Array<ReactNode | null> = [
    summaryRow('Period', `${current.period_start} → ${current.period_end}`),
    summaryRow('Current NAV', `${formatMoney(current.nav, current.currency)} as of ${current.period_end}`, 'money'),
    summaryRow('Current value', formatMoney(current.current_value, current.currency), 'money'),
    summaryRow('Invested cost basis', formatMoney(current.invested_cost_basis, current.currency), 'money'),
    summaryRow('Unrealized P&L', formatMoney(current.unrealized_gain_loss, current.currency), signedTone(current.unrealized_gain_loss)),
    summaryRow('Realized P&L', formatMoney(current.realized_gain_loss, current.currency), signedTone(current.realized_gain_loss)),
    summaryRow(
      ledgerBacked ? 'Cash balance (ledger-backed)' : 'Cash balance (placeholder)',
      `${formatMoney(current.cash_balance, current.currency)} (${current.cash_ledger_status})`,
      'money',
    ),
    summaryRow(ledgerBacked ? 'Deposits' : 'Deposits (untracked)', formatMoney(current.deposits, current.currency), 'money'),
    summaryRow(ledgerBacked ? 'Withdrawals' : 'Withdrawals (untracked)', formatMoney(current.withdrawals, current.currency), 'money'),
    summaryRow(
      ledgerBacked ? 'Dividends' : 'Dividends (untracked)',
      ledgerBacked ? formatMoney(current.dividends, current.currency) : `${formatMoney(0, current.currency)} placeholder`,
      'money',
    ),
    summaryRow(
      ledgerBacked ? 'Fees' : 'Fees (untracked)',
      ledgerBacked ? formatMoney(current.fees, current.currency) : `${formatMoney(0, current.currency)} placeholder`,
      'money',
    ),
    ledgerBacked ? summaryRow('Net cash flow', formatMoney(current.net_cash_flow, current.currency), signedTone(current.net_cash_flow)) : null,
  ]

  return createElement(
    'section',
    { 'aria-label': 'Current period summary', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'This period'),
    createElement('h2', { className: 'owl-section-title' }, 'Current period summary'),
    createElement('div', { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-1)' } }, ...lines),
    createCashFlowLedgerEvents(current),
  )
}

function summaryRow(label: string, value: string, tone: 'plain' | 'money' | 'emerald' | 'risk' = 'plain') {
  const toneColor = tone === 'emerald'
    ? 'var(--owl-color-accent-bright)'
    : tone === 'risk'
      ? 'var(--owl-color-risk-bright)'
      : 'var(--owl-color-text)'

  return createElement(
    'div',
    { className: 'owl-row' },
    createElement('p', { className: 'owl-row-title' }, label),
    createElement(
      'p',
      {
        className: 'owl-row-aside',
        style: { ...TABULAR, color: toneColor, justifyContent: 'flex-end', textAlign: 'right' },
      },
      value,
    ),
  )
}

function createCashFlowLedgerEvents(current: AccountingSnapshotProjection) {
  return createElement(
    'section',
    { 'aria-label': 'Cash-flow ledger events', style: { display: 'grid', gap: 'var(--owl-space-2)', marginTop: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Cash-flow ledger events'),
    current.cash_flows.length === 0
      ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No period cash-flow ledger events are linked yet.')
      : createElement(
        'ol',
        { className: 'owl-row-list', style: { listStyle: 'none', margin: 0, padding: 0 } },
        ...current.cash_flows.map((flow) => createElement(
          'li',
          { key: flow.event_id, className: 'owl-row owl-row-top' },
          createElement(
            'div',
            { className: 'owl-row-main' },
            createElement('p', { className: 'owl-row-title', style: TABULAR }, `${capitalize(flow.flow_type)} ${formatMoney(Math.abs(flow.amount), flow.currency)}`),
            createElement('p', { className: 'owl-row-helper' }, `Recorded ${flow.occurred_at}`),
            createElement(
              'div',
              { className: 'owl-activity-meta' },
              createElement(SourceChip, { href: auditEventHref(flow.event_id), id: flow.event_id, label: 'Audit event' }),
              ...flow.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: `${flow.event_id}:${sourceId}`, label: 'Source' })),
            ),
          ),
        )),
      ),
  )
}

// ── Holdings snapshot ─────────────────────────────────────────────────────────

function createHoldingsSection(current: AccountingSnapshotProjection) {
  return createElement(
    'section',
    { 'aria-label': 'Accounting holdings', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Positions of record' ),
    createElement('h2', { className: 'owl-section-title' }, 'Holdings in current snapshot'),
    current.holdings.length === 0
      ? createEmptyHoldingsState(current)
      : createElement(
        'div',
        { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-1)' } },
        ...current.holdings.map((holding) => holdingRow(holding)),
      ),
  )
}

function holdingRow(holding: AccountingHoldingSnapshot) {
  const label = holding.ticker ?? holding.holding_id
  const valued = holding.valuation_status === 'valued'
  const details: ReactNode[] = [
    createElement('span', { key: 'shares' }, `Shares: ${formatNumber(holding.shares)}`),
    createElement('span', { key: 'cost' }, `Cost basis: ${formatMoney(holding.cost_basis, holding.currency)}`),
    valued
      ? createElement('span', { key: 'value' }, `Current value: ${formatMoney(holding.current_value ?? 0, holding.currency)}`)
      : createElement('span', { key: 'value', style: { color: 'var(--owl-color-risk-bright)', fontWeight: 800 } }, 'Valuation missing'),
  ]
  if (holding.unrealized_gain_loss !== undefined) {
    details.push(createElement('span', { key: 'pl' }, `Unrealized P&L: ${formatMoney(holding.unrealized_gain_loss, holding.currency)}`))
  }
  if (holding.latest_valuation_at !== undefined) {
    details.push(createElement('span', { key: 'fresh' }, `Valuation freshness: ${holding.latest_valuation_at}`))
  }

  const chips: ReactNode[] = []
  if (holding.valuation_event_id !== undefined) {
    chips.push(createElement(SourceChip, { href: auditEventHref(holding.valuation_event_id), id: holding.valuation_event_id, key: 'valuation', label: 'Valuation event' }))
  }
  for (const sourceId of holding.valuation_source_ids ?? []) {
    chips.push(createElement(SourceChip, { id: sourceId, key: `${holding.holding_id}:${sourceId}`, label: 'Source' }))
  }

  return createElement(
    'article',
    { className: 'owl-row owl-row-top', key: holding.holding_id },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title', style: { fontFamily: MONO_FONT } }, label),
      createElement(
        'p',
        { className: 'owl-row-helper', style: TABULAR },
        intersperse(details, ' · '),
      ),
      chips.length === 0 ? null : createElement('div', { className: 'owl-activity-meta' }, ...chips),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      createElement(StatusBadge, { tone: valued ? 'manual' : 'warning' }, valued ? 'Valued' : 'Valuation missing'),
    ),
  )
}

function createEmptyHoldingsState(current: AccountingSnapshotProjection) {
  return createElement(
    'div',
    { className: 'owl-row-main', style: { gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent', style: { color: 'var(--owl-color-amber)' } }, 'Zero-total empty state'),
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No holdings are present for this accounting period yet.'),
    createElement('p', { className: 'owl-row-helper', style: { color: 'var(--owl-color-text)', fontWeight: 650, margin: 0 } }, `Zero totals are expected until ledger valuation or cash-flow events exist for an opened holding. Current projected NAV: ${formatMoney(current.nav, current.currency)}.`),
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'Next step: open a holding, record lot data, then let valuation/cash-flow events feed accounting automatically.'),
    createElement(
      'div',
      { className: 'owl-row-aside', style: { justifyContent: 'flex-start', marginTop: 'var(--owl-space-1)' } },
      createElement(OwlButtonLink, { href: '/portfolio', variant: 'primary' }, 'Open portfolio'),
      createElement(OwlButtonLink, { href: '/audit', variant: 'secondary' }, 'View audit trail'),
    ),
  )
}

function createMissingValuationAlert(missingCount: number) {
  return createElement(
    'section',
    { 'aria-label': 'Missing valuations', className: 'owl-section-card', style: { background: 'rgba(239, 68, 68, 0.08)', borderColor: 'var(--owl-color-risk-bright)' } },
    createElement('p', { className: 'owl-section-accent', style: { color: 'var(--owl-color-risk-bright)' } }, 'Missing valuations'),
    createElement(
      'p',
      { className: 'owl-row-title', style: { color: 'var(--owl-color-risk-bright)' } },
      `${missingCount} ${missingCount === 1 ? 'holding needs' : 'holdings need'} a valuation before NAV is complete`,
    ),
  )
}

// ── Snapshot history ──────────────────────────────────────────────────────────

function createSnapshotHistory(snapshots: AccountingSnapshotProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Snapshot history', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Period ledger'),
    createElement('h2', { className: 'owl-section-title' }, 'Snapshot history'),
    snapshots.length === 0
      ? createElement(
        'div',
        { className: 'owl-row-main', style: { gap: '0.3rem' } },
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No accounting snapshots have been recorded yet.'),
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'Snapshots will accumulate here after each accounting period closes.'),
      )
      : createElement(
        'div',
        { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-1)' } },
        ...snapshots.map((snapshot) => createElement(
          'div',
          { key: snapshot.snapshot_id, className: 'owl-row' },
          createElement(
            'div',
            { className: 'owl-row-main' },
            createElement('p', { className: 'owl-row-title', style: { fontFamily: MONO_FONT } }, snapshot.period_end),
            createElement('p', { className: 'owl-row-helper' }, `${snapshot.missing_valuation_holding_ids.length} missing valuations · Audit/source links preview: ${snapshot.snapshot_id}`),
          ),
          createElement('p', { className: 'owl-row-aside', style: { ...TABULAR, color: 'var(--owl-color-gold-bright)' } }, `${formatMoney(snapshot.nav, snapshot.currency)} projected NAV`),
        )),
      ),
  )
}

// ── Data provenance ───────────────────────────────────────────────────────────

function createDataProvenance(current: AccountingSnapshotProjection) {
  const missingCount = current.missing_valuation_holding_ids.length
  const cashLedgerCopy = current.cash_flows.length > 0
    ? `Cash ledger events: ${current.cash_flows.length} period events linked.`
    : 'Cash ledger events: no period deposit, withdrawal, dividend, or fee events linked.'
  const warnings = accountingWarnings(current)

  return createElement(
    'section',
    { 'aria-label': 'Accounting data provenance', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'How this is computed'),
    createElement('h2', { className: 'owl-section-title' }, 'Data provenance'),
    createElement(
      'ul',
      { className: 'owl-row-helper', style: { display: 'grid', gap: '0.5rem', lineHeight: 1.5, margin: 'var(--owl-space-1) 0 0', paddingLeft: '1.2rem' } },
      createElement('li', null, `Valuation event coverage: ${current.holdings.length} ${current.holdings.length === 1 ? 'holding' : 'holdings'} in snapshot; ${missingCount} missing ${missingCount === 1 ? 'valuation' : 'valuations'}.`),
      createElement('li', null, cashLedgerCopy),
      createElement('li', null, 'Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period.'),
      createElement('li', null, 'Deposits, withdrawals, dividends, fees, and realized P&L are separated from valuation state and linked to ledger events where available.'),
      createElement('li', null, 'Broker sync: not connected for this local alpha; values are user-entered, worker-recorded, or projected from ledger events.'),
    ),
    warnings.length === 0 ? null : createElement(
      'section',
      { 'aria-label': 'Missing-data warnings', style: { marginTop: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent', style: { color: 'var(--owl-color-risk-bright)' } }, 'Missing-data warnings'),
      createElement(
        'ul',
        { style: { color: 'var(--owl-color-risk-bright)', display: 'grid', fontSize: 'var(--owl-text-sm)', gap: '0.35rem', margin: '0.4rem 0 0', paddingLeft: '1.2rem' } },
        ...warnings.map((warning) => createElement('li', { key: `${warning.code}:${warning.holding_id ?? warning.event_id ?? warning.message}` }, warning.message)),
      ),
    ),
  )
}

// ── Learn / caveats ───────────────────────────────────────────────────────────

function createLearnPanel(limitations: string[]) {
  return createElement(
    'details',
    { 'aria-label': 'Accounting limitations', className: 'owl-section-card' },
    createElement('summary', { className: 'owl-section-title', style: { color: 'var(--owl-color-amber)', cursor: 'pointer' } }, 'Learn: accounting controls and caveats'),
    createElement(
      'ul',
      { className: 'owl-row-helper', style: { display: 'grid', gap: '0.4rem', margin: 'var(--owl-space-2) 0 0', paddingLeft: '1.2rem' } },
      ...limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
    ),
  )
}

// ── Data helpers (unchanged behaviour) ────────────────────────────────────────

function getValuationCoverageBadge(current: AccountingSnapshotProjection): { label: string; tone: 'manual' | 'neutral' | 'warning' } {
  if (current.holdings.length === 0) {
    return { label: 'No holdings yet', tone: 'neutral' }
  }

  if (current.missing_valuation_holding_ids.length > 0) {
    return { label: 'Valuations incomplete', tone: 'warning' }
  }

  return { label: 'Valuations current', tone: 'manual' }
}

function accountingWarnings(current: AccountingSnapshotProjection): AccountingSnapshotProjection['missing_data_warnings'] {
  if (current.missing_data_warnings.length > 0) {
    return current.missing_data_warnings
  }
  return current.holdings
    .filter((holding) => holding.valuation_status === 'missing_valuation')
    .map((holding) => ({
      code: 'missing_valuation' as const,
      holding_id: holding.holding_id,
      message: `${holding.ticker ?? holding.holding_id} is missing a valuation; NAV excludes current value.`,
    }))
}

function signedFigureClass(value: number): string {
  if (value > 0) {
    return 'owl-ledger-figure-emerald'
  }
  if (value < 0) {
    return 'owl-ledger-figure-risk'
  }
  return ''
}

function signedTone(value: number): 'plain' | 'emerald' | 'risk' {
  if (value > 0) {
    return 'emerald'
  }
  if (value < 0) {
    return 'risk'
  }
  return 'plain'
}

function intersperse(nodes: ReactNode[], separator: string): ReactNode[] {
  return nodes.flatMap((node, index) => (index === 0 ? [node] : [separator, node]))
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function auditEventHref(eventId: string): string {
  return `/audit?event_id=${encodeURIComponent(eventId)}#${encodeURIComponent(eventId)}`
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
