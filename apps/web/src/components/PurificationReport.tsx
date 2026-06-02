import { createElement, type CSSProperties } from 'react'

import type { PurificationObligationProjection, PurificationPaymentProjection } from '@owlfolio/ledger/projections/purificationProjection'

import type { AppPurificationReport, PurificationSummaryCard } from '../lib/purification'

export type PurificationReportProps = {
  report: AppPurificationReport
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
}

const heroStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)',
  border: '1px solid #bbf7d0',
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

export function PurificationReport({ report }: PurificationReportProps) {
  return createElement(
    'section',
    { style: shellStyle },
    createElement(
      'header',
      { style: heroStyle },
      createElement('p', { style: { color: '#047857', fontWeight: 900, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Shariah purification'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Purification ledger'),
      createElement(
        'p',
        { style: { color: '#475569', fontSize: '1rem', margin: 0 } },
        'Tracks purification obligations, manual user payment tracking, remaining balances, and audit links back to Shariah and accounting evidence. Owlfolio records user-confirmed payments only; it does not pay or mark obligations complete automatically.',
      ),
    ),
    createSummaryCards(report.summary_cards),
    createObligations(report.obligations),
    createPayments(report.payments, report.obligations.length),
    createElement(
      'section',
      { 'aria-label': 'Purification limitations', style: { ...cardStyle, background: '#fffbeb', borderColor: '#fde68a' } },
      createElement('h2', { style: { fontSize: '1.1rem', margin: '0 0 0.75rem' } }, 'Controls and limitations'),
      createElement(
        'ul',
        { style: { color: '#92400e', display: 'grid', gap: '0.4rem', margin: 0, paddingLeft: '1.25rem' } },
        ...report.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
      ),
    ),
  )
}

function createSummaryCards(cards: PurificationSummaryCard[]) {
  return createElement(
    'section',
    { 'aria-label': 'Purification balance summary', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Owed / paid / remaining'),
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
    { style: { color: '#475569', display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: { margin: 0 } }, 'No purification obligations have been recorded yet.'),
    createElement('p', { style: { fontWeight: 800, margin: 0 } }, '$0.00 owed, $0.00 paid, and $0.00 remaining until an auditable obligation exists.'),
    createElement('p', { style: { margin: 0 } }, 'Next step: create a sourced obligation from Shariah/accounting evidence, then record the charity payment manually.'),
    createElement('p', { style: { color: '#64748b', margin: 0 } }, 'Source/audit preview: Shariah evidence, accounting snapshot, and payment receipt links will appear here.'),
  )
}

function createObligations(obligations: PurificationObligationProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Purification obligations', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Obligations'),
    obligations.length === 0
      ? createElement(
        'div',
        { style: { color: '#475569', display: 'grid', gap: '0.5rem' } },
        createElement('p', { style: { margin: 0 } }, 'No obligations are present yet.'),
        createElement('p', { style: { margin: 0 } }, 'Payment action appears only after an obligation exists and the user has an external payment to record.'),
        createElement('p', { style: { color: '#64748b', margin: 0 } }, 'Audit/source links preview: obligation evidence, accounting snapshots, and policy sources will be linked here.'),
      )
      : createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        ...obligations.map((obligation) => obligationCard(obligation)),
      ),
  )
}

function createPayments(payments: PurificationPaymentProjection[], obligationCount: number) {
  const emptyPaymentCopy = obligationCount === 0
    ? 'Payment action appears only after an obligation exists and the user has an external payment to record.'
    : 'No payments have been recorded for this obligation yet. Make the external payment first, then record it manually.'

  return createElement(
    'section',
    { 'aria-label': 'Purification payment history', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: '0 0 1rem' } }, 'Payment history'),
    payments.length === 0
      ? createElement(
        'div',
        { style: { color: '#475569', display: 'grid', gap: '0.5rem' } },
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
  return createElement(
    'article',
    { style: { border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '1rem' } },
    createElement('h3', { style: { fontSize: '1.2rem', margin: '0 0 0.5rem' } }, obligation.holding_id),
    createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Period: ${obligation.period_start} → ${obligation.period_end}`),
    createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Status: ${obligation.status}`),
    createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Owed: ${formatMoney(obligation.amount, obligation.currency)}; paid: ${formatMoney(obligation.paid_amount, obligation.currency)}; remaining: ${formatMoney(obligation.remaining_amount, obligation.currency)}`),
    obligation.shariah_status === undefined
      ? null
      : createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Shariah: ${obligation.shariah_status}${obligation.shariah_policy_basis === undefined ? '' : ` (${obligation.shariah_policy_basis})`}`),
    obligation.accounting_nav === undefined
      ? null
      : createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Accounting snapshot ${obligation.accounting_snapshot_id ?? 'unknown'} NAV: ${formatMoney(obligation.accounting_nav, obligation.currency)}`),
    obligation.accounting_holding_value === undefined
      ? null
      : createElement('p', { style: { color: '#334155', margin: '0.25rem 0' } }, `Holding value: ${formatMoney(obligation.accounting_holding_value, obligation.currency)}`),
    createElement('p', { style: { color: '#334155', fontWeight: 800, margin: '0.25rem 0' } }, 'Payment action: record only after the user confirms an external payment'),
    createElement('p', { style: { color: '#64748b', margin: '0.25rem 0 0' } }, `Audit/source links preview: ${obligation.audit_source_ids.join(', ') || 'none linked'}`),
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
