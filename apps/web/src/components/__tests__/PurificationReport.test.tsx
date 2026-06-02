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
      audit_source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06'],
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
    expect(html).toContain('Payment action: record only after the user confirms an external payment')
    expect(html).toContain('Audit/source links preview')
    expect(html).toContain('Local zakat charity')
    expect(html).toContain('User-recorded payment receipt')
    expect(html).toContain('never marks an obligation paid automatically')
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
})
