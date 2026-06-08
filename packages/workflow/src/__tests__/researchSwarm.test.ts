import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { runGroundedAgent, ProposedSourcesSchema, runLaneSwarm, runStrategyResearchSwarm } from '../researchSwarm'
import type { CapturedSource } from '../sourceGrounding'

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
        decision_reason: 'Solid business, needs margin of safety',
        thesis_summary: 'Quality compounder',
        evidence_summary: 'Covered by mock sources',
        valuation_rationale: 'Elevated valuation',
        shariah_rationale: 'No prohibited activities detected',
        synthesis_summary: 'All lanes reviewed; watch for better entry',
        risks: ['Valuation risk'],
        open_questions: ['Margin of safety needed'],
        proposed_sources: [src('src_dec_1')],
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
})
