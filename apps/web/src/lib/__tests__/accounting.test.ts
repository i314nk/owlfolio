import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { buildAccountingSnapshotRecordedEvent, type AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import { buildMonthlyAccountingReport } from '../accounting'

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
})
