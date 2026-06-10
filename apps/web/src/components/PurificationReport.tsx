import { createElement, type CSSProperties } from 'react'

import type { PurificationObligationProjection, PurificationPaymentProjection } from '@owlfolio/ledger/projections/purificationProjection'

import type { AppPurificationReport, PurificationSummaryCard } from '../lib/purification'
import { humanizeCronProse } from '../lib/schedule'
import { OwlButtonLink, OwlKpiStat, OwlRingGauge, RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type PurificationReportProps = {
  report: AppPurificationReport
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

export function PurificationReport({ report }: PurificationReportProps) {
  return createElement(
    'section',
    { style: shellStyle },
    createElement(RouteHeader, {
      kicker: 'Shariah purification',
      title: 'Purification ledger',
      description: 'Tracks purification obligations, manual user payment tracking, remaining balances, and audit links back to Shariah and accounting evidence. Owlfolio records user-confirmed payments only; it does not pay or mark obligations complete automatically.',
    }),
    createPurificationOperationsCockpit(report),
    createPurificationKpiRow(report.summary_cards),
    createSummaryCards(report.summary_cards),
    createObligations(report.obligations),
    createEvidenceChecklist(report.obligations, report.payments),
    createPayments(report.payments, report.obligations.length),
    createPurificationLearnPanel(report.limitations),
  )
}

function createPurificationKpiRow(cards: PurificationSummaryCard[]) {
  const hasCards = cards.length > 0
  const currency = cards[0]?.currency ?? 'USD'
  const owed = cards.reduce((sum, card) => sum + card.owed, 0)
  const paid = cards.reduce((sum, card) => sum + card.paid, 0)
  const remaining = cards.reduce((sum, card) => sum + card.remaining, 0)
  const paidPct = owed > 0 ? Math.round((paid / owed) * 100) : 0
  const remainingTone = remaining > 0 ? 'risk' : 'emerald'

  return createElement(
    'section',
    { 'aria-label': 'Purification summary', className: 'owl-kpi-row' },
    createElement(
      'div',
      { className: 'owl-kpi-panel owl-kpi-panel-gold' },
      createElement(OwlKpiStat, {
        label: 'Owed',
        value: hasCards ? formatMoney(owed, currency) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Paid',
        value: hasCards ? formatMoney(paid, currency) : '—',
        tone: 'emerald',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Remaining',
        value: hasCards ? formatMoney(remaining, currency) : '—',
        tone: remainingTone,
      }),
      createElement(OwlRingGauge, {
        value: paidPct,
        label: 'Paid',
        tone: !hasCards ? 'amber' : remaining === 0 ? 'emerald' : 'amber',
        size: 64,
      }),
    ),
  )
}

function createPurificationOperationsCockpit(report: AppPurificationReport) {
  const remainingByCurrency = report.summary_cards.map((card) => `${formatMoney(card.remaining, card.currency)} remaining`).join(', ') || '$0.00 remaining'
  const remainingAmount = report.summary_cards.reduce((sum, card) => sum + card.remaining, 0)
  const obligationCount = report.obligations.length
  const lastCalculation = report.obligations
    .map((obligation) => obligation.recorded_at)
    .sort()
    .at(-1) ?? 'No purification calculation recorded'
  const currentState = `${remainingByCurrency} across ${obligationCount} ${obligationCount === 1 ? 'obligation' : 'obligations'}`
  const userActionRequired = remainingAmount > 0
    ? `Record external payment evidence for ${remainingByCurrency}`
    : obligationCount === 0
      ? 'No user action required until a sourced purification obligation exists'
      : 'No user action required — obligations are covered'

  return createElement(
    'section',
    { 'aria-label': 'Purification operations cockpit', style: { ...cardStyle, background: 'var(--owl-color-panel-deep)', borderColor: 'rgba(20, 184, 166, 0.34)' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.6rem' } },
      createElement('h2', { className: 'owl-section-title', style: { margin: 0 } }, 'Purification operations cockpit'),
      createElement(StatusBadge, { tone: 'compliance' }, 'Tracking aid, not a ruling or payment service'),
      createElement(StatusBadge, { tone: 'manual' }, 'Manual payment status'),
    ),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0 0 0.45rem' } }, 'Quarterly calculations can surface obligations automatically from Shariah and accounting evidence; only the user records external charity payments.'),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', marginTop: '1rem' } },
      statusMetric('Current state', currentState),
      statusMetric('Last automation calculation', lastCalculation),
      statusMetric('Next scheduled calculation', humanizeCronProse('quarterly purification review cadence 0 8 1 */3 *')),
      statusMetric('Source / caveat / confidence', 'AAOIFI-aware local ledger projection · Shariah/accounting evidence required · not a ruling, tax record, or payment service'),
      statusMetric('User action required', userActionRequired),
    ),
  )
}

function statusMetric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.9rem 1rem' } },
    createElement('p', { className: 'owl-label' }, label),
    createElement('p', { style: { color: 'var(--owl-color-text)', fontWeight: 700, lineHeight: 1.4, margin: '0.35rem 0 0', fontSize: 'var(--owl-text-base)' } }, value),
  )
}

function createPurificationLearnPanel(limitations: string[]) {
  return createElement(
    'details',
    { 'aria-label': 'Purification limitations', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' } },
    createElement('summary', { style: { color: 'var(--owl-color-amber)', cursor: 'pointer', fontSize: 'var(--owl-text-md)', fontWeight: 900 } }, 'Learn: purification controls and caveats'),
    createElement(
      'ul',
      { style: { color: 'var(--owl-color-amber)', display: 'grid', gap: '0.4rem', margin: '0.8rem 0 0', paddingLeft: '1.25rem' } },
      ...limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
    ),
  )
}


function createSummaryCards(cards: PurificationSummaryCard[]) {
  return createElement(
    'section',
    { 'aria-label': 'Purification balance summary', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Owed / paid / remaining'),
    cards.length === 0
      ? createPurificationZeroState()
      : createElement(
        'div',
        { style: metricGridStyle },
        ...cards.flatMap((card) => [
          metric(`${card.currency} Owed`, formatMoney(card.owed, card.currency)),
          metric(`${card.currency} Paid`, formatMoney(card.paid, card.currency)),
          metric(`${card.currency} Remaining`, formatMoney(card.remaining, card.currency)),
        ]),
      ),
  )
}

function createPurificationZeroState() {
  return createElement(
    'div',
    { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: { margin: 0 } }, 'No purification obligations have been recorded yet.'),
    createElement('p', { style: { fontWeight: 800, margin: 0 } }, '$0.00 owed, $0.00 paid, and $0.00 remaining until an auditable obligation exists.'),
    createElement('p', { style: { margin: 0 } }, 'Next step: create a sourced obligation from Shariah/accounting evidence, then record the charity payment manually.'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0 } }, 'Source/audit preview: Shariah evidence, accounting snapshot, and payment receipt links will appear here.'),
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.25rem' } },
      createElement(OwlButtonLink, { href: '/audit', variant: 'primary' }, 'Create sourced obligation'),
      createElement(OwlButtonLink, { href: '/accounting/monthly', variant: 'secondary' }, 'Link Shariah/accounting evidence'),
      createElement('button', { 'aria-disabled': true, className: 'owl-button owl-button-secondary', disabled: true, style: { opacity: 0.62 }, type: 'button' }, 'Record external payment (disabled until obligation exists)'),
    ),
  )
}

function createObligations(obligations: PurificationObligationProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Purification obligations', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Obligations'),
    obligations.length === 0
      ? createElement(
        'div',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.5rem' } },
        createElement('p', { style: { margin: 0 } }, 'No obligations are present yet.'),
        createElement('p', { style: { margin: 0 } }, 'Payment action appears only after an obligation exists and the user has an external payment to record.'),
        createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0, fontSize: 'var(--owl-text-sm)' } }, 'Once obligations exist, Shariah policy evidence, accounting snapshots, and calculation basis will appear here.'),
      )
      : createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        ...obligations.map((obligation) => obligationCard(obligation)),
      ),
  )
}

function createEvidenceChecklist(obligations: PurificationObligationProjection[], payments: PurificationPaymentProjection[]) {
  const obligationCount = obligations.length
  const policyCoverage = coverageChip('Policy/source evidence', obligations, (obligation) => obligation.shariah_source_ids.length > 0, firstLinkedId(obligations.flatMap((obligation) => obligation.shariah_source_ids)), 'policy_source_missing')
  const accountingCoverage = coverageChip('Accounting snapshot', obligations, (obligation) => obligation.accounting_snapshot_id !== undefined, firstLinkedId(obligations.map((obligation) => obligation.accounting_snapshot_id)), 'accounting_snapshot_missing')
  const calculationCoverage = coverageChip('Calculation basis', obligations, (obligation) => obligation.reason !== undefined || obligation.shariah_evaluation_id !== undefined || obligation.accounting_snapshot_id !== undefined, 'calculation_basis_recorded', 'calculation_basis_missing')
  const receiptCoverage = coverageChip(
    'Payment receipt',
    obligations,
    (obligation) => payments.some((payment) => payment.obligation_id === obligation.obligation_id && payment.audit_source_ids.length > 0),
    firstLinkedId(payments.flatMap((payment) => payment.audit_source_ids)),
    'payment_receipt_awaiting',
  )
  const auditCoverage = coverageChip('Audit link', obligations, (obligation) => obligation.audit_source_ids.length > 0, firstLinkedId(obligations.flatMap((obligation) => obligation.audit_source_ids)), 'audit_link_missing')

  return createElement(
    'section',
    { 'aria-label': 'Purification evidence checklist', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.75rem' } }, 'Evidence checklist'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', lineHeight: 1.55, margin: '0 0 0.85rem' } },
      obligationCount === 0
        ? 'Future obligations need sourced policy evidence, an accounting snapshot, a calculation basis, and a user payment receipt before they can be treated as auditable.'
        : 'Each obligation should remain traceable from Shariah policy evidence through accounting context and user-recorded external payment receipts.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
      createElement(SourceChip, policyCoverage),
      createElement(SourceChip, accountingCoverage),
      createElement(SourceChip, calculationCoverage),
      createElement(SourceChip, receiptCoverage),
      createElement(SourceChip, auditCoverage),
    ),
  )
}

function coverageChip(
  label: string,
  obligations: PurificationObligationProjection[],
  isCovered: (obligation: PurificationObligationProjection) => boolean,
  linkedId: string,
  missingId: string,
): { id: string; label: string } {
  if (obligations.length === 0) {
    return { id: `pending_${missingId.replace(/_missing$|_awaiting$/, '')}`, label: `${label} pending` }
  }

  const coveredCount = obligations.filter(isCovered).length
  if (coveredCount === obligations.length) {
    return { id: linkedId, label: `${label} linked` }
  }

  if (coveredCount === 0) {
    return { id: missingId, label: `${label} missing` }
  }

  return { id: `${coveredCount}_of_${obligations.length}_${missingId.replace(/_missing$|_awaiting$/, '')}`, label: `${label} partial` }
}

function firstLinkedId(ids: Array<string | undefined>): string {
  return ids.find((id): id is string => id !== undefined && id.length > 0) ?? 'linked_evidence_recorded'
}

function createPayments(payments: PurificationPaymentProjection[], obligationCount: number) {
  const emptyPaymentCopy = obligationCount === 0
    ? 'Payment action appears only after an obligation exists and the user has an external payment to record.'
    : 'No payments have been recorded for this obligation yet. Make the external payment first, then record it manually.'

  return createElement(
    'section',
    { 'aria-label': 'Purification payment history', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.8rem' } }, 'Payment history'),
    payments.length === 0
      ? createElement(
        'div',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.5rem' } },
        createElement('p', { style: { margin: 0 } }, 'No explicit purification payments have been recorded yet.'),
        createElement('p', { style: { margin: 0 } }, emptyPaymentCopy),
      )
      : createElement(
        'ol',
        { style: { display: 'grid', gap: '0.6rem', margin: 0, paddingLeft: '1.25rem' } },
        ...payments.map((payment) => createElement(
          'li',
          { key: payment.payment_id },
          `${payment.paid_at}: ${formatMoney(payment.amount, payment.currency)} paid to ${payment.recipient}. User-recorded payment receipt: ${payment.audit_source_ids.join(', ') || 'no receipt source linked'}`,
        )),
      ),
  )
}

function obligationCard(obligation: PurificationObligationProjection) {
  const holdingLabel = obligation.ticker ?? obligation.holding_id
  return createElement(
    'article',
    { style: { border: '1px solid rgba(148, 163, 184, 0.16)', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-md)', margin: '0 0 0.5rem' } }, holdingLabel),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Period: ${obligation.period_start} → ${obligation.period_end}`),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Status: ${obligation.status}`),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Owed: ${formatMoney(obligation.amount, obligation.currency)}; paid: ${formatMoney(obligation.paid_amount, obligation.currency)}; remaining: ${formatMoney(obligation.remaining_amount, obligation.currency)}`),
    obligation.shariah_status === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Shariah: ${obligation.shariah_status}${obligation.shariah_policy_basis === undefined ? '' : ` (${obligation.shariah_policy_basis})`}`),
    obligation.accounting_nav === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Accounting snapshot ${obligation.accounting_snapshot_id ?? 'unknown'} NAV: ${formatMoney(obligation.accounting_nav, obligation.currency)}`),
    obligation.accounting_holding_value === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Holding value: ${formatMoney(obligation.accounting_holding_value, obligation.currency)}`),
    obligation.dividend_income_amount === undefined || obligation.dividend_event_id === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Dividend basis: ${formatMoney(obligation.dividend_income_amount, obligation.currency)} from ${obligation.dividend_event_id}`),
    obligation.impurity_rate === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.25rem 0' } }, `Impurity rate: ${formatPercent(obligation.impurity_rate)}`),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontWeight: 800, margin: '0.25rem 0' } }, 'Payment action: record only after the user confirms an external payment'),
    obligation.audit_source_ids.length === 0
      ? createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0 0' } }, 'Audit/source links preview: no sources linked yet')
      : createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' } },
        createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } }, 'Audit/source links preview:'),
        ...obligation.audit_source_ids.map((id) => createElement(SourceChip, { id, key: id, label: 'Audit source' })),
      ),
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

function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(value)
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { currency, style: 'currency' }).format(value)
}
