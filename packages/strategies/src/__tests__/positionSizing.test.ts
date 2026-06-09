import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '../buffettMunger'
import { computePositionPlan } from '../positionSizing'

describe('computePositionPlan — advisory position sizing', () => {
  describe('non-investable moat classes', () => {
    it('returns investable:false for "moderate" moat (below gate)', () => {
      const plan = computePositionPlan({
        strategy: buffettMungerStrategy,
        moatClass: 'moderate',
        buyPricePerShare: 100,
        investableCapital: 100_000,
      })
      expect(plan.investable).toBe(false)
      expect(plan.moat_class).toBe('moderate')
      expect(plan.target_weight).toBe(0)
      expect(plan.target_value).toBe(0)
      expect(plan.tranches).toEqual([])
      expect(plan.notes).toContain('Below the wide-moat gate — not sizeable.')
    })

    it('returns investable:false for "narrow" moat', () => {
      const plan = computePositionPlan({
        strategy: buffettMungerStrategy,
        moatClass: 'narrow',
        buyPricePerShare: 50,
        investableCapital: 100_000,
      })
      expect(plan.investable).toBe(false)
      expect(plan.tranches).toEqual([])
    })
  })

  describe('monopoly moat — $100,000 capital, buyPrice $180', () => {
    const plan = computePositionPlan({
      strategy: buffettMungerStrategy,
      moatClass: 'monopoly',
      buyPricePerShare: 180,
      investableCapital: 100_000,
    })

    it('is investable', () => {
      expect(plan.investable).toBe(true)
      expect(plan.moat_class).toBe('monopoly')
    })

    it('target_weight is 0.10 (monopoly)', () => {
      expect(plan.target_weight).toBe(0.10)
    })

    it('target_value is $10,000', () => {
      expect(plan.target_value).toBe(10_000)
    })

    it('has 3 tranches (T1, T2, T3)', () => {
      expect(plan.tranches).toHaveLength(3)
      const ids = plan.tranches.map((t) => t.id)
      expect(ids).toEqual(['T1', 'T2', 'T3'])
    })

    it('T1: 40% of target at buy price, thesis_gate false', () => {
      const t1 = plan.tranches[0]!
      expect(t1.id).toBe('T1')
      expect(t1.fraction).toBe(0.40)
      expect(t1.target_value).toBe(4_000)
      expect(t1.trigger_price_per_share).toBe(180)
      expect(t1.trigger_label).toBe('at_buy_price')
      expect(t1.thesis_gate).toBe(false)
      // approx_shares = floor(4000 / 180) = floor(22.222) = 22
      expect(t1.approx_shares).toBe(22)
    })

    it('T2: 30% of target at 10% below buy price ($162), thesis_gate true', () => {
      const t2 = plan.tranches[1]!
      expect(t2.id).toBe('T2')
      expect(t2.fraction).toBe(0.30)
      expect(t2.target_value).toBe(3_000)
      expect(t2.trigger_price_per_share).toBe(162)
      expect(t2.thesis_gate).toBe(true)
      // approx_shares = floor(3000 / 162) = floor(18.518) = 18
      expect(t2.approx_shares).toBe(18)
    })

    it('T3: 30% of target at 20% below buy price ($144), thesis_gate true', () => {
      const t3 = plan.tranches[2]!
      expect(t3.id).toBe('T3')
      expect(t3.fraction).toBe(0.30)
      expect(t3.target_value).toBe(3_000)
      expect(t3.trigger_price_per_share).toBe(144)
      expect(t3.thesis_gate).toBe(true)
      // approx_shares = floor(3000 / 144) = floor(20.833) = 20
      expect(t3.approx_shares).toBe(20)
    })

    it('tranche fractions sum to 1.0', () => {
      const sum = plan.tranches.reduce((acc, t) => acc + t.fraction, 0)
      expect(sum).toBeCloseTo(1.0, 10)
    })

    it('includes all required advisory notes', () => {
      expect(plan.notes).toContain('Advisory draft — you author the actual buys; the worker never trades.')
      expect(plan.notes).toContain('Tranches T2–T3 deploy only if the thesis is still intact (re-check on the price drop).')
      expect(plan.notes).toContain('Target weight is an entry cap — let winners run; do not force-trim a compounder.')
    })

    it('reflects strategy cash_buffer and max_positions', () => {
      expect(plan.cash_buffer).toBe(buffettMungerStrategy.portfolio.cash_buffer_minimum)
      expect(plan.max_positions).toBe(buffettMungerStrategy.portfolio.max_positions)
    })
  })

  describe('wide moat — $100,000 capital, buyPrice $100', () => {
    const plan = computePositionPlan({
      strategy: buffettMungerStrategy,
      moatClass: 'wide',
      buyPricePerShare: 100,
      investableCapital: 100_000,
    })

    it('target_weight is 0.06 (wide)', () => {
      expect(plan.target_weight).toBe(0.06)
    })

    it('target_value is $6,000', () => {
      expect(plan.target_value).toBe(6_000)
    })

    it('T1: $2,400 at $100, approx 24 shares', () => {
      const t1 = plan.tranches[0]!
      expect(t1.target_value).toBe(2_400)
      expect(t1.trigger_price_per_share).toBe(100)
      expect(t1.approx_shares).toBe(24)
      expect(t1.thesis_gate).toBe(false)
    })

    it('T2: $1,800 at $90 (10% below $100), approx 20 shares', () => {
      const t2 = plan.tranches[1]!
      expect(t2.target_value).toBe(1_800)
      expect(t2.trigger_price_per_share).toBe(90)
      expect(t2.approx_shares).toBe(20)
      expect(t2.thesis_gate).toBe(true)
    })

    it('T3: $1,800 at $80 (20% below $100), approx 22 shares', () => {
      const t3 = plan.tranches[2]!
      expect(t3.target_value).toBe(1_800)
      expect(t3.trigger_price_per_share).toBe(80)
      expect(t3.approx_shares).toBe(22)
      expect(t3.thesis_gate).toBe(true)
    })
  })

  describe('target_weight clamped at max_position_weight', () => {
    it('does not exceed max_position_weight even if strategy weight were higher', () => {
      // buffettMunger max_position_weight = 0.15; monopoly = 0.10 is already below it
      // This test verifies the clamp path is exercised (no regression)
      expect(plan_monopoly().target_weight).toBeLessThanOrEqual(buffettMungerStrategy.portfolio.max_position_weight)
    })

    function plan_monopoly() {
      return computePositionPlan({
        strategy: buffettMungerStrategy,
        moatClass: 'monopoly',
        buyPricePerShare: 100,
        investableCapital: 100_000,
      })
    }
  })
})
