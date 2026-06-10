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
        runway: 'proven',
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
        runway: 'proven',
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
            runway: 'proven',
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
        investment_verdict: opts.investmentVerdict ?? 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'Await margin of safety.', decision_reason: 'Quality but pricey',
        thesis_summary: 'Quality compounder', evidence_summary: 'Covered',
        valuation_rationale: 'Elevated', shariah_rationale: 'No prohibited activities',
        synthesis_summary: 'All lanes reviewed', risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        moat_class: opts.synthesis?.moat_class ?? 'wide',
        runway: opts.synthesis?.runway ?? 'proven',
        ...(opts.synthesis?.runway_exceptional !== undefined ? { runway_exceptional: opts.synthesis.runway_exceptional } : {}),
        growth_assumptions: 'Two-stage DCF; credited g banded by incremental ROIC and runway.',
        owner_earnings_bridge: opts.synthesis?.owner_earnings_bridge ?? baseBridge,
        roic: opts.synthesis?.roic ?? 0.30,
        incremental_roic: opts.synthesis?.incremental_roic ?? 0.20,
        reinvestment_rate: opts.synthesis?.reinvestment_rate ?? 0.43,
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
function swarmFakeProviderWithShariah(impermissible_income: number, sector_status: 'compliant' | 'conditional' | 'non_compliant' = 'conditional') {
  let callCount = 0
  const src = (id: string) => ({ source_id: id, title: 'T', url: 'https://example.com/src', excerpt: 'e' })
  return {
    provider_id: 'fake-swarm-shariah',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async (_req: unknown) => {
      const call = callCount++
      if (call === 0) {
        return {
          summary: 's', business_quality: 'b', moat: 'm', management_capital_allocation: 'mc',
          financial_quality: 'fq', valuation_sanity: 'vs', shariah_status: 'CONDITIONAL',
          red_flags: ['None'], confidence: 'high', caveats: ['c'],
          screening_result: 'deep_dive_candidate', proposed_sources: [src('src_qs_1')],
        }
      }
      if (call >= 1 && call <= 7) {
        return { finding_summary: `Lane ${call}`, confidence: 'medium', caveats: ['c'], proposed_sources: [src(`src_lane_${call}`)] }
      }
      return {
        investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', valuation_status: 'EXPENSIVE',
        next_required_action: 'Await MoS.', decision_reason: 'Quality but pricey', thesis_summary: 'Compounder',
        evidence_summary: 'Covered', valuation_rationale: 'Elevated', shariah_rationale: 'Trace interest income',
        synthesis_summary: 'Reviewed', risks: ['Valuation'], open_questions: ['MoS'],
        moat_class: 'wide', runway: 'proven',
        growth_assumptions: 'Two-stage DCF; banded g.',
        // Model proposes a NORMALIZED net income equal to EDGAR reported NI (delta 0), tier '80', and
        // a maintenance_capex value the harness IGNORES in favour of min(D&A, capex × 0.80).
        owner_earnings_bridge: {
          net_income: 8099, depreciation_amortization: 999, maintenance_capex: 1,
          maintenance_capex_proxy_tier: '80', stock_based_comp: 1,
          normalized_working_capital_change: 0, shares_outstanding: 1,
        },
        roic: 0.30, incremental_roic: 0.20, reinvestment_rate: 0.43,
        shariah: { sector_status, impermissible_income },
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
})
