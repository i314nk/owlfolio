import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  CAPITAL_GAINS_PURIFICATION_DEFAULT_ENABLED,
  computeCapitalGainsPurification,
  projectExitPurificationFinalizations,
  projectQuarterlyPurificationStatement,
} from '../projections/purificationStatement'

function obligationEvent(
  overrides: {
    obligation_id: string
    holding_id: string
    ticker?: string
    amount: number
    period_end: string
    created_at?: string
  },
): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_${overrides.obligation_id}`,
    event_type: 'purification_obligation_recorded',
    aggregate_type: 'purification_entry',
    aggregate_id: overrides.obligation_id,
    actor_type: 'worker',
    actor_id: 'worker:test',
    payload: {
      obligation_id: overrides.obligation_id,
      holding_id: overrides.holding_id,
      ...(overrides.ticker === undefined ? {} : { ticker: overrides.ticker }),
      amount: overrides.amount,
      currency: 'USD',
      period_start: overrides.period_end,
      period_end: overrides.period_end,
      policy_basis: 'AAOIFI',
      policy_version: 'v1',
      calculation_method: 'dividend_ratio',
      dividend_id: `div_${overrides.obligation_id}`,
    },
    source_ids: ['src:edgar'],
    created_at: overrides.created_at ?? `${overrides.period_end}T00:00:00.000Z`,
    schema_version: 1,
  }
}

function paymentEvent(
  overrides: { payment_id: string; obligation_id: string; amount: number; paid_at: string },
): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_${overrides.payment_id}`,
    event_type: 'purification_payment_recorded',
    aggregate_type: 'purification_entry',
    aggregate_id: overrides.obligation_id,
    actor_type: 'user',
    actor_id: 'user:owner',
    payload: {
      payment_id: overrides.payment_id,
      obligation_id: overrides.obligation_id,
      amount: overrides.amount,
      currency: 'USD',
      paid_at: overrides.paid_at,
      recipient: 'Local charity',
    },
    source_ids: [],
    created_at: `${overrides.paid_at}T00:00:00.000Z`,
    schema_version: 1,
  }
}

describe('computeCapitalGainsPurification', () => {
  it('is OFF by default (no setting => zero, never accrued)', () => {
    expect(CAPITAL_GAINS_PURIFICATION_DEFAULT_ENABLED).toBe(false)
    const result = computeCapitalGainsPurification({
      realized_gain: 1000,
      purification_pct: 0.04,
    })
    expect(result.enabled).toBe(false)
    expect(result.purification_amount).toBe(0)
  })

  it('purifies realized_gain x purification_pct only when the strict setting is ON', () => {
    const result = computeCapitalGainsPurification({
      realized_gain: 1000,
      purification_pct: 0.04,
      capital_gains_purification_enabled: true,
    })
    expect(result.enabled).toBe(true)
    expect(result.purification_amount).toBe(40)
  })

  it('does not purify a realized LOSS (negative gain => zero) even when ON', () => {
    const result = computeCapitalGainsPurification({
      realized_gain: -500,
      purification_pct: 0.04,
      capital_gains_purification_enabled: true,
    })
    expect(result.purification_amount).toBe(0)
  })
})

describe('projectQuarterlyPurificationStatement', () => {
  it('reports amount accrued this period, per holding, and cumulative unpaid (accrued - paid)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // Prior quarter accrual, partially paid.
      obligationEvent({ obligation_id: 'ob1', holding_id: 'h1', ticker: 'AAA', amount: 100, period_end: '2026-03-15' }),
      paymentEvent({ payment_id: 'pay1', obligation_id: 'ob1', amount: 40, paid_at: '2026-04-01' }),
      // This quarter accruals.
      obligationEvent({ obligation_id: 'ob2', holding_id: 'h1', ticker: 'AAA', amount: 30, period_end: '2026-05-10' }),
      obligationEvent({ obligation_id: 'ob3', holding_id: 'h2', ticker: 'BBB', amount: 25, period_end: '2026-06-01' }),
    ]

    const statement = projectQuarterlyPurificationStatement(events, {
      period_start: '2026-04-01',
      period_end: '2026-06-30',
    })

    expect(statement.period_start).toBe('2026-04-01')
    expect(statement.period_end).toBe('2026-06-30')
    // Accrued THIS period only: ob2 (30) + ob3 (25) = 55.
    expect(statement.summary_by_currency.USD?.accrued_this_period).toBe(55)
    // Cumulative unpaid across ALL obligations: (100-40) + 30 + 25 = 115.
    expect(statement.summary_by_currency.USD?.cumulative_unpaid).toBe(115)

    const aaa = statement.per_holding.find((entry) => entry.holding_id === 'h1')
    expect(aaa?.accrued_this_period).toBe(30)
    expect(aaa?.cumulative_unpaid).toBe(90)
    const bbb = statement.per_holding.find((entry) => entry.holding_id === 'h2')
    expect(bbb?.accrued_this_period).toBe(25)
    expect(bbb?.cumulative_unpaid).toBe(25)
  })

  it('produces NO payment/disbursement event (statement is read-only)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      obligationEvent({ obligation_id: 'ob1', holding_id: 'h1', amount: 100, period_end: '2026-05-10' }),
    ]
    const statement = projectQuarterlyPurificationStatement(events, {
      period_start: '2026-04-01',
      period_end: '2026-06-30',
    })
    // The statement type carries no event/append surface; it is a pure projection.
    expect(Object.keys(statement)).not.toContain('events')
    expect(statement.is_observation).toBe(true)
  })
})

describe('projectExitPurificationFinalizations', () => {
  it('locks final cumulative purification for a CONDITIONAL holding on exit (holding_closed)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      {
        event_id: 'evt_open_h1',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        actor_type: 'user',
        payload: { holding_id: 'h1', ticker: 'AAA', opened_at: '2025-01-01' },
        source_ids: [],
        created_at: '2025-01-01T00:00:00.000Z',
        schema_version: 1,
      },
      obligationEvent({ obligation_id: 'ob1', holding_id: 'h1', ticker: 'AAA', amount: 100, period_end: '2025-06-15' }),
      obligationEvent({ obligation_id: 'ob2', holding_id: 'h1', ticker: 'AAA', amount: 20, period_end: '2025-09-15' }),
      paymentEvent({ payment_id: 'pay1', obligation_id: 'ob1', amount: 100, paid_at: '2025-07-01' }),
      {
        event_id: 'evt_close_h1',
        event_type: 'holding_closed',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        actor_type: 'user',
        payload: { holding_id: 'h1', closed_at: '2025-12-01' },
        source_ids: [],
        created_at: '2025-12-01T00:00:00.000Z',
        schema_version: 1,
      },
    ]

    const finalizations = projectExitPurificationFinalizations(events)
    expect(finalizations).toHaveLength(1)
    const final = finalizations[0]!
    expect(final.holding_id).toBe('h1')
    expect(final.closed_at).toBe('2025-12-01')
    expect(final.final_purification_accrued).toBe(120)
    expect(final.final_purification_paid).toBe(100)
    expect(final.final_purification_remaining).toBe(20)
    expect(final.is_finalized).toBe(true)
  })

  it('does not finalize a holding that is still open', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      {
        event_id: 'evt_open_h1',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        actor_type: 'user',
        payload: { holding_id: 'h1', opened_at: '2025-01-01' },
        source_ids: [],
        created_at: '2025-01-01T00:00:00.000Z',
        schema_version: 1,
      },
      obligationEvent({ obligation_id: 'ob1', holding_id: 'h1', amount: 100, period_end: '2025-06-15' }),
    ]
    expect(projectExitPurificationFinalizations(events)).toHaveLength(0)
  })
})
