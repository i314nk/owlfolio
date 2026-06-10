import { createElement, type CSSProperties } from 'react'

import type { AccountingHoldingSnapshot, AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import type { AppAccountingReport } from '../lib/accounting'
import { humanizeCronProse } from '../lib/schedule'
import { OwlButtonLink, OwlKpiStat, OwlRingGauge, RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type AccountingMonthlyReportProps = {
  report: AppAccountingReport
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
}

const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: '1.15rem 1.3rem',
}

const metricGridStyle: CSSProperties = {
  display: 'grid',
  gap: '0.8rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
}

export function AccountingMonthlyReport({ report }: AccountingMonthlyReportProps) {
  const current = report.current_period_snapshot
  const missingCount = current.missing_valuation_holding_ids.length

  return createElement(
    'section',
    { style: shellStyle },
    createElement(RouteHeader, {
      kicker: 'Accounting',
      title: 'Monthly accounting report',
      description: `Current period summary for ${formatMonth(current.period_end)}. Automatically maintained accounting projection derives current NAV from valuation, cash-flow, dividend, fee, and realized gain/loss events in the durable event ledger.`,
    }),
    createAccountingKpiRow(current),
    createAccountingStatusPanel(current, report.next_scheduled_update ?? humanizeCronProse('valuation refresh cadence 0 7 * * 1-5; accounting recalculates from ledger events on load')),
    missingCount === 0 ? null : createMissingValuationAlert(missingCount),
    createElement(
      'section',
      { 'aria-label': 'Current period summary', style: cardStyle },
      createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Current period summary'),
      createElement(
        'div',
        { style: metricGridStyle },
        metric('Period', `${current.period_start} → ${current.period_end}`),
        metric('Current NAV', `${formatMoney(current.nav, current.currency)} as of ${current.period_end}`),
        metric('Period NAV', `${formatMoney(current.nav, current.currency)} as of ${current.period_end}`),
        metric('Current value', formatMoney(current.current_value, current.currency)),
        metric('Invested cost basis', formatMoney(current.invested_cost_basis, current.currency)),
        metric('Unrealized P&L', formatMoney(current.unrealized_gain_loss, current.currency)),
        metric('Realized P&L', formatMoney(current.realized_gain_loss, current.currency)),
        metric(current.cash_ledger_status === 'ledger_backed' ? 'Cash balance (ledger-backed)' : 'Cash balance (placeholder)', `${formatMoney(current.cash_balance, current.currency)} (${current.cash_ledger_status})`),
        metric(current.cash_ledger_status === 'ledger_backed' ? 'Deposits' : 'Deposits (untracked)', formatMoney(current.deposits, current.currency)),
        metric(current.cash_ledger_status === 'ledger_backed' ? 'Withdrawals' : 'Withdrawals (untracked)', formatMoney(current.withdrawals, current.currency)),
        metric(current.cash_ledger_status === 'ledger_backed' ? 'Dividends' : 'Dividends (untracked)', current.cash_ledger_status === 'ledger_backed' ? formatMoney(current.dividends, current.currency) : `${formatMoney(0, current.currency)} placeholder`),
        metric(current.cash_ledger_status === 'ledger_backed' ? 'Fees' : 'Fees (untracked)', current.cash_ledger_status === 'ledger_backed' ? formatMoney(current.fees, current.currency) : `${formatMoney(0, current.currency)} placeholder`),
        current.cash_ledger_status === 'ledger_backed' ? metric('Net cash flow', formatMoney(current.net_cash_flow, current.currency)) : null,
      ),
      createCashFlowLedgerEvents(current),
    ),
    createAccountingDataCoverage(current),
    createElement(
      'section',
      { 'aria-label': 'Accounting holdings', style: cardStyle },
      createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Holdings in current snapshot'),
      current.holdings.length === 0
        ? createEmptyHoldingsState(current)
        : createElement(
          'div',
          { style: { display: 'grid', gap: '0.75rem' } },
          ...current.holdings.map((holding) => holdingCard(holding)),
        ),
    ),
    createSnapshotHistory(report.snapshot_history),
    createAccountingLearnPanel(report.limitations),
  )
}

function createAccountingKpiRow(current: AccountingSnapshotProjection) {
  const hasHoldings = current.holdings.length > 0
  const valuedCount = current.holdings.filter((holding) => holding.valuation_status === 'valued').length
  const coveragePct = hasHoldings ? Math.round((valuedCount / current.holdings.length) * 100) : 0
  const unrealized = current.unrealized_gain_loss
  const unrealizedTone = unrealized > 0 ? 'emerald' : unrealized < 0 ? 'risk' : 'gold'
  const returnPct = hasHoldings && current.invested_cost_basis > 0
    ? (current.unrealized_gain_loss / current.invested_cost_basis) * 100
    : undefined
  const returnTone = returnPct === undefined ? 'gold' : returnPct > 0 ? 'emerald' : returnPct < 0 ? 'risk' : 'gold'

  return createElement(
    'section',
    { 'aria-label': 'Accounting summary', className: 'owl-kpi-row' },
    createElement(
      'div',
      { className: 'owl-kpi-panel owl-kpi-panel-gold' },
      createElement(OwlKpiStat, {
        label: 'NAV (current period)',
        value: formatMoney(current.nav, current.currency),
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Unrealized P&L',
        value: hasHoldings ? formatMoney(unrealized, current.currency) : '—',
        tone: unrealizedTone,
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Return %',
        value: returnPct === undefined ? '—' : `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
        tone: returnTone,
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Cost basis',
        value: hasHoldings ? formatMoney(current.invested_cost_basis, current.currency) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Valued holdings',
        value: hasHoldings ? `${valuedCount}/${current.holdings.length}` : '—',
        tone: 'emerald',
      }),
      createElement(OwlRingGauge, {
        value: coveragePct,
        label: 'Valued',
        tone: !hasHoldings ? 'amber' : coveragePct === 100 ? 'emerald' : 'amber',
        size: 64,
      }),
    ),
  )
}

function createAccountingStatusPanel(current: AccountingSnapshotProjection, nextScheduledUpdate: string) {
  const valuationBadge = getValuationCoverageBadge(current)
  const userActionRequired = current.missing_valuation_holding_ids.length === 0
    ? 'No user action required for current NAV coverage'
    : `Resolve ${current.missing_valuation_holding_ids.length} missing valuation ${current.missing_valuation_holding_ids.length === 1 ? 'record' : 'records'}: ${current.missing_valuation_holding_ids.join(', ')}`

  return createElement(
    'section',
    { 'aria-label': 'Accounting report status', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' } },
      createElement('h2', { className: 'owl-section-title', style: { margin: 0 } }, 'Automatically maintained accounting projection'),
      createElement(StatusBadge, { tone: 'neutral' }, 'Ledger-derived'),
      createElement(StatusBadge, { tone: valuationBadge.tone }, valuationBadge.label),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', margin: '0.75rem 0 1rem' } },
      statusMetric('Current state', `${formatMoney(current.nav, current.currency)} NAV for ${formatMonth(current.period_end)}`),
      statusMetric('Last automation calculation', current.updated_at),
      statusMetric('Next scheduled calculation', nextScheduledUpdate),
      statusMetric('Source / caveat / confidence', 'Local ledger projection · valuation/cash-flow event coverage only · not a broker statement or tax report'),
      statusMetric('User action required', userActionRequired),
    ),
    createElement('p', { style: { color: 'var(--owl-color-text)', fontWeight: 800, margin: '0 0 0.45rem' } }, `Last ledger update: ${current.updated_at}`),
    createElement('p', { style: { color: 'var(--owl-color-text)', fontWeight: 800, margin: '0 0 0.45rem' } }, `Next scheduled update: ${nextScheduledUpdate}`),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', lineHeight: 1.55, margin: '0 0 0.75rem' } },
      'This report is projection-derived from the local ledger. Manual corrections are audited fallback or override records; valuation, cash-flow, dividend, fee, and realized gain/loss events remain the primary accounting inputs.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
      createElement(SourceChip, { id: current.snapshot_id, label: 'Snapshot ID' }),
      ...current.audit_event_ids.slice(0, 4).map((eventId) => createElement(SourceChip, { href: auditEventHref(eventId), id: eventId, key: `audit:${eventId}`, label: 'Audit event' })),
      ...current.source_ids.slice(0, 4).map((sourceId) => createElement(SourceChip, { id: sourceId, key: `source:${sourceId}`, label: 'Source' })),
    ),
  )
}

function statusMetric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.9rem 1rem' } },
    createElement('p', { className: 'owl-label' }, label),
    createElement('p', { style: { color: 'var(--owl-color-text)', fontWeight: 700, lineHeight: 1.4, margin: '0.35rem 0 0', fontSize: 'var(--owl-text-base)' } }, value),
  )
}

function createAccountingLearnPanel(limitations: string[]) {
  return createElement(
    'details',
    { 'aria-label': 'Accounting limitations', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' } },
    createElement('summary', { style: { color: 'var(--owl-color-amber)', cursor: 'pointer', fontSize: 'var(--owl-text-md)', fontWeight: 900 } }, 'Learn: accounting controls and caveats'),
    createElement(
      'ul',
      { style: { color: 'var(--owl-color-amber)', display: 'grid', gap: '0.4rem', margin: '0.8rem 0 0', paddingLeft: '1.25rem' } },
      ...limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
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
  const cashLedgerCopy = current.cash_flows.length > 0
    ? `Cash ledger events: ${current.cash_flows.length} period events linked.`
    : 'Cash ledger events: no period deposit, withdrawal, dividend, or fee events linked.'
  const warnings = accountingWarnings(current)

  return createElement(
    'section',
    { 'aria-label': 'Accounting data provenance', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.75rem' } }, 'Data provenance'),
    createElement(
      'ul',
      { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.55rem', lineHeight: 1.5, margin: 0, paddingLeft: '1.25rem' } },
      createElement('li', null, `Valuation event coverage: ${current.holdings.length} ${current.holdings.length === 1 ? 'holding' : 'holdings'} in snapshot; ${missingCount} missing ${missingCount === 1 ? 'valuation' : 'valuations'}.`),
      createElement('li', null, cashLedgerCopy),
      createElement('li', null, 'Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period.'),
      createElement('li', null, 'Deposits, withdrawals, dividends, fees, and realized P&L are separated from valuation state and linked to ledger events where available.'),
      createElement('li', null, 'Broker sync: not connected for this local alpha; values are user-entered, worker-recorded, or projected from ledger events.'),
    ),
    warnings.length === 0 ? null : createElement(
      'section',
      { 'aria-label': 'Missing-data warnings', style: { marginTop: '1rem' } },
      createElement('h3', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-md)', margin: '0 0 0.5rem' } }, 'Missing-data warnings'),
      createElement(
        'ul',
        { style: { color: 'var(--owl-color-risk-bright)', display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.25rem' } },
        ...warnings.map((warning) => createElement('li', { key: `${warning.code}:${warning.holding_id ?? warning.event_id ?? warning.message}` }, warning.message)),
      ),
    ),
  )
}

function createCashFlowLedgerEvents(current: AccountingSnapshotProjection) {
  return createElement(
    'section',
    { 'aria-label': 'Cash-flow ledger events', style: { marginTop: '1rem' } },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)', margin: '0 0 0.6rem' } }, 'Cash-flow ledger events'),
    current.cash_flows.length === 0
      ? createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0 } }, 'No period cash-flow ledger events are linked yet.')
      : createElement(
        'ol',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.45rem', margin: 0, paddingLeft: '1.25rem' } },
        ...current.cash_flows.map((flow) => createElement(
          'li',
          { key: flow.event_id },
          `${capitalize(flow.flow_type)} ${formatMoney(Math.abs(flow.amount), flow.currency)} on ${flow.occurred_at}: `,
          createElement(SourceChip, { href: auditEventHref(flow.event_id), id: flow.event_id, label: 'Audit event' }),
          ...flow.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: `${flow.event_id}:${sourceId}`, label: 'Source' })),
        )),
      ),
  )
}

function createEmptyHoldingsState(current: AccountingSnapshotProjection) {
  return createElement(
    'div',
    { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: { color: 'var(--owl-color-amber)', fontWeight: 900, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Zero-total empty state'),
    createElement('p', { style: { margin: 0 } }, 'No holdings are present for this accounting period yet.'),
    createElement('p', { style: { fontWeight: 800, margin: 0 } }, `Zero totals are expected until ledger valuation or cash-flow events exist for an opened holding. Current projected NAV: ${formatMoney(current.nav, current.currency)}.`),
    createElement('p', { style: { margin: 0 } }, 'Next step: open a holding, record lot data, then let valuation/cash-flow events feed accounting automatically.'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0 } }, 'Source/audit preview: future cash, dividend, fee, and valuation events will appear here with ledger links.'),
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
    { 'aria-label': 'Missing valuations', style: { ...cardStyle, background: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--owl-color-risk-bright)' } },
    createElement('h2', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-md)', margin: '0 0 0.4rem' } }, 'Missing valuations'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-risk-bright)', fontWeight: 800, margin: 0 } },
      `${missingCount} ${missingCount === 1 ? 'holding needs' : 'holdings need'} a valuation before NAV is complete`,
    ),
  )
}

function createSnapshotHistory(snapshots: AccountingSnapshotProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Snapshot history', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Snapshot history'),
    snapshots.length === 0
      ? createElement(
        'div',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.4rem' } },
        createElement('p', { style: { margin: 0 } }, 'No accounting snapshots have been recorded yet.'),
        createElement('p', { style: { margin: 0 } }, 'Audit/source links preview: recorded monthly snapshots, valuation sources, and future cash-flow events will appear here.'),
      )
      : createElement(
        'ol',
        { style: { display: 'grid', gap: '0.6rem', margin: 0, paddingLeft: '1.25rem' } },
        ...snapshots.map((snapshot) => createElement(
          'li',
          { key: snapshot.snapshot_id },
          `${snapshot.period_end}: ${formatMoney(snapshot.nav, snapshot.currency)} projected NAV, ${snapshot.missing_valuation_holding_ids.length} missing valuations. `,
          createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, `Audit/source links preview: ${snapshot.snapshot_id}`),
        )),
      ),
  )
}

function holdingCard(holding: AccountingHoldingSnapshot) {
  const label = holding.ticker ?? holding.holding_id
  return createElement(
    'article',
    { style: { border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-md)', margin: '0 0 0.5rem' } }, label),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Shares: ${formatNumber(holding.shares)}`),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Cost basis: ${formatMoney(holding.cost_basis, holding.currency)}`),
    holding.valuation_status === 'valued'
      ? createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Current value: ${formatMoney(holding.current_value ?? 0, holding.currency)}`)
      : createElement('p', { style: { color: 'var(--owl-color-risk-bright)', fontWeight: 800, margin: '0.25rem 0' } }, 'Valuation missing'),
    holding.unrealized_gain_loss === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Unrealized P&L: ${formatMoney(holding.unrealized_gain_loss, holding.currency)}`),
    holding.latest_valuation_at === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0 0' } }, `Valuation freshness: ${holding.latest_valuation_at}`),
    holding.valuation_event_id === undefined
      ? null
      : createElement('p', { style: { margin: '0.5rem 0 0' } }, createElement(SourceChip, { href: auditEventHref(holding.valuation_event_id), id: holding.valuation_event_id, label: 'Valuation event' })),
    ...(holding.valuation_source_ids ?? []).map((sourceId) => createElement(SourceChip, { id: sourceId, key: `${holding.holding_id}:${sourceId}`, label: 'Source' })),
  )
}

function metric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.9rem 1rem' } },
    createElement('p', { className: 'owl-label' }, label),
    createElement('p', { className: 'owl-value', style: { margin: '0.35rem 0 0' } }, value),
  )
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
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
