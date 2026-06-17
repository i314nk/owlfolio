import { describe, expect, it } from 'vitest'
import { DecisionAgentSchema } from '../researchSwarmSchemas'

// The valuation lane (synthesis+decision agent) now emits a structured band_economics block: cited
// reinvestment-runway + durability evidence + a grounded sustainable-growth argument, plus an OPTIONAL
// cited capital_light_argument (the escape valve the band engine honours only when its citation is real).
describe('DecisionAgentSchema.band_economics (grounded sustainable-growth band argument)', () => {
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
    proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x.htm', excerpt: 'e' }],
  }

  it('parses with the required narrative band_economics fields (no capital_light_argument)', () => {
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      band_economics: {
        reinvestment_runway_evidence: 'Reinvestment runway sustained per 10-K segment capex.',
        durability_evidence: 'Wide moat: switching costs per 10-K.',
        sustainable_growth_argument: '8% sustainable because reinvestment 40% × 20% incremental ROIC.',
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.band_economics?.capital_light_argument).toBeUndefined()
  })

  it('carries an optional capital_light_argument (claimed_growth + citation)', () => {
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      band_economics: {
        reinvestment_runway_evidence: 'Low reinvestment; operating leverage.',
        durability_evidence: 'Network effects per 10-K.',
        sustainable_growth_argument: '12% sustainable on capital-light operating leverage.',
        capital_light_argument: { claimed_growth: 0.12, citation: 'sec_edgar_10k:Cloud segment operating margin expansion' },
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.band_economics?.capital_light_argument?.claimed_growth).toBe(0.12)
  })

  it('represents (but does not validate away) an empty-citation capital-light claim — grounding is the band engine\'s job', () => {
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      band_economics: {
        reinvestment_runway_evidence: 'r',
        durability_evidence: 'd',
        sustainable_growth_argument: 's',
        capital_light_argument: { claimed_growth: 0.20, citation: '' },
      },
    })
    // The SCHEMA carries the empty citation; the band engine (tested elsewhere) is what clamps it.
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.band_economics?.capital_light_argument?.citation).toBe('')
  })
})
