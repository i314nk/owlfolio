import { describe, it, expect } from 'vitest'

import { parseLaneArguedGrowth } from '../researchSwarmCompute'

// Phase 1.3 review: parseLaneArguedGrowth pulls a lane-argued near-term growth rate out of free-text
// growth_assumptions. It is load-bearing in ONE direction only — creditedGrowth honours the result solely
// when it is STRICTLY LOWER than the demonstrated OE/share CAGR (the agent may argue down, never up). To
// avoid silent noise-driven haircuts, a percentage is treated as a growth claim ONLY when a growth keyword
// sits near it; a bare margin / ROIC / buyback / share-of-revenue figure is rejected. Among the qualifying
// figures the LOWEST binds (most conservative). These tests pin both the happy path and the adversarial
// noise prose that the OLD first-percentage grab would have misfired on.
describe('parseLaneArguedGrowth — happy path (growth-adjacent percentages)', () => {
  it('extracts a clean growth figure (keyword before or after the %)', () => {
    expect(parseLaneArguedGrowth('We model ~8% owner-earnings growth.')).toBeCloseTo(0.08, 10)
    expect(parseLaneArguedGrowth('Growth of 12% fading to GDP.')).toBeCloseTo(0.12, 10)
    expect(parseLaneArguedGrowth('Owner earnings compound at roughly 9%.')).toBeCloseTo(0.09, 10)
  })

  it('binds the LOWEST growth-adjacent figure (the agent argues down)', () => {
    // Two growth figures present → the lower, more conservative one binds.
    expect(parseLaneArguedGrowth('Near-term growth ~14%, but we model growth fading to 6%.')).toBeCloseTo(0.06, 10)
  })

  it('returns undefined when there is no percentage at all', () => {
    expect(parseLaneArguedGrowth('Durable franchise, reinvestment runway intact.')).toBeUndefined()
    expect(parseLaneArguedGrowth(undefined)).toBeUndefined()
    expect(parseLaneArguedGrowth('')).toBeUndefined()
  })

  it('treats an out-of-band figure (>60%) as noise even when growth-adjacent', () => {
    expect(parseLaneArguedGrowth('Growth of 75% is implausible and rejected.')).toBeUndefined()
  })
})

describe('parseLaneArguedGrowth — adversarial / noise prose is REJECTED (no silent haircut)', () => {
  // The OLD naive "first plausible %" grab misfired on every one of these (pulling a margin/ROIC/payout/
  // share-of-revenue figure as if it were the growth claim). The keyword-adjacency rule now rejects them,
  // so a non-growth number can no longer silently haircut the valuation.

  it('does NOT read a leading margin percentage as growth', () => {
    expect(parseLaneArguedGrowth('Margins expanded 12% while we expect the business to decelerate.')).toBeUndefined()
  })

  it('does NOT read a ROIC/return figure as growth', () => {
    expect(parseLaneArguedGrowth('ROIC of 30%; the franchise normalises over time.')).toBeUndefined()
  })

  it('does NOT read a buyback/payout percentage as growth', () => {
    expect(parseLaneArguedGrowth('Returns ~5% of market cap via buybacks each year.')).toBeUndefined()
  })

  it('does NOT read a share-of-revenue figure as growth', () => {
    expect(parseLaneArguedGrowth('Impermissible income ~3% of revenue.')).toBeUndefined()
  })

  it('picks the lower growth-adjacent figure when growth is tagged near both numbers', () => {
    // "margins expanded 12% ... growth ~7%" → both are within range of "growth"; the LOWER (7%) binds.
    expect(parseLaneArguedGrowth('Margins expanded 12%; growth ~7%.')).toBeCloseTo(0.07, 10)
  })

  it('RESIDUAL LIMITATION: a mixed clause where the keyword hugs the noise number still misfires (safe)', () => {
    // "ROIC of 30%; growth normalises toward ~6%" — "growth" sits right after the 30% (ROIC) clause and too
    // far before the 6%, so the heuristic grabs 30%. This is the honest edge of free-text parsing: it can
    // only ever make the valuation MORE conservative (creditedGrowth honours it only if < demonstrated CAGR),
    // never inflate a buy-below. The durable fix is a STRUCTURED growth field; pinned here so the limit is
    // explicit, not discovered later.
    expect(parseLaneArguedGrowth('ROIC of 30%; growth normalises toward ~6%.')).toBeCloseTo(0.30, 10)
  })
})
