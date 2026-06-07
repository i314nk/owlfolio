import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AppPurificationReport } from '../../lib/purification'
import { PurificationReport } from '../PurificationReport'

const report: AppPurificationReport = {
  summary_cards: [{ currency: 'USD', owed: 14.63, paid: 10, remaining: 4.63 }],
  obligations: [
    {
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      recorded_at: '2026-07-01T00:05:00.000Z',
      shariah_evaluation_id: 'shariah_msft_june',
      shariah_status: 'CONDITIONAL',
      shariah_policy_basis: 'AAOIFI',
      shariah_source_ids: ['src_msft_10k', 'src_shariah_screen'],
      accounting_snapshot_id: 'acct_2026_06',
      accounting_nav: 2925,
      accounting_period_end: '2026-06-30',
      accounting_holding_value: 2925,
      dividend_event_id: 'evt_dividend_msft_june',
      dividend_income_amount: 40,
      impurity_rate: 0.05,
      audit_source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06', 'broker_dividend_notice_2026_06'],
      paid_amount: 10,
      remaining_amount: 4.63,
      status: 'partially_paid',
    },
  ],
  payments: [
    {
      payment_id: 'purify_payment_msft_partial',
      obligation_id: 'purify_msft_2026_06',
      amount: 10,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
      recorded_at: '2026-07-03T08:00:00.000Z',
      audit_source_ids: ['receipt_2026_07_03'],
    },
  ],
  limitations: [
    'Payments are recorded only from explicit user-entered purification_payment_recorded ledger events; Owlfolio never marks an obligation paid automatically.',
  ],
}

describe('PurificationReport', () => {
  it('renders owed/paid/remaining state, Shariah/accounting audit links, and payment history', () => {
    const html = renderToStaticMarkup(createElement(PurificationReport, { report }))

    expect(html).toContain('Purification ledger')
    expect(html).toContain('Purification operations cockpit')
    expect(html).toContain('Current state')
    expect(html).toContain('$4.63 remaining across 1 obligation')
    expect(html).toContain('Last automation calculation')
    expect(html).toContain('2026-07-01T00:05:00.000Z')
    expect(html).toContain('Next scheduled calculation')
    expect(html).toContain('quarterly purification review cadence')
    expect(html).toContain('Source / caveat / confidence')
    expect(html).toContain('AAOIFI-aware local ledger projection')
    expect(html).toContain('User action required')
    expect(html).toContain('Record external payment evidence for $4.63 remaining')
    expect(html).toContain('Tracking aid, not a ruling or payment service')
    expect(html).toContain('Manual payment status')
    expect(html).toContain('manual user payment tracking')
    expect(html).toContain('Owed')
    expect(html).toContain('$14.63')
    expect(html).toContain('Paid')
    expect(html).toContain('$10.00')
    expect(html).toContain('Remaining')
    expect(html).toContain('$4.63')
    expect(html).toContain('holding_msft_001')
    expect(html).toContain('CONDITIONAL')
    expect(html).toContain('AAOIFI')
    expect(html).toContain('src_msft_10k')
    expect(html).toContain('acct_2026_06')
    expect(html).toContain('NAV: $2,925.00')
    expect(html).toContain('Dividend basis: $40.00 from evt_dividend_msft_june')
    expect(html).toContain('Impurity rate: 5%')
    expect(html).toContain('broker_dividend_notice_2026_06')
    expect(html).toContain('Payment action: record only after the user confirms an external payment')
    expect(html).toContain('Audit/source links preview')
    expect(html).toContain('Evidence checklist')
    expect(html).toContain('Policy/source evidence')
    expect(html).toContain('Accounting snapshot')
    expect(html).toContain('Calculation basis linked')
    expect(html).toContain('Payment receipt')
    expect(html).toContain('receipt_2026_07_03')
    expect(html).toContain('Local zakat charity')
    expect(html).toContain('User-recorded payment receipt')
    expect(html).toContain('never marks an obligation paid automatically')
    expect(html).toContain('Learn: purification controls and caveats')
    expect(html).toContain('<summary')
    expect(html).not.toContain('#047857')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#f0fdf4')
  })

  it('renders a zero-obligation empty state with next steps and manual-payment limits', () => {
    const html = renderToStaticMarkup(createElement(PurificationReport, {
      report: {
        summary_cards: [],
        obligations: [],
        payments: [],
        limitations: [
          'Purification inputs are manual/accounting-derived placeholders until full dividend and non-compliant revenue modeling is implemented.',
        ],
      },
    }))

    expect(html).toContain('No purification obligations have been recorded yet.')
    expect(html).toContain('Create sourced obligation')
    expect(html).toContain('Link Shariah/accounting evidence')
    expect(html).toContain('Record external payment (disabled until obligation exists)')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('$0.00 owed, $0.00 paid, and $0.00 remaining until an auditable obligation exists.')
    expect(html).toContain('Next step: create a sourced obligation from Shariah/accounting evidence, then record the charity payment manually.')
    expect(html).toContain('Source/audit preview: Shariah evidence, accounting snapshot, and payment receipt links will appear here.')
    expect(html).toContain('No explicit purification payments have been recorded yet.')
    expect(html).toContain('Payment action appears only after an obligation exists and the user has an external payment to record.')
  })

  it('keeps unpaid obligations actionable without implying an automatic payment control', () => {
    const html = renderToStaticMarkup(createElement(PurificationReport, {
      report: {
        ...report,
        payments: [],
      },
    }))

    expect(html).toContain('Payment action: record only after the user confirms an external payment')
    expect(html).toContain('No payments have been recorded for this obligation yet. Make the external payment first, then record it manually.')
    expect(html).not.toContain('Payment action stays disabled in the UI until the user has an external payment to record.')
  })

  it('does not imply purification evidence is linked when obligation records lack evidence fields', () => {
    const html = renderToStaticMarkup(createElement(PurificationReport, {
      report: {
        summary_cards: [{ currency: 'USD', owed: 3.5, paid: 0, remaining: 3.5 }],
        obligations: [
          {
            obligation_id: 'purify_unlinked_2026_06',
            holding_id: 'holding_unlinked_001',
            amount: 3.5,
            currency: 'USD',
            period_start: '2026-06-01',
            period_end: '2026-06-30',
            recorded_at: '2026-07-01T00:05:00.000Z',
            shariah_source_ids: [],
            audit_source_ids: [],
            paid_amount: 0,
            remaining_amount: 3.5,
            status: 'unpaid',
          },
        ],
        payments: [],
        limitations: [],
      },
    }))

    expect(html).toContain('Policy/source evidence missing')
    expect(html).toContain('policy_source_missing')
    expect(html).toContain('Accounting snapshot missing')
    expect(html).toContain('accounting_snapshot_missing')
    expect(html).toContain('Calculation basis missing')
    expect(html).toContain('calculation_basis_missing')
    expect(html).toContain('Payment receipt missing')
    expect(html).toContain('payment_receipt_awaiting')
    expect(html).toContain('Audit link missing')
    expect(html).toContain('audit_link_missing')
    expect(html).not.toContain('linked_policy_sources')
    expect(html).not.toContain('linked_accounting_snapshot')
    expect(html).not.toContain('linked_calculation_basis')
    expect(html).not.toContain('ledger_audit_linked')
  })
})
