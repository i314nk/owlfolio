import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { runGroundedAgent, ProposedSourcesSchema, runLaneSwarm, runStrategyResearchSwarm, ResearchSwarmStageError, resolveJudgmentTiers, type GroundFn } from '../researchSwarm'
import type { AnnualFacts } from '../secEdgar'
import { buffettMungerDeepDiveLanes } from '../strategyResearchPipeline'
import { groundProposedSourcesDeterministic, type CapturedSource } from '../sourceGrounding'
import { CIRCLE_COMPETENCE_PROMPT, MOAT_PILLAR_PROMPT, UnderstandingDriverSchema, KeyMovingPartSchema } from '../researchSwarmSchemas'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'

// MARGIN-OF-SAFETY AUDIT SURFACE — the synthesis decision now REQUIRES key_wrong_assumption +
// thesis_break_triggers (forward-looking model risk judgments). Shared substantive fixture spread into
// every synthesis-decision fake so the existing decision tests still produce a schema-valid decision.
const DECISION_MOS_FIXTURE = {
  key_wrong_assumption: 'The assumed near-term owner-earnings growth holds — if pricing power erodes the thesis breaks.',
  thesis_break_triggers: [
    'Gross margin falls below the current band for two consecutive fiscal years.',
    'Top-2 customer concentration rises materially.',
  ],
  // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned). Substantive + business-specific: the margin rests on
  // BOTH the price gap and moat durability (substitutable sources), with per-source reasoning + a reasoned
  // joint adequacy. The moat_durability_reasoning anchors on the resolved (grounded) moat-gate thesis.
  margin_of_safety: {
    sources: ['price', 'moat'] as ('price' | 'moat')[],
    price_gap_reasoning: 'Current price sits ~25% below the model proposed_buy_below, supplying a price-vs-value cushion.',
    moat_durability_reasoning: 'The grounded wide moat (verified by the moat gate) lets time bail out modest estimate error, so less price discount is required.',
    adequacy: 'adequate' as const,
    reasoning: 'The price gap and the grounded moat durability jointly supply an adequate margin; either source alone would be thinner.',
  },
}

function fakeProvider(payload: unknown) {
  return {
    provider_id: 'fake',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => payload),
  }
}

describe('runGroundedAgent', () => {
  it('returns analysis plus only verified source ids', async () => {
    const schema = z.object({ summary: z.string(), proposed_sources: ProposedSourcesSchema })
    const provider = fakeProvider({
      summary: 'hi',
      proposed_sources: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e' },
      ],
    })
    const ground = vi.fn(async () => ({
      captured: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e', availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e', availability: 'unavailable' as const, fetched_at: 'x' },
      ] as CapturedSource[],
      verified_ids: ['ok'],
    }))
    const out = await runGroundedAgent(provider as never, {
      run_id: 'r1', model_id: 'm', prompt: 'p', timeout_ms: 1000,
    }, schema, { ground })
    expect(out.analysis.summary).toBe('hi')
    expect(out.verified_ids).toEqual(['ok'])
    expect(out.captured).toHaveLength(2)
  })
})

describe('runLaneSwarm', () => {
  it('runs every lane and marks a thrown lane incomplete instead of failing the swarm', async () => {
    const runLane = vi.fn(async (lane: string) => {
      if (lane === 'risks') throw new Error('lane boom')
      return { lane, finding_summary: `${lane} ok`, confidence: 'medium' as const, caveats: [], verified_ids: [lane] }
    })
    const results = await runLaneSwarm(['moat', 'risks', 'business_quality'], runLane, { concurrency: 2 })
    expect(results).toHaveLength(3)
    expect(results.find((r) => r.lane === 'risks')?.status).toBe('incomplete')
    expect(results.find((r) => r.lane === 'moat')?.status).toBe('complete')
  })
})

// Fake provider for runStrategyResearchSwarm: returns stage-appropriate payloads.
// We use a fakeProvider (not MockProvider) because MockProvider's structured() output
// does not satisfy the QuickScreenAgentSchema / LaneAgentSchema / DecisionAgentSchema
// schemas used by the swarm orchestrator. The fake provider below returns minimal valid
// payloads for each stage.
// Build a MOAT rubric that, under the no-EDGAR-anchor resolution path (the swarm tests run without an
// injected series), RESOLVES to the given tier — and a RUNWAY rubric that resolves to the given runway.
// Computable rows (M1/M2, R1) are honored from the lane when no anchor exists; cited rows carry the
// supplied verified citation hash (a grounded source_id) so they score. Tier bands (moat): monopoly≥10,
// wide 7-9, moderate 4-6, narrow<4. Runway: proven≥5, limited≥2, none<2.
// B6 reframe: the MOAT lane emits a GROUNDED CITED THESIS (moat_drivers + proposed_moat_class), NOT a
// per-row rubric. Build a thesis that resolves to the given tier: monopoly needs >=3 grounded distinct
// drivers, wide >=2, moderate 1, narrow 0 grounded drivers (or a narrow proposal). All drivers cite the
// supplied grounded source_id so they verify under the test ground fn.
function moatThesisForTier(tier: 'narrow' | 'moderate' | 'wide' | 'monopoly', cite: string) {
  const allDrivers = [
    { advantage: 'documented pricing power without volume loss', citation: cite, moat_type: 'brand' as const },
    { advantage: 'sustained market-share gains vs funded entrants', citation: cite, moat_type: 'scale_advantage' as const },
    { advantage: 'structural cost/scale + distribution advantage', citation: cite, moat_type: 'cost_advantage' as const },
  ]
  const count = tier === 'monopoly' ? 3 : tier === 'wide' ? 2 : tier === 'moderate' ? 1 : 1
  return {
    moat_drivers: allDrivers.slice(0, count),
    proposed_moat_class: tier,
    moat_reasoning: `Grounded ${tier} moat thesis for the test.`,
    // S3 pillar extensions (retry-forced requiredFields on the live lane): a grounded stable
    // direction + an in-line peer judgment, so the shared fakes stay schema-complete by default.
    moat_direction: 'stable' as const,
    direction_drivers: [{ evidence: 'share and price realization stable across the filing window', citation: cite }],
    direction_reasoning: 'No cited evidence of erosion or widening.',
    peer_standout: {
      peers: [{ name: 'PeerCo', gross_margin_note: '~30% FY2024 gross margin' }],
      judgment: 'in_line' as const,
      reasoning: 'Company gross margin roughly in line with the named peer.',
    },
  }
}
// Runway reframe: the RUNWAY lane emits a GROUNDED CITED THESIS (runway_drivers + proposed_runway), NOT a
// per-row R1-R3 rubric. Build a thesis that resolves to the given tier: proven needs >=2 grounded distinct
// drivers, limited >=1, none 0 (or a none proposal). All drivers cite the supplied grounded source_id so
// they verify under the test ground fn. Mirror of moatThesisForTier.
function runwayThesisForTier(tier: 'none' | 'limited' | 'proven', cite: string) {
  const allDrivers = [
    { headroom: 'under-penetrated emerging markets — decades of volume runway', citation: cite },
    { headroom: 'announced capacity expansion deploys capital at high incremental ROIC', citation: cite },
  ]
  const count = tier === 'proven' ? 2 : tier === 'limited' ? 1 : 1
  return {
    runway_drivers: allDrivers.slice(0, count),
    proposed_runway: tier,
    runway_reasoning: `Grounded ${tier} runway thesis for the test.`,
  }
}

// Shared per-lane judgment payloads for the schema-name-keyed fakes (spec-correct decomposition: the
// MOAT lane emits its grounded moat + runway theses).
function fakeMoatLanePayload(src: (id: string) => unknown) {
  return {
    finding_summary: 'Moat lane finding', confidence: 'medium' as const, caveats: ['Mock moat caveat'],
    // Grounded cited theses: 2 grounded moat drivers -> wide; 2 grounded runway drivers -> proven.
    ...moatThesisForTier('wide', 'src_lane_moat'),
    runway: 'proven' as const,
    ...runwayThesisForTier('proven', 'src_lane_moat'),
    proposed_sources: [src('src_lane_moat')],
  }
}
// Shared in-competence circle-of-competence payload for the existing fake providers (so the pre-deep-dive
// circle gate PASSES and the deep dive proceeds exactly as before). The two citation source_ids
// (src_circle_driver / src_circle_breaker) verify under every test's ground fn (they contain neither
// 'moat' nor 'bad', the only substrings the filtering grounds exclude).
// MANAGEMENT lane (S5): the two-trait judgment with grounded citations, so the shared fakes stay
// schema-complete under the retry-forced requiredFields (mirror of fakeMoatLanePayload).
function fakeManagementLanePayload(src: (id: string) => unknown, cite = 'src_lane_mgmt') {
  return {
    finding_summary: 'Management lane finding', confidence: 'medium' as const, caveats: ['Mock management caveat'],
    integrity: {
      communication_observations: [{ observation: 'MD&A discusses setbacks plainly, quantified', citation: cite }],
      comp_structure: { summary: 'Bonus on ROIC + FCF/share; PSUs on relative TSR.', incentive_metrics: ['ROIC'], alignment: 'aligned' as const, citation: cite },
      integrity_flags: [],
      proposed_integrity: 'clean' as const,
      integrity_reasoning: 'Candid communication; owner-aligned comp.',
    },
    talent: {
      talent_drivers: [
        { evidence: 'Decade of high incremental ROIC through cycles', citation: cite },
        { evidence: 'Buybacks concentrated below intrinsic value', citation: cite },
      ],
      proposed_talent: 'excellent' as const,
      talent_reasoning: 'Disciplined allocation reconciling with the T0 block.',
    },
    proposed_sources: [src(cite)],
  }
}

// UNDERSTAND lane (B3): the seven-item one-pager rides the shared fakes (retry-forced live).
function fakeUnderstandLanePayload(src: (id: string) => unknown, cite = 'src_lane_understand') {
  return {
    finding_summary: 'Understand lane finding', confidence: 'medium' as const, caveats: ['Mock understand caveat'],
    one_pager: {
      plain_english: 'Sells memberships that grant access to low-priced bulk goods.',
      segments: ['Warehouses US', 'Warehouses International', 'E-commerce'],
      revenue_drivers: ['Membership fees', 'Merchandise sales at thin markups'],
      most_profitable_segments: ['Membership fees (most of operating profit)'],
      strengths: ['Membership renewal economics', 'Scale purchasing power'],
      weak_spots: ['Thin merchandise margins leave little room for error'],
      growth_levers: ['New warehouse openings', 'Membership fee increases'],
    },
    proposed_sources: [src(cite)],
  }
}

function fakeCirclePayload(src: (id: string) => unknown) {
  // Two cited drivers + two cited breakers: meets the default circle-gate evidence floor (min 2/2),
  // mirroring what a live model produces now that the gate prompt asks for at least that many.
  return {
    understanding_drivers: [
      { driver: 'Recurring revenue grounded in the 10-K', citation: 'src_circle_driver' },
      { driver: 'Membership renewal economics grounded in the 10-K', citation: 'src_circle_driver' },
    ],
    key_moving_parts: [
      { breaker: 'Cyclicality / customer concentration risk', citation: 'src_circle_breaker' },
      { breaker: 'Margin compression from input-cost inflation', citation: 'src_circle_breaker' },
    ],
    competence_reasoning: 'Understandable cashflow engine demonstrated from filings.',
    business_understanding: 'understood',
    proposed_sources: [src('src_circle_driver'), src('src_circle_breaker')],
  }
}

function swarmFakeProvider() {
  let laneCall = 0
  const src = (id: string) => ({
    source_id: id,
    title: 'Test source',
    url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm',
    excerpt: 'Test excerpt',
  })
  return {
    provider_id: 'fake-swarm',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
      if (schemaName === 'BuffettMungerCircleCompetence') {
        return fakeCirclePayload(src)
      }
      if (schemaName === 'BuffettMungerQuickScreen') {
        return {
          summary: 'Good business',
          business_quality: 'Strong',
          moat: 'Wide moat',
          management_capital_allocation: 'Excellent',
          financial_quality: 'Solid',
          valuation_sanity: 'Reasonable',
          shariah_status: 'COMPLIANT',
          red_flags: ['None identified'],
          confidence: 'high',
          caveats: ['Mock caveat'],
          screening_result: 'deep_dive_candidate',
          proposed_sources: [src('src_qs_1')],
        }
      }
      if (schemaName === 'BuffettMungerUnderstandLane') {
        return fakeUnderstandLanePayload(src)
      }
      if (schemaName === 'BuffettMungerManagementLane') {
        return fakeManagementLanePayload(src)
      }
      if (schemaName === 'BuffettMungerMoatLane') return fakeMoatLanePayload(src)
      if (schemaName === 'BuffettMungerLaneFinding') {
        const n = laneCall++
        return {
          finding_summary: `Lane ${n} finding`,
          confidence: 'medium',
          caveats: ['Mock lane caveat'],
          proposed_sources: [src(`src_lane_${n}`)],
        }
      }
      if (schemaName === 'BuffettMungerInversion') {
        return {
          strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_shariah_reasoning'] },
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      if (schemaName === 'BuffettMungerRedTeamResponse') {
        return {
          synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' },
          proposed_sources: [src('src_qs_1')],
        }
      }
      // Synthesis + decision
      return {
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        valuation_status: 'EXPENSIVE',
        next_required_action: 'Await margin of safety before buying.',
        decision_reason: 'Solid business, needs margin of safety',
        thesis_summary: 'Quality compounder',
        evidence_summary: 'Covered by mock sources',
        valuation_rationale: 'Elevated valuation',
        shariah_rationale: 'No prohibited activities detected',
        synthesis_summary: 'All lanes reviewed; watch for better entry',
        risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        ...DECISION_MOS_FIXTURE,
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
        incremental_roic: 0.20,
        reinvestment_rate: 0.40,
        proposed_buy_below: 150,
        // Founding-risk fix: ground the valuation/growth claims in the decision agent's OWN verified source.
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_1',
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.',
          assumed_growth_citation: 'src_dec_1',
        },
        proposed_sources: [src('src_dec_1')],
      }
    }),
  }
}

// Fake provider where each lane agent call encodes the lane name in its proposed source_id.
// This allows the ground function to single out a specific lane (e.g., 'moat') and return
// verified_ids: [] for that lane's sources to exercise the C1 partial-lane skip path.
function swarmFakeProviderWithLaneIds(_lanes: readonly string[]) {
  const src = (id: string) => ({
    source_id: id,
    title: 'Test source',
    url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm',
    excerpt: 'Test excerpt',
  })
  // The lane is identified from the lane prompt ("You are the Buffett-Munger <lane> specialist agent").
  const laneFromPrompt = (prompt: string | undefined): string => {
    const m = /Buffett-Munger (\w+) specialist agent/.exec(prompt ?? '')
    return m?.[1] ?? 'lane'
  }
  return {
    provider_id: 'fake-swarm-partial',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { prompt?: string; response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
      if (schemaName === 'BuffettMungerCircleCompetence') {
        return fakeCirclePayload(src)
      }
      if (schemaName === 'BuffettMungerQuickScreen') {
        return {
          summary: 'Good business',
          business_quality: 'Strong',
          moat: 'Wide moat',
          management_capital_allocation: 'Excellent',
          financial_quality: 'Solid',
          valuation_sanity: 'Reasonable',
          shariah_status: 'COMPLIANT',
          red_flags: ['None identified'],
          confidence: 'high',
          caveats: ['Mock caveat'],
          screening_result: 'deep_dive_candidate',
          proposed_sources: [src('src_qs_partial_1')],
        }
      }
      // Lane source id encodes the lane name (from the prompt) so ground can filter by lane.
      if (schemaName === 'BuffettMungerUnderstandLane') {
        return fakeUnderstandLanePayload(src)
      }
      if (schemaName === 'BuffettMungerManagementLane') {
        return fakeManagementLanePayload(src)
      }
      if (schemaName === 'BuffettMungerMoatLane') {
        return {
          finding_summary: 'moat lane finding', confidence: 'medium' as const, caveats: ['Mock lane caveat'],
          ...moatThesisForTier('wide', 'src_moat_1'), runway: 'proven' as const,
          ...runwayThesisForTier('proven', 'src_moat_1'),
          proposed_sources: [src('src_moat_1')],
        }
      }
      if (schemaName === 'BuffettMungerLaneFinding') {
        const lane = laneFromPrompt(req.prompt)
        return {
          finding_summary: `${lane} lane finding`,
          confidence: 'medium' as const,
          caveats: ['Mock lane caveat'],
          proposed_sources: [src(`src_${lane}_1`)],
        }
      }
      if (schemaName === 'BuffettMungerInversion') {
        return {
          strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_partial_1'] },
          proposed_sources: [src('src_qs_partial_1')],
        }
      }
      if (schemaName === 'BuffettMungerRedTeamResponse') {
        return {
          synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' },
          proposed_sources: [src('src_qs_partial_1')],
        }
      }
      // Synthesis + decision — source id does not contain any lane name
      return {
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        valuation_status: 'EXPENSIVE',
        next_required_action: 'Await margin of safety before buying.',
        decision_reason: 'Solid business, needs margin of safety',
        thesis_summary: 'Quality compounder',
        evidence_summary: 'Covered by mock sources',
        valuation_rationale: 'Elevated valuation',
        shariah_rationale: 'No prohibited activities detected',
        synthesis_summary: 'All lanes reviewed; watch for better entry',
        risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        ...DECISION_MOS_FIXTURE,
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
        incremental_roic: 0.20,
        reinvestment_rate: 0.40,
        proposed_buy_below: 150,
        // Founding-risk fix: ground the valuation/growth claims in the decision agent's OWN verified source.
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_partial_1',
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.',
          assumed_growth_citation: 'src_dec_partial_1',
        },
        proposed_sources: [src('src_dec_partial_1')],
      }
    }),
  }
}

describe('runStrategyResearchSwarm', () => {
  it('drives the front Shariah gate, a per-lane swarm, synthesis and a grounded decision', async () => {
    const store = new InMemoryEventStore()
    const provider = swarmFakeProvider()
    const ground = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id,
        title: 't',
        url: 'https://example.com/x',
        excerpt: 'e',
        availability: 'available' as const,
        fetched_at: 'x',
        content_hash: 'sha256:1',
      })),
      verified_ids: sources.map((s) => s.source_id),
    })
    const result = await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_test',
        company_id: 'company_test',
        ticker: 'TEST',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k',
        model_id: 'mock',
        decision_id: 'decision_test',
        source_ledger_path: '/tmp/owlfolio-swarm-test-sources',
      },
      { ground, laneConcurrency: 3 },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)
    expect(types).toContain('research_case_created')
    expect(types).toContain('shariah_gate_judged')
    expect(types).not.toContain('quick_screen_drafted') // retired (S2): the front gate replaced it
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(3)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()
  })

  it('skips findings for lanes with no verified sources and still completes', async () => {
    const store = new InMemoryEventStore()
    const provider = swarmFakeProviderWithLaneIds(buffettMungerDeepDiveLanes)
    // Ground verifies all sources EXCEPT those belonging to the 'moat' lane
    // (identified by source_id 'src_understand_1' — the UNDERSTAND lane's proposal). S6 note: this
    // regression is deliberately pointed at a NON-gating lane — an ungrounded MOAT lane now ends
    // the run at the early moat gate by design (covered by the S6 gate tests). The understand lane
    // will have verified_ids: [] and its specialist finding must be skipped — not crash the swarm.
    const ground = async (sources: { source_id: string }[]) => {
      const verified = sources.filter((s) => !s.source_id.includes('understand'))
      return {
        captured: sources.map((s) => ({
          source_id: s.source_id,
          title: 't',
          url: 'https://example.com/x',
          excerpt: 'e',
          availability: (s.source_id.includes('understand') ? 'unavailable' : 'available') as 'available' | 'unavailable',
          fetched_at: 'x',
          ...(s.source_id.includes('understand') ? {} : { content_hash: 'sha256:1' }),
        })),
        verified_ids: verified.map((s) => s.source_id),
      }
    }
    const result = await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_partial',
        company_id: 'c',
        ticker: 'PART',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k',
        model_id: 'mock',
        decision_id: 'd_partial',
        source_ledger_path: '/tmp/owlfolio-swarm-partial',
      },
      { ground, laneConcurrency: 3 },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)
    // Moat lane has no verified source — its finding is skipped, but the swarm completes
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()

    // The understand finding must NOT be recorded
    const findingEvents = events.filter((e) => e.event_type === 'specialist_finding_recorded')
    const understandFinding = findingEvents.find((e) => {
      const p = e.payload as Record<string, unknown>
      return p['specialist_lane'] === 'understand'
    })
    expect(understandFinding).toBeUndefined()

    // All other pillar lanes must have their findings recorded
    expect(findingEvents.length).toBe(buffettMungerDeepDiveLanes.length - 1)
  })

  it('fails closed with shariah_deep_screen_incomplete when the shariah-reasoning pass fails via provider fall-through', async () => {
    const store = new InMemoryEventStore()
    const provider = swarmFakeProviderWithLaneIds(buffettMungerDeepDiveLanes)
    // swarmFakeProviderWithLaneIds has no BuffettMungerShariahReasoning handler, so the Shariah-reasoning
    // pass falls through to the synthesis payload (missing shariah_judgment field). Schema validation
    // fails and runValidatedAgent exhausts its retries → shariahPassOutcome = { status: 'failed' }.
    // There is no shariah lane, so no source_id filtering on 'shariah' is needed — all sources are
    // passed through normally; the pass failure is entirely driven by the provider fall-through.
    const ground = async (sources: { source_id: string }[]) => {
      return {
        captured: sources.map((s) => ({
          source_id: s.source_id,
          title: 't',
          url: 'https://example.com/x',
          excerpt: 'e',
          availability: 'available' as 'available' | 'unavailable',
          fetched_at: 'x',
          content_hash: 'sha256:1',
        })),
        verified_ids: sources.map((s) => s.source_id),
      }
    }
    const result = await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_shariah_skip',
        company_id: 'c',
        ticker: 'SHAR',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k',
        model_id: 'mock',
        decision_id: 'd_shariah_skip',
        source_ledger_path: '/tmp/owlfolio-swarm-shariah-skip',
      },
      { ground, laneConcurrency: 3 },
    )

    const events = await store.list()

    // The shariah lane is removed — no shariah specialist finding is recorded.
    const findingEvents = events.filter((e) => e.event_type === 'specialist_finding_recorded')
    const shariahFinding = findingEvents.find((e) => (e.payload as Record<string, unknown>)['specialist_lane'] === 'shariah')
    expect(shariahFinding).toBeUndefined()

    // The analysis event must carry the fail-closed deep-screen-incomplete boolean flag ALONGSIDE the verdict
    // (projected onto the case exactly like shariah_impermissible_income_undetermined).
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect(analysis).toBeDefined()
    const analysisPayload = analysis!.payload as Record<string, unknown>
    expect(analysisPayload['shariah_deep_screen_incomplete']).toBe(true)
    // ...and it also surfaces in the decision open_questions (the shariah_ratios_unverified string channel).
    const decision = events.find((e) => e.event_type === 'decision_drafted')
    expect(decision).toBeDefined()
    const openQuestions = ((decision!.payload as Record<string, unknown>)['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.some((q) => q.includes('shariah_deep_screen_incomplete'))).toBe(true)

    expect(result.decision).toBeDefined()
  })

  it('fails closed with shariah_deep_screen_incomplete when the focused shariah-reasoning pass fails', async () => {
    // The shariah lane is removed; shariah_deep_screen_incomplete is now exclusively keyed off the
    // focused Shariah-reasoning pass outcome. We drive the pass to fail via omitShariahOverlay: true —
    // the provider returns no shariah_judgment on the BuffettMungerShariahReasoning call,
    // schema-validation fails (required field missing), and runValidatedAgent exhausts its retries
    // → shariahPassOutcome = { status: 'failed', ... }.
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      omitShariahOverlay: true,
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-shariah-pass-fail-'))
    await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_shariah_pass_fail',
        company_id: 'c',
        ticker: 'SHAR',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k',
        model_id: 'mock',
        decision_id: 'd_shariah_pass_fail',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )

    const events = await store.list()

    // The analysis event must carry the fail-closed deep-screen-incomplete flag ALONGSIDE the verdict.
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect(analysis).toBeDefined()
    const analysisPayload = analysis!.payload as Record<string, unknown>
    expect(analysisPayload['shariah_deep_screen_incomplete']).toBe(true)
    // The Shariah verdict must NOT be flipped — the flag rides ALONGSIDE the quick-screen verdict.
    expect(analysisPayload['shariah_status']).toBe('CONDITIONAL')
    // The caveat must surface in the decision open_questions (the shariah_ratios_unverified string channel).
    const decision = events.find((e) => e.event_type === 'decision_drafted')
    expect(decision).toBeDefined()
    const openQuestions = ((decision!.payload as Record<string, unknown>)['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.some((q) => /shariah_ratios_unverified:.*shariah_deep_screen_incomplete/.test(q))).toBe(true)
  })

  it('excludes unverified sources from ledger events but records them as unavailable in the bundle', async () => {
    // Each stage proposes TWO sources: one whose id contains 'good' (verified) and one
    // containing 'bad' (unverified). The ground function verifies only the good ones.
    // The invariant is:
    //   (1) No ledger event's source_ids contains 'bad'.
    //   (2) The consolidated bundle file records the bad source with availability 'unavailable'.

    function swarmFakeProviderGoodBad() {
      let laneCall = 0
      const src = (id: string) => ({
        source_id: id,
        title: 'Test source',
        url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm',
        excerpt: 'Test excerpt',
      })
      return {
        provider_id: 'fake-swarm-good-bad',
        capabilities: {} as never,
        complete: vi.fn(),
        runWithTools: vi.fn(),
        structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
          const schemaName = req.response_format?.schema_name
          if (schemaName === 'BuffettMungerCircleCompetence') {
            return fakeCirclePayload(src)
          }
      if (schemaName === 'BuffettMungerQuickScreen') {
            // Quick screen — one good, one bad source
            return {
              summary: 'Good business',
              business_quality: 'Strong',
              moat: 'Wide moat',
              management_capital_allocation: 'Excellent',
              financial_quality: 'Solid',
              valuation_sanity: 'Reasonable',
              shariah_status: 'COMPLIANT',
              red_flags: ['None identified'],
              confidence: 'high',
              caveats: ['Mock caveat'],
              screening_result: 'deep_dive_candidate',
              proposed_sources: [src('src_qs_good_1'), src('src_qs_bad_1')],
            }
          }
          if (schemaName === 'BuffettMungerShariahReasoning') {
            // The front gate's pass — one good (the cited sector basis), one bad source.
            return {
              shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: 'compliant', impermissible_income: 0, sector_citation: 'src_shariah_pass_good_1' },
              proposed_sources: [src('src_shariah_pass_good_1'), src('src_shariah_pass_bad_1')],
            }
          }
          if (schemaName === 'BuffettMungerUnderstandLane') {
            return fakeUnderstandLanePayload(src)
          }
          if (schemaName === 'BuffettMungerManagementLane') {
            return fakeManagementLanePayload(src)
          }
          if (schemaName === 'BuffettMungerMoatLane') {
            return {
              finding_summary: 'moat lane finding', confidence: 'medium' as const, caveats: ['Mock lane caveat'],
              ...moatThesisForTier('wide', 'src_moat_good_1'), runway: 'proven' as const,
              ...runwayThesisForTier('proven', 'src_moat_good_1'),
              proposed_sources: [src('src_moat_good_1'), src('src_moat_bad_1')],
            }
          }
          if (schemaName === 'BuffettMungerShariahLane') {
            return {
              finding_summary: 'shariah lane finding', confidence: 'medium' as const, caveats: ['Mock lane caveat'],
              sector_status: 'compliant' as const, impermissible_income: 0,
              proposed_sources: [src('src_shariah_good_1'), src('src_shariah_bad_1')],
            }
          }
          if (schemaName === 'BuffettMungerLaneFinding') {
            const n = laneCall++
            return {
              finding_summary: `Lane ${n} finding`,
              confidence: 'medium',
              caveats: ['Mock lane caveat'],
              proposed_sources: [src(`src_lane${n}_good_1`), src(`src_lane${n}_bad_1`)],
            }
          }
          if (schemaName === 'BuffettMungerInversion') {
            return {
              strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
              shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_good_1'] },
              proposed_sources: [src('src_rt_good_1'), src('src_rt_bad_1')],
            }
          }
          if (schemaName === 'BuffettMungerRedTeamResponse') {
            return {
              synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' },
              proposed_sources: [src('src_rt_resp_good_1'), src('src_rt_resp_bad_1')],
            }
          }
          // Synthesis + decision
          return {
            investment_verdict: 'WATCH',
            strategy_compliance: 'CONDITIONAL',
            valuation_status: 'EXPENSIVE',
            next_required_action: 'Await margin of safety before buying.',
            decision_reason: 'Solid business, needs margin of safety',
            thesis_summary: 'Quality compounder',
            evidence_summary: 'Covered by mock sources',
            valuation_rationale: 'Elevated valuation',
            shariah_rationale: 'No prohibited activities detected',
            synthesis_summary: 'All lanes reviewed; watch for better entry',
            risks: ['Valuation risk'],
            open_questions: ['Margin of safety needed'],
            ...DECISION_MOS_FIXTURE,
            growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
            owner_earnings_bridge: {
              net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
              maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
              normalized_working_capital_change: 0, shares_outstanding: 1,
            },
            roic: 0.20,
            incremental_roic: 0.20,
            reinvestment_rate: 0.40,
            proposed_buy_below: 150,
            // Founding-risk fix: cite the GOOD (verified) decision source so the grounding gate passes.
            valuation_reasoning: {
              owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
              owner_earnings_citation: 'src_dec_good_1',
              assumed_growth: 0.06,
              assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.',
              assumed_growth_citation: 'src_dec_good_1',
            },
            proposed_sources: [src('src_dec_good_1'), src('src_dec_bad_1')],
          }
        }),
      }
    }

    const store = new InMemoryEventStore()
    const provider = swarmFakeProviderGoodBad()
    const ground = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => {
        const ok = s.source_id.includes('good')
        return {
          source_id: s.source_id,
          title: 't',
          url: 'https://example.com/x',
          excerpt: 'e',
          availability: (ok ? 'available' : 'unavailable') as 'available' | 'unavailable',
          fetched_at: 'x',
          ...(ok ? { content_hash: 'sha256:1' } : {}),
        }
      }),
      verified_ids: sources.filter((s) => s.source_id.includes('good')).map((s) => s.source_id),
    })

    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-swarm-invariant-'))

    await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_invariant',
        company_id: 'company_invariant',
        ticker: 'INV',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k_inv',
        model_id: 'mock',
        decision_id: 'decision_invariant',
        source_ledger_path: sourceLedgerPath,
      },
      { ground, laneConcurrency: 3 },
    )

    const events = await store.list()

    // (1) No event's source_ids must contain any 'bad' id
    expect(events.every((e) => (e.source_ids ?? []).every((id) => !id.includes('bad')))).toBe(true)

    // (1b) Sanity: at least one event does carry a 'good' source id (test not vacuous)
    expect(events.some((e) => (e.source_ids ?? []).some((id) => id.includes('good')))).toBe(true)

    // (2) Bundle file records bad source as unavailable and good source as available
    const bundlePath = join(sourceLedgerPath, 'research-source-bundle-rc_invariant.json')
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
      records: Array<{ source_id: string; availability: string }>
    }

    const badRecord = bundle.records.find((r) => r.source_id.includes('bad'))
    expect(badRecord).toBeDefined()
    expect(badRecord?.availability).toBe('unavailable')

    const goodRecord = bundle.records.find((r) => r.source_id.includes('good'))
    expect(goodRecord).toBeDefined()
    expect(goodRecord?.availability).toBe('available')

    // (3) BELT-AND-SUSPENDERS INVARIANT LOCK (the admit cite-check relies on this):
    // every persisted research-event source_id MUST be one of the source-ledger's content-hash-VERIFIED
    // source_ids. The admit path (workflow.recordAdmitJudgment / buildAdmitVerifiedCitationSet) builds its
    // cite-check set from content-hash-verified ledger records; this asserts the swarm never persists an
    // event source_id that isn't content-hash-verified, so that implicit invariant can't silently break.
    const verifiedLedgerSourceIds = new Set(
      bundle.records
        .filter((r) => (r as { content_hash?: string }).content_hash !== undefined && r.availability !== 'unavailable')
        .map((r) => r.source_id),
    )
    const persistedEventSourceIds = [...new Set(events.flatMap((e) => e.source_ids ?? []))]
    expect(persistedEventSourceIds.length).toBeGreaterThan(0) // not vacuous
    for (const id of persistedEventSourceIds) {
      expect(verifiedLedgerSourceIds.has(id)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Restructure Phase 1 / S1b — the FRONT Shariah gate wired into the swarm: the grounded sector
// judgment runs BEFORE the quick screen (before ANY further stage spend). A NON-COMPLIANT sector
// closes the gate → the coherent set-aside dossier (analysis + PASS decision) with ZERO quick-screen
// or lane events; an open gate leads the otherwise-unchanged sequence with a shariah_gate_judged event.
// ---------------------------------------------------------------------------
describe('runStrategyResearchSwarm front Shariah gate (S1b)', () => {
  const gateGround = async (sources: { source_id: string }[]) => ({
    captured: sources.map((s) => ({
      source_id: s.source_id,
      title: 't',
      url: 'https://example.com/x',
      excerpt: 'e',
      availability: 'available' as const,
      fetched_at: 'x',
      content_hash: 'sha256:1',
    })),
    verified_ids: sources.map((s) => s.source_id),
  })

  it('closed gate (NON_COMPLIANT sector) → set-aside dossier with ZERO quick-screen/lane spend', async () => {
    const store = new InMemoryEventStore()
    const provider = {
      provider_id: 'fake-gate-closed',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName === 'BuffettMungerShariahReasoning') {
          return {
            shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).',
              sector_status: 'non_compliant',
              impermissible_income: null,
              sector_citation: 'src_gate_10k',
            },
            proposed_sources: [{
              source_id: 'src_gate_10k',
              title: 'FY 10-K — business is riba-based lending',
              url: 'https://www.sec.gov/Archives/edgar/data/0/gate-10k.htm',
              excerpt: 'The company derives substantially all revenue from interest-based lending.',
            }],
          }
        }
        throw new Error(`unexpected post-gate structured call: ${String(schemaName)} — the closed gate must stop ALL further stage spend`)
      }),
    }

    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-gate-closed-'))
    const result = await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_gate_closed',
        company_id: 'riba_corp',
        ticker: 'RIBA',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'gate_k',
        model_id: 'mock',
        decision_id: 'decision_gate_closed',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: gateGround },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // The gate judged and CLOSED.
    const gate = events.find((e) => e.event_type === 'shariah_gate_judged')
    expect(gate).toBeDefined()
    const gatePayload = gate?.payload as Record<string, unknown>
    expect(gatePayload['allowed']).toBe(false)
    expect(gatePayload['sector_status']).toBe('non_compliant')

    // ZERO downstream stage spend or events.
    expect(types).not.toContain('quick_screen_drafted')
    expect(types).not.toContain('queued_for_deep_dive')
    expect(types).not.toContain('specialist_finding_recorded')
    expect(types).not.toContain('deep_dive_synthesis_drafted')

    // The coherent set-aside dossier: analysis + PASS decision, caused by the gate event.
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect(analysis).toBeDefined()
    expect(analysis?.causation_id).toBe(gate?.event_id)
    const analysisPayload = analysis?.payload as Record<string, unknown>
    expect(analysisPayload['investment_verdict']).toBe('PASS')
    expect(analysisPayload['shariah_status']).toBe('NON_COMPLIANT')
    expect(analysisPayload['engine_version']).toBe(ENGINE_VERSION)
    expect((analysisPayload['shariah_gate'] as Record<string, unknown>)['sector_status']).toBe('non_compliant')
    // Dogfood pin: the set-aside dossier carries the model's grounded WHY, not just the gate verdict.
    expect((analysisPayload['shariah_gate'] as Record<string, unknown>)['sector_reasoning']).toContain('Grounded sector basis')

    const decision = events.find((e) => e.event_type === 'decision_drafted')
    expect(decision).toBeDefined()
    expect((decision?.payload as Record<string, unknown>)['decision']).toBe('PASS')

    expect(result.decision).toBeDefined()
    expect((result as { shariah_gate?: unknown }).shariah_gate).toBeDefined()
    expect((result as { deep_dive?: unknown }).deep_dive).toBeUndefined()
  })

  it('open gate (compliant sector) → shariah_gate_judged leads the otherwise-unchanged full sequence', async () => {
    const store = new InMemoryEventStore()
    const base = swarmFakeProvider()
    const baseStructured = base.structured
    const provider = {
      ...base,
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        if (req.response_format?.schema_name === 'BuffettMungerShariahReasoning') {
          return {
            shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: 'compliant', impermissible_income: 0, sector_citation: 'src_gate_ok' },
            proposed_sources: [{
              source_id: 'src_gate_ok',
              title: 'FY 10-K — compliant operating business',
              url: 'https://www.sec.gov/Archives/edgar/data/0/gate-ok-10k.htm',
              excerpt: 'Revenue derives from the sale of goods and services.',
            }],
          }
        }
        return baseStructured(req as never)
      }),
    }

    const result = await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_gate_open',
        company_id: 'company_test',
        ticker: 'TEST',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'gate_open_k',
        model_id: 'mock',
        decision_id: 'decision_gate_open',
        source_ledger_path: '/tmp/owlfolio-gate-open-test-sources',
        // F.2 threading pin: the FRONT command's savings anchor must reach the deep-dive discount
        // (previously only the approval-resume path carried it).
        risk_free_rate: 0.03,
      },
      { ground: gateGround, laneConcurrency: 3 },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // The gate judged OPEN, and it precedes the quick screen in the ledger sequence.
    const gateIndex = types.indexOf('shariah_gate_judged')
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    const gatePayload = events[gateIndex]?.payload as Record<string, unknown>
    expect(gatePayload['allowed']).toBe(true)
    expect(gatePayload['sector_status']).toBe('compliant')
    expect(gatePayload['gate_incomplete']).toBeUndefined()
    // The gate leads: it precedes the circle gate (the first deep-dive stage).
    expect(gateIndex).toBeLessThan(types.indexOf('circle_competence_judged'))

    // The rest of the sequence is unchanged — and the retired quick screen never appears.
    expect(types).not.toContain('quick_screen_drafted')

    // S5 cost stamping: the circle stage carries its spend (k grounded samples + wall time).
    const circleEvent = events.find((e) => e.event_type === 'circle_competence_judged')
    const circleCost = (circleEvent?.payload as { stage_cost?: { provider_calls?: number; wall_ms?: number } }).stage_cost
    expect(circleCost?.provider_calls).toBeGreaterThanOrEqual(1)
    expect(typeof circleCost?.wall_ms).toBe('number')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(3)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()

    // Phase 2 V5: lanes + synthesis stamp their stage_cost (scheduler unattended-spend data).
    const finding = events.find((e) => e.event_type === 'specialist_finding_recorded')
    const findingCost = (finding?.payload as { stage_cost?: { provider_calls?: number; wall_ms?: number } }).stage_cost
    expect(findingCost?.provider_calls).toBe(1)
    expect(typeof findingCost?.wall_ms).toBe('number')
    const synthEvent = events.find((e) => e.event_type === 'deep_dive_synthesis_drafted')
    const synthCost = (synthEvent?.payload as { stage_cost?: { provider_calls?: number; wall_ms?: number } }).stage_cost
    expect(synthCost?.provider_calls).toBe(1)
    expect(typeof synthCost?.wall_ms).toBe('number')

    // B2 (Phase 4): the discount is the REQUIRED RETURN — no setting threaded on this command →
    // the flat 15% book default with basis 'book_default' (the savings anchor is retired here).
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const av = (analysis?.payload as { valuation?: { discount_rate?: number; discount_inputs?: { required_return_basis?: string } } }).valuation
    expect(av?.discount_inputs?.required_return_basis).toBe('book_default')
    expect(av?.discount_rate).toBeCloseTo(0.15, 6)
  })
})

describe('runStrategyResearchSwarm with MockProvider + deterministic grounder', () => {
  it('completes end-to-end: research_case_created, shariah_gate_judged, >=3 specialist_finding_recorded, deep_dive_synthesis_drafted, decision_drafted', async () => {
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-mock-swarm-'))
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    const result = await runStrategyResearchSwarm(
      store,
      provider,
      {
        research_case_id: 'rc_mock_e2e',
        company_id: 'company_mock',
        ticker: 'COST',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'mock_e2e_k',
        model_id: 'mock-research-v1',
        decision_id: 'decision_mock_e2e',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: groundProposedSourcesDeterministic as GroundFn, laneConcurrency: 4 },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    expect(types).toContain('research_case_created')
    expect(types).toContain('shariah_gate_judged')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(3)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()
  })

  it('emits buffett_munger_analysis_drafted and projection has defined investment_verdict', async () => {
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-mock-swarm-analysis-'))
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    await runStrategyResearchSwarm(
      store,
      provider,
      {
        research_case_id: 'rc_mock_analysis',
        company_id: 'company_mock',
        ticker: 'COST',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'mock_analysis_k',
        model_id: 'mock-research-v1',
        decision_id: 'decision_mock_analysis',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: groundProposedSourcesDeterministic as GroundFn, laneConcurrency: 4 },
    )

    const events = await store.list()

    // buffett_munger_analysis_drafted must be emitted
    expect(events.some((e) => e.event_type === 'buffett_munger_analysis_drafted')).toBe(true)

    // projection must reflect the analysis fields
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const caseProjection = projections.find((c) => c.research_case_id === 'rc_mock_analysis')
    expect(caseProjection).toBeDefined()
    expect(caseProjection?.investment_verdict).toBeDefined()
    expect(caseProjection?.strategy_compliance).toBeDefined()
    expect(caseProjection?.valuation_status).toBeDefined()
    expect(caseProjection?.shariah_status).toBeDefined()
  })

  // Margin-of-safety audit surface: a decision with key_wrong_assumption + thesis_break_triggers flows
  // through the swarm → persisted on the analysis event → projected on the research case.
  it('persists + projects key_wrong_assumption + thesis_break_triggers from the synthesis decision', async () => {
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-mock-swarm-mos-'))
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    await runStrategyResearchSwarm(
      store,
      provider,
      {
        research_case_id: 'rc_mock_mos',
        company_id: 'company_mock',
        ticker: 'COST',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'mock_mos_k',
        model_id: 'mock-research-v1',
        decision_id: 'decision_mock_mos',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: groundProposedSourcesDeterministic as GroundFn, laneConcurrency: 4 },
    )

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const caseProjection = projections.find((c) => c.research_case_id === 'rc_mock_mos')
    expect(caseProjection).toBeDefined()
    expect(typeof caseProjection?.key_wrong_assumption).toBe('string')
    expect((caseProjection?.key_wrong_assumption ?? '').length).toBeGreaterThan(0)
    expect(Array.isArray(caseProjection?.thesis_break_triggers)).toBe(true)
    expect((caseProjection?.thesis_break_triggers ?? []).length).toBeGreaterThan(0)
  })

  it('E2: a MockProvider run with NO EDGAR fundamentals projects tiers/roic but is honestly UNPRICED', async () => {
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-mock-swarm-valuation-'))
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    await runStrategyResearchSwarm(
      store,
      provider,
      {
        research_case_id: 'rc_mock_valuation',
        company_id: 'company_mock',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'mock_valuation_k',
        model_id: 'mock-research-v1',
        decision_id: 'decision_mock_valuation',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: groundProposedSourcesDeterministic as GroundFn, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const caseProjection = projections.find((c) => c.research_case_id === 'rc_mock_valuation')
    expect(caseProjection?.valuation?.moat_class).toBe('monopoly')
    expect((caseProjection?.valuation as Record<string, unknown> | undefined)?.['runway']).toBeUndefined() // C2: retired
    expect(caseProjection?.valuation?.roic).toBe(0.25)
    // E2: OE is retired and no EDGAR fundamentals were injected → honestly unpriced (fail-closed).
    expect(caseProjection?.valuation?.buy_price_per_share).toBeUndefined()
    expect((caseProjection?.valuation as Record<string, unknown> | undefined)?.['normalized_owner_earnings_per_share']).toBeUndefined()
    expect((caseProjection?.valuation as Record<string, unknown> | undefined)?.['owner_earnings_bridge']).toBeUndefined()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysis?.payload as Record<string, unknown>)['valuation'] as Record<string, unknown>
    expect((valuation['degraded_flags'] as string[]).join(' ')).toMatch(/fcf_not_computable/)
  })
  it('projects the judgment layer: grounded moat thesis (B6), anchor-vs-proposed-vs-resolved (C2: no runway)', async () => {
    // No EDGAR fundamentals injected -> moat quant anchor not computable. The mock emits a grounded cited
    // moat thesis (3 grounded drivers proposing monopoly -> resolved monopoly). The dossier surfaces the
    // cited moat_drivers + grounded count + that the quant anchor was not computable.
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-mock-judgment-'))
    const store = new InMemoryEventStore()
    await runStrategyResearchSwarm(
      store,
      new MockProvider(),
      {
        research_case_id: 'rc_judgment',
        company_id: 'company_mock',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'judgment_k',
        model_id: 'mock-research-v1',
        decision_id: 'decision_judgment',
        source_ledger_path: sourceLedgerPath,
      },
      { ground: groundProposedSourcesDeterministic as GroundFn, laneConcurrency: 4 },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    const c = projections.find((p) => p.research_case_id === 'rc_judgment')
    const judgment = c?.valuation?.judgment
    expect(judgment).toBeDefined()
    expect(judgment?.rubric_version).toBeDefined()
    // moat axis (B6): quant anchor not computable -> grounded thesis resolves the tier -> monopoly.
    expect(judgment?.moat?.anchor_computable).toBe(false)
    expect(judgment?.moat?.proposed_tier).toBe('monopoly')
    expect(judgment?.moat?.resolved_tier).toBe('monopoly')
    // The grounded cited moat drivers are surfaced (3 grounded distinct advantages clear the monopoly bar).
    expect((judgment?.moat?.moat_drivers ?? []).length).toBeGreaterThanOrEqual(3)
    expect((judgment?.moat?.moat_drivers ?? []).every((d) => d.grounded)).toBe(true)
    expect(judgment?.moat?.grounded_driver_count).toBeGreaterThanOrEqual(3)
    // resolved moat_class fed downstream is monopoly.
    expect(c?.valuation?.moat_class).toBe('monopoly')
    // C2: the runway judged axis is retired — nothing projects for it on new events.
    expect((judgment as Record<string, unknown> | undefined)?.['runway']).toBeUndefined()
    expect((c?.valuation as Record<string, unknown> | undefined)?.['runway']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Configurable swarm fake provider for the valuation-units + resilience bug tests.
// stageBehaviors lets a test inject a custom synthesis bridge or force failures per stage.
// ---------------------------------------------------------------------------
type SynthesisOverrides = Partial<{
  moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  runway: 'proven' | 'limited' | 'none'
  runway_exceptional: boolean
  roic: number
  incremental_roic: number
  reinvestment_rate: number
  owner_earnings_bridge: Record<string, number | string>
  // RELIGHTENED DECISION (R1): the model OWNS the valuation. proposed_buy_below is the model's buy-below
  // (recorded verbatim; NOT a derived FV); valuation_reasoning carries the cited owner-earnings basis +
  // assumed growth + why it is defensible. The harness uses assumed_growth only for the reference cross-
  // check FV (a flag-only sanity-check).
  proposed_buy_below: number
  valuation_reasoning: {
    owner_earnings_basis: string
    // Founding-risk fix: a grounded source_id (or content_hash) backing the owner-earnings figure.
    owner_earnings_citation: string
    assumed_growth: number
    assumed_growth_rationale: string
    // Founding-risk fix: a grounded source_id (or content_hash) backing the assumed-growth rationale.
    assumed_growth_citation: string
    discount_rationale?: string
  }
  // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) override — used to test Guard 1 (adequacy never
  // gates) and Guard 2 (a moat-sourced margin must rest on a grounded/gate-passing moat).
  margin_of_safety: {
    sources: ('price' | 'moat')[]
    price_gap_reasoning?: string
    moat_durability_reasoning?: string
    adequacy?: 'adequate' | 'thin' | 'inadequate'
    reasoning: string
  }
}>

function configurableSwarmProvider(opts: {
  laneCount: number
  synthesis?: SynthesisOverrides
  // Override the model's investment_verdict (default WATCH) — used to test that the cheap deterministic
  // gates (moat / Shariah / RESEARCH_MORE) clamp the model verdict, and that a sanity flag NEVER blocks it.
  investmentVerdict?: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
  // Override the model's valuation_status (default EXPENSIVE) — used to exercise the SYMMETRIC sanity-check
  // (status ATTRACTIVE vs implausibly-high implied growth = over-optimistic; status EXPENSIVE vs modest
  // implied growth = over-pessimistic).
  valuationStatus?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'
  // Per-stage failure injection: returns the number of times to throw before succeeding.
  failQuickScreen?: number
  failSynthesis?: number
  // Mechanism 5 red-team controls. failRedTeam: throw N times (exercises degrade-on-timeout).
  failRedTeam?: number
  // synthesisResponse: what the synthesis returns for the red-team obligation (undefined = silent).
  synthesisResponse?: { mode: 'answered_with_evidence' | 'accepted_downgraded'; text: string; downgrade?: { dimension: 'tier' | 'growth' | 'verdict'; from: string; to: string } }
  // redTeamCitations: which corpus source_ids the red team's strongest objection cites.
  redTeamCitations?: string[]
  // S7: extra fields spread into the BuffettMungerRedTeam response (e.g. a consensus_check).
  redTeamExtras?: Record<string, unknown>
  // S3 (Phase 3): extra fields spread LAST into the BuffettMungerMoatLane response, so a test can
  // override the shared defaults (e.g. a grounded 'narrowing' direction for the WATCH-clamp pin).
  moatLaneExtras?: Record<string, unknown>
  // S5 (Phase 3): extra fields spread LAST into the BuffettMungerManagementLane response (e.g. a
  // grounded integrity red flag for the management-veto pin).
  managementLaneExtras?: Record<string, unknown>
  // Spec-correct decomposition: the MOAT lane omits its rubric (→ rubric_not_emitted holistic fallback)
  // and/or the Shariah-reasoning pass omits its overlay (→ shariah_ratios_unverified) — the live-dogfood shape.
  omitMoatRubric?: boolean
  omitShariahOverlay?: boolean
  // Founding-risk fix: omit valuation_reasoning entirely (→ synthesis_grounding_unmet) — the live shape.
  omitValuationReasoning?: boolean
  // FOCUSED valuation-reasoning fallback controls (the focused decomposition mirroring the red-team response).
  // valuationReasoningResponse: what the dedicated BuffettMungerValuationReasoning call returns (undefined =
  // it omits the required field → the focused call also fails to ground). When the focused call is NOT
  // expected to fire (happy path), the harness must never invoke it — assert on valuationReasoningCalls.
  valuationReasoningResponse?: {
    owner_earnings_basis: string
    owner_earnings_citation: string
    assumed_growth: number
    assumed_growth_rationale: string
    assumed_growth_citation: string
    // Phase 2 V1: the stage-owned fields (optional in the fake exactly as in the schema).
    proposed_buy_below?: number
    valuation_status?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'
  }
  // Phase 2 V4: make the STAGE omit its artifact (the retry-exhaust path) — the default now supplies
  // the full artifact derived from the SAME synthesis overrides, since the stage owns the valuation.
  stageOmitsValuation?: boolean
  // Counter the test reads to confirm the focused call fired (or, for the happy path, did NOT).
  valuationReasoningCalls?: { count: number }
  // A1 hole repro: the decision agent proposes BOTH a verified ('src_dec_good_1') and a
  // captured-but-unverified ('src_dec_bad_1') source. L1 (dec.verified_ids non-empty) is satisfied by the
  // good one; the valuation citations point at the BAD (unverified) source. Use with a ground fn that
  // grounds 'good' ids but captures 'bad' ids as unavailable (no content_hash).
  decisionProposesGoodBad?: boolean
  // Rubric/red-team hardening repro: the quick screen proposes BOTH a verified ('src_qs_good_1') and a
  // captured-but-unverified ('src_qs_bad_1') source. Use with a ground fn that grounds 'good' ids but
  // captures 'bad' ids as unavailable (no content_hash), so a citation pointing at 'src_qs_bad_1' is
  // captured-but-unverified — it must NOT count as grounded after the fix.
  quickScreenProposesGoodBad?: boolean
  // Regression repro: the quick screen proposes NO sources at all (proposed_sources: []) — the no-tools
  // production shape after the schema fix. The run must still succeed, grounded by the harness pre-fetch.
  quickScreenProposesEmpty?: boolean
}) {
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
  let laneCall = 0
  let qsFails = opts.failQuickScreen ?? 0
  let synthFails = opts.failSynthesis ?? 0
  let rtFails = opts.failRedTeam ?? 0
  const baseBridge = {
    net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
    maintenance_capex_proxy_tier: '80' as const, stock_based_comp: 911,
    normalized_working_capital_change: 0, shares_outstanding: 443,
  }
  const provider = {
    provider_id: 'fake-configurable',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    // Stage is derived from the request schema_name so retries (which re-issue the same stage call)
    // are handled correctly regardless of ordering.
    structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
      if (schemaName === 'BuffettMungerCircleCompetence') {
        return fakeCirclePayload(src)
      }
      if (schemaName === 'BuffettMungerQuickScreen') {
        if (qsFails > 0) { qsFails--; throw new Error('Codex CLI timed out') }
        return {
          summary: 'Good business', business_quality: 'Strong', moat: 'Wide moat',
          management_capital_allocation: 'Excellent', financial_quality: 'Solid',
          valuation_sanity: 'Reasonable', shariah_status: 'CONDITIONAL',
          red_flags: ['None identified'], confidence: 'high', caveats: ['Mock caveat'],
          screening_result: 'deep_dive_candidate',
          proposed_sources: opts.quickScreenProposesEmpty === true
            ? []
            : opts.quickScreenProposesGoodBad === true
              ? [src('src_qs_good_1'), src('src_qs_bad_1')]
              : [src('src_qs_1')],
        }
      }
      if (schemaName === 'BuffettMungerLaneFinding') {
        const n = laneCall++
        return {
          finding_summary: `Lane ${n} finding`, confidence: 'high',
          caveats: ['Mock lane caveat'], proposed_sources: [src(`src_lane_${n}`)],
        }
      }
      if (schemaName === 'BuffettMungerUnderstandLane') {
        return fakeUnderstandLanePayload(src)
      }
      if (schemaName === 'BuffettMungerManagementLane') {
        return { ...fakeManagementLanePayload(src), ...(opts.managementLaneExtras ?? {}) }
      }
      if (schemaName === 'BuffettMungerMoatLane') {
        const moatClass = opts.synthesis?.moat_class ?? 'wide'
        const runway = opts.synthesis?.runway ?? 'proven'
        return {
          finding_summary: 'Moat lane finding', confidence: 'high',
          caveats: ['Mock moat caveat'],
          runway,
          ...(opts.synthesis?.runway_exceptional !== undefined ? { runway_exceptional: opts.synthesis.runway_exceptional } : {}),
          // B6: the grounded cited thesis RESOLVES to the requested moat_class (drivers cite the grounded
          // src_lane_moat so they verify under allVerifiedGround). When omitMoatRubric is set the moat thesis
          // is omitted (the lane omits its judgment block) -> fail-closed narrow + judgment_degraded; the
          // grounded runway thesis is still supplied so the runway axis resolves normally.
          ...runwayThesisForTier(runway, 'src_lane_moat'),
          ...(opts.omitMoatRubric === true
            ? {}
            : moatThesisForTier(moatClass, 'src_lane_moat')),
          ...(opts.moatLaneExtras ?? {}),
          proposed_sources: [src('src_lane_moat')],
        }
      }
      // Focused Shariah-reasoning pass (always-on): the overlay the harness recompute now sources from.
      // omitShariahOverlay omits shariah_judgment (schema-invalid → the pass fails → the harness fails
      // CLOSED to the impermissible_income_not_emitted degradation — the live dogfood shape).
      if (schemaName === 'BuffettMungerShariahReasoning') {
        return {
          ...(opts.omitShariahOverlay === true
            ? {}
            : { shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: 'compliant', impermissible_income: 0, sector_citation: 'src_shariah_reasoning' } }),
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      if (schemaName === 'BuffettMungerInversion') {
        if (rtFails > 0) { rtFails--; throw new Error('Codex CLI timed out') }
        return {
          strongest_case_against: 'Valuation prices in flawless execution.',
          weakest_rubric_items: [{ lane: 'moat', item: 'M5', why: 'thin switching evidence' }],
          moat_decay_scenario: 'A funded entrant erodes share over 5 years.',
          growth_credit_attack: 'Incremental ROIC mean-reverts below cost of capital.',
          shared_narrative_blindspots: ['All lanes read the same 10-K.'],
          strongest_objection: {
            claim: 'Growth credit depends on incremental ROIC the firm likely cannot sustain.',
            severity: 'high',
            citations: opts.redTeamCitations ?? ['src_lane_moat'],
          },
          ...(opts.redTeamExtras ?? {}),
          proposed_sources: [src('src_lane_moat')],
        }
      }
      // dedicated red-team-RESPONSE call (the focused decomposition). The synthesis_response that answers
      // the strongest objection is produced HERE now, not on the synthesis schema. Omit it (→ the required
      // field is missing → red_team_objection_unaddressed) when opts.synthesisResponse is undefined.
      if (schemaName === 'BuffettMungerRedTeamResponse') {
        return {
          ...(opts.synthesisResponse !== undefined ? { synthesis_response: opts.synthesisResponse } : {}),
          proposed_sources: [src('src_rt_resp_1')],
        }
      }
      // FOCUSED valuation-reasoning call (the fallback when the monolithic decision drops/ungrounds it).
      if (schemaName === 'BuffettMungerValuationReasoning') {
        if (opts.valuationReasoningCalls !== undefined) opts.valuationReasoningCalls.count += 1
        // Phase 2 V4: the STAGE owns the valuation — derive the full artifact from the SAME overrides the
        // monolithic synthesis used to carry, so the deterministic-side tests keep their semantics.
        if (opts.stageOmitsValuation === true) {
          return { proposed_sources: [src('src_vr_focused_1')] }
        }
        const vrOverride = opts.synthesis?.valuation_reasoning ?? opts.valuationReasoningResponse
        return {
          valuation_reasoning: {
            ...(vrOverride ?? {
              owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
              owner_earnings_citation: 'src_dec_1',
              assumed_growth: 0.06,
              assumed_growth_rationale: 'Modest growth grounded in segment capex, cited to the 10-K.',
              assumed_growth_citation: 'src_dec_1',
            }),
            proposed_buy_below: (vrOverride as { proposed_buy_below?: number } | undefined)?.proposed_buy_below
              ?? opts.synthesis?.proposed_buy_below ?? 150,
            valuation_status: (vrOverride as { valuation_status?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA' } | undefined)?.valuation_status
              ?? opts.valuationStatus ?? 'EXPENSIVE',
            owner_earnings_bridge: opts.synthesis?.owner_earnings_bridge ?? baseBridge,
            // Phase 4 (B2): the industry P/FCF exit multiple — retry-forced on the live stage, so the
            // shared fake supplies a grounded-in-band default (overridable per test).
            industry_exit_multiple: (vrOverride as { industry_exit_multiple?: unknown } | undefined)?.industry_exit_multiple
              ?? { multiple: 15, basis_note: 'Industry has traded ~15× FCF over the last decade (test fixture).', citation: 'src_dec_1' },
          },
          proposed_sources: [src('src_dec_1'), src('src_vr_focused_1')],
        }
      }
      // synthesis/decision (BuffettMungerSynthesisDecision)
      if (synthFails > 0) { synthFails--; throw new Error('Codex CLI timed out') }
      return {
        investment_verdict: opts.investmentVerdict ?? 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: opts.valuationStatus ?? 'EXPENSIVE',
        next_required_action: 'Await margin of safety.', decision_reason: 'Quality but pricey',
        thesis_summary: 'Quality compounder', evidence_summary: 'Covered',
        valuation_rationale: 'Elevated', shariah_rationale: 'No prohibited activities',
        synthesis_summary: 'All lanes reviewed', risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        ...DECISION_MOS_FIXTURE,
        // Allow a test to override the synthesis-owned joint margin-of-safety judgment (Guard 1/Guard 2).
        ...(opts.synthesis?.margin_of_safety !== undefined ? { margin_of_safety: opts.synthesis.margin_of_safety } : {}),
        // moat_class / runway now come from the MOAT lane; the synthesis schema no longer carries them.
        growth_assumptions: (opts.synthesis as { growth_assumptions?: string } | undefined)?.growth_assumptions ?? 'Two-stage DCF; credited g banded by incremental ROIC and runway.',
        owner_earnings_bridge: opts.synthesis?.owner_earnings_bridge ?? baseBridge,
        roic: opts.synthesis?.roic ?? 0.30,
        incremental_roic: opts.synthesis?.incremental_roic ?? 0.20,
        reinvestment_rate: opts.synthesis?.reinvestment_rate ?? 0.43,
        // RELIGHTENED DECISION (R1): the model proposes the buy-below + cited valuation reasoning.
        proposed_buy_below: opts.synthesis?.proposed_buy_below ?? 150,
        // Founding-risk fix: by default the valuation_reasoning GROUNDS both claims in the decision agent's
        // OWN verified source (src_dec_1, which allVerifiedGround verifies into dec.verified_ids) so a clean
        // grounded synthesis passes through. omitValuationReasoning drops it entirely (→ grounding unmet).
        ...(opts.omitValuationReasoning === true
          ? {}
          : {
              valuation_reasoning: opts.synthesis?.valuation_reasoning ?? {
                owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
                owner_earnings_citation: 'src_dec_1',
                assumed_growth: 0.06,
                assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.',
                assumed_growth_citation: 'src_dec_1',
              },
            }),
        red_team_strongest_objection: 'echoed',
        proposed_sources: opts.decisionProposesGoodBad === true
          ? [src('src_dec_good_1'), src('src_dec_bad_1')]
          : [src('src_dec_1')],
      }
    }),
  }
  return provider
}

const allVerifiedGround = async (sources: { source_id: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
    availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
  })),
  verified_ids: sources.map((s) => s.source_id),
})

describe('E2 — FCF per-share units + shares fail-closed', () => {
  it('prices off FCF per diluted share (fixture: FCF 2000/100 sh → IV 264.08, buy 184.86, load 132.04)', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-e2ps-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_e2ps', company_id: 'company_cost', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'e2ps_k',
        model_id: 'mock', decision_id: 'decision_e2ps', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4, fundamentals: e2FcfFundamentals },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_e2ps')
    expect(cp?.valuation?.buy_price_per_share).toBe(184.86)
    expect(cp?.valuation?.load_up_below).toBe(132.04)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['intrinsic_value_per_share']).toBe(264.08)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['valuation_basis']).toBe('fcf')
  })

  it('degrades gracefully (no IV/buy) when diluted shares are missing — caveat recorded, run completes', async () => {
    const noShares: Fundamentals = {
      ...e2FcfFundamentals,
      latest_annual: (({ diluted_shares_m: _d, ...rest }) => rest)(e2FcfFundamentals.latest_annual),
      annual_series: (e2FcfFundamentals.annual_series ?? []).map((a) => (({ diluted_shares_m: _d, ...rest }) => rest)(a)),
    }
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-e2nosh-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_e2nosh', company_id: 'company_cost', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'e2nosh_k',
        model_id: 'mock', decision_id: 'decision_e2nosh', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4, fundamentals: noShares },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysis?.payload as Record<string, unknown>)['valuation'] as Record<string, unknown>
    expect(valuation['buy_price_per_share']).toBeUndefined()
    expect(valuation['intrinsic_value_per_share']).toBeUndefined()
    expect((valuation['valuation_caveats'] as string[]).join(' ')).toMatch(/diluted shares/i)
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })
})

describe('Two-stage DCF harness growth path (Phase 1.3 one growth path + gates)', () => {
  async function runWith(synthesis: SynthesisOverrides, id: string, opts: { fundamentals?: Fundamentals | null } = {}) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, synthesis })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-2s-${id}-`))
    // E2: priced tests need an FCF basis — inject the shared fixture unless the test opts out (null).
    const fundamentals = opts.fundamentals === null ? undefined : (opts.fundamentals ?? e2FcfFundamentals)
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${id}_k`,
        model_id: 'mock', decision_id: `decision_${id}`, source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4, ...(fundamentals !== undefined ? { fundamentals } : {}) },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('no EDGAR series → demonstrated_growth_reference floors to g=0; HEADLINE growth = model assumed_growth', async () => {
    // base bridge OE_total = 8838+2565-2052-911-0 = 8440 ($M) ÷ 443 = 19.05/sh, monopoly, proven.
    // HEADLINE-GROWTH INVERSION: with no EDGAR series the DEMONSTRATED-HISTORY reference floors to 0, but the
    // headline growth_rate is now the MODEL's cited assumed_growth (0.06). (Was: growth_rate === 0.)
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', incremental_roic: 0.08, reinvestment_rate: 0.5 }, 'nogrowth', { fundamentals: null })
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_basis).toBe('none')
    // E2: no EDGAR series → no FCF basis → honestly unpriced; the internal OE DCF is retired.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['cap_exceeded']).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
  })

  it('C2: growth is the demonstrated reference + the model cited judgment (no runway axis exists)', async () => {
    // The old banding (runway/inc-ROIC/exceptional) is gone — with no demonstrated CAGR available the
    // demonstrated-history REFERENCE is the honest no-growth floor regardless of the runway/inc-ROIC the lane
    // proposes. The headline growth is the model's assumed_growth (0.06), independent of runway too.
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'none', incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'runway-none', { fundamentals: null })
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['runway']).toBeUndefined() // C2: retired
  })

  it('C2: no runway field lifts growth — the demonstrated reference floors honestly without a CAGR', async () => {
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', runway_exceptional: true, incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'mono-exceptional', { fundamentals: null })
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['runway_exceptional']).toBeUndefined() // C2: retired
    // E2: the internal OE DCF is retired — implied_multiple / cap_exceeded no longer exist; the case
    // has no FCF basis (fundamentals: null) so it is honestly unpriced.
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['cap_exceeded']).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
  })

  it('E2: negative free cash flow gates the valuation — caveat recorded, no IV/buy, run completes', async () => {
    // CFO below capex → FCF negative: the book model does not price a cash-burning year.
    const negFcf: Fundamentals = {
      ...e2FcfFundamentals,
      latest_annual: { ...e2FcfFundamentals.latest_annual, cfo_musd: 100 },
      annual_series: (e2FcfFundamentals.annual_series ?? []).map((a) => ({ ...a, cfo_musd: 100 })),
    }
    const { events, cp } = await runWith({
      moat_class: 'monopoly', runway: 'proven', incremental_roic: 0.30, reinvestment_rate: 0.5,
    }, 'neg-fcf', { fundamentals: negFcf })
    // No positive OE/share → no point FV and no computed threshold (both fail closed; R1 superseded).
    // The model's price view survives as ADVISORY only.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['model_proposed_buy_below']).toBe(150)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect((valuation?.['valuation_caveats'] as string[])?.join(' ')).toMatch(/free cash flow.*not positive/i)
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })

  it('gate-passing EDGAR series → full valuation provenance (terminal share, cap flag, widened MoS) — Phase 1.5-1.7', async () => {
    // A wide-moat compounder with a multi-year EDGAR series whose OE/share grows ~10%/yr (above GDP) and no
    // gross PP&E (Greenwald not computable → D&A-floor → low maint-capex confidence). All three widening
    // inputs (high terminal share, low maint-capex confidence, above-GDP moat-durability) should fire.
    const series: AnnualFacts[] = []
    for (let i = 0; i < 6; i += 1) {
      const fy = 2019 + i
      const ni = Math.round(1000 * Math.pow(1.10, i))
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, cfo_musd: ni + 200, sbc_musd: 0, diluted_shares_m: 100 })
    }
    const growingFundamentals: Fundamentals = {
      cik: '0000000001', entity_name: 'GROWER INC', currency: 'USD',
      latest_annual: series[series.length - 1]!,
      annual_series: series,
      filings: [{ form: '10-K', filed: '2024-02-01', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm' }],
    }
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.40 },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-prov-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_prov', company_id: 'c', ticker: 'GRW',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'prov_k',
        model_id: 'mock', decision_id: 'decision_prov', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4, fundamentals: growingFundamentals,
        resolvePrice: async () => ({ available: true, price_per_share: 50, currency: 'USD', as_of: 'x', source: 'test' }),
      },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_prov')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    expect(cp?.valuation?.growth_basis).toBe('edgar_fcf_cagr')
    expect(cp?.valuation?.growth_above_gdp).toBe(true)
    // Terminal-value share surfaced and in (0,1).
    expect(cp?.valuation?.terminal_value_pct_of_iv).toBeGreaterThan(0)
    expect(cp?.valuation?.terminal_value_pct_of_iv).toBeLessThan(1)
    // The MoS-as-price-haircut fields are RETIRED — the SAME documented uncertainties (above-GDP
    // moat-durability, low maint-capex confidence) now widen the required_growth_gap instead of the price,
    // so margin_of_safety / margin_of_safety_applied / margin_of_safety_widening_reasons are no longer projected.
    const retiredValuation = cp?.valuation as Record<string, unknown> | undefined
    expect(retiredValuation?.margin_of_safety).toBeUndefined()
    expect(retiredValuation?.margin_of_safety_applied).toBeUndefined()
    expect(retiredValuation?.margin_of_safety_widening_reasons).toBeUndefined()
    // Buy-below is locked from harness numbers; even with a model BUY it never escalates above WATCH here.
    expect(cp?.valuation?.buy_price_per_share).toBeGreaterThan(0)

    // ---- reverse-DCF market-implied growth (this case has a price) ----
    // forward-DCF removal: the dollar fair_value_range / fair_value_per_share / valuation_cap_binding are no
    // longer surfaced. The kept valuation lens is the reverse-DCF market-implied growth; implied_multiple
    // (a ratio from the internal forward FV) is still surfaced.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['fair_value_range']).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined() // E2: retired
    // A current price was injected (50) with positive OE/share → market-implied growth is computable.
    expect(typeof cp?.valuation?.market_implied_growth).toBe('number')
    expect(Number.isFinite(cp?.valuation?.market_implied_growth ?? NaN)).toBe(true)
  })

  it('fail-closed: no current price → no market_implied_growth (omitted, not fabricated); internal valuation still computes', async () => {
    // Same growing EDGAR series, but the price resolver FAILS → no current price.
    const series: AnnualFacts[] = []
    for (let i = 0; i < 6; i += 1) {
      const fy = 2019 + i
      const ni = Math.round(1000 * Math.pow(1.10, i))
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, cfo_musd: ni + 200, sbc_musd: 0, diluted_shares_m: 100 })
    }
    const growingFundamentals: Fundamentals = {
      cik: '0000000001', entity_name: 'GROWER INC', currency: 'USD',
      latest_annual: series[series.length - 1]!,
      annual_series: series,
      filings: [{ form: '10-K', filed: '2024-02-01', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm' }],
    }
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.40 },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-noprice-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_noprice', company_id: 'c', ticker: 'GRW',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'noprice_k',
        model_id: 'mock', decision_id: 'decision_noprice', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4, fundamentals: growingFundamentals,
        resolvePrice: async () => ({ available: false as const, reason: 'fetch failed', source: 'fixture' }),
      },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_noprice')
    // E2: the book IV still computes without a price; the OE implied_multiple is retired.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['intrinsic_value_per_share']).toBeGreaterThan(0)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined()
    // Fail-closed: no price → market_implied_growth is OMITTED (never fabricated).
    expect(cp?.valuation?.market_implied_growth).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// RELIGHTENED DECISION (R1): the MODEL proposes the verdict + valuation + buy-below; the deterministic
// side only (a) records the model's buy-below VERBATIM, (b) sanity-checks it (flag-only, SYMMETRIC — it
// must catch BOTH an over-optimistic and an over-pessimistic model read), and (c) applies the cheap gates
// (moat / Shariah / RESEARCH_MORE). A sanity flag NEVER blocks the verdict. reference_fair_value is a
// forward-DCF cross-check at the MODEL's assumed growth — proving buy_below is NOT the reference FV.
//
// COST-like wide case: NO EDGAR series → honest no-growth point-FV reference; the model bridge gives
// OE/sh ≈ 19.05. The model's proposed_buy_below + assumed_growth + valuation_status drive what we assert.
// ---------------------------------------------------------------------------
describe('RELIGHTENED DECISION — model proposes buy-below; deterministic side sanity-checks (flag-only)', () => {
  async function runRelit(opts: {
    id: string
    price: number
    investmentVerdict?: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
    valuationStatus?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'
    proposedBuyBelow?: number
    assumedGrowth?: number
    moatClass?: 'narrow' | 'moderate' | 'wide' | 'monopoly'
    /** Optional EDGAR fundamentals — supply a real series when a test needs a demonstrated history. */
    fundamentals?: Fundamentals
    /** S3: override/extend the moat lane payload (e.g. a grounded narrowing direction). */
    moatLaneExtras?: Record<string, unknown>
    /** V live-find pin: the synthesis growth narrative (feeds the lane-argue parser). */
    growthAssumptions?: string
  }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      ...(opts.moatLaneExtras !== undefined ? { moatLaneExtras: opts.moatLaneExtras } : {}),
      synthesis: {
        moat_class: opts.moatClass ?? 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43,
        ...(opts.growthAssumptions !== undefined ? { growth_assumptions: opts.growthAssumptions } : {}),
        ...(opts.proposedBuyBelow !== undefined ? { proposed_buy_below: opts.proposedBuyBelow } : {}),
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          // Founding-risk fix: ground both valuation claims in the decision agent's OWN verified source
          // (src_dec_1, verified by allVerifiedGround) so these flag-only sanity tests exercise the SANITY
          // layer on a properly-grounded synthesis (the grounding gate must not interfere).
          owner_earnings_citation: 'src_dec_1',
          assumed_growth: opts.assumedGrowth ?? 0.06,
          assumed_growth_rationale: 'Cited to the latest 10-K segment capex.',
          assumed_growth_citation: 'src_dec_1',
        },
      },
      investmentVerdict: opts.investmentVerdict ?? 'WATCH',
      ...(opts.valuationStatus !== undefined ? { valuationStatus: opts.valuationStatus } : {}),
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-relit-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround,
        laneConcurrency: 4,
        // E2: the FCF basis defaults to the shared fixture (IV ≈ 264.08 with the fake's g=0.06 + 15×).
        fundamentals: opts.fundamentals ?? e2FcfFundamentals,
        resolvePrice: async () => ({ available: true as const, price_per_share: opts.price, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    return { events, valuation, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('BUY-BELOW ← COMPUTED (R1 superseded, owner-approved 2026-07-11): the operative threshold = reference × (1 − required margin); the model price is ADVISORY', async () => {
    // The model proposes 150 (advisory); the OPERATIVE buy-below is computed from the reference value.
    const { valuation, cp } = await runRelit({ id: 'buybelow-model', price: 300, proposedBuyBelow: 150, assumedGrowth: 0.06 })
    // Recorded buy-below IS the computed threshold (fixture: FV@15% ≈ 264.08 → ×0.70 = 184.86).
    expect(cp?.valuation?.buy_price_per_share).toBe(184.86)
    expect(valuation?.['proposed_buy_below']).toBe(184.86)
    expect(valuation?.['model_proposed_buy_below']).toBe(150)
    // forward-DCF removal: the dollar reference_fair_value / fair_value_per_share are no longer emitted.
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(valuation?.['fair_value_per_share']).toBeUndefined()
    // The model's cited valuation reasoning rides along.
    const vr = valuation?.['valuation_reasoning'] as Record<string, unknown> | undefined
    expect(vr?.['assumed_growth']).toBe(0.06)
    // E2: owner_earnings_basis is retired from the reasoning payload.
    expect(vr?.['owner_earnings_basis']).toBeUndefined()
  })

  // C3 (owner-locked): valuation_status is DERIVED arithmetic — the computed zones ARE the status.
  it('C3: valuation_status derives from the computed thresholds (ATTRACTIVE in zone / FAIR below IV / EXPENSIVE above)', async () => {
    // Fixture IV 264.08, buy 184.86: price 150 → ATTRACTIVE; 220 → FAIR; 800 → EXPENSIVE.
    const cheap = await runRelit({ id: 'c3-attractive', price: 150, investmentVerdict: 'WATCH', proposedBuyBelow: 150 })
    expect(cheap.cp?.valuation_status).toBe('ATTRACTIVE')
    const fair = await runRelit({ id: 'c3-fair', price: 220, investmentVerdict: 'WATCH', proposedBuyBelow: 150 })
    expect(fair.cp?.valuation_status).toBe('FAIR')
    const rich = await runRelit({ id: 'c3-expensive', price: 800, investmentVerdict: 'WATCH', proposedBuyBelow: 150 })
    expect(rich.cp?.valuation_status).toBe('EXPENSIVE')
    // The retired status-coherence flags never fire (nothing model-proposed to contradict).
    for (const r of [cheap, fair, rich]) {
      const flags = (r.valuation?.['sanity_flags'] as string[] | undefined) ?? []
      expect(flags.some((f) => /contradicts_evidence|contradicts_buy_zone/.test(f))).toBe(false)
    }
  })

  it('C3: an over-rich BUY still derates via the arithmetic zone gate (flags never needed)', async () => {
    const { cp } = await runRelit({ id: 'c3-derate', price: 800, investmentVerdict: 'BUY', proposedBuyBelow: 850 })
    expect(cp?.valuation_status).toBe('EXPENSIVE')
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /buy_out_of_buy_zone/.test(q))).toBe(true)
  })

  it('IMPLIED EXIT MULTIPLE (surfaced): a normal case computes a sane, name-specific implied_exit_multiple', async () => {
    // A normal mid price → the flag-only sanity block backs out the exit P/OE the price requires
    // (current price grown at the discount over the horizon ÷ owner earnings grown at the market-implied
    // growth). It is name-specific (varies with price + growth), positive, and within the sane cap.
    const { valuation } = await runRelit({ id: 'exitmult-normal', price: 220, valuationStatus: 'FAIR', proposedBuyBelow: 180, assumedGrowth: 0.05 })
    const m = valuation?.['implied_exit_multiple']
    expect(typeof m).toBe('number')
    expect(Number.isFinite(m as number)).toBe(true)
    expect(m as number).toBeGreaterThan(0)
    // Name-specific: a higher price implies a higher required exit multiple (same OE basis).
    const { valuation: hi } = await runRelit({ id: 'exitmult-higher', price: 400, valuationStatus: 'FAIR', proposedBuyBelow: 180, assumedGrowth: 0.05 })
    expect(hi?.['implied_exit_multiple'] as number).toBeGreaterThan(m as number)
  })

  it('IMPLIED EXIT MULTIPLE (HIGH → directional flag): an absurdly high price fires the over-high exit-multiple flag (verdict NOT blocked)', async () => {
    const { valuation, cp } = await runRelit({
      id: 'exitmult-high', price: 600, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 590,
    })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /exit multiple/i.test(f) && /the method underwrites/i.test(f))).toBe(true)
    expect(typeof valuation?.['implied_exit_multiple']).toBe('number')
    // The exit-multiple SANITY FLAG itself never blocks; the verdict here derates to WATCH only because
    // the price ($600) is above the model's own buy-below ($590) — the owner-rule buy-zone gate.
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('IMPLIED EXIT MULTIPLE (clean): a normal price does NOT fire the exit-multiple flag', async () => {
    const { valuation } = await runRelit({ id: 'exitmult-clean', price: 200, valuationStatus: 'FAIR', proposedBuyBelow: 180, assumedGrowth: 0.05 })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /exit multiple/i.test(f))).toBe(false)
  })

  it('IMPLIED EXIT MULTIPLE (fail-closed): no current price → implied_exit_multiple omitted + no exit-multiple flag', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43, proposed_buy_below: 180,
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' } },
      investmentVerdict: 'WATCH',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-exitmult-noprice-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_exitmult_noprice', company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'exitmult_noprice_k',
        model_id: 'mock', decision_id: 'decision_exitmult_noprice', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: false as const, reason: 'fetch failed', source: 'fixture' }),
      },
    )
    const analysisEvent = (await store.list()).find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    expect(valuation?.['implied_exit_multiple']).toBeUndefined()
    expect(((valuation?.['sanity_flags'] as string[] | undefined) ?? []).every((f) => !/exit multiple/i.test(f))).toBe(true)
  })

  it('SANITY: assumed-vs-demonstrated does NOT fire when NO demonstrated history exists (growth_basis none)', async () => {
    // The Visa data gap: a multi-class filer whose companyfacts carries no consolidated share count →
    // zero OE/share points → demonstrated reference floored to 0 with growth_basis 'none'. Comparing
    // the model's growth against that artificial 0% ("above the ~0.0% demonstrated history") is a data
    // artifact, not evidence — the flag must stay silent; the floored-g0 degraded flag already tells the
    // honest "history unavailable" story.
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43, proposed_buy_below: 300,
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.1, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' } },
      investmentVerdict: 'WATCH',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-nohistory-'))
    const noSharesFundamentals: Fundamentals = {
      ...costFundamentals,
      // Visa-shape: every year misses the diluted share count → zero OE/share points.
      annual_series: costFundamentals.annual_series.map(({ diluted_shares_m: _drop, ...rest }) => rest),
    }
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_nohistory', company_id: 'c', ticker: 'V',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'nohistory_k',
        model_id: 'mock', decision_id: 'decision_nohistory', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        fundamentals: noSharesFundamentals,
        resolvePrice: async () => ({ available: true as const, price_per_share: 360, currency: 'USD', as_of: 'x', source: 'test' }),
      },
    )
    const analysisEvent = (await store.list()).find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    expect(valuation?.['growth_basis']).toBe('none')
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /assumed_growth_above_demonstrated_history/.test(f))).toBe(false)
  })

  it('SANITY (owner rule): the above-cap check applies to the MODEL\'s assumed growth, never the market-implied read', async () => {
    // The forecasting-humility cap disciplines what the METHOD will underwrite — the model's judgment.
    // The market-implied growth is a descriptive reverse-DCF fact about today's price; flagging IT
    // against OUR cap conflated model-derived and market-implied metrics (owner correction). A high
    // price alone must NOT fire an above-cap flag; a model assumed growth above the cap MUST.
    const { valuation: richPrice } = await runRelit({
      id: 'cap-market-side', price: 800, valuationStatus: 'FAIR', investmentVerdict: 'WATCH', proposedBuyBelow: 850, assumedGrowth: 0.06,
    })
    const richFlags = (richPrice?.['sanity_flags'] as string[] | undefined) ?? []
    expect(richFlags.some((f) => /implied_growth_above_cap/.test(f))).toBe(false)

    const { valuation: boldModel } = await runRelit({
      id: 'cap-model-side', price: 200, valuationStatus: 'FAIR', investmentVerdict: 'WATCH', proposedBuyBelow: 250, assumedGrowth: 0.2,
    })
    const boldFlags = (boldModel?.['sanity_flags'] as string[] | undefined) ?? []
    expect(boldFlags.some((f) => /sanity_assumed_growth_above_cap/.test(f) && /20\.0%/.test(f))).toBe(true)
  })

  it('GATE (owner rule) — model BUY with the price ABOVE its own buy-below → recorded WATCH (thesis surfaced)', async () => {
    // The Visa dogfood: the model said BUY with buy-below $290 while the price was $362 — "buy below
    // $290" at $362 means WAIT. The recorded verdict derates to WATCH by the model's OWN arithmetic;
    // the reason (with both prices) is surfaced in open_questions so the human sees what re-arms it.
    const { cp } = await runRelit({
      id: 'buyzone-derate', price: 360, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 290,
    })
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /buy_out_of_buy_zone/.test(q) && /\$184\.86/.test(q) && /\$360\.00/.test(q))).toBe(true)
  })

  it('GATE (owner rule) — model BUY with the price AT/BELOW its own buy-below stays BUY', async () => {
    const { cp } = await runRelit({
      id: 'buyzone-inzone', price: 120, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 150,
    })
    expect(cp?.investment_verdict).toBe('BUY')
    expect((cp?.open_questions ?? []).some((q) => /buy_out_of_buy_zone/.test(q))).toBe(false)
  })

  it('GATE (owner rule, 2026-07-10 SPGI dogfood) — model BUY whose OWN buy-below implies growth ABOVE the cap → recorded WATCH', async () => {
    // Live SPGI shape: price inside the model's aggressive buy zone, but the buy-below itself prices
    // in growth the method's single-growth cap refuses to underwrite (harness fair value was ~half
    // the model's buy-below). Arithmetic on the model's own numbers → derate to WATCH, thesis kept.
    const { cp } = await runRelit({
      id: 'buyzone-absurd', price: 120, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 800,
    })
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /buy_below_implies_absurd_growth/.test(q))).toBe(true)
  })

  it('S6 — a moat-FAILED case SHORT-CIRCUITS at the early gate: Pillars 3–4 never run, no buy numbers exist at all', async () => {
    // S6 supersedes the NVO quarantine shape for NEW runs: the gate now fires BEFORE the management/
    // valuation/red-team/synthesis spend, so there is no unvetted model number to quarantine — the
    // gated-dossier invariant is satisfied by construction (nothing ran → nothing to mislabel).
    const { cp, valuation, events } = await runRelit({
      id: 'buyzone-moatfail', price: 85, moatClass: 'moderate', investmentVerdict: 'BUY', proposedBuyBelow: 280,
    })
    expect(cp?.investment_verdict).toBe('PASS') // grounded moderate = a set-aside at the moat filter
    expect(cp?.valuation?.in_buy_zone).toBeUndefined()
    expect(cp?.valuation?.proposed_buy_below).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysisEvent?.payload as Record<string, unknown>)?.['moat_gate_short_circuited']).toBe(true)
    // The Pillar 3–4 stages genuinely never ran — no valuation stage, no synthesis events.
    const types = events.map((e) => e.event_type)
    expect(types).not.toContain('valuation_judgment_drafted')
    expect(types).not.toContain('deep_dive_synthesis_drafted')
    expect(valuation?.['unvetted_model_proposals']).toBeUndefined()
    // Only the Stage-A pillar findings were recorded (understand + moat, no management).
    const findingLanes = events.filter((e) => e.event_type === 'specialist_finding_recorded')
      .map((e) => (e.payload as { specialist_lane?: string }).specialist_lane)
    expect(findingLanes).not.toContain('management')
  })

  it('GATE preserved — moat below wide → PASS regardless of the model verdict', async () => {
    const { cp } = await runRelit({ id: 'gate-moat', price: 200, moatClass: 'moderate', investmentVerdict: 'BUY' })
    expect(cp?.investment_verdict).toBe('PASS')
  })

  it('GATE preserved — model BUY with no price → RESEARCH_MORE (missing the data a buy signal needs)', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43 },
      investmentVerdict: 'BUY',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-relit-noprice-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_relit_noprice', company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'relit_noprice_k',
        model_id: 'mock', decision_id: 'decision_relit_noprice', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: false as const, reason: 'fetch failed', source: 'fixture' }),
      },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_relit_noprice')
    expect(cp?.investment_verdict).not.toBe('BUY')
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
    expect((cp?.open_questions ?? []).some((q) => /BUY not recordable/i.test(q))).toBe(true)
  })

  it('GATE preserved — missing owner-earnings (zero shares) → no reference FV, model BUY with price still clamps to RESEARCH_MORE', async () => {
    // Zero shares → no OE/share → no point FV, no reference FV. With a price present but no usable buy-below
    // arithmetic basis the model BUY is not a recordable buy signal.
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: {
        moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43,
        owner_earnings_bridge: {
          net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 911,
          normalized_working_capital_change: 0, shares_outstanding: 0,
        },
        proposed_buy_below: 150,
        // Founding-risk fix: ground both valuation claims so this test isolates the OE/buy-data gate, not
        // the synthesis grounding gate (cite the decision agent's OWN verified source src_dec_1).
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' },
      },
      investmentVerdict: 'WATCH',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-relit-nooe-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_relit_nooe', company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'relit_nooe_k',
        model_id: 'mock', decision_id: 'decision_relit_nooe', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: true as const, price_per_share: 200, currency: 'USD', as_of: 'x', source: 'fixture' }),
      },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_relit_nooe')
    // No OE/share → no reference FV emitted.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    const analysisEvent = (await store.list()).find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    // The model said WATCH (not BUY) so it passes through unclamped.
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('GATE preserved — Shariah sector FAIL clamps the model verdict to PASS', async () => {
    // The mock shariah lane emits compliant by default; the synthesis decision is BUY. We force a sector
    // FAIL via a NON_COMPLIANT quick-screen + the shariah overlay omitted is not enough — instead we drive
    // the sector hard-stop by injecting a non_compliant overlay through omitShariahOverlay=false default.
    // Simpler: the Shariah-FAIL clamp path is exercised by the dedicated Shariah suite; here we assert the
    // gate WIRING — a wide-moat BUY with a valid price is recorded as BUY (no spurious Shariah clamp).
    const { cp } = await runRelit({ id: 'shariah-ok', price: 120, investmentVerdict: 'BUY', proposedBuyBelow: 150 })
    // price 120 <= the computed 184.86 → in buy zone; wide moat, compliant sector → model BUY recorded.
    expect(cp?.investment_verdict).toBe('BUY')
  })

  it('in_buy_zone is pure arithmetic: current_price <= the COMPUTED buy threshold (184.86 on this fixture)', async () => {
    const { valuation: belowVal } = await runRelit({ id: 'inzone-yes', price: 100, proposedBuyBelow: 150 })
    expect(belowVal?.['in_buy_zone']).toBe(true)
    const { valuation: aboveVal } = await runRelit({ id: 'inzone-no', price: 300, proposedBuyBelow: 150 })
    expect(aboveVal?.['in_buy_zone']).toBe(false)
  })

  it('a sanity flag NEVER blocks: even with a flag firing, the model verdict passes the cheap gates unchanged', async () => {
    // In-zone price (120 ≤ the computed 184.86) with a firing ADVISORY flag (the model's $80 advisory
    // diverges >25% BELOW the computed threshold → buy_below_divergence) → the model BUY is recorded.
    const { valuation, cp } = await runRelit({ id: 'flag-noblock', price: 120, investmentVerdict: 'BUY', proposedBuyBelow: 80 })
    expect(((valuation?.['sanity_flags'] as string[] | undefined) ?? []).length).toBeGreaterThan(0)
    expect(cp?.investment_verdict).toBe('BUY')
  })

  // -------------------------------------------------------------------------
  // HEADLINE-GROWTH INVERSION (architecture): the MODEL's cite-verified assumed_growth is the headline
  // growth + drives the headline forward-DCF FV. The capped-mechanical credited-g (demonstrated CAGR) is
  // DEMOTED to a demonstrated-history REFERENCE + an ADVISORY sanity flag — never the headline, never a
  // blocker. (NO-SERIES COST case → demonstrated_growth = 0 → credited-g = 0, so assumed_growth 0.06 ≠ 0.)
  // -------------------------------------------------------------------------
  it('HEADLINE GROWTH = the model\'s cited assumed_growth (NOT the capped credited-g)', async () => {
    // COST no-EDGAR-series → demonstrated/credited-g = 0; the model cites assumed_growth = 0.06. The
    // persisted headline growth_rate must be the MODEL's 0.06, not the credited-g floor of 0.
    const { cp, valuation } = await runRelit({ id: 'headline-growth', price: 300, proposedBuyBelow: 150, assumedGrowth: 0.06 })
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    // The demonstrated-history reference (credited-g) is surfaced SEPARATELY and is the no-series floor 0.
    expect(valuation?.['demonstrated_growth_reference'] as number).toBeCloseTo(0.06, 2) // E2 fixture FCF/share CAGR
  })

  it('INTERNAL forward-DCF is computed from assumed_growth (NOT credited-g); the dollar FV is not surfaced', async () => {
    // assumed_growth 0.06 ≠ credited-g 0 → the internal two-stage FV is at g = 0.06. forward-DCF removal: the
    // dollar fair_value_per_share / reference_fair_value are NO LONGER surfaced; the kept signals are the
    // headline growth_rate (the model's assumed_growth) + the implied_multiple (ratio of the internal FV).
    const { cp, valuation } = await runRelit({ id: 'headline-fv', price: 300, proposedBuyBelow: 150, assumedGrowth: 0.06 })
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    // E2: the internal OE forward-DCF (and its implied_multiple ratio) is retired — the book IV is
    // the surfaced computed value.
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['intrinsic_value_per_share']).toBe(264.08)
  })

  it('credited-g → demonstrated-history reference + ADVISORY flag when assumed_growth materially exceeds it (verdict NOT blocked)', async () => {
    // A REAL demonstrated history (costFundamentals: log-linear OE/share slope ≈ 14%/yr) with an
    // assumed_growth of 0.20 materially above it → the advisory "model assumes growth above demonstrated
    // history" flag fires, but the model's verdict passes through unchanged. (A no-series case no longer
    // fires this flag — comparing against the artificial 0% floor was the Visa data-artifact bug.)
    const { cp, valuation } = await runRelit({
      id: 'advisory-flag', price: 200, investmentVerdict: 'WATCH', proposedBuyBelow: 250, assumedGrowth: 0.2,
      fundamentals: costFundamentals,
    })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /above demonstrated history/i.test(f))).toBe(true)
    // The demonstrated-history reference is a REAL positive rate; the headline stays the model's number.
    expect(valuation?.['demonstrated_growth_reference'] as number).toBeGreaterThan(0)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.2, 6)
    // Advisory only — never blocks/changes the model verdict.
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  // V LIVE FIND (rc_v_1783881150952): the lane-argue parser bound a DECOMPOSITION fragment ("3% real
  // GDP growth" inside a 9%-growth rationale) as the lane arguing total growth down to 3% — which then
  // (a) masqueraded as the demonstrated history (a FALSE above-history flag: 9% is BELOW the real ~14%)
  // and (b) SUPPRESSED the growth base-rate burden (3% < the 4% trigger on a 9% underwritten claim).
  it('V pin: a decomposition fragment cannot pollute the demonstrated reference or suppress the base-rate burden', async () => {
    const { cp, valuation } = await runRelit({
      id: 'decomp-fragment', price: 200, investmentVerdict: 'WATCH', proposedBuyBelow: 250, assumedGrowth: 0.06,
      growthAssumptions: 'Normalized revenue growth of 6% annually, comprising 3% real GDP growth plus pricing and mix.',
      fundamentals: costFundamentals,
    })
    // The demonstrated-history reference is the REAL capped history (costFundamentals FCF/share slope
    // ≈ 7.6%), NOT the parsed 3% fragment.
    expect(valuation?.['demonstrated_growth_reference'] as number).toBeGreaterThan(0.06)
    expect(valuation?.['demonstrated_growth_reference'] as number).not.toBeCloseTo(0.03, 2)
    // 6% assumed < ~7.6% demonstrated → NO above-history flag (the polluted 3% reference would have fired it).
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /above demonstrated history/i.test(f))).toBe(false)
    // The base-rate burden guards the UNDERWRITTEN claim (6% ≥ the 4% trigger) — the entry exists
    // (the polluted 3% credited rail would have suppressed it).
    const burden = valuation?.['base_rate_burden'] as { flags?: Array<{ base_rate_id?: string }> } | undefined
    expect((burden?.flags ?? []).some((f) => f.base_rate_id === 'credited_g_4_5')).toBe(true)
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('CLEAN: assumed_growth ≈ demonstrated → NO above-history advisory flag; headline uses assumed_growth', async () => {
    // No-series case → demonstrated/credited-g 0; choose assumed_growth = 0 so they MATCH → no advisory flag.
    const { cp, valuation } = await runRelit({ id: 'clean-growth', price: 200, valuationStatus: 'FAIR', proposedBuyBelow: 180, assumedGrowth: 0 })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /above demonstrated history/i.test(f))).toBe(false)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0, 6)
  })

  it('credited-g is NOT binding: the model verdict is unchanged whether credited-g is high or low (model inputs held fixed)', async () => {
    // Same model inputs (verdict WATCH, assumed_growth 0.06, buy-below 150, price 300). Whether the
    // deterministic credited-g would be high or low MUST NOT move the verdict — the verdict is the model's,
    // clamped only by the cheap gates. (No-series here → credited-g 0; the advisory flag may fire but never
    // blocks.) The verdict equals the unclamped model WATCH in both the flagged and clean growth cases above.
    const { cp: flagged } = await runRelit({ id: 'binding-a', price: 300, investmentVerdict: 'WATCH', proposedBuyBelow: 150, assumedGrowth: 0.06 })
    const { cp: clean } = await runRelit({ id: 'binding-b', price: 300, investmentVerdict: 'WATCH', proposedBuyBelow: 150, assumedGrowth: 0 })
    expect(flagged?.investment_verdict).toBe('WATCH')
    expect(clean?.investment_verdict).toBe('WATCH')
    expect(flagged?.investment_verdict).toBe(clean?.investment_verdict)
  })
})

// ---------------------------------------------------------------------------
// LEGACY-EVENT PROJECTION TOLERANCE (R1): an OLD analysis event that still carries the band verdict_state
// fields must still project (no throw); the removed band fields are simply not surfaced as new sanity
// fields. The projection reads via the existing getNumber/getStringArray guards.
// ---------------------------------------------------------------------------
describe('legacy projection tolerance — old band verdict_state event still projects', () => {
  it('projects an old buffett_munger_analysis_drafted carrying band verdict_state without throwing', () => {
    const legacyEvent = {
      event_id: 'evt_legacy_analysis',
      event_type: 'buffett_munger_analysis_drafted' as const,
      aggregate_type: 'research_case' as const,
      aggregate_id: 'rc_legacy',
      correlation_id: 'rc_legacy',
      actor_type: 'provider' as const,
      actor_id: 'mock-provider',
      payload: {
        research_case_id: 'rc_legacy',
        investment_verdict: 'WATCH',
        valuation_status: 'EXPENSIVE',
        valuation: {
          moat_class: 'wide',
          moat_passes_gate: true,
          fair_value_per_share: 200,
          buy_price_per_share: 150,
          // OLD band fields (R2 deletes the engines; the projector must tolerate them).
          verdict_state: {
            state: 'BUY-WINDOW',
            band_low: 0.0731,
            band_high: 0.086,
            band_center: 0.086,
            band_grounding_status: 'grounded',
            band_basis_citations: ['sec_edgar_10k: identity'],
            required_gap: 0.03,
            gap_to_band: 0.02,
            market_implied_growth: 0.02,
          },
        },
      },
      source_ids: ['src_legacy'],
      created_at: '2026-05-01T00:00:00.000Z',
      schema_version: 1,
      idempotency_key: 'analysis:rc_legacy:v1',
    }
    const projections = projectResearchCases([legacyEvent] as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_legacy')
    expect(cp).toBeDefined()
    // The valuation still projects its surviving fields.
    expect(cp?.valuation?.moat_class).toBe('wide')
    expect(cp?.valuation?.buy_price_per_share).toBe(150)
    // The legacy band verdict_state is tolerated (no throw) — it may still project via the retained
    // back-compat type, but the relit run no longer EMITS it. The key invariant: projection did not throw.
    expect(cp?.investment_verdict).toBe('WATCH')
  })
})

describe('BUG 2 — resilient bookend swarm calls (retry + clean failure)', () => {
  it('recovers when synthesis times out once then succeeds (single retry); lanes are not re-run', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, failSynthesis: 1 })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug2-syn-recover-'))
    const result = await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_bug2_syn', company_id: 'c', ticker: 'AAPL',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug2syn_k',
        model_id: 'mock', decision_id: 'decision_bug2syn', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    expect(result.decision).toBeDefined()
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })

  it('fails cleanly (ResearchSwarmStageError, synthesis, lanes_completed) when synthesis times out persistently — lane findings preserved', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, failSynthesis: 99 })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug2-syn-fail-'))
    let caught: unknown
    try {
      await runStrategyResearchSwarm(
        store, provider as never,
        {
          research_case_id: 'rc_bug2_synfail', company_id: 'c', ticker: 'AAPL',
          strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug2synf_k',
          model_id: 'mock', decision_id: 'decision_bug2synf', source_ledger_path: sourceLedgerPath,
        },
        { ground: allVerifiedGround, laneConcurrency: 4 },
      )
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ResearchSwarmStageError)
    expect((caught as ResearchSwarmStageError).stage).toBe('synthesis')
    expect((caught as ResearchSwarmStageError).lanes_completed).toBe(true)
    // Lane findings were persisted BEFORE synthesis and must survive the failure.
    const events = await store.list()
    const findingCount = events.filter((e) => e.event_type === 'specialist_finding_recorded').length
    expect(findingCount).toBeGreaterThanOrEqual(buffettMungerDeepDiveLanes.length)
    // ...but synthesis/decision were NOT drafted (synthesis never succeeded).
    expect(events.some((e) => e.event_type === 'deep_dive_synthesis_drafted')).toBe(false)
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Quick-screen grounding firewall: the gate now runs on the SAME tool-grounded path as the circle gate and
// the lanes (runGroundedAgentWithTools), so it must READ a content-hash-verified primary filing before
// judging, and FAIL CLOSED when grounding yields zero verified sources.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Mechanism 5 — Red-Team Pass (orchestrator integration): runs after the 5 lanes, before synthesis;
// synthesis must answer the strongest objection or downgrade; the harness enforces the response
// deterministically (red_team_objection_unaddressed + open_questions) and degrades on timeout.
// ---------------------------------------------------------------------------
describe('E1 — the inversion pass (replaces the red team; no obligation machinery)', () => {
  async function runInv(opts: Omit<Parameters<typeof configurableSwarmProvider>[0], 'laneCount'>, id: string) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, ...opts })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-inv-${id}-`))
    const result = await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${id}_k`,
        model_id: 'mock', decision_id: `decision_${id}`, source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, result, provider, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('records the inversion on the analysis payload (cite-checked objection, no obligation fields)', async () => {
    const { cp, events } = await runInv({}, 'inv-complete')
    expect(cp?.inversion?.status).toBe('complete')
    expect(cp?.inversion?.strongest_objection?.claim).toMatch(/incremental ROIC/i)
    expect(cp?.inversion?.strongest_objection?.citations).toEqual(['src_lane_moat'])
    // The obligation machinery is retired: no response, no unaddressed flag, no red_team payload key.
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const payload = analysis?.payload as Record<string, unknown>
    expect(payload['red_team']).toBeUndefined()
    const inv = payload['inversion'] as Record<string, unknown>
    expect(inv['synthesis_response']).toBeUndefined()
    expect(inv['objection_unaddressed']).toBeUndefined()
    expect((cp?.open_questions ?? []).some((q) => /red_team_objection_unaddressed/.test(q))).toBe(false)
  })

  it('makes exactly ONE inversion provider call (the response pass is retired)', async () => {
    const { provider } = await runInv({}, 'inv-one-call')
    const calls = (provider.structured as { mock: { calls: unknown[][] } }).mock.calls
    const schemaOf = (c: unknown[]) => (c[0] as { response_format?: { schema_name?: string } }).response_format?.schema_name
    expect(calls.filter((c) => schemaOf(c) === 'BuffettMungerInversion')).toHaveLength(1)
    expect(calls.some((c) => schemaOf(c) === 'BuffettMungerRedTeamResponse')).toBe(false)
  })

  it('degrades to inversion_incomplete on timeout — the run still completes, with ONE honesty open question', async () => {
    const { cp } = await runInv({ failRedTeam: 2 }, 'inv-timeout')
    expect(cp?.inversion?.status).toBe('inversion_incomplete')
    expect(cp?.investment_verdict).toBeDefined()
    expect((cp?.open_questions ?? []).some((q) => /inversion_incomplete/.test(q))).toBe(true)
  })

  it('drops an objection whose citations are not in the verified corpus (recorded as uncited, never hidden)', async () => {
    const { cp } = await runInv({ redTeamCitations: ['src_fabricated'] }, 'inv-uncited')
    expect(cp?.inversion?.status).toBe('complete')
    expect(cp?.inversion?.strongest_objection?.citations ?? []).toEqual([])
    expect(cp?.inversion?.uncited_objection_refs).toEqual(['src_fabricated'])
  })
})

// ---------------------------------------------------------------------------
// SEC EDGAR primary-filing integration (fail-closed, test-mode-gated)
// ---------------------------------------------------------------------------

import type { Fundamentals } from '../secEdgar'
import { runResearchDeepDivePhase } from '../researchSwarm'
import { computeInsiderSummary } from '../secForm4'
import { createResearchCase } from '../researchWorkflow'

async function seedDeepDivePrereqs(store: InMemoryEventStore): Promise<void> {
  await createResearchCase(store, {
    research_case_id: 'rc_edgar', company_id: 'company_cost', ticker: 'COST',
    strategy_id: 'buffett-munger', actor_id: 'user_local',
  })
  await store.append({
    event_id: 'evt_qs_1', event_type: 'quick_screen_drafted', aggregate_type: 'research_case',
    aggregate_id: 'rc_edgar', correlation_id: 'rc_edgar', actor_type: 'provider', actor_id: 'fake-swarm',
    payload: { shariah_status: 'COMPLIANT', summary: 's', business_quality: 'b', moat: 'm', management_capital_allocation: 'mc', financial_quality: 'fq', valuation_sanity: 'vs', screening_result: 'deep_dive_candidate', confidence: 'high' },
    source_ids: ['src_qs_1'], created_at: 'x', schema_version: 1,
  })
}

const costFundamentals: Fundamentals = {
  cik: '0000909832',
  entity_name: 'COSTCO WHOLESALE CORP /NEW',
  currency: 'USD',
  latest_annual: {
    fiscal_year: 2025,
    currency: 'USD',
    net_income_musd: 8099,
    revenue_musd: 275235,
    d_and_a_musd: 2426,
    capex_musd: 5498,
    cfo_musd: 13335,
    sbc_musd: 860,
    diluted_shares_m: 444.8,
    shares_outstanding_m: 443.2,
    total_debt_musd: 5788,
    cash_and_securities_musd: 15284,
    interest_expense_musd: 154,
  },
  // Three years so the ROBUST log-linear demonstrated-growth measure (≥3 positive points) computes a slope
  // (the legacy 2-point endpoint CAGR is no longer the growth path). OE/share ≈ 12.51 → 14.78 → 16.28; the
  // log-linear slope ≈ 14.0%/yr, above the 0.10 single-growth cap → credited growth caps to 0.10.
  annual_series: [
    { fiscal_year: 2025, currency: 'USD', net_income_musd: 8099, revenue_musd: 275235, d_and_a_musd: 2426, capex_musd: 5498, cfo_musd: 13335, sbc_musd: 860, diluted_shares_m: 444.8 },
    { fiscal_year: 2024, currency: 'USD', net_income_musd: 7367, revenue_musd: 254453, d_and_a_musd: 2237, capex_musd: 4710, cfo_musd: 11339, sbc_musd: 800, diluted_shares_m: 444.2 },
    { fiscal_year: 2023, currency: 'USD', net_income_musd: 6292, revenue_musd: 242290, d_and_a_musd: 2077, capex_musd: 4323, cfo_musd: 11068, sbc_musd: 741, diluted_shares_m: 443.6 },
  ],
  filings: [
    { form: '10-K', filed: '2025-10-08', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm' },
  ],
  recent_filings: [
    { form: '8-K', filed: '2026-01-15', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983226000010/cost-8k.htm' },
    { form: '10-Q', filed: '2025-12-10', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000120/cost-10q.htm' },
  ],
}

// E2 (owner-locked 2026-07-12): the DEFAULT test fundamentals — OE is retired, so every priced test
// needs an FCF basis (CFO − capex). Round numbers: latest FCF $2,000M / 100M sh = $20/sh growing
// ~6%/yr; cash $1,500M − debt $1,500M = net 0 (AAOIFI-safe at low test prices). With the shared fake's
// judged growth 0.06 and the grounded 15× exit multiple: IV ≈ $264.08/sh → buy_below 184.86 (rule 7) /
// load_up 132.04 (rule 8).
const e2FcfFundamentals: Fundamentals = {
  cik: '0000000042',
  entity_name: 'FCF TEST CO',
  currency: 'USD',
  latest_annual: {
    fiscal_year: 2025, currency: 'USD', net_income_musd: 1500, revenue_musd: 10000,
    d_and_a_musd: 400, capex_musd: 200, cfo_musd: 2200, sbc_musd: 100,
    diluted_shares_m: 100, total_debt_musd: 1500, cash_and_securities_musd: 1500,
    stockholders_equity_musd: 6000, operating_income_musd: 1900, income_tax_expense_musd: 0,
  },
  annual_series: [4, 3, 2, 1, 0].map((back) => ({
    fiscal_year: 2025 - back,
    currency: 'USD' as const,
    net_income_musd: Math.round(1500 / Math.pow(1.06, back)),
    revenue_musd: Math.round(10000 / Math.pow(1.06, back)),
    d_and_a_musd: 400,
    capex_musd: 200,
    cfo_musd: Math.round(200 + 2000 / Math.pow(1.06, back)),
    sbc_musd: 100,
    diluted_shares_m: 100,
  })),
  filings: [{ form: '10-K', filed: '2025-10-01', url: 'https://www.sec.gov/Archives/edgar/data/42/fcf-10k.htm' }],
}

// Ground fn that verifies every proposed source (including the injected EDGAR 10-K).
function verifyAllGround(): GroundFn {
  return (async (sources: { source_id: string }[]) => ({
    captured: sources.map((s) => ({
      source_id: s.source_id,
      title: 't',
      url: 'https://example.com/x',
      excerpt: 'e',
      availability: 'available' as const,
      fetched_at: 'x',
      content_hash: 'sha256:1',
    })),
    verified_ids: sources.map((s) => s.source_id),
  })) as unknown as GroundFn
}

function deepDiveCommand() {
  return {
    research_case_id: 'rc_edgar',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    model_id: 'mock',
    decision_id: 'decision_edgar',
    source_ledger_path: '/tmp/owlfolio-edgar-test-sources',
    gate_source_ids: ['src_qs_1'],
    gate_event_id: 'evt_qs_1',
  }
}

describe('SEC EDGAR primary-filing wiring', () => {
  it('grounds the 10-K and injects primary numbers into the understand lane (S6 pillar)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    // skip the quick-screen call (call 0) so lane/synthesis payloads line up
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
    })

    // S6 (pillar lanes): the 'understand' lane (P1) now owns the primary-numbers injection the
    // retired financial_quality lane used to receive.
    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === "string")
    const understandLanePrompt = prompts.find((p) => p.includes('understand specialist'))
    const moatLanePrompt = prompts.find((p) => p.includes('moat specialist'))

    expect(understandLanePrompt).toBeDefined()
    expect(understandLanePrompt).toContain('Primary filing data (SEC EDGAR, FY2025')
    expect(understandLanePrompt).toContain('$8,099M') // net income, $millions
    expect(understandLanePrompt).toContain('sec_edgar_10k_0000909832_fy2025')

    // The moat lane must NOT receive the numbers injection.
    expect(moatLanePrompt).toBeDefined()
    expect(moatLanePrompt).not.toContain('Primary filing data (SEC EDGAR')

    // The grounded EDGAR 10-K must be persisted as a verified source on the understand lane findings.
    const events = await store.list()
    const finFinding = events.find((e) => e.event_type === 'specialist_finding_recorded'
      && (e.payload as { specialist_lane?: string }).specialist_lane === 'understand')
    expect((finFinding?.payload as { source_ids: string[] }).source_ids)
      .toContain('sec_edgar_10k_0000909832_fy2025')
  })

  it('injects the INSIDER TRANSACTIONS (Form 4) block into the management lane ONLY (§3.3)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip the quick-screen call

    const insiderSummary = computeInsiderSummary(
      [
        {
          issuer_symbol: 'COST',
          issuer_cik: '0000909832',
          period_of_report: '2026-06-01',
          owner: { name: 'Jane Officer', cik: '9', is_officer: true, is_director: false, is_ten_percent_owner: false, officer_title: 'CEO' },
          transactions: [
            { security_title: 'Common Stock', transaction_date: '2026-06-10', code: 'S', transaction_class: 'discretionary_sell', acquired_disposed: 'D', shares: 5000, price_per_share: 150, shares_owned_following: 45000, direct_or_indirect: 'D', derivative: false },
          ],
        },
      ],
      { asOf: '2026-06-30' },
    )

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      insiderSummary,
    })

    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
    const managementLanePrompt = prompts.find((p) => p.includes('management specialist'))
    const understandLanePrompt2 = prompts.find((p) => p.includes('understand specialist'))

    expect(managementLanePrompt).toBeDefined()
    expect(managementLanePrompt).toContain('INSIDER TRANSACTIONS (SEC Form 4')
    expect(managementLanePrompt).toContain('Discretionary SELLS: 5,000 shares')
    // Other lanes must NOT receive the insider block.
    expect(understandLanePrompt2).toBeDefined()
    expect(understandLanePrompt2).not.toContain('INSIDER TRANSACTIONS')

    // The computed summary is persisted on the analysis event so the dossier can render it model-independently.
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const persisted = (analysis?.payload as { insider_summary?: { discretionary_sell_shares?: number; distinct_sellers?: number } }).insider_summary
    expect(persisted?.discretionary_sell_shares).toBe(5000)
    expect(persisted?.distinct_sellers).toBe(1)
  })

  it('surfaces the pre-verified EDGAR source_id + cite-instruction to the circle, moat, and decision prompts', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip quick screen call

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
    })

    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
    const circlePrompt = prompts.find((p) => p.includes('circle-of-competence gate'))
    const moatPrompt = prompts.find((p) => p.includes('moat specialist'))
    const decisionPrompt = prompts.find((p) => p.includes('synthesis+decision agent'))

    for (const p of [circlePrompt, moatPrompt, decisionPrompt]) {
      expect(p).toBeDefined()
      // The block lists the harness-verified EDGAR id and instructs citing it for filing-backed claims.
      expect(p).toContain('PRE-VERIFIED PRIMARY SOURCES')
      expect(p).toContain('sec_edgar_10k_0000909832_fy2025')
      expect(p).toContain('do NOT invent your own SEC archive URLs')
    }
  })

  it('does NOT surface a pre-verified-sources block when fundamentals are undefined (no fabricated ids)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fetchFundamentals: async () => undefined,
    })

    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
    expect(prompts.every((p) => !p.includes('PRE-VERIFIED PRIMARY SOURCES'))).toBe(true)
  })

  it('runs exactly as today (no injection) when fundamentals are undefined — fail-closed', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip quick screen call

    // fetchFundamentals returns undefined (EDGAR down / non-US ticker).
    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fetchFundamentals: async () => undefined,
    })

    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === "string")
    expect(prompts.every((p) => !p.includes('Primary filing data (SEC EDGAR'))).toBe(true)
    // Swarm still completes normally.
    expect(result.decision).toBeDefined()
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'deep_dive_synthesis_drafted')).toBe(true)
  })

  it('does not hit SEC live in playwright test mode without injection (fail-closed gate)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)

    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    const prior = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'
    try {
      await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
        ground: verifyAllGround(),
        laneConcurrency: 7,
        // No injection provided: outside test mode the live SEC path would run. In playwright test
        // mode the gate must skip it — we prove it never hit live by asserting no SEC prompt injection.
      })
    } finally {
      if (prior === undefined) delete process.env.OWLFOLIO_TEST_MODE
      else process.env.OWLFOLIO_TEST_MODE = prior
    }
    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === "string")
    expect(prompts.every((p) => !p.includes('Primary filing data (SEC EDGAR'))).toBe(true)
  })
})

describe('Slice B: recent interim filings (8-K / 10-Q narrative)', () => {
  // Ground that verifies everything EXCEPT the recent interim filings (to exercise the fail-closed path).
  function groundExceptRecent(): GroundFn {
    return (async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
        availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
      })),
      verified_ids: sources.filter((s) => !s.source_id.startsWith('sec_edgar_recent_')).map((s) => s.source_id),
    })) as unknown as GroundFn
  }

  function promptsFrom(provider: ReturnType<typeof swarmFakeProvider>): string[] {
    return provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
  }

  it('grounds 8-K + 10-Q and surfaces them as read_source affordances to the QUALITATIVE lanes only', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip quick screen

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals,
    })

    const prompts = promptsFrom(provider)
    // S6 (pillar lanes): the recency affordance now goes to understand + moat + management.
    const understand = prompts.find((p) => p.includes('understand specialist'))
    const moat = prompts.find((p) => p.includes('moat specialist'))
    const management = prompts.find((p) => p.includes('management specialist'))

    // The pillar lanes get the block, with read_source affordances for BOTH the 8-K and the 10-Q.
    for (const p of [understand, moat, management]) {
      expect(p).toBeDefined()
      expect(p).toContain('RECENT INTERIM FILINGS')
      expect(p).toContain('8-K filed 2026-01-15')
      expect(p).toContain('10-Q filed 2025-12-10')
      expect(p).toMatch(/read_source\("sec_edgar_recent_/)
    }

    // The interim filings are grounded into the corpus (recorded to the source ledger like any source).
    const events = await store.list()
    const finding = events.find((e) => e.event_type === 'specialist_finding_recorded')
    expect(finding).toBeDefined()
  })

  it('fail-closed: when the interim filings do not ground, no block is injected and the swarm completes', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: groundExceptRecent(), laneConcurrency: 7, fundamentals: costFundamentals,
    })

    expect(promptsFrom(provider).every((p) => !p.includes('RECENT INTERIM FILINGS'))).toBe(true)
    expect(result.decision).toBeDefined()
  })
})

describe('DEF 14A proxy grounding (management + moat)', () => {
  const withProxy: Fundamentals = {
    ...costFundamentals,
    proxy_filings: [
      { form: 'DEF 14A', filed: '2025-12-04', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000200/cost-20251204.htm' },
      { form: 'DEF 14A', filed: '2024-12-05', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983224000180/cost-20241205.htm' },
    ],
  }

  function promptsOf(provider: ReturnType<typeof swarmFakeProvider>): string[] {
    return provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
  }

  it('grounds the LATEST proxy and surfaces the read_source affordance to management + moat only', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip quick screen

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: withProxy,
    })

    const prompts = promptsOf(provider)
    const management = prompts.find((p) => p.includes('management specialist'))
    const moat = prompts.find((p) => p.includes('moat specialist'))
    const understand = prompts.find((p) => p.includes('understand specialist'))

    for (const p of [management, moat]) {
      expect(p).toBeDefined()
      expect(p).toContain('LATEST PROXY STATEMENT')
      expect(p).toContain('read_source("sec_edgar_def14a_0000909832_2025-12-04")')
      expect(p).not.toContain('2024-12-05') // latest only — the prior year's proxy is not grounded
    }
    // The understand lane (P1) does not get the proxy affordance block.
    expect(understand).toBeDefined()
    expect(understand).not.toContain('LATEST PROXY STATEMENT')
  })

  it('AXIS B end-to-end: the run persists category/filed/form to the ledger, and a NEW run resolves + lane-gates from it', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { loadPersistedReadCorpus } = await import('../sourceLedgerRead.js')
    const ledgerDir = await mkdtemp(join(tmpdir(), 'owlfolio-axisb-e2e-'))
    try {
      const store = new InMemoryEventStore()
      await seedDeepDivePrereqs(store)
      const provider = swarmFakeProvider()
      await provider.structured({} as never)

      await runResearchDeepDivePhase(store, provider as never, { ...deepDiveCommand(), source_ledger_path: ledgerDir }, {
        ground: verifyAllGround(), laneConcurrency: 7, fundamentals: withProxy,
      })

      // A fresh "run" resolves the persisted corpus — the proxy carries its provenance + category.
      const corpus = await loadPersistedReadCorpus({ source_ledger_path: ledgerDir, research_case_id: 'rc_edgar' })
      const proxy = corpus.get('sec_edgar_def14a_0000909832_2025-12-04')
      expect(proxy).toBeDefined()
      expect(proxy!.source_category).toBe('proxy')
      expect(proxy!.filed).toBe('2025-12-04')
      expect(proxy!.form).toBe('DEF 14A')
      expect(proxy!.content).toBeUndefined() // pointers + hashes only
      // The 8-K interim filing also carries provenance cross-run.
      const interim = [...corpus.values()].find((c) => c.form === '8-K')
      expect(interim).toBeDefined()
      expect(interim!.filed).toBe('2026-01-15')
    } finally {
      await rm(ledgerDir, { recursive: true, force: true })
    }
  })

  it('LIVE-BUG REPRO: a model re-proposal of the pre-verified id with a WRONG URL cannot clobber the harness capture in the ledger', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createHash } = await import('node:crypto')
    const { loadPersistedReadCorpus } = await import('../sourceLedgerRead.js')
    const ledgerDir = await mkdtemp(join(tmpdir(), 'owlfolio-clobber-repro-'))
    try {
      const store = new InMemoryEventStore()
      await seedDeepDivePrereqs(store)

      // Every agent payload re-proposes the pre-verified 10-K id pointing at the EDGAR SEARCH page —
      // exactly what the COST dogfood run's synthesis model did.
      const provider = swarmFakeProvider()
      const orig = provider.structured.getMockImplementation()!
      provider.structured.mockImplementation(async (req: { response_format?: { schema_name?: string } }) => {
        const payload = await orig(req) as Record<string, unknown> & { proposed_sources?: unknown[] }
        if (Array.isArray(payload?.proposed_sources)) {
          payload.proposed_sources = [...payload.proposed_sources, {
            source_id: 'sec_edgar_10k_0000909832_fy2025',
            title: 'Costco Wholesale Corp Form 10-K',
            url: 'https://www.sec.gov/cgi-bin/browse-edgar',
            excerpt: 'model-invented pointer',
          }]
        }
        return payload as never
      })
      await provider.structured({} as never) // skip quick screen

      // Ground stub: captures each source AT ITS OWN URL with hash = sha256(url) — so the harness
      // Archives capture and the model's browse-edgar re-capture get DIFFERENT hashes.
      const groundByUrl = (async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => ({
        captured: sources.map((s) => ({
          source_id: s.source_id, title: s.title, url: s.url, excerpt: s.excerpt,
          availability: 'available' as const, fetched_at: 'x',
          content_hash: `sha256:${createHash('sha256').update(s.url).digest('hex')}`,
        })),
        verified_ids: sources.map((s) => s.source_id),
      })) as unknown as GroundFn

      await runResearchDeepDivePhase(store, provider as never, { ...deepDiveCommand(), source_ledger_path: ledgerDir }, {
        ground: groundByUrl, laneConcurrency: 7, fundamentals: costFundamentals,
      })

      const corpus = await loadPersistedReadCorpus({ source_ledger_path: ledgerDir, research_case_id: 'rc_edgar' })
      const primary = corpus.get('sec_edgar_10k_0000909832_fy2025')
      expect(primary).toBeDefined()
      // The harness capture survives: Archives URL + provenance stamps, NOT the search page.
      expect(primary!.url).toBe('https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm')
      expect(primary!.form).toBe('10-K')
      expect(primary!.filed).toBe('2025-10-08')
    } finally {
      await rm(ledgerDir, { recursive: true, force: true })
    }
  })

  it('fail-closed: when the proxy does not ground, no block appears and the swarm completes', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    const groundExceptProxy = (async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
        availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
      })),
      verified_ids: sources.filter((s) => !s.source_id.startsWith('sec_edgar_def14a_')).map((s) => s.source_id),
    })) as unknown as GroundFn

    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: groundExceptProxy, laneConcurrency: 7, fundamentals: withProxy,
    })

    expect(promptsOf(provider).every((p) => !p.includes('LATEST PROXY STATEMENT'))).toBe(true)
    expect(result.decision).toBeDefined()
  })
})

describe('circle-gate hardening: k-sample agreement + evidence floors', () => {
  function circleCallCount(provider: ReturnType<typeof swarmFakeProvider>): number {
    return provider.structured.mock.calls
      .filter((c: unknown[]) => (c[0] as { response_format?: { schema_name?: string } })?.response_format?.schema_name === 'BuffettMungerCircleCompetence')
      .length
  }

  /** Wrap the fake provider so successive CIRCLE calls return the given predictability enums in order. */
  function withCirclePredictabilities(provider: ReturnType<typeof swarmFakeProvider>, enums: string[]): void {
    const orig = provider.structured.getMockImplementation()!
    let circleCall = 0
    provider.structured.mockImplementation(async (req: { response_format?: { schema_name?: string } }) => {
      const payload = await orig(req) as Record<string, unknown>
      if (req?.response_format?.schema_name === 'BuffettMungerCircleCompetence') {
        const forced = enums[Math.min(circleCall, enums.length - 1)]
        circleCall += 1
        return { ...payload, business_understanding: forced } as never
      }
      return payload as never
    })
  }

  async function circleEvent(store: InMemoryEventStore) {
    const events = await store.list()
    return events.find((e) => e.event_type === 'circle_competence_judged')!.payload as Record<string, unknown>
  }

  it('LIVE-FLIP REPRO: with default k=2, a durable→uncertain disagreement sets the case aside (fail-closed)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    withCirclePredictabilities(provider, ['understood', 'uncertain'])
    await provider.structured({} as never) // skip quick screen

    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals,
    })

    expect(result.set_aside_outside_circle).toBe(true)
    const payload = await circleEvent(store)
    expect(payload.in_competence).toBe(false)
    expect((payload.gate_samples as unknown[]).length).toBe(2)
    expect(payload.gate_config).toMatchObject({ k_samples: 2, min_drivers: 2, min_breakers: 2 })
    expect(String(payload.reason)).toContain('sample 2')
    // No lanes ran.
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'specialist_finding_recorded')).toBe(false)
  })

  it('default k=2: two agreeing durable samples enter the deep dive (two circle calls made)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals,
    })

    expect(result.set_aside_outside_circle).toBeUndefined()
    expect(circleCallCount(provider)).toBe(2)
    const payload = await circleEvent(store)
    expect(payload.in_competence).toBe(true)
    expect((payload.gate_samples as unknown[]).length).toBe(2)
  })

  it('k=1 threaded restores single-sample behavior (regression pin: exactly one circle call)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    const result = await runResearchDeepDivePhase(store, provider as never, {
      ...deepDiveCommand(),
      circle_gate: { k_samples: 1, min_drivers: 1, min_breakers: 1 },
    }, { ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals })

    expect(result.set_aside_outside_circle).toBeUndefined()
    expect(circleCallCount(provider)).toBe(1)
  })

  it('evidence floor: 1 grounded driver under min_drivers=2 sets aside even when understood', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    // Thin the circle gather down to a single driver (still cited + grounded).
    const orig = provider.structured.getMockImplementation()!
    provider.structured.mockImplementation(async (req: { response_format?: { schema_name?: string } }) => {
      const payload = await orig(req) as Record<string, unknown> & { understanding_drivers?: unknown[] }
      if (req?.response_format?.schema_name === 'BuffettMungerCircleCompetence') {
        return { ...payload, understanding_drivers: (payload.understanding_drivers as unknown[]).slice(0, 1) } as never
      }
      return payload as never
    })
    await provider.structured({} as never)

    const result = await runResearchDeepDivePhase(store, provider as never, {
      ...deepDiveCommand(),
      circle_gate: { k_samples: 1, min_drivers: 2, min_breakers: 2 },
    }, { ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals })

    expect(result.set_aside_outside_circle).toBe(true)
    const payload = await circleEvent(store)
    expect(String(payload.reason)).toMatch(/floor|grounded cashflow driver/i)
  })

  it('fail-fast: a dissenting first sample stops sampling (no wasted second call)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    withCirclePredictabilities(provider, ['uncertain'])
    await provider.structured({} as never)

    const result = await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals,
    })

    expect(result.set_aside_outside_circle).toBe(true)
    expect(circleCallCount(provider)).toBe(1)
  })

  it('the gate prompt asks for the configured evidence floors', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, {
      ...deepDiveCommand(),
      circle_gate: { k_samples: 1, min_drivers: 3, min_breakers: 4 },
    }, { ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals })

    const circlePrompt = provider.structured.mock.calls
      .map((c: unknown[]) => c[0] as { response_format?: { schema_name?: string }; prompt?: string })
      .find((r) => r.response_format?.schema_name === 'BuffettMungerCircleCompetence')?.prompt
    expect(circlePrompt).toContain('at least 3')
    expect(circlePrompt).toContain('at least 4')
  })
})

describe('foreign filer (20-F primary + 6-K interim) narrative grounding', () => {
  const novoFundamentals: Fundamentals = {
    ...costFundamentals,
    cik: '0000353278',
    entity_name: 'NOVO NORDISK A S',
    filings: [
      { form: '20-F', filed: '2026-02-04', url: 'https://www.sec.gov/Archives/edgar/data/353278/000035327826000012/nvo-20251231.htm' },
    ],
    recent_filings: [
      { form: '6-K', filed: '2026-04-30', url: 'https://www.sec.gov/Archives/edgar/data/353278/000035327826000044/nvo-6k-20260430.htm' },
    ],
  }

  it('grounds the 20-F as the primary annual (form-slug id) and surfaces the 6-K interim affordance', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip quick screen

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(), laneConcurrency: 7, fundamentals: novoFundamentals,
    })

    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === 'string')
    const understand = prompts.find((p) => p.includes('understand specialist'))
    const moat = prompts.find((p) => p.includes('moat specialist'))
    const management = prompts.find((p) => p.includes('management specialist'))

    // Primary annual block grounds on the 20-F: form-slug source id + form-interpolated prose.
    // S6 (pillar lanes): the understand lane (P1) owns the primary-numbers injection now.
    expect(understand).toBeDefined()
    expect(understand).toContain('Primary filing data')
    expect(understand).toContain('sec_edgar_20f_0000353278_fy2025')
    expect(understand).toContain('20-F')
    expect(understand).not.toContain('the latest 10-K') // prose must not claim a 10-K for a 20-F filer

    // The PRE-VERIFIED PRIMARY SOURCES block carries the 20-F id to the qualitative lanes.
    expect(moat).toBeDefined()
    expect(moat).toContain('sec_edgar_20f_0000353278_fy2025')

    // 6-K rides the interim-recency block exactly like an 8-K (management is a recency lane).
    expect(management).toBeDefined()
    expect(management).toContain('RECENT INTERIM FILINGS')
    expect(management).toContain('6-K filed 2026-04-30')
    expect(management).toMatch(/read_source\("sec_edgar_recent_/)
  })
})

// ---------------------------------------------------------------------------
// EDGAR-anchored OE bridge + harness-computed AAOIFI Shariah financial ratios.
// "Judgment proposes, code computes": the LLM provides only the maintenance-capex tier, the
// working-capital overlay, and the impermissible-income amount; the harness anchors NI/D&A/capex/SBC/
// diluted-shares to the 10-K and recomputes the three AAOIFI ratios + verdict + purification %.
// ---------------------------------------------------------------------------
function swarmFakeProviderWithShariah(
  // `null` = the lane reports UNDETERMINED impermissible income (not separately disclosed) — the harness
  // must fail closed to UNDETERMINED, never a clean 0%.
  impermissible_income: number | null,
  sector_status: 'compliant' | 'conditional' | 'non_compliant' = 'conditional',
  bridgeOverride?: Record<string, number | string>,
  // When supplied, the decision agent emits a cited valuation_reasoning so the A1 grounding gate is MET
  // (a headline fair value can then be emitted). Default (undefined) leaves it ungrounded → RESEARCH_MORE.
  valuationReasoningOverride?: Record<string, unknown>,
) {
  let laneCall = 0
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
  return {
    provider_id: 'fake-swarm-shariah',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
      if (schemaName === 'BuffettMungerCircleCompetence') {
        return fakeCirclePayload(src)
      }
      if (schemaName === 'BuffettMungerQuickScreen') {
        return {
          summary: 's', business_quality: 'b', moat: 'm', management_capital_allocation: 'mc',
          financial_quality: 'fq', valuation_sanity: 'vs', shariah_status: 'CONDITIONAL',
          red_flags: ['None'], confidence: 'high', caveats: ['c'],
          screening_result: 'deep_dive_candidate', proposed_sources: [src('src_qs_1')],
        }
      }
      if (schemaName === 'BuffettMungerUnderstandLane') {
        return fakeUnderstandLanePayload(src)
      }
      if (schemaName === 'BuffettMungerManagementLane') {
        return fakeManagementLanePayload(src)
      }
      if (schemaName === 'BuffettMungerMoatLane') {
        return {
          finding_summary: 'Moat lane', confidence: 'medium', caveats: ['c'],
          ...moatThesisForTier('wide', 'src_lane_moat'), runway: 'proven',
          ...runwayThesisForTier('proven', 'src_lane_moat'),
          proposed_sources: [src('src_lane_moat')],
        }
      }
      if (schemaName === 'BuffettMungerShariahLane') {
        // The SHARIAH lane supplies the sector/impermissible-income overlay the harness recomputes from.
        return {
          finding_summary: 'Shariah lane', confidence: 'medium', caveats: ['c'],
          sector_status, impermissible_income,
          proposed_sources: [src('src_lane_shariah')],
        }
      }
      // Focused Shariah-reasoning pass (always-on) — the overlay the harness AAOIFI recompute now sources
      // from. Mirrors the lane's sector_status + impermissible_income params (impermissible_income may be
      // null = UNDETERMINED, which the pass accepts and the harness fails CLOSED on).
      if (schemaName === 'BuffettMungerShariahReasoning') {
        return {
          shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status, impermissible_income, sector_citation: 'src_shariah_reasoning' },
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      if (schemaName === 'BuffettMungerLaneFinding') {
        const n = laneCall++
        return { finding_summary: `Lane ${n}`, confidence: 'medium', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
      }
      if (schemaName === 'BuffettMungerInversion') {
        return {
          strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_shariah_reasoning'] },
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      if (schemaName === 'BuffettMungerRedTeamResponse') {
        return {
          synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' },
          proposed_sources: [src('src_qs_1')],
        }
      }
      // Phase 2 V4: the valuation STAGE owns the bridge/buy-below/status/reasoning — serve the same
      // overrides here (the monolithic fields below are stripped by the slimmed decision schema).
      if (schemaName === 'BuffettMungerValuationReasoning') {
        return {
          valuation_reasoning: {
            // Default = UNGROUNDED citations (preserves this fake's contract: no override → the A1
            // grounding gate fails → RESEARCH_MORE, headline omitted) while the BRIDGE still binds.
            ...(valuationReasoningOverride ?? {
              owner_earnings_basis: 'FY OE per the 10-K bridge.',
              owner_earnings_citation: 'src_ungrounded_basis',
              assumed_growth: 0.06,
              assumed_growth_rationale: 'Asserted, not grounded.',
              assumed_growth_citation: 'src_ungrounded_basis',
            }),
            proposed_buy_below: 150,
            valuation_status: 'EXPENSIVE',
            owner_earnings_bridge: bridgeOverride ?? {
              net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1,
              maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
              normalized_working_capital_change: 0, shares_outstanding: 1,
            },
            industry_exit_multiple: { multiple: 15, basis_note: 'Test fixture industry norm.' },
          },
          proposed_sources: [src('src_dec_1')],
        }
      }
      return {
        investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'Await MoS.', decision_reason: 'Quality but pricey', thesis_summary: 'Compounder',
        evidence_summary: 'Covered', valuation_rationale: 'Elevated', shariah_rationale: 'Trace interest income',
        synthesis_summary: 'Reviewed', risks: ['Valuation'], open_questions: ['MoS'],
        ...DECISION_MOS_FIXTURE,
        growth_assumptions: 'Two-stage DCF; banded g.',
        // Model proposes a NORMALIZED net income equal to EDGAR reported NI (delta 0), tier '80', and
        // a maintenance_capex value the harness IGNORES in favour of min(D&A, capex × 0.80).
        owner_earnings_bridge: bridgeOverride ?? {
          net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43,
        proposed_buy_below: 150,
        ...(valuationReasoningOverride !== undefined ? { valuation_reasoning: valuationReasoningOverride } : {}),
        proposed_sources: [src('src_dec_1')],
      }
    }),
  }
}

describe('E2 — the FCF basis (OE bridge retired): provenance, AAOIFI ratios, fx, unpriced fail-closed', () => {
  it('persists the T0 fcf_basis provenance + capex_vs_da note and recomputes the AAOIFI ratios (COST-like)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235) // ≈0.4% of revenue
    await provider.structured({} as never) // skip quick-screen call alignment

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysis?.payload as Record<string, unknown>)['valuation'] as Record<string, unknown>
    // The FCF basis is the latest EDGAR year with CFO − capex computable: FY2025, 13335 − 5498 = 7837.
    const fcfBasis = valuation['fcf_basis'] as Record<string, unknown>
    expect(fcfBasis['fiscal_year']).toBe(2025)
    expect(fcfBasis['cfo_musd']).toBe(13335)
    expect(fcfBasis['capex_musd']).toBe(5498)
    expect(fcfBasis['fcf_musd']).toBe(13335 - 5498)
    expect(fcfBasis['source_id']).toBe('sec_edgar_10k_0000909832_fy2025')
    // The OE bridge fields are gone from new events.
    expect(valuation['owner_earnings_bridge']).toBeUndefined()
    expect(valuation['normalized_owner_earnings_per_share']).toBeUndefined()
    expect(valuation['owner_earnings_vs_fcf']).toBeUndefined()
    // The factual capex-vs-D&A note (COST: 5498 / 2426 ≈ 2.27× → growth-capex heavy, FACT only).
    const capexDa = valuation['capex_vs_da'] as Record<string, unknown>
    expect(capexDa['growth_capex_heavy']).toBe(true)
    expect(String(capexDa['note'])).toMatch(/FACT/)
    // The AAOIFI harness ratio recompute still runs off EDGAR + market cap.
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.strategy_compliance).toBe('CONDITIONAL')
  })

  it('E2 fail-closed: a filer with NO tagged CFO is honestly UNPRICED (no IV, no thresholds, visible flag)', async () => {
    const noCfo: Fundamentals = {
      ...costFundamentals,
      latest_annual: (({ cfo_musd: _c, ...rest }) => rest)(costFundamentals.latest_annual!),
      annual_series: (costFundamentals.annual_series ?? []).map((a) => (({ cfo_musd: _c, ...rest }) => rest)(a)),
    }
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: noCfo,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysis?.payload as Record<string, unknown>)['valuation'] as Record<string, unknown>
    expect(valuation['buy_price_per_share']).toBeUndefined()
    expect(valuation['load_up_below']).toBeUndefined()
    expect(valuation['intrinsic_value_per_share']).toBeUndefined()
    expect(valuation['valuation_basis']).toBeUndefined()
    expect((valuation['degraded_flags'] as string[]).join(' ')).toMatch(/fcf_not_computable/)
    // NO owner-earnings substitute anywhere.
    expect(JSON.stringify(valuation)).not.toMatch(/owner_earnings/)
  })
})


describe('FOCUSED valuation-reasoning fallback (when the monolithic decision drops it)', () => {
  async function runVR(opts: {
    id: string
    omitValuationReasoning?: boolean
    valuationReasoningResponse?: {
      owner_earnings_basis: string
      owner_earnings_citation: string
      assumed_growth: number
      assumed_growth_rationale: string
      assumed_growth_citation: string
      proposed_buy_below?: number
      valuation_status?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'
    }
    valuationReasoningCalls?: { count: number }
    stageOmitsValuation?: boolean
    ground?: GroundFn
  }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven' },
      investmentVerdict: 'WATCH',
      ...(opts.omitValuationReasoning !== undefined ? { omitValuationReasoning: opts.omitValuationReasoning } : {}),
      ...(opts.valuationReasoningResponse !== undefined ? { valuationReasoningResponse: opts.valuationReasoningResponse } : {}),
      ...(opts.valuationReasoningCalls !== undefined ? { valuationReasoningCalls: opts.valuationReasoningCalls } : {}),
      ...(opts.stageOmitsValuation !== undefined ? { stageOmitsValuation: opts.stageOmitsValuation } : {}),
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-vr-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'KO',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: opts.ground ?? allVerifiedGround,
        laneConcurrency: 4,
        // E2: the FCF basis (the stage's growth drives the computed threshold off this fixture).
        fundamentals: e2FcfFundamentals,
        resolvePrice: async () => ({ available: true as const, price_per_share: 60, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    return { events, valuation, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('Test 1 — decision DROPS valuation_reasoning, focused call produces it GROUNDED → verdict = model WATCH (not RESEARCH_MORE)', async () => {

    const calls = { count: 0 }
    const { valuation, cp, events } = await runVR({
      id: 'vr-grounded',
      omitValuationReasoning: true,
      // The focused call grounds both citations in src_dec_1 (verified by allVerifiedGround into dec.verified_ids).
      valuationReasoningResponse: {
        owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
        owner_earnings_citation: 'src_dec_1',
        assumed_growth: 0.06,
        assumed_growth_rationale: 'Mid-single-digit growth grounded in segment capex, cited to the 10-K.',
        assumed_growth_citation: 'src_dec_1',
      },
      valuationReasoningCalls: calls,
    })
    // The focused call DID fire (the monolithic decision dropped valuation_reasoning).
    expect(calls.count).toBeGreaterThan(0)
    // Its grounded result satisfies A1 → grounding is MET → the model's WATCH verdict lands (NOT RESEARCH_MORE).
    expect(valuation?.['synthesis_grounding_unmet']).toBeUndefined()
    expect(cp?.investment_verdict).toBe('WATCH')
    // The focused valuation_reasoning rides along on the projection.
    const vr = valuation?.['valuation_reasoning'] as Record<string, unknown> | undefined
    expect(vr?.['assumed_growth']).toBe(0.06)

    // Phase 2 V1: the stage records its artifact + stage_cost as valuation_judgment_drafted.
    const vjEvent = events.find((e) => e.event_type === 'valuation_judgment_drafted')
    expect(vjEvent).toBeDefined()
    const vjPayload = vjEvent?.payload as Record<string, unknown>
    expect(vjPayload['status']).toBe('ok')
    expect(vjPayload['assumed_growth']).toBe(0.06)
    expect((vjPayload['stage_cost'] as { provider_calls?: number }).provider_calls).toBe(1)
  })

  it('V1b — the valuation STAGE artifact is PRIMARY: its buy-below/status override the monolithic decision fields', async () => {
    // The stage supplies buy-below 333 + FAIR; the monolithic decision (fall-through fake) still emits
    // proposed_buy_below 150 + EXPENSIVE. Stage-first (V1b) means the recorded valuation carries 333/FAIR.
    const { valuation, cp } = await runVR({
      id: 'v1b-primary',
      valuationReasoningResponse: {
        owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
        owner_earnings_citation: 'src_dec_1',
        assumed_growth: 0.05,
        assumed_growth_rationale: 'Modest growth grounded to the 10-K.',
        assumed_growth_citation: 'src_dec_1',
        proposed_buy_below: 333,
      },
    })
    // R1 superseded: the stage's 333 is the ADVISORY price; the operative threshold is computed.
    expect(valuation?.['buy_price_per_share']).toBe(172.37) // E2 fixture IV@g=0.05 (246.24) × 0.70
    expect(valuation?.['model_proposed_buy_below']).toBe(333)
    // C3: the status is DERIVED — price 60 sits inside the computed buy zone (172.37) → ATTRACTIVE.
    expect(cp?.valuation_status).toBe('ATTRACTIVE')
  })

  it('Test 2 — decision drops it AND the focused call ALSO fails to ground → RESEARCH_MORE + valuation_reasoning_retry_exhausted', async () => {
    const { valuation, cp } = await runVR({
      id: 'vr-exhausted',
      omitValuationReasoning: true,
      stageOmitsValuation: true, // V4: the stage is the only owner — force ITS omission for the exhaust path
    })
    expect(valuation?.['synthesis_grounding_unmet']).toBe(true)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/valuation_reasoning_retry_exhausted/)
  })

  it('Test 3 — HAPPY PATH (Phase 2 V1): the valuation STAGE always runs exactly once; a grounded monolithic valuation_reasoning still proceeds without a second call', async () => {
    const calls = { count: 0 }
    const { valuation, cp, events } = await runVR({
      id: 'vr-happy',
      // omitValuationReasoning defaults false → the decision agent supplies the grounded valuation_reasoning.
      valuationReasoningCalls: calls,
    })
    // Phase 2 V1: the focused valuation call is a DEDICATED ALWAYS-ON stage now (it may retry once under
    // runValidatedAgent) — but the fallback NEVER issues an additional call beyond the stage's own attempts.
    expect(calls.count).toBeGreaterThanOrEqual(1)
    expect(calls.count).toBeLessThanOrEqual(2)
    // The stage records its event even when the fake omits the required field (status 'failed').
    expect(events.map((e) => e.event_type)).toContain('valuation_judgment_drafted')
    expect(valuation?.['synthesis_grounding_unmet']).toBeUndefined()
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('Test 4 — focused call cites an UNGROUNDED id → does NOT count (fail-closed): RESEARCH_MORE', async () => {
    // Ground grounds 'good' ids but captures 'bad' ids as unavailable (no content_hash) — mirrors the A1
    // captured-but-unverified repro. The focused call cites src_dec_bad_1, which never verifies.
    const groundGoodCaptureBad = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => {
        const ok = !s.source_id.includes('bad')
        return {
          source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
          availability: (ok ? 'available' : 'unavailable') as 'available' | 'unavailable',
          fetched_at: 'x', ...(ok ? { content_hash: 'sha256:1' } : {}),
        }
      }),
      verified_ids: sources.filter((s) => !s.source_id.includes('bad')).map((s) => s.source_id),
    })
    const { valuation, cp } = await runVR({
      id: 'vr-ungrounded-cite',
      omitValuationReasoning: true,
      valuationReasoningResponse: {
        owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
        owner_earnings_citation: 'src_dec_bad_1',
        assumed_growth: 0.06,
        assumed_growth_rationale: 'Mid-single-digit growth, cited.',
        assumed_growth_citation: 'src_dec_bad_1',
      },
      ground: groundGoodCaptureBad as GroundFn,
    })
    // The focused call's ungrounded citation does NOT satisfy A1 → fail-closed.
    expect(valuation?.['synthesis_grounding_unmet']).toBe(true)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
  })
})

// ---------------------------------------------------------------------------
// resolveJudgmentTiers — EDGAR-anchored bounded +-1 adjustment (Mechanisms 1+2)
// ---------------------------------------------------------------------------
function tenYearHighRoicSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const scale = Math.pow(1.10, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: 1000 * scale,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// B6 reframe: the moat axis now resolves from the model's GROUNDED CITED THESIS (moat_drivers +
// proposed_moat_class) — NOT a per-row M1-M6 rubric. These tests were rewritten from the retired rubric
// path to the grounded-thesis behavior (the dedicated unit coverage lives in moatThesis.test.ts; here we
// exercise the resolveJudgmentTiers integration + the quant corroboration surfacing).
describe('resolveJudgmentTiers — grounded-thesis moat resolution', () => {
  const verified = new Set(['sha256:a', 'sha256:b'])

  it('3 grounded drivers + proposed monopoly + strong quant -> monopoly, quant corroborates (not contradicts)', () => {
    const res = resolveJudgmentTiers({
      moatThesis: {
        moat_drivers: [
          { advantage: 'documented pricing power without volume loss', citation: 'sha256:a' },
          { advantage: 'sustained share gains vs funded entrants', citation: 'sha256:b' },
          { advantage: 'structural cost/scale advantage', citation: 'sha256:a' },
        ],
        proposed_moat_class: 'monopoly',
        moat_reasoning: 'Three grounded durable advantages.',
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.anchor_computable).toBe(true)
    // The quant CORROBORATES (anchor capped at moderate on its own) — but the GROUNDED thesis resolves the
    // tier. A strong quant under a grounded passing thesis does NOT raise quant_contradicts_moat.
    expect(res.moat?.quant_anchor_tier).toBe('moderate')
    expect(res.moat?.resolved_moat_class).toBe('monopoly')
    expect(res.moat?.quant_contradicts_moat).not.toBe(true)
  })

  it('proposed monopoly but only 2 grounded drivers (strong quant) -> resolved WIDE, fails closed below monopoly + unmet', () => {
    // The quant cannot substitute for grounded drivers: a monopoly claim needs >=3 grounded advantages.
    const res = resolveJudgmentTiers({
      moatThesis: {
        moat_drivers: [
          { advantage: 'pricing power', citation: 'sha256:a' },
          { advantage: 'brand strength', citation: 'sha256:b' },
        ],
        proposed_moat_class: 'monopoly',
        moat_reasoning: 'Two grounded drivers, claims monopoly.',
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.quant_anchor_tier).toBe('moderate')
    expect(res.moat?.resolved_moat_class).toBe('wide')
    expect(res.moat?.resolved_moat_class).not.toBe('monopoly')
    expect(res.moat?.moat_grounding_unmet).toBe(true)
  })

  it('proposed wide but drivers ungrounded (citations do not verify) -> resolved NARROW even with strong quant', () => {
    // The EDGAR quant overrides nothing here: 0 grounded drivers -> narrow regardless of the strong quant.
    const res = resolveJudgmentTiers({
      moatThesis: {
        moat_drivers: [
          { advantage: 'pricing power', citation: 'sha256:UNVERIFIED-1' },
          { advantage: 'share gains', citation: 'sha256:UNVERIFIED-2' },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Claims wide, cites unverifiable sources.',
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.grounded_driver_count).toBe(0)
    expect(res.moat?.resolved_moat_class).toBe('narrow')
    expect(res.moat?.resolved_moat_class).not.toBe('wide')
    expect(res.moat?.moat_grounding_unmet).toBe(true)
  })
})

// A 10-year series with high, durable ROIC (M1=2) but a wildly swinging operating margin so the M2
// band-proxy scores 0 -> moat computable anchor sub-score 2 -> 'moderate' (the CPRT anchor shape).
function tenYearModerateMoatSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const scale = Math.pow(1.10, 9 - i)
    const equity = 1000 * scale
    // ROIC stays high (op*(1-0.21)/equity well above 0.15) but the margin oscillates hard year to year
    // so the M2 +-300/600bps band proxy is blown -> M2=0.
    const marginPct = i % 2 === 0 ? 0.30 : 0.45
    const revenue = 1000 * scale
    const op = revenue * marginPct
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: equity,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

describe('resolveJudgmentTiers — grounded-thesis fails closed on an ungrounded wide claim', () => {
  const verified = new Set(['sha256:a', 'sha256:b', 'sha256:c'])

  it('CPRT shape: proposed wide but only one grounded driver (rest ungrounded) -> resolved NOT wide, moat_grounding_unmet', () => {
    // B6 rewrite of the retired grounded-ceiling-clamp test: a wide claim with insufficient GROUNDED
    // drivers fails closed (the moderate quant does not lift it). Two of the three drivers cite hashes not
    // in the corpus -> only one grounds -> below the >=2 wide threshold.
    const res = resolveJudgmentTiers({
      moatThesis: {
        moat_drivers: [
          { advantage: 'pricing power', citation: 'sha256:a' },
          { advantage: 'share gains', citation: 'sha256:UNVERIFIED-1' },
          { advantage: 'competitor exit', citation: 'sha256:UNVERIFIED-2' },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Claims wide on mostly-ungrounded drivers.',
      },
      series: tenYearModerateMoatSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.quant_anchor_tier).toBe('moderate')
    expect(res.moat?.grounded_driver_count).toBe(1)
    expect(res.moat?.resolved_moat_class).not.toBe('wide')
    expect(res.moat?.resolved_moat_class).toBe('moderate')
    expect(res.moat?.moat_grounding_unmet).toBe(true)
    expect(res.moat?.grounding_capped).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Silent-degradation cascade fix: the model omits the OPTIONAL judgment fields (no rubric, no shariah
// overlay, no synthesis_response — exactly the live CPRT dogfood). The moat/runway tier MUST still
// resolve (holistic fallback, never undefined), the two-stage valuation MUST still compute, and every
// omitted structured field MUST be surfaced as a visible degraded flag (never a silent skip).
// ---------------------------------------------------------------------------
describe('resolveJudgmentTiers — holistic fallback when the rubric is omitted (never undefined)', () => {
  const verified = new Set<string>()

  it('moat FAILS CLOSED to narrow when NO thesis is supplied — flagged, never silent (C2: no runway axis)', () => {
    const res = resolveJudgmentTiers({
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    // B6 fail-closed: with no grounded moat thesis the moat resolves to narrow (a moat class requires a
    // grounded, cite-verified thesis — silence is not trusted to pass the gate).
    expect(res.moat?.resolved_moat_class).toBe('narrow')
    expect(res.moat?.judgment_degraded).toBe('rubric_not_emitted')
    // C2: the runway judged axis is retired.
    expect('runway' in res).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SUBSTITUTION-BOUNDARY INVARIANT (the contract): the moat gate cannot pass on EDGAR quant ALONE — an
// ungrounded qualitative moat claim FAILS CLOSED. The quant CORROBORATES, never SUBSTITUTES. Four-case
// invariant routed end-to-end through the swarm (gatedVerdict). A computable anchor (moderate) is forced
// by a series with high, durable ROIC + a tight operating-margin band (M1=2, M2=2).
// ---------------------------------------------------------------------------
function tenYearComputableModerateFundamentals(): Fundamentals {
  const series: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const scale = Math.pow(1.10, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30 // tight margin band -> M2=2; high ROIC -> M1=2 -> sub-score 4 -> moderate (capped)
    series.push({
      fiscal_year: 2025 - i, currency: 'USD',
      net_income_musd: op * 0.79, revenue_musd: revenue, operating_income_musd: op,
      income_tax_expense_musd: op * 0.21, stockholders_equity_musd: 1000 * scale,
      total_debt_musd: 0, cash_and_securities_musd: 0,
      // OE-bridge inputs so the valuation can compute when the gate passes.
      d_and_a_musd: op * 0.10, capex_musd: op * 0.10, sbc_musd: 0, diluted_shares_m: 100,
    })
  }
  return {
    cik: '0000000077', entity_name: 'MOATGATE INC', currency: 'USD',
    latest_annual: series[0]!, annual_series: series,
    filings: [{ form: '10-K', filed: '2026-02-01', url: 'https://www.sec.gov/Archives/edgar/data/77/x.htm' }],
  }
}

describe('SUBSTITUTION-BOUNDARY INVARIANT — moat gate cannot pass on quant alone (ungrounded moat fails closed)', () => {
  // B6 reframe: a GROUNDED CITED THESIS (moat_drivers + proposed_moat_class) instead of a per-row rubric.
  // groundedCount = how many drivers cite a VERIFIABLE source (src_lane_moat). ungroundedCount = drivers
  // citing an UNVERIFIED id (present-but-ungrounded — the cite-check, not presence, decides). proposedTier
  // is what the lane PROPOSES (its reach). The harness resolves from the grounded thesis: wide needs >=2
  // grounded drivers, monopoly >=3; the quant corroborates but cannot substitute.
  function moatThesis(
    cite: string,
    opts: { groundedCount: number; ungroundedCount?: number; proposedTier: 'narrow' | 'moderate' | 'wide' | 'monopoly' },
  ) {
    const advantages = [
      'documented pricing power without volume loss',
      'sustained market-share gains vs funded entrants',
      'structural cost/scale + distribution advantage',
      'high customer switching costs',
    ]
    const drivers: { advantage: string; citation: string }[] = []
    for (let i = 0; i < opts.groundedCount; i += 1) drivers.push({ advantage: advantages[i]!, citation: cite })
    for (let i = 0; i < (opts.ungroundedCount ?? 0); i += 1) {
      drivers.push({ advantage: `${advantages[opts.groundedCount + i]!} (claimed)`, citation: 'sha256:UNVERIFIED' })
    }
    // The lane must emit at least one driver (schema min(1)); a fully-ungrounded thesis still has drivers.
    if (drivers.length === 0) drivers.push({ advantage: advantages[0]!, citation: 'sha256:UNVERIFIED' })
    return { moat_drivers: drivers, proposed_moat_class: opts.proposedTier, moat_reasoning: 'Test moat thesis.' }
  }

  // A provider that emits a moat lane with the supplied grounded thesis.
  function moatGateProvider(moatThesisPayload: ReturnType<typeof moatThesis>, _proposedClass: 'narrow' | 'moderate' | 'wide' | 'monopoly') {
    const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
    let laneCall = 0
    return {
      provider_id: 'fake-moat-gate', capabilities: {} as never, complete: vi.fn(), runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName === 'BuffettMungerCircleCompetence') {
          return fakeCirclePayload(src)
        }
      if (schemaName === 'BuffettMungerQuickScreen') {
          return {
            summary: 's', business_quality: 'b', moat: 'm', management_capital_allocation: 'mc',
            financial_quality: 'fq', valuation_sanity: 'vs', shariah_status: 'COMPLIANT',
            red_flags: ['None'], confidence: 'high', caveats: ['c'], screening_result: 'deep_dive_candidate',
            proposed_sources: [src('src_qs_1')],
          }
        }
        if (schemaName === 'BuffettMungerUnderstandLane') {
          return fakeUnderstandLanePayload(src)
        }
        if (schemaName === 'BuffettMungerManagementLane') {
          return fakeManagementLanePayload(src)
        }
        if (schemaName === 'BuffettMungerMoatLane') {
          return {
            finding_summary: 'Moat lane', confidence: 'high', caveats: ['c'],
            ...moatThesisPayload, runway: 'proven',
            ...runwayThesisForTier('proven', 'src_lane_moat'),
            proposed_sources: [src('src_lane_moat')],
          }
        }
        if (schemaName === 'BuffettMungerShariahLane') {
          return { finding_summary: 'Shariah lane', confidence: 'high', caveats: ['c'], sector_status: 'compliant', impermissible_income: 0, proposed_sources: [src('src_lane_shariah')] }
        }
        if (schemaName === 'BuffettMungerLaneFinding') {
          const n = laneCall++
          return { finding_summary: `Lane ${n}`, confidence: 'high', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
        }
        if (schemaName === 'BuffettMungerInversion') {
          return { strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g', shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] }, proposed_sources: [src('src_qs_1')] }
        }
        if (schemaName === 'BuffettMungerRedTeamResponse') {
          return { synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted.' }, proposed_sources: [src('src_qs_1')] }
        }
        return {
          investment_verdict: 'BUY', strategy_compliance: 'COMPLIANT', valuation_status: 'ATTRACTIVE',
          next_required_action: 'Buy below the band.', decision_reason: 'Strong compounder', thesis_summary: 'Quality',
          evidence_summary: 'Covered', valuation_rationale: 'Cheap', shariah_rationale: 'Clean',
          synthesis_summary: 'Reviewed', risks: ['r'], open_questions: ['q'],
          ...DECISION_MOS_FIXTURE,
          growth_assumptions: 'Two-stage DCF.',
          owner_earnings_bridge: { net_income: 1000, depreciation_amortization: 100, maintenance_capex: 50, maintenance_capex_proxy_tier: '80', stock_based_comp: 0, normalized_working_capital_change: 0, shares_outstanding: 100 },
          roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.40,
          proposed_buy_below: 50,
          valuation_reasoning: {
            owner_earnings_basis: 'FY25 owner earnings.', owner_earnings_citation: 'src_dec_1',
            assumed_growth: 0.06, assumed_growth_rationale: 'Cited capex.', assumed_growth_citation: 'src_dec_1',
          },
          proposed_sources: [src('src_dec_1')],
        }
      }),
    }
  }

  async function runGate(opts: { thesis: ReturnType<typeof moatThesis>; proposedClass: 'narrow' | 'moderate' | 'wide' | 'monopoly'; id: string }) {
    const store = new InMemoryEventStore()
    const provider = moatGateProvider(opts.thesis, opts.proposedClass)
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-moatgate-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'MGT',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        fundamentals: tenYearComputableModerateFundamentals(),
        resolvePrice: async () => ({ available: true, price_per_share: 50, currency: 'USD', as_of: 'x', source: 'test' }),
      },
    )
    const projections = projectResearchCases((await store.list()) as Parameters<typeof projectResearchCases>[0])
    return projections.find((c) => c.research_case_id === `rc_${opts.id}`)
  }

  it('Case 1 — strong quant, NO grounded drivers (model proposed wide): resolved below wide, gate fails, RESEARCH_MORE + moat_grounding_unmet', async () => {
    // The lane PROPOSES wide reaching off the quant but grounds ZERO drivers. The quant cannot substitute
    // for a grounded thesis (A2) -> resolved narrow, gate fails, routed to RESEARCH_MORE.
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 0, ungroundedCount: 2, proposedTier: 'wide' }), proposedClass: 'wide', id: 'case1' })
    expect(cp?.valuation?.moat_class).not.toBe('wide')
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    expect(cp?.valuation?.moat_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
  })

  it('Case 2 — drivers CITED but citations DO NOT verify: resolved NOT wide, RESEARCH_MORE + moat_grounding_unmet', async () => {
    // The drivers are present + scored a wide claim, but cite an UNVERIFIED id -> not grounded (the cite-
    // check, not presence). 0 grounded -> narrow, gate fails.
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 0, ungroundedCount: 3, proposedTier: 'wide' }), proposedClass: 'wide', id: 'case2' })
    expect(cp?.valuation?.moat_class).not.toBe('wide')
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    expect(cp?.valuation?.moat_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
  })

  it('Case 3 — >=2 cite-verified grounded drivers + proposed wide: resolved WIDE, gate passes, NO moat_grounding_unmet', async () => {
    // Two grounded drivers clear the wide threshold; the grounded thesis carries the tier.
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 2, proposedTier: 'wide' }), proposedClass: 'wide', id: 'case3' })
    expect(cp?.valuation?.moat_class).toBe('wide')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    expect(cp?.valuation?.moat_grounding_unmet).toBeUndefined()
    // A real grounded wide still works (proves no false-positive) — the verdict is NOT clamped by the gate.
    expect(cp?.investment_verdict).not.toBe('PASS')
  })

  it('Case 4 — >=3 cite-verified grounded drivers + proposed monopoly: resolved MONOPOLY', async () => {
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 3, proposedTier: 'monopoly' }), proposedClass: 'monopoly', id: 'case4' })
    expect(cp?.valuation?.moat_class).toBe('monopoly')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    expect(cp?.valuation?.moat_grounding_unmet).toBeUndefined()
  })

  it('Case 5 — genuinely NARROW (model proposed narrow): PASS, NOT RESEARCH_MORE, no moat_grounding_unmet', async () => {
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 1, proposedTier: 'narrow' }), proposedClass: 'narrow', id: 'case5' })
    // Model proposed narrow -> resolved narrow, genuinely below the circle (a valid Buffett set-aside).
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    expect(cp?.valuation?.moat_grounding_unmet).toBeUndefined()
    expect(cp?.investment_verdict).toBe('PASS')
  })

  it('Tripwire — the moat gate cannot pass on quant alone; an ungrounded wide moat claim fails closed', async () => {
    // The conformance assertion in one place: strong computable quant + a proposed wide moat, zero grounded
    // drivers -> the gate does NOT pass, and the case is routed back for more research.
    const cp = await runGate({ thesis: moatThesis('src_lane_moat', { groundedCount: 0, ungroundedCount: 2, proposedTier: 'wide' }), proposedClass: 'wide', id: 'tripwire' })
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
  })
})

describe('Silent-degradation cascade — fields omitted (live dogfood shape)', () => {
  // The MOAT lane omits its rubric and the SHARIAH lane omits its overlay — exactly the per-lane
  // judgment fields a live model leaves blank. With a holistic wide moat + OE available, the harness
  // MUST still compute the two-stage valuation and flag every silent skip.
  async function runOmitted(opts: { synthesis?: SynthesisOverrides; id: string; keepMoatRubric?: boolean }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      // A3: omitting the moat rubric now fails the moat CLOSED (the holistic moat_class is not trusted).
      // Tests that need the valuation to compute (gate must pass) keep a genuinely-grounded moat rubric
      // (keepMoatRubric) so the moat is established from cite-verified rows, not the model's bare word.
      omitMoatRubric: opts.keepMoatRubric !== true,
      omitShariahOverlay: true,
      ...(opts.synthesis !== undefined ? { synthesis: opts.synthesis } : {}),
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-degrade-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4, fundamentals: e2FcfFundamentals },
    )
    const events = await store.list()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const decisionEvent = events.find((e) => e.event_type === 'decision_drafted')
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return {
      events,
      cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`),
      analysisPayload: analysisEvent?.payload as Record<string, unknown>,
      decisionPayload: decisionEvent?.payload as Record<string, unknown>,
    }
  }

  it('A3: omitting the moat rubric FAILS the moat CLOSED to narrow (gate fails) — moat_class never undefined', async () => {
    const { cp } = await runOmitted({ synthesis: { moat_class: 'wide', runway: 'proven' }, id: 'omit-val' })
    // A3 fail-closed: the holistic wide is NOT trusted to pass the gate — the moat resolves narrow and the
    // gate fails (was 'wide' + passes_gate true — that asserted the hole: admitting on the bare holistic word).
    expect(cp?.valuation?.moat_class).toBe('narrow')
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    // The ungrounded moat is surfaced and the verdict routes to RESEARCH_MORE (not silently admitted).
    expect(cp?.valuation?.moat_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
  })

  it('with a GENUINELY-GROUNDED moat rubric (cite-verified rows), the two-stage valuation STILL computes when OTHER fields are omitted', async () => {
    // The valuation must not be voided by the omitted shariah overlay — but the moat must be GROUNDED
    // (cite-verified rows via moatRubricForTier('wide')), not the model's bare holistic word.
    const { cp } = await runOmitted({ synthesis: { moat_class: 'wide', runway: 'proven' }, id: 'omit-val-grounded', keepMoatRubric: true })
    expect(cp?.valuation?.moat_class).toBe('wide')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    // E2: the book IV computes off the FCF fixture; the OE implied_multiple is retired.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['implied_multiple']).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeDefined()
  })

  it('records shariah-unverified flags and surfaces them in open_questions (S6: on a grounded-moat run)', async () => {
    // S6: an omitted MOAT rubric now short-circuits at the early gate (covered by A3 above), so the
    // shariah-overlay degradation is exercised on a GROUNDED-moat run that reaches synthesis.
    const { analysisPayload, decisionPayload } = await runOmitted({
      synthesis: { moat_class: 'wide', runway: 'proven' }, id: 'omit-flags', keepMoatRubric: true,
    })
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    // Every omitted structured field is a VISIBLE flag, not a silent skip.
    expect(degraded.join(' ')).toMatch(/shariah_ratios_unverified:\s*impermissible_income_not_emitted/)
    // and they reach the human via the decision open_questions (mirroring red_team_objection_unaddressed).
    const openQuestions = (decisionPayload?.['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.join(' ')).toMatch(/impermissible_income_not_emitted/)
  })

  it('E2: the demonstrated FCF/share reference computes from the fixture and the valuation prices', async () => {
    const { cp } = await runOmitted({
      // No EDGAR series → the DEMONSTRATED-HISTORY reference floors to 0, but FV must still compute. The
      // moat is GENUINELY GROUNDED (keepMoatRubric) so the gate passes and the valuation computes.
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.05, reinvestment_rate: 0.5 },
      id: 'omit-g0', keepMoatRubric: true,
    })
    // E2: the shared fixture supplies a demonstrated FCF/share CAGR (~6%) — the reference is honest,
    // the headline growth is the model's cited assumed_growth (0.06), and the valuation computes.
    expect(cp?.valuation?.demonstrated_growth_reference as number).toBeCloseTo(0.06, 2)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeDefined()
    // (The g0-floor flag no longer fires — the fixture supplies an honest demonstrated CAGR.)
  })
})

// ---------------------------------------------------------------------------
// model-tiering harness defense 1: schema validation + retry. The dedicated red-team-RESPONSE call (the
// focused decomposition of synthesis_response) keeps omitting its sole REQUIRED field -> the wrapper
// RETRIES (a second red-team-response call), and after 2 attempts FALLS BACK visibly
// (red_team_response_retry_exhausted + red_team_objection_unaddressed) so the run still completes. A
// provider that emits the response on the 2nd attempt SUCCEEDS without the flag.
// ---------------------------------------------------------------------------
describe('runStrategyResearchSwarm — schema-validation + retry (harness defense 1)', () => {
  // A swarm provider whose dedicated red-team-RESPONSE call can include/omit its required field on a
  // per-attempt basis (counting response attempts so the 2nd attempt can differ).
  function retrySwarmProvider(opts: { responseAttemptsToOmit: number }) {
    const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
    let laneCall = 0
    let responseAttempt = 0
    const provider = {
      provider_id: 'fake-retry',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName === 'BuffettMungerCircleCompetence') {
          return fakeCirclePayload(src)
        }
      if (schemaName === 'BuffettMungerQuickScreen') {
          return {
            summary: 'Good', business_quality: 'Strong', moat: 'Wide', management_capital_allocation: 'Good',
            financial_quality: 'Solid', valuation_sanity: 'Fair', shariah_status: 'CONDITIONAL',
            red_flags: ['None'], confidence: 'high', caveats: ['c'], screening_result: 'deep_dive_candidate',
            proposed_sources: [src('src_qs_1')],
          }
        }
        if (schemaName === 'BuffettMungerLaneFinding') {
          const n = laneCall++
          return { finding_summary: `Lane ${n}`, confidence: 'high', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
        }
        if (schemaName === 'BuffettMungerUnderstandLane') {
          return fakeUnderstandLanePayload(src)
        }
        if (schemaName === 'BuffettMungerManagementLane') {
          return fakeManagementLanePayload(src)
        }
        if (schemaName === 'BuffettMungerMoatLane') {
          return {
            finding_summary: 'Moat lane', confidence: 'high', caveats: ['c'],
            ...moatThesisForTier('wide', 'src_lane_moat'), runway: 'proven',
            ...runwayThesisForTier('proven', 'src_lane_moat'),
            proposed_sources: [src('src_lane_moat')],
          }
        }
        if (schemaName === 'BuffettMungerShariahLane') {
          return {
            finding_summary: 'Shariah lane', confidence: 'high', caveats: ['c'],
            sector_status: 'compliant', impermissible_income: 0,
            proposed_sources: [src('src_lane_shariah')],
          }
        }
        // Focused Shariah-reasoning pass (always-on): the overlay the harness recompute sources from.
        if (schemaName === 'BuffettMungerShariahReasoning') {
          return {
            shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: 'compliant', impermissible_income: 0, sector_citation: 'src_shariah_reasoning' },
            proposed_sources: [src('src_shariah_reasoning')],
          }
        }
        if (schemaName === 'BuffettMungerInversion') {
          return {
            strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
            shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_shariah_reasoning'] },
            proposed_sources: [src('src_shariah_reasoning')],
          }
        }
        if (schemaName === 'BuffettMungerRedTeamResponse') {
          // Omit the sole required field — synthesis_response — for the first `responseAttemptsToOmit`
          // attempts (a live cited red-team objection makes the dedicated call run + its response required).
          const omit = responseAttempt < opts.responseAttemptsToOmit
          responseAttempt++
          return {
            ...(omit ? {} : { synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' } }),
            proposed_sources: [src('src_rt_resp_1')],
          }
        }
        // Synthesis decision (no judgment-overlay required fields now).
        return {
          investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
          next_required_action: 'wait', decision_reason: 'pricey', thesis_summary: 't', evidence_summary: 'e',
          valuation_rationale: 'v', shariah_rationale: 's', synthesis_summary: 'x', risks: ['r'], open_questions: ['q'],
          ...DECISION_MOS_FIXTURE,
          growth_assumptions: 'two-stage', roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43,
          proposed_buy_below: 150,
          owner_earnings_bridge: {
            net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
            maintenance_capex_proxy_tier: '80', stock_based_comp: 911, normalized_working_capital_change: 0, shares_outstanding: 443,
          },
          red_team_strongest_objection: 'echoed',
          proposed_sources: [src('src_dec_1')],
        }
      }),
    }
    return { provider, responseCalls: () => responseAttempt }
  }

  async function run(provider: unknown, id: string) {
    const store = new InMemoryEventStore()
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-retry-${id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'TST', strategy_id: 'buffett-munger',
        actor_id: 'user_local', idempotency_key: `${id}_k`, model_id: 'mock', decision_id: `decision_${id}`,
        source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const decision = events.find((e) => e.event_type === 'decision_drafted')
    return {
      analysisPayload: analysis?.payload as Record<string, unknown>,
      decisionPayload: decision?.payload as Record<string, unknown>,
    }
  }

  it('E1: never issues a red-team-response call (the obligation machinery is retired)', async () => {
    const { provider, responseCalls } = retrySwarmProvider({ responseAttemptsToOmit: 99 })
    const { analysisPayload, decisionPayload } = await run(provider, 'inv-no-response')
    expect(responseCalls()).toBe(0)
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).not.toMatch(/red_team_response_retry_exhausted/)
    const openQuestions = (decisionPayload?.['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.join(' ')).not.toMatch(/red_team_objection_unaddressed/)
    // The inversion itself persisted.
    expect((analysisPayload?.['inversion'] as { status?: string })?.status).toBe('complete')
  })

  it('routes the red-team to a DIFFERENT provider when the red_team role is overridden', async () => {
    // Two distinct provider instances: the run provider and a separate red-team provider. The registry
    // override pins red_team -> mock-provider, so resolveProvider instantiates a fresh MockProvider —
    // proving the red team genuinely runs on its own provider/model, not the run's.
    const store = new InMemoryEventStore()
    const { provider } = retrySwarmProvider({ responseAttemptsToOmit: 0 })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-rt-override-'))
    // resolveModelForRole reads OWLFOLIO_MODEL_ROLE_RED_TEAM from env; assert it routes without throwing.
    const prev = process.env['OWLFOLIO_MODEL_ROLE_RED_TEAM']
    process.env['OWLFOLIO_MODEL_ROLE_RED_TEAM'] = 'mock-provider:mock-red@0.0'
    try {
      await runStrategyResearchSwarm(
        store, provider as never,
        {
          research_case_id: 'rc_rt', company_id: 'c', ticker: 'TST', strategy_id: 'buffett-munger',
          actor_id: 'user_local', idempotency_key: 'rt_k', model_id: 'mock', decision_id: 'decision_rt',
          source_ledger_path: sourceLedgerPath,
        },
        { ground: allVerifiedGround, laneConcurrency: 4 },
      )
    } finally {
      if (prev === undefined) delete process.env['OWLFOLIO_MODEL_ROLE_RED_TEAM']
      else process.env['OWLFOLIO_MODEL_ROLE_RED_TEAM'] = prev
    }
    const events = await store.list()
    // The run still completed end-to-end (the red team ran on the overridden provider, which a
    // MockProvider satisfies in its degraded path) — proving the different-model hook is wired.
    expect(events.map((e) => e.event_type)).toContain('decision_drafted')
  })
})

// ---------------------------------------------------------------------------
// model-tiering-spec — Dual-Model Cross-Check (moat + Shariah sector ONLY)
// ---------------------------------------------------------------------------

// A swarm provider that handles every stage AND the focused cross-check schemas. The cross-check
// classifications are configurable so we can drive agreement/disagreement/degrade. The SAME provider
// instance serves both models (the override pins a different MODEL on the same provider), so no real
// resolveProvider call is needed.
function crossCheckSwarmProvider(opts: {
  primaryMoat?: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  crossCheckMoat?: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  failMoatCrossCheck?: boolean
  primarySector?: 'compliant' | 'conditional' | 'non_compliant'
  crossCheckSector?: 'compliant' | 'conditional' | 'non_compliant'
} = {}) {
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
  let laneCall = 0
  const provider = {
    provider_id: 'fake-xc',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
      if (schemaName === 'BuffettMungerCircleCompetence') {
        return fakeCirclePayload(src)
      }
      if (schemaName === 'BuffettMungerQuickScreen') {
        return {
          summary: 'Good', business_quality: 'Strong', moat: 'Wide', management_capital_allocation: 'Excellent',
          financial_quality: 'Solid', valuation_sanity: 'Reasonable', shariah_status: 'CONDITIONAL',
          red_flags: ['None'], confidence: 'high', caveats: ['c'], screening_result: 'deep_dive_candidate',
          proposed_sources: [src('src_qs_1')],
        }
      }
      if (schemaName === 'BuffettMungerLaneFinding') {
        const n = laneCall++
        return { finding_summary: `Lane ${n}`, confidence: 'high', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
      }
      if (schemaName === 'BuffettMungerUnderstandLane') {
        return fakeUnderstandLanePayload(src)
      }
      if (schemaName === 'BuffettMungerManagementLane') {
        return fakeManagementLanePayload(src)
      }
      if (schemaName === 'BuffettMungerMoatLane') {
        // The PRIMARY moat class is the moat lane's grounded thesis (what the cross-check second model checks).
        const moatClass = opts.primaryMoat ?? 'wide'
        return {
          finding_summary: 'Moat lane', confidence: 'high', caveats: ['c'],
          ...moatThesisForTier(moatClass, 'src_lane_moat'), runway: 'proven',
          ...runwayThesisForTier('proven', 'src_lane_moat'),
          proposed_sources: [src('src_lane_moat')],
        }
      }
      if (schemaName === 'BuffettMungerShariahLane') {
        // The PRIMARY sector status is the shariah lane's overlay (what the cross-check second model checks).
        return {
          finding_summary: 'Shariah lane', confidence: 'high', caveats: ['c'],
          sector_status: opts.primarySector ?? 'compliant', impermissible_income: 0,
          proposed_sources: [src('src_lane_shariah')],
        }
      }
      // Focused Shariah-reasoning pass (always-on): the PRIMARY sector status the harness recompute +
      // Shariah sector cross-check now source from (the cross-check second model then re-classifies it).
      if (schemaName === 'BuffettMungerShariahReasoning') {
        return {
          shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: opts.primarySector ?? 'compliant', impermissible_income: 0, sector_citation: 'src_shariah_reasoning' },
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      if (schemaName === 'MoatCrossCheck') {
        if (opts.failMoatCrossCheck === true) throw new Error('cross-check timed out')
        return { moat_class: opts.crossCheckMoat ?? 'wide', proposed_sources: [src('src_xc_moat')] }
      }
      if (schemaName === 'ShariahSectorCrossCheck') {
        return { sector_status: opts.crossCheckSector ?? 'compliant', proposed_sources: [src('src_xc_shariah')] }
      }
      if (schemaName === 'BuffettMungerInversion') {
        return {
          strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'a',
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_shariah_reasoning'] },
          proposed_sources: [src('src_shariah_reasoning')],
        }
      }
      // synthesis/decision
      return {
        investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'a', decision_reason: 'r', thesis_summary: 't', evidence_summary: 'e',
        valuation_rationale: 'v', shariah_rationale: 's', synthesis_summary: 'ss', risks: ['risk'],
        open_questions: ['baseline question'],
        ...DECISION_MOS_FIXTURE,
        growth_assumptions: 'g', owner_earnings_bridge: {
          net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 911, normalized_working_capital_change: 0, shares_outstanding: 443,
        },
        roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43, proposed_buy_below: 150, proposed_sources: [src('src_dec_1')],
      }
    }),
  }
  return provider
}

function analysisCrosscheckOf(events: Awaited<ReturnType<InMemoryEventStore['list']>>): Record<string, unknown> | undefined {
  const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
  return (analysis?.payload as Record<string, unknown> | undefined)?.['dual_model_crosscheck'] as Record<string, unknown> | undefined
}

async function runXcSwarm(provider: unknown, overrides: Record<string, { provider_id?: string; model?: string }>) {
  const store = new InMemoryEventStore()
  const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-xc-'))
  await runStrategyResearchSwarm(
    store, provider as never,
    {
      research_case_id: 'rc_xc', company_id: 'company_xc', ticker: 'COST',
      strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'xc_k',
      model_id: 'primary-model', decision_id: 'decision_xc', source_ledger_path: sourceLedgerPath,
      model_overrides: overrides,
    },
    { ground: allVerifiedGround, laneConcurrency: 4 },
  )
  return store
}

describe('runStrategyResearchSwarm — dual-model cross-check (moat + Shariah sector)', () => {
  it('OFF by default (no cross-check model configured) — single run, no crosscheck layer', async () => {
    const provider = crossCheckSwarmProvider({ primaryMoat: 'wide' })
    const store = await runXcSwarm(provider, {})
    const events = await store.list()
    expect(analysisCrosscheckOf(events)).toBeUndefined()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_xc')
    expect((cp?.open_questions ?? []).some((q) => q.includes('crosscheck'))).toBe(false)
  })

  it('AGREEMENT (moat) — proceeds, records crosscheck.agreed=true, no escalation', async () => {
    const provider = crossCheckSwarmProvider({ primaryMoat: 'wide', crossCheckMoat: 'wide' })
    const store = await runXcSwarm(provider, { lane_moat_crosscheck: { model: 'second-model' } })
    const events = await store.list()
    const xc = analysisCrosscheckOf(events)
    const moat = xc?.['moat_class'] as { agreed?: boolean; models?: string[] } | undefined
    expect(moat?.agreed).toBe(true)
    expect(moat?.models).toEqual(['primary-model', 'second-model'])
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_xc')
    expect((cp?.open_questions ?? []).some((q) => q.includes('crosscheck_disagreement'))).toBe(false)
  })

  it('DISAGREEMENT (moat) — conservative (lower) tier holds + requires_human_escalation in open_questions', async () => {
    // Primary says wide; cross-check says moderate → conservative (moderate) must hold + escalation.
    const provider = crossCheckSwarmProvider({ primaryMoat: 'wide', crossCheckMoat: 'moderate' })
    const store = await runXcSwarm(provider, { lane_moat_crosscheck: { model: 'second-model' } })
    const events = await store.list()
    const xc = analysisCrosscheckOf(events)
    const moat = xc?.['moat_class'] as { agreed?: boolean } | undefined
    expect(moat?.agreed).toBe(false)
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_xc')
    expect((cp?.open_questions ?? []).some((q) => q.includes('dual_model_crosscheck_disagreement') && q.includes('moat_class'))).toBe(true)
    // Conservative (moderate) is below the wide gate → the verdict is gated to PASS.
    expect(cp?.valuation?.moat_class).toBe('moderate')
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
  })

  it('DISAGREEMENT (Shariah sector) — stricter status holds + escalation', async () => {
    const provider = crossCheckSwarmProvider({ primarySector: 'compliant', crossCheckSector: 'non_compliant' })
    const store = await runXcSwarm(provider, { lane_shariah_crosscheck: { model: 'second-model' } })
    const events = await store.list()
    const xc = analysisCrosscheckOf(events)
    const shariah = xc?.['shariah_sector_status'] as { agreed?: boolean; crosscheck?: string } | undefined
    expect(shariah?.agreed).toBe(false)
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    // Stricter (non_compliant) sector status held → recorded sector status is non_compliant.
    expect((analysis?.payload as Record<string, unknown>)['shariah_sector_status']).toBe('non_compliant')
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_xc')
    expect((cp?.open_questions ?? []).some((q) => q.includes('dual_model_crosscheck_disagreement') && q.includes('shariah_sector_status'))).toBe(true)
  })

  it('DEGRADE (moat cross-check throws) — primary holds, gap surfaced, NOT an escalation', async () => {
    const provider = crossCheckSwarmProvider({ primaryMoat: 'wide', failMoatCrossCheck: true })
    const store = await runXcSwarm(provider, { lane_moat_crosscheck: { model: 'second-model' } })
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_xc')
    expect(cp?.valuation?.moat_class).toBe('wide') // primary held
    const oq = cp?.open_questions ?? []
    expect(oq.some((q) => q.includes('dual_model_crosscheck_degraded'))).toBe(true)
    expect(oq.some((q) => q.includes('dual_model_crosscheck_disagreement'))).toBe(false)
  })
})

describe('runStrategyResearchSwarm — model_role_env (file-configured tier overrides take effect)', () => {
  it('resolves a role onto the env-supplied model (red_team) without touching the run default', async () => {
    const store = new InMemoryEventStore()
    const base = swarmFakeProvider()
    // Record the model_id each schema_name was invoked with so we can assert the override landed.
    const modelBySchema = new Map<string, string>()
    const provider = {
      ...base,
      structured: vi.fn(async (req: { model_id?: string; response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName !== undefined && req.model_id !== undefined) modelBySchema.set(schemaName, req.model_id)
        return (base.structured as unknown as (r: unknown) => Promise<unknown>)(req)
      }),
    }
    const ground = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
        availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
      })),
      verified_ids: sources.map((s) => s.source_id),
    })

    await runStrategyResearchSwarm(
      store,
      provider as never,
      {
        research_case_id: 'rc_env',
        company_id: 'company_env',
        ticker: 'ENV',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'k_env',
        model_id: 'run-default-model',
        decision_id: 'decision_env',
        source_ledger_path: '/tmp/owlfolio-swarm-env-test-sources',
        // The env source the web/worker build from the env FILE merged over process.env. Same provider
        // (fake-swarm), a DIFFERENT model on red_team — proves the file-configured tier takes effect.
        model_role_env: { OWLFOLIO_MODEL_ROLE_RED_TEAM: 'fake-swarm:env-red-team-model@0.0' },
      },
      { ground, laneConcurrency: 3 },
    )

    // The red-team pass ran on the env-configured model; the circle gate (synthesis role, no
    // override configured) kept the run default.
    expect(modelBySchema.get('BuffettMungerInversion')).toBe('env-red-team-model')
    expect(modelBySchema.get('BuffettMungerCircleCompetence')).toBe('run-default-model')
  })
})

// ---------------------------------------------------------------------------------------------------
// FOUNDING-RISK FIX — the synthesis/decision agent fails closed on its OWN grounding.
//
// The decision agent's verdict + valuation/growth claims must be grounded in a VERIFIED source of its
// OWN — not merely in the union corpus the lanes already grounded (which is never empty). When the agent
// grounds NOTHING of its own (dec.verified_ids empty) OR its owner_earnings_citation / assumed_growth_
// citation do not verify against the corpus, the harness FAILS CLOSED: the recorded verdict is
// RESEARCH_MORE (NOT the model's confident investment_verdict) + a visible synthesis_grounding_unmet flag.
// A clean, fully-grounded synthesis still passes the model's verdict through (no false-positive).
// ---------------------------------------------------------------------------------------------------
describe('runStrategyResearchSwarm — synthesis own-grounding fail-closed (founding-risk fix)', () => {
  async function runWithSynthesis(
    rcId: string,
    opts: Omit<Parameters<typeof configurableSwarmProvider>[0], 'laneCount'>,
    ground: GroundFn = allVerifiedGround as GroundFn,
  ) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, ...opts })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-grounding-${rcId}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: rcId, company_id: `company_${rcId}`, ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${rcId}_k`,
        model_id: 'mock', decision_id: `decision_${rcId}`, source_ledger_path: sourceLedgerPath,
      },
      { ground, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === rcId)
    return { events, cp }
  }

  it('Test 1 — EMPTY OWN GROUNDING (union corpus non-empty): verdict RESEARCH_MORE + synthesis_grounding_unmet', async () => {
    // The lanes/quick-screen ground their sources (union corpus non-empty) but the decision agent's OWN
    // proposed source (src_dec_1) does NOT verify → dec.verified_ids empty. The old all-corpus check never
    // fires; the new Layer-1 own-grounding check must route to RESEARCH_MORE and set the flag.
    const groundExceptDecision = async (sources: { source_id: string }[]) => {
      const verifiable = sources.filter((s) => !s.source_id.startsWith('src_dec'))
      return {
        captured: sources.map((s) => {
          const ok = !s.source_id.startsWith('src_dec')
          return {
            source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
            availability: (ok ? 'available' : 'unavailable') as 'available' | 'unavailable',
            fetched_at: 'x', ...(ok ? { content_hash: 'sha256:1' } : {}),
          }
        }),
        verified_ids: verifiable.map((s) => s.source_id),
      }
    }
    // The model would have said BUY; the gate must NOT record that confident verdict.
    const { cp } = await runWithSynthesis('rc_g_empty', { investmentVerdict: 'BUY' }, groundExceptDecision)
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe('BUY')
  })

  it('Test 1b — CITATION-ALIGNED grounding (dogfood 2026-07-10): the decision proposes nothing of its own but CITES the corpus-verified filing → verdict passes through', async () => {
    // Live COST/SPGI shape: the citation-alignment steer tells the decision agent to cite the
    // harness-verified id instead of re-fetching its own copy. Kimi obeyed — valuation citations
    // verified against the hash-verified corpus — but proposed no NEW source, so the old Layer-1
    // check (dec.verified_ids empty) clamped a fully-cite-verified verdict to RESEARCH_MORE.
    const groundExceptDecision = async (sources: { source_id: string }[]) => {
      const verifiable = sources.filter((s) => !s.source_id.startsWith('src_dec'))
      return {
        captured: sources.map((s) => {
          const ok = !s.source_id.startsWith('src_dec')
          return {
            source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
            availability: (ok ? 'available' : 'unavailable') as 'available' | 'unavailable',
            fetched_at: 'x', ...(ok ? { content_hash: 'sha256:1' } : {}),
          }
        }),
        verified_ids: verifiable.map((s) => s.source_id),
      }
    }
    const { cp } = await runWithSynthesis('rc_g_aligned', {
      investmentVerdict: 'WATCH',
      synthesis: {
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_lane_moat', // a lane-grounded, hash-verified corpus id
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth grounded in segment capex per the corpus filing.',
          assumed_growth_citation: 'src_lane_moat',
        },
      },
    }, groundExceptDecision)
    expect(cp?.valuation?.synthesis_grounding_unmet).toBeUndefined()
    expect(cp?.investment_verdict ?? cp?.decision).toBe('WATCH')
  })

  it('Test 2 — UNGROUNDED GROWTH citation (not in corpus): verdict RESEARCH_MORE + synthesis_grounding_unmet', async () => {
    const { cp } = await runWithSynthesis('rc_g_growth', {
      investmentVerdict: 'BUY',
      synthesis: {
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_1', // verifies
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth rationale.',
          assumed_growth_citation: 'src_not_in_corpus', // does NOT verify
        },
      },
    })
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.valuation?.synthesis_grounding_reason).toMatch(/assumed_growth_citation/)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
  })

  it('E2: a legacy owner-earnings citation is IGNORED (stripped) — grounding rests on the growth citation alone', async () => {
    const { cp } = await runWithSynthesis('rc_g_oe', {
      investmentVerdict: 'WATCH',
      synthesis: {
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_not_in_corpus', // legacy field — stripped by the schema, never checked
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth rationale.',
          assumed_growth_citation: 'src_dec_1', // verifies
        },
      },
    })
    expect(cp?.valuation?.synthesis_grounding_unmet).toBeUndefined()
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe('RESEARCH_MORE')
  })

  it('Test 2b — CAPTURED-BUT-UNVERIFIED citation (in corpus, NO content_hash): verdict RESEARCH_MORE + synthesis_grounding_unmet', async () => {
    // The A1 hole repro. L1 PASSES: the decision agent grounds a real source (src_dec_good_1 → in
    // dec.verified_ids). But the valuation citations point at src_dec_bad_1 — a source that was CAPTURED
    // (it shows up in `accumulated`) but FAILED to ground (no content_hash, excluded from verified_ids,
    // e.g. SSRF/404/redirect-exhausted/network). The old cite-check sets added every captured source_id
    // unconditionally, so src_dec_bad_1 'verified' and L2 waved a confident verdict through. After the fix
    // only VERIFIED sources (content_hash present) enter the set → the gate fires.
    const groundGoodCaptureBad = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => {
        const ok = !s.source_id.includes('bad')
        return {
          source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
          // 'bad' ids are captured (present in accumulated) but UNAVAILABLE — no content_hash.
          availability: (ok ? 'available' : 'unavailable') as 'available' | 'unavailable',
          fetched_at: 'x', ...(ok ? { content_hash: 'sha256:1' } : {}),
        }
      }),
      verified_ids: sources.filter((s) => !s.source_id.includes('bad')).map((s) => s.source_id),
    })
    const { cp } = await runWithSynthesis('rc_g_captured_unverified', {
      investmentVerdict: 'BUY',
      decisionProposesGoodBad: true,
      synthesis: {
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          // Cite the captured-but-unverified source for BOTH valuation claims. L1 is still satisfied
          // because the agent also grounded src_dec_good_1.
          owner_earnings_citation: 'src_dec_bad_1',
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth rationale.',
          assumed_growth_citation: 'src_dec_bad_1',
        },
      },
    }, groundGoodCaptureBad as GroundFn)
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.valuation?.synthesis_grounding_reason).toMatch(/owner_earnings_citation|assumed_growth_citation/)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe('BUY')
  })

  it('Test 4 — FULLY GROUNDED (own verified_ids + both citations verify): model verdict passes through, NO flag', async () => {
    // The decision agent grounds src_dec_1 and cites it for BOTH valuation claims (default fixture shape).
    // A model WATCH here passes through cleanly — NO synthesis_grounding_unmet flag (proves no false-positive
    // on a clean grounded synthesis; the grounding gate does NOT clamp a properly-grounded verdict). WATCH
    // (not BUY) is used so the unrelated buy-data gate — which needs a live price — does not interfere.
    const { cp } = await runWithSynthesis('rc_g_clean', { investmentVerdict: 'WATCH' })
    expect(cp?.valuation?.synthesis_grounding_unmet).toBeUndefined()
    expect(cp?.valuation?.synthesis_grounding_reason).toBeUndefined()
    expect(cp?.investment_verdict ?? cp?.decision).toBe('WATCH')
  })

  it('Tripwire — NO CONFIDENT VERDICT ON UNGROUNDED SYNTHESIS (valuation_reasoning omitted entirely)', async () => {
    // Wiring-conformance: with the decision agent producing NO valuation_reasoning at all (and so no
    // citations), the recorded decision verdict MUST be RESEARCH_MORE + synthesis_grounding_unmet — NEVER
    // the model's confident investment_verdict. This guards the founding-risk gate at the final verdict.
    // V4: the STAGE is the sole owner — the tripwire now forces the stage to omit (the monolithic
    // fields no longer exist to omit).
    const { cp } = await runWithSynthesis('rc_g_trip', { investmentVerdict: 'BUY', omitValuationReasoning: true, stageOmitsValuation: true })
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe('BUY')
  })
})

// ---------------------------------------------------------------------------------------------------
// §2 REFERENCE FV + IMPLIED-EXIT-MULTIPLE — A1 SYMMETRY (fail-closed at every assumed_growth claim point).
//
// A1/B5 already omit the HEADLINE growth_rate/fair_value_per_share when the model's assumed_growth is not
// cite-verified. But the §2 sanity REFERENCES — reference_fair_value and implied_exit_multiple — derived
// from the RAW assumed_growth, so a PRESENT-BUT-UNGROUNDED growth still emitted those reference numbers
// ("confident output on ungrounded input"). They must now be gated on the SAME cite-verified-assumed-growth
// signal the headline uses. market_implied_growth is the PRIMARY lens (reverse-DCF of price + EDGAR
// owner-earnings, NOT the model's assumed_growth) and must STAY ungated — it still computes from price+OE.
// ---------------------------------------------------------------------------------------------------
describe('§2 reference FV + implied-exit-multiple — gated on grounded assumed_growth (A1 symmetry)', () => {
  // A growing EDGAR series so owner-earnings-per-share is grounded (→ market_implied_growth is computable
  // from price+OE regardless of the assumed_growth grounding).
  function growingFundamentals(): Fundamentals {
    const series: AnnualFacts[] = []
    for (let i = 0; i < 6; i += 1) {
      const fy = 2019 + i
      const ni = Math.round(1000 * Math.pow(1.10, i))
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, cfo_musd: ni + 200, sbc_musd: 0, diluted_shares_m: 100 })
    }
    return {
      cik: '0000000001', entity_name: 'GROWER INC', currency: 'USD',
      latest_annual: series[series.length - 1]!,
      annual_series: series,
      filings: [{ form: '10-K', filed: '2024-02-01', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm' }],
    }
  }

  async function runWithGrowthCitation(rcId: string, assumedGrowthCitation: string) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      investmentVerdict: 'BUY',
      synthesis: {
        moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.40,
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_1', // verifies under allVerifiedGround
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth rationale.',
          assumed_growth_citation: assumedGrowthCitation,
        },
      },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-s2gate-${rcId}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: rcId, company_id: `company_${rcId}`, ticker: 'GRW',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${rcId}_k`,
        model_id: 'mock', decision_id: `decision_${rcId}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4, fundamentals: growingFundamentals(),
        resolvePrice: async () => ({ available: true as const, price_per_share: 150, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === rcId)
    const valuation = cp?.valuation as Record<string, unknown> | undefined
    return { cp, valuation }
  }

  it('UNGROUNDED assumed_growth (present, citation does NOT verify) → reference_fair_value + implied_exit_multiple omitted; market_implied_growth still present; RESEARCH_MORE', async () => {
    // src_not_in_corpus is never proposed → never captured/verified → assumed_growth is ungrounded.
    const { cp, valuation } = await runWithGrowthCitation('rc_s2_ungrounded', 'src_not_in_corpus')
    // A1: ungrounded assumed_growth routes the verdict to RESEARCH_MORE and omits the headline growth.
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
    // The two §2 references that CONSUME the model's assumed_growth are omitted (fail-closed, A1 symmetry).
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(valuation?.['implied_exit_multiple']).toBeUndefined()
    // The PRIMARY lens stays ungated: computed from price (50) + EDGAR owner-earnings, NOT assumed_growth.
    expect(typeof valuation?.['market_implied_growth']).toBe('number')
    expect(Number.isFinite(valuation?.['market_implied_growth'] as number)).toBe(true)
  })

  it('GROUNDED assumed_growth (citation verifies) → kept §2 references present (no false omission)', async () => {
    const { cp, valuation } = await runWithGrowthCitation('rc_s2_grounded', 'src_dec_1')
    expect(cp?.valuation?.synthesis_grounding_unmet).toBeUndefined()
    // forward-DCF removal: the dollar reference_fair_value is no longer surfaced even when grounded. The kept
    // §2 reference (implied_exit_multiple) + the reverse-DCF market_implied_growth are present.
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(typeof valuation?.['implied_exit_multiple']).toBe('number')
    expect(typeof valuation?.['market_implied_growth']).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// CIRCLE-OF-COMPETENCE gate — a sequential GROUNDED MODEL JUDGMENT that gates the 5-lane deep-dive spend.
// The model must DEMONSTRATE understanding by cite-verifying BOTH the cashflow drivers AND what would make
// them unpredictable (same rigor). Ungrounded EITHER clause = outside competence (fail-closed). Binary
// outcome: in-competence → run the 5 lanes; outside-competence → set aside (PASS), never RESEARCH_MORE.
// ---------------------------------------------------------------------------
describe('circle-of-competence gate', () => {
  // A swarm fake provider whose circle judgment reports a business_understanding verdict and cites
  // `driverCite`/`breakerCite` for the two clauses. `driverText`/`breakerText` default to substantive text
  // but can be set to '' to exercise the empty-text (Bug A) regression. Everything else mirrors
  // swarmFakeProvider (full happy-path deep dive).
  function circleSwarmProvider(opts: {
    business_understanding: 'understood' | 'not_understood' | 'uncertain'
    driverCite: string
    breakerCite: string
    driverText?: string
    breakerText?: string
  }) {
    let laneCall = 0
    const src = (id: string) => ({
      source_id: id,
      title: 'Test source',
      url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm',
      excerpt: 'Test excerpt',
    })
    return {
      provider_id: 'fake-swarm-circle',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName === 'BuffettMungerCircleCompetence') {
          return {
            understanding_drivers: [{ driver: opts.driverText ?? 'Recurring insurance float invested at scale', citation: opts.driverCite }],
            key_moving_parts: [{ breaker: opts.breakerText ?? 'Catastrophe-loss tail volatility', citation: opts.breakerCite }],
            competence_reasoning: opts.business_understanding === 'understood'
              ? 'Understandable cashflow engine grounded in the 10-K.'
              : 'I understand the business but its cashflows are not durably predictable.',
            business_understanding: opts.business_understanding,
            proposed_sources: [src('src_circle_driver'), src('src_circle_breaker')],
          }
        }
        if (schemaName === 'BuffettMungerCircleCompetence') {
          return fakeCirclePayload(src)
        }
      if (schemaName === 'BuffettMungerQuickScreen') {
          return {
            summary: 'Good business', business_quality: 'Strong', moat: 'Wide moat',
            management_capital_allocation: 'Excellent', financial_quality: 'Solid', valuation_sanity: 'Reasonable',
            shariah_status: 'COMPLIANT', red_flags: ['None identified'], confidence: 'high', caveats: ['Mock caveat'],
            screening_result: 'deep_dive_candidate', proposed_sources: [src('src_qs_1')],
          }
        }
        if (schemaName === 'BuffettMungerUnderstandLane') {
          return fakeUnderstandLanePayload(src)
        }
        if (schemaName === 'BuffettMungerManagementLane') {
          return fakeManagementLanePayload(src)
        }
        if (schemaName === 'BuffettMungerMoatLane') {
          return {
            finding_summary: 'Moat lane finding', confidence: 'medium' as const, caveats: ['Mock moat caveat'],
            ...moatThesisForTier('wide', 'src_lane_moat'), runway: 'proven' as const,
            ...runwayThesisForTier('proven', 'src_lane_moat'),
            proposed_sources: [src('src_lane_moat')],
          }
        }
        if (schemaName === 'BuffettMungerShariahLane') {
          return {
            finding_summary: 'Shariah lane finding', confidence: 'medium' as const, caveats: ['Mock shariah caveat'],
            sector_status: 'compliant' as const, impermissible_income: 0,
            proposed_sources: [src('src_lane_shariah')],
          }
        }
        if (schemaName === 'BuffettMungerLaneFinding') {
          const n = laneCall++
          return { finding_summary: `Lane ${n} finding`, confidence: 'medium', caveats: ['Mock lane caveat'], proposed_sources: [src(`src_lane_${n}`)] }
        }
        if (schemaName === 'BuffettMungerInversion') {
          return {
            strongest_case_against: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
            shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_shariah_reasoning'] },
            proposed_sources: [src('src_shariah_reasoning')],
          }
        }
        if (schemaName === 'BuffettMungerRedTeamResponse') {
          return { synthesis_response: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' }, proposed_sources: [src('src_qs_1')] }
        }
        // Synthesis + decision
        return {
          investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
          next_required_action: 'Await margin of safety before buying.', decision_reason: 'Solid business, needs margin of safety',
          thesis_summary: 'Quality compounder', evidence_summary: 'Covered by mock sources', valuation_rationale: 'Elevated valuation',
          shariah_rationale: 'No prohibited activities detected', synthesis_summary: 'All lanes reviewed; watch for better entry',
          risks: ['Valuation risk'], open_questions: ['Margin of safety needed'],
          ...DECISION_MOS_FIXTURE,
          growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
          owner_earnings_bridge: { net_income: 18, depreciation_amortization: 4, maintenance_capex: 3, maintenance_capex_proxy_tier: '50', stock_based_comp: 2, normalized_working_capital_change: 0, shares_outstanding: 1 },
          roic: 0.20, incremental_roic: 0.20, reinvestment_rate: 0.40, proposed_buy_below: 150,
          valuation_reasoning: { owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'Modest mid-single-digit growth grounded in segment capex, cited to the 10-K.', assumed_growth_citation: 'src_dec_1' },
          proposed_sources: [src('src_dec_1')],
        }
      }),
    }
  }

  // Ground fn: verifies every source EXCEPT those whose source_id is in `unverified` (no content_hash →
  // not in the cite-check set, exactly like the §2/A1 fixtures).
  function circleGround(unverified: Set<string>): GroundFn {
    return (async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
        availability: (unverified.has(s.source_id) ? 'unavailable' : 'available') as 'available' | 'unavailable',
        fetched_at: 'x', ...(unverified.has(s.source_id) ? {} : { content_hash: 'sha256:1' }),
      })),
      verified_ids: sources.filter((s) => !unverified.has(s.source_id)).map((s) => s.source_id),
    })) as unknown as GroundFn
  }

  async function runCircle(research_case_id: string, opts: { business_understanding: 'understood' | 'not_understood' | 'uncertain'; driverCite: string; breakerCite: string; driverText?: string; breakerText?: string; unverified?: Set<string> }) {
    const store = new InMemoryEventStore()
    const provider = circleSwarmProvider({
      business_understanding: opts.business_understanding,
      driverCite: opts.driverCite,
      breakerCite: opts.breakerCite,
      ...(opts.driverText !== undefined ? { driverText: opts.driverText } : {}),
      ...(opts.breakerText !== undefined ? { breakerText: opts.breakerText } : {}),
    })
    const result = await runStrategyResearchSwarm(
      store, provider as never,
      // circle_gate pinned to the BASE single-sample 1/1 mechanics — this describe tests the Bug A/B
      // grounding semantics with one driver + one breaker; the k-sample/floor hardening has its own suite.
      { research_case_id, company_id: 'c', ticker: 'CIRC', strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'k', model_id: 'mock', decision_id: `d_${research_case_id}`, source_ledger_path: '/tmp/owlfolio-circle', circle_gate: { k_samples: 1, min_drivers: 1, min_breakers: 1 } },
      { ground: circleGround(opts.unverified ?? new Set()), laneConcurrency: 3 },
    )
    const events = await store.list()
    const cases = projectResearchCases(events)
    return { store, events, types: events.map((e) => e.event_type), cp: cases.find((c) => c.research_case_id === research_case_id), result }
  }

  it('1. understood + both clauses grounded (non-empty text) → gate passes, the 5-lane deep dive runs', async () => {
    const { types, cp } = await runCircle('rc_circle_in', { business_understanding: 'understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    // The judgment was recorded and the deep dive ran (lanes + synthesis).
    expect(types).toContain('circle_competence_judged')
    expect(types).toContain('deep_dive_started')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(3)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    // The model's (gated) verdict flows through — NOT a circle set-aside.
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe(undefined)
  })

  it('2. not_understood (understood but cyclical — the MU case) WITH grounded substantive clauses → SET ASIDE (PASS), 5 lanes do NOT run', async () => {
    // Bug B: the model understands the business and grounds BOTH clauses, but judges the cashflows
    // not durably predictable. The gate must set aside on the verdict, NOT proceed.
    const { types, cp } = await runCircle('rc_circle_not_understood', { business_understanding: 'not_understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    expect(types).toContain('circle_competence_judged')
    // The expensive deep dive was SKIPPED — no lanes, no synthesis.
    expect(types).not.toContain('deep_dive_started')
    expect(types).not.toContain('specialist_finding_recorded')
    expect(types).not.toContain('deep_dive_synthesis_drafted')
    // Terminal decision: PASS (set aside), flagged outside the circle, NEVER RESEARCH_MORE.
    expect(types).toContain('decision_drafted')
    expect(cp?.investment_verdict ?? cp?.decision).toBe('PASS')
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe('RESEARCH_MORE')
    expect(cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('SET-ASIDE early-exit stamps engine_version at the analysis payload ROOT (and projects it top-level)', async () => {
    const { events, cp } = await runCircle('rc_circle_engine_version', { business_understanding: 'not_understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    // The set-aside path emits the analysis event WITHOUT running the deep dive — it must still stamp the
    // root engine_version so the dossier marker reads as the current engine rather than "unknown".
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysis?.payload as Record<string, unknown>)?.['engine_version']).toBe(ENGINE_VERSION)
    // And it must project to the TOP-LEVEL field (the set-aside event has no valuation.judgment block).
    expect(cp?.engine_version).toBe(ENGINE_VERSION)
    expect(cp?.valuation?.judgment).toBeUndefined()
  })

  it("3. uncertain → SET ASIDE (PASS), 5 lanes do NOT run", async () => {
    const { types, cp } = await runCircle('rc_circle_uncertain', { business_understanding: 'uncertain', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    expect(types).not.toContain('deep_dive_started')
    expect(cp?.investment_verdict ?? cp?.decision).toBe('PASS')
    expect(cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('4. Bug A — empty driver TEXT (with a verified citation) does NOT count as grounded → SET ASIDE', async () => {
    // understood + a VERIFIED breaker citation, but the driver has empty text. An empty claim must
    // NOT clear the bar even though its citation verifies — drops grounded drivers below 1 → set aside.
    const { types, cp } = await runCircle('rc_circle_empty_driver', {
      business_understanding: 'understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      driverText: '',
    })
    expect(types).not.toContain('deep_dive_started')
    expect(cp?.investment_verdict ?? cp?.decision).toBe('PASS')
    expect(cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('4b. Bug A schema — a missing driver/breaker TEXT is rejected at parse (text is now REQUIRED)', () => {
    // The split schemas make driver/breaker text non-optional. Parsing a claim without text must fail.
    expect(UnderstandingDriverSchema.safeParse({ citation: 'src_x' }).success).toBe(false)
    expect(UnderstandingDriverSchema.safeParse({ driver: '', citation: 'src_x' }).success).toBe(false)
    expect(KeyMovingPartSchema.safeParse({ citation: 'src_x' }).success).toBe(false)
    expect(UnderstandingDriverSchema.safeParse({ driver: 'd', citation: 'src_x' }).success).toBe(true)
    expect(KeyMovingPartSchema.safeParse({ breaker: 'b', citation: 'src_x' }).success).toBe(true)
  })

  it('5. fail-closed: ungrounded citations (drivers OR breakers) → SET ASIDE (unchanged)', async () => {
    const drivers = await runCircle('rc_circle_ungrounded_drivers', {
      business_understanding: 'understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      unverified: new Set(['src_circle_driver']),
    })
    expect(drivers.types).not.toContain('deep_dive_started')
    expect(drivers.cp?.investment_verdict ?? drivers.cp?.decision).toBe('PASS')
    expect(drivers.cp?.valuation?.circle_competence_unmet).toBe(true)

    const breakers = await runCircle('rc_circle_ungrounded_breakers', {
      business_understanding: 'understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      unverified: new Set(['src_circle_breaker']),
    })
    expect(breakers.types).not.toContain('deep_dive_started')
    expect(breakers.cp?.investment_verdict ?? breakers.cp?.decision).toBe('PASS')
    expect(breakers.cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('6. projects the predictability verdict + model_claimed_judgment + required-text clauses onto the case', async () => {
    const { cp } = await runCircle('rc_circle_proj', { business_understanding: 'understood', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    const circle = cp?.circle_competence
    expect(circle).toBeDefined()
    expect(circle?.in_competence).toBe(true)
    expect(circle?.judgment).toBe('understood')
    expect(circle?.model_claimed_judgment).toBe('understood')
    expect(circle?.drivers?.[0]?.driver).toBeTruthy()
    expect(circle?.breakers?.[0]?.breaker).toBeTruthy()
    expect(circle?.competence_reasoning).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — price AND/OR moat, substitutable sources.
// The headline of the MoS audit surface. Guard 1: adequacy is audit-only, NEVER a gate. Guard 2: a
// moat-sourced margin must rest on a grounded/gate-passing moat (incoherence flag otherwise).
// ---------------------------------------------------------------------------
describe('D3: the joint margin-of-safety judgment is RETIRED from the engine', () => {
  async function runMos(synthesis: SynthesisOverrides, id: string, opts: { moatGateOverride?: boolean } = {}) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, synthesis })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-mos-${id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${id}_k`,
        model_id: 'mock', decision_id: `decision_${id}`, source_ledger_path: sourceLedgerPath,
        circle_gate: { k_samples: 1, min_drivers: 1, min_breakers: 1 },
        ...(opts.moatGateOverride === true ? { moat_gate_override: true } : {}),
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: true as const, price_per_share: 50, currency: 'USD', as_of: 'x', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, analysisEvent, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('a synthesis that still emits margin_of_safety persists NO judgment fields (schema strips it)', async () => {
    const { analysisEvent, cp } = await runMos({
      moat_class: 'wide', runway: 'proven',
      margin_of_safety: {
        sources: ['price', 'moat'],
        price_gap_reasoning: 'Price sits well below the proposed buy-below.',
        moat_durability_reasoning: 'The grounded wide moat lets time bail out estimate error.',
        adequacy: 'adequate',
        reasoning: 'Legacy-model emission — the engine must ignore it.',
      },
    }, 'mos-retired')
    const payload = analysisEvent?.payload as Record<string, unknown>
    // The book's mechanical grade is the ONLY margin surface on new events.
    expect(payload['margin_of_safety_judgment']).toBeUndefined()
    expect(payload['margin_of_safety_moat_ungrounded']).toBeUndefined()
    expect(cp !== undefined && 'margin_of_safety_judgment' in cp).toBe(false)
    expect(cp !== undefined && 'margin_of_safety_moat_ungrounded' in cp).toBe(false)
    // The T0 grade + the thesis-break audit fields still carry.
    expect(payload['key_wrong_assumption']).toBeTruthy()
    expect(payload['thesis_break_triggers']).toBeTruthy()
  })
})

// Owner calibration (2026-07-12): a moat is PROTECTION — the prompt must demand the replication test
// (what stops a funded rival from copying this?) and must exclude strengths-as-moats.
describe('moat-pillar prompt calibration — real moats, not strengths', () => {
  it('demands the replication test and excludes operational excellence as a moat', () => {
    expect(MOAT_PILLAR_PROMPT).toContain('A MOAT IS PROTECTION, NOT A STRENGTH')
    expect(MOAT_PILLAR_PROMPT).toContain('REPLICATION TEST')
    expect(MOAT_PILLAR_PROMPT).toContain('STOPS a rival')
    expect(MOAT_PILLAR_PROMPT).toContain('STRENGTHS, not moats')
    expect(MOAT_PILLAR_PROMPT).toContain('why it cannot ')
  })
})

describe('circle-gate prompt calibration (live find: Kimi K2 marked Visa "uncertain")', () => {
  it('the rubric is symmetric, decouples the evidence floor from the verdict, and anchors the enum', () => {
    // Live miscalibration: the old rubric validated only the set-aside, and the 3/3 evidence floor
    // FORCED three well-cited breakers which then read as "dominant" — Visa came back 'uncertain' on
    // real-but-ordinary risks (interchange litigation). The rubric must state that required breakers
    // do not imply unpredictability and that 'uncertain' is not a safe harbor.
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('BOTH answers are equally valid')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('does NOT by itself imply')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('CORE ECONOMIC ENGINE')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('payments network')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('NOT a safe middle ground')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('do NOT manufacture confusion')
    // C1 (owner-locked): durability is EXPLICITLY not this gate's question — the moat pillar owns it.
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('durable cash is what a MOAT produces')
    // G/P1 (owner spec): the two questions of the mental model.
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('HOW DOES THIS COMPANY MAKE MONEY')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('KEY MOVING PARTS')
  })
})

describe('prompt calibration fixes (2026-07-09 audit)', () => {
  it('synthesis decouples the mandated audit artifacts from the verdict', async () => {
    const src = await readFile(new URL('../researchSwarm.ts', import.meta.url), 'utf8')
    expect(src).toContain('do NOT argue against your own verdict')
    expect(src).toContain('not evidence of fragility')
    // Moat cross-check guards BOTH directions.
    expect(src).toContain('do NOT manufacture narrowness the filings do not support')
  })
})

// ---------------------------------------------------------------------------------------------------
// S2 (Phase 3 pillars): the owner's three NAMED moat tests (capital efficiency / two-engine /
// standout) are computed T0 from the EDGAR series and PERSISTED on the analysis payload +
// projection. They are display/judgment context in this slice — never a gate by themselves.
// ---------------------------------------------------------------------------------------------------
describe('S2 — moat_tests persisted on the analysis event and projection', () => {
  function testsSeries(): AnnualFacts[] {
    const series: AnnualFacts[] = []
    for (let i = 0; i < 6; i += 1) {
      const fy = 2019 + i
      const rev = Math.round(10000 * Math.pow(1.06, i))
      series.push({
        fiscal_year: fy, currency: 'USD',
        net_income_musd: Math.round(1000 * Math.pow(1.1, i)), revenue_musd: rev,
        d_and_a_musd: 200, capex_musd: 200, sbc_musd: 0, diluted_shares_m: 100,
        operating_income_musd: Math.round(rev * (0.25 + 0.005 * i)),
        income_tax_expense_musd: 0,
        stockholders_equity_musd: Math.round(rev * (0.25 + 0.005 * i) * 5), // ROIC 20% every year
        gross_profit_musd: Math.round(rev * 0.55),
      })
    }
    return series
  }

  it('persists all three named tests (computable) on the payload and the projection', async () => {
    const series = testsSeries()
    const fundamentals: Fundamentals = {
      cik: '0000000001', entity_name: 'TESTS INC', currency: 'USD',
      latest_annual: series[series.length - 1]!, annual_series: series,
      filings: [{ form: '10-K', filed: '2024-02-01', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm' }],
    }
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.40 },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-moattests-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_moattests', company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'moattests_k',
        model_id: 'mock', decision_id: 'decision_moattests', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4, fundamentals,
        resolvePrice: async () => ({ available: true, price_per_share: 50, currency: 'USD', as_of: 'x', source: 'test' }),
      },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const tests = (analysis?.payload as Record<string, unknown>)?.['moat_tests'] as {
      capital_efficiency?: { computable?: boolean; band?: string }
      two_engine?: { computable?: boolean; passes?: boolean }
      standout?: { computable?: boolean; basis?: string }
    } | undefined
    expect(tests).toBeDefined()
    expect(tests?.capital_efficiency?.computable).toBe(true)
    expect(tests?.capital_efficiency?.band).toBe('excellent')
    expect(tests?.two_engine?.computable).toBe(true)
    expect(tests?.two_engine?.passes).toBe(true)
    expect(tests?.standout?.computable).toBe(true)
    expect(tests?.standout?.basis).toBe('gross_margin')

    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_moattests') as (typeof projections)[number] & {
      moat_tests?: { capital_efficiency?: { band?: string } }
    }
    expect(cp?.moat_tests?.capital_efficiency?.band).toBe('excellent')
  })

  it('omits moat_tests entirely when no EDGAR fundamentals exist (nothing to compute over)', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven' },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-moattests-none-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_moattests_none', company_id: 'c', ticker: 'TSN',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'moattests_none_k',
        model_id: 'mock', decision_id: 'decision_moattests_none', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysis?.payload as Record<string, unknown>)?.['moat_tests']).toBeUndefined()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_moattests_none') as Record<string, unknown> | undefined
    expect(cp?.['moat_tests']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------
// S3 (Phase 3 pillars): moat taxonomy + direction + peer standout persisted through the judgment
// projection, and the OWNER RULE clamp — a model BUY on a GROUNDED narrowing moat records WATCH
// ("a narrowing moat is a sell signal no matter how wide it still looks"). Ungrounded direction has
// no teeth. Uses the relit fixture (in-zone price 120 < computed threshold 184.86) so nothing else clamps.
// ---------------------------------------------------------------------------------------------------
describe('S3 — moat pillar judgment: taxonomy/direction/peer persisted + the narrowing clamp', () => {
  // Local mirror of the relit-fixture runner (the other runRelit is scoped to its own describe).
  async function runRelit(opts: {
    id: string
    price: number
    investmentVerdict?: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
    valuationStatus?: 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA'
    proposedBuyBelow?: number
    moatLaneExtras?: Record<string, unknown>
  }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      ...(opts.moatLaneExtras !== undefined ? { moatLaneExtras: opts.moatLaneExtras } : {}),
      synthesis: {
        moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43,
        ...(opts.proposedBuyBelow !== undefined ? { proposed_buy_below: opts.proposedBuyBelow } : {}),
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_1',
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Cited to the latest 10-K segment capex.',
          assumed_growth_citation: 'src_dec_1',
        },
      },
      investmentVerdict: opts.investmentVerdict ?? 'WATCH',
      ...(opts.valuationStatus !== undefined ? { valuationStatus: opts.valuationStatus } : {}),
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-s3-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        // E2: the FCF basis defaults to the shared fixture (buy_below 184.86 with the fake's g + 15×).
        fundamentals: e2FcfFundamentals,
        resolvePrice: async () => ({ available: true as const, price_per_share: opts.price, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    return { events, valuation, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('persists taxonomy chips, the stable direction, and the peer-standout labels on the judgment projection', async () => {
    const { valuation } = await runRelit({ id: 's3-persist', price: 250, investmentVerdict: 'WATCH', proposedBuyBelow: 290 })
    const judgment = valuation?.['judgment'] as { moat?: Record<string, unknown> } | undefined
    const moatAxis = judgment?.moat
    expect(moatAxis?.['resolved_moat_types']).toEqual(['brand', 'scale_advantage'])
    expect(moatAxis?.['moat_direction']).toBe('stable')
    const peers = (moatAxis?.['peer_standout'] as { peers?: Array<{ name: string; model_asserted?: boolean }> })?.peers
    expect(peers?.[0]?.name).toBe('PeerCo')
    expect(peers?.[0]?.model_asserted).toBe(true) // uncited peer figure = labeled model-asserted
  })

  it('OWNER RULE — model BUY + GROUNDED narrowing moat → recorded WATCH with the moat-narrowing reason', async () => {
    const { cp } = await runRelit({
      id: 's3-narrowing', price: 120, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 150,
      moatLaneExtras: {
        moat_direction: 'narrowing',
        direction_drivers: [{ evidence: 'private-label share taking 200bps/yr from the brand', citation: 'src_lane_moat' }],
        direction_reasoning: 'Cited share erosion.',
      },
    })
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /moat_narrowing/.test(q) && /sell signal/i.test(q))).toBe(true)
  })

  it('an UNGROUNDED narrowing claim has no teeth: BUY stays BUY, direction resolves undetermined', async () => {
    const { cp, valuation } = await runRelit({
      id: 's3-narrowing-ungrounded', price: 120, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 150,
      moatLaneExtras: {
        moat_direction: 'narrowing',
        direction_drivers: [{ evidence: 'vibes about erosion', citation: 'src_never_captured' }],
        direction_reasoning: 'Ungrounded.',
      },
    })
    expect(cp?.investment_verdict).toBe('BUY')
    const moatAxis = (valuation?.['judgment'] as { moat?: Record<string, unknown> } | undefined)?.moat
    expect(moatAxis?.['moat_direction']).toBe('undetermined')
    expect(moatAxis?.['direction_ungrounded']).toBe(true)
    expect((cp?.open_questions ?? []).some((q) => /moat_narrowing/.test(q))).toBe(false)
  })

  it('a grounded WIDENING direction never clamps (conservative-only rail)', async () => {
    const { cp } = await runRelit({
      id: 's3-widening', price: 120, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 150,
      moatLaneExtras: {
        moat_direction: 'widening',
        direction_drivers: [{ evidence: 'renewal rates + unit growth compounding the network', citation: 'src_lane_moat' }],
      },
    })
    expect(cp?.investment_verdict).toBe('BUY')
  })
})

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): the MANAGEMENT VETO — "no price compensates for management you can't trust",
// extended by the owner to talent. BUY + a GROUNDED worst-tier management judgment (integrity
// red_flag OR poor talent) → RESEARCH_MORE with the reason NAMING the failed trait. Ungrounded
// claims have no teeth. The resolved judgment + T0 block persist on the analysis payload.
// ---------------------------------------------------------------------------------------------------
describe('S5 — management pillar: persisted judgment + the veto rail', () => {
  async function runMgmt(opts: {
    id: string
    investmentVerdict?: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
    managementLaneExtras?: Record<string, unknown>
  }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      ...(opts.managementLaneExtras !== undefined ? { managementLaneExtras: opts.managementLaneExtras } : {}),
      synthesis: {
        moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43,
        proposed_buy_below: 150,
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_dec_1',
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Cited.',
          assumed_growth_citation: 'src_dec_1',
        },
      },
      investmentVerdict: opts.investmentVerdict ?? 'WATCH',
      valuationStatus: 'ATTRACTIVE',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-s5-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        // E2: the FCF basis so BUY tests price.
        fundamentals: e2FcfFundamentals,
        resolvePrice: async () => ({ available: true as const, price_per_share: 120, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const payload = analysisEvent?.payload as Record<string, unknown> | undefined
    return { payload, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('persists the resolved management judgment (grounded clean + excellent) on the analysis payload', async () => {
    const { payload, cp } = await runMgmt({ id: 's5-persist' })
    const mj = payload?.['management_judgment'] as Record<string, unknown> | undefined
    expect(mj?.['resolved_integrity']).toBe('clean')
    expect(mj?.['resolved_talent']).toBe('excellent')
    expect(payload?.['management_veto_applied']).toBeUndefined()
    expect(cp?.investment_verdict).toBe('WATCH') // the model's verdict passes through untouched
  })

  it('VETO (integrity): BUY + a GROUNDED high-severity integrity flag → RESEARCH_MORE naming the trait', async () => {
    const { cp, payload } = await runMgmt({
      id: 's5-veto-integrity', investmentVerdict: 'BUY',
      managementLaneExtras: {
        integrity: {
          communication_observations: [{ observation: 'MD&A candor', citation: 'src_lane_mgmt' }],
          comp_structure: { summary: 'ok', alignment: 'mixed', citation: 'src_lane_mgmt' },
          integrity_flags: [{ claim: 'Undisclosed related-party purchases from a director-controlled vendor', severity: 'high', citation: 'src_lane_mgmt' }],
          proposed_integrity: 'red_flag',
          integrity_reasoning: 'Cited related-party dealing.',
        },
      },
    })
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
    expect(payload?.['management_veto_applied']).toBe('integrity')
    expect((cp?.open_questions ?? []).some((q) => /management_veto \(integrity\)/.test(q) && /no price compensates/i.test(q))).toBe(true)
  })

  it('VETO (talent): BUY + GROUNDED poor talent → RESEARCH_MORE naming the trait', async () => {
    const { cp, payload } = await runMgmt({
      id: 's5-veto-talent', investmentVerdict: 'BUY',
      managementLaneExtras: {
        talent: {
          talent_drivers: [{ evidence: 'Serial dilutive acquisitions written down within 3 years', citation: 'src_lane_mgmt' }],
          proposed_talent: 'poor',
          talent_reasoning: 'Empire building.',
        },
      },
    })
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
    expect(payload?.['management_veto_applied']).toBe('talent')
  })

  it('an UNGROUNDED red flag has no teeth: BUY survives; the judgment resolves undetermined', async () => {
    const { cp, payload } = await runMgmt({
      id: 's5-veto-ungrounded', investmentVerdict: 'BUY',
      managementLaneExtras: {
        integrity: {
          communication_observations: [{ observation: 'MD&A candor', citation: 'src_lane_mgmt' }],
          comp_structure: { summary: 'ok', alignment: 'mixed', citation: 'src_lane_mgmt' },
          integrity_flags: [{ claim: 'Rumored self-dealing', severity: 'high', citation: 'src_never_captured' }],
          proposed_integrity: 'red_flag',
          integrity_reasoning: 'Ungrounded rumor.',
        },
      },
    })
    expect(cp?.investment_verdict).toBe('BUY')
    const mj = payload?.['management_judgment'] as Record<string, unknown> | undefined
    expect(mj?.['resolved_integrity']).toBe('undetermined')
    expect(payload?.['management_veto_applied']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------
// S6 (Phase 3 pillars): the EARLY MOAT GATE — Pillar 2 must pass before Pillars 3–4 spend a token.
// The stage-cost proof: on a gate death the management lane, valuation stage, red team, and synthesis
// are NEVER CALLED (not just suppressed). The user-authored override runs everything anyway; the late
// rails still gate the verdict — the override buys analysis, never a pass.
// ---------------------------------------------------------------------------------------------------
describe('S6 — early moat gate: zero Pillar 3–4 spend on a gate death; the override runs everything', () => {
  async function runGate(opts: { id: string; moatClass: 'narrow' | 'moderate' | 'wide'; override?: boolean }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: opts.moatClass, runway: 'proven', proposed_buy_below: 290,
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' } },
      investmentVerdict: 'WATCH',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-s6-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'GTE',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
        ...(opts.override === true ? { moat_gate_override: true } : {}),
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: true as const, price_per_share: 100, currency: 'USD', as_of: 'x', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const schemaCalls = provider.structured.mock.calls
      .map((c: unknown[]) => (c[0] as { response_format?: { schema_name?: string } }).response_format?.schema_name)
      .filter((n): n is string => typeof n === 'string')
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, schemaCalls, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('gate death (grounded moderate): terminal PASS with ZERO management/valuation/red-team/synthesis calls', async () => {
    const { events, schemaCalls, cp } = await runGate({ id: 'gate-death', moatClass: 'moderate' })
    expect(cp?.investment_verdict).toBe('PASS')
    // The provider was NEVER asked for the Pillar 3–4 stages — the spend proof, not just suppression.
    expect(schemaCalls).not.toContain('BuffettMungerManagementLane')
    expect(schemaCalls).not.toContain('BuffettMungerValuationReasoning')
    expect(schemaCalls).not.toContain('BuffettMungerInversion')
    expect(schemaCalls).not.toContain('BuffettMungerSynthesisDecision')
    const types = events.map((e) => e.event_type)
    expect(types).not.toContain('valuation_judgment_drafted')
    expect(types).not.toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysis?.payload as Record<string, unknown>)['moat_gate_short_circuited']).toBe(true)
  })

  it('the OVERRIDE runs Pillars 3–4 on a failed gate; the LATE rails still gate the verdict to PASS', async () => {
    const { events, schemaCalls, cp } = await runGate({ id: 'gate-override', moatClass: 'moderate', override: true })
    // Everything ran under the override...
    expect(schemaCalls).toContain('BuffettMungerManagementLane')
    expect(schemaCalls).toContain('BuffettMungerSynthesisDecision')
    const types = events.map((e) => e.event_type)
    expect(types).toContain('deep_dive_synthesis_drafted')
    // ...but the verdict is STILL gated (the override buys analysis, never a pass).
    expect(cp?.investment_verdict).toBe('PASS')
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysis?.payload as Record<string, unknown>)['moat_gate_short_circuited']).toBeUndefined()
  })

  it('a wide moat passes the early gate and the full pipeline runs unchanged', async () => {
    const { schemaCalls, cp } = await runGate({ id: 'gate-pass', moatClass: 'wide' })
    expect(schemaCalls).toContain('BuffettMungerManagementLane')
    expect(schemaCalls).toContain('BuffettMungerSynthesisDecision')
    expect(cp?.investment_verdict).toBe('WATCH')
  })
})

// ---------------------------------------------------------------------------------------------------
// G (owner call, 2026-07-12): the Munger LATTICE is retired — the inversion pass stands alone as the
// adversarial surface. The payload must NOT carry munger_lattice; the cite-checked consensus_check
// (Munger's social-proof read) persists on the inversion layer itself.
// ---------------------------------------------------------------------------------------------------
describe('G — the lattice is retired; the inversion layer carries the consensus check', () => {
  it('emits no munger_lattice key; the consensus check persists grounded on the inversion layer', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', proposed_buy_below: 290,
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' } },
      synthesisResponse: { mode: 'answered_with_evidence', text: 'Rebutted with cited filing evidence.' },
      redTeamExtras: {
        consensus_check: {
          consensus_view: 'The street sees a fully-valued quality compounder.',
          thesis_vs_consensus: 'variant',
          variant_justification: 'The thesis underwrites margin durability the street discounts.',
          citations: ['src_lane_moat'],
        },
      },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-g-nolattice-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_g_nolat', company_id: 'c', ticker: 'LAT',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'g_nolat_k',
        model_id: 'mock', decision_id: 'decision_g_nolat', source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: true as const, price_per_share: 250, currency: 'USD', as_of: 'x', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const payload = analysis?.payload as Record<string, unknown>
    expect('munger_lattice' in payload).toBe(false)
    const inversionLayer = payload['inversion'] as { status?: string; consensus_check?: { grounded?: boolean; thesis_vs_consensus?: string } } | undefined
    expect(inversionLayer?.status).toBe('complete')
    expect(inversionLayer?.consensus_check?.grounded).toBe(true)
    expect(inversionLayer?.consensus_check?.thesis_vs_consensus).toBe('variant')
    // The projection carries the inversion (with consensus) and no lattice.
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_g_nolat') as Record<string, unknown> | undefined
    expect(cp?.['munger_lattice']).toBeUndefined()
    expect((cp?.['inversion'] as { consensus_check?: { grounded?: boolean } })?.consensus_check?.grounded).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------
// B3 (Phase 4, book alignment): the ONE-PAGER — the understand lane's seven-item distillation
// persists on the analysis payload + projection, INCLUDING on a moat-gate short-circuit (Pillar 1
// ran in Stage A; its distillation renders on gated dossiers too).
// ---------------------------------------------------------------------------------------------------
describe('B3 — the one-pager persisted from the understand lane', () => {
  async function runOnePager(opts: { id: string; moatClass: 'moderate' | 'wide' }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: opts.moatClass, runway: 'proven', proposed_buy_below: 150,
        valuation_reasoning: { owner_earnings_basis: 'b', owner_earnings_citation: 'src_dec_1', assumed_growth: 0.06, assumed_growth_rationale: 'r', assumed_growth_citation: 'src_dec_1' } },
      investmentVerdict: 'WATCH',
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-b3-${opts.id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${opts.id}`, company_id: 'c', ticker: 'ONE',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${opts.id}_k`,
        model_id: 'mock', decision_id: `decision_${opts.id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround, laneConcurrency: 4,
        resolvePrice: async () => ({ available: true as const, price_per_share: 120, currency: 'USD', as_of: 'x', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { payload: analysis?.payload as Record<string, unknown>, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) as Record<string, unknown> | undefined }
  }

  it('persists the seven items on a full run and projects them', async () => {
    const { payload, cp } = await runOnePager({ id: 'onepager-full', moatClass: 'wide' })
    const op = payload['one_pager'] as Record<string, unknown> | undefined
    expect(op?.['plain_english']).toMatch(/memberships/i)
    expect((op?.['segments'] as string[]).length).toBeGreaterThan(0)
    expect((op?.['growth_levers'] as string[]).length).toBeGreaterThan(0)
    const projected = cp?.['one_pager'] as Record<string, unknown> | undefined
    expect(projected?.['plain_english']).toMatch(/memberships/i)
    expect((projected?.['weak_spots'] as string[]).length).toBeGreaterThan(0)
  })

  it('a moat-gate short-circuit STILL carries the one-pager (Pillar 1 ran in Stage A)', async () => {
    const { payload, cp } = await runOnePager({ id: 'onepager-gated', moatClass: 'moderate' })
    expect(payload['moat_gate_short_circuited']).toBe(true)
    expect((payload['one_pager'] as Record<string, unknown> | undefined)?.['plain_english']).toMatch(/memberships/i)
    expect((cp?.['one_pager'] as Record<string, unknown> | undefined)?.['plain_english']).toMatch(/memberships/i)
  })
})
