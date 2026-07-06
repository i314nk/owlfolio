import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectLatestPriceSnapshots } from '../projections/priceSnapshotProjection'

function snap(ticker: string, price: number, created_at: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_price_snapshot_recorded_psnap_${ticker}_${created_at}`,
    event_type: 'price_snapshot_recorded', aggregate_type: 'portfolio', aggregate_id: ticker, actor_type: 'worker',
    payload: { snapshot_id: `psnap_${ticker}_${created_at}`, ticker, price_per_share: price, currency: 'USD', as_of: created_at, source: 'yahoo', checked_at: created_at },
    source_ids: [], created_at, schema_version: 1,
  }
}
describe('projectLatestPriceSnapshots', () => {
  it('returns the newest snapshot per ticker', () => {
    const map = projectLatestPriceSnapshots([
      snap('MSFT', 400, '2026-07-01T00:00:00.000Z'),
      snap('MSFT', 420, '2026-07-05T00:00:00.000Z'),
      snap('AAPL', 200, '2026-07-05T00:00:00.000Z'),
    ])
    expect(map.get('MSFT')?.price_per_share).toBe(420)
    expect(map.get('AAPL')?.price_per_share).toBe(200)
    expect(map.get('MSFT')?.as_of).toBe('2026-07-05T00:00:00.000Z')
  })
  it('ignores non-snapshot events and returns empty for none', () => {
    expect(projectLatestPriceSnapshots([]).size).toBe(0)
  })
})
