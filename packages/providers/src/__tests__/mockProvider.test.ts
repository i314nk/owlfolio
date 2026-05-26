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

describe('MockProvider', () => {
  it('returns structured Buffett-Munger analysis matching schema', async () => {
    const provider = new MockProvider()
    const result = await provider.structured({ run_id: 'run_mock_cost_001', model_id: 'mock-research-v1', prompt: 'Analyze COST with Buffett-Munger policy', timeout_ms: 1000, budget: { max_tool_calls: 2, max_tokens: 2000 }, tool_allowlist: ['source.fetch'] }, AnalysisSchema)
    expect(result).toMatchObject({ investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT' })
    expect(result.source_ids).toContain('src_cost_10k_2025')
  })

  it('records provider run metadata and tool allowlist', async () => {
    const provider = new MockProvider()
    const run = await runProviderTask(provider, { run_id: 'run_metadata_001', model_id: 'mock-research-v1', prompt: 'Use allowed tools only', timeout_ms: 1000, budget: { max_tool_calls: 1, max_tokens: 500 }, tool_allowlist: ['source.fetch'] })
    expect(run.metadata).toMatchObject({ provider_id: 'mock-provider', model_id: 'mock-research-v1', timeout_ms: 1000, tool_allowlist: ['source.fetch'] })
    expect(run.ledger_events_written).toBe(0)
  })

  it('fails safely when structured output violates schema', async () => {
    const provider = new MockProvider({ mode: 'invalid-json' })
    await expect(provider.structured({ run_id: 'run_invalid_001', model_id: 'mock-research-v1', prompt: 'Return invalid result', timeout_ms: 1000, budget: { max_tool_calls: 0, max_tokens: 500 }, tool_allowlist: [] }, AnalysisSchema)).rejects.toThrow(/structured output validation failed/i)
  })
})
