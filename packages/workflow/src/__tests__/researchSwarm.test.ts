import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { runGroundedAgent, ProposedSourcesSchema, runLaneSwarm, runStrategyResearchSwarm, ResearchSwarmStageError, type GroundFn } from '../researchSwarm'
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
function swarmFakeProvider() {
  let callCount = 0
  const src = (id: string) => ({
    source_id: id,
    title: 'Test source',
    url: 'https://example.com/src',
    excerpt: 'Test excerpt',
  })
  return {
    provider_id: 'fake-swarm',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (_req: unknown) => {
      const call = callCount++
      if (call === 0) {
        // Quick screen
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
      // Lane agent calls (7 lanes)
      if (call >= 1 && call <= 7) {
        return {
          finding_summary: `Lane ${call} finding`,
          confidence: 'medium',
          caveats: ['Mock lane caveat'],
          proposed_sources: [src(`src_lane_${call}`)],
        }
      }
      // Synthesis + decision (call 8)
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
        moat_class: 'wide',
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
        reinvestment_rate: 0.40,
        proposed_sources: [src('src_dec_1')],
      }
    }),
  }
}

// Fake provider where each lane agent call encodes the lane name in its proposed source_id.
// This allows the ground function to single out a specific lane (e.g., 'moat') and return
// verified_ids: [] for that lane's sources to exercise the C1 partial-lane skip path.
function swarmFakeProviderWithLaneIds(lanes: readonly string[]) {
  let callCount = 0
  const src = (id: string) => ({
    source_id: id,
    title: 'Test source',
    url: 'https://example.com/src',
    excerpt: 'Test excerpt',
  })
  return {
    provider_id: 'fake-swarm-partial',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (_req: unknown) => {
      const call = callCount++
      if (call === 0) {
        // Quick screen — source id does not contain any lane name
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
      // Lane agent calls — source id encodes the lane name so ground can filter by lane
      const laneIndex = call - 1
      if (laneIndex >= 0 && laneIndex < lanes.length) {
        const lane = lanes[laneIndex] ?? `lane_${laneIndex}`
        return {
          finding_summary: `${lane} lane finding`,
          confidence: 'medium' as const,
          caveats: ['Mock lane caveat'],
          proposed_sources: [src(`src_${lane}_1`)],
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
        moat_class: 'wide',
        growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
        owner_earnings_bridge: {
          net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
          maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.20,
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
      let callCount = 0
      const src = (id: string) => ({
        source_id: id,
        title: 'Test source',
        url: 'https://example.com/src',
        excerpt: 'Test excerpt',
      })
      return {
        provider_id: 'fake-swarm-good-bad',
        capabilities: {} as never,
        complete: vi.fn(),
        runWithTools: vi.fn(),
        structured: vi.fn(async (_req: unknown) => {
          const call = callCount++
          if (call === 0) {
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
          // Lane agent calls (7 lanes)
          if (call >= 1 && call <= 7) {
            return {
              finding_summary: `Lane ${call} finding`,
              confidence: 'medium',
              caveats: ['Mock lane caveat'],
              proposed_sources: [src(`src_lane${call}_good_1`), src(`src_lane${call}_bad_1`)],
            }
          }
          // Synthesis + decision (call 8)
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
            moat_class: 'wide',
            growth_assumptions: 'Steady growth; ROIC 20% > 10% discount; terminal g=3%.',
            owner_earnings_bridge: {
              net_income: 18, depreciation_amortization: 4, maintenance_capex: 3,
              maintenance_capex_proxy_tier: '50', stock_based_comp: 2,
              normalized_working_capital_change: 0, shares_outstanding: 1,
            },
            roic: 0.20,
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

  it('projects moat_class, discount_rate, roic, reinvestment_rate, OE bridge, fair_value, MoS, and buy_price from the analysis event (Design B)', async () => {
    // MockProvider emits monopoly moat with bridge TOTALS in $millions:
    //   NI=14000, D&A=4000, maint=3000, SBC=2000, dNWC=-1000 → OE_total = 14000 ($M)
    //   shares_outstanding=1000 (M) → OE/sh = 14000/1000 = 14
    //   roic=0.25, reinvestment_rate=0.40
    // Harness computes:
    //   discount=0.10, g=min(0.40*0.25, 0.03)=0.03, fair=min(14/(0.10-0.03), 20*14)=min(200,280)=200
    //   MoS(monopoly)=0.10, buy=round(200*0.90,2)=180
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
    // harness-computed OE/sh from bridge totals: (14000+4000-3000-2000-(-1000))/1000 = 14000/1000 = 14
    expect(caseProjection?.valuation?.normalized_owner_earnings_per_share).toBe(14)
    // roic from mock: 0.25
    expect(caseProjection?.valuation?.roic).toBe(0.25)
    // reinvestment_rate from mock: 0.40
    expect(caseProjection?.valuation?.reinvestment_rate).toBe(0.40)
    // g = min(0.40*0.25, 0.03) = 0.03
    expect(caseProjection?.valuation?.growth_rate).toBe(0.03)
    // fair_value = min(14/(0.10-0.03), 20*14) = min(200, 280) = 200
    expect(caseProjection?.valuation?.fair_value_per_share).toBeCloseTo(200, 5)
    // margin_of_safety (monopoly): 0.10
    expect(caseProjection?.valuation?.margin_of_safety).toBe(0.10)
    // buy_price = round(200 * 0.90, 2) = 180
    expect(caseProjection?.valuation?.buy_price_per_share).toBe(180)
    // value_basis
    expect(caseProjection?.valuation?.value_basis).toBe('equity_bond')
    // owner_earnings_bridge projected (totals in $millions + shares_outstanding in millions)
    expect(caseProjection?.valuation?.owner_earnings_bridge).toBeDefined()
    expect(caseProjection?.valuation?.owner_earnings_bridge?.net_income).toBe(14000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.normalized_working_capital_change).toBe(-1000)
    expect(caseProjection?.valuation?.owner_earnings_bridge?.shares_outstanding).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// Configurable swarm fake provider for the valuation-units + resilience bug tests.
// stageBehaviors lets a test inject a custom synthesis bridge or force failures per stage.
// ---------------------------------------------------------------------------
type SynthesisOverrides = Partial<{
  moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  roic: number
  reinvestment_rate: number
  owner_earnings_bridge: Record<string, number | string>
}>

function configurableSwarmProvider(opts: {
  laneCount: number
  synthesis?: SynthesisOverrides
  // Per-stage failure injection: returns the number of times to throw before succeeding.
  failQuickScreen?: number
  failSynthesis?: number
}) {
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://example.com/src', excerpt: 'e' })
  let laneCall = 0
  let qsFails = opts.failQuickScreen ?? 0
  let synthFails = opts.failSynthesis ?? 0
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
      // synthesis/decision (BuffettMungerSynthesisDecision)
      if (synthFails > 0) { synthFails--; throw new Error('Codex CLI timed out') }
      return {
        investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'Await margin of safety.', decision_reason: 'Quality but pricey',
        thesis_summary: 'Quality compounder', evidence_summary: 'Covered',
        valuation_rationale: 'Elevated', shariah_rationale: 'No prohibited activities',
        synthesis_summary: 'All lanes reviewed', risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        moat_class: opts.synthesis?.moat_class ?? 'wide',
        growth_assumptions: 'ROIC>discount; terminal g capped at 3%.',
        owner_earnings_bridge: opts.synthesis?.owner_earnings_bridge ?? baseBridge,
        roic: opts.synthesis?.roic ?? 0.30,
        reinvestment_rate: opts.synthesis?.reinvestment_rate ?? 0.10,
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
  it('divides total owner earnings by shares_outstanding (COST inputs: OE/sh ≈ $19, fair ≈ $272, buy ≈ $190)', async () => {
    // Captured COST inputs: NI 8838, D&A 2565, maint_capex 2052, SBC 911, dNWC 0 ($M),
    // shares_outstanding 443 (M), discount 0.10, ROIC>discount → g capped at 0.03, moat wide → MoS 0.30.
    //   OE_total = 8838 + 2565 - 2052 - 911 - 0 = 8440 ($M)
    //   OE/sh    = 8440 / 443 ≈ 19.05
    //   capitalized = 19.05 / (0.10 - 0.03) ≈ 272.16 ; ceiling = 20 * 19.05 ≈ 381 → fair = min = 272.16
    //   buy = round(272.16 * 0.70, 2) ≈ 190.51
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
    expect(cp?.valuation?.fair_value_per_share).toBeCloseTo(272.16, 0)
    expect(cp?.valuation?.buy_price_per_share).toBeCloseTo(190.51, 0)
    // Sanity: must NOT be the buggy ~100x value
    expect(cp?.valuation?.fair_value_per_share ?? 0).toBeLessThan(1000)
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
