import { describe, expect, it } from 'vitest'
import { DecisionAgentSchema } from '../researchSwarmSchemas'

// RELIGHTENED DECISION (R1): the model OWNS the valuation. The decision agent now emits proposed_buy_below
// (the price below which it would buy — recorded verbatim, NOT a derived FV) and valuation_reasoning (the
// cited owner-earnings basis + assumed growth + why it is defensible). The retired band_economics block is
// gone; valuation_reasoning is OPTIONAL so a degraded payload still flows through.
describe('DecisionAgentSchema (model proposes buy-below + cited valuation reasoning)', () => {
  const base = {
    investment_verdict: 'WATCH' as const,
    strategy_compliance: 'CONDITIONAL' as const,
    valuation_status: 'EXPENSIVE' as const,
    next_required_action: 'Await margin of safety.',
    decision_reason: 'Quality but pricey',
    thesis_summary: 'Quality compounder',
    evidence_summary: 'Covered',
    valuation_rationale: 'Elevated',
    shariah_rationale: 'No prohibited activities',
    synthesis_summary: 'All lanes reviewed',
    risks: ['Valuation risk'],
    open_questions: ['Margin of safety needed'],
    growth_assumptions: 'Two-stage DCF.',
    owner_earnings_bridge: {
      net_income: 100, depreciation_amortization: 10, maintenance_capex: 5,
      maintenance_capex_proxy_tier: '50' as const, stock_based_comp: 2,
      normalized_working_capital_change: 0, shares_outstanding: 50,
    },
    roic: 0.3,
    incremental_roic: 0.2,
    reinvestment_rate: 0.4,
    proposed_buy_below: 150,
    proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x.htm', excerpt: 'e' }],
  }

  it('requires proposed_buy_below (the model\'s buy-below number)', () => {
    const { proposed_buy_below: _omit, ...withoutBuyBelow } = base
    void _omit
    expect(DecisionAgentSchema.safeParse(withoutBuyBelow).success).toBe(false)
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.proposed_buy_below).toBe(150)
  })

  it('parses with the cited valuation_reasoning block (owner-earnings basis + assumed growth + rationale)', () => {
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      valuation_reasoning: {
        owner_earnings_basis: 'FY25 owner earnings $8.4B per the 10-K.',
        assumed_growth: 0.06,
        assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.',
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.valuation_reasoning?.assumed_growth).toBe(0.06)
    expect(parsed.success && parsed.data.valuation_reasoning?.discount_rationale).toBeUndefined()
  })

  it('carries an optional discount_rationale on valuation_reasoning', () => {
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      valuation_reasoning: {
        owner_earnings_basis: 'FY25 owner earnings per the 10-K.',
        assumed_growth: 0.18,
        assumed_growth_rationale: 'Capital-light operating leverage per the cloud segment, cited to the 10-K.',
        discount_rationale: '10% = live 10y Treasury + uniform equity premium.',
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.valuation_reasoning?.discount_rationale).toBe('10% = live 10y Treasury + uniform equity premium.')
  })

  it('valuation_reasoning is OPTIONAL — a degraded payload (buy-below only) still parses', () => {
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.valuation_reasoning).toBeUndefined()
  })
})
