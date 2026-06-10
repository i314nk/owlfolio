import { describe, expect, it } from 'vitest'

import { computePositionPostMortem } from '../postMortem.js'

describe('computePositionPostMortem (predicted vs realized)', () => {
  const basePredicted = {
    fair_value_per_share: 100,
    buy_price_per_share: 70, // 30% MOS
    margin_of_safety: 0.3,
    credited_g: 0.04,
    moat_class: 'wide',
  }

  it('MOS protection held: realized low stayed above the MOS-implied floor', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_1',
      holding_id: 'h_1',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66, // never breached the 70 buy price meaningfully
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
      },
    })
    // Entry discount to FV: (100-68)/100 = 0.32, which is >= the 0.30 MOS cushion.
    expect(result.mos_protection.entry_discount_to_fv).toBeCloseTo(0.32, 6)
    expect(result.mos_protection.required_mos).toBeCloseTo(0.3, 6)
    expect(result.mos_protection.held).toBe(true)
  })

  it('MOS protection failed: entry discount thinner than the required cushion', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_2',
      holding_id: 'h_2',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 85, // only 15% discount to FV, below 30% MOS
        exit_price_per_share: 60,
        lowest_price_per_share: 55,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: -2500,
        dividends_received: 0,
      },
    })
    expect(result.mos_protection.entry_discount_to_fv).toBeCloseTo(0.15, 6)
    expect(result.mos_protection.held).toBe(false)
  })

  it('credited-g vs actual: computes realized fundamental CAGR when a series is supplied', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_3',
      holding_id: 'h_3',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
        // Fundamental owner-earnings series over the hold (entry → exit fiscal years).
        fundamental_series: [
          { fiscal_year: 2022, owner_earnings: 1000 },
          { fiscal_year: 2025, owner_earnings: 1100 },
        ],
      },
    })
    expect(result.credited_g_vs_actual.computable).toBe(true)
    if (!result.credited_g_vs_actual.computable) throw new Error('expected computable')
    expect(result.credited_g_vs_actual.predicted_g).toBeCloseTo(0.04, 6)
    // (1100/1000)^(1/3) - 1 = 0.03228
    expect(result.credited_g_vs_actual.actual_g).toBeCloseTo(0.03228, 4)
  })

  it('credited-g vs actual: not-computable when no fundamental series exists', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_4',
      holding_id: 'h_4',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
      },
    })
    expect(result.credited_g_vs_actual.computable).toBe(false)
    if (result.credited_g_vs_actual.computable) throw new Error('expected not computable')
    expect(result.credited_g_vs_actual.reason).toMatch(/series|not.computable/i)
  })

  it('which lane was most wrong: derived from forecast resolutions when present', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_5',
      holding_id: 'h_5',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 50,
        lowest_price_per_share: 45,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: -1800,
        dividends_received: 0,
        forecast_resolutions: [
          { lane: 'MOAT', p: 0.85, outcome: false }, // confident & wrong → worst
          { lane: 'VALUATION', p: 0.6, outcome: true },
          { lane: 'FINANCIAL_QUALITY', p: 0.7, outcome: true },
        ],
      },
    })
    expect(result.most_wrong_lane.basis).toBe('forecast_resolutions')
    expect(result.most_wrong_lane.lane).toBe('MOAT')
  })

  it('which lane was most wrong: marked derived-from-forecasts-pending when no resolutions', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_6',
      holding_id: 'h_6',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
      },
    })
    expect(result.most_wrong_lane.basis).toBe('pending_forecast_resolutions')
    expect(result.most_wrong_lane.lane).toBeUndefined()
  })

  it('records the realized hold period and total realized P&L incl dividends', () => {
    const result = computePositionPostMortem({
      research_case_id: 'rc_7',
      holding_id: 'h_7',
      predicted: basePredicted,
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
      },
    })
    expect(result.holding_period_days).toBe(1096) // 2023-01-01 → 2026-01-01 (2024 leap)
    expect(result.total_realized_pl).toBe(3000) // 2700 + 300
  })
})
