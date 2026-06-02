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
    expect(html).toContain('Local zakat charity')
    expect(html).toContain('never marks an obligation paid automatically')
  })
})
