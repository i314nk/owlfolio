import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MockProvider } from '../mockProvider'
import { runProviderTask } from '../runProviderTask'

const AnalysisSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  source_ids: z.array(z.string()).min(1),
})

const HoldingReviewSchema = z.object({
  thesis_health: z.enum(['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE']),
  action_stance: z.enum(['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE']),
  rationale: z.string().min(1),
  evidence_summary: z.string().min(1),
  uncertainty: z.string().min(1),
  next_review_at: z.string().min(1),
  source_ids: z.array(z.string()).min(1),
})

describe('MockProvider', () => {
  it('returns structured Buffett-Munger analysis matching schema', async () => {
    const provider = new MockProvider()
    const result = await provider.structured(
      {
        run_id: 'run_mock_cost_001',
        provider_id: 'mock-provider',
        model_id: 'mock-research-v1',
        task_kind: 'structured-output',
        prompt: 'Analyze COST with Buffett-Munger policy',
        timeout_ms: 1000,
        budget: { max_tool_calls: 2, max_tokens: 2000 },
        tool_allowlist: ['source.fetch'],
        response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
      },
      AnalysisSchema,
    )
    expect(result).toMatchObject({ investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT' })
    expect(result.source_ids).toContain('src_cost_10k_2025')
  })

  it('keeps non-COST research output ticker-aware instead of leaking Costco sources', async () => {
    const provider = new MockProvider()
    const result = await provider.structured(
      {
        run_id: 'run_mock_msft_001',
        provider_id: 'mock-provider',
        model_id: 'mock-research-v1',
        task_kind: 'structured-output',
        prompt: 'Analyze MSFT with Buffett-Munger policy',
        timeout_ms: 1000,
        budget: { max_tool_calls: 2, max_tokens: 2000 },
        tool_allowlist: ['source.fetch'],
        response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
      },
      AnalysisSchema,
    )

    expect(result.next_required_action).toContain('MSFT')
    expect(result.next_required_action).not.toMatch(/Costco|COST\b/)
    expect(result.source_ids).toEqual(['src_msft_10k_2025', 'src_msft_proxy_2025', 'src_msft_q1_2026'])
  })

  it('keeps non-COST holding review sources aligned with the reviewed ticker', async () => {
    const provider = new MockProvider()
    const result = await provider.structured(
      {
        run_id: 'run_review_msft_001',
        provider_id: 'mock-provider',
        model_id: 'mock-research-v1',
        task_kind: 'structured-output',
        prompt: 'Review ticker MSFT under the default Buffett-Munger strategy buffett-munger.',
        timeout_ms: 1000,
        budget: { max_tool_calls: 0, max_tokens: 2000 },
        tool_allowlist: [],
        response_format: { kind: 'json-schema', schema_name: 'BuffettMungerHoldingReview' },
      },
      HoldingReviewSchema,
    )

    // The holding review now runs through the grounding harness, so the mock proposes + cites the same
    // EDGAR-shaped grounded source ids (verified deterministically) instead of the legacy analysis ids.
    expect(result.source_ids).toEqual(['mock_msft_primary', 'mock_msft_secondary'])
  })

  it('records provider run metadata and tool allowlist', async () => {
    const provider = new MockProvider()
    const run = await runProviderTask(provider, {
      run_id: 'run_metadata_001',
      provider_id: 'mock-provider',
      model_id: 'mock-research-v1',
      task_kind: 'tool-loop',
      prompt: 'Use allowed tools only',
      timeout_ms: 1000,
      budget: { max_tool_calls: 1, max_tokens: 500 },
      tool_allowlist: ['source.fetch'],
      response_format: { kind: 'text' },
    })
    expect(run.metadata).toMatchObject({ provider_id: 'mock-provider', model_id: 'mock-research-v1', timeout_ms: 1000, tool_allowlist: ['source.fetch'] })
    expect(run.ledger_events_written).toBe(0)
  })

  it('returns a valid BuffettMungerQuickScreen payload with proposed_sources', async () => {
    const provider = new MockProvider()
    const completion = await provider.complete({
      run_id: 'run_qs_001',
      model_id: 'mock-research-v1',
      task_kind: 'structured-output',
      prompt: 'Analyze COST with Buffett-Munger policy',
      timeout_ms: 1000,
      budget: { max_tool_calls: 0, max_tokens: 2000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerQuickScreen' },
    })
    const parsed = JSON.parse(completion.text) as Record<string, unknown>
    expect(parsed).toHaveProperty('summary')
    expect(parsed).toHaveProperty('screening_result', 'deep_dive_candidate')
    expect(parsed).toHaveProperty('shariah_status', 'CONDITIONAL')
    expect(parsed).toHaveProperty('confidence', 'medium')
    const sources = parsed['proposed_sources']
    expect(Array.isArray(sources)).toBe(true)
    expect((sources as unknown[]).length).toBeGreaterThanOrEqual(1)
    const first = (sources as Record<string, unknown>[])[0]
    expect(first).toHaveProperty('source_id')
    expect(first).toHaveProperty('title')
    expect(first).toHaveProperty('url')
    expect(first).toHaveProperty('excerpt')
  })

  it('returns a valid BuffettMungerLaneFinding payload with proposed_sources', async () => {
    const provider = new MockProvider()
    const completion = await provider.complete({
      run_id: 'run_lane_001',
      model_id: 'mock-research-v1',
      task_kind: 'structured-output',
      prompt: 'Analyze MSFT with Buffett-Munger policy',
      timeout_ms: 1000,
      budget: { max_tool_calls: 0, max_tokens: 2000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerLaneFinding' },
    })
    const parsed = JSON.parse(completion.text) as Record<string, unknown>
    expect(parsed).toHaveProperty('finding_summary')
    expect(parsed).toHaveProperty('confidence', 'medium')
    expect(Array.isArray(parsed['caveats'])).toBe(true)
    expect((parsed['caveats'] as unknown[]).length).toBeGreaterThanOrEqual(1)
    const sources = parsed['proposed_sources']
    expect(Array.isArray(sources)).toBe(true)
    expect((sources as unknown[]).length).toBeGreaterThanOrEqual(1)
    const first = (sources as Record<string, unknown>[])[0]
    expect(first).toHaveProperty('source_id', 'mock_msft_primary')
    expect(first).toHaveProperty('url')
  })

  it('returns a valid BuffettMungerSynthesisDecision payload with proposed_sources', async () => {
    const provider = new MockProvider()
    const completion = await provider.complete({
      run_id: 'run_dec_001',
      model_id: 'mock-research-v1',
      task_kind: 'structured-output',
      prompt: 'Analyze COST with Buffett-Munger policy',
      timeout_ms: 1000,
      budget: { max_tool_calls: 0, max_tokens: 2000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerSynthesisDecision' },
    })
    const parsed = JSON.parse(completion.text) as Record<string, unknown>
    expect(parsed).toHaveProperty('investment_verdict', 'WATCH')
    expect(parsed).toHaveProperty('decision_reason')
    expect(parsed).toHaveProperty('thesis_summary')
    expect(parsed).toHaveProperty('evidence_summary')
    expect(parsed).toHaveProperty('valuation_rationale')
    expect(parsed).toHaveProperty('shariah_rationale')
    expect(parsed).toHaveProperty('synthesis_summary')
    expect(Array.isArray(parsed['risks'])).toBe(true)
    expect((parsed['risks'] as unknown[]).length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(parsed['open_questions'])).toBe(true)
    expect((parsed['open_questions'] as unknown[]).length).toBeGreaterThanOrEqual(1)
    const sources = parsed['proposed_sources']
    expect(Array.isArray(sources)).toBe(true)
    expect((sources as unknown[]).length).toBeGreaterThanOrEqual(1)
  })

  it('fails safely when structured output violates schema', async () => {
    const provider = new MockProvider({ mode: 'invalid-json' })
    await expect(
      provider.structured(
        {
          run_id: 'run_invalid_001',
          provider_id: 'mock-provider',
          model_id: 'mock-research-v1',
          task_kind: 'structured-output',
          prompt: 'Return invalid result',
          timeout_ms: 1000,
          budget: { max_tool_calls: 0, max_tokens: 500 },
          tool_allowlist: [],
          response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
        },
        AnalysisSchema,
      ),
    ).rejects.toThrow(/structured output validation failed/i)
  })
})
