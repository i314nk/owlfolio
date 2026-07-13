import { describe, expect, it } from 'vitest'

import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'

import { enrichWatchlistItemsWithVerdict, type AppWatchlistItem } from '../workflow'

function watchlistItem(id: string, researchCaseId: string, ticker?: string): AppWatchlistItem {
  return {
    watchlist_item_id: id,
    research_case_id: researchCaseId,
    strategy_id: 'buffett-munger',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_actor_type: 'provider',
    created_by_actor_id: 'harness',
    user_approved: false,
    ...(ticker !== undefined ? { ticker } : {}),
  } as AppWatchlistItem
}

function researchCase(id: string, updatedAt: string, buyPrice: number, state: string): ResearchCaseProjection {
  return {
    research_case_id: id,
    updated_at: updatedAt,
    valuation: {
      buy_price_per_share: buyPrice,
      fair_value_per_share: buyPrice * 1.2,
      verdict_state: { state, discount_to_fv_pct: 12 },
    },
  } as unknown as ResearchCaseProjection
}

describe('enrichWatchlistItemsWithVerdict', () => {
  // OWNER-LOCKED (2026-07-14): the board displays from the LATEST non-superseded, non-archived case
  // for the TICKER — a superseding re-run must show up without relinking; the item's own
  // research_case_id stays as the frozen audit pointer.
  it('displays from the latest non-superseded case for the ticker, not the admitted-on case', () => {
    const items = [watchlistItem('w1', 'rc_old', 'VVV')]
    const oldCase = { ...researchCase('rc_old', '2026-05-01T00:00:00.000Z', 100, 'WATCH'), ticker: 'VVV', superseded: true } as unknown as ResearchCaseProjection
    const newCase = { ...researchCase('rc_new', '2026-06-01T00:00:00.000Z', 140, 'WATCH'), ticker: 'VVV' } as unknown as ResearchCaseProjection
    const [enriched] = enrichWatchlistItemsWithVerdict(items, [oldCase, newCase], new Date('2026-06-15T00:00:00.000Z'))
    expect(enriched?.verdict?.buy_price_per_share).toBe(140)
    expect(enriched?.display_research_case_id).toBe('rc_new')
    // The audit pointer is untouched.
    expect(enriched?.research_case_id).toBe('rc_old')
  })

  it('never displays from a superseded or archived case when a live one exists', () => {
    const items = [watchlistItem('w1', 'rc_old', 'VVV')]
    const archived = { ...researchCase('rc_arch', '2026-07-01T00:00:00.000Z', 999, 'WATCH'), ticker: 'VVV', archived: true } as unknown as ResearchCaseProjection
    const live = { ...researchCase('rc_live', '2026-06-01T00:00:00.000Z', 140, 'WATCH'), ticker: 'VVV' } as unknown as ResearchCaseProjection
    const [enriched] = enrichWatchlistItemsWithVerdict(items, [archived, live], new Date('2026-07-02T00:00:00.000Z'))
    expect(enriched?.verdict?.buy_price_per_share).toBe(140)
    expect(enriched?.display_research_case_id).toBe('rc_live')
  })

  it('renders a thresholdless latest analysis honestly: no verdict, the latest verdict surfaced', () => {
    const items = [watchlistItem('w1', 'rc_old', 'VVV')]
    const oldPriced = { ...researchCase('rc_old', '2026-05-01T00:00:00.000Z', 100, 'WATCH'), ticker: 'VVV', superseded: true } as unknown as ResearchCaseProjection
    const newPass = { research_case_id: 'rc_pass', ticker: 'VVV', updated_at: '2026-06-01T00:00:00.000Z', investment_verdict: 'PASS' } as unknown as ResearchCaseProjection
    const [enriched] = enrichWatchlistItemsWithVerdict(items, [oldPriced, newPass], new Date('2026-06-15T00:00:00.000Z'))
    // The superseded thresholds must NOT survive as the display.
    expect(enriched?.verdict).toBeUndefined()
    expect(enriched?.latest_analysis_verdict).toBe('PASS')
    expect(enriched?.display_research_case_id).toBe('rc_pass')
  })

  it('joins the linked research case valuation/verdict state onto the watchlist item', () => {
    const items = [watchlistItem('w1', 'rc1')]
    const cases = [researchCase('rc1', '2026-05-01T00:00:00.000Z', 100, 'BUY-WINDOW')]
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-06-01T00:00:00.000Z'))
    expect(enriched?.verdict?.state).toBe('BUY-WINDOW')
    expect(enriched?.verdict?.buy_price_per_share).toBe(100)
    expect(enriched?.verdict?.is_stale).toBe(false)
  })

  it('marks a case stale when older than the 12-month window', () => {
    const items = [watchlistItem('w1', 'rc1')]
    const cases = [researchCase('rc1', '2024-01-01T00:00:00.000Z', 100, 'WATCH')]
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-06-01T00:00:00.000Z'))
    expect(enriched?.verdict?.is_stale).toBe(true)
  })

  it('leaves the item unenriched when the linked case has no valuation buy price', () => {
    const items = [watchlistItem('w1', 'rc1')]
    const cases = [{ research_case_id: 'rc1', updated_at: '2026-05-01T00:00:00.000Z' } as unknown as ResearchCaseProjection]
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-06-01T00:00:00.000Z'))
    expect(enriched?.verdict).toBeUndefined()
  })

  it('carries the R1 model verdict framing (valuation_status, proposed buy-below, in-buy-zone, sanity flags)', () => {
    const items = [watchlistItem('w1', 'rc1')]
    const cases = [{
      research_case_id: 'rc1',
      updated_at: '2026-05-01T00:00:00.000Z',
      valuation_status: 'EXPENSIVE',
      valuation: {
        proposed_buy_below: 147,
        reference_fair_value: 210,
        in_buy_zone: false,
        market_implied_growth: 0.09,
        sanity_flags: ['Implied growth exceeds the demonstrated CAGR.'],
      },
    } as unknown as ResearchCaseProjection]
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-06-01T00:00:00.000Z'))
    expect(enriched?.verdict?.valuation_status).toBe('EXPENSIVE')
    expect(enriched?.verdict?.proposed_buy_below).toBe(147)
    expect(enriched?.verdict?.buy_price_per_share).toBe(147)
    expect(enriched?.verdict?.reference_fair_value).toBe(210)
    expect(enriched?.verdict?.in_buy_zone).toBe(false)
    expect(enriched?.verdict?.market_implied_growth).toBe(0.09)
    expect(enriched?.verdict?.sanity_flags).toEqual(['Implied growth exceeds the demonstrated CAGR.'])
  })

  it('populates market_price_per_share, distance_to_buy_pct, in_buy_zone, and price_as_of from the snapshots map', () => {
    const items = [watchlistItem('w1', 'rc1', 'MSFT')]
    const cases = [researchCase('rc1', '2026-05-01T00:00:00.000Z', 500, 'WATCH')]
    const snapshots = new Map([['MSFT', { price_per_share: 420, as_of: '2026-07-05T00:00:00.000Z' }]])
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-07-05T00:00:00.000Z'), snapshots)
    expect(enriched?.verdict?.market_price_per_share).toBe(420)
    expect(enriched?.verdict?.distance_to_buy_pct).toBeCloseTo(((420 - 500) / 500) * 100)
    expect(enriched?.verdict?.in_buy_zone).toBe(true)
    expect(enriched?.verdict?.price_as_of).toBe('2026-07-05T00:00:00.000Z')
  })

  it('leaves market price fields undefined when the snapshots map is empty (no regression)', () => {
    const items = [watchlistItem('w1', 'rc1', 'MSFT')]
    const cases = [researchCase('rc1', '2026-05-01T00:00:00.000Z', 500, 'WATCH')]
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-07-05T00:00:00.000Z'))
    expect(enriched?.verdict?.market_price_per_share).toBeUndefined()
    expect(enriched?.verdict?.distance_to_buy_pct).toBeUndefined()
    expect(enriched?.verdict?.price_as_of).toBeUndefined()
  })

  it('skips snapshot enrichment when item.ticker is undefined', () => {
    const items = [watchlistItem('w1', 'rc1')]  // no ticker
    const cases = [researchCase('rc1', '2026-05-01T00:00:00.000Z', 500, 'WATCH')]
    const snapshots = new Map([['MSFT', { price_per_share: 420, as_of: '2026-07-05T00:00:00.000Z' }]])
    const [enriched] = enrichWatchlistItemsWithVerdict(items, cases, new Date('2026-07-05T00:00:00.000Z'), snapshots)
    expect(enriched?.verdict?.market_price_per_share).toBeUndefined()
    expect(enriched?.verdict?.distance_to_buy_pct).toBeUndefined()
    expect(enriched?.verdict?.price_as_of).toBeUndefined()
  })
})
