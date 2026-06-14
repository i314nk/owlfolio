import { describe, expect, it } from 'vitest'
import { creditedGrowth, buffettMungerStrategy } from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// Buffett-Munger gap-closing Phase 1.3: ONE growth path.
// creditedGrowth now takes the demonstrated historical owner-earnings growth (the OE/share CAGR computed
// upstream) and applies ONLY: (1) a named ~20% forecasting-humility cap (single_growth_cap, PLACEHOLDER)
// and (2) an above-GDP coupling FLAG (a near-term rate materially above GDP is a moat-durability claim and
// must surface lowest-confidence). The agent may argue LOWER, never higher. No reinvestment×ROIC, no bands.
describe('creditedGrowth (Phase 1.3 — one growth path + named cap + above-GDP coupling)', () => {
  const g = (args: Parameters<typeof creditedGrowth>[1]) => creditedGrowth(buffettMungerStrategy, args)

  it('passes the demonstrated growth through unchanged when below the cap and at/below GDP', () => {
    const r = g({ demonstrated_growth: 0.02 })
    expect(r.growth).toBeCloseTo(0.02, 10)
    expect(r.above_gdp).toBe(false)
    expect(r.cap_binds).toBe(false)
  })

  it('caps at single_growth_cap (placeholder ~20%) when the demonstrated rate exceeds it; flags the bind', () => {
    const r = g({ demonstrated_growth: 0.35 })
    expect(r.growth).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10)
    expect(r.cap_binds).toBe(true)
  })

  it('flags above-GDP growth (moat-durability coupling): a rate materially above GDP is lowest-confidence', () => {
    const r = g({ demonstrated_growth: 0.12 })
    expect(r.above_gdp).toBe(true)
    expect(r.above_gdp_flag).toBeDefined()
    expect(r.above_gdp_flag).toMatch(/moat[-_ ]durability/i)
    expect(r.growth).toBeCloseTo(0.12, 10) // under the cap, so the value is unchanged — only flagged
  })

  it('does NOT flag a rate at or below GDP', () => {
    const r = g({ demonstrated_growth: VALUATION_PARAMS.gdp_growth_threshold })
    expect(r.above_gdp).toBe(false)
    expect(r.above_gdp_flag).toBeUndefined()
  })

  it('lets the agent argue LOWER (agent_proposed below demonstrated is honoured)', () => {
    const r = g({ demonstrated_growth: 0.10, agent_proposed_growth: 0.04 })
    expect(r.growth).toBeCloseTo(0.04, 10)
  })

  it('REFUSES an agent argument HIGHER than the demonstrated rate (never up)', () => {
    const r = g({ demonstrated_growth: 0.05, agent_proposed_growth: 0.15 })
    expect(r.growth).toBeCloseTo(0.05, 10) // ignored — the agent may only reduce
  })

  it('floors a negative demonstrated growth to 0 (no negative compounding credit)', () => {
    const r = g({ demonstrated_growth: -0.08 })
    expect(r.growth).toBe(0)
    expect(r.above_gdp).toBe(false)
  })

  it('treats a non-finite demonstrated growth as g=0 (fail-closed)', () => {
    const r = g({ demonstrated_growth: Number.NaN })
    expect(r.growth).toBe(0)
  })
})
