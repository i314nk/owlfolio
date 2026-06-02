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

function extractTicker(prompt: string): string {
  const match = prompt.match(/\b(?:Analyze(?:\s+ticker)?|Review\s+ticker)\s+([A-Z][A-Z0-9.-]{0,9})\b/i)
  return (match?.[1] ?? 'COST').toUpperCase()
}

function sourceSlugForTicker(ticker: string): string {
  return ticker.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cost'
}

function companyLabelForTicker(ticker: string): string {
  return ticker === 'COST' ? 'Costco' : ticker
}

function sourceIdsForTicker(ticker: string): string[] {
  const slug = sourceSlugForTicker(ticker)
  return [`src_${slug}_10k_2025`, `src_${slug}_proxy_2025`, `src_${slug}_q1_2026`]
}

function buffettMungerAnalysisForTicker(ticker: string) {
  const [annualReportId, proxyId, quarterlyId] = sourceIdsForTicker(ticker)
  const sourceSlug = sourceSlugForTicker(ticker)
  const companyLabel = companyLabelForTicker(ticker)

  return {
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    shariah_status: 'COMPLIANT',
    valuation_status: 'EXPENSIVE',
    next_required_action: `Wait for a wider margin of safety and refresh ${companyLabel} source coverage after the next quarterly filing.`,
    decision_reason: 'Durable quality business, but current valuation does not yet provide a sufficient margin of safety.',
    source_ids: [annualReportId, proxyId, quarterlyId],
    source_records: [
      {
        source_id: annualReportId,
        title: `${companyLabel} FY2025 10-K`,
        url: `https://example.test/${sourceSlug}-10k-2025`,
        excerpt: `${companyLabel} reported durable operating performance while valuation discipline remained important.`,
      },
      {
        source_id: proxyId,
        title: `${companyLabel} 2025 Proxy Statement`,
        url: `https://example.test/${sourceSlug}-proxy-2025`,
        excerpt: `${companyLabel} governance and incentive disclosures require review for Buffett-Munger alignment.`,
      },
      {
        source_id: quarterlyId,
        title: `${companyLabel} Q1 2026 Shareholder Letter`,
        url: `https://example.test/${sourceSlug}-q1-2026`,
        excerpt: `${companyLabel} business momentum remained healthy while current valuation stayed elevated.`,
      },
    ],
  } as const
}

function buffettMungerHoldingReviewForTicker(ticker: string) {
  return {
    thesis_health: 'HEALTHY',
    action_stance: 'HOLD',
    rationale: 'The original Buffett-Munger thesis remains intact: durable moat, aligned management, Shariah-compliant operations, and no evidence of thesis drift.',
    evidence_summary: 'Reviewed the existing research case, source ledger references, holding cost basis, and latest valuation snapshot.',
    uncertainty: 'Needs a refreshed primary-source review after the next quarterly filing.',
    next_review_at: '2026-09-30',
    source_ids: sourceIdsForTicker(ticker),
  } as const
}

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
      text: JSON.stringify(this.outputForMode(request)),
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
    const sourceIds = sourceIdsForTicker(extractTicker(request.prompt))
    const shouldCallTools = request.budget.max_tool_calls > 0 && request.tool_allowlist.includes('source.fetch')
    const toolCalls = shouldCallTools
      ? sourceIds.slice(0, Math.max(1, request.budget.max_tool_calls)).map((sourceId, index) => ({
        tool_call_id: `tool_call_source_fetch_${String(index + 1).padStart(3, '0')}`,
        tool_name: 'source.fetch',
        input: { source_id: sourceId },
        output: { source_id: sourceId, found: true },
      }))
      : []

    return {
      text: completion.text,
      metadata: completion.metadata,
      observations: this.observationsFor(shouldCallTools ? 'tool-call' : 'completed'),
      tool_calls: toolCalls,
      finish_reason: shouldCallTools ? 'tool-calls' : 'completed',
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

  private outputForMode(request: ProviderRunRequest): unknown {
    if (this.mode === 'invalid-json') {
      return {
        investment_verdict: 'HOLD',
        strategy_compliance: 'MAYBE',
        source_ids: [],
      }
    }

    if (request.response_format.kind === 'json-schema' && request.response_format.schema_name === 'BuffettMungerHoldingReview') {
      return buffettMungerHoldingReviewForTicker(extractTicker(request.prompt))
    }

    return buffettMungerAnalysisForTicker(extractTicker(request.prompt))
  }
}
