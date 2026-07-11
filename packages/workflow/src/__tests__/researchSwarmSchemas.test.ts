import { describe, expect, it } from 'vitest'
import { DecisionAgentSchema, LaneAgentSchema, RISKS_RECENCY_NOTE } from '../researchSwarmSchemas'

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
    key_wrong_assumption: 'The assumed 6% durable growth holds — if pricing power erodes the thesis breaks.',
    thesis_break_triggers: ['Gross margin falls below 40% for two consecutive quarters.'],
    margin_of_safety: {
      sources: ['price', 'moat'] as ('price' | 'moat')[],
      price_gap_reasoning: 'Price ~25% below the proposed buy-below.',
      moat_durability_reasoning: 'Grounded wide moat lets time bail out estimate error.',
      adequacy: 'adequate' as const,
      reasoning: 'Price gap and grounded moat jointly supply an adequate margin.',
    },
    proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x.htm', excerpt: 'e' }],
  }

  it('V4 — the valuation-owned fields are DROPPED: emitted values are stripped as unknown keys, and their absence parses', () => {
    // Phase 2 V4: proposed_buy_below / valuation_reasoning / valuation_status / owner_earnings_bridge
    // are OWNED by the valuation stage (ValuationReasoningAgentSchema). The monolithic schema neither
    // requires nor carries them.
    const parsed = DecisionAgentSchema.safeParse({
      ...base,
      valuation_reasoning: {
        owner_earnings_basis: 'FY25 owner earnings $8.4B per the 10-K.',
        owner_earnings_citation: 's1',
        assumed_growth: 0.06,
        assumed_growth_rationale: 'Cited.',
        assumed_growth_citation: 's1',
      },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>
      expect(data['proposed_buy_below']).toBeUndefined()
      expect(data['valuation_reasoning']).toBeUndefined()
      expect(data['valuation_status']).toBeUndefined()
      expect(data['owner_earnings_bridge']).toBeUndefined()
    }
    // And a payload WITHOUT any of them parses (they are not required).
    const { proposed_buy_below: _b, valuation_status: _v, owner_earnings_bridge: _o, ...slim } = base
    void _b; void _v; void _o
    expect(DecisionAgentSchema.safeParse(slim).success).toBe(true)
  })

  it('a payload without any valuation fields parses (V4: the stage owns them)', () => {
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && (parsed.data as Record<string, unknown>)['valuation_reasoning']).toBeUndefined()
  })

  // Margin-of-safety audit surface: the SINGLE assumption that, if wrong, breaks the thesis +
  // the observable events that would invalidate it. Both REQUIRED + substantive (.min(1)).
  it('REQUIRES key_wrong_assumption (the single assumption that, if wrong, breaks the thesis)', () => {
    const { key_wrong_assumption: _omit, ...withoutKWA } = base
    void _omit
    expect(DecisionAgentSchema.safeParse(withoutKWA).success).toBe(false)
    const empty = DecisionAgentSchema.safeParse({ ...base, key_wrong_assumption: '' })
    expect(empty.success).toBe(false)
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success && parsed.data.key_wrong_assumption).toContain('6% durable growth')
  })

  it('REQUIRES thesis_break_triggers (a non-empty array of observable invalidating events)', () => {
    const { thesis_break_triggers: _omit, ...withoutTBT } = base
    void _omit
    expect(DecisionAgentSchema.safeParse(withoutTBT).success).toBe(false)
    const emptyArray = DecisionAgentSchema.safeParse({ ...base, thesis_break_triggers: [] })
    expect(emptyArray.success).toBe(false)
    const emptyItem = DecisionAgentSchema.safeParse({ ...base, thesis_break_triggers: [''] })
    expect(emptyItem.success).toBe(false)
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success && parsed.data.thesis_break_triggers).toHaveLength(1)
  })

  // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned). The margin rests on TWO substitutable sources —
  // price gap and moat durability — with per-source reasoning + a REASONED adequacy + reasoning.
  it('REQUIRES a structured margin_of_safety (sources + adequacy + reasoning)', () => {
    const { margin_of_safety: _omit, ...withoutMos } = base
    void _omit
    expect(DecisionAgentSchema.safeParse(withoutMos).success).toBe(false)
    const parsed = DecisionAgentSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.margin_of_safety.sources).toEqual(['price', 'moat'])
      expect(parsed.data.margin_of_safety.adequacy).toBe('adequate')
      expect(parsed.data.margin_of_safety.reasoning.length).toBeGreaterThan(0)
    }
  })

  it('margin_of_safety.sources must be a non-empty subset of price|moat', () => {
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, sources: [] } }).success).toBe(false)
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, sources: ['liquidity'] } }).success).toBe(false)
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, sources: ['price'] } }).success).toBe(true)
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, sources: ['moat'] } }).success).toBe(true)
  })

  it('margin_of_safety.adequacy is one of adequate|thin|inadequate and reasoning is required', () => {
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, adequacy: 'great' } }).success).toBe(false)
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, reasoning: '' } }).success).toBe(false)
    expect(DecisionAgentSchema.safeParse({ ...base, margin_of_safety: { ...base.margin_of_safety, adequacy: 'inadequate' as const } }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------
// Recency framing (provider tree ⇄ EDGAR tree handoff): the risks lane is the "web tier" (the only
// allow_unknown lane), so it is where web/media recency could masquerade as decision-grade. This note —
// appended to the risks lane's sourceDiscipline in researchSwarm.ts — keeps both trees honest: web recency
// is best-effort COLOR; thesis-critical recency (material 8-Ks) is grounded by the EDGAR tree, not web.
// Pinned so the framing can't be silently dropped. See docs/architecture/read-source-contract.md.
// ---------------------------------------------------------------------------------------------------
describe('RISKS_RECENCY_NOTE (web tier is risk color; 8-Ks grounded by EDGAR)', () => {
  it('frames web/media recency as best-effort color, not decision-grade, and points 8-K recency at EDGAR', () => {
    // Web/media recency is COLOR, not decision-grade primary evidence.
    expect(RISKS_RECENCY_NOTE).toMatch(/color/i)
    expect(RISKS_RECENCY_NOTE).toMatch(/not decision-grade/i)
    // Thesis-critical recency (material 8-K events) is grounded by the EDGAR tree, not by web/media here.
    expect(RISKS_RECENCY_NOTE).toMatch(/8-K/)
    expect(RISKS_RECENCY_NOTE).toMatch(/EDGAR/)
    expect(RISKS_RECENCY_NOTE).toMatch(/not by web/i)
  })
})

// REGRESSION GUARD: finding_summary must NOT be placeholder-guarded at the schema level. A refine that
// rejected "..." failed the whole structured output and discarded the lane's grounded sources → the lane
// skipped (vanished) whenever the model returned a lazy placeholder. Placeholder handling lives at DISPLAY
// time (isPlaceholderLaneSummary) so the lane stays present with its sources. Do NOT re-add a schema refine.
describe('LaneAgentSchema tolerates a placeholder finding_summary (handled at display, not schema)', () => {
  const valid = { confidence: 'high' as const, caveats: ['ok'], proposed_sources: [{ source_id: 'src_1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }] }
  it('ACCEPTS a "..." finding_summary so the lane is recorded (with sources), not discarded', () => {
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: '...' }).success).toBe(true)
  })
  it('still rejects an empty finding_summary (min length 1)', () => {
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: '' }).success).toBe(false)
  })
  it('accepts real prose', () => {
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: 'Wide, durable moat.' }).success).toBe(true)
  })
})
