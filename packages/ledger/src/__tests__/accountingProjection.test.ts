import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  buildAccountingSnapshotRecordedEvent,
  projectAccountingSnapshot,
  projectRecordedAccountingSnapshots,
} from '../projections/accountingProjection'

function event(overrides: Partial<LedgerEventEnvelope<unknown>> & Pick<LedgerEventEnvelope<unknown>, 'event_id' | 'event_type' | 'aggregate_type' | 'aggregate_id' | 'actor_type' | 'payload' | 'created_at'>): LedgerEventEnvelope<unknown> {
  return {
    source_ids: [],
    schema_version: 1,
    ...overrides,
  }
}

const openedHolding = event({
  event_id: 'evt_holding_opened_cost',
  event_type: 'holding_opened',
  aggregate_type: 'holding',
  aggregate_id: 'holding_cost',
  actor_type: 'user',
  actor_id: 'user_local',
  payload: {
    holding_id: 'holding_cost',
    watchlist_item_id: 'watch_cost',
    research_case_id: 'rc_cost',
    ticker: 'COST',
    shares: 2,
    cost_basis_per_share: 100,
    total_cost_basis: 200,
    currency: 'USD',
    opened_at: '2026-05-31',
  },
  created_at: '2026-05-31T12:00:00.000Z',
})

describe('accounting snapshot projection', () => {
  it('projects monthly NAV, current value, and unrealized P&L from holding valuations', () => {
    const snapshot = projectAccountingSnapshot([
      openedHolding,
      event({
        event_id: 'evt_holding_valuation_cost_june',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          snapshot_id: 'valuation_cost_june',
          holding_id: 'holding_cost',
          price_per_share: 125,
          shares: 2,
          market_value: 250,
          currency: 'USD',
          valued_at: '2026-06-30',
          valuation_source: 'manual',
        },
        created_at: '2026-06-30T12:00:00.000Z',
      }),
    ], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot).toMatchObject({
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      nav: 250,
      current_value: 250,
      invested_cost_basis: 200,
      unrealized_gain_loss: 50,
      cash_balance: 0,
      deposits: 0,
      withdrawals: 0,
      cash_ledger_status: 'placeholder',
      missing_valuation_holding_ids: [],
      holdings: [
        {
          holding_id: 'holding_cost',
          ticker: 'COST',
          cost_basis: 200,
          current_value: 250,
          unrealized_gain_loss: 50,
          valuation_status: 'valued',
        },
      ],
    })
  })

  it('keeps holdings with missing valuations out of current value while surfacing the gap', () => {
    const snapshot = projectAccountingSnapshot([openedHolding], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot).toMatchObject({
      nav: 0,
      current_value: 0,
      invested_cost_basis: 200,
      unrealized_gain_loss: 0,
      missing_valuation_holding_ids: ['holding_cost'],
      holdings: [
        {
          holding_id: 'holding_cost',
          ticker: 'COST',
          cost_basis: 200,
          valuation_status: 'missing_valuation',
        },
      ],
    })
    expect(snapshot.holdings[0]).not.toHaveProperty('current_value')
    expect(snapshot.holdings[0]).not.toHaveProperty('unrealized_gain_loss')
  })

  it('uses valuation state as of period end, not future valuation snapshots', () => {
    const snapshot = projectAccountingSnapshot([
      openedHolding,
      event({
        event_id: 'evt_holding_valuation_cost_june',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          snapshot_id: 'valuation_cost_june',
          holding_id: 'holding_cost',
          price_per_share: 125,
          shares: 2,
          market_value: 250,
          currency: 'USD',
          valued_at: '2026-06-30',
          valuation_source: 'manual',
        },
        created_at: '2026-06-30T12:00:00.000Z',
      }),
      event({
        event_id: 'evt_holding_valuation_cost_july',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          snapshot_id: 'valuation_cost_july',
          holding_id: 'holding_cost',
          price_per_share: 150,
          shares: 2,
          market_value: 300,
          currency: 'USD',
          valued_at: '2026-07-15',
          valuation_source: 'manual',
        },
        created_at: '2026-07-15T12:00:00.000Z',
      }),
    ], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot).toMatchObject({
      nav: 250,
      current_value: 250,
      unrealized_gain_loss: 50,
      holdings: [
        {
          holding_id: 'holding_cost',
          current_value: 250,
          latest_valuation_at: '2026-06-30',
        },
      ],
    })
  })

  it('projects period-bounded cash, dividend, and fee ledger events into NAV without future leakage', () => {
    const snapshot = projectAccountingSnapshot([
      openedHolding,
      event({
        event_id: 'evt_cash_deposit_may',
        event_type: 'cash_deposited',
        aggregate_type: 'cash_account',
        aggregate_id: 'cash_usd',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          cash_account_id: 'cash_usd',
          amount: 1000,
          currency: 'USD',
          deposited_at: '2026-05-20',
        },
        created_at: '2026-05-20T09:00:00.000Z',
      }),
      event({
        event_id: 'evt_cash_deposit_june',
        event_type: 'cash_deposited',
        aggregate_type: 'cash_account',
        aggregate_id: 'cash_usd',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          cash_account_id: 'cash_usd',
          amount: 200,
          currency: 'USD',
          deposited_at: '2026-06-05',
        },
        created_at: '2026-06-05T09:00:00.000Z',
      }),
      event({
        event_id: 'evt_dividend_cost_june',
        event_type: 'dividend_income_recorded',
        aggregate_type: 'cash_account',
        aggregate_id: 'cash_usd',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          dividend_id: 'div_cost_2026_06',
          holding_id: 'holding_cost',
          cash_account_id: 'cash_usd',
          amount: 8.75,
          currency: 'USD',
          received_at: '2026-06-15',
          taxable_status: 'unclassified',
        },
        source_ids: ['broker_dividend_notice_2026_06'],
        created_at: '2026-06-15T09:00:00.000Z',
      }),
      event({
        event_id: 'evt_fee_june',
        event_type: 'fee_charged',
        aggregate_type: 'cash_account',
        aggregate_id: 'cash_usd',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          fee_id: 'fee_platform_2026_06',
          cash_account_id: 'cash_usd',
          amount: 1.25,
          currency: 'USD',
          charged_at: '2026-06-20',
          fee_type: 'platform',
        },
        created_at: '2026-06-20T09:00:00.000Z',
      }),
      event({
        event_id: 'evt_holding_valuation_cost_june',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          snapshot_id: 'valuation_cost_june',
          holding_id: 'holding_cost',
          price_per_share: 125,
          shares: 2,
          market_value: 250,
          currency: 'USD',
          valued_at: '2026-06-30',
          valuation_source: 'manual',
        },
        created_at: '2026-06-30T12:00:00.000Z',
      }),
      event({
        event_id: 'evt_dividend_cost_july',
        event_type: 'dividend_income_recorded',
        aggregate_type: 'cash_account',
        aggregate_id: 'cash_usd',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          dividend_id: 'div_cost_2026_07',
          holding_id: 'holding_cost',
          cash_account_id: 'cash_usd',
          amount: 10,
          currency: 'USD',
          received_at: '2026-07-01',
          taxable_status: 'unclassified',
        },
        created_at: '2026-07-01T09:00:00.000Z',
      }),
    ], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot).toMatchObject({
      current_value: 250,
      cash_balance: 1207.5,
      deposits: 200,
      withdrawals: 0,
      dividends: 8.75,
      fees: 1.25,
      net_cash_flow: 207.5,
      cash_ledger_status: 'ledger_backed',
      nav: 1457.5,
      cash_flows: [
        expect.objectContaining({ event_id: 'evt_cash_deposit_june', flow_type: 'deposit', amount: 200 }),
        expect.objectContaining({ event_id: 'evt_dividend_cost_june', flow_type: 'dividend', holding_id: 'holding_cost', amount: 8.75, source_ids: ['broker_dividend_notice_2026_06'] }),
        expect.objectContaining({ event_id: 'evt_fee_june', flow_type: 'fee', amount: -1.25 }),
      ],
    })
    expect(snapshot.cash_flows.map((flow) => flow.event_id)).not.toContain('evt_cash_deposit_may')
    expect(snapshot.cash_flows.map((flow) => flow.event_id)).not.toContain('evt_dividend_cost_july')
  })

  it('links valuation and realized gain/loss events as accounting audit sources with missing-data warnings', () => {
    const snapshot = projectAccountingSnapshot([
      openedHolding,
      event({
        event_id: 'evt_holding_valuation_cost_june',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'worker',
        actor_id: 'portfolio-valuation-worker',
        payload: {
          snapshot_id: 'valuation_cost_june',
          holding_id: 'holding_cost',
          price_per_share: 125,
          shares: 2,
          market_value: 250,
          currency: 'USD',
          valued_at: '2026-06-30',
          valuation_source: 'mock-local-price-feed',
          missing_data: ['stale_fx_rate'],
        },
        source_ids: ['mock-price:COST:2026-06-30'],
        created_at: '2026-06-30T12:00:00.000Z',
      }),
      event({
        event_id: 'evt_realized_gain_cost_june',
        event_type: 'holding_realized_gain_loss_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          realized_gain_loss_id: 'realized_cost_2026_06',
          holding_id: 'holding_cost',
          amount: 15.25,
          currency: 'USD',
          realized_at: '2026-06-21',
        },
        source_ids: ['broker-trade:cost-partial-sale'],
        created_at: '2026-06-21T12:00:00.000Z',
      }),
    ], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot).toMatchObject({
      realized_gain_loss: 15.25,
      audit_event_ids: ['evt_holding_opened_cost', 'evt_realized_gain_cost_june', 'evt_holding_valuation_cost_june'],
      source_ids: ['broker-trade:cost-partial-sale', 'mock-price:COST:2026-06-30'],
      missing_data_warnings: [
        {
          code: 'valuation_missing_data',
          holding_id: 'holding_cost',
          event_id: 'evt_holding_valuation_cost_june',
          message: 'COST valuation source reported missing data: stale_fx_rate',
        },
      ],
      holdings: [
        expect.objectContaining({
          holding_id: 'holding_cost',
          valuation_event_id: 'evt_holding_valuation_cost_june',
          valuation_source: 'mock-local-price-feed',
          valuation_source_ids: ['mock-price:COST:2026-06-30'],
        }),
      ],
    })
  })

  it('only surfaces missing-data warnings from the current valuation per holding', () => {
    const snapshot = projectAccountingSnapshot([
      openedHolding,
      event({
        event_id: 'evt_holding_valuation_cost_stale',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'worker',
        actor_id: 'portfolio-valuation-worker',
        payload: {
          snapshot_id: 'valuation_cost_stale',
          holding_id: 'holding_cost',
          price_per_share: 110,
          shares: 2,
          market_value: 220,
          currency: 'USD',
          valued_at: '2026-06-10',
          valuation_source: 'mock-local-price-feed',
          missing_data: ['stale_fx_rate'],
        },
        source_ids: ['mock-price:COST:2026-06-10'],
        created_at: '2026-06-10T12:00:00.000Z',
      }),
      event({
        event_id: 'evt_holding_valuation_cost_clean',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost',
        actor_type: 'worker',
        actor_id: 'portfolio-valuation-worker',
        payload: {
          snapshot_id: 'valuation_cost_clean',
          holding_id: 'holding_cost',
          price_per_share: 125,
          shares: 2,
          market_value: 250,
          currency: 'USD',
          valued_at: '2026-06-30',
          valuation_source: 'mock-local-price-feed',
        },
        source_ids: ['mock-price:COST:2026-06-30'],
        created_at: '2026-06-30T12:00:00.000Z',
      }),
    ], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot.holdings[0]).toMatchObject({
      valuation_event_id: 'evt_holding_valuation_cost_clean',
      current_value: 250,
    })
    expect(snapshot.missing_data_warnings).toEqual([])
  })

  it('normalizes legacy recorded snapshot payloads when replaying them', () => {
    const legacyRecorded = event({
      event_id: 'evt_accounting_snapshot_legacy',
      event_type: 'accounting_snapshot_recorded',
      aggregate_type: 'accounting_snapshot',
      aggregate_id: 'acct_legacy',
      actor_type: 'worker',
      actor_id: 'monthly-accounting-worker',
      payload: {
        snapshot_id: 'acct_legacy',
        period_start: '2026-05-01',
        period_end: '2026-05-31',
        currency: 'USD',
        nav: 10,
        current_value: 10,
        invested_cost_basis: 8,
        unrealized_gain_loss: 2,
        cash_balance: 0,
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
        net_cash_flow: 0,
        cash_ledger_status: 'placeholder',
        cash_flows: [],
        missing_valuation_holding_ids: [],
        holdings: [],
        updated_at: '2026-05-31T23:59:00.000Z',
      },
      created_at: '2026-05-31T23:59:00.000Z',
    })

    expect(projectRecordedAccountingSnapshots([legacyRecorded])).toEqual([
      expect.objectContaining({
        snapshot_id: 'acct_legacy',
        realized_gain_loss: 0,
        audit_event_ids: [],
        source_ids: [],
        missing_data_warnings: [],
      }),
    ])
  })

  it('records and replays accounting snapshot events without mixing purification calculations', () => {
    const snapshot = projectAccountingSnapshot([openedHolding], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })
    const recorded = buildAccountingSnapshotRecordedEvent(snapshot, {
      event_id: 'evt_accounting_snapshot_2026_06',
      actor_id: 'monthly-accounting-worker',
      created_at: '2026-06-30T23:59:00.000Z',
    })

    expect(recorded).toMatchObject({
      event_type: 'accounting_snapshot_recorded',
      aggregate_type: 'accounting_snapshot',
      aggregate_id: 'acct_2026_06',
      actor_type: 'worker',
      actor_id: 'monthly-accounting-worker',
      payload: {
        snapshot_id: 'acct_2026_06',
        nav: 0,
        current_value: 0,
        unrealized_gain_loss: 0,
        cash_balance: 0,
        deposits: 0,
        withdrawals: 0,
      },
    })
    expect(recorded.payload).not.toHaveProperty('purification_due')
    expect(recorded.payload).not.toHaveProperty('purification_paid')
    expect(projectRecordedAccountingSnapshots([recorded])).toEqual([snapshot])
  })

  it('treats idle cash as a savings_balance and surfaces an EXPECTED (not guaranteed) savings return', () => {
    const deposit = event({
      event_id: 'evt_cash_deposit_savings',
      event_type: 'cash_deposited',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        cash_account_id: 'cash_usd',
        amount: 1000,
        currency: 'USD',
        deposited_at: '2026-06-10',
      },
      created_at: '2026-06-10T09:00:00.000Z',
    })

    const snapshot = projectAccountingSnapshot([deposit], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
      // The ONE expected (not guaranteed) Mudarabah profit rate, supplied from SavingsSleeveConfig.
      savings_expected_profit_rate: 0.02,
    })

    // savings_balance is exactly the un-deployed idle cash sitting in the sleeve.
    expect(snapshot.savings_balance).toBe(1000)
    expect(snapshot.savings_balance).toBe(snapshot.cash_balance)
    // expected_savings_return = balance × rate — EXPECTED, NOT GUARANTEED.
    expect(snapshot.expected_savings_return).toEqual({
      amount: 20,
      basis: 'expected_not_guaranteed',
      rate: 0.02,
      model: 'mudarabah',
    })
  })

  it('omits expected_savings_return when no rate is supplied, but still reports savings_balance (additive, back-compat)', () => {
    const deposit = event({
      event_id: 'evt_cash_deposit_norate',
      event_type: 'cash_deposited',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: { cash_account_id: 'cash_usd', amount: 500, currency: 'USD', deposited_at: '2026-06-10' },
      created_at: '2026-06-10T09:00:00.000Z',
    })

    const snapshot = projectAccountingSnapshot([deposit], {
      snapshot_id: 'acct_2026_06',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      currency: 'USD',
      recorded_at: '2026-06-30T23:59:00.000Z',
    })

    expect(snapshot.savings_balance).toBe(500)
    expect(snapshot.expected_savings_return).toBeUndefined()
    // Existing fields unchanged.
    expect(snapshot.cash_balance).toBe(500)
    expect(snapshot.nav).toBe(500)
  })
})
