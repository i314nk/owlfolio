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
})
