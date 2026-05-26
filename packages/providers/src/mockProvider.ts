import type { ZodType } from 'zod'
import type { Provider, ProviderCompletion, ProviderRunMetadata, ProviderTaskRequest, ProviderToolRun } from './providerContract'

export interface MockProviderOptions {
  mode?: 'default' | 'invalid-json'
}

const cannedBuffettMungerAnalysis = {
  investment_verdict: 'WATCH',
  strategy_compliance: 'CONDITIONAL',
  shariah_status: 'COMPLIANT',
  valuation_status: 'EXPENSIVE',
  next_required_action: 'Wait for a wider margin of safety and refresh Costco source coverage after the next quarterly filing.',
  source_ids: ['src_cost_10k_2025', 'src_cost_proxy_2025', 'src_cost_q1_2026'],
} as const

export class MockProvider implements Provider {
  readonly provider_id = 'mock-provider'
  private readonly mode: 'default' | 'invalid-json'

  constructor(options: MockProviderOptions = {}) {
    this.mode = options.mode ?? 'default'
  }

  async complete(request: ProviderTaskRequest): Promise<ProviderCompletion> {
    return {
      text: JSON.stringify(this.outputForMode()),
      metadata: this.metadataFor(request),
    }
  }

  async structured<T>(request: ProviderTaskRequest, schema: ZodType<T>): Promise<T> {
    const completion = await this.complete(request)
    let parsed: unknown

    try {
      parsed = JSON.parse(completion.text)
    } catch (error) {
      throw new Error(`Structured output validation failed: provider returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }

    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new Error(`Structured output validation failed: ${result.error.message}`)
    }

    return result.data
  }

  async runWithTools(request: ProviderTaskRequest): Promise<ProviderToolRun> {
    const completion = await this.complete(request)
    return {
      text: completion.text,
      metadata: completion.metadata,
      tool_calls: request.budget.max_tool_calls > 0 && request.tool_allowlist.includes('source.fetch')
        ? [{ tool_name: 'source.fetch', input: { source_id: 'src_cost_10k_2025' }, output: { source_id: 'src_cost_10k_2025', found: true } }]
        : [],
      ledger_events_written: 0,
    }
  }

  private metadataFor(request: ProviderTaskRequest): ProviderRunMetadata {
    return {
      provider_id: this.provider_id,
      run_id: request.run_id,
      model_id: request.model_id,
      timeout_ms: request.timeout_ms,
      tool_allowlist: [...request.tool_allowlist],
    }
  }

  private outputForMode(): unknown {
    if (this.mode === 'invalid-json') {
      return {
        investment_verdict: 'HOLD',
        strategy_compliance: 'MAYBE',
        source_ids: [],
      }
    }

    return cannedBuffettMungerAnalysis
  }
}
