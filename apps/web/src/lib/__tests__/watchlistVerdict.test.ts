import { describe, expect, it } from 'vitest'

import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'

import { enrichWatchlistItemsWithVerdict, type AppWatchlistItem } from '../workflow'

function watchlistItem(id: string, researchCaseId: string): AppWatchlistItem {
  return {
    watchlist_item_id: id,
    research_case_id: researchCaseId,
    strategy_id: 'buffett-munger',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_actor_type: 'provider',
    created_by_actor_id: 'harness',
    user_approved: false,
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
})
