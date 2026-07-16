/**
 * runPriceRefresh — on-demand price check unit (plan tasks 3a/3b/3c).
 * Red-green-commit per sub-task; this file grows incrementally.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { PriceSource, PriceQuote } from '../marketData'
import { runPriceRefresh } from '../priceRefresh'
import { seedConfirmedWatchlistItem, seedOpenHolding } from './priceRefreshFixtures'

// ---------------------------------------------------------------------------
// Fake price source helper
// ---------------------------------------------------------------------------

/** Build a PriceSource that returns a fixed quote for known tickers and unavailable for the rest. */
function fakePriceSource(
  prices: Record<string, number>,
  opts: { source?: string; as_of?: string; currency?: string } = {},
): PriceSource {
  const source = opts.source ?? 'fake'
  const as_of = opts.as_of ?? '2026-01-15T10:00:00.000Z'
  const currency = opts.currency ?? 'USD'
  return {
    id: source,
    async getQuote(symbol): Promise<PriceQuote> {
      const price = prices[symbol.ticker]
      if (price === undefined) {
        return { available: false, reason: 'not in fixture', source }
      }
      return { available: true, price_per_share: price, currency, as_of, source }
    },
  }
}

const NOW = new Date('2026-07-05T12:00:00.000Z')

// ---------------------------------------------------------------------------
// 3a: price snapshots + refreshed/unavailable
// ---------------------------------------------------------------------------

describe('runPriceRefresh — 3a price snapshots', () => {
  it('refreshes available ticker and marks unavailable ticker', async () => {
    const store = new InMemoryEventStore()
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })
    await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })

    const priceSource = fakePriceSource({ MSFT: 420 })
    const result = await runPriceRefresh(store, { priceSource, now: () => NOW })

    expect(result.refreshed).toEqual(['MSFT'])
    expect(result.unavailable).toEqual(['AAPL'])
  })

  it('emits one price_snapshot_recorded event for each refreshed ticker', async () => {
    const store = new InMemoryEventStore()
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })
    await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })

    const priceSource = fakePriceSource({ MSFT: 420 })
    await runPriceRefresh(store, { priceSource, now: () => NOW })

    const events = await store.list()
    const snapshots = events.filter((e) => e.event_type === 'price_snapshot_recorded')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.aggregate_id).toBe('MSFT')
    expect(snapshots[0]?.aggregate_type).toBe('portfolio')
    expect(snapshots[0]?.actor_type).toBe('worker')
    expect(snapshots[0]?.actor_id).toBe('price_refresh')
    const payload = snapshots[0]?.payload as Record<string, unknown>
    expect(payload?.['ticker']).toBe('MSFT')
    expect(payload?.['price_per_share']).toBe(420)
    expect(payload?.['currency']).toBe('USD')
    expect(payload?.['source']).toBe('fake')
  })

  it('emits no price_snapshot_recorded for unavailable tickers', async () => {
    const store = new InMemoryEventStore()
    await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })

    const priceSource = fakePriceSource({})
    await runPriceRefresh(store, { priceSource, now: () => NOW })

    const events = await store.list()
    const snapshots = events.filter((e) => e.event_type === 'price_snapshot_recorded')
    expect(snapshots).toHaveLength(0)
  })

  it('does not include confirmed watchlist tickers in unavailable when they have no price', async () => {
    const store = new InMemoryEventStore()
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })

    const priceSource = fakePriceSource({})
    const result = await runPriceRefresh(store, { priceSource, now: () => NOW })

    expect(result.unavailable).toContain('MSFT')
    expect(result.refreshed).toHaveLength(0)
  })

  it('idempotency key prevents a duplicate price_snapshot_recorded on second call', async () => {
    const store = new InMemoryEventStore()
    // buy_below high so no buy-window alert distracts; we only assert on the snapshot count.
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 300 })
    const priceSource = fakePriceSource({ MSFT: 420 })

    await runPriceRefresh(store, { priceSource, now: () => NOW })
    await runPriceRefresh(store, { priceSource, now: () => NOW })

    const events = await store.list()
    const snapshots = events.filter((e) => e.event_type === 'price_snapshot_recorded')
    expect(snapshots).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3b: watchlist buy-window alert emission
// ---------------------------------------------------------------------------

describe('runPriceRefresh — 3b watchlist buy-window alerts', () => {
  it('emits watchlist_monitor_alert_recorded and adds to buy_zone_hits when price is in buy window', async () => {
    const store = new InMemoryEventStore()
    // buy_below: 500, price: 420 → 420 ≤ 500 → buy_window_alert true
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })

    const priceSource = fakePriceSource({ MSFT: 420 })
    const result = await runPriceRefresh(store, { priceSource, now: () => NOW })

    expect(result.buy_zone_hits).toEqual(['MSFT'])

    const events = await store.list()
    const alerts = events.filter((e) => e.event_type === 'watchlist_monitor_alert_recorded')
    expect(alerts).toHaveLength(1)

    const alert = alerts[0]
    expect(alert?.aggregate_type).toBe('watchlist_item')
    expect(alert?.aggregate_id).toBe('watch_msft_fixture')
    expect(alert?.actor_type).toBe('worker')
    expect(alert?.actor_id).toBe('price_refresh')

    const payload = alert?.payload as Record<string, unknown>
    expect(payload?.['watchlist_item_id']).toBe('watch_msft_fixture')
    expect(payload?.['research_case_id']).toBe('rc_msft_fixture')
    expect(payload?.['ticker']).toBe('MSFT')
    expect(payload?.['alert_kind']).toBe('buy_window')
    expect(payload?.['buy_window_alert']).toBe(true)
    expect(payload?.['suppressed']).toBe(false)
    expect(payload?.['is_observation']).toBe(true)
    expect(payload?.['is_recommendation']).toBe(false)
    expect(typeof payload?.['discount_to_buy_pct']).toBe('number')
  })

  it('emits no alert and buy_zone_hits is empty when price is above buy_below', async () => {
    const store = new InMemoryEventStore()
    // buy_below: 300, price: 420 → 420 > 300 → not cheap, no alert
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 300 })

    const priceSource = fakePriceSource({ MSFT: 420 })
    const result = await runPriceRefresh(store, { priceSource, now: () => NOW })

    expect(result.buy_zone_hits).toEqual([])

    const events = await store.list()
    const alerts = events.filter((e) => e.event_type === 'watchlist_monitor_alert_recorded')
    expect(alerts).toHaveLength(0)
  })

  it('idempotency key prevents duplicate alert on second call', async () => {
    const store = new InMemoryEventStore()
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })
    const priceSource = fakePriceSource({ MSFT: 420 })

    await runPriceRefresh(store, { priceSource, now: () => NOW })
    await runPriceRefresh(store, { priceSource, now: () => NOW })

    const events = await store.list()
    const alerts = events.filter((e) => e.event_type === 'watchlist_monitor_alert_recorded')
    expect(alerts).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3c: holding NAV valuation
// ---------------------------------------------------------------------------

describe('runPriceRefresh — the holding-valuation leg is RETIRED (scale-down S2)', () => {
  it('records the price snapshot for a held ticker and NO holding_valuation event', async () => {
    const store = new InMemoryEventStore()
    await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })
    const result = await runPriceRefresh(store, { priceSource: fakePriceSource({ AAPL: 120 }), now: () => NOW })
    expect(result.refreshed).toContain('AAPL')
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'price_snapshot_recorded')).toBe(true)
    expect(events.some((e) => e.event_type === 'holding_valuation_recorded')).toBe(false)
  })



})
