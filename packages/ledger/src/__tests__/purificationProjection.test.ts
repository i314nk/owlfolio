import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  buildPurificationObligationRecordedEvent,
  buildPurificationPaymentRecordedEvent,
  projectPurificationLedger,
} from '../projections/purificationProjection'

function event(
  overrides: Partial<LedgerEventEnvelope<unknown>> & Pick<LedgerEventEnvelope<unknown>, 'event_id' | 'event_type' | 'aggregate_type' | 'aggregate_id' | 'actor_type' | 'payload' | 'created_at'>,
): LedgerEventEnvelope<unknown> {
  return {
    source_ids: [],
    schema_version: 1,
    ...overrides,
  }
}

const shariahEvaluation = event({
  event_id: 'evt_shariah_eval_msft_june',
  event_type: 'shariah_evaluation_recorded',
  aggregate_type: 'holding',
  aggregate_id: 'holding_msft_001',
  actor_type: 'provider',
  actor_id: 'mock-provider',
  payload: {
    evaluation_id: 'shariah_msft_june',
    holding_id: 'holding_msft_001',
    status: 'CONDITIONAL',
    policy_basis: 'AAOIFI',
    source_ids: ['src_msft_10k', 'src_shariah_screen'],
  },
  source_ids: ['src_msft_10k', 'src_shariah_screen'],
  created_at: '2026-06-29T12:00:00.000Z',
})

const accountingSnapshot = event({
  event_id: 'evt_acct_2026_06',
  event_type: 'accounting_snapshot_recorded',
  aggregate_type: 'accounting_snapshot',
  aggregate_id: 'acct_2026_06',
  actor_type: 'worker',
  actor_id: 'monthly-accounting-worker',
  payload: {
    snapshot_id: 'acct_2026_06',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'USD',
    nav: 2925,
    current_value: 2925,
    invested_cost_basis: 2640.3,
    unrealized_gain_loss: 284.7,
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    cash_ledger_status: 'placeholder',
    missing_valuation_holding_ids: [],
    holdings: [
      {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        currency: 'USD',
        shares: 3.25,
        cost_basis: 2640.3,
        current_value: 2925,
        unrealized_gain_loss: 284.7,
        valuation_status: 'valued',
        latest_valuation_at: '2026-06-30',
      },
    ],
    updated_at: '2026-06-30T23:59:00.000Z',
  },
  created_at: '2026-06-30T23:59:00.000Z',
})

describe('purification ledger projection', () => {
  it('records an obligation tied to Shariah evidence and accounting state without auto-marking it paid', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      reason: 'AAOIFI non-compliant income purification estimate',
      shariah_evaluation_id: 'shariah_msft_june',
      accounting_snapshot_id: 'acct_2026_06',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
      source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, accountingSnapshot, obligation])

    expect(obligation).toMatchObject({
      event_type: 'purification_obligation_recorded',
      aggregate_type: 'purification_entry',
      aggregate_id: 'purify_msft_2026_06',
      actor_type: 'worker',
      actor_id: 'purification-worker',
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 14.63, paid: 0, remaining: 14.63 },
    })
    expect(ledger.obligations).toEqual([
      expect.objectContaining({
        obligation_id: 'purify_msft_2026_06',
        holding_id: 'holding_msft_001',
        amount: 14.63,
        paid_amount: 0,
        remaining_amount: 14.63,
        status: 'unpaid',
        shariah_status: 'CONDITIONAL',
        shariah_policy_basis: 'AAOIFI',
        shariah_source_ids: ['src_msft_10k', 'src_shariah_screen'],
        accounting_snapshot_id: 'acct_2026_06',
        accounting_nav: 2925,
        accounting_holding_value: 2925,
        audit_source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06'],
      }),
    ])
  })

  it('links obligations to dividend evidence without auto-paying them', () => {
    const dividend = event({
      event_id: 'evt_dividend_msft_june',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        dividend_id: 'div_msft_2026_06',
        holding_id: 'holding_msft_001',
        cash_account_id: 'cash_usd',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
        taxable_status: 'unclassified',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_dividend_2026_06',
      holding_id: 'holding_msft_001',
      amount: 2,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      reason: 'Manual dividend impurity estimate for tracking; not a fatwa or tax calculation.',
      shariah_evaluation_id: 'shariah_msft_june',
      accounting_snapshot_id: 'acct_2026_06',
      dividend_event_id: 'evt_dividend_msft_june',
      impurity_rate: 0.05,
    }, {
      event_id: 'evt_purify_msft_dividend_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
      source_ids: ['acct_2026_06'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, accountingSnapshot, dividend, obligation])

    expect(ledger.obligations[0]).toMatchObject({
      obligation_id: 'purify_msft_dividend_2026_06',
      dividend_event_id: 'evt_dividend_msft_june',
      dividend_income_amount: 40,
      impurity_rate: 0.05,
      status: 'unpaid',
      paid_amount: 0,
      remaining_amount: 2,
      audit_source_ids: ['acct_2026_06', 'src_msft_10k', 'src_shariah_screen', 'broker_dividend_notice_2026_06'],
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 2, paid: 0, remaining: 2 },
    })
  })

  it('records explicit user payments and projects the remaining balance', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      shariah_evaluation_id: 'shariah_msft_june',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
    })
    const payment = buildPurificationPaymentRecordedEvent({
      payment_id: 'purify_payment_msft_partial',
      obligation_id: 'purify_msft_2026_06',
      amount: 10,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
      note: 'User-entered partial payment',
    }, {
      event_id: 'evt_purify_payment_msft_partial',
      actor_id: 'user_local',
      created_at: '2026-07-03T08:00:00.000Z',
      source_ids: ['receipt_2026_07_03'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, obligation, payment])

    expect(payment).toMatchObject({
      event_type: 'purification_payment_recorded',
      aggregate_type: 'purification_entry',
      aggregate_id: 'purify_msft_2026_06',
      actor_type: 'user',
      actor_id: 'user_local',
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 14.63, paid: 10, remaining: 4.63 },
    })
    expect(ledger.payments).toEqual([
      expect.objectContaining({
        payment_id: 'purify_payment_msft_partial',
        obligation_id: 'purify_msft_2026_06',
        amount: 10,
        recipient: 'Local zakat charity',
        audit_source_ids: ['receipt_2026_07_03'],
      }),
    ])
    expect(ledger.obligations[0]).toMatchObject({
      status: 'partially_paid',
      paid_amount: 10,
      remaining_amount: 4.63,
    })
  })

  it('projects fully paid obligations only after explicit user payment events cover the amount', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      shariah_evaluation_id: 'shariah_msft_june',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
    })
    const payment = buildPurificationPaymentRecordedEvent({
      payment_id: 'purify_payment_msft_final',
      obligation_id: 'purify_msft_2026_06',
      amount: 14.63,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
    }, {
      event_id: 'evt_purify_payment_msft_final',
      actor_id: 'user_local',
      created_at: '2026-07-03T08:00:00.000Z',
    })

    expect(projectPurificationLedger([shariahEvaluation, obligation]).obligations[0]).toMatchObject({
      status: 'unpaid',
      remaining_amount: 14.63,
    })
    expect(projectPurificationLedger([shariahEvaluation, obligation, payment]).obligations[0]).toMatchObject({
      status: 'paid',
      remaining_amount: 0,
    })
  })
})
