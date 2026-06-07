import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectResearchCaseTimeline } from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import {
  buffettMungerDeepDiveLanes,
  completeDeepDive,
  defaultResearchStrategyRef,
  draftDeepDiveSynthesis,
  draftQuickScreen,
  draftStrategyDecision,
  queueDeepDive,
  recordSpecialistFinding,
  runDeterministicDeepDiveSwarm,
  startDeepDive,
} from '../strategyResearchPipeline'
import { createResearchCase } from '../researchWorkflow'
import { confirmWatchlistDraft, approveWatchlistDraft } from '../watchlistWorkflow'
import { openHoldingFromWatchlist } from '../holdingWorkflow'

describe('strategy-agnostic research pipeline foundation', () => {
  it('records neutral strategy-scoped stages with source ids through decision pending', async () => {
    const store = new InMemoryEventStore()
    const selectedStrategy = { strategy_id: 'quality-growth', strategy_version: '2026.06' }

    const discovered = await createResearchCase(store, {
      research_case_id: 'rc_msft_strategy_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: selectedStrategy.strategy_id,
      strategy_version: selectedStrategy.strategy_version,
      actor_id: 'user_local',
    })
    const quickScreen = await draftQuickScreen(store, {
      research_case_id: discovered.research_case_id,
      quick_screen_id: 'quick_msft_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      ...selectedStrategy,
      screening_result: 'deep_dive_candidate',
      summary: 'Initial source review supports a deeper strategy-specific diligence pass.',
      business_quality: 'Initial quality evidence supports deeper strategy-specific review.',
      moat: 'Moat evidence is plausible enough for a specialist review.',
      management_capital_allocation: 'Capital allocation needs deeper review.',
      financial_quality: 'Financial quality appears sufficient for quick screen.',
      valuation_sanity: 'Valuation needs a dedicated margin-of-safety pass.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'medium',
      caveats: ['Quick screen only'],
      source_ids: ['src_msft_10k_2025'],
      actor_id: 'mock-provider',
      idempotency_key: 'quick-screen:rc_msft_strategy_001:v1',
    })
    const queued = await queueDeepDive(store, {
      research_case_id: discovered.research_case_id,
      queue_id: 'queue_msft_001',
      candidate_id: 'candidate_msft_001',
      ...selectedStrategy,
      source_ids: ['src_msft_10k_2025'],
      causation_id: quickScreen.event_id,
      actor_id: 'system',
    })
    const started = await startDeepDive(store, {
      research_case_id: discovered.research_case_id,
      deep_dive_id: 'deep_msft_001',
      candidate_id: 'candidate_msft_001',
      ...selectedStrategy,
      specialist_lanes: ['moat', 'financial_quality'],
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
      causation_id: queued.event_id,
      actor_id: 'worker_research',
    })
    const finding = await recordSpecialistFinding(store, {
      research_case_id: discovered.research_case_id,
      finding_id: 'finding_msft_moat_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_msft_001',
      specialist_lane: 'moat',
      ...selectedStrategy,
      finding_summary: 'Durability evidence is positive but requires valuation synthesis before a decision.',
      confidence: 'medium',
      caveats: ['Only one transcript reviewed'],
      provider_run_id: 'provider_run_msft_moat_001',
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
      causation_id: started.event_id,
      actor_id: 'mock-provider',
    })
    const synthesis = await draftDeepDiveSynthesis(store, {
      research_case_id: discovered.research_case_id,
      synthesis_id: 'synthesis_msft_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_msft_001',
      ...selectedStrategy,
      synthesis_summary: 'Specialist findings are sufficient for a strategy decision draft.',
      confidence: 'medium',
      caveats: ['Synthesis is a draft pending user decision review'],
      provider_run_id: 'provider_run_msft_synthesis_001',
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
      specialist_finding_ids: [finding.finding_id],
      causation_id: finding.event_id,
      actor_id: 'system',
    })
    const completed = await completeDeepDive(store, {
      research_case_id: discovered.research_case_id,
      deep_dive_id: started.deep_dive_id,
      completion_id: 'complete_msft_001',
      candidate_id: 'candidate_msft_001',
      ...selectedStrategy,
      synthesis_id: synthesis.synthesis_id,
      confidence: 'medium',
      caveats: ['Ready for a strategy decision draft, not an automatic buy/sell action'],
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
      causation_id: synthesis.event_id,
      actor_id: 'system',
    })
    const decision = await draftStrategyDecision(store, {
      research_case_id: discovered.research_case_id,
      decision_id: 'strategy_decision_msft_001',
      ...selectedStrategy,
      decision: 'WATCH',
      decision_summary: 'Put on watchlist pending margin-of-safety evidence.',
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
      causation_id: completed.event_id,
      actor_id: 'system',
    })

    expect(discovered.strategy_version).toBe('2026.06')
    expect(quickScreen).toMatchObject({
      event_type: 'quick_screen_drafted',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      source_ids: ['src_msft_10k_2025'],
      payload: expect.objectContaining({ source_ids: ['src_msft_10k_2025'] }),
    })
    expect(decision).toMatchObject({
      event_type: 'strategy_decision_drafted',
      decision: 'WATCH',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      source_ids: ['src_msft_10k_2025', 'src_msft_transcript_2025_q4'],
    })
    expect(queued).toMatchObject({
      event_type: 'queued_for_deep_dive',
      candidate_id: 'candidate_msft_001',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
    })
    expect(started).toMatchObject({
      event_type: 'deep_dive_started',
      candidate_id: 'candidate_msft_001',
      specialist_lanes: ['moat', 'financial_quality'],
    })
    expect(finding).toMatchObject({
      event_type: 'specialist_finding_recorded',
      candidate_id: 'candidate_msft_001',
      specialist_lane: 'moat',
      confidence: 'medium',
      caveats: ['Only one transcript reviewed'],
      provider_run_id: 'provider_run_msft_moat_001',
    })
    expect(synthesis).toMatchObject({
      event_type: 'deep_dive_synthesis_drafted',
      candidate_id: 'candidate_msft_001',
      confidence: 'medium',
      caveats: ['Synthesis is a draft pending user decision review'],
      provider_run_id: 'provider_run_msft_synthesis_001',
    })
    expect(completed).toMatchObject({
      event_type: 'deep_dive_completed',
      candidate_id: 'candidate_msft_001',
      synthesis_id: 'synthesis_msft_001',
      confidence: 'medium',
      caveats: ['Ready for a strategy decision draft, not an automatic buy/sell action'],
    })

    const events = await store.list()
    expect(events.map((event) => event.event_type)).toEqual([
      'research_case_created',
      'quick_screen_drafted',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
      'deep_dive_completed',
      'strategy_decision_drafted',
    ])
    expect(projectResearchCases(events)).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_msft_strategy_001',
        stage: 'decision_pending',
        strategy_id: 'quality-growth',
        strategy_version: '2026.06',
        decision_id: 'strategy_decision_msft_001',
        decision: 'WATCH',
      }),
    ])
    expect(projectResearchCaseTimeline(events, discovered.research_case_id).map((entry) => entry.summary)).toEqual([
      'Discovered research case for MSFT using strategy quality-growth@2026.06',
      'Quick screen drafted: deep_dive_candidate',
      'Queued for deep dive',
      'Deep dive started for 2 specialists',
      'Specialist finding recorded: moat',
      'Deep dive synthesis drafted',
      'Deep dive completed',
      'Strategy decision drafted: WATCH',
    ])
  })

  it('rejects out-of-order deep-dive transitions before appending events', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_deep_order_001',
      company_id: 'company_deep_order',
      ticker: 'ORDR',
      ...defaultResearchStrategyRef,
      actor_id: 'user_local',
    })
    const quickScreen = await draftQuickScreen(store, {
      research_case_id: 'rc_deep_order_001',
      quick_screen_id: 'quick_deep_order_001',
      company_id: 'company_deep_order',
      ticker: 'ORDR',
      ...defaultResearchStrategyRef,
      screening_result: 'deep_dive_candidate',
      summary: 'Candidate clears quick screen for order validation.',
      business_quality: 'Enough evidence to test order validation.',
      moat: 'Moat needs deep dive.',
      management_capital_allocation: 'Management needs deep dive.',
      financial_quality: 'Financial quality needs deep dive.',
      valuation_sanity: 'Valuation needs deep dive.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'medium',
      caveats: ['Order validation only'],
      source_ids: ['src_order_001'],
      actor_id: 'mock-provider',
    })

    await expect(startDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      deep_dive_id: 'deep_order_001',
      ...defaultResearchStrategyRef,
      specialist_lanes: ['moat'],
      source_ids: ['src_order_001'],
      causation_id: quickScreen.event_id,
      actor_id: 'worker_research',
    })).rejects.toThrow('queued deep-dive event')

    const queued = await queueDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      queue_id: 'queue_order_001',
      candidate_id: 'candidate_order_001',
      ...defaultResearchStrategyRef,
      source_ids: ['src_order_001'],
      causation_id: quickScreen.event_id,
      actor_id: 'system',
    })
    await expect(startDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      deep_dive_id: 'deep_order_001',
      ...defaultResearchStrategyRef,
      specialist_lanes: ['moat'],
      source_ids: ['src_order_001'],
      causation_id: queued.event_id,
      actor_id: 'worker_research',
    })).rejects.toThrow('candidate id')

    const started = await startDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      deep_dive_id: 'deep_order_001',
      candidate_id: 'candidate_order_001',
      ...defaultResearchStrategyRef,
      specialist_lanes: ['moat'],
      source_ids: ['src_order_001'],
      causation_id: queued.event_id,
      actor_id: 'worker_research',
    })
    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_deep_order_001',
        stage: 'deep_dive_started',
        candidate_id: 'candidate_order_001',
        deep_dive_id: 'deep_order_001',
      }),
    ])

    await expect(recordSpecialistFinding(store, {
      research_case_id: 'rc_deep_order_001',
      finding_id: 'finding_order_wrong_lane_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      specialist_lane: 'valuation',
      ...defaultResearchStrategyRef,
      finding_summary: 'This lane was not part of the started deep dive.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: started.event_id,
      actor_id: 'mock-provider',
    })).rejects.toThrow('started specialist lane')
    await expect(recordSpecialistFinding(store, {
      research_case_id: 'rc_deep_order_001',
      finding_id: 'finding_order_missing_candidate_001',
      deep_dive_id: started.deep_dive_id,
      specialist_lane: 'moat',
      ...defaultResearchStrategyRef,
      finding_summary: 'This omits required candidate lineage.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: started.event_id,
      actor_id: 'mock-provider',
    })).rejects.toThrow('candidate id')

    const finding = await recordSpecialistFinding(store, {
      research_case_id: 'rc_deep_order_001',
      finding_id: 'finding_order_moat_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      specialist_lane: 'moat',
      ...defaultResearchStrategyRef,
      finding_summary: 'Moat lane completed.',
      confidence: 'medium',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: started.event_id,
      actor_id: 'mock-provider',
    })
    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_deep_order_001',
        stage: 'specialist_finding_recorded',
        candidate_id: 'candidate_order_001',
        specialist_findings: [expect.objectContaining({
          finding_id: 'finding_order_moat_001',
          specialist_lane: 'moat',
          confidence: 'medium',
        })],
      }),
    ])

    await expect(draftDeepDiveSynthesis(store, {
      research_case_id: 'rc_deep_order_001',
      synthesis_id: 'synthesis_order_invalid_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      ...defaultResearchStrategyRef,
      synthesis_summary: 'This references a missing finding.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      specialist_finding_ids: ['finding_order_missing_001'],
      causation_id: finding.event_id,
      actor_id: 'system',
    })).rejects.toThrow('causative specialist finding')
    await expect(draftDeepDiveSynthesis(store, {
      research_case_id: 'rc_deep_order_001',
      synthesis_id: 'synthesis_order_wrong_causation_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      ...defaultResearchStrategyRef,
      synthesis_summary: 'This uses the wrong causation event.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      specialist_finding_ids: [finding.finding_id],
      causation_id: started.event_id,
      actor_id: 'system',
    })).rejects.toThrow('causative specialist finding')
    await expect(draftDeepDiveSynthesis(store, {
      research_case_id: 'rc_deep_order_001',
      synthesis_id: 'synthesis_order_missing_candidate_001',
      deep_dive_id: started.deep_dive_id,
      ...defaultResearchStrategyRef,
      synthesis_summary: 'This omits required candidate lineage.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      specialist_finding_ids: [finding.finding_id],
      causation_id: finding.event_id,
      actor_id: 'system',
    })).rejects.toThrow('candidate id')

    const synthesis = await draftDeepDiveSynthesis(store, {
      research_case_id: 'rc_deep_order_001',
      synthesis_id: 'synthesis_order_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      ...defaultResearchStrategyRef,
      synthesis_summary: 'Synthesis references recorded findings only.',
      confidence: 'medium',
      caveats: [],
      source_ids: ['src_order_001'],
      specialist_finding_ids: [finding.finding_id],
      causation_id: finding.event_id,
      actor_id: 'system',
    })

    await expect(recordSpecialistFinding(store, {
      research_case_id: 'rc_deep_order_001',
      finding_id: 'finding_order_late_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      specialist_lane: 'moat',
      ...defaultResearchStrategyRef,
      finding_summary: 'This finding is too late after synthesis.',
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: started.event_id,
      actor_id: 'mock-provider',
    })).rejects.toThrow('after deep-dive synthesis')

    await expect(completeDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      completion_id: 'complete_order_invalid_001',
      deep_dive_id: started.deep_dive_id,
      candidate_id: 'candidate_order_001',
      synthesis_id: 'synthesis_order_missing_001',
      ...defaultResearchStrategyRef,
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: synthesis.event_id,
      actor_id: 'system',
    })).rejects.toThrow('matching deep-dive synthesis')
    await expect(completeDeepDive(store, {
      research_case_id: 'rc_deep_order_001',
      completion_id: 'complete_order_missing_candidate_001',
      deep_dive_id: started.deep_dive_id,
      synthesis_id: synthesis.synthesis_id,
      ...defaultResearchStrategyRef,
      confidence: 'low',
      caveats: [],
      source_ids: ['src_order_001'],
      causation_id: synthesis.event_id,
      actor_id: 'system',
    })).rejects.toThrow('candidate id')

    expect((await store.list()).map((event) => event.event_type)).toEqual([
      'research_case_created',
      'quick_screen_drafted',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
    ])
  })

  it('rejects deep-dive queueing unless the quick screen produced a deep-dive candidate', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_not_deep_dive_001',
      company_id: 'company_not_deep_dive',
      ticker: 'NODEEP',
      ...defaultResearchStrategyRef,
      actor_id: 'user_local',
    })
    const quickScreen = await draftQuickScreen(store, {
      research_case_id: 'rc_not_deep_dive_001',
      quick_screen_id: 'quick_not_deep_dive_001',
      company_id: 'company_not_deep_dive',
      ticker: 'NODEEP',
      ...defaultResearchStrategyRef,
      screening_result: 'needs_data',
      summary: 'Need more data before a deep dive can be queued.',
      business_quality: 'Needs more data.',
      moat: 'Needs more data.',
      management_capital_allocation: 'Needs more data.',
      financial_quality: 'Needs more data.',
      valuation_sanity: 'Needs more data.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'low',
      caveats: ['Insufficient evidence'],
      source_ids: ['src_not_deep_dive_001'],
      actor_id: 'mock-provider',
    })

    await expect(queueDeepDive(store, {
      research_case_id: 'rc_not_deep_dive_001',
      queue_id: 'queue_not_deep_dive_001',
      ...defaultResearchStrategyRef,
      source_ids: ['src_not_deep_dive_001'],
      causation_id: quickScreen.event_id,
      actor_id: 'system',
    })).rejects.toThrow('deep-dive candidate')

    expect((await store.list()).map((event) => event.event_type)).toEqual([
      'research_case_created',
      'quick_screen_drafted',
    ])
  })

  it('runs a deterministic sequential Buffett-Munger deep-dive swarm with lane findings and completion', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_swarm_001',
      company_id: 'company_swarm',
      ticker: 'SWARM',
      ...defaultResearchStrategyRef,
      actor_id: 'user_local',
    })
    const quickScreen = await draftQuickScreen(store, {
      research_case_id: 'rc_swarm_001',
      quick_screen_id: 'quick_swarm_001',
      company_id: 'company_swarm',
      ticker: 'SWARM',
      ...defaultResearchStrategyRef,
      screening_result: 'deep_dive_candidate',
      summary: 'Candidate clears quick screen for deterministic deep-dive lanes.',
      business_quality: 'High quality enough for deeper review.',
      moat: 'Moat evidence needs lane review.',
      management_capital_allocation: 'Management evidence needs lane review.',
      financial_quality: 'Financial quality evidence needs lane review.',
      valuation_sanity: 'Valuation evidence needs lane review.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'medium',
      caveats: ['Quick-screen only'],
      source_ids: ['src_swarm_10k'],
      actor_id: 'mock-provider',
    })

    const result = await runDeterministicDeepDiveSwarm(store, {
      research_case_id: 'rc_swarm_001',
      deep_dive_id: 'deep_swarm_001',
      queue_id: 'queue_swarm_001',
      completion_id: 'complete_swarm_001',
      synthesis_id: 'synthesis_swarm_001',
      ...defaultResearchStrategyRef,
      specialist_lanes: buffettMungerDeepDiveLanes,
      source_ids: ['src_swarm_10k', 'src_swarm_proxy'],
      causation_id: quickScreen.event_id,
      actor_id: 'mock-provider',
      provider_run_id: 'provider_run_swarm_001',
    })

    expect(result.findings).toHaveLength(buffettMungerDeepDiveLanes.length)
    expect(result.findings.map((finding) => finding.specialist_lane)).toEqual(buffettMungerDeepDiveLanes)
    expect(result.completed).toMatchObject({
      event_type: 'deep_dive_completed',
      confidence: 'medium',
      caveats: ['Deterministic mock sequential deep-dive; verify before user decision'],
    })
    expect((await store.list()).map((event) => event.event_type)).toEqual([
      'research_case_created',
      'quick_screen_drafted',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
      'deep_dive_completed',
    ])
    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_swarm_001',
        stage: 'deep_dive_completed',
        deep_dive_id: 'deep_swarm_001',
        synthesis_id: 'synthesis_swarm_001',
        strategy_id: 'buffett-munger',
        strategy_version: '1.0.0',
        specialist_findings: buffettMungerDeepDiveLanes.map((specialistLane) => expect.objectContaining({
          specialist_lane: specialistLane,
        })),
      }),
    ])
  })

  it('records a complete single-agent quick screen without mutating watchlist or holdings', async () => {
    const store = new InMemoryEventStore()
    const selectedStrategy = { strategy_id: 'quality-growth', strategy_version: '2026.06' }

    await createResearchCase(store, {
      research_case_id: 'rc_msft_quick_screen_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      ...selectedStrategy,
      actor_id: 'user_local',
    })

    const quickScreen = await draftQuickScreen(store, {
      research_case_id: 'rc_msft_quick_screen_001',
      quick_screen_id: 'quick_msft_single_agent_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      ...selectedStrategy,
      screening_result: 'deep_dive_candidate',
      summary: 'High-quality business appears worth a deeper source-backed strategy review.',
      business_quality: 'Recurring cloud revenue and durable enterprise demand support a high-quality business profile.',
      moat: 'Switching costs and ecosystem breadth are relevant moat evidence for this strategy.',
      management_capital_allocation: 'Capital allocation appears disciplined, but buyback timing needs deeper review.',
      financial_quality: 'Margins and cash conversion are strong enough for the selected strategy screen.',
      valuation_sanity: 'Valuation requires a margin-of-safety deep dive before any watchlist recommendation.',
      shariah_status: 'PENDING',
      red_flags: ['Valuation may be demanding', 'Needs current debt and non-permissible revenue ratio evidence'],
      confidence: 'medium',
      caveats: ['Single-agent quick screen only; not a committee decision'],
      source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025'],
      actor_id: 'mock-provider',
    })

    expect(quickScreen).toMatchObject({
      event_type: 'quick_screen_drafted',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      screening_result: 'deep_dive_candidate',
      business_quality: 'Recurring cloud revenue and durable enterprise demand support a high-quality business profile.',
      moat: 'Switching costs and ecosystem breadth are relevant moat evidence for this strategy.',
      management_capital_allocation: 'Capital allocation appears disciplined, but buyback timing needs deeper review.',
      financial_quality: 'Margins and cash conversion are strong enough for the selected strategy screen.',
      valuation_sanity: 'Valuation requires a margin-of-safety deep dive before any watchlist recommendation.',
      shariah_status: 'PENDING',
      red_flags: ['Valuation may be demanding', 'Needs current debt and non-permissible revenue ratio evidence'],
      confidence: 'medium',
      caveats: ['Single-agent quick screen only; not a committee decision'],
      source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025'],
    })

    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_msft_quick_screen_001',
        stage: 'quick_screened',
        screening_result: 'deep_dive_candidate',
        business_quality: 'Recurring cloud revenue and durable enterprise demand support a high-quality business profile.',
        moat: 'Switching costs and ecosystem breadth are relevant moat evidence for this strategy.',
        management_capital_allocation: 'Capital allocation appears disciplined, but buyback timing needs deeper review.',
        financial_quality: 'Margins and cash conversion are strong enough for the selected strategy screen.',
        valuation_sanity: 'Valuation requires a margin-of-safety deep dive before any watchlist recommendation.',
        shariah_status: 'PENDING',
        red_flags: ['Valuation may be demanding', 'Needs current debt and non-permissible revenue ratio evidence'],
        confidence: 'medium',
        caveats: ['Single-agent quick screen only; not a committee decision'],
        strategy_id: 'quality-growth',
        strategy_version: '2026.06',
      }),
    ])
    expect(projectWatchlist(await store.list())).toEqual([])
    expect(projectHoldings(await store.list())).toEqual([])
  })

  it('keeps Buffett-Munger as the default strategy reference without hard-coding pipeline stages to it', () => {
    expect(defaultResearchStrategyRef).toEqual({
      strategy_id: 'buffett-munger',
      strategy_version: '1.0.0',
    })
  })

  it('defaults research discovery to the current strategy version and neutral discovered stage', async () => {
    const store = new InMemoryEventStore()

    const researchCase = await createResearchCase(store, {
      research_case_id: 'rc_default_strategy_001',
      company_id: 'company_default',
      ticker: 'DFLT',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      actor_id: 'user_local',
    })

    expect(researchCase).toMatchObject({
      strategy_id: 'buffett-munger',
      strategy_version: '1.0.0',
    })
    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_default_strategy_001',
        stage: 'discovered',
        strategy_id: 'buffett-munger',
        strategy_version: '1.0.0',
      }),
    ])
  })

  it('projects confirmed watchlist and opened holding lifecycle events to neutral stages', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_lifecycle_001',
      company_id: 'company_lifecycle',
      ticker: 'LIFE',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      actor_id: 'user_local',
    })
    const watchlistDraft = await confirmWatchlistDraft(store, {
      watchlist_item_id: 'watch_lifecycle_001',
      research_case_id: 'rc_lifecycle_001',
      decision_id: 'decision_lifecycle_001',
      company_id: 'company_lifecycle',
      ticker: 'LIFE',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      thesis_summary: 'Candidate remains eligible for user-monitored watchlist.',
      actor_id: 'user_local',
    })
    await approveWatchlistDraft(store, {
      watchlist_item_id: watchlistDraft.watchlist_item_id,
      research_case_id: 'rc_lifecycle_001',
      causation_id: watchlistDraft.event_id,
      actor_id: 'user_local',
    })

    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_lifecycle_001',
        stage: 'watchlist',
        strategy_id: 'buffett-munger',
        strategy_version: '1.0.0',
      }),
    ])

    await openHoldingFromWatchlist(store, {
      holding_id: 'holding_lifecycle_001',
      watchlist_item_id: watchlistDraft.watchlist_item_id,
      research_case_id: 'rc_lifecycle_001',
      company_id: 'company_lifecycle',
      ticker: 'LIFE',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      thesis_summary: 'User opened a small tracked position after watchlist confirmation.',
      shares: 1,
      cost_basis_per_share: 100,
      opened_at: '2026-06-01',
      currency: 'USD',
      causation_id: 'evt_watchlist_draft_confirmed_watch_lifecycle_001',
      actor_id: 'user_local',
    })

    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_lifecycle_001',
        stage: 'holding',
        strategy_id: 'buffett-munger',
        strategy_version: '1.0.0',
      }),
    ])
  })

  it('preserves non-default strategy versions through watchlist and holding projections', async () => {
    const store = new InMemoryEventStore()
    const selectedStrategy = { strategy_id: 'quality-income', strategy_version: '0.2.0' }

    await createResearchCase(store, {
      research_case_id: 'rc_non_default_lifecycle_001',
      company_id: 'company_non_default',
      ticker: 'NDEF',
      ...selectedStrategy,
      actor_id: 'user_local',
    })
    const watchlistDraft = await confirmWatchlistDraft(store, {
      watchlist_item_id: 'watch_non_default_001',
      research_case_id: 'rc_non_default_lifecycle_001',
      decision_id: 'decision_non_default_001',
      company_id: 'company_non_default',
      ticker: 'NDEF',
      ...selectedStrategy,
      thesis_summary: 'Non-default strategy candidate remains eligible for monitoring.',
      actor_id: 'user_local',
    })
    await approveWatchlistDraft(store, {
      watchlist_item_id: watchlistDraft.watchlist_item_id,
      research_case_id: 'rc_non_default_lifecycle_001',
      causation_id: watchlistDraft.event_id,
      actor_id: 'user_local',
    })
    await openHoldingFromWatchlist(store, {
      holding_id: 'holding_non_default_001',
      watchlist_item_id: watchlistDraft.watchlist_item_id,
      research_case_id: 'rc_non_default_lifecycle_001',
      company_id: 'company_non_default',
      ticker: 'NDEF',
      ...selectedStrategy,
      thesis_summary: 'User opened a tracked position under the selected strategy.',
      shares: 2,
      cost_basis_per_share: 50,
      opened_at: '2026-06-01',
      currency: 'USD',
      causation_id: 'evt_watchlist_draft_confirmed_watch_non_default_001',
      actor_id: 'user_local',
    })

    expect(projectWatchlist(await store.list())).toEqual([
      expect.objectContaining({
        watchlist_item_id: 'watch_non_default_001',
        strategy_id: 'quality-income',
        strategy_version: '0.2.0',
      }),
    ])
    expect(projectHoldings(await store.list())).toEqual([
      expect.objectContaining({
        holding_id: 'holding_non_default_001',
        strategy_id: 'quality-income',
        strategy_version: '0.2.0',
      }),
    ])
    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_non_default_lifecycle_001',
        stage: 'holding',
        strategy_id: 'quality-income',
        strategy_version: '0.2.0',
      }),
    ])
  })

  it('requires non-default strategies to carry a non-empty version', async () => {
    const store = new InMemoryEventStore()

    await expect(createResearchCase(store, {
      research_case_id: 'rc_missing_strategy_version_001',
      company_id: 'company_missing_version',
      ticker: 'MISS',
      strategy_id: 'quality-income',
      actor_id: 'user_local',
    })).rejects.toThrow('requires an explicit strategy version')

    await expect(createResearchCase(store, {
      research_case_id: 'rc_empty_strategy_version_001',
      company_id: 'company_empty_version',
      ticker: 'EMPT',
      strategy_id: 'quality-income',
      strategy_version: ' ',
      actor_id: 'user_local',
    })).rejects.toThrow('requires a non-empty strategy version')
  })

  it('rejects pipeline events that would change a research case strategy identity', async () => {
    const store = new InMemoryEventStore()
    const originalStrategy = { strategy_id: 'quality-income', strategy_version: '0.2.0' }

    await createResearchCase(store, {
      research_case_id: 'rc_strategy_mismatch_001',
      company_id: 'company_mismatch',
      ticker: 'MISM',
      ...originalStrategy,
      actor_id: 'user_local',
    })

    await expect(draftQuickScreen(store, {
      research_case_id: 'rc_strategy_mismatch_001',
      quick_screen_id: 'quick_strategy_mismatch_001',
      company_id: 'company_mismatch',
      ticker: 'MISM',
      strategy_id: 'growth-quality',
      strategy_version: '9.9.9',
      screening_result: 'deep_dive_candidate',
      summary: 'This mismatched strategy event must not be recorded.',
      business_quality: 'Mismatched strategy event must not be recorded.',
      moat: 'Mismatched strategy event must not be recorded.',
      management_capital_allocation: 'Mismatched strategy event must not be recorded.',
      financial_quality: 'Mismatched strategy event must not be recorded.',
      valuation_sanity: 'Mismatched strategy event must not be recorded.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'low',
      caveats: ['Invalid strategy identity'],
      source_ids: ['src_mismatch_001'],
      actor_id: 'mock-provider',
    })).rejects.toThrow('does not match research case strategy')

    expect(projectResearchCases(await store.list())).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_strategy_mismatch_001',
        stage: 'discovered',
        ...originalStrategy,
      }),
    ])
  })

  it('rejects blank or whitespace-only source ids before appending pipeline events', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_blank_source_001',
      company_id: 'company_blank_source',
      ticker: 'BLNK',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      actor_id: 'user_local',
    })

    await expect(draftQuickScreen(store, {
      research_case_id: 'rc_blank_source_001',
      quick_screen_id: 'quick_blank_source_001',
      company_id: 'company_blank_source',
      ticker: 'BLNK',
      ...defaultResearchStrategyRef,
      screening_result: 'deep_dive_candidate',
      summary: 'Whitespace-only source ids are not auditable sources.',
      business_quality: 'Whitespace-only source ids are not auditable sources.',
      moat: 'Whitespace-only source ids are not auditable sources.',
      management_capital_allocation: 'Whitespace-only source ids are not auditable sources.',
      financial_quality: 'Whitespace-only source ids are not auditable sources.',
      valuation_sanity: 'Whitespace-only source ids are not auditable sources.',
      shariah_status: 'PENDING',
      red_flags: [],
      confidence: 'low',
      caveats: ['Invalid source ids'],
      source_ids: ['src_valid_001', '   '],
      actor_id: 'mock-provider',
    })).rejects.toThrow('source id')

    expect((await store.list()).map((event) => event.event_type)).toEqual(['research_case_created'])
  })

  it('projects terminal quick-screen pass and rejection stages neutrally', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_pass_001',
      company_id: 'company_pass',
      ticker: 'PASS',
      strategy_id: defaultResearchStrategyRef.strategy_id,
      strategy_version: defaultResearchStrategyRef.strategy_version,
      actor_id: 'user_local',
    })
    await draftQuickScreen(store, {
      research_case_id: 'rc_pass_001',
      quick_screen_id: 'quick_pass_001',
      company_id: 'company_pass',
      ticker: 'PASS',
      ...defaultResearchStrategyRef,
      screening_result: 'pass',
      summary: 'No durable fit for the selected strategy.',
      business_quality: 'Business quality is not compelling under the selected strategy.',
      moat: 'Moat evidence is insufficient for the selected strategy.',
      management_capital_allocation: 'Capital allocation is not enough to overcome the screen.',
      financial_quality: 'Financial quality does not meet the quick-screen hurdle.',
      valuation_sanity: 'Valuation does not create a clear reason to continue.',
      shariah_status: 'PENDING',
      red_flags: ['Insufficient strategy fit'],
      confidence: 'medium',
      caveats: ['Quick screen only'],
      source_ids: ['src_pass_001'],
      actor_id: 'mock-provider',
    })

    await createResearchCase(store, {
      research_case_id: 'rc_reject_001',
      company_id: 'company_reject',
      ticker: 'NOPE',
      strategy_id: 'income-quality',
      strategy_version: '0.1.0',
      actor_id: 'user_local',
    })
    await draftQuickScreen(store, {
      research_case_id: 'rc_reject_001',
      quick_screen_id: 'quick_reject_001',
      company_id: 'company_reject',
      ticker: 'NOPE',
      strategy_id: 'income-quality',
      strategy_version: '0.1.0',
      screening_result: 'reject',
      summary: 'Rejected for strategy-specific exclusion criteria.',
      business_quality: 'Business quality fails the selected strategy exclusion criteria.',
      moat: 'Moat evidence is not relevant after exclusion.',
      management_capital_allocation: 'Management review is not relevant after exclusion.',
      financial_quality: 'Financial quality does not offset the exclusion.',
      valuation_sanity: 'Valuation is not relevant after exclusion.',
      shariah_status: 'NON_COMPLIANT',
      red_flags: ['Strategy-specific exclusion criteria'],
      confidence: 'high',
      caveats: ['Reject without watchlist or holding mutation'],
      source_ids: ['src_reject_001'],
      actor_id: 'mock-provider',
    })

    expect(projectResearchCases(await store.list())).toEqual(expect.arrayContaining([
      expect.objectContaining({ research_case_id: 'rc_pass_001', stage: 'pass', strategy_id: 'buffett-munger', strategy_version: '1.0.0' }),
      expect.objectContaining({ research_case_id: 'rc_reject_001', stage: 'rejected', strategy_id: 'income-quality', strategy_version: '0.1.0' }),
    ]))
  })
})
