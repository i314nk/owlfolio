import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { buildAccountingSnapshotRecordedEvent, type AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import { buildMonthlyAccountingReport } from '../accounting'

function event(overrides: Partial<LedgerEventEnvelope<unknown>> & Pick<LedgerEventEnvelope<unknown>, 'event_id' | 'event_type' | 'aggregate_type' | 'aggregate_id' | 'actor_type' | 'payload' | 'created_at'>): LedgerEventEnvelope<unknown> {
  return {
    source_ids: [],
    schema_version: 1,
    ...overrides,
  }
}

function recordedSnapshot(overrides: Partial<AccountingSnapshotProjection> = {}): LedgerEventEnvelope<unknown> {
  const snapshot: AccountingSnapshotProjection = {
    snapshot_id: 'acct_2026_06_recorded',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'USD',
    nav: 2925,
    current_value: 2925,
    invested_cost_basis: 2640.3,
    unrealized_gain_loss: 284.7,
    realized_gain_loss: 0,
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    dividends: 0,
    fees: 0,
    net_cash_flow: 0,
    cash_ledger_status: 'placeholder',
    cash_flows: [],
    audit_event_ids: [],
    source_ids: [],
    missing_data_warnings: [],
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
        latest_valuation_at: '2026-06-01',
      },
    ],
    updated_at: '2026-06-30T23:59:00.000Z',
    ...overrides,
  }

  return buildAccountingSnapshotRecordedEvent(snapshot, {
    event_id: `evt_${snapshot.snapshot_id}`,
    actor_id: 'monthly-accounting-worker',
    created_at: snapshot.updated_at,
  })
}

describe('buildMonthlyAccountingReport', () => {
  it('uses a recorded current-period accounting snapshot when raw holding events are not available', () => {
    const report = buildMonthlyAccountingReport([recordedSnapshot()], {
      now: new Date('2026-06-15T12:00:00.000Z'),
    })

    expect(report.current_period_snapshot).toMatchObject({
      snapshot_id: 'acct_2026_06_recorded',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      nav: 2925,
      current_value: 2925,
      invested_cost_basis: 2640.3,
      unrealized_gain_loss: 284.7,
      holdings: [{ holding_id: 'holding_msft_001', ticker: 'MSFT', current_value: 2925 }],
    })
    expect(report.snapshot_history.map((snapshot) => snapshot.snapshot_id)).toEqual(['acct_2026_06_recorded'])
  })

  it('does not let raw events in another currency displace a recorded current-currency snapshot', () => {
    const report = buildMonthlyAccountingReport([
      recordedSnapshot(),
      event({
        event_id: 'evt_holding_opened_eur',
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_eur',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          holding_id: 'holding_eur',
          watchlist_item_id: 'watch_eur',
          research_case_id: 'rc_eur',
          ticker: 'SAP',
          shares: 1,
          cost_basis_per_share: 100,
          total_cost_basis: 100,
          currency: 'EUR',
          opened_at: '2026-06-10',
        },
        created_at: '2026-06-10T12:00:00.000Z',
      }),
    ], {
      currency: 'USD',
      now: new Date('2026-06-15T12:00:00.000Z'),
    })

    expect(report.current_period_snapshot.snapshot_id).toBe('acct_2026_06_recorded')
    expect(report.current_period_snapshot.nav).toBe(2925)
  })

  it('rebuilds the current period automatically from raw ledger events instead of preferring stale recorded snapshots', () => {
    const report = buildMonthlyAccountingReport([
      recordedSnapshot({ nav: 1, current_value: 1, updated_at: '2026-06-01T00:00:00.000Z' }),
      event({
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
      }),
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
          price_per_share: 150,
          shares: 2,
          market_value: 300,
          currency: 'USD',
          valued_at: '2026-06-15',
          valuation_source: 'mock-local-price-feed',
        },
        source_ids: ['mock-price:COST:2026-06-15'],
        created_at: '2026-06-15T12:00:00.000Z',
      }),
    ], {
      now: new Date('2026-06-20T12:00:00.000Z'),
    })

    expect(report.current_period_snapshot).toMatchObject({
      snapshot_id: 'acct_2026_06',
      nav: 300,
      current_value: 300,
      invested_cost_basis: 200,
      unrealized_gain_loss: 100,
      audit_event_ids: ['evt_holding_opened_cost', 'evt_holding_valuation_cost_june'],
      source_ids: ['mock-price:COST:2026-06-15'],
      updated_at: '2026-06-15T12:00:00.000Z',
    })
    expect(report.snapshot_history.map((snapshot) => snapshot.snapshot_id)).toEqual(['acct_2026_06', 'acct_2026_06_recorded'])
    expect(report.limitations).toContain('Accounting is rebuilt from valuation, cash-flow, dividend, fee, and realized gain/loss ledger events; manual snapshots are fallback/override audit records only.')
  })
})
