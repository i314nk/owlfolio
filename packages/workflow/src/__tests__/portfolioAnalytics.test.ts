import { describe, expect, it } from 'vitest'

import { computePortfolioAnalytics } from '../portfolioAnalytics.js'

describe('computePortfolioAnalytics (MWR + contribution + realized/unrealized)', () => {
  it('computes MWR from dated cash flows + terminal market value', () => {
    const result = computePortfolioAnalytics({
      as_of: '2026-01-01',
      cashFlows: [
        { occurred_at: '2025-01-01', amount: -1000 }, // buy
      ],
      endingMarketValue: 1100,
      positions: [],
    })
    expect(result.mwr.computable).toBe(true)
    if (!result.mwr.computable) throw new Error('expected computable mwr')
    expect(result.mwr.mwr).toBeCloseTo(0.1, 5)
  })

  it('marks MWR not-computable when there is no ending value and no inflow', () => {
    const result = computePortfolioAnalytics({
      as_of: '2026-01-01',
      cashFlows: [{ occurred_at: '2025-01-01', amount: -1000 }],
      endingMarketValue: 0,
      positions: [],
    })
    expect(result.mwr.computable).toBe(false)
  })

  it('per-position contribution sums realized + unrealized vs total cost', () => {
    const result = computePortfolioAnalytics({
      as_of: '2026-01-01',
      cashFlows: [{ occurred_at: '2025-01-01', amount: -2000 }],
      endingMarketValue: 2400,
      positions: [
        { holding_id: 'h_1', ticker: 'AAA', total_cost_basis: 1000, market_value: 1400, realized_gain_loss: 0, dividends_received: 50 },
        { holding_id: 'h_2', ticker: 'BBB', total_cost_basis: 1000, market_value: 1000, realized_gain_loss: -100, dividends_received: 0 },
      ],
    })
    const aaa = result.contributions.find((c) => c.holding_id === 'h_1')
    if (aaa === undefined) throw new Error('no AAA')
    // unrealized = 1400 - 1000 = 400; total gain = 400 + 0 + 50 = 450
    expect(aaa.unrealized_gain_loss).toBe(400)
    expect(aaa.total_gain_loss).toBe(450)

    const bbb = result.contributions.find((c) => c.holding_id === 'h_2')
    if (bbb === undefined) throw new Error('no BBB')
    expect(bbb.unrealized_gain_loss).toBe(0)
    expect(bbb.total_gain_loss).toBe(-100)
  })

  it('splits realized vs unrealized at the portfolio level', () => {
    const result = computePortfolioAnalytics({
      as_of: '2026-01-01',
      cashFlows: [{ occurred_at: '2025-01-01', amount: -2000 }],
      endingMarketValue: 2400,
      positions: [
        { holding_id: 'h_1', ticker: 'AAA', total_cost_basis: 1000, market_value: 1400, realized_gain_loss: 0, dividends_received: 50 },
        { holding_id: 'h_2', ticker: 'BBB', total_cost_basis: 1000, market_value: 1000, realized_gain_loss: -100, dividends_received: 0 },
      ],
    })
    // realized = sum(realized) + sum(dividends) = -100 + 50 = -50
    expect(result.realized_unrealized.realized_gain_loss).toBe(-50)
    // unrealized = (1400-1000) + (1000-1000) = 400
    expect(result.realized_unrealized.unrealized_gain_loss).toBe(400)
    expect(result.realized_unrealized.total_gain_loss).toBe(350)
  })

  it('contribution share of total return sums to ~100% across positions', () => {
    const result = computePortfolioAnalytics({
      as_of: '2026-01-01',
      cashFlows: [{ occurred_at: '2025-01-01', amount: -2000 }],
      endingMarketValue: 2400,
      positions: [
        { holding_id: 'h_1', ticker: 'AAA', total_cost_basis: 1000, market_value: 1400, realized_gain_loss: 0, dividends_received: 50 },
        { holding_id: 'h_2', ticker: 'BBB', total_cost_basis: 1000, market_value: 1000, realized_gain_loss: -100, dividends_received: 0 },
      ],
    })
    const total = result.contributions.reduce((sum, c) => sum + (c.contribution_share ?? 0), 0)
    expect(total).toBeCloseTo(1, 5)
  })
})
