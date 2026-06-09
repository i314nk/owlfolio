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
  // Match patterns like "for MSFT", "for MSFT (", "ticker MSFT", "Analyze MSFT", "Review ticker MSFT"
  // Covers both legacy prompts (Analyze/Review ticker) and swarm prompts (specialist agent for MSFT)
  const match =
    prompt.match(/\b(?:for\s+ticker|Review\s+ticker|Analyze(?:\s+ticker)?)\s+([A-Z][A-Z0-9.-]{0,5})\b/) ??
    prompt.match(/\bfor\s+([A-Z][A-Z0-9.-]{0,5})\b/)
  return (match?.[1] ?? 'COST').toUpperCase()
}

function sourceSlugForTicker(ticker: string): string {
  return ticker.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cost'
}

function companyLabelForTicker(ticker: string): string {
  if (ticker === 'COST') {
    return 'Costco'
  }
  if (ticker === 'MSFT') {
    return 'Microsoft'
  }

  return ticker
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
    next_required_action: `Wait for a wider margin of safety and refresh ${ticker} source coverage after the next quarterly filing.`,
    decision_reason: 'Durable quality business, but current valuation does not yet provide a sufficient margin of safety.',
    thesis_summary: `${companyLabel} screens as a durable quality compounder, but remains a watchlist candidate until valuation provides a wider margin of safety.`,
    evidence_summary: `${companyLabel} source records cover the latest annual report, proxy governance context, and recent quarterly operating momentum.`,
    valuation_rationale: 'Current valuation remains elevated versus the required Buffett-Munger margin of safety.',
    shariah_rationale: 'Mock source coverage did not identify prohibited-business evidence; final Shariah treatment remains subject to sourced ratio review.',
    risks: ['Valuation compression', 'Source coverage may need refreshing after the next filing'],
    open_questions: ['Refresh owner-earnings and Shariah ratio evidence after the next quarterly filing'],
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

function mockSourcesForTicker(ticker: string) {
  const tslug = sourceSlugForTicker(ticker)
  return [
    {
      source_id: `mock_${tslug}_primary`,
      title: `${ticker} primary source`,
      url: `https://mock.local/${tslug}/primary`,
      excerpt: `${ticker} primary mock source excerpt for deterministic swarm testing.`,
    },
    {
      source_id: `mock_${tslug}_secondary`,
      title: `${ticker} secondary source`,
      url: `https://mock.local/${tslug}/secondary`,
      excerpt: `${ticker} secondary mock source excerpt for deterministic swarm testing.`,
    },
  ] as const
}

function mockQuickScreenForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    summary: `${companyLabel} screens as a durable quality business with a wide moat. Valuation is elevated; a deep dive is warranted.`,
    business_quality: `${companyLabel} operates a durable membership-driven model with consistent earnings power.`,
    moat: `Wide cost-leadership and switching-cost moat; members renew at high rates.`,
    management_capital_allocation: `Owner-oriented management with disciplined capital allocation and low leverage.`,
    financial_quality: `Consistent free cash flow; conservative balance sheet; high return on invested capital.`,
    valuation_sanity: `Current price is elevated relative to intrinsic value; a margin of safety is not yet present.`,
    shariah_status: 'CONDITIONAL' as const,
    red_flags: [`Valuation elevated versus Buffett-Munger margin-of-safety threshold.`],
    confidence: 'medium' as const,
    caveats: [`Mock analysis — not investment-grade; run a real provider before any decision.`],
    screening_result: 'deep_dive_candidate' as const,
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

function mockLaneFindingForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    finding_summary: `${companyLabel} lane finding: mock specialist analysis consistent with a WATCH stance.`,
    confidence: 'medium' as const,
    caveats: [`Mock lane finding — not investment-grade; run a real provider before any decision.`],
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

function mockSynthesisDecisionForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    investment_verdict: 'WATCH' as const,
    strategy_compliance: 'CONDITIONAL' as const,
    valuation_status: 'EXPENSIVE' as const,
    next_required_action: `Wait for a wider margin of safety and refresh ${ticker} source coverage after the next quarterly filing.`,
    decision_reason: `${companyLabel} is a durable quality compounder but current valuation does not yet provide a sufficient margin of safety.`,
    thesis_summary: `${companyLabel} screens as a wide-moat compounder with aligned management and Shariah-conditional status; watchlist until valuation is attractive.`,
    evidence_summary: `Mock source coverage reviewed primary and secondary references for ${ticker}.`,
    valuation_rationale: `Current valuation remains elevated versus the required Buffett-Munger margin of safety.`,
    shariah_rationale: `Mock source coverage did not identify prohibited-business evidence; final Shariah treatment requires sourced ratio review.`,
    synthesis_summary: `All mock lanes reviewed; ${companyLabel} is a WATCH candidate pending a wider margin of safety.`,
    risks: [`Valuation compression risk if earnings disappoint.`],
    open_questions: [`Refresh owner-earnings and Shariah ratio evidence after the next quarterly filing.`],
    moat_class: 'wide' as const,
    growth_assumptions: `${companyLabel} is assumed to grow normalized owner earnings at 8–10% per year over the next decade, decelerating to 3% in terminal growth, supported by durable pricing power and reinvestment runway.`,
    normalized_owner_earnings_per_share: 18,
    growth_rate: 0.08,
    proposed_sources: mockSourcesForTicker(ticker),
  }
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
    'source-grounding': 'native',
    'citation-metadata': 'native',
    'url-context': 'native',
    'file-context': 'adapter',
    'source-bundle-production': 'native',
    'code-execution': 'unsupported',
    'computer-use': 'unsupported',
    'browser-use': 'unsupported',
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
      ...(request.provider_surface_id === undefined ? {} : { provider_surface_id: request.provider_surface_id }),
      ...(request.vendor_id === undefined ? {} : { vendor_id: request.vendor_id }),
      ...(request.runtime_kind === undefined ? {} : { runtime_kind: request.runtime_kind }),
      ...(request.auth_mode === undefined ? {} : { auth_mode: request.auth_mode }),
      ...(request.workflow_role === undefined ? {} : { workflow_role: request.workflow_role }),
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

    if (request.response_format.kind === 'json-schema') {
      const ticker = extractTicker(request.prompt)
      switch (request.response_format.schema_name) {
        case 'BuffettMungerHoldingReview':
          return buffettMungerHoldingReviewForTicker(ticker)
        case 'BuffettMungerQuickScreen':
          return mockQuickScreenForTicker(ticker)
        case 'BuffettMungerLaneFinding':
          return mockLaneFindingForTicker(ticker)
        case 'BuffettMungerSynthesisDecision':
          return mockSynthesisDecisionForTicker(ticker)
        default:
          return buffettMungerAnalysisForTicker(ticker)
      }
    }

    return buffettMungerAnalysisForTicker(extractTicker(request.prompt))
  }
}
