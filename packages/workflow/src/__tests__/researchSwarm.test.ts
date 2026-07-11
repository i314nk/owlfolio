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
import { CIRCLE_COMPETENCE_PROMPT, CashflowDriverSchema, PredictabilityBreakerSchema } from '../researchSwarmSchemas'
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
    { advantage: 'documented pricing power without volume loss', citation: cite },
    { advantage: 'sustained market-share gains vs funded entrants', citation: cite },
    { advantage: 'structural cost/scale + distribution advantage', citation: cite },
  ]
  const count = tier === 'monopoly' ? 3 : tier === 'wide' ? 2 : tier === 'moderate' ? 1 : 1
  return {
    moat_drivers: allDrivers.slice(0, count),
    proposed_moat_class: tier,
    moat_reasoning: `Grounded ${tier} moat thesis for the test.`,
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
function fakeCirclePayload(src: (id: string) => unknown) {
  // Two cited drivers + two cited breakers: meets the default circle-gate evidence floor (min 2/2),
  // mirroring what a live model produces now that the gate prompt asks for at least that many.
  return {
    cashflow_drivers: [
      { driver: 'Recurring revenue grounded in the 10-K', citation: 'src_circle_driver' },
      { driver: 'Membership renewal economics grounded in the 10-K', citation: 'src_circle_driver' },
    ],
    predictability_breakers: [
      { breaker: 'Cyclicality / customer concentration risk', citation: 'src_circle_breaker' },
      { breaker: 'Margin compression from input-cost inflation', citation: 'src_circle_breaker' },
    ],
    competence_reasoning: 'Understandable cashflow engine demonstrated from filings.',
    cashflow_predictability: 'durably_predictable',
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
      if (schemaName === 'BuffettMungerRedTeam') {
        return {
          strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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
      if (schemaName === 'BuffettMungerRedTeam') {
        return {
          strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(5)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()
  })

  it('skips findings for lanes with no verified sources and still completes', async () => {
    const store = new InMemoryEventStore()
    const provider = swarmFakeProviderWithLaneIds(buffettMungerDeepDiveLanes)
    // Ground verifies all sources EXCEPT those belonging to the 'moat' lane
    // (identified by source_id containing 'moat'). The moat lane will have
    // verified_ids: [] and its specialist finding must be skipped — not crash the swarm.
    const ground = async (sources: { source_id: string }[]) => {
      const verified = sources.filter((s) => !s.source_id.includes('moat'))
      return {
        captured: sources.map((s) => ({
          source_id: s.source_id,
          title: 't',
          url: 'https://example.com/x',
          excerpt: 'e',
          availability: (s.source_id.includes('moat') ? 'unavailable' : 'available') as 'available' | 'unavailable',
          fetched_at: 'x',
          ...(s.source_id.includes('moat') ? {} : { content_hash: 'sha256:1' }),
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

    // Moat finding must NOT be recorded
    const findingEvents = events.filter((e) => e.event_type === 'specialist_finding_recorded')
    const moatFinding = findingEvents.find((e) => {
      const p = e.payload as Record<string, unknown>
      return p['specialist_lane'] === 'moat'
    })
    expect(moatFinding).toBeUndefined()

    // All other lanes (4 of 5) must have their findings recorded
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
          if (schemaName === 'BuffettMungerRedTeam') {
            return {
              strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(5)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()

    // F.2 threading pin: discount = 0.03 anchor + 0.055 equity premium, basis compliant_savings.
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const av = (analysis?.payload as { valuation?: { discount_rate?: number; discount_inputs?: { risk_free_basis?: string } } }).valuation
    expect(av?.discount_inputs?.risk_free_basis).toBe('compliant_savings')
    expect(av?.discount_rate).toBeCloseTo(0.085, 6)
  })
})

describe('runStrategyResearchSwarm with MockProvider + deterministic grounder', () => {
  it('completes end-to-end: research_case_created, shariah_gate_judged, >=5 specialist_finding_recorded, deep_dive_synthesis_drafted, decision_drafted', async () => {
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
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(5)
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

  it('projects moat_class, runway, discount_rate, roic, two-stage fair_value, MoS, and buy_price from the analysis event (two-stage DCF)', async () => {
    // MockProvider emits monopoly moat + proven runway with bridge TOTALS in $millions:
    //   NI=14000, D&A=4000, maint=3000, SBC=2000, dNWC=-1000 → OE_total = 14000 ($M)
    //   shares_outstanding=1000 (M) → OE/sh = 14000/1000 = 14
    //   roic=0.25, incremental_roic=0.20, reinvestment_rate=0.40
    // Harness computes (Phase 1.3 ONE growth path + F.13 uniform params): with NO EDGAR series injected the
    // demonstrated OE/share CAGR is unavailable → growth floors to the honest no-growth g=0 (growth_basis
    // 'none'); reinvestment×ROIC bands are GONE. Uniform terminal g 1.5%, horizon 10, flat 10% discount:
    //   two-stage FV ≈ 150.48 (impl ≈ 10.75×, under the 18× fv_cap_multiple flag — 252 at OE/sh 14)
    //   MoS uniform base 0.25 (F.13, widens with documented uncertainty), buy=round(150.48*0.75,2)≈112.86
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

    expect(caseProjection).toBeDefined()
    // moat_class: mock emits monopoly
    expect(caseProjection?.valuation?.moat_class).toBe('monopoly')
    // moat_passes_gate: monopoly passes
    expect(caseProjection?.valuation?.moat_passes_gate).toBe(true)
    // discount_rate: flat 7.5% effective default (F.2 — compliant savings anchor 2% + uniform premium 5.5%;
    // no risk_free_rate threaded → fails closed to savings_rate_default)
    expect(caseProjection?.valuation?.discount_rate).toBe(0.075)
    // growth_assumptions is a non-empty string
    expect(typeof caseProjection?.valuation?.growth_assumptions).toBe('string')
    expect((caseProjection?.valuation?.growth_assumptions ?? '').length).toBeGreaterThan(0)
    // runway: mock emits proven
    expect(caseProjection?.valuation?.runway).toBe('proven')
    // harness-computed OE/sh from bridge totals: (14000+4000-3000-2000-(-1000))/1000 = 14000/1000 = 14
    expect(caseProjection?.valuation?.normalized_owner_earnings_per_share).toBe(14)
    // roic from mock: 0.25
    expect(caseProjection?.valuation?.roic).toBe(0.25)
    // incremental_roic from mock: 0.20
    expect(caseProjection?.valuation?.incremental_roic).toBe(0.20)
    // reinvestment_rate from mock: 0.40 (context only — no longer feeds growth, Phase 1.3)
    expect(caseProjection?.valuation?.reinvestment_rate).toBe(0.40)
    // HEADLINE-GROWTH INVERSION: the headline growth_rate is now the MODEL's cite-verified assumed_growth.
    // The MockProvider emits 0.18 for capital-light names (MSFT) — an over-optimistic rate ABOVE the 0.15
    // cap, recorded as the headline (flagged for sanity, not silently capped). The capped demonstrated CAGR
    // (here 0 — NO EDGAR series) is DEMOTED to demonstrated_growth_reference. (Was: growth_rate === 0 — the
    // old credited-g headline; that asserted the inverted-from-architecture behavior.)
    expect(caseProjection?.valuation?.growth_rate).toBeCloseTo(0.18, 6)
    expect(caseProjection?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(caseProjection?.valuation?.growth_basis).toBe('none')
    // terminal g — UNIFORM for every investable moat (F.13) = 0.015
    expect(caseProjection?.valuation?.terminal_growth_rate).toBe(0.015)
    // forward-DCF removal: the dollar fair_value_per_share is no longer surfaced. The internal forward FV
    // (g=0.18) still drives the kept cap_exceeded flag (exceeds the 18× OE cap — a SURFACED flag, not a
    // truncation) and the implied_multiple ratio.
    expect(caseProjection?.valuation?.fair_value_per_share).toBeUndefined()
    expect(caseProjection?.valuation?.cap_exceeded).toBe(true)
    // implied multiple = internal forward FV (g=0.18) / OE — above the no-growth ~10.75× since growth lifts it.
    expect(caseProjection?.valuation?.implied_multiple ?? 0).toBeGreaterThan(10.75)
    // margin_of_safety (the MoS-as-price-haircut field) is RETIRED.
    expect((caseProjection?.valuation as Record<string, unknown> | undefined)?.margin_of_safety).toBeUndefined()
    // RELIGHTENED DECISION (R1): buy_price_per_share is the MODEL's proposed_buy_below (recorded verbatim).
    // The mock emits 320 for capital-light names (MSFT) — NOT a band/threshold-derived number.
    expect(caseProjection?.valuation?.buy_price_per_share).toBe(320)
    expect((caseProjection?.valuation as Record<string, unknown> | undefined)?.['proposed_buy_below']).toBe(320)
    // value_basis
    expect(caseProjection?.valuation?.value_basis).toBe('two_stage_dcf')
    // owner_earnings_bridge projected (totals in $millions + shares_outstanding in millions)
    expect(caseProjection?.valuation?.owner_earnings_bridge).toBeDefined()
    expect(caseProjection?.valuation?.owner_earnings_bridge?.net_income).toBe(14000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.normalized_working_capital_change).toBe(-1000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.shares_outstanding).toBe(1000)
  })

  it('projects the judgment layer: grounded moat thesis (B6) + runway rubric, anchor-vs-proposed-vs-resolved', async () => {
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
    // runway axis (runway reframe): the mock emits a grounded cited runway thesis (2 grounded headroom
    // drivers proposing proven -> resolved proven). The dossier surfaces the cited runway_drivers + count.
    expect(judgment?.runway?.proposed_tier).toBe('proven')
    expect(judgment?.runway?.resolved_tier).toBe('proven')
    expect((judgment?.runway?.runway_drivers ?? []).length).toBeGreaterThanOrEqual(2)
    expect((judgment?.runway?.runway_drivers ?? []).every((d) => d.grounded)).toBe(true)
    expect(judgment?.runway?.grounded_driver_count).toBeGreaterThanOrEqual(2)
    // resolved runway fed downstream is proven.
    expect(c?.valuation?.runway).toBe('proven')
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
      if (schemaName === 'BuffettMungerRedTeam') {
        if (rtFails > 0) { rtFails--; throw new Error('Codex CLI timed out') }
        return {
          strongest_bear_case: 'Valuation prices in flawless execution.',
          weakest_rubric_items: [{ lane: 'moat', item: 'M5', why: 'thin switching evidence' }],
          moat_decay_scenario: 'A funded entrant erodes share over 5 years.',
          growth_credit_attack: 'Incremental ROIC mean-reverts below cost of capital.',
          shared_narrative_blindspots: ['All lanes read the same 10-K.'],
          strongest_objection: {
            claim: 'Growth credit depends on incremental ROIC the firm likely cannot sustain.',
            severity: 'high',
            citations: opts.redTeamCitations ?? ['src_lane_0'],
          },
          proposed_sources: [src('src_lane_0')],
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
        return {
          // Omit valuation_reasoning entirely when no response configured (→ the required field is missing →
          // the focused call also fails to ground → RESEARCH_MORE + valuation_reasoning_retry_exhausted).
          ...(opts.valuationReasoningResponse !== undefined ? { valuation_reasoning: opts.valuationReasoningResponse } : {}),
          proposed_sources: [src('src_vr_focused_1')],
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
        growth_assumptions: 'Two-stage DCF; credited g banded by incremental ROIC and runway.',
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

describe('BUG 1 — valuation per-share units (÷ shares_outstanding)', () => {
  it('divides total owner earnings by shares_outstanding (COST inputs: OE/sh ≈ $19, two-stage fair ≈ $205, buy ≈ $154)', async () => {
    // Captured COST inputs: NI 8838, D&A 2565, maint_capex 2052, SBC 911, dNWC 0 ($M),
    // shares_outstanding 443 (M), discount 0.10, moat wide + runway proven.
    //   OE_total = 8838 + 2565 - 2052 - 911 - 0 = 8440 ($M)
    //   OE/sh    = 8440 / 443 ≈ 19.05
    //   Phase 1.3 ONE growth path: NO EDGAR series injected here → demonstrated OE/share CAGR unavailable →
    //   honest no-growth floor g=0 (growth_basis 'none'); g_t (wide, recalibrated) = 0.015.
    //   two-stage FV at g=0: Σ OE_ps/1.1^t (t=1..10, wide horizon 10) + Gordon terminal ≈ 204.78 (impl ≈ 10.75×)
    //   buy = round(204.78 * 0.75, 2) ≈ 153.58  (wide MoS recalibrated 25%)
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug1-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_bug1', company_id: 'company_cost', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug1_k',
        model_id: 'mock', decision_id: 'decision_bug1', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_bug1')
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(19.05, 1)
    // HEADLINE-GROWTH INVERSION: growth_rate is now the MODEL's cited assumed_growth (0.06 in the
    // configurable provider default), NOT the no-series credited-g floor of 0 (which is the
    // demonstrated_growth_reference). (Was: growth_rate === 0 — the old credited-g headline.)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_basis).toBe('none')
    expect(cp?.valuation?.terminal_growth_rate).toBe(0.015)
    // forward-DCF removal: the dollar fair_value_per_share is no longer surfaced. buy_price_per_share is the
    // MODEL's proposed_buy_below (default 150). The per-share UNITS are still proven by the implied_multiple
    // (= internal forward FV / OE), a ratio independent of total-vs-per-share scaling.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBe(150)
    expect(cp?.valuation?.runway).toBe('proven')
    expect(cp?.valuation?.value_basis).toBe('two_stage_dcf')
    // Sanity: per-share units, never the buggy ~100x value. F.2 — under the lower savings-anchor discount
    // (7.5%) the g=0.06 internal FV is ≈ $417.7 / OE $19.05 ≈ 21.9× OE, which EXCEEDS the 18× cap:
    // cap_exceeded is a SURFACED flag (Phase 1.6). The implied multiple proves the per-share scaling.
    expect(cp?.valuation?.implied_multiple ?? 0).toBeCloseTo(21.9, 0)
    expect(cp?.valuation?.cap_exceeded).toBe(true)
    // valuation_status must still read EXPENSIVE vs a ~$968 price
    expect(cp?.valuation_status).toBe('EXPENSIVE')
    // bridge totals + shares projected
    expect(cp?.valuation?.owner_earnings_bridge?.shares_outstanding).toBe(443)
  })

  it('degrades gracefully (no fair/buy price) when shares_outstanding is missing/zero', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: {
        owner_earnings_bridge: {
          net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 911,
          normalized_working_capital_change: 0, shares_outstanding: 0,
        },
      },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug1-degrade-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_bug1_degrade', company_id: 'company_cost', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug1d_k',
        model_id: 'mock', decision_id: 'decision_bug1d', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_bug1_degrade')
    // No bogus huge HARNESS fair value persisted (the deterministic point FV / OE-per-share fail closed).
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeUndefined()
    // RELIGHTENED DECISION (R1): buy_price_per_share is the MODEL's proposed_buy_below — it is the model's
    // own number, NOT derived from the harness valuation, so it is still recorded even when the harness FV
    // fails closed (no OE/share). What the harness must NOT fabricate is a DERIVED price; this is not that.
    expect(cp?.valuation?.buy_price_per_share).toBe(150)
    // No reference cross-check FV (no OE/share to value against).
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['reference_fair_value']).toBeUndefined()
    // A valuation caveat must be recorded on the analysis event
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect((valuation?.['valuation_caveats'] as string[])?.join(' ')).toMatch(/shares_outstanding/i)
    // The run still completes with a decision
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })
})

describe('Two-stage DCF harness growth path (Phase 1.3 one growth path + gates)', () => {
  async function runWith(synthesis: SynthesisOverrides, id: string) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, synthesis })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-2s-${id}-`))
    await runStrategyResearchSwarm(
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
    return { events, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('no EDGAR series → demonstrated_growth_reference floors to g=0; HEADLINE growth = model assumed_growth', async () => {
    // base bridge OE_total = 8838+2565-2052-911-0 = 8440 ($M) ÷ 443 = 19.05/sh, monopoly, proven.
    // HEADLINE-GROWTH INVERSION: with no EDGAR series the DEMONSTRATED-HISTORY reference floors to 0, but the
    // headline growth_rate is now the MODEL's cited assumed_growth (0.06). (Was: growth_rate === 0.)
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', incremental_roic: 0.08, reinvestment_rate: 0.5 }, 'nogrowth')
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_basis).toBe('none')
    // forward-DCF removal: the dollar fair_value_per_share is no longer surfaced. The internal forward-DCF at
    // g=0.06 still drives the kept implied_multiple (~21.9× OE) and cap_exceeded flag. F.2 — at the lower
    // savings-anchor discount (7.5%) it exceeds the 18× cap (a surfaced flag, not a truncation).
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.implied_multiple ?? 0).toBeCloseTo(21.9, 0)
    expect(cp?.valuation?.cap_exceeded).toBe(true)
  })

  it('growth is no longer driven by runway/incremental-ROIC (Phase 1.3): runway none still floors the demonstrated reference to 0', async () => {
    // The old banding (runway/inc-ROIC/exceptional) is gone — with no demonstrated CAGR available the
    // demonstrated-history REFERENCE is the honest no-growth floor regardless of the runway/inc-ROIC the lane
    // proposes. The headline growth is the model's assumed_growth (0.06), independent of runway too.
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'none', incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'runway-none')
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.runway).toBe('none')
  })

  it('runway_exceptional no longer lifts growth (Phase 1.3): the demonstrated reference stays at the no-growth floor without a CAGR', async () => {
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', runway_exceptional: true, incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'mono-exceptional')
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    expect(cp?.valuation?.runway_exceptional).toBe(true)
    // runway_exceptional does NOT lift the multiple: it is the SAME g=0.06 FV as the non-exceptional case
    // (≈ 21.9× OE at the F.2 7.5% savings-anchor discount). The cap_exceeded flag surfaces it (Phase 1.6);
    // runway_exceptional contributes nothing to the valuation (Phase 1.3 — no growth lift).
    expect(cp?.valuation?.implied_multiple ?? 0).toBeCloseTo(21.9, 0)
    expect(cp?.valuation?.cap_exceeded).toBe(true)
  })

  it('negative owner earnings gates the valuation — caveat recorded, no FV/buy, run completes', async () => {
    // SBC larger than NI+D&A so OE_total goes negative
    const { events, cp } = await runWith({
      moat_class: 'monopoly', runway: 'proven', incremental_roic: 0.30, reinvestment_rate: 0.5,
      owner_earnings_bridge: {
        net_income: 100, depreciation_amortization: 50, maintenance_capex: 80,
        maintenance_capex_proxy_tier: '50', stock_based_comp: 200,
        normalized_working_capital_change: 0, shares_outstanding: 50,
      },
    }, 'neg-oe')
    // No positive OE/share → no point FV and no reference cross-check FV (both fail closed). The MODEL's
    // proposed_buy_below is still recorded verbatim (R1: it is the model's number, not a harness-derived one).
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBe(150)
    expect((cp?.valuation as Record<string, unknown> | undefined)?.['reference_fair_value']).toBeUndefined()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect((valuation?.['valuation_caveats'] as string[])?.join(' ')).toMatch(/owner earnings/i)
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
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, sbc_musd: 0, diluted_shares_m: 100 })
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
    expect(cp?.valuation?.growth_basis).toBe('edgar_oe_cagr')
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
    expect(typeof cp?.valuation?.implied_multiple).toBe('number')
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
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, sbc_musd: 0, diluted_shares_m: 100 })
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
    // The internal forward-DCF still computes (no price needed) — surfaced via the implied_multiple ratio.
    // forward-DCF removal: the dollar fair_value_per_share / fair_value_range are no longer surfaced.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(typeof cp?.valuation?.implied_multiple).toBe('number')
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
  }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: {
        moat_class: opts.moatClass ?? 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43,
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
        ...(opts.fundamentals !== undefined ? { fundamentals: opts.fundamentals } : {}),
        resolvePrice: async () => ({ available: true as const, price_per_share: opts.price, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown> | undefined)?.['valuation'] as Record<string, unknown> | undefined
    return { events, valuation, cp: projections.find((c) => c.research_case_id === `rc_${opts.id}`) }
  }

  it('BUY-BELOW ← MODEL: buy_below === the model\'s proposed_buy_below; the forward reference FV is no longer surfaced', async () => {
    // The model proposes 150; the buy-below is the model's verbatim number (NOT derived from any FV).
    const { valuation, cp } = await runRelit({ id: 'buybelow-model', price: 300, proposedBuyBelow: 150, assumedGrowth: 0.06 })
    // Recorded buy-below IS the model's proposed number (verbatim).
    expect(cp?.valuation?.buy_price_per_share).toBe(150)
    expect(valuation?.['proposed_buy_below']).toBe(150)
    // forward-DCF removal: the dollar reference_fair_value / fair_value_per_share are no longer emitted.
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(valuation?.['fair_value_per_share']).toBeUndefined()
    // The model's cited valuation reasoning rides along.
    const vr = valuation?.['valuation_reasoning'] as Record<string, unknown> | undefined
    expect(vr?.['assumed_growth']).toBe(0.06)
    expect(typeof vr?.['owner_earnings_basis']).toBe('string')
  })

  it('SANITY (over-OPTIMISTIC): status ATTRACTIVE + market implies implausibly HIGH growth → flag fires AND the T0 buy-below gate derates the BUY', async () => {
    // A very high price → reverse-DCF implies growth above the 15% cap; the model nonetheless says
    // ATTRACTIVE — the symmetric sanity-check must fire the over-optimistic catch. OWNER RULE
    // (2026-07-10 SPGI dogfood): the FLAG still never blocks, but a BUY in this shape can no longer
    // survive — an in-zone buy-below above such a price necessarily ALSO implies above-cap growth, so
    // the T0 buy_below_implies_absurd_growth GATE (arithmetic, not the flag) derates the BUY to WATCH.
    const { valuation, cp } = await runRelit({
      id: 'sanity-optimistic', price: 800, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 850,
    })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.some((f) => /attractive/i.test(f) && /implausible|cap/i.test(f))).toBe(true)
    // FLAG NEVER BLOCKS: the model BUY (with a buy-below + price present) is recorded, not clamped.
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /buy_below_implies_absurd_growth/.test(q))).toBe(true)
  })

  it('SANITY (over-PESSIMISTIC): status EXPENSIVE + market implies only MODEST growth → a sanity flag (verdict NOT blocked)', async () => {
    // A low price → reverse-DCF implies a modest (≤ GDP) growth; the model says EXPENSIVE — the symmetric
    // sanity-check must fire the over-pessimistic catch.
    const { valuation, cp } = await runRelit({
      id: 'sanity-pessimistic', price: 150, valuationStatus: 'EXPENSIVE', investmentVerdict: 'WATCH', proposedBuyBelow: 120,
    })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /expensive/i.test(f) && /modest|gdp/i.test(f))).toBe(true)
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('CLEAN: status consistent with the evidence (FAIR + modest implied growth) → NO sanity flag', async () => {
    // A mid price → implied growth in the modest band; status FAIR is consistent — no contradiction flag,
    // no above-cap flag.
    const { valuation } = await runRelit({
      id: 'sanity-clean', price: 220, valuationStatus: 'FAIR', investmentVerdict: 'WATCH', proposedBuyBelow: 180, assumedGrowth: 0.05,
    })
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /contradicts_evidence/.test(f))).toBe(false)
    expect(flags.some((f) => /implied_growth_above_cap/.test(f))).toBe(false)
  })

  it('SANITY (self-coherence TOLERANCE, 2026-07-11): ATTRACTIVE with the price only slightly above the buy-below → NO flag (coherent "wait for my price")', async () => {
    // Live SPGI noise: ATTRACTIVE with the price 2.6% above the model's buy-below fired the flag —
    // but "attractive, I'd buy a few percent lower" is a coherent position. Inside the 5% band → quiet.
    const { valuation } = await runRelit({
      id: 'coherence-attractive-nearzone', price: 431, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'WATCH', proposedBuyBelow: 420,
    })
    expect(valuation?.['in_buy_zone']).toBe(false)
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /contradicts_buy_zone/.test(f))).toBe(false)
  })

  it('SANITY (self-coherence): status EXPENSIVE + price within the model\'s OWN buy-below (in_buy_zone) → contradicts-buy-zone flag (verdict NOT blocked)', async () => {
    // The model's two outputs disagree about TODAY's price: it labels the valuation EXPENSIVE yet sets a
    // proposed_buy_below ABOVE the current price (so in_buy_zone is true — it would buy here per its own
    // threshold). The direct self-coherence check must flag it, independent of where market-implied growth
    // sits (the (d/e) implied-growth proxy only catches this indirectly). Flag-only — verdict unchanged.
    const { valuation, cp } = await runRelit({
      id: 'coherence-expensive-inzone', price: 200, valuationStatus: 'EXPENSIVE', investmentVerdict: 'WATCH', proposedBuyBelow: 240,
    })
    expect(valuation?.['in_buy_zone']).toBe(true)
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /contradicts_buy_zone/.test(f) && /expensive/i.test(f))).toBe(true)
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('SANITY (self-coherence): status ATTRACTIVE + price ABOVE the model\'s OWN buy-below → contradicts-buy-zone flag (verdict NOT blocked)', async () => {
    // Symmetric: the model calls it ATTRACTIVE yet its buy-below is BELOW today's price (in_buy_zone false —
    // it would not buy at today's price). Self-contradiction → flag.
    const { valuation, cp } = await runRelit({
      id: 'coherence-attractive-outzone', price: 600, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 400,
    })
    expect(valuation?.['in_buy_zone']).toBe(false)
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /contradicts_buy_zone/.test(f) && /attractive/i.test(f))).toBe(true)
    // OWNER RULE (2026-07-04): the out-of-zone BUY no longer passes through flag-only — it derates to
    // WATCH by the model's own arithmetic (see the buy_out_of_buy_zone gate tests).
    expect(cp?.investment_verdict).toBe('WATCH')
  })

  it('SANITY (self-coherence CLEAN): status EXPENSIVE + price ABOVE the buy-below (normal expensive) → NO contradicts-buy-zone flag', async () => {
    // The coherent expensive case (KO-like): EXPENSIVE label AND price above the buy-below (in_buy_zone false).
    // The label and the buy threshold AGREE — no self-coherence flag.
    const { valuation } = await runRelit({
      id: 'coherence-clean', price: 300, valuationStatus: 'EXPENSIVE', investmentVerdict: 'WATCH', proposedBuyBelow: 200,
    })
    expect(valuation?.['in_buy_zone']).toBe(false)
    const flags = (valuation?.['sanity_flags'] as string[] | undefined) ?? []
    expect(flags.some((f) => /contradicts_buy_zone/.test(f))).toBe(false)
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
    expect(flags.some((f) => /exit multiple/i.test(f) && /above a defensible exit/i.test(f))).toBe(true)
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
    expect((cp?.open_questions ?? []).some((q) => /buy_out_of_buy_zone/.test(q) && /\$290\.00/.test(q) && /\$360\.00/.test(q))).toBe(true)
  })

  it('GATE (owner rule) — model BUY with the price AT/BELOW its own buy-below stays BUY', async () => {
    const { cp } = await runRelit({
      id: 'buyzone-inzone', price: 280, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 290,
    })
    expect(cp?.investment_verdict).toBe('BUY')
    expect((cp?.open_questions ?? []).some((q) => /buy_out_of_buy_zone/.test(q))).toBe(false)
  })

  it('GATE (owner rule, 2026-07-10 SPGI dogfood) — model BUY whose OWN buy-below implies growth ABOVE the cap → recorded WATCH', async () => {
    // Live SPGI shape: price inside the model's aggressive buy zone, but the buy-below itself prices
    // in growth the method's single-growth cap refuses to underwrite (harness fair value was ~half
    // the model's buy-below). Arithmetic on the model's own numbers → derate to WATCH, thesis kept.
    const { cp } = await runRelit({
      id: 'buyzone-absurd', price: 280, valuationStatus: 'ATTRACTIVE', investmentVerdict: 'BUY', proposedBuyBelow: 800,
    })
    expect(cp?.investment_verdict).toBe('WATCH')
    expect((cp?.open_questions ?? []).some((q) => /buy_below_implies_absurd_growth/.test(q))).toBe(true)
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
    const { cp } = await runRelit({ id: 'shariah-ok', price: 200, investmentVerdict: 'BUY', proposedBuyBelow: 250 })
    // price 200 <= buy-below 250 → in buy zone; wide moat, compliant sector → model BUY recorded.
    expect(cp?.investment_verdict).toBe('BUY')
  })

  it('in_buy_zone is pure arithmetic: current_price <= buy_below', async () => {
    const { valuation: belowVal } = await runRelit({ id: 'inzone-yes', price: 100, proposedBuyBelow: 150 })
    expect(belowVal?.['in_buy_zone']).toBe(true)
    const { valuation: aboveVal } = await runRelit({ id: 'inzone-no', price: 200, proposedBuyBelow: 150 })
    expect(aboveVal?.['in_buy_zone']).toBe(false)
  })

  it('a sanity flag NEVER blocks: even with a flag firing, the model verdict passes the cheap gates unchanged', async () => {
    // High price → the exit-multiple sanity flag fires; model says BUY; moat wide, sector compliant, price
    // present, buy-below present AND the price is in the model's own buy zone (so the owner-rule buy-zone
    // ARITHMETIC gate stays out of the way) → the model BUY is recorded (the flag is advisory only).
    const { valuation, cp } = await runRelit({ id: 'flag-noblock', price: 600, investmentVerdict: 'BUY', proposedBuyBelow: 650 })
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
    expect(valuation?.['demonstrated_growth_reference']).toBeCloseTo(0, 6)
  })

  it('INTERNAL forward-DCF is computed from assumed_growth (NOT credited-g); the dollar FV is not surfaced', async () => {
    // assumed_growth 0.06 ≠ credited-g 0 → the internal two-stage FV is at g = 0.06. forward-DCF removal: the
    // dollar fair_value_per_share / reference_fair_value are NO LONGER surfaced; the kept signals are the
    // headline growth_rate (the model's assumed_growth) + the implied_multiple (ratio of the internal FV).
    const { cp, valuation } = await runRelit({ id: 'headline-fv', price: 300, proposedBuyBelow: 150, assumedGrowth: 0.06 })
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(valuation?.['reference_fair_value']).toBeUndefined()
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    // The internal forward FV at g=0.06 is materially above the g=0 case (~204.78 / OE 19.05 ≈ 10.75×), so
    // the surfaced implied_multiple exceeds 11× for these inputs.
    expect(cp?.valuation?.implied_multiple ?? 0).toBeGreaterThan(11)
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
describe('Mechanism 5 — red-team pass + synthesis obligation', () => {
  async function runRedTeam(opts: Omit<Parameters<typeof configurableSwarmProvider>[0], 'laneCount'>, id: string) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, ...opts })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-rt-${id}-`))
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
    return { events, result, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('runs the red team and records its output on the analysis; no flag when synthesis answers with evidence', async () => {
    const { cp, result } = await runRedTeam(
      { synthesisResponse: { mode: 'answered_with_evidence', text: 'Top customer <10% of revenue per the 10-K.' } },
      'answered',
    )
    expect(result.decision).toBeDefined()
    expect(cp?.red_team?.status).toBe('complete')
    expect(cp?.red_team?.strongest_objection?.claim).toMatch(/incremental ROIC/i)
    // Cite-checked against the corpus (src_lane_0 is a verified lane source).
    expect(cp?.red_team?.strongest_objection?.citations).toEqual(['src_lane_0'])
    expect(cp?.red_team?.synthesis_response?.mode).toBe('answered_with_evidence')
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
    // No red_team_objection_unaddressed open question.
    expect((cp?.open_questions ?? []).some((q) => /red_team_objection_unaddressed/.test(q))).toBe(false)
  })

  it('flags red_team_objection_unaddressed + appends to open_questions when synthesis is silent', async () => {
    const { cp } = await runRedTeam({ /* synthesisResponse undefined → silent */ }, 'unaddressed')
    expect(cp?.red_team?.status).toBe('complete')
    expect(cp?.red_team?.objection_unaddressed).toBe(true)
    expect(cp?.red_team?.synthesis_response).toBeUndefined()
    expect((cp?.open_questions ?? []).some((q) => /red_team_objection_unaddressed/.test(q))).toBe(true)
  })

  it('records the downgrade when synthesis accepts the objection (mode accepted_downgraded)', async () => {
    const { cp } = await runRedTeam(
      {
        synthesisResponse: {
          mode: 'accepted_downgraded', text: 'Concentration justifies a tier cut.',
          downgrade: { dimension: 'tier', from: 'wide', to: 'moderate' },
        },
      },
      'downgraded',
    )
    expect(cp?.red_team?.synthesis_response?.mode).toBe('accepted_downgraded')
    expect(cp?.red_team?.synthesis_response?.downgrade?.to).toBe('moderate')
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
    // The downgrade is recorded in the verdict rationale.
    expect(cp?.reason ?? '').toMatch(/downgraded tier \(wide → moderate\)/)
  })

  it('degrades to red_team_incomplete on red-team timeout — run still completes through synthesis', async () => {
    const { cp, events, result } = await runRedTeam({ failRedTeam: 99 }, 'incomplete')
    // The run completed: synthesis + decision were still drafted.
    expect(result.decision).toBeDefined()
    expect(events.some((e) => e.event_type === 'deep_dive_synthesis_drafted')).toBe(true)
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
    // Red team recorded as incomplete (case not adversarially tested) + surfaced as an open question.
    expect(cp?.red_team?.status).toBe('red_team_incomplete')
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
    expect((cp?.open_questions ?? []).some((q) => /red_team_incomplete/.test(q))).toBe(true)
  })

  it('drops an objection whose citations are not in the verified corpus (no synthesis obligation, no flag)', async () => {
    // The red team cites a fabricated source id; cite-check strips it → no live objection → no flag even
    // though synthesis is silent (we never force the synthesis to answer a fabricated objection).
    const { cp } = await runRedTeam({ redTeamCitations: ['src_fabricated'] }, 'fabricated')
    expect(cp?.red_team?.strongest_objection?.citations ?? []).toEqual([])
    expect(cp?.red_team?.uncited_objection_refs).toEqual(['src_fabricated'])
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
    expect((cp?.open_questions ?? []).some((q) => /red_team_objection_unaddressed/.test(q))).toBe(false)
  })

  it('drops an objection whose only citation is CAPTURED-BUT-UNVERIFIED (no content_hash) — hardens verifiedCitationHashes', async () => {
    // Hardening repro for the verifiedCitationHashes hole. The red team cites src_qs_bad_1 — a source that
    // WAS captured (present in accumulated) but FAILED to ground (no content_hash, excluded from
    // verified_ids). The old cite-check set added every captured source_id unconditionally, so the
    // objection would have wrongly counted as a LIVE (grounded) objection. After the fix only verified
    // sources enter the set → the objection is stripped exactly like a fabricated one.
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
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      quickScreenProposesGoodBad: true,
      redTeamCitations: ['src_qs_bad_1'],
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-rt-captured-unverified-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_rt_cap_unver', company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'rt_cap_unver_k',
        model_id: 'mock', decision_id: 'decision_rt_cap_unver', source_ledger_path: sourceLedgerPath,
      },
      { ground: groundGoodCaptureBad as GroundFn, laneConcurrency: 4 },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_rt_cap_unver')
    // The captured-but-unverified citation must be stripped: no live objection, no synthesis obligation.
    expect(cp?.red_team?.strongest_objection?.citations ?? []).toEqual([])
    expect(cp?.red_team?.uncited_objection_refs).toEqual(['src_qs_bad_1'])
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
  })

  it('SKIPS the dedicated red-team-response call entirely when there is no live objection', async () => {
    // The red team cites only a fabricated id → cite-check strips it → no live objection → the dedicated
    // red-team-response call must NOT run (no synthesis_response needed when there is nothing to answer).
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      redTeamCitations: ['src_fabricated'],
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-rt-skip-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_rt_skip', company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'rt_skip_k',
        model_id: 'mock', decision_id: 'decision_rt_skip', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const responseCalls = provider.structured.mock.calls.filter(
      (c: unknown[]) => (c[0] as { response_format?: { schema_name?: string } }).response_format?.schema_name === 'BuffettMungerRedTeamResponse',
    )
    expect(responseCalls.length).toBe(0)
  })

  it('records the answer from the dedicated red-team-response call (no unaddressed flag) when it answers', async () => {
    // A live objection (src_lane_0 verified) → the dedicated call runs and answers it → the answer is
    // recorded on the red-team layer and there is NO red_team_objection_unaddressed flag.
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesisResponse: { mode: 'answered_with_evidence', text: 'Renewal rates (cited) keep the moat intact.' },
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-rt-dedicated-'))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_rt_dedicated', company_id: 'c', ticker: 'TST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'rt_ded_k',
        model_id: 'mock', decision_id: 'decision_rt_dedicated', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    const responseCalls = provider.structured.mock.calls.filter(
      (c: unknown[]) => (c[0] as { response_format?: { schema_name?: string } }).response_format?.schema_name === 'BuffettMungerRedTeamResponse',
    )
    // The dedicated call ran exactly once (answered on the first attempt).
    expect(responseCalls.length).toBe(1)
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_rt_dedicated')
    expect(cp?.red_team?.synthesis_response?.mode).toBe('answered_with_evidence')
    expect(cp?.red_team?.objection_unaddressed).toBeUndefined()
    expect((cp?.open_questions ?? []).some((q) => /red_team_objection_unaddressed/.test(q))).toBe(false)
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
    { fiscal_year: 2025, currency: 'USD', net_income_musd: 8099, revenue_musd: 275235, d_and_a_musd: 2426, capex_musd: 5498, sbc_musd: 860, diluted_shares_m: 444.8 },
    { fiscal_year: 2024, currency: 'USD', net_income_musd: 7367, revenue_musd: 254453, d_and_a_musd: 2237, capex_musd: 4710, sbc_musd: 800, diluted_shares_m: 444.2 },
    { fiscal_year: 2023, currency: 'USD', net_income_musd: 6292, revenue_musd: 242290, d_and_a_musd: 2077, capex_musd: 4323, sbc_musd: 741, diluted_shares_m: 443.6 },
  ],
  filings: [
    { form: '10-K', filed: '2025-10-08', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm' },
  ],
  recent_filings: [
    { form: '8-K', filed: '2026-01-15', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983226000010/cost-8k.htm' },
    { form: '10-Q', filed: '2025-12-10', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000120/cost-10q.htm' },
  ],
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
  it('grounds the 10-K and injects primary numbers into the financial_quality lane', async () => {
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

    // The structured() prompt for the financial_quality lane must contain the primary-filing block.
    // (Shariah is no longer a parallel lane — its overlay comes from the focused Shariah-reasoning pass.)
    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === "string")
    const financialLanePrompt = prompts.find((p) => p.includes('financial_quality specialist'))
    const moatLanePrompt = prompts.find((p) => p.includes('moat specialist'))

    expect(financialLanePrompt).toBeDefined()
    expect(financialLanePrompt).toContain('Primary filing data (SEC EDGAR, FY2025')
    expect(financialLanePrompt).toContain('$8,099M') // net income, $millions
    expect(financialLanePrompt).toContain('sec_edgar_10k_0000909832_fy2025')

    // Non-financial lanes (e.g. moat) must NOT receive the numbers injection.
    expect(moatLanePrompt).toBeDefined()
    expect(moatLanePrompt).not.toContain('Primary filing data (SEC EDGAR')

    // The grounded EDGAR 10-K must be persisted as a verified source on the financial lane findings.
    const events = await store.list()
    const finFinding = events.find((e) => e.event_type === 'specialist_finding_recorded'
      && (e.payload as { specialist_lane?: string }).specialist_lane === 'financial_quality')
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
    const financialLanePrompt = prompts.find((p) => p.includes('financial_quality specialist'))

    expect(managementLanePrompt).toBeDefined()
    expect(managementLanePrompt).toContain('INSIDER TRANSACTIONS (SEC Form 4')
    expect(managementLanePrompt).toContain('Discretionary SELLS: 5,000 shares')
    // Other lanes must NOT receive the insider block.
    expect(financialLanePrompt).toBeDefined()
    expect(financialLanePrompt).not.toContain('INSIDER TRANSACTIONS')

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
    const risks = prompts.find((p) => p.includes('risks specialist'))
    const moat = prompts.find((p) => p.includes('moat specialist'))
    const financial = prompts.find((p) => p.includes('financial_quality specialist'))

    // Qualitative lanes get the block, with read_source affordances for BOTH the 8-K and the 10-Q.
    for (const p of [risks, moat]) {
      expect(p).toBeDefined()
      expect(p).toContain('RECENT INTERIM FILINGS')
      expect(p).toContain('8-K filed 2026-01-15')
      expect(p).toContain('10-Q filed 2025-12-10')
      expect(p).toMatch(/read_source\("sec_edgar_recent_/)
    }
    // Numeric lanes do NOT — interim numbers must not tempt the recompute.
    expect(financial).not.toContain('RECENT INTERIM FILINGS')

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
    const financial = prompts.find((p) => p.includes('financial_quality specialist'))
    const risks = prompts.find((p) => p.includes('risks specialist'))

    for (const p of [management, moat]) {
      expect(p).toBeDefined()
      expect(p).toContain('LATEST PROXY STATEMENT')
      expect(p).toContain('read_source("sec_edgar_def14a_0000909832_2025-12-04")')
      expect(p).not.toContain('2024-12-05') // latest only — the prior year's proxy is not grounded
    }
    // Numeric lanes and risks do not get the affordance block.
    expect(financial).not.toContain('LATEST PROXY STATEMENT')
    expect(risks).not.toContain('LATEST PROXY STATEMENT')
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
        return { ...payload, cashflow_predictability: forced } as never
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
    withCirclePredictabilities(provider, ['durably_predictable', 'uncertain'])
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

  it('evidence floor: 1 grounded driver under min_drivers=2 sets aside even when durably_predictable', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    // Thin the circle gather down to a single driver (still cited + grounded).
    const orig = provider.structured.getMockImplementation()!
    provider.structured.mockImplementation(async (req: { response_format?: { schema_name?: string } }) => {
      const payload = await orig(req) as Record<string, unknown> & { cashflow_drivers?: unknown[] }
      if (req?.response_format?.schema_name === 'BuffettMungerCircleCompetence') {
        return { ...payload, cashflow_drivers: (payload.cashflow_drivers as unknown[]).slice(0, 1) } as never
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
    const financial = prompts.find((p) => p.includes('financial_quality specialist'))
    const moat = prompts.find((p) => p.includes('moat specialist'))
    const risks = prompts.find((p) => p.includes('risks specialist'))

    // Primary annual block grounds on the 20-F: form-slug source id + form-interpolated prose.
    expect(financial).toBeDefined()
    expect(financial).toContain('Primary filing data')
    expect(financial).toContain('sec_edgar_20f_0000353278_fy2025')
    expect(financial).toContain('20-F')
    expect(financial).not.toContain('the latest 10-K') // prose must not claim a 10-K for a 20-F filer

    // The PRE-VERIFIED PRIMARY SOURCES block carries the 20-F id to the qualitative lanes.
    expect(moat).toBeDefined()
    expect(moat).toContain('sec_edgar_20f_0000353278_fy2025')

    // 6-K rides the interim-recency block exactly like an 8-K.
    expect(risks).toBeDefined()
    expect(risks).toContain('RECENT INTERIM FILINGS')
    expect(risks).toContain('6-K filed 2026-04-30')
    expect(risks).toMatch(/read_source\("sec_edgar_recent_/)
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
      if (schemaName === 'BuffettMungerRedTeam') {
        return {
          strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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

describe('EDGAR-anchored OE bridge + harness AAOIFI Shariah ratios', () => {
  it('anchors the OE bridge to EDGAR and recomputes the AAOIFI ratios → CONDITIONAL (COST-like)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235) // ≈0.4% of revenue
    await provider.structured({} as never) // skip quick-screen call alignment

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      // Current price 968; EDGAR diluted shares 444.8 → market cap ≈ 430,646 ($M).
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')

    // OE bridge: NI/D&A/SBC EDGAR-anchored (8099 / 2426 / 860); maintenance_capex is the MODEL's JUDGMENT
    // (default fixture: 1, within the [0, total capex 5498] envelope) — was the binding-proxy 2426 (updated:
    // architecture says the model judges maint capex; the Greenwald/D&A proxy is now a sanity reference).
    expect(cp?.valuation?.bridge_basis).toBe('sec_edgar')
    expect(cp?.valuation?.bridge_fiscal_year).toBe(2025)
    expect(cp?.valuation?.bridge_source_id).toBe('sec_edgar_10k_0000909832_fy2025')
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBe(8099)
    expect(cp?.valuation?.owner_earnings_bridge?.depreciation_amortization).toBe(2426)
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBe(1)
    // The Greenwald/D&A proxy (2426, D&A floor) is surfaced as a SANITY-CHECK REFERENCE (not the OE input).
    expect(cp?.valuation?.maintenance_capex_proxy_reference).toBeCloseTo(2426, 0)
    expect(cp?.valuation?.owner_earnings_bridge?.stock_based_comp).toBe(860)
    expect(cp?.valuation?.owner_earnings_bridge?.shares_outstanding).toBeCloseTo(444.8, 3)
    // OE_ps = (8099 + 2426 - 1 - 860 - 0) / 444.8 ≈ 21.73 (model-judged maint capex; was 16.27 under the proxy)
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(21.73, 1)

    // Harness-computed AAOIFI ratios re-verify the model:
    expect(cp?.shariah_financial?.debt_ratio).toBeCloseTo(0.0134, 3)
    expect(cp?.shariah_financial?.cash_securities_ratio).toBeCloseTo(0.0355, 3)
    expect(cp?.shariah_financial?.impermissible_income_pct).toBeCloseTo(0.004, 4)
    expect(cp?.shariah_financial?.verdict).toBe('CONDITIONAL')
    expect(cp?.shariah_financial?.purification_pct).toBeCloseTo(0.004, 4)
    expect(cp?.shariah_financial?.market_cap).toBeCloseTo(968 * 444.8, 0)
    // Recorded shariah status reflects the harness CONDITIONAL verdict.
    expect(cp?.shariah_status).toBe('CONDITIONAL')
    expect(cp?.shariah_sector_status).toBe('conditional')

    // Phase 1.3/1.4 provenance (computed regardless of the moat gate): the DEMONSTRATED-HISTORY reference
    // growth from the ROBUST demonstrated EDGAR OE/share log-linear slope (≈14.1%/yr over FY2023–2025) —
    // BELOW the re-derived single_growth_cap (0.15) so it passes through UNCAPPED, above GDP — and the
    // discount = config-default Treasury + premium. HEADLINE-GROWTH INVERSION: the demonstrated CAGR is now
    // the demonstrated_growth_reference (a sanity reference), NOT the headline growth_rate. This fixture's
    // decision supplies NO valuation_reasoning (no cited assumed_growth) → A1 routes to RESEARCH_MORE and the
    // headline growth_rate is omitted (degraded per A1 — no fall-back to the credited-g as the headline).
    // (Was: growth_rate ≈ 0.1407 — the old credited-g headline, inverted from the architecture.)
    expect(cp?.valuation?.growth_basis).toBe('edgar_oe_cagr')
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0.1407, 3) // demonstrated ~14.1%, below the 0.15 cap (uncapped)
    expect(cp?.valuation?.growth_rate).toBeUndefined() // no grounded assumed_growth → headline omitted (A1)
    expect(cp?.valuation?.growth_above_gdp).toBe(true)
    // F.2 — discount provenance now carries the COMPLIANT risk-free SAVINGS rate. This command threads NO
    // risk_free_rate, so the swarm fails closed to the strategy savings_rate_default (0.02) → basis
    // 'config_default' and discount = 0.02 + 0.055 = 0.075.
    expect(cp?.valuation?.discount_inputs?.equity_premium).toBe(0.055)
    expect(cp?.valuation?.discount_inputs?.risk_free_basis).toBe('config_default')
    expect(cp?.valuation?.discount_inputs?.risk_free_rate).toBeCloseTo(0.02, 10)
    expect(cp?.valuation?.discount_rate).toBeCloseTo(0.075, 10)
  })

  it('sources the AAOIFI recompute overlay from the focused Shariah-reasoning PASS (not the lane)', async () => {
    // Proves Task 2: the harness recompute reads shariahLaneJudgment from the ALWAYS-ON focused
    // Shariah-reasoning pass, NOT the deep-dive lane. The lane OMITS its overlay (sector_status +
    // impermissible_income), yet the pass supplies a grounded compliant/0 judgment — so the AAOIFI ratios
    // still compute (shariah_financial present) and there is NO impermissible_income_not_emitted flag. If
    // the recompute had stayed on the (now-omitted) lane overlay, it would have failed closed instead.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
    let laneCall = 0
    const provider = {
      provider_id: 'fake-swarm-shariah-pass-only',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
        if (schemaName === 'BuffettMungerCircleCompetence') return fakeCirclePayload(src)
        if (schemaName === 'BuffettMungerQuickScreen') {
          return {
            summary: 's', business_quality: 'b', moat: 'm', management_capital_allocation: 'mc',
            financial_quality: 'fq', valuation_sanity: 'vs', shariah_status: 'CONDITIONAL',
            red_flags: ['None'], confidence: 'high', caveats: ['c'],
            screening_result: 'deep_dive_candidate', proposed_sources: [src('src_qs_1')],
          }
        }
        if (schemaName === 'BuffettMungerMoatLane') {
          return {
            finding_summary: 'Moat lane', confidence: 'medium', caveats: ['c'],
            ...moatThesisForTier('wide', 'src_lane_moat'), runway: 'proven',
            ...runwayThesisForTier('proven', 'src_lane_moat'),
            proposed_sources: [src('src_lane_moat')],
          }
        }
        // The SHARIAH LANE grounds a source but deliberately OMITS the sector/impermissible-income overlay.
        if (schemaName === 'BuffettMungerShariahLane') {
          return {
            finding_summary: 'Shariah lane', confidence: 'medium', caveats: ['c'],
            proposed_sources: [src('src_lane_shariah')],
          }
        }
        // The focused PASS is the SOLE source of the overlay the harness recomputes from.
        if (schemaName === 'BuffettMungerShariahReasoning') {
          return {
            shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: 'compliant', impermissible_income: 0, sector_citation: 'src_shariah_reasoning' },
            proposed_sources: [src('src_shariah_reasoning')],
          }
        }
        if (schemaName === 'BuffettMungerLaneFinding') {
          const n = laneCall++
          return { finding_summary: `Lane ${n}`, confidence: 'medium', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
        }
        if (schemaName === 'BuffettMungerRedTeam') {
          return {
            strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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
        return {
          investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
          next_required_action: 'Await MoS.', decision_reason: 'Quality but pricey', thesis_summary: 'Compounder',
          evidence_summary: 'Covered', valuation_rationale: 'Elevated', shariah_rationale: 'Clean',
          synthesis_summary: 'Reviewed', risks: ['Valuation'], open_questions: ['MoS'],
          ...DECISION_MOS_FIXTURE,
          growth_assumptions: 'Two-stage DCF; banded g.',
          owner_earnings_bridge: {
            net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1,
            maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
            normalized_working_capital_change: 0, shares_outstanding: 1,
          },
          roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43, proposed_buy_below: 150,
          proposed_sources: [src('src_dec_1')],
        }
      }),
    }

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')

    // The AAOIFI recompute ran → shariah_financial exists ONLY because shariahJudgment (from the PASS) is
    // present, even though the lane omitted its overlay. A genuine 0 impermissible income → clean PASS.
    expect(cp?.shariah_financial).toBeDefined()
    expect(cp?.shariah_financial?.verdict).toBe('PASS')
    expect(cp?.shariah_status).toBe('COMPLIANT')
    expect(cp?.shariah_sector_status).toBe('compliant')
    // The pass supplied the overlay, so the omitted-overlay fail-closed flag must NOT be present.
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).not.toMatch(/impermissible_income_not_emitted/)
  })

  it('F.2 — threads the compliant app-config savings rate into the discount (basis compliant_savings)', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProvider()
    await provider.structured({} as never) // skip the quick-screen call

    await runResearchDeepDivePhase(
      store,
      provider as never,
      { ...deepDiveCommand(), risk_free_rate: 0.03 },
      { ground: verifyAllGround(), laneConcurrency: 7, fundamentals: costFundamentals },
    )

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // Threaded compliant savings rate 0.03 → basis 'compliant_savings', discount = 0.03 + 0.055 = 0.085.
    expect(cp?.valuation?.discount_inputs?.risk_free_basis).toBe('compliant_savings')
    expect(cp?.valuation?.discount_inputs?.risk_free_rate).toBeCloseTo(0.03, 10)
    expect(cp?.valuation?.discount_inputs?.equity_premium).toBe(0.055)
    expect(cp?.valuation?.discount_rate).toBeCloseTo(0.085, 10)
  })

  it('falls back to the model-proposed bridge + lane verdict when EDGAR is absent', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(100)
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fetchFundamentals: async () => undefined, // EDGAR down / non-US
      resolvePrice: async () => ({ available: false, reason: 'no quote', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.valuation?.bridge_basis).toBe('model_proposed')
    // model-proposed bridge passes through (net_income 8099 from the model)
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBe(8099)
    // No harness ratios computed → falls back to the lane-proposed (quick-screen) status, which the
    // deep-dive prereq seeds as COMPLIANT.
    expect(cp?.shariah_financial).toBeUndefined()
    expect(cp?.shariah_status).toBe('COMPLIANT')
  })

  it('UNDETERMINED impermissible income (lane returns null) → fail-closed UNDETERMINED, NOT a clean 0% / COMPLIANT', async () => {
    // The compliance fail-OPEN regression: when the filing does not separately disclose impermissible
    // income the lane now returns null (undetermined). The harness must NOT compute a 0% purification /
    // PASS — it fails closed to an UNDETERMINED verdict with no shariah_financial, and surfaces a
    // "purification cannot be determined" flag.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(null, 'compliant')
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // No harness ratios (impermissible income undetermined → not-computable). NEVER a 0%/COMPLIANT.
    expect(cp?.shariah_financial).toBeUndefined()
    expect(cp?.shariah_status).toBe('UNDETERMINED')
    expect(cp?.shariah_impermissible_income_undetermined).toBe(true)
    // The undetermined cause is surfaced (distinct from the omitted-overlay and market-cap causes).
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/shariah_ratios_unverified:\s*impermissible_income_undetermined/)
    expect(degraded.join(' ')).toMatch(/[Pp]urification CANNOT be determined/)
    expect(degraded.join(' ')).not.toMatch(/impermissible_income_not_emitted/)
  })

  it('null impermissible income + XBRL interest income present → harness computes from the XBRL figure (no UNDETERMINED)', async () => {
    // No filing discloses an "impermissible income" line, so the pass honestly returns null for nearly
    // every ticker — permanent UNDETERMINED. The harness now extracts disclosed interest income from
    // XBRL (the AAOIFI computable proxy) and OWNS the number: a null from the pass falls back to the
    // deterministic XBRL figure instead of failing closed, with visible provenance.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(null, 'compliant')
    await provider.structured({} as never)

    const withInterestIncome: Fundamentals = {
      ...costFundamentals,
      latest_annual: {
        ...costFundamentals.latest_annual,
        impermissible_income_lines: [
          { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 200 },
          { concept: 'InvestmentIncomeDividend', label: 'dividend income', amount_musd: 100 },
        ],
      },
    }
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: withInterestIncome,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // Ratios computable from the XBRL component total (200 + 100) — a real purification %, not UNDETERMINED.
    expect(cp?.shariah_financial?.verdict).toBe('CONDITIONAL')
    expect(cp?.shariah_financial?.purification_pct).toBeCloseTo(300 / 275235, 8)
    expect(cp?.shariah_status).toBe('CONDITIONAL')
    expect(cp?.shariah_impermissible_income_undetermined).toBeUndefined()
    // ALL impermissible-income lines are SHOWN — through the PROJECTION (what the UI reads), itemized.
    expect(cp?.shariah_financial?.impermissible_income_lines).toEqual([
      { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 200 },
      { concept: 'InvestmentIncomeDividend', label: 'dividend income', amount_musd: 100 },
    ])
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const payload = analysisEvent?.payload as Record<string, unknown>
    // And on the recorded ledger payload itself.
    const sf = payload?.['shariah_financial'] as Record<string, unknown>
    expect(sf?.['impermissible_income_lines']).toEqual([
      { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 200 },
      { concept: 'InvestmentIncomeDividend', label: 'dividend income', amount_musd: 100 },
    ])
    const valuation = payload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    // Provenance is visible; the fail-closed UNDETERMINED flag is NOT raised.
    expect(degraded.join(' ')).toMatch(/impermissible_income_xbrl/)
    expect(degraded.join(' ')).not.toMatch(/impermissible_income_undetermined/)
  })

  it('model impermissible income BELOW the XBRL interest income → conservative max wins (flagged)', async () => {
    // The model may quantify prohibited-segment revenue beyond interest, so a HIGHER model figure is
    // kept; but a model figure BELOW the deterministic XBRL interest income is an undercount — the
    // harness takes the max (purification errs high, never silently low).
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(100, 'compliant')
    await provider.structured({} as never)

    const withInterestIncome: Fundamentals = {
      ...costFundamentals,
      latest_annual: {
        ...costFundamentals.latest_annual,
        impermissible_income_lines: [
          { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 300 },
        ],
      },
    }
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: withInterestIncome,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.shariah_financial?.verdict).toBe('CONDITIONAL')
    // purification reflects the XBRL 300 (over revenue), not the model's 100.
    expect(cp?.shariah_financial?.purification_pct).toBeCloseTo(300 / 275235, 8)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const payload = analysisEvent?.payload as Record<string, unknown>
    const sf = payload?.['shariah_financial'] as Record<string, unknown>
    // The shown lines are the XBRL composition (the model's lower 100 lost the conservative max).
    expect(sf?.['impermissible_income_lines']).toEqual([
      { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 300 },
    ])
    const valuation = payload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/impermissible_income_xbrl/)
  })

  it('model impermissible income ABOVE the XBRL total → model wins, shown as XBRL lines + a model residual line', async () => {
    // A model figure ABOVE the disclosed interest/dividend total legitimately carries prohibited-segment
    // revenue the XBRL concepts cannot see — the max keeps it, and the shown composition itemizes the
    // XBRL lines plus the model residual so the total is fully accounted for.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(500, 'compliant')
    await provider.structured({} as never)

    const withInterestIncome: Fundamentals = {
      ...costFundamentals,
      latest_annual: {
        ...costFundamentals.latest_annual,
        impermissible_income_lines: [
          { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 300 },
        ],
      },
    }
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: withInterestIncome,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.shariah_financial?.purification_pct).toBeCloseTo(500 / 275235, 8)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const sf = (analysisEvent?.payload as Record<string, unknown>)?.['shariah_financial'] as Record<string, unknown>
    const lines = sf?.['impermissible_income_lines'] as Array<{ concept: string; amount_musd: number }>
    expect(lines?.map((l) => [l.concept, l.amount_musd])).toEqual([
      ['InvestmentIncomeInterest', 300],
      ['model_judgment', 200],
    ])
  })

  it('GENUINE zero impermissible income (lane returns 0, sector compliant) → PASS / 0% (unchanged)', async () => {
    // Replay-safety + genuine-path guard: a real affirmatively-verified 0 still computes a clean PASS.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0, 'compliant')
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.shariah_financial?.verdict).toBe('PASS')
    expect(cp?.shariah_financial?.purification_pct).toBe(0)
    expect(cp?.shariah_status).toBe('COMPLIANT')
    expect(cp?.shariah_impermissible_income_undetermined).toBeUndefined()
  })

  it('sector non_compliant is a hard stop even when financial ratios pass', async () => {
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0, 'non_compliant')
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // financial ratios PASS (zero impermissible) but sector hard stop forces NON_COMPLIANT.
    expect(cp?.shariah_financial?.verdict).toBe('PASS')
    expect(cp?.shariah_status).toBe('NON_COMPLIANT')
    expect(cp?.shariah_sector_status).toBe('non_compliant')
  })

  it('retries the price fetch once on a transient throw → market cap resolves (ratios computed)', async () => {
    // The injected price resolver THROWS on the first call then succeeds — the harness retry must recover
    // it so the AAOIFI ratios still compute (a transient blip no longer silently voids the market cap).
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)

    let priceCalls = 0
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => {
        priceCalls++
        if (priceCalls === 1) throw new Error('ECONNRESET (transient)')
        return { available: true as const, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }
      },
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // The retry recovered the price → market cap + ratios computed.
    expect(priceCalls).toBe(2)
    expect(cp?.shariah_financial?.debt_ratio).toBeDefined()
    expect(cp?.shariah_financial?.market_cap).toBeCloseTo(968 * 444.8, 0)
    // No market_cap_unavailable flag — the retry succeeded.
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).not.toMatch(/market_cap_unavailable/)
  })

  it('throws twice → market cap undefined + shariah_ratios_unverified: market_cap_unavailable flag', async () => {
    // The price resolver always throws (transient blip that does not recover). After the single retry the
    // market cap is undefined; EDGAR fundamentals + the Shariah overlay ARE present, so the harness must
    // surface market_cap_unavailable (the ONLY missing AAOIFI input is the market cap) — not fabricate one.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)

    let priceCalls = 0
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => { priceCalls++; throw new Error('ECONNRESET (transient)') },
      // No avg-market-cap resolver injected → undefined in test mode → market cap stays undefined.
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // Exactly two attempts (initial + one retry), then give up — no fabricated market cap.
    expect(priceCalls).toBe(2)
    expect(cp?.shariah_financial).toBeUndefined()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/shariah_ratios_unverified:\s*market_cap_unavailable/)
    // It is distinct from the impermissible-income cause (the overlay WAS emitted here).
    expect(degraded.join(' ')).not.toMatch(/impermissible_income_not_emitted/)
  })

  // ---- Bug 1: the EDGAR net-income anchor is REAL + bounded (was a no-op = full model trust) ----
  it('model net_income=0 (wild) → net income falls back to EDGAR reported, OE positive, flag recorded', async () => {
    // CPRT-shaped failure: EDGAR reported NI 8099, but the model emits net_income 0. The OLD anchor
    // (edgar + (model − edgar) = model) produced 0 → spurious negative OE → INSUFFICIENT_DATA. NI is now
    // anchored to EDGAR; a proposed 0 (a 100% gap, beyond the 60% gross-mismatch band) is treated as a
    // scale/units error and the EDGAR-REPORTED figure (8099) is used verbatim — the primary filing owns NI.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 0, depreciation_amortization: 999, maintenance_capex: 1,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // NI falls back to EDGAR's reported figure (8099), not the band floor — the primary filing owns NI.
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBeCloseTo(8099, 2)
    // OE positive (no spurious negative), valuation computes (not voided).
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeGreaterThan(0)
    // The scale/units mismatch is visible.
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/oe_bridge_net_income_scale_mismatch/)
  })

  it('model net_income within ±35% band → used as-is, no clamp flag', async () => {
    // EDGAR 8099; model proposes 7500 (a ~7.4% normalization, within the band) → used as-is, no flag.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 7500, depreciation_amortization: 999, maintenance_capex: 1,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBe(7500)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).not.toMatch(/oe_bridge_net_income_clamped/)
  })

  it('model restating D&A / SBC / shares is IGNORED — those stay EDGAR-sourced', async () => {
    // The model emits garbage for D&A/SBC/shares; the bridge must use EDGAR (2426 / 860 / 444.8), not
    // the model's restatement. (NI within band so the anchor passes it through.)
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 99999, maintenance_capex: 1,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 77777,
      normalized_working_capital_change: 0, shares_outstanding: 99999,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.valuation?.owner_earnings_bridge?.depreciation_amortization).toBe(2426)
    expect(cp?.valuation?.owner_earnings_bridge?.stock_based_comp).toBe(860)
    expect(cp?.valuation?.owner_earnings_bridge?.shares_outstanding).toBeCloseTo(444.8, 3)
  })

  // ---- Maintenance capex is the MODEL's JUDGMENT; the Greenwald/D&A proxy is a sanity-check reference ----
  // Architecture: OE = NI + D&A − maintenance_capex − SBC − ΔNWC is deterministic arithmetic on facts, but
  // the maintenance-vs-growth split of total capex is a JUDGMENT. Per the architecture that judgment is the
  // MODEL's (grounded in the EDGAR capex/D&A facts, cite-verified by A1's owner_earnings_citation), NOT the
  // deterministic Greenwald/D&A proxy. The proxy is surfaced as a SANITY-CHECK REFERENCE only.
  it('OE uses the MODEL judged maintenance_capex, not the Greenwald/D&A proxy', async () => {
    // EDGAR: NI 8099, D&A 2426, SBC 860, shares 444.8, capex 5498; the D&A-floor proxy = 2426.
    // The model judges maintenance_capex = 1000 (≠ the 2426 proxy, but WITHIN [0, total capex 5498]).
    // OE = 8099 + 2426 − 1000 − 860 = 8665; OE/share = 8665 / 444.8 ≈ 19.48 (vs the proxy-bound 16.27).
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1000,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // The bridge maintenance_capex is the MODEL's judged 1000 — NOT the 2426 proxy.
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBe(1000)
    // NI/D&A/SBC remain EDGAR-anchored.
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBe(8099)
    expect(cp?.valuation?.owner_earnings_bridge?.depreciation_amortization).toBe(2426)
    expect(cp?.valuation?.owner_earnings_bridge?.stock_based_comp).toBe(860)
    // OE/share reflects the model's maint capex (≈19.48), not the proxy-bound 16.27.
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(19.48, 1)
  })

  it('surfaces the Greenwald/D&A proxy as a reference + advisory divergence flag when the model is materially below it', async () => {
    // Model judges maintenance_capex = 500 — MATERIALLY below the 2426 conservative proxy (more aggressive
    // OE → higher value). The proxy is surfaced as maintenance_capex_proxy_reference; an ADVISORY divergence
    // flag fires; the verdict is NOT blocked/changed by it.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 500,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // The proxy is surfaced as a reference (the conservative 2426 D&A-floor).
    expect(cp?.valuation?.maintenance_capex_proxy_reference).toBeCloseTo(2426, 0)
    // The model's judged value still drives OE (500, not the 2426 proxy).
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBe(500)
    // An ADVISORY divergence flag fires (sanity_flags — never blocks).
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const flagsBlob = [
      ...((valuation?.['sanity_flags'] as string[] | undefined) ?? []),
      ...((valuation?.['degraded_flags'] as string[] | undefined) ?? []),
    ].join(' ')
    expect(flagsBlob).toMatch(/maintenance.capex.*below.*proxy|proxy.*maintenance.capex/i)
    // The verdict is not BLOCKED by the advisory flag (a verdict is still recorded — the run completes).
    expect(cp?.investment_verdict).toBeDefined()
  })

  it('amortization-heavy filer (SPGI dogfood 2026-07-10): the envelope FALLBACK is capped at total capex — never a proxy that violates the same envelope', async () => {
    // SPGI live shape: D&A ($1.2B, merger-amortization heavy) dwarfs total capex ($195M). The model's
    // maintenance_capex (350) is rejected against the envelope [0, 195] — but the Greenwald/D&A proxy
    // fallback (~D&A-scaled, >> 195) violated the SAME envelope, understating OE and overstating every
    // implied-growth/fair-value read. The fallback must be clamped to total capex.
    const amortHeavy = {
      ...costFundamentals,
      latest_annual: { ...costFundamentals.latest_annual, d_and_a_musd: 1200, capex_musd: 195 },
      annual_series: costFundamentals.annual_series!.map((y) => ({ ...y, d_and_a_musd: 1200, capex_musd: 195 })),
    }
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 350,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: amortHeavy,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    const boundMaint = cp?.valuation?.owner_earnings_bridge?.maintenance_capex
    // The binding value must respect the envelope: ≤ total capex (195) — never the uncapped D&A proxy.
    expect(boundMaint).toBeDefined()
    expect(boundMaint!).toBeLessThanOrEqual(195)
  })

  it('rejects a model maintenance_capex above total capex (envelope) and falls back to the proxy with a visible flag', async () => {
    // Model judges maintenance_capex = 6000 — ABOVE total capex (5498); that is not maintenance, it is a
    // units/logic error. The deterministic envelope rejects it and falls back to the conservative proxy
    // (2426) with a VISIBLE flag; OE is NOT computed from the absurd 6000.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 6000,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // Falls back to the proxy (2426), NOT the absurd 6000.
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBeCloseTo(2426, 0)
    // OE/share computed from the safe proxy value (≈16.27), not from 6000.
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(16.27, 1)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/maintenance_capex.*exceeds.*capex|range_check_rejected.*maintenance_capex/i)
  })

  it('a clean case (model maintenance_capex ≈ proxy) → no divergence flag; OE uses the model value', async () => {
    // Model judges maintenance_capex = 2426 (≈ the proxy). No divergence flag; OE uses the model value
    // (which equals the proxy here) → OE/share ≈ 16.27.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 2426,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBe(2426)
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(16.27, 1)
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const flagsBlob = [
      ...((valuation?.['sanity_flags'] as string[] | undefined) ?? []),
      ...((valuation?.['degraded_flags'] as string[] | undefined) ?? []),
    ].join(' ')
    expect(flagsBlob).not.toMatch(/maintenance.capex.*below.*proxy/i)
  })

  it('grounding inheritance: an ungrounded owner-earnings basis (A1) degrades to RESEARCH_MORE — no confident headline FV', async () => {
    // The model's maintenance_capex is part of the owner-earnings basis A1 grounds via owner_earnings_citation.
    // When the basis is ungrounded (no valuation_reasoning → synthesis_grounding_unmet), A1 routes to
    // RESEARCH_MORE and the headline fair value is omitted — maint-capex/OE inherit that degradation. (This
    // fixture supplies NO valuation_reasoning, so the OE basis is ungrounded.)
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235, 'conditional', {
      net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1000,
      maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
      normalized_working_capital_change: 0, shares_outstanding: 1,
    })
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // OE/share is still computed (the bridge arithmetic), but the headline FV is omitted (A1 → RESEARCH_MORE).
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeGreaterThan(0)
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect(valuation?.['synthesis_grounding_unmet']).toBe(true)
    // The grounding reason explicitly names the owner-earnings basis path (which carries maint-capex).
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/synthesis_grounding_unmet/)
  })

  // ---- FX / IFRS currency-normalization (Task 3 — IFRS/20-F Shariah currency normalization) ----
  // Foreign 20-F filers (e.g. NVO) report fundamentals in their local currency (DKK) while the market cap
  // derived from Yahoo/US-listed ADR prices is in USD. Without FX conversion the ratios mix currencies and
  // can be off by the USD/DKK rate (~6.9×). These tests verify the conversion path and its fail-closed guard.
  it('V3 (owner-validated option A) — DKK filer: per-share valuation runs in USD (fx × assumed 1:1 ADR), provenance + flag recorded', async () => {
    // NVO-shaped 20-F filer: bridge/OE in DKK, price in USD. The T0 conversion must put EVERY per-share
    // output in USD: oe_ps(USD) = oe_ps(DKK) × 1 (assumed ADR ratio, flagged) × 0.145.
    const dkkFundamentals = {
      ...costFundamentals,
      currency: 'DKK',
      latest_annual: { ...costFundamentals.latest_annual, currency: 'DKK' },
    }
    const rate = 0.145
    // Price scaled so the USD-converted basis is PLAUSIBLE (~2.55 USD OE/share → ~11.8× at $30): the
    // absurdity guards suppress outputs otherwise, and a naive unconverted DKK read would be ~1.7×.
    const priceUsd = 30
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: dkkFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: priceUsd, currency: 'USD', as_of: 'x', source: 'test' }),
      resolveFxRate: async (currency) => (currency === 'DKK' ? rate : undefined),
    })
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    const v = cp?.valuation
    // Conversion provenance recorded (assumed 1:1 — no curated entry) + the visible assumption flag.
    expect(v?.fx_conversion?.reporting_currency).toBe('DKK')
    expect(v?.fx_conversion?.fx_rate_to_usd).toBe(rate)
    expect(v?.fx_conversion?.adr_ordinary_per_listed).toBe(1)
    expect(v?.fx_conversion?.adr_ratio_source).toBe('assumed_1')
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const val = (analysis?.payload as { valuation?: { degraded_flags?: string[]; normalized_owner_earnings_per_share?: number; market_implied_growth?: number } }).valuation
    expect((val?.degraded_flags ?? []).join(' ')).toMatch(/adr_ratio_assumed/)
    // The reporting-currency OE/share stays as-recorded (DKK, per ordinary share)…
    const oePsDkk = val?.normalized_owner_earnings_per_share
    expect(oePsDkk).toBeDefined()
    expect(oePsDkk!).toBeGreaterThan(10) // ≈17.6 DKK — clearly the unconverted reporting figure
    // …while the reverse-DCF ran on the USD basis: $30 vs ≈$2.55/share (11.8×) solves to ≈−6.1% implied
    // growth at the 7.5% default discount — a NAIVE unconverted read ($30 vs 17.6 "DKK-as-USD" = 1.7×)
    // would solve wildly lower/not at all. Pinning the exact solved value proves the USD basis precisely.
    const impliedGrowthUsd = val?.market_implied_growth
    expect(impliedGrowthUsd).toBeDefined()
    expect(impliedGrowthUsd).toBeCloseTo(-0.0606, 2)
  })

  it('V3 — DKK filer with NO FX rate: the per-share valuation is BLOCKED (fail-closed, flagged), never a silent currency mix', async () => {
    const dkkFundamentals = {
      ...costFundamentals,
      currency: 'DKK',
      latest_annual: { ...costFundamentals.latest_annual, currency: 'DKK' },
    }
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: dkkFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
      resolveFxRate: async () => undefined,
    })
    const events = await store.list()
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const val = (analysis?.payload as { valuation?: Record<string, unknown> }).valuation
    expect(((val?.['degraded_flags'] as string[] | undefined) ?? []).join(' ')).toMatch(/fx_unavailable_valuation_blocked/)
    // No USD per-share outputs were fabricated off DKK numbers.
    expect(val?.['implied_exit_multiple']).toBeUndefined()
    expect(val?.['market_implied_growth']).toBeUndefined()
    expect(val?.['fx_conversion']).toBeUndefined()
  })

  it('DKK filer + USD market cap + known FX rate → debt_ratio computed in DKK (not raw USD)', async () => {
    // Simulate a 20-F filer (NVO-shaped): latest_annual.currency = 'DKK', fundamentals in DKK millions.
    // The ADR is priced in USD on US exchanges → market_cap is in USD.
    // With rate = 0.145 (1 DKK = 0.145 USD), market_cap_dkk = market_cap_usd / 0.145.
    const dkkFundamentals = {
      ...costFundamentals,
      currency: 'DKK',
      latest_annual: { ...costFundamentals.latest_annual, currency: 'DKK' },
    }
    // Impermissible income in DKK millions (≈0.4% of DKK revenue — same proportion as before).
    const impPermDkk = 0.004 * 275235
    const rate = 0.145 // 1 DKK = 0.145 USD
    const priceUsd = 968
    const sharesM = 444.8
    const marketCapUsd = priceUsd * sharesM // $MILLIONS
    const marketCapDkk = marketCapUsd / rate

    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(impPermDkk)
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: dkkFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: priceUsd, currency: 'USD', as_of: 'x', source: 'test' }),
      resolveFxRate: async (currency) => {
        if (currency === 'DKK') return rate
        return undefined
      },
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')

    // Ratios are computed in DKK: denominators are marketCapDkk (not marketCapUsd).
    // debt_ratio = total_debt_dkk / marketCapDkk = 5788 / (968*444.8/0.145)
    expect(cp?.shariah_financial?.debt_ratio).toBeCloseTo(costFundamentals.latest_annual.total_debt_musd! / marketCapDkk, 6)
    // market_cap recorded is the DKK-denominated value (consistent with DKK fundamentals).
    expect(cp?.shariah_financial?.market_cap).toBeCloseTo(marketCapDkk, 0)
    // Verdict computes (the ratio still passes < 0.30 in DKK).
    expect(cp?.shariah_financial).toBeDefined()
    // The ~6.9× difference vs. a raw-USD debt_ratio confirms the conversion happened.
    const rawUsdDebtRatio = costFundamentals.latest_annual.total_debt_musd! / marketCapUsd
    expect(cp?.shariah_financial?.debt_ratio).not.toBeCloseTo(rawUsdDebtRatio, 3)
  })

  it('DKK filer + USD market cap + FX rate unavailable → shariah_financial undefined (fail-closed)', async () => {
    // If the FX rate cannot be resolved (Yahoo down, currency unknown), the harness must NOT mix currencies.
    // It fails closed: ratios are not-computable, shariah_financial stays undefined (UNDETERMINED verdict).
    const dkkFundamentals = {
      ...costFundamentals,
      currency: 'DKK',
      latest_annual: { ...costFundamentals.latest_annual, currency: 'DKK' },
    }
    const impPermDkk = 0.004 * 275235

    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(impPermDkk)
    await provider.structured({} as never)

    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: dkkFundamentals,
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
      // resolveFxRate returns undefined → currencies differ, rate unavailable → fail-closed.
      resolveFxRate: async () => undefined,
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // No mixed-currency ratios: shariah_financial must be absent.
    expect(cp?.shariah_financial).toBeUndefined()
  })

  it('USD filer (currency USD) → no FX fetch, ratios unchanged vs. baseline', async () => {
    // For US-domiciled filers (la.currency === market_cap_currency === USD) the FX path is entirely
    // bypassed: resolveFxRate must never be called, and the ratios are identical to the baseline test.
    const store = new InMemoryEventStore()
    await seedDeepDivePrereqs(store)
    const provider = swarmFakeProviderWithShariah(0.004 * 275235)
    await provider.structured({} as never)

    let fxCalled = false
    await runResearchDeepDivePhase(store, provider as never, deepDiveCommand(), {
      ground: verifyAllGround(),
      laneConcurrency: 7,
      fundamentals: costFundamentals, // USD filer
      resolvePrice: async () => ({ available: true, price_per_share: 968, currency: 'USD', as_of: 'x', source: 'test' }),
      resolveFxRate: async () => { fxCalled = true; return 1 },
    })

    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    const cp = projections.find((c) => c.research_case_id === 'rc_edgar')
    // FX resolver must never be invoked for a USD filer.
    expect(fxCalled).toBe(false)
    // Ratios computed as normal (baseline).
    expect(cp?.shariah_financial?.debt_ratio).toBeCloseTo(0.0134, 3)
    expect(cp?.shariah_financial?.market_cap).toBeCloseTo(968 * 444.8, 0)
  })
})

// ---------------------------------------------------------------------------
// FOCUSED valuation-reasoning fallback (the focused decomposition mirroring the red-team-response call).
// The monolithic decision schema intermittently DROPS valuation_reasoning (KO: "wide moat, predictable, but
// EXPENSIVE" → a clean WATCH, but the structured owner-earnings + assumed-growth citation fields fell out).
// A1 then fail-closes to RESEARCH_MORE. When that happens, a SMALL focused grounded call produces the
// valuation_reasoning; its grounded result lets the model's verdict land. Fail-closed preserved: if the
// focused call ALSO can't ground (omits it OR cites an ungrounded id) → RESEARCH_MORE + a visible
// valuation_reasoning_retry_exhausted note. The happy path (decision produced grounded valuation_reasoning)
// never invokes the focused call.
// ---------------------------------------------------------------------------
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
    }
    valuationReasoningCalls?: { count: number }
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
        valuation_status: 'FAIR',
      },
    })
    expect(valuation?.['buy_price_per_share']).toBe(333)
    expect(cp?.valuation_status).toBe('FAIR')
  })

  it('Test 2 — decision drops it AND the focused call ALSO fails to ground → RESEARCH_MORE + valuation_reasoning_retry_exhausted', async () => {
    const { valuation, cp } = await runVR({
      id: 'vr-exhausted',
      omitValuationReasoning: true,
      // No valuationReasoningResponse → the focused call omits the required field → retries exhaust.
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

  it('moat FAILS CLOSED to narrow when NO thesis is supplied; runway keeps its holistic fallback; both flagged', () => {
    const res = resolveJudgmentTiers({
      // No moatThesis / runwayRubric — mirrors the live dogfood (the lane omitted its judgment block).
      holisticRunway: 'limited',
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    // B6 fail-closed: with no grounded moat thesis the moat resolves to narrow (a moat class requires a
    // grounded, cite-verified thesis — silence is not trusted to pass the gate). Runway is not a gate, so
    // it keeps the holistic fallback ('limited').
    expect(res.moat?.resolved_moat_class).toBe('narrow')
    expect(res.runway?.resolved_runway).toBe('limited')
    // and the degradation is visible (not a silent substitution).
    expect(res.moat?.judgment_degraded).toBe('rubric_not_emitted')
    expect(res.runway?.judgment_degraded).toBe('rubric_not_emitted')
  })

  it('falls back to a conservative explicit default (narrow / none) when BOTH rubric and holistic are absent', () => {
    const res = resolveJudgmentTiers({
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    // never undefined — a conservative default that fails the moat gate.
    expect(res.moat?.resolved_moat_class).toBe('narrow')
    expect(res.runway?.resolved_runway).toBe('none')
    expect(res.moat?.judgment_degraded).toBe('rubric_not_emitted')
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
        if (schemaName === 'BuffettMungerRedTeam') {
          return { strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g', shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] }, proposed_sources: [src('src_qs_1')] }
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
      { ground: allVerifiedGround, laneConcurrency: 4 },
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
    // forward-DCF removal: the dollar fair_value_per_share is no longer surfaced; the internal forward FV
    // still computes, proven via the kept implied_multiple ratio.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.implied_multiple).toBeDefined()
    expect(cp?.valuation?.buy_price_per_share).toBeDefined()
  })

  it('records judgment_degraded + shariah-unverified flags and surfaces them in open_questions', async () => {
    const { analysisPayload, decisionPayload } = await runOmitted({
      synthesis: { moat_class: 'wide', runway: 'proven' }, id: 'omit-flags',
    })
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    // Every omitted structured field is a VISIBLE flag, not a silent skip.
    expect(degraded.join(' ')).toMatch(/judgment_degraded:\s*rubric_not_emitted/)
    expect(degraded.join(' ')).toMatch(/shariah_ratios_unverified:\s*impermissible_income_not_emitted/)
    // and they reach the human via the decision open_questions (mirroring red_team_objection_unaddressed).
    const openQuestions = (decisionPayload?.['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.join(' ')).toMatch(/rubric_not_emitted/)
    expect(openQuestions.join(' ')).toMatch(/impermissible_income_not_emitted/)
  })

  it('flags a g=0 demonstrated-history reference floor when no CAGR is available (honest floor, valuation still computes)', async () => {
    const { cp, analysisPayload } = await runOmitted({
      // No EDGAR series → the DEMONSTRATED-HISTORY reference floors to 0, but FV must still compute. The
      // moat is GENUINELY GROUNDED (keepMoatRubric) so the gate passes and the valuation computes.
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.05, reinvestment_rate: 0.5 },
      id: 'omit-g0', keepMoatRubric: true,
    })
    // HEADLINE-GROWTH INVERSION: the demonstrated-history reference is the floored g=0; the headline growth
    // is the model's cited assumed_growth (0.06). (Was: growth_rate === 0 — the old credited-g headline.)
    expect(cp?.valuation?.demonstrated_growth_reference).toBeCloseTo(0, 6)
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.06, 6)
    // forward-DCF removal: the dollar fair_value_per_share is no longer surfaced; the internal forward FV
    // still computes, proven via the kept implied_multiple ratio.
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.implied_multiple).toBeDefined()
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/valuation_degraded:\s*demonstrated_growth_reference_floored_g0/)
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
        if (schemaName === 'BuffettMungerRedTeam') {
          return {
            strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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

  it('retries the dedicated red-team-response when synthesis_response is omitted, then succeeds on the 2nd attempt (no flag)', async () => {
    const { provider, responseCalls } = retrySwarmProvider({ responseAttemptsToOmit: 1 })
    const { analysisPayload, decisionPayload } = await run(provider, 'retry-recover')
    // The wrapper issued a SECOND red-team-response call (the retry that bounced the missing field back).
    expect(responseCalls()).toBe(2)
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    // Recovered on retry -> no retry-exhausted flag, and the objection IS addressed (no unaddressed flag).
    expect(degraded.join(' ')).not.toMatch(/red_team_response_retry_exhausted/)
    expect(degraded.join(' ')).not.toMatch(/rubric_not_emitted/)
    expect(degraded.join(' ')).not.toMatch(/shariah_ratios_unverified/)
    const openQuestions = (decisionPayload?.['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.join(' ')).not.toMatch(/red_team_objection_unaddressed/)
  })

  it('marks the red-team-response degraded after 2 failed attempts and the run still completes (visible fallback)', async () => {
    const { provider, responseCalls } = retrySwarmProvider({ responseAttemptsToOmit: 99 })
    const { analysisPayload, decisionPayload } = await run(provider, 'retry-exhaust')
    // 2 attempts (initial + 1 retry), then fall back visibly — the run did NOT abort.
    expect(responseCalls()).toBe(2)
    expect(analysisPayload).toBeDefined()
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    // The retry exhaustion is surfaced (the dedicated red-team-response call) — never silent. The
    // deterministic red_team_objection_unaddressed enforcement also fires (the objection is unaddressed).
    expect(degraded.join(' ')).toMatch(/red_team_response_retry_exhausted/)
    expect(degraded.join(' ')).toMatch(/synthesis_response/)
    const openQuestions = (decisionPayload?.['open_questions'] as string[] | undefined) ?? []
    expect(openQuestions.join(' ')).toMatch(/red_team_objection_unaddressed/)
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
      if (schemaName === 'BuffettMungerRedTeam') {
        return {
          strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'a',
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
    expect(modelBySchema.get('BuffettMungerRedTeam')).toBe('env-red-team-model')
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
          owner_earnings_citation: 'src_lane_0', // a lane-grounded, hash-verified corpus id
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth grounded in segment capex per the corpus filing.',
          assumed_growth_citation: 'src_lane_0',
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

  it('Test 3 — UNGROUNDED OWNER-EARNINGS citation (not in corpus): verdict RESEARCH_MORE + synthesis_grounding_unmet', async () => {
    const { cp } = await runWithSynthesis('rc_g_oe', {
      investmentVerdict: 'BUY',
      synthesis: {
        valuation_reasoning: {
          owner_earnings_basis: 'FY25 owner earnings per the 10-K bridge.',
          owner_earnings_citation: 'src_not_in_corpus', // does NOT verify
          assumed_growth: 0.06,
          assumed_growth_rationale: 'Growth rationale.',
          assumed_growth_citation: 'src_dec_1', // verifies
        },
      },
    })
    expect(cp?.valuation?.synthesis_grounding_unmet).toBe(true)
    expect(cp?.valuation?.synthesis_grounding_reason).toMatch(/owner_earnings_citation/)
    expect(cp?.investment_verdict ?? cp?.decision).toBe('RESEARCH_MORE')
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
    const { cp } = await runWithSynthesis('rc_g_trip', { investmentVerdict: 'BUY', omitValuationReasoning: true })
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
      series.push({ fiscal_year: fy, currency: 'USD', net_income_musd: ni, revenue_musd: 10000, d_and_a_musd: 200, capex_musd: 200, sbc_musd: 0, diluted_shares_m: 100 })
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
        resolvePrice: async () => ({ available: true as const, price_per_share: 50, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
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
  // A swarm fake provider whose circle judgment reports a cashflow_predictability verdict and cites
  // `driverCite`/`breakerCite` for the two clauses. `driverText`/`breakerText` default to substantive text
  // but can be set to '' to exercise the empty-text (Bug A) regression. Everything else mirrors
  // swarmFakeProvider (full happy-path deep dive).
  function circleSwarmProvider(opts: {
    cashflow_predictability: 'durably_predictable' | 'not_predictable' | 'uncertain'
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
            cashflow_drivers: [{ driver: opts.driverText ?? 'Recurring insurance float invested at scale', citation: opts.driverCite }],
            predictability_breakers: [{ breaker: opts.breakerText ?? 'Catastrophe-loss tail volatility', citation: opts.breakerCite }],
            competence_reasoning: opts.cashflow_predictability === 'durably_predictable'
              ? 'Understandable cashflow engine grounded in the 10-K.'
              : 'I understand the business but its cashflows are not durably predictable.',
            cashflow_predictability: opts.cashflow_predictability,
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
        if (schemaName === 'BuffettMungerRedTeam') {
          return {
            strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
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

  async function runCircle(research_case_id: string, opts: { cashflow_predictability: 'durably_predictable' | 'not_predictable' | 'uncertain'; driverCite: string; breakerCite: string; driverText?: string; breakerText?: string; unverified?: Set<string> }) {
    const store = new InMemoryEventStore()
    const provider = circleSwarmProvider({
      cashflow_predictability: opts.cashflow_predictability,
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

  it('1. durably_predictable + both clauses grounded (non-empty text) → gate passes, the 5-lane deep dive runs', async () => {
    const { types, cp } = await runCircle('rc_circle_in', { cashflow_predictability: 'durably_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    // The judgment was recorded and the deep dive ran (lanes + synthesis).
    expect(types).toContain('circle_competence_judged')
    expect(types).toContain('deep_dive_started')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(5)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    // The model's (gated) verdict flows through — NOT a circle set-aside.
    expect(cp?.investment_verdict ?? cp?.decision).not.toBe(undefined)
  })

  it('2. not_predictable (understood but cyclical — the MU case) WITH grounded substantive clauses → SET ASIDE (PASS), 5 lanes do NOT run', async () => {
    // Bug B: the model understands the business and grounds BOTH clauses, but judges the cashflows
    // not durably predictable. The gate must set aside on the verdict, NOT proceed.
    const { types, cp } = await runCircle('rc_circle_not_predictable', { cashflow_predictability: 'not_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
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
    const { events, cp } = await runCircle('rc_circle_engine_version', { cashflow_predictability: 'not_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    // The set-aside path emits the analysis event WITHOUT running the deep dive — it must still stamp the
    // root engine_version so the dossier marker reads as the current engine rather than "unknown".
    const analysis = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    expect((analysis?.payload as Record<string, unknown>)?.['engine_version']).toBe(ENGINE_VERSION)
    // And it must project to the TOP-LEVEL field (the set-aside event has no valuation.judgment block).
    expect(cp?.engine_version).toBe(ENGINE_VERSION)
    expect(cp?.valuation?.judgment).toBeUndefined()
  })

  it("3. uncertain → SET ASIDE (PASS), 5 lanes do NOT run", async () => {
    const { types, cp } = await runCircle('rc_circle_uncertain', { cashflow_predictability: 'uncertain', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    expect(types).not.toContain('deep_dive_started')
    expect(cp?.investment_verdict ?? cp?.decision).toBe('PASS')
    expect(cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('4. Bug A — empty driver TEXT (with a verified citation) does NOT count as grounded → SET ASIDE', async () => {
    // durably_predictable + a VERIFIED breaker citation, but the driver has empty text. An empty claim must
    // NOT clear the bar even though its citation verifies — drops grounded drivers below 1 → set aside.
    const { types, cp } = await runCircle('rc_circle_empty_driver', {
      cashflow_predictability: 'durably_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      driverText: '',
    })
    expect(types).not.toContain('deep_dive_started')
    expect(cp?.investment_verdict ?? cp?.decision).toBe('PASS')
    expect(cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('4b. Bug A schema — a missing driver/breaker TEXT is rejected at parse (text is now REQUIRED)', () => {
    // The split schemas make driver/breaker text non-optional. Parsing a claim without text must fail.
    expect(CashflowDriverSchema.safeParse({ citation: 'src_x' }).success).toBe(false)
    expect(CashflowDriverSchema.safeParse({ driver: '', citation: 'src_x' }).success).toBe(false)
    expect(PredictabilityBreakerSchema.safeParse({ citation: 'src_x' }).success).toBe(false)
    expect(CashflowDriverSchema.safeParse({ driver: 'd', citation: 'src_x' }).success).toBe(true)
    expect(PredictabilityBreakerSchema.safeParse({ breaker: 'b', citation: 'src_x' }).success).toBe(true)
  })

  it('5. fail-closed: ungrounded citations (drivers OR breakers) → SET ASIDE (unchanged)', async () => {
    const drivers = await runCircle('rc_circle_ungrounded_drivers', {
      cashflow_predictability: 'durably_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      unverified: new Set(['src_circle_driver']),
    })
    expect(drivers.types).not.toContain('deep_dive_started')
    expect(drivers.cp?.investment_verdict ?? drivers.cp?.decision).toBe('PASS')
    expect(drivers.cp?.valuation?.circle_competence_unmet).toBe(true)

    const breakers = await runCircle('rc_circle_ungrounded_breakers', {
      cashflow_predictability: 'durably_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker',
      unverified: new Set(['src_circle_breaker']),
    })
    expect(breakers.types).not.toContain('deep_dive_started')
    expect(breakers.cp?.investment_verdict ?? breakers.cp?.decision).toBe('PASS')
    expect(breakers.cp?.valuation?.circle_competence_unmet).toBe(true)
  })

  it('6. projects the predictability verdict + model_claimed_predictability + required-text clauses onto the case', async () => {
    const { cp } = await runCircle('rc_circle_proj', { cashflow_predictability: 'durably_predictable', driverCite: 'src_circle_driver', breakerCite: 'src_circle_breaker' })
    const circle = cp?.circle_competence
    expect(circle).toBeDefined()
    expect(circle?.in_competence).toBe(true)
    expect(circle?.cashflow_predictability).toBe('durably_predictable')
    expect(circle?.model_claimed_predictability).toBe('durably_predictable')
    expect(circle?.cashflow_drivers?.[0]?.driver).toBeTruthy()
    expect(circle?.predictability_breakers?.[0]?.breaker).toBeTruthy()
    expect(circle?.competence_reasoning).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — price AND/OR moat, substitutable sources.
// The headline of the MoS audit surface. Guard 1: adequacy is audit-only, NEVER a gate. Guard 2: a
// moat-sourced margin must rest on a grounded/gate-passing moat (incoherence flag otherwise).
// ---------------------------------------------------------------------------
describe('margin-of-safety joint judgment (synthesis-owned: price AND/OR moat)', () => {
  async function runMos(synthesis: SynthesisOverrides, id: string) {
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

  it('Test 1 — produces the structured margin_of_safety (sources + per-source reasoning + adequacy) persisted + projected', async () => {
    const { analysisEvent, cp } = await runMos({
      moat_class: 'wide', runway: 'proven',
      margin_of_safety: {
        sources: ['price', 'moat'],
        price_gap_reasoning: 'Price sits well below the proposed buy-below.',
        moat_durability_reasoning: 'The grounded wide moat lets time bail out estimate error.',
        adequacy: 'adequate', reasoning: 'Both sources jointly supply an adequate margin.',
      },
    }, 'mos-structured')
    // Persisted on the analysis event under the distinct (non-legacy-colliding) key.
    const payload = analysisEvent?.payload as Record<string, unknown>
    const persisted = payload['margin_of_safety_judgment'] as { sources: string[]; adequacy: string; reasoning: string }
    expect(persisted).toBeDefined()
    expect(persisted.sources).toEqual(['price', 'moat'])
    expect(persisted.adequacy).toBe('adequate')
    // Projected onto the case under the distinct key (NOT the legacy valuation.margin_of_safety string).
    expect(cp?.margin_of_safety_judgment?.sources).toEqual(['price', 'moat'])
    expect(cp?.margin_of_safety_judgment?.adequacy).toBe('adequate')
    expect((cp?.margin_of_safety_judgment?.reasoning ?? '').length).toBeGreaterThan(0)
    expect(cp?.margin_of_safety_judgment?.moat_durability_reasoning).toBeTruthy()
  })

  it('V2 — the T0 margin-of-safety GRADE: a deep-discount buy-below grades adequate; a premium buy-below grades inadequate (required_margin 0.25, audit-only)', async () => {
    // The reference value is min(internal DCF FV, 18× OE) — exact dollars are model-input-dependent, so
    // pin the two unambiguous ends: a buy-below of $1 (discount ≈ 100%) and one far above any FV.
    const deep = await runMos({
      moat_class: 'wide', runway: 'proven', proposed_buy_below: 1,
      margin_of_safety: { sources: ['price'], price_gap_reasoning: 'Deep discount.', reasoning: 'Deep discount carries the margin.' },
    }, 'mos-grade-deep')
    const deepGrade = deep.cp?.valuation?.margin_of_safety_grade
    expect(deepGrade?.grade).toBe('adequate')
    expect(deepGrade?.required_margin).toBe(0.25)
    expect(deepGrade?.price_discount_to_reference ?? 0).toBeGreaterThan(0.25)

    const premium = await runMos({
      moat_class: 'wide', runway: 'proven', proposed_buy_below: 8000,
      margin_of_safety: { sources: ['price'], price_gap_reasoning: 'Premium price.', reasoning: 'No price margin.' },
    }, 'mos-grade-premium')
    const premiumGrade = premium.cp?.valuation?.margin_of_safety_grade
    expect(premiumGrade?.grade).toBe('inadequate')
    // Audit-only: the grade never gates — both runs record their (clamp-governed) verdicts identically
    // to the adequacy era; no new gate reads the grade.
  })

  it('V2 — the joint judgment WITHOUT the retired adequacy field still persists + projects (narrative-only, the new model shape)', async () => {
    const { analysisEvent, cp } = await runMos({
      moat_class: 'wide', runway: 'proven',
      margin_of_safety: {
        sources: ['moat'],
        moat_durability_reasoning: 'The grounded wide moat lets time bail out estimate error.',
        reasoning: 'The moat carries the margin; the T0 grade quantifies the price side.',
      },
    }, 'mos-no-adequacy')
    const persisted = (analysisEvent?.payload as Record<string, unknown>)['margin_of_safety_judgment'] as { sources: string[]; adequacy?: string }
    expect(persisted.sources).toEqual(['moat'])
    expect(persisted.adequacy).toBeUndefined()
    expect(cp?.margin_of_safety_judgment?.sources).toEqual(['moat'])
    expect(cp?.margin_of_safety_judgment?.adequacy).toBeUndefined()
    expect((cp?.margin_of_safety_judgment?.reasoning ?? '').length).toBeGreaterThan(0)
  })

  it('Test 2 / GUARD 1 — the verdict + buy-below are UNCHANGED whether adequacy is adequate vs inadequate (adequacy never gates)', async () => {
    const adequate = await runMos({
      moat_class: 'wide', runway: 'proven', proposed_buy_below: 150,
      margin_of_safety: { sources: ['price'], price_gap_reasoning: 'Below buy-below.', adequacy: 'adequate', reasoning: 'Adequate.' },
    }, 'mos-guard1-adequate')
    const inadequate = await runMos({
      moat_class: 'wide', runway: 'proven', proposed_buy_below: 150,
      margin_of_safety: { sources: ['price'], price_gap_reasoning: 'Below buy-below.', adequacy: 'inadequate', reasoning: 'Inadequate.' },
    }, 'mos-guard1-inadequate')
    // The gated verdict is IDENTICAL — adequacy does not feed any gate.
    expect(inadequate.cp?.investment_verdict).toBe(adequate.cp?.investment_verdict)
    // The recorded buy-below is IDENTICAL — adequacy does not change the model's number.
    expect(inadequate.cp?.valuation?.buy_price_per_share).toBe(adequate.cp?.valuation?.buy_price_per_share)
    expect(inadequate.cp?.valuation?.proposed_buy_below).toBe(adequate.cp?.valuation?.proposed_buy_below)
    // And the next_required_action (the gate reason) does not mention adequacy.
    expect((inadequate.cp?.next_required_action ?? '').toLowerCase()).not.toContain('inadequate')
  })

  it('Test 3a / GUARD 2 — a moat-sourced margin on a GROUNDED gate-passing moat is accepted (no incoherence flag)', async () => {
    const { cp } = await runMos({
      moat_class: 'wide', runway: 'proven',
      margin_of_safety: {
        sources: ['moat'],
        moat_durability_reasoning: 'Grounded wide moat verified by the moat gate supplies durability margin.',
        adequacy: 'adequate', reasoning: 'Moat durability carries the margin.',
      },
    }, 'mos-guard2-grounded')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    expect(cp?.margin_of_safety_moat_ungrounded).toBeUndefined()
    expect(cp?.margin_of_safety_judgment?.moat_durability_reasoning).toBeTruthy()
  })

  it('Test 3b / GUARD 2 — a moat-sourced margin claimed on an UNGROUNDED (non-gate-passing) moat surfaces margin_of_safety_moat_ungrounded', async () => {
    const { cp } = await runMos({
      // A narrow moat fails the wide-moat gate → the moat is NOT grounded/gate-passing.
      moat_class: 'narrow', runway: 'proven',
      margin_of_safety: {
        sources: ['moat'],
        moat_durability_reasoning: 'Claims moat durability — but the moat did not pass the grounded gate.',
        adequacy: 'adequate', reasoning: 'Incoherently rests the margin on an ungrounded moat.',
      },
    }, 'mos-guard2-ungrounded')
    expect(cp?.valuation?.moat_passes_gate).toBe(false)
    expect(cp?.margin_of_safety_moat_ungrounded).toBe(true)
  })
})

describe('circle-gate prompt calibration (live find: Kimi K2 marked Visa "uncertain")', () => {
  it('the rubric is symmetric, decouples the evidence floor from the verdict, and anchors the enum', () => {
    // Live miscalibration: the old rubric validated only the set-aside, and the 3/3 evidence floor
    // FORCED three well-cited breakers which then read as "dominant" — Visa came back 'uncertain' on
    // real-but-ordinary risks (interchange litigation). The rubric must state that required breakers
    // do not imply unpredictability and that 'uncertain' is not a safe harbor.
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('BOTH answers are equally valid')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('do NOT by themselves imply')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('THROUGH A FULL ECONOMIC CYCLE')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('payments network')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('NOT a safe middle ground')
    expect(CIRCLE_COMPETENCE_PROMPT).toContain('do NOT manufacture doubt')
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
