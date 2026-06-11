import { createElement, Fragment, type ReactNode } from 'react'

import type { PurificationObligationProjection, PurificationPaymentProjection } from '@owlfolio/ledger/projections/purificationProjection'

import type { AppPurificationReport, PurificationSummaryCard } from '../lib/purification'
import { humanizeCronProse } from '../lib/schedule'
import { OwlButtonLink, RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type PurificationReportProps = {
  report: AppPurificationReport
}

/**
 * The Purification briefing.
 *
 * Reads as the steward's account of the user's Shariah purification duty: the
 * non-compliant income to cleanse, tracked as an auditable local aid — not a
 * ruling or a payment service. Vital signs lead (owed / paid / remaining /
 * paid %), then the per-holding obligations and their impurity basis, the
 * evidence checklist, and the user-recorded payment history. Returns a Fragment
 * so each section is a direct child of the route frame.
 */
export function PurificationReport({ report }: PurificationReportProps) {
  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Shariah purification',
      title: 'Purification ledger',
      description: 'Your purification duty as a tracked, auditable ledger: the non-compliant income to cleanse, with manual user payment tracking, remaining balances, and audit links back to Shariah and accounting evidence. Owlfolio records user-confirmed payments only; it does not pay or mark obligations complete automatically.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createVitalSigns(report.summary_cards),
    createIntentClassOverview(report),
    createDutyPanel(report),
    createObligations(report.obligations),
    createQuarterlyStatement(report),
    report.zakat_statement === undefined ? null : createZakatStatement(report),
    createEvidenceChecklist(report.obligations, report.payments),
    createPayments(report.payments, report.obligations.length),
    createPurificationLearnPanel(report.limitations),
  )
}

// ── Intent-class structure (UI-continuity Rule 2: giving page) ────────────────
//
// Groups giving by intent class so future intents (infaq, waqf) slot in later WITHOUT a redesign. Only the
// two active intent classes are built now (purification, zakat); the deferred classes are shown as a
// labeled, disabled placeholder row — the structure exists, the handling does not (waqf/infaq deferred).

type IntentClass = {
  id: string
  label: string
  description: string
  status: 'active' | 'deferred'
  amountLabel?: string
}

function createIntentClassOverview(report: AppPurificationReport) {
  const purificationRemaining = report.summary_cards.reduce((sum, card) => sum + card.remaining, 0)
  const currency = report.summary_cards[0]?.currency ?? 'USD'
  const zakat = report.zakat_statement

  const classes: IntentClass[] = [
    {
      id: 'purification',
      label: 'Purification',
      description: 'Cleansing non-compliant income — a tracked obligation, not a ruling.',
      status: 'active',
      amountLabel: `${formatMoney(purificationRemaining, currency)} remaining`,
    },
    {
      id: 'zakat',
      label: 'Zakat',
      description: '2.5% on a user-set zakatable base — a user-authored methodology.',
      status: 'active',
      ...(zakat === undefined ? {} : { amountLabel: `${formatMoney(zakat.zakat_due, zakat.currency)} due` }),
    },
    {
      id: 'infaq',
      label: 'Infaq',
      description: 'Voluntary giving — deferred; the intent-class slot exists, the handling is not built.',
      status: 'deferred',
    },
    {
      id: 'waqf',
      label: 'Waqf',
      description: 'Endowment — deferred; the intent-class slot exists, the handling is not built.',
      status: 'deferred',
    },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Giving intent classes', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Intent classes'),
    createElement('h2', { className: 'owl-section-title' }, 'Giving by intent class'),
    createElement('p', { className: 'owl-row-helper', style: { maxWidth: '60ch' } }, 'Giving is organized by intent class so additional intents can be added later without a redesign. Purification and zakat are active; infaq and waqf are deferred placeholders only.'),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...classes.map((intent) => createElement(
        'div',
        { key: intent.id, 'data-intent-class': intent.id, className: 'owl-row owl-row-top', style: { opacity: intent.status === 'deferred' ? 0.6 : 1 } },
        createElement(
          'div',
          { className: 'owl-row-main' },
          createElement(
            'p',
            { className: 'owl-row-title', style: { margin: 0 } },
            intent.label,
            createElement('span', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', marginLeft: '0.6rem', textTransform: 'uppercase' } }, intent.status === 'active' ? 'active' : 'deferred'),
          ),
          createElement('p', { className: 'owl-row-helper', style: { margin: '0.2rem 0 0' } }, intent.description),
        ),
        intent.amountLabel === undefined
          ? null
          : createElement('p', { className: 'owl-row-helper', style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontWeight: 700, margin: 0, textAlign: 'right' } }, intent.amountLabel),
      )),
    ),
  )
}

// ── 1. Vital signs (owed / paid / remaining / paid %) ─────────────────────────

function createVitalSigns(cards: PurificationSummaryCard[]) {
  const hasCards = cards.length > 0
  const currency = cards[0]?.currency ?? 'USD'
  const owed = cards.reduce((sum, card) => sum + card.owed, 0)
  const paid = cards.reduce((sum, card) => sum + card.paid, 0)
  const remaining = cards.reduce((sum, card) => sum + card.remaining, 0)
  const paidPct = owed > 0 ? Math.round((paid / owed) * 100) : 0
  const remainingClass = remaining > 0 ? 'owl-ledger-figure-risk' : 'owl-ledger-figure-emerald'

  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: 'owl-ledger-figure-money', label: 'Owed', value: hasCards ? formatMoney(owed, currency) : '—' },
    { figureClass: 'owl-ledger-figure-money owl-ledger-figure-emerald', label: 'Paid', value: hasCards ? formatMoney(paid, currency) : '—' },
    { figureClass: `owl-ledger-figure-money ${remainingClass}`, label: 'Remaining', value: hasCards ? formatMoney(remaining, currency) : '—' },
    { figureClass: remaining === 0 && hasCards ? 'owl-ledger-figure-emerald' : '', label: 'Paid %', value: hasCards ? `${paidPct}%` : '—' },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Purification vital signs', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
    )),
  )
}

// ── 2. The duty — what is owed, why, and what only you can do ──────────────────

function createDutyPanel(report: AppPurificationReport) {
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
    { 'aria-label': 'Purification operations cockpit', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Your purification duty'),
    createElement('h2', { className: 'owl-section-title' }, 'Purification operations cockpit'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement(StatusBadge, { tone: 'compliance' }, 'Tracking aid, not a ruling or payment service'),
      createElement(StatusBadge, { tone: 'manual' }, 'Manual payment status'),
    ),
    createElement('p', { className: 'owl-row-helper', style: { maxWidth: '60ch' } }, 'Quarterly calculations can surface obligations automatically from Shariah and accounting evidence; only you record the external charity payment. Owlfolio tracks the duty — it does not discharge it.'),
    createElement(
      'div',
      { className: 'owl-row-list', style: { marginTop: 'var(--owl-space-1)' } },
      dutyLine('Current state', currentState),
      dutyLine('Last automation calculation', lastCalculation, true),
      dutyLine('Next scheduled calculation', humanizeCronProse('quarterly purification review cadence 0 8 1 */3 *')),
      dutyLine('Source / caveat / confidence', 'AAOIFI-aware local ledger projection · Shariah/accounting evidence required · not a ruling, tax record, or payment service'),
      dutyLine('User action required', userActionRequired),
    ),
  )
}

function dutyLine(label: string, value: string, mono = false) {
  return createElement(
    'div',
    { className: 'owl-row owl-row-top' },
    createElement('p', { className: 'owl-ledger-label', style: { alignSelf: 'center' } }, label),
    createElement(
      'p',
      {
        className: 'owl-row-helper',
        style: {
          color: 'var(--owl-color-text)',
          fontFamily: mono ? 'var(--owl-font-mono)' : undefined,
          fontWeight: 600,
          margin: 0,
          textAlign: 'right',
        },
      },
      value,
    ),
  )
}

// ── 3. Obligations (per holding: impurity basis) ──────────────────────────────

function createObligations(obligations: PurificationObligationProjection[]) {
  return createElement(
    'section',
    { 'aria-label': 'Purification obligations', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Owed / paid / remaining'),
    createElement('h2', { className: 'owl-section-title' }, 'Obligations'),
    obligations.length === 0
      ? createObligationsZeroState()
      : createElement(
        'div',
        { className: 'owl-row-list' },
        ...obligations.map((obligation) => obligationCard(obligation)),
      ),
  )
}

function createObligationsZeroState() {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No purification obligations have been recorded yet.'),
    createElement('p', { className: 'owl-row-title', style: { margin: 0 } }, '$0.00 owed, $0.00 paid, and $0.00 remaining until an auditable obligation exists.'),
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No obligations are present yet. Payment action appears only after an obligation exists and the user has an external payment to record.'),
    createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'Next step: create a sourced obligation from Shariah/accounting evidence, then record the charity payment manually.'),
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', marginTop: 'var(--owl-space-1)' } },
      createElement(OwlButtonLink, { href: '/audit', variant: 'primary' }, 'Create sourced obligation'),
      createElement(OwlButtonLink, { href: '/accounting/monthly', variant: 'secondary' }, 'Link Shariah/accounting evidence'),
      createElement('button', { 'aria-disabled': true, className: 'owl-button owl-button-secondary', disabled: true, style: { opacity: 0.62 }, type: 'button' }, 'Record external payment (disabled until obligation exists)'),
    ),
  )
}

function obligationCard(obligation: PurificationObligationProjection) {
  const holdingLabel = obligation.ticker ?? obligation.holding_id
  const figures: ReactNode[] = [
    obligationFigure('Owed', formatMoney(obligation.amount, obligation.currency), 'owl-ledger-figure-money'),
    obligationFigure('Paid', formatMoney(obligation.paid_amount, obligation.currency), 'owl-ledger-figure-money owl-ledger-figure-emerald'),
    obligationFigure('Remaining', formatMoney(obligation.remaining_amount, obligation.currency), `owl-ledger-figure-money ${obligation.remaining_amount > 0 ? 'owl-ledger-figure-risk' : 'owl-ledger-figure-emerald'}`),
  ]

  const basisLines: ReactNode[] = [
    basisLine('Period', `${obligation.period_start} → ${obligation.period_end}`),
    basisLine('Status', obligation.status),
    obligation.shariah_status === undefined
      ? null
      : basisLine('Shariah', `${obligation.shariah_status}${obligation.shariah_policy_basis === undefined ? '' : ` (${obligation.shariah_policy_basis})`}`),
    obligation.accounting_nav === undefined
      ? null
      : basisLine('Accounting', `Snapshot ${obligation.accounting_snapshot_id ?? 'unknown'} NAV: ${formatMoney(obligation.accounting_nav, obligation.currency)}`),
    obligation.accounting_holding_value === undefined
      ? null
      : basisLine('Holding value', formatMoney(obligation.accounting_holding_value, obligation.currency)),
    obligation.dividend_income_amount === undefined || obligation.dividend_event_id === undefined
      ? null
      : basisLine('Dividend basis', `${formatMoney(obligation.dividend_income_amount, obligation.currency)} from ${obligation.dividend_event_id}`),
    obligation.impurity_rate === undefined
      ? null
      : basisLine('Impurity rate', formatPercent(obligation.impurity_rate)),
  ].filter((line) => line !== null)

  return createElement(
    'article',
    { className: 'owl-row owl-row-top', style: { gridTemplateColumns: 'minmax(0, 1fr)' } },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, holdingLabel),
      createElement(
        'div',
        { className: 'owl-ledger-line', style: { border: 0, margin: '0.35rem 0 0.65rem' } },
        ...figures,
      ),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.3rem' } },
        ...basisLines,
      ),
      createElement('p', { className: 'owl-row-title', style: { color: 'var(--owl-color-amber)', fontSize: 'var(--owl-text-sm)', margin: '0.55rem 0 0' } }, 'Payment action: record only after the user confirms an external payment'),
      obligation.audit_source_ids.length === 0
        ? createElement('p', { className: 'owl-row-helper', style: { margin: '0.5rem 0 0' } }, 'Audit/source links preview: no sources linked yet')
        : createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' } },
          createElement('span', { className: 'owl-ledger-label' }, 'Audit/source links preview'),
          ...obligation.audit_source_ids.map((id) => createElement(SourceChip, { id, key: id, label: 'Audit source' })),
        ),
    ),
  )
}

function obligationFigure(label: string, value: string, figureClass: string) {
  return createElement(
    'article',
    { className: 'owl-ledger-stat', key: label, style: { padding: '0.2rem 0' } },
    createElement('p', { className: 'owl-ledger-label' }, label),
    createElement('p', { className: `owl-ledger-figure ${figureClass}`.trim(), style: { fontSize: 'clamp(1rem, 1.6vw, 1.25rem)' } }, value),
  )
}

function basisLine(label: string, value: string) {
  return createElement(
    'p',
    { className: 'owl-row-helper', style: { color: 'var(--owl-color-text)', fontFamily: 'var(--owl-font-mono)', margin: 0 } },
    `${label}: ${value}`,
  )
}

// ── 3b. Quarterly purification statement (accrued / cumulative unpaid) ─────────

function createQuarterlyStatement(report: AppPurificationReport) {
  const statement = report.quarterly_statement
  const lines: ReactNode[] = []

  if (statement === undefined || statement.per_holding.length === 0) {
    lines.push(createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No purification accrued this quarter. On each recorded dividend, purification_due = dividend × purification_pct accrues here automatically.'))
  } else {
    for (const [currency, summary] of Object.entries(statement.summary_by_currency)) {
      lines.push(createElement('p', { className: 'owl-row-title', key: `sum_${currency}`, style: { margin: '0.2rem 0' } }, `${currency}: ${formatMoney(summary.accrued_this_period, currency)} accrued this period · ${formatMoney(summary.cumulative_unpaid, currency)} cumulative unpaid`))
    }
    for (const line of statement.per_holding) {
      lines.push(basisLine(line.ticker ?? line.holding_id, `accrued this period ${formatMoney(line.accrued_this_period, line.currency)} · cumulative unpaid ${formatMoney(line.cumulative_unpaid, line.currency)}`))
    }
  }

  const exitFinalizations = report.exit_finalizations ?? []
  if (exitFinalizations.length > 0) {
    lines.push(createElement('p', { className: 'owl-section-accent', key: 'exit_head', style: { margin: '0.6rem 0 0.2rem' } }, 'Exit finalizations'))
    for (const final of exitFinalizations) {
      lines.push(basisLine(`${final.ticker ?? final.holding_id} (closed ${final.closed_at})`, `final accrued ${formatMoney(final.final_purification_accrued, final.currency)} · remaining ${formatMoney(final.final_purification_remaining, final.currency)} · locked into post-mortem`))
    }
  }

  return createElement(
    'section',
    { 'aria-label': 'Quarterly purification statement', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Accrued / cumulative unpaid'),
    createElement('h2', { className: 'owl-section-title' }, 'Quarterly purification statement'),
    statement === undefined
      ? null
      : createElement('p', { className: 'owl-row-helper', style: { maxWidth: '60ch' } }, `Period ${statement.period_start} → ${statement.period_end}. Deterministic projection — the human authors the charitable disbursement; the ledger tracks paid vs accrued.`),
    createElement('div', { style: { display: 'grid', gap: '0.3rem' } }, ...lines),
  )
}

// ── 3c. Zakat statement (Module 8 — user-set methodology) ──────────────────────

function createZakatStatement(report: AppPurificationReport) {
  const zakat = report.zakat_statement
  if (zakat === undefined) {
    return null
  }

  return createElement(
    'section',
    { 'aria-label': 'Zakat statement', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Zakat (2.5% on a user-set base)'),
    createElement('h2', { className: 'owl-section-title' }, 'Zakat statement'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
      createElement(StatusBadge, { tone: 'compliance' }, 'Tracking aid, not a ruling or payment service'),
      createElement(StatusBadge, { tone: 'manual' }, 'User-authored methodology'),
    ),
    createElement('div', { className: 'owl-ledger-line', style: { border: 0, margin: '0.35rem 0 0.65rem' } },
      obligationFigure('Zakatable base', formatMoney(zakat.zakatable_base, zakat.currency), 'owl-ledger-figure-money'),
      obligationFigure('Rate', formatPercent(zakat.rate), ''),
      obligationFigure('Zakat due', formatMoney(zakat.zakat_due, zakat.currency), 'owl-ledger-figure-money owl-ledger-figure-risk'),
    ),
    createElement('div', { style: { display: 'grid', gap: '0.3rem' } },
      basisLine('Ḥawl date', zakat.hawl_date),
      basisLine('Base method', zakat.base_method),
      basisLine('Holdings market value', formatMoney(zakat.holdings_market_value, zakat.currency)),
      basisLine('Cash', formatMoney(zakat.cash, zakat.currency)),
    ),
    createElement('p', { className: 'owl-row-helper', style: { color: 'var(--owl-color-amber)', margin: '0.55rem 0 0' } }, 'Zakat methodology is a user-authored setting, not an Owlfolio judgment. The human authors the actual zakat payment — Owlfolio never disburses automatically.'),
  )
}

// ── 4. Evidence checklist ─────────────────────────────────────────────────────

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
    { 'aria-label': 'Purification evidence checklist', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Traceability'),
    createElement('h2', { className: 'owl-section-title' }, 'Evidence checklist'),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { maxWidth: '64ch' } },
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

// ── 5. Payment history ────────────────────────────────────────────────────────

function createPayments(payments: PurificationPaymentProjection[], obligationCount: number) {
  const emptyPaymentCopy = obligationCount === 0
    ? 'Payment action appears only after an obligation exists and the user has an external payment to record.'
    : 'No payments have been recorded for this obligation yet. Make the external payment first, then record it manually.'

  return createElement(
    'section',
    { 'aria-label': 'Purification payment history', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'You recorded'),
    createElement('h2', { className: 'owl-section-title' }, 'Payment history'),
    payments.length === 0
      ? createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No explicit purification payments have been recorded yet.'),
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, emptyPaymentCopy),
      )
      : createElement(
        'div',
        { className: 'owl-row-list' },
        ...payments.map((payment) => paymentRow(payment)),
      ),
  )
}

function paymentRow(payment: PurificationPaymentProjection) {
  return createElement(
    'div',
    { className: 'owl-row owl-row-top', key: payment.payment_id },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement(
        'p',
        { className: 'owl-row-title', style: { margin: 0 } },
        createElement('span', { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)' } }, formatMoney(payment.amount, payment.currency)),
        ` paid to ${payment.recipient}`,
      ),
      createElement('p', { className: 'owl-row-helper', style: { margin: '0.2rem 0 0' } }, `${payment.paid_at} · User-recorded payment receipt: ${payment.audit_source_ids.join(', ') || 'no receipt source linked'}`),
    ),
  )
}

// ── 6. Caveats ────────────────────────────────────────────────────────────────

function createPurificationLearnPanel(limitations: string[]) {
  return createElement(
    'details',
    { 'aria-label': 'Purification limitations', className: 'owl-section-card', style: { background: 'rgba(251, 191, 36, 0.06)', borderColor: 'rgba(251, 191, 36, 0.24)', gap: 'var(--owl-space-2)' } },
    createElement('summary', { style: { color: 'var(--owl-color-amber)', cursor: 'pointer', fontFamily: 'var(--owl-font-sans)', fontSize: 'var(--owl-text-md)', fontWeight: 750 } }, 'Learn: purification controls and caveats'),
    createElement(
      'ul',
      { className: 'owl-row-helper', style: { color: 'var(--owl-color-amber)', display: 'grid', gap: '0.4rem', margin: '0.8rem 0 0', paddingLeft: '1.25rem' } },
      ...limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
    ),
  )
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(value)
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { currency, style: 'currency' }).format(value)
}
