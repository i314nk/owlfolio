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

describe('WatchlistPanel zone board', () => {
  // Compact rework (owner-locked 2026-07-14): the watchlist is organized by the BOOK's zones, not the
  // verdict-state vocabulary — load-up (rule 8) → buy zone (rule 7) → above-zone waiting → unclassified.
  it('splits candidates into load-up / buy-zone / above-zone sections', () => {
    const html = render([
      item({ watchlist_item_id: 'w_load', ticker: 'AAA', verdict: { state: 'BUY-WINDOW', proposed_buy_below: 100, in_buy_zone: true, in_load_up_zone: true } }),
      item({ watchlist_item_id: 'w_buy', ticker: 'BBB', verdict: { state: 'BUY-WINDOW', proposed_buy_below: 80, in_buy_zone: true, in_load_up_zone: false } }),
      item({ watchlist_item_id: 'w_watch', ticker: 'CCC', verdict: { state: 'WATCH', proposed_buy_below: 50, in_buy_zone: false } }),
    ])
    expect(html).toContain('data-verdict-band="LOAD_UP"')
    expect(html).toContain('data-verdict-band="BUY_ZONE"')
    expect(html).toContain('data-verdict-band="ABOVE_ZONE"')
    expect(html).toContain('In the load-up zone (rule 8)')
    expect(html).toContain('In the buy zone (rule 7)')
    expect(html).toContain('Above the zone — waiting')
  })

  it('renders a compact row: the ticker links to the original analysis; the details expand', () => {
    const html = render([
      item({ watchlist_item_id: 'w_row', ticker: 'AAA', verdict: { state: 'WATCH', proposed_buy_below: 100, market_price_per_share: 130, distance_to_buy_pct: 30 } }),
    ])
    // The ticker in the summary is a link to the dossier — click-through to the original analysis.
    expect(html).toContain('href="/research/case_w_row"')
    expect(html).toContain('data-watchlist-row="AAA"')
    // The one-line summary carries only the necessary figures.
    expect(html).toContain('buy ≤ $100.00')
    expect(html).toContain('now $130.00')
    expect(html).toContain('30% ABOVE THE ZONE')
    // The heavy always-open card framing is gone.
    expect(html).not.toContain('Watchlist candidate')
    expect(html).not.toContain('Provider draft state')
  })

  it('places a priced verdict with NO legacy state in the above-zone section (new runs emit no state)', () => {
    const html = render([
      item({ watchlist_item_id: 'w_new', ticker: 'VVV', verdict: { proposed_buy_below: 280, market_price_per_share: 348.97, distance_to_buy_pct: 25, in_buy_zone: false } }),
    ])
    expect(html).toContain('data-verdict-band="ABOVE_ZONE"')
    expect(html).not.toContain('data-verdict-band="UNCLASSIFIED"')
  })

  it('sorts the above-zone section nearest-to-the-zone first', () => {
    const html = render([
      item({ watchlist_item_id: 'w_far', ticker: 'FARCO', verdict: { state: 'WATCH', proposed_buy_below: 50, distance_to_buy_pct: 40 } }),
      item({ watchlist_item_id: 'w_near', ticker: 'NEARCO', verdict: { state: 'WATCH-FAIR', proposed_buy_below: 90, distance_to_buy_pct: 5 } }),
    ])
    expect(html.indexOf('NEARCO')).toBeGreaterThan(-1)
    expect(html.indexOf('NEARCO')).toBeLessThan(html.indexOf('FARCO'))
  })

  // COMPACT REWORK (2026-07-14): the expansion is the SMALL decision card — verdict summary +
  // the shared price ladder + "Open the full analysis". The detail rows moved to the dossier.
  it('renders the price ladder in the expansion when every anchor is computable', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_ladder',
        ticker: 'AAA',
        verdict: { proposed_buy_below: 100, load_up_below: 72, intrinsic_value_per_share: 143, market_price_per_share: 130, distance_to_buy_pct: 30 },
      }),
    ])
    expect(html).toContain('data-testid="price-ladder"')
    expect(html).toContain('load up $72.00')
    expect(html).toContain('buy $100.00')
    expect(html).toContain('IV $143.00')
    expect(html).toContain('price $130.00')
    expect(html).toContain('Open the full analysis')
  })

  it('omits the ladder honestly when an anchor is missing (no partial ladders)', () => {
    const html = render([
      item({ watchlist_item_id: 'w_partial', ticker: 'BBB', verdict: { proposed_buy_below: 100, market_price_per_share: 130 } }),
    ])
    expect(html).not.toContain('data-testid="price-ladder"')
    expect(html).toContain('Open the full analysis')
  })

  it('keeps the row to the necessary figures — the detail rows live in the dossier', () => {
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
    expect(html).toContain('buy ≤ $147.00')
    // The old always-open detail rows are gone from the board.
    expect(html).not.toContain('Model valuation')
    expect(html).not.toContain('Market-implied growth')
    expect(html).not.toContain('$210.00')
    expect(html).not.toContain('Sustainable band')
  })

  it('renders "TICKER — Company Name" (title-cased, ellipsis-fitted) beside the figures', () => {
    const html = render([
      item({ watchlist_item_id: 'w_name', ticker: 'V', verdict: { proposed_buy_below: 280, market_price_per_share: 349, entity_name: 'VISA INC.' } }),
    ])
    // EDGAR's ALL-CAPS registrant renders as a readable name, joined with an em dash.
    expect(html).toContain('— Visa Inc.')
    // The figures run is one compact mono span with · separators.
    expect(html).toContain('buy ≤ $280.00 · now $349.00')
    // The name shrinks behind an ellipsis so the row never wraps it.
    expect(html).toContain('text-overflow:ellipsis')
  })

  it('does not render sanity-check annotations on the board (the dossier owns them)', () => {
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
    expect(html).not.toContain('Sanity-check (1)')
    expect(html).not.toContain('Implied growth 12% exceeds the demonstrated CAGR')
  })

  it('flags a stale case with a one-line caution in the expansion', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_stale',
        ticker: 'DDD',
        verdict: { state: 'WATCH', proposed_buy_below: 60, is_stale: true, case_updated_at: '2024-01-01T00:00:00.000Z' },
      }),
    ])
    expect(html).toContain('STALE — last run &gt;12 months ago')
  })

  it('places candidates with no verdict band in the unclassified section', () => {
    const html = render([item({ watchlist_item_id: 'w_none', ticker: 'EEE' })])
    expect(html).toContain('data-verdict-band="UNCLASSIFIED"')
  })

  it('no longer renders the locked buy-below provenance row on the board (dossier-only)', () => {
    const html = render([
      item({
        watchlist_item_id: 'w_prov',
        ticker: 'FFF',
        locked_buy_below: 123.45,
        buy_below_valuation_version: 'valuation-2026-06-cap-1',
      }),
    ])
    expect(html).not.toContain('Buy-below · valuation-2026-06-cap-1')
  })
})

describe('WatchlistPanel annual-filing alert (10-K cadence)', () => {
  it('surfaces a ticker-scoped annual_rerun alert on the row with the one-click full re-analysis', () => {
    const html = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [item({ watchlist_item_id: 'w_ann', ticker: 'V', verdict: { proposed_buy_below: 154 } })],
      mode: 'personal-local',
      alerts: [{
        id: 'annual_filing_case_w_ann_2026-11-13',
        kind: 'annual_rerun',
        subject: { ticker: 'V', research_case_id: 'case_w_ann' },
        severity: 'attention',
        headline: 'V: annual report filed (10-K, 2026-11-13)',
        detail: 'A new annual report resets the numbers this analysis stands on — a full re-analysis is recommended.',
        recorded_at: '2026-11-20T00:00:00.000Z',
        is_observation: true,
        is_draft: false,
        human_action: { label: 'Open dossier', href: '/research/case_w_ann' },
      }],
    }))
    expect(html).toContain('annual report filed')
    expect(html).toContain('data-testid="rerun-analysis-button"')
    expect(html).toContain('Run full re-analysis')
  })

  it('does not bleed a different ticker\'s annual alert onto the row', () => {
    const html = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [item({ watchlist_item_id: 'w_other', ticker: 'KO', verdict: { proposed_buy_below: 50 } })],
      mode: 'personal-local',
      alerts: [{
        id: 'annual_filing_rc_v_2026-11-13',
        kind: 'annual_rerun',
        subject: { ticker: 'V', research_case_id: 'rc_v' },
        severity: 'attention',
        headline: 'V: annual report filed (10-K, 2026-11-13)',
        detail: 'x',
        recorded_at: '2026-11-20T00:00:00.000Z',
        is_observation: true,
        is_draft: false,
        human_action: { label: 'Open dossier', href: '/research/rc_v' },
      }],
    }))
    expect(html).not.toContain('annual report filed')
  })
})

describe('WatchlistPanel re-review launch', () => {
  it('renders the on-demand re-review launch per candidate with a research case', () => {
    const html = render([item({ watchlist_item_id: 'w_rr', ticker: 'AAA', verdict: { state: 'WATCH', proposed_buy_below: 50 } })])
    expect(html).toContain('data-testid="rereview-button"')
    expect(html).toContain('Check-in vs new filings')
  })
})
