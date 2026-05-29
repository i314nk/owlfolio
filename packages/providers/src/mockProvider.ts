import type { ZodType } from 'zod'
import type {
  Provider,
  ProviderCompletion,
  ProviderObservation,
  ProviderRunMetadata,
  ProviderRunRequest,
  ProviderToolRun,
} from './providerContract'

export interface MockProviderOptions {
  mode?: 'default' | 'invalid-json'
}

const cannedBuffettMungerAnalysis = {
  investment_verdict: 'WATCH',
  strategy_compliance: 'CONDITIONAL',
  shariah_status: 'COMPLIANT',
  valuation_status: 'EXPENSIVE',
  next_required_action: 'Wait for a wider margin of safety and refresh Costco source coverage after the next quarterly filing.',
  decision_reason: 'Durable quality business, but current valuation does not yet provide a sufficient margin of safety.',
  source_ids: ['src_cost_10k_2025', 'src_cost_proxy_2025', 'src_cost_q1_2026'],
  source_records: [
    {
      source_id: 'src_cost_10k_2025',
      title: 'Costco FY2025 10-K',
      url: 'https://example.test/costco-10k-2025',
      excerpt: 'Membership renewal economics remained resilient across regions.',
    },
    {
      source_id: 'src_cost_proxy_2025',
      title: 'Costco 2025 Proxy Statement',
      url: 'https://example.test/costco-proxy-2025',
      excerpt: 'Executive incentives remained aligned with long-term operating metrics.',
    },
    {
      source_id: 'src_cost_q1_2026',
      title: 'Costco Q1 2026 Shareholder Letter',
      url: 'https://example.test/costco-q1-2026',
      excerpt: 'Comparable-sales momentum stayed healthy while valuation remained elevated.',
    },
  ],
} as const

export class MockProvider implements Provider {
  readonly provider_id = 'mock-provider'
  readonly capabilities = {
    'text-generation': 'native',
    'structured-output': 'native',
    'tool-function-calling': 'native',
    'streaming-observability': 'native',
    'multi-step-tool-loop': 'native',
  } as const

  private readonly mode: 'default' | 'invalid-json'

  constructor(options: MockProviderOptions = {}) {
    this.mode = options.mode ?? 'default'
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    return {
      text: JSON.stringify(this.outputForMode()),
      metadata: this.metadataFor(request),
      observations: this.observationsFor('completed'),
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
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

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    const completion = await this.complete(request)
    return {
      text: completion.text,
      metadata: completion.metadata,
      observations: this.observationsFor(request.budget.max_tool_calls > 0 ? 'tool-call' : 'completed'),
      tool_calls: request.budget.max_tool_calls > 0 && request.tool_allowlist.includes('source.fetch')
        ? [{ tool_call_id: 'tool_call_source_fetch_001', tool_name: 'source.fetch', input: { source_id: 'src_cost_10k_2025' }, output: { source_id: 'src_cost_10k_2025', found: true } }]
        : [],
      finish_reason: request.budget.max_tool_calls > 0 && request.tool_allowlist.includes('source.fetch') ? 'tool-calls' : 'completed',
      ledger_events_written: 0,
    }
  }

  private metadataFor(request: ProviderRunRequest): ProviderRunMetadata {
    return {
      provider_id: this.provider_id,
      run_id: request.run_id,
      model_id: request.model_id,
      timeout_ms: request.timeout_ms,
      tool_allowlist: [...request.tool_allowlist],
      task_kind: request.task_kind,
      response_format: request.response_format,
    }
  }

  private observationsFor(finalStage: 'tool-call' | 'completed'): ProviderObservation[] {
    const observations: ProviderObservation[] = [
      { at: new Date().toISOString(), stage: 'queued', message: 'Mock provider queued the request.' },
      { at: new Date().toISOString(), stage: 'running', message: 'Mock provider started the request.' },
    ]

    if (finalStage === 'tool-call') {
      observations.push({ at: new Date().toISOString(), stage: 'tool-call', message: 'Mock provider requested source.fetch.' })
    }

    observations.push({ at: new Date().toISOString(), stage: 'completed', message: 'Mock provider finished the request.' })
    return observations
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
