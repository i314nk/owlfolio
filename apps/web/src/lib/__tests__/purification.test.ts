import { describe, expect, it } from 'vitest'

import { buildPurificationObligationRecordedEvent, buildPurificationPaymentRecordedEvent } from '@owlfolio/ledger/projections/purificationProjection'

import { buildPurificationReport } from '../purification'

describe('buildPurificationReport', () => {
  it('summarizes owed, paid, and remaining purification balances from explicit events', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      shariah_evaluation_id: 'shariah_msft_june',
      accounting_snapshot_id: 'acct_2026_06',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
      source_ids: ['src_msft_10k', 'acct_2026_06'],
    })
    const payment = buildPurificationPaymentRecordedEvent({
      payment_id: 'purify_payment_msft_partial',
      obligation_id: 'purify_msft_2026_06',
      amount: 10,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
    }, {
      event_id: 'evt_purify_payment_msft_partial',
      actor_id: 'user_local',
      created_at: '2026-07-03T08:00:00.000Z',
      source_ids: ['receipt_2026_07_03'],
    })

    const report = buildPurificationReport([obligation, payment])

    expect(report.summary_cards).toEqual([
      { currency: 'USD', owed: 14.63, paid: 10, remaining: 4.63 },
    ])
    expect(report.obligations[0]).toMatchObject({
      obligation_id: 'purify_msft_2026_06',
      paid_amount: 10,
      remaining_amount: 4.63,
      status: 'partially_paid',
      audit_source_ids: ['src_msft_10k', 'acct_2026_06'],
    })
    expect(report.payments[0]).toMatchObject({
      payment_id: 'purify_payment_msft_partial',
      audit_source_ids: ['receipt_2026_07_03'],
    })
    expect(report.limitations).toContain('Payments are recorded only from explicit user-entered purification_payment_recorded ledger events; Owlfolio never marks an obligation paid automatically.')
  })
})
