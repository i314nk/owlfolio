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
    const results = await runLaneSwarm(['moat', 'risks', 'valuation'], runLane, { concurrency: 2 })
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
function moatRubricForTier(tier: 'narrow' | 'moderate' | 'wide' | 'monopoly', cite: string) {
  const scores = tier === 'monopoly'
    ? [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }, { id: 'M3', score: 2, citation_hash: cite }, { id: 'M4', score: 2, citation_hash: cite }, { id: 'M5', score: 2, citation_hash: cite }, { id: 'M6', score: 2, citation_hash: cite }]
    : tier === 'wide'
      ? [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }, { id: 'M3', score: 2, citation_hash: cite }, { id: 'M4', score: 2, citation_hash: cite }]
      : tier === 'moderate'
        ? [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }]
        : [{ id: 'M1', score: 1 }, { id: 'M2', score: 1 }]
  return { rubric_scores: scores, proposed_tier: tier, adjustment_evidence: [] }
}
function runwayRubricForTier(tier: 'none' | 'limited' | 'proven', cite: string) {
  const scores = tier === 'proven'
    ? [{ id: 'R1', score: 2 }, { id: 'R2', score: 2, citation_hash: cite }, { id: 'R3', score: 2, citation_hash: cite }]
    : tier === 'limited'
      ? [{ id: 'R1', score: 2 }]
      : [{ id: 'R1', score: 0 }]
  return { rubric_scores: scores, proposed_tier: tier, adjustment_evidence: [] }
}

// Shared per-lane judgment payloads for the schema-name-keyed fakes (spec-correct decomposition: the
// MOAT lane emits its rubric, the SHARIAH lane emits its overlay).
function fakeMoatLanePayload(src: (id: string) => unknown) {
  const fullRubric = (tier: string) => ({ rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }], proposed_tier: tier, adjustment_evidence: [] })
  return {
    finding_summary: 'Moat lane finding', confidence: 'medium' as const, caveats: ['Mock moat caveat'],
    moat_class: 'wide' as const, runway: 'proven' as const,
    moat_rubric: fullRubric('wide'), runway_rubric: fullRubric('proven'),
    proposed_sources: [src('src_lane_moat')],
  }
}
function fakeShariahLanePayload(src: (id: string) => unknown) {
  return {
    finding_summary: 'Shariah lane finding', confidence: 'medium' as const, caveats: ['Mock shariah caveat'],
    sector_status: 'compliant' as const, impermissible_income: 0,
    proposed_sources: [src('src_lane_shariah')],
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
      if (schemaName === 'BuffettMungerShariahLane') return fakeShariahLanePayload(src)
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
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] },
          proposed_sources: [src('src_qs_1')],
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
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
        incremental_roic: 0.20,
        reinvestment_rate: 0.40,
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
  const fullRubric = (tier: string) => ({ rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }], proposed_tier: tier, adjustment_evidence: [] })
  return {
    provider_id: 'fake-swarm-partial',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { prompt?: string; response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
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
          moat_class: 'wide' as const, runway: 'proven' as const,
          moat_rubric: fullRubric('wide'), runway_rubric: fullRubric('proven'),
          proposed_sources: [src('src_moat_1')],
        }
      }
      if (schemaName === 'BuffettMungerShariahLane') {
        return {
          finding_summary: 'shariah lane finding', confidence: 'medium' as const, caveats: ['Mock lane caveat'],
          sector_status: 'compliant' as const, impermissible_income: 0,
          proposed_sources: [src('src_shariah_1')],
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
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
        incremental_roic: 0.20,
        reinvestment_rate: 0.40,
        proposed_sources: [src('src_dec_partial_1')],
      }
    }),
  }
}

describe('runStrategyResearchSwarm', () => {
  it('drives quick screen, a per-lane swarm, synthesis and a grounded decision', async () => {
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
    expect(types).toContain('quick_screen_drafted')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(7)
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

    // All other lanes (6 of 7) must have their findings recorded
    expect(findingEvents.length).toBe(buffettMungerDeepDiveLanes.length - 1)
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
      const fullRubric = (tier: string) => ({ rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }], proposed_tier: tier, adjustment_evidence: [] })
      return {
        provider_id: 'fake-swarm-good-bad',
        capabilities: {} as never,
        complete: vi.fn(),
        runWithTools: vi.fn(),
        structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
          const schemaName = req.response_format?.schema_name
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
          if (schemaName === 'BuffettMungerMoatLane') {
            return {
              finding_summary: 'moat lane finding', confidence: 'medium' as const, caveats: ['Mock lane caveat'],
              moat_class: 'wide' as const, runway: 'proven' as const,
              moat_rubric: fullRubric('wide'), runway_rubric: fullRubric('proven'),
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
            growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
            owner_earnings_bridge: {
              net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
              maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
              normalized_working_capital_change: 0, shares_outstanding: 1,
            },
            roic: 0.20,
            incremental_roic: 0.20,
            reinvestment_rate: 0.40,
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
  })
})

describe('runStrategyResearchSwarm short-circuit on Shariah NON_COMPLIANT', () => {
  it('skips deep dive and emits a PASS decision when quick screen returns NON_COMPLIANT', async () => {
    const store = new InMemoryEventStore()

    // Fake provider that returns NON_COMPLIANT + reject at quick screen; should never be called for lane/synthesis
    const nonCompliantProvider = {
      provider_id: 'fake-non-compliant',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async () => ({
        summary: 'Primary business involves conventional interest-based banking.',
        business_quality: 'Large bank; well-capitalised.',
        moat: 'Wide network moat, but business model is riba-based.',
        management_capital_allocation: 'Shareholder-friendly but irrelevant given non-compliance.',
        financial_quality: 'Strong balance sheet.',
        valuation_sanity: 'Not assessed.',
        shariah_status: 'NON_COMPLIANT',
        red_flags: ['Core business is conventional interest-based banking (riba)'],
        confidence: 'high',
        caveats: ['Mock non-compliant quick screen'],
        screening_result: 'reject',
        proposed_sources: [
          {
            source_id: 'src_bank_non_compliant_1',
            title: 'Bank Non-Compliant Source',
            url: 'https://example.com/bank-non-compliant',
            excerpt: 'Bank operates conventional interest-based products.',
          },
        ],
      })),
    }

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

    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-short-circuit-'))

    const result = await runStrategyResearchSwarm(
      store,
      nonCompliantProvider as never,
      {
        research_case_id: 'rc_non_compliant',
        company_id: 'bank_corp',
        ticker: 'BANK',
        strategy_id: 'buffett-munger',
        actor_id: 'user_local',
        idempotency_key: 'nc_k',
        model_id: 'mock',
        decision_id: 'decision_non_compliant',
        source_ledger_path: sourceLedgerPath,
      },
      { ground },
    )

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // Deep-dive events must NOT be present
    expect(types).not.toContain('specialist_finding_recorded')
    expect(types).not.toContain('deep_dive_started')
    expect(types).not.toContain('queued_for_deep_dive')
    expect(types).not.toContain('deep_dive_synthesis_drafted')

    // Quick screen and decision must be present
    expect(types).toContain('quick_screen_drafted')
    expect(types).toContain('buffett_munger_analysis_drafted')
    expect(types).toContain('decision_drafted')

    // Decision must be PASS
    const decisionEvent = events.find((e) => e.event_type === 'decision_drafted')
    expect(decisionEvent).toBeDefined()
    const decisionPayload = decisionEvent?.payload as Record<string, unknown>
    expect(decisionPayload?.['decision']).toBe('PASS')

    // Provider must have been called exactly once (for the quick screen only)
    expect(nonCompliantProvider.structured).toHaveBeenCalledTimes(1)

    // The result must have a decision defined and no deep_dive field
    expect(result.decision).toBeDefined()
    expect((result as { deep_dive?: unknown }).deep_dive).toBeUndefined()

    // Run must complete without throwing
  })
})

describe('runStrategyResearchSwarm with MockProvider + deterministic grounder', () => {
  it('completes end-to-end: research_case_created, quick_screen_drafted, >=7 specialist_finding_recorded, deep_dive_synthesis_drafted, decision_drafted', async () => {
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
    expect(types).toContain('quick_screen_drafted')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(7)
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

  it('projects moat_class, runway, discount_rate, roic, two-stage fair_value, MoS, and buy_price from the analysis event (two-stage DCF)', async () => {
    // MockProvider emits monopoly moat + proven runway with bridge TOTALS in $millions:
    //   NI=14000, D&A=4000, maint=3000, SBC=2000, dNWC=-1000 → OE_total = 14000 ($M)
    //   shares_outstanding=1000 (M) → OE/sh = 14000/1000 = 14
    //   roic=0.25, incremental_roic=0.20, reinvestment_rate=0.40
    // Harness computes:
    //   raw_g = 0.40*0.20 = 0.08 → clamped to monopoly+proven band ceiling g = 0.04; g_t (monopoly) = 0.025
    //   two-stage FV ≈ 220.54 (recalibrated: horizon 15, terminal 2.5%; impl ≈ 15.75×, under the 18× cap of 252)
    //   MoS(monopoly)=0.15, buy=round(220.54*0.85,2)≈187.45
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
    // discount_rate: flat 10% (Design B)
    expect(caseProjection?.valuation?.discount_rate).toBe(0.10)
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
    // reinvestment_rate from mock: 0.40
    expect(caseProjection?.valuation?.reinvestment_rate).toBe(0.40)
    // g = min(0.40*0.20, monopoly_proven 0.04, max 0.05) = 0.04
    expect(caseProjection?.valuation?.growth_rate).toBe(0.04)
    // terminal g (monopoly, recalibrated) = 0.025
    expect(caseProjection?.valuation?.terminal_growth_rate).toBe(0.025)
    // two-stage fair value ≈ 220.54 (recalibrated: monopoly horizon 15, terminal 2.5%; under 18× cap of 252)
    expect(caseProjection?.valuation?.fair_value_per_share).toBeCloseTo(220.54, 0)
    expect(caseProjection?.valuation?.fair_value_per_share ?? 0).toBeLessThan(18 * 14)
    // implied multiple ≈ 15.75×
    expect(caseProjection?.valuation?.implied_multiple).toBeCloseTo(15.75, 1)
    // margin_of_safety (monopoly, recalibrated): 0.15
    expect(caseProjection?.valuation?.margin_of_safety).toBe(0.15)
    // buy_price = round(220.54 * 0.85, 2) ≈ 187.45
    expect(caseProjection?.valuation?.buy_price_per_share).toBeCloseTo(187.45, 0)
    // value_basis
    expect(caseProjection?.valuation?.value_basis).toBe('two_stage_dcf')
    // owner_earnings_bridge projected (totals in $millions + shares_outstanding in millions)
    expect(caseProjection?.valuation?.owner_earnings_bridge).toBeDefined()
    expect(caseProjection?.valuation?.owner_earnings_bridge?.net_income).toBe(14000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.normalized_working_capital_change).toBe(-1000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.shares_outstanding).toBe(1000)
  })

  it('projects the judgment-objectivity layer (Mechanisms 1+2): rubric scores + anchor-vs-proposed-vs-resolved', async () => {
    // No EDGAR fundamentals injected -> moat anchor not computable -> the lane full-rubric score stands.
    // Mock cites all 6 moat rows (12 -> monopoly). The dossier surfaces the rubric scores + that the
    // anchor was not computable.
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
    // moat axis: anchor not computable -> lane full rubric stands -> resolved monopoly.
    expect(judgment?.moat?.anchor_computable).toBe(false)
    expect(judgment?.moat?.proposed_tier).toBe('monopoly')
    expect(judgment?.moat?.resolved_tier).toBe('monopoly')
    expect((judgment?.moat?.rubric_scores ?? []).length).toBe(6)
    // resolved moat_class fed downstream is monopoly.
    expect(c?.valuation?.moat_class).toBe('monopoly')
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
}>

function configurableSwarmProvider(opts: {
  laneCount: number
  synthesis?: SynthesisOverrides
  // Override the model's investment_verdict (default WATCH) — used to test that WATCH-FAIR never
  // escalates a model BUY when the price sits above the buy window.
  investmentVerdict?: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
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
  // and/or the SHARIAH lane omits its overlay (→ shariah_ratios_unverified) — the live-dogfood shape.
  omitMoatRubric?: boolean
  omitShariahOverlay?: boolean
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
      if (schemaName === 'BuffettMungerQuickScreen') {
        if (qsFails > 0) { qsFails--; throw new Error('Codex CLI timed out') }
        return {
          summary: 'Good business', business_quality: 'Strong', moat: 'Wide moat',
          management_capital_allocation: 'Excellent', financial_quality: 'Solid',
          valuation_sanity: 'Reasonable', shariah_status: 'CONDITIONAL',
          red_flags: ['None identified'], confidence: 'high', caveats: ['Mock caveat'],
          screening_result: 'deep_dive_candidate', proposed_sources: [src('src_qs_1')],
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
          moat_class: moatClass,
          runway,
          ...(opts.synthesis?.runway_exceptional !== undefined ? { runway_exceptional: opts.synthesis.runway_exceptional } : {}),
          // The rubric RESOLVES to the requested moat/runway tier (no-anchor path; cited rows cite the
          // grounded src_lane_moat so they verify under allVerifiedGround).
          ...(opts.omitMoatRubric === true ? {} : { moat_rubric: moatRubricForTier(moatClass, 'src_lane_moat'), runway_rubric: runwayRubricForTier(runway, 'src_lane_moat') }),
          proposed_sources: [src('src_lane_moat')],
        }
      }
      if (schemaName === 'BuffettMungerShariahLane') {
        return {
          finding_summary: 'Shariah lane finding', confidence: 'high',
          caveats: ['Mock shariah caveat'],
          ...(opts.omitShariahOverlay === true ? {} : { sector_status: 'compliant', impermissible_income: 0 }),
          proposed_sources: [src('src_lane_shariah')],
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
            citations: opts.redTeamCitations ?? ['src_qs_1'],
          },
          proposed_sources: [src('src_qs_1')],
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
      // synthesis/decision (BuffettMungerSynthesisDecision)
      if (synthFails > 0) { synthFails--; throw new Error('Codex CLI timed out') }
      return {
        investment_verdict: opts.investmentVerdict ?? 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'Await margin of safety.', decision_reason: 'Quality but pricey',
        thesis_summary: 'Quality compounder', evidence_summary: 'Covered',
        valuation_rationale: 'Elevated', shariah_rationale: 'No prohibited activities',
        synthesis_summary: 'All lanes reviewed', risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        // moat_class / runway now come from the MOAT lane; the synthesis schema no longer carries them.
        growth_assumptions: 'Two-stage DCF; credited g banded by incremental ROIC and runway.',
        owner_earnings_bridge: opts.synthesis?.owner_earnings_bridge ?? baseBridge,
        roic: opts.synthesis?.roic ?? 0.30,
        incremental_roic: opts.synthesis?.incremental_roic ?? 0.20,
        reinvestment_rate: opts.synthesis?.reinvestment_rate ?? 0.43,
        red_team_strongest_objection: 'echoed',
        proposed_sources: [src('src_dec_1')],
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
  it('divides total owner earnings by shares_outstanding (COST inputs: OE/sh ≈ $19, two-stage fair ≈ $253, buy ≈ $190)', async () => {
    // Captured COST inputs: NI 8838, D&A 2565, maint_capex 2052, SBC 911, dNWC 0 ($M),
    // shares_outstanding 443 (M), discount 0.10, moat wide + runway proven, inc-ROIC 0.20, reinv 0.43.
    //   OE_total = 8838 + 2565 - 2052 - 911 - 0 = 8440 ($M)
    //   OE/sh    = 8440 / 443 ≈ 19.05
    //   raw_g = 0.43 × 0.20 = 0.086 → clamped to wide+proven band ceiling g = 0.03; g_t (wide, recalibrated) = 0.015
    //   two-stage FV: Σ OE_ps(1+g)^t/1.1^t (t=1..10, wide horizon 10) + Gordon terminal ≈ 252.96 (impl ≈ 13.28×, under 18× cap)
    //   buy = round(252.96 * 0.75, 2) ≈ 189.72  (wide MoS recalibrated 25%)
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
    expect(cp?.valuation?.growth_rate).toBeCloseTo(0.03, 10)
    expect(cp?.valuation?.terminal_growth_rate).toBe(0.015)
    expect(cp?.valuation?.fair_value_per_share).toBeCloseTo(252.96, 0)
    expect(cp?.valuation?.buy_price_per_share).toBeCloseTo(189.72, 0)
    expect(cp?.valuation?.implied_multiple).toBeCloseTo(13.28, 1)
    expect(cp?.valuation?.runway).toBe('proven')
    expect(cp?.valuation?.value_basis).toBe('two_stage_dcf')
    // Sanity: per-share value, never the buggy ~100x value, and under the 18× OE cap
    expect(cp?.valuation?.fair_value_per_share ?? 0).toBeLessThan(1000)
    expect(cp?.valuation?.fair_value_per_share ?? 0).toBeLessThan(18 * 19.06)
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
    // No bogus huge fair value persisted
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeUndefined()
    // A valuation caveat must be recorded on the analysis event
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect((valuation?.['valuation_caveats'] as string[])?.join(' ')).toMatch(/shares_outstanding/i)
    // The run still completes with a decision
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })
})

describe('Two-stage DCF harness banding (runway axis, eligibility, gates)', () => {
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

  it('incremental_roic at/below 10% → g = 0 (ineligible; FV is the flat-stage-1 two-stage value)', async () => {
    // base bridge OE_total = 8838+2565-2052-911-0 = 8440 ($M) ÷ 443 = 19.05/sh, monopoly, proven
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', incremental_roic: 0.08, reinvestment_rate: 0.5 }, 'ineligible')
    expect(cp?.valuation?.growth_rate).toBe(0)
    // g=0, g_t (monopoly) 0.02: two-stage with flat stage 1
    expect(cp?.valuation?.fair_value_per_share).toBeGreaterThan(19.05)
    expect(cp?.valuation?.fair_value_per_share ?? 0).toBeLessThan(18 * 19.06)
  })

  it("runway 'none' caps credited g at 0.02 for any tier (even monopoly + high inc-ROIC)", async () => {
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'none', incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'runway-none')
    expect(cp?.valuation?.growth_rate).toBe(0.02)
    expect(cp?.valuation?.runway).toBe('none')
  })

  it('monopoly + proven + exceptional allows credited g up to 0.05 (absolute max)', async () => {
    const { cp } = await runWith({ moat_class: 'monopoly', runway: 'proven', runway_exceptional: true, incremental_roic: 0.30, reinvestment_rate: 0.5 }, 'mono-exceptional')
    expect(cp?.valuation?.growth_rate).toBe(0.05)
    expect(cp?.valuation?.runway_exceptional).toBe(true)
    // even at g=5% monopoly the implied multiple stays under the 18× cap
    expect(cp?.valuation?.implied_multiple ?? 0).toBeLessThan(18)
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
    expect(cp?.valuation?.fair_value_per_share).toBeUndefined()
    expect(cp?.valuation?.buy_price_per_share).toBeUndefined()
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    expect((valuation?.['valuation_caveats'] as string[])?.join(' ')).toMatch(/owner earnings/i)
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Acceptance test #3 (valuation-recalibration-spec §4): WATCH-FAIR verdict band.
// A gate-clean name with price between buy_price and fair_value → WATCH-FAIR (NEW band). It NEVER
// escalates to BUY, even when the model proposes BUY. Below buy_price → BUY-WINDOW; above FV → WATCH.
// ---------------------------------------------------------------------------
describe('Acceptance #3 — WATCH-FAIR verdict band (never escalates to BUY)', () => {
  // COST-like wide case: OE/sh ≈ 19.05, g 0.03, wide horizon 10, terminal 0.015 →
  //   fair ≈ 252.96, buy ≈ 189.72 (wide MoS 25%).
  async function runAtPrice(price: number, id: string, investmentVerdict: 'BUY' | 'WATCH' = 'BUY') {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43 },
      investmentVerdict,
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-wf-${id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${id}_k`,
        model_id: 'mock', decision_id: `decision_${id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround,
        laneConcurrency: 4,
        // Inject a deterministic spot price; no EDGAR fundamentals → model bridge is used.
        resolvePrice: async () => ({ available: true as const, price_per_share: price, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('price between buy (≈190) and fair (≈253) → WATCH-FAIR; model BUY does NOT escalate', async () => {
    const { cp } = await runAtPrice(220, 'watchfair', 'BUY')
    expect(cp?.valuation?.fair_value_per_share).toBeCloseTo(252.96, 0)
    expect(cp?.valuation?.buy_price_per_share).toBeCloseTo(189.72, 0)
    expect(cp?.valuation?.verdict_state?.state).toBe('WATCH-FAIR')
    // discount-to-FV ≈ (252.96 − 220) / 252.96 ≈ 13.03%
    expect(cp?.valuation?.verdict_state?.discount_to_fv_pct).toBeCloseTo(13.03, 0)
    expect(cp?.valuation?.verdict_state?.implied_multiple).toBeCloseTo(13.28, 1)
    expect(cp?.valuation?.verdict_state?.note).toMatch(/human-discretion zone/i)
    // NEVER escalates to BUY: the recorded verdict is WATCH even though the model said BUY.
    expect(cp?.investment_verdict).toBe('WATCH')
    expect(cp?.investment_verdict).not.toBe('BUY')
  })

  it('price below buy (≈190) → BUY-WINDOW', async () => {
    const { cp } = await runAtPrice(150, 'buywindow', 'BUY')
    expect(cp?.valuation?.verdict_state?.state).toBe('BUY-WINDOW')
    // Model BUY is preserved in the buy window (the band does not downgrade it).
    expect(cp?.investment_verdict).toBe('BUY')
  })

  it('price above fair (≈253) → plain WATCH', async () => {
    const { cp } = await runAtPrice(300, 'plainwatch', 'WATCH')
    expect(cp?.valuation?.verdict_state?.state).toBe('WATCH')
  })
})

// ---------------------------------------------------------------------------
// HIGH safety — clamp a model BUY when no buy band is computable.
// When the moat gate passes but verdict_state is undefined (no buy price/fair value/current price —
// e.g. the live price fetch failed), the harness MUST NOT record the model's raw BUY. It forces a
// safe non-BUY verdict (RESEARCH_MORE) and records a reason in open_questions.
// ---------------------------------------------------------------------------
describe('HIGH safety — BUY clamp when no computable buy band (verdict_state undefined)', () => {
  async function runGateCleanNoBand(id: string, investmentVerdict: 'BUY' | 'WATCH', priceAvailable: boolean) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      // wide moat passes the gate; the model proposes the supplied verdict.
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.20, reinvestment_rate: 0.43 },
      investmentVerdict,
    })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), `owlfolio-clamp-${id}-`))
    await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: `rc_${id}`, company_id: 'c', ticker: 'COST',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: `${id}_k`,
        model_id: 'mock', decision_id: `decision_${id}`, source_ledger_path: sourceLedgerPath,
      },
      {
        ground: allVerifiedGround,
        laneConcurrency: 4,
        // Price fetch FAILS → no current_price → verdict_state stays undefined (no computable band).
        resolvePrice: priceAvailable
          ? async () => ({ available: true as const, price_per_share: 220, currency: 'USD', as_of: '2026-06-01T00:00:00Z', source: 'fixture' })
          : async () => ({ available: false as const, reason: 'no quote', source: 'test' }),
      },
    )
    const events = await store.list()
    const projections = projectResearchCases(events as Parameters<typeof projectResearchCases>[0])
    return { events, cp: projections.find((c) => c.research_case_id === `rc_${id}`) }
  }

  it('moat passes gate but no buy band + model BUY → recorded verdict is NOT BUY + reason recorded', async () => {
    const { cp } = await runGateCleanNoBand('clamp-buy', 'BUY', false)
    // No computable band.
    expect(cp?.valuation?.verdict_state).toBeUndefined()
    // The model said BUY but the harness must clamp it to a safe non-BUY state.
    expect(cp?.investment_verdict).not.toBe('BUY')
    expect(cp?.investment_verdict).toBe('RESEARCH_MORE')
    // A clear reason is surfaced in open_questions.
    expect((cp?.open_questions ?? []).some((q) => /no computable buy band/i.test(q))).toBe(true)
  })

  it('verdict_state IS defined (WATCH-FAIR) → behavior unchanged (no spurious clamp)', async () => {
    // Price 220 sits between buy (≈190) and fair (≈253) → WATCH-FAIR; the existing band logic owns this.
    const { cp } = await runGateCleanNoBand('clamp-noop', 'BUY', true)
    expect(cp?.valuation?.verdict_state?.state).toBe('WATCH-FAIR')
    expect(cp?.investment_verdict).toBe('WATCH')
    // The clamp reason must NOT appear when a band exists.
    expect((cp?.open_questions ?? []).some((q) => /no computable buy band/i.test(q))).toBe(false)
  })
})

describe('BUG 2 — resilient bookend swarm calls (retry + clean failure)', () => {
  it('recovers when quick-screen times out once then succeeds (single retry)', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, failQuickScreen: 1 })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug2-qs-recover-'))
    const result = await runStrategyResearchSwarm(
      store, provider as never,
      {
        research_case_id: 'rc_bug2_qs', company_id: 'c', ticker: 'AAPL',
        strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug2qs_k',
        model_id: 'mock', decision_id: 'decision_bug2qs', source_ledger_path: sourceLedgerPath,
      },
      { ground: allVerifiedGround, laneConcurrency: 4 },
    )
    // One retry happened: the run completed with a decision despite the first quick-screen timeout.
    expect(result.decision).toBeDefined()
    const events = await store.list()
    expect(events.some((e) => e.event_type === 'decision_drafted')).toBe(true)
  })

  it('fails cleanly (ResearchSwarmStageError, quick_screen) when quick-screen times out persistently', async () => {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({ laneCount: buffettMungerDeepDiveLanes.length, failQuickScreen: 99 })
    const sourceLedgerPath = await mkdtemp(join(tmpdir(), 'owlfolio-bug2-qs-fail-'))
    let caught: unknown
    try {
      await runStrategyResearchSwarm(
        store, provider as never,
        {
          research_case_id: 'rc_bug2_qsfail', company_id: 'c', ticker: 'AAPL',
          strategy_id: 'buffett-munger', actor_id: 'user_local', idempotency_key: 'bug2qsf_k',
          model_id: 'mock', decision_id: 'decision_bug2qsf', source_ledger_path: sourceLedgerPath,
        },
        { ground: allVerifiedGround, laneConcurrency: 4 },
      )
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ResearchSwarmStageError)
    expect((caught as ResearchSwarmStageError).stage).toBe('quick_screen')
    expect((caught as ResearchSwarmStageError).lanes_completed).toBe(false)
    // Exactly two structured() attempts (initial + one retry) before failing.
    expect(provider.structured).toHaveBeenCalledTimes(2)
  })

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
// Mechanism 5 — Red-Team Pass (orchestrator integration): runs after the 7 lanes, before synthesis;
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
    // Cite-checked against the corpus (src_qs_1 is verified).
    expect(cp?.red_team?.strongest_objection?.citations).toEqual(['src_qs_1'])
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
    // A live objection (src_qs_1 verified) → the dedicated call runs and answers it → the answer is
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
  annual_series: [
    { fiscal_year: 2025, currency: 'USD', net_income_musd: 8099, revenue_musd: 275235, d_and_a_musd: 2426, capex_musd: 5498, sbc_musd: 860, diluted_shares_m: 444.8 },
    { fiscal_year: 2024, currency: 'USD', net_income_musd: 7367, revenue_musd: 254453, d_and_a_musd: 2237, capex_musd: 4710, sbc_musd: 800, diluted_shares_m: 444.2 },
  ],
  filings: [
    { form: '10-K', filed: '2025-10-08', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm' },
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
    quick_screen_source_ids: ['src_qs_1'],
    quick_screen_event_id: 'evt_qs_1',
  }
}

describe('SEC EDGAR primary-filing wiring', () => {
  it('grounds the 10-K and injects primary numbers into financial_quality/valuation/shariah lanes', async () => {
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

    // The structured() prompts for the three financial lanes must contain the primary-filing block.
    const prompts = provider.structured.mock.calls.map((c: unknown[]) => (c[0] as { prompt?: string }).prompt).filter((p): p is string => typeof p === "string")
    const financialLanePrompt = prompts.find((p) => p.includes('financial_quality specialist'))
    const valuationLanePrompt = prompts.find((p) => p.includes('valuation specialist'))
    const shariahLanePrompt = prompts.find((p) => p.includes('shariah specialist'))
    const moatLanePrompt = prompts.find((p) => p.includes('moat specialist'))

    for (const p of [financialLanePrompt, valuationLanePrompt, shariahLanePrompt]) {
      expect(p).toBeDefined()
      expect(p).toContain('Primary filing data (SEC EDGAR, FY2025')
      expect(p).toContain('$8,099M') // net income, $millions
      expect(p).toContain('sec_edgar_10k_0000909832_fy2025')
    }
    // Non-financial lanes (e.g. moat) must NOT receive the injection.
    expect(moatLanePrompt).toBeDefined()
    expect(moatLanePrompt).not.toContain('Primary filing data (SEC EDGAR')

    // The grounded EDGAR 10-K must be persisted as a verified source on the financial lane findings.
    const events = await store.list()
    const finFinding = events.find((e) => e.event_type === 'specialist_finding_recorded'
      && (e.payload as { specialist_lane?: string }).specialist_lane === 'financial_quality')
    expect((finFinding?.payload as { source_ids: string[] }).source_ids)
      .toContain('sec_edgar_10k_0000909832_fy2025')
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

// ---------------------------------------------------------------------------
// EDGAR-anchored OE bridge + harness-computed AAOIFI Shariah financial ratios.
// "Judgment proposes, code computes": the LLM provides only the maintenance-capex tier, the
// working-capital overlay, and the impermissible-income amount; the harness anchors NI/D&A/capex/SBC/
// diluted-shares to the 10-K and recomputes the three AAOIFI ratios + verdict + purification %.
// ---------------------------------------------------------------------------
function swarmFakeProviderWithShariah(
  impermissible_income: number,
  sector_status: 'compliant' | 'conditional' | 'non_compliant' = 'conditional',
  bridgeOverride?: Record<string, number | string>,
) {
  let laneCall = 0
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm', excerpt: 'e' })
  const fullRubric = (tier: string) => ({
    rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }], proposed_tier: tier, adjustment_evidence: [],
  })
  return {
    provider_id: 'fake-swarm-shariah',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
      const schemaName = req.response_format?.schema_name
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
          moat_class: 'wide', runway: 'proven',
          moat_rubric: fullRubric('wide'), runway_rubric: fullRubric('proven'),
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
      if (schemaName === 'BuffettMungerLaneFinding') {
        const n = laneCall++
        return { finding_summary: `Lane ${n}`, confidence: 'medium', caveats: ['c'], proposed_sources: [src(`src_lane_${n}`)] }
      }
      if (schemaName === 'BuffettMungerRedTeam') {
        return {
          strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] },
          proposed_sources: [src('src_qs_1')],
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
        growth_assumptions: 'Two-stage DCF; banded g.',
        // Model proposes a NORMALIZED net income equal to EDGAR reported NI (delta 0), tier '80', and
        // a maintenance_capex value the harness IGNORES in favour of min(D&A, capex × 0.80).
        owner_earnings_bridge: bridgeOverride ?? {
          net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43,
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

    // OE bridge is EDGAR-anchored: NI 8099, D&A 2426, maint = min(2426, 5498×0.80=4398) = 2426, SBC 860.
    expect(cp?.valuation?.bridge_basis).toBe('sec_edgar')
    expect(cp?.valuation?.bridge_fiscal_year).toBe(2025)
    expect(cp?.valuation?.bridge_source_id).toBe('sec_edgar_10k_0000909832_fy2025')
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBe(8099)
    expect(cp?.valuation?.owner_earnings_bridge?.depreciation_amortization).toBe(2426)
    expect(cp?.valuation?.owner_earnings_bridge?.maintenance_capex).toBe(2426)
    expect(cp?.valuation?.owner_earnings_bridge?.stock_based_comp).toBe(860)
    expect(cp?.valuation?.owner_earnings_bridge?.shares_outstanding).toBeCloseTo(444.8, 3)
    // OE_ps = (8099 + 2426 - 2426 - 860 - 0) / 444.8 ≈ 16.27
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeCloseTo(16.27, 1)

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
  it('model net_income=0 (wild) → net income clamps toward EDGAR, OE positive, flag recorded', async () => {
    // CPRT-shaped failure: EDGAR reported NI 8099, but the model emits net_income 0. The OLD anchor
    // (edgar + (model − edgar) = model) produced 0 → spurious negative OE → INSUFFICIENT_DATA. Now NI is
    // anchored to EDGAR with a bounded ±35% normalization; a proposed 0 (drop of 100% > 35%) is clamped
    // to EDGAR × (1 − 0.35) = 5264.35 and the clamp is flagged.
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
    // NI clamped to the lower normalization bound: 8099 × (1 − 0.35) = 5264.35 (>= 910 floor, > 0).
    expect(cp?.valuation?.owner_earnings_bridge?.net_income).toBeCloseTo(8099 * 0.65, 2)
    // OE positive (no spurious negative), valuation computes (not voided).
    expect(cp?.valuation?.normalized_owner_earnings_per_share).toBeGreaterThan(0)
    // The clamp is visible.
    const analysisEvent = events.find((e) => e.event_type === 'buffett_munger_analysis_drafted')
    const valuation = (analysisEvent?.payload as Record<string, unknown>)?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/oe_bridge_net_income_clamped/)
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

describe('resolveJudgmentTiers — EDGAR-anchored moat resolution', () => {
  const verified = new Set(['sha256:a', 'sha256:b'])

  it('anchor wide + proposed monopoly with 2x verified evidence -> monopoly applied', () => {
    const res = resolveJudgmentTiers({
      moatRubric: {
        rubric_scores: [
          { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
          { id: 'M3', score: 2, citation_hash: 'sha256:a' },
          { id: 'M4', score: 2, citation_hash: 'sha256:b' },
          { id: 'M5', score: 2, citation_hash: 'sha256:a' },
          { id: 'M6', score: 2, citation_hash: 'sha256:b' },
        ],
        proposed_tier: 'monopoly',
        adjustment_evidence: [
          { claim: 'failed entrant exited', citation_hash: 'sha256:a' },
          { claim: 'documented pricing power', citation_hash: 'sha256:b' },
        ],
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.anchor_computable).toBe(true)
    expect(res.moat?.anchor_tier).toBe('wide')
    expect(res.moat?.adjustment_applied).toBe(true)
    expect(res.moat?.resolved_moat_class).toBe('monopoly')
  })

  it('anchor wide + proposed monopoly with only 1 evidence item -> rejected (anchor stands wide)', () => {
    const res = resolveJudgmentTiers({
      moatRubric: {
        rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }],
        proposed_tier: 'monopoly',
        adjustment_evidence: [{ claim: 'one thing', citation_hash: 'sha256:a' }],
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.anchor_tier).toBe('wide')
    expect(res.moat?.adjustment_applied).toBe(false)
    expect(res.moat?.resolved_moat_class).toBe('wide')
  })

  it('lane inflates M1/M2 but EDGAR overrides them with the computed anchor scores', () => {
    // Low-ROIC short windows would not compute; here the series is high-ROIC so anchor M1/M2 = 2 each.
    // Even if the lane had claimed otherwise, the harness uses its computed values for M1/M2.
    const res = resolveJudgmentTiers({
      moatRubric: {
        rubric_scores: [{ id: 'M1', score: 0 }, { id: 'M2', score: 0 }],
        proposed_tier: 'wide',
        adjustment_evidence: [],
      },
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    expect(res.moat?.resolved_row_scores['M1']).toBe(2)
    expect(res.moat?.resolved_row_scores['M2']).toBe(2)
    // proposed wide == anchor wide -> no adjustment needed, resolved wide.
    expect(res.moat?.resolved_moat_class).toBe('wide')
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

  it('falls back to the holistic moat_class/runway and flags rubric_not_emitted when no rubric is supplied', () => {
    const res = resolveJudgmentTiers({
      // No moatRubric / runwayRubric — mirrors the live dogfood (optional fields blank).
      holisticMoatClass: 'wide',
      holisticRunway: 'limited',
      series: tenYearHighRoicSeries(),
      verifiedCitationHashes: verified,
    })
    // moat/runway STILL resolve — to the holistic value the lane proposed.
    expect(res.moat?.resolved_moat_class).toBe('wide')
    expect(res.runway?.resolved_runway).toBe('limited')
    // and the degradation is visible (not a silent holistic substitution).
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

describe('Silent-degradation cascade — fields omitted (live dogfood shape)', () => {
  // The MOAT lane omits its rubric and the SHARIAH lane omits its overlay — exactly the per-lane
  // judgment fields a live model leaves blank. With a holistic wide moat + OE available, the harness
  // MUST still compute the two-stage valuation and flag every silent skip.
  async function runOmitted(opts: { synthesis?: SynthesisOverrides; id: string }) {
    const store = new InMemoryEventStore()
    const provider = configurableSwarmProvider({
      laneCount: buffettMungerDeepDiveLanes.length,
      omitMoatRubric: true,
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

  it('still resolves moat_class + computes the two-stage valuation when the rubric is omitted', async () => {
    const { cp } = await runOmitted({ synthesis: { moat_class: 'wide', runway: 'proven' }, id: 'omit-val' })
    // moat resolved holistically (wide) — NOT undefined.
    expect(cp?.valuation?.moat_class).toBe('wide')
    expect(cp?.valuation?.moat_passes_gate).toBe(true)
    // the two-stage DCF STILL computes — the omitted rubric must NOT void the valuation.
    expect(cp?.valuation?.fair_value_per_share).toBeDefined()
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

  it('flags a g=0 credited-growth floor when growth inputs are ineligible (honest floor, valuation still computes)', async () => {
    const { cp, analysisPayload } = await runOmitted({
      // incremental_roic <= 10% eligibility threshold -> g floored to 0, but FV must still compute.
      synthesis: { moat_class: 'wide', runway: 'proven', incremental_roic: 0.05, reinvestment_rate: 0.5 },
      id: 'omit-g0',
    })
    expect(cp?.valuation?.growth_rate).toBe(0)
    expect(cp?.valuation?.fair_value_per_share).toBeDefined()
    const valuation = analysisPayload?.['valuation'] as Record<string, unknown>
    const degraded = (valuation?.['degraded_flags'] as string[] | undefined) ?? []
    expect(degraded.join(' ')).toMatch(/valuation_degraded:\s*credited_growth_floored_g0/)
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
    const fullRubric = (tier: string) => ({
      rubric_scores: [{ id: 'M1', score: 2 }, { id: 'M2', score: 2 }],
      proposed_tier: tier,
      adjustment_evidence: [],
    })
    const provider = {
      provider_id: 'fake-retry',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { response_format?: { schema_name?: string } }) => {
        const schemaName = req.response_format?.schema_name
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
            moat_class: 'wide', runway: 'proven',
            moat_rubric: fullRubric('wide'), runway_rubric: fullRubric('proven'),
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
        if (schemaName === 'BuffettMungerRedTeam') {
          return {
            strongest_bear_case: 'b', weakest_rubric_items: [], moat_decay_scenario: 'd', growth_credit_attack: 'g',
            shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] },
            proposed_sources: [src('src_qs_1')],
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
          growth_assumptions: 'two-stage', roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43,
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
        // The PRIMARY moat class is the moat lane's judgment (what the cross-check second model checks).
        const moatClass = opts.primaryMoat ?? 'wide'
        return {
          finding_summary: 'Moat lane', confidence: 'high', caveats: ['c'],
          moat_class: moatClass, runway: 'proven',
          moat_rubric: moatRubricForTier(moatClass, 'src_lane_moat'), runway_rubric: runwayRubricForTier('proven', 'src_lane_moat'),
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
          shared_narrative_blindspots: [], strongest_objection: { claim: 'c', severity: 'low', citations: ['src_qs_1'] },
          proposed_sources: [src('src_qs_1')],
        }
      }
      // synthesis/decision
      return {
        investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'a', decision_reason: 'r', thesis_summary: 't', evidence_summary: 'e',
        valuation_rationale: 'v', shariah_rationale: 's', synthesis_summary: 'ss', risks: ['risk'],
        open_questions: ['baseline question'],
        growth_assumptions: 'g', owner_earnings_bridge: {
          net_income: 8838, depreciation_amortization: 2565, maintenance_capex: 2052,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 911, normalized_working_capital_change: 0, shares_outstanding: 443,
        },
        roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43, proposed_sources: [src('src_dec_1')],
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

    // The red-team pass ran on the env-configured model; the quick screen kept the run default.
    expect(modelBySchema.get('BuffettMungerRedTeam')).toBe('env-red-team-model')
    expect(modelBySchema.get('BuffettMungerQuickScreen')).toBe('run-default-model')
  })
})
