import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WatchlistPanel } from '../WatchlistPanel'
import type { AppWatchlistItem } from '../../lib/workflow'

function item(overrides: Partial<AppWatchlistItem> & { watchlist_item_id: string }): AppWatchlistItem {
  return {
    research_case_id: `case_${overrides.watchlist_item_id}`,
    strategy_id: 'buffett-munger',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_actor_type: 'provider',
    created_by_actor_id: 'research-harness',
    user_approved: false,
    ...overrides,
  } as AppWatchlistItem
}

function render(items: AppWatchlistItem[]): string {
  return renderToStaticMarkup(createElement(WatchlistPanel, { items, mode: 'personal-local' }))
}

describe('WatchlistPanel verdict-band sections', () => {
  it('splits candidates into BUY-WINDOW / WATCH-FAIR / WATCH sections by verdict state', () => {
    const html = render([
      item({ watchlist_item_id: 'w_buy', ticker: 'AAA', verdict: { state: 'BUY-WINDOW', buy_price_per_share: 100 } }),
      item({ watchlist_item_id: 'w_fair', ticker: 'BBB', verdict: { state: 'WATCH-FAIR', buy_price_per_share: 80, discount_to_fv_pct: 12 } }),
      item({ watchlist_item_id: 'w_watch', ticker: 'CCC', verdict: { state: 'WATCH', buy_price_per_share: 50 } }),
    ])
    expect(html).toContain('data-verdict-band="BUY-WINDOW"')
    expect(html).toContain('data-verdict-band="WATCH-FAIR"')
    expect(html).toContain('data-verdict-band="WATCH"')
  })

  it('renders a distance-to-buy figure and a staleness indicator per case', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_buy',
        ticker: 'AAA',
        verdict: { state: 'BUY-WINDOW', buy_price_per_share: 100, distance_to_buy_pct: -8, is_stale: false, case_updated_at: '2026-02-01T00:00:00.000Z' },
      }),
    ])
    expect(html).toContain('Distance to buy price')
    expect(html).toContain('in the buy window')
    expect(html).toContain('Staleness:')
    expect(html).toContain('Case buy price')
  })

  it('flags a stale case honestly and shows an honest "no quote" distance', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_stale',
        ticker: 'DDD',
        verdict: { state: 'WATCH', buy_price_per_share: 60, is_stale: true, case_updated_at: '2024-01-01T00:00:00.000Z' },
      }),
    ])
    expect(html).toContain('Stale (&gt;12 months since last run')
    expect(html).toContain('No live market quote')
  })

  it('places candidates with no verdict band in the unclassified section', () => {
    const html = render([item({ watchlist_item_id: 'w_none', ticker: 'EEE' })])
    expect(html).toContain('data-verdict-band="UNCLASSIFIED"')
  })

  it('labels the locked buy-below with its valuation version (provisional-MoS flag retired)', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_prov',
        ticker: 'FFF',
        locked_buy_below: 123.45,
        buy_below_valuation_version: 'valuation-2026-06-cap-1',
      }),
    ])
    // The MoS-as-price-haircut / provisional-MoS labels are retired (conservatism lives in the required gap).
    // The buy-below is the frozen price at the buy-threshold growth, carrying its valuation version.
    expect(html).toContain('Buy-below · valuation-2026-06-cap-1')
    expect(html).toContain('$123.45')
    expect(html).not.toContain('provisional MoS')
  })
})
