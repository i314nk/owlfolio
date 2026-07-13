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

describe('WatchlistPanel model-verdict sections', () => {
  it('splits candidates into BUY-WINDOW / WATCH-FAIR / WATCH sections by verdict state', () => {
    const html = render([
      item({ watchlist_item_id: 'w_buy', ticker: 'AAA', verdict: { state: 'BUY-WINDOW', proposed_buy_below: 100 } }),
      item({ watchlist_item_id: 'w_fair', ticker: 'BBB', verdict: { state: 'WATCH-FAIR', proposed_buy_below: 80 } }),
      item({ watchlist_item_id: 'w_watch', ticker: 'CCC', verdict: { state: 'WATCH', proposed_buy_below: 50 } }),
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
        verdict: { state: 'BUY-WINDOW', proposed_buy_below: 100, distance_to_buy_pct: -8, is_stale: false, case_updated_at: '2026-02-01T00:00:00.000Z' },
      }),
    ])
    expect(html).toContain('Distance to buy price')
    expect(html).toContain('in the buy zone')
    expect(html).toContain('Staleness:')
    expect(html).toContain('Buy below (computed, rule 7)')
  })

  it('renders the verdict framing: valuation status, computed buy-below, in-buy-zone, market-implied growth', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_model',
        ticker: 'GGG',
        verdict: {
          state: 'WATCH',
          valuation_status: 'EXPENSIVE',
          proposed_buy_below: 147,
          reference_fair_value: 210,
          in_buy_zone: false,
          market_implied_growth: 0.09,
        },
      }),
    ])
    expect(html).toContain('Model valuation')
    expect(html).toContain('EXPENSIVE')
    expect(html).toContain('Buy below (computed, rule 7)')
    expect(html).toContain('$147.00')
    expect(html).toContain('Buy-zone')
    expect(html).toContain('Not in the buy zone')
    expect(html).toContain('Market-implied growth')
    expect(html).toContain('9.0%')
    // forward-DCF removal: the dollar reference fair value line is gone even though the verdict carries the
    // legacy reference_fair_value: 210 (no figure, no "cross-check" label).
    expect(html).not.toContain('$210.00')
    expect(html.toLowerCase()).not.toContain('cross-check (not the decision)')
    // The retired band/gap + price-vs-FV framing is gone.
    expect(html).not.toContain('Sustainable band')
    expect(html).not.toContain('Required growth gap')
    expect(html).not.toContain('Discount to fair value')
  })

  it('renders the flag-only sanity-check as advisory annotations (never a block)', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_sanity',
        ticker: 'HHH',
        verdict: {
          state: 'WATCH',
          proposed_buy_below: 100,
          market_implied_growth: 0.12,
          sanity_flags: ['Implied growth 12% exceeds the demonstrated CAGR — implausible.'],
        },
      }),
    ])
    expect(html).toContain('Sanity-check (1)')
    expect(html).toContain('does not block the verdict')
    expect(html).toContain('Implied growth 12% exceeds the demonstrated CAGR')
  })

  it('flags a stale case honestly and shows an honest "no quote" distance', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_stale',
        ticker: 'DDD',
        verdict: { state: 'WATCH', proposed_buy_below: 60, is_stale: true, case_updated_at: '2024-01-01T00:00:00.000Z' },
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

describe('WatchlistPanel re-review launch', () => {
  it('renders the on-demand re-review launch per candidate with a research case', () => {
    const html = render([item({ watchlist_item_id: 'w_rr', ticker: 'AAA', verdict: { state: 'WATCH', proposed_buy_below: 50 } })])
    expect(html).toContain('data-testid="rereview-button"')
    expect(html).toContain('Check-in vs new filings')
  })
})
