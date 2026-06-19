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

// Deterministic capital-light cohort for the mock: these names get a CITED capital_light_argument so the
// band engine's escape valve (band_high above the reinvestment×ROIC identity) is exercised in tests/demo.
function isCapitalLightMock(ticker: string): boolean {
  return ticker === 'MSFT' || ticker === 'GOOGL'
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

// Mirrors the grounded-research contract the swarm runs: structured analysis + proposed_sources
// (real-shaped URLs) that the harness grounds post-hoc. Used by the source-grounded certification.
function mockGroundedResearchForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    investment_verdict: 'WATCH' as const,
    strategy_compliance: 'CONDITIONAL' as const,
    shariah_status: 'COMPLIANT' as const,
    valuation_status: 'EXPENSIVE' as const,
    next_required_action: `Refresh ${ticker} owner-earnings and Shariah ratio evidence after the next quarterly filing before any watchlist confirmation.`,
    decision_reason: `${companyLabel} is a durable quality compounder but valuation does not yet offer a sufficient margin of safety.`,
    proposed_sources: mockSourcesForTicker(ticker),
  } as const
}

function mockSourcesForTicker(ticker: string) {
  const tslug = sourceSlugForTicker(ticker)
  // URLs are SEC EDGAR-shaped so the per-lane source-discipline whitelist (Mechanism 6) classifies
  // them as PRIMARY filings (admitted by EVERY lane, including the strict classification lanes) —
  // otherwise the deterministic demo/test lanes would be (correctly) starved. The source_ids/titles
  // stay stable (e2e + tests assert on them); only the URL host/path changed.
  return [
    {
      source_id: `mock_${tslug}_primary`,
      title: `${ticker} primary source`,
      url: `https://www.sec.gov/Archives/edgar/data/0/${tslug}-10k-2025.htm`,
      excerpt: `${ticker} primary mock source excerpt for deterministic swarm testing.`,
    },
    {
      source_id: `mock_${tslug}_secondary`,
      title: `${ticker} secondary source`,
      url: `https://www.sec.gov/Archives/edgar/data/0/${tslug}-10q-2026.htm`,
      excerpt: `${ticker} secondary mock source excerpt for deterministic swarm testing.`,
    },
  ] as const
}

// CIRCLE-OF-COMPETENCE judgment (the sequential pre-deep-dive gate). The deterministic mock DEMONSTRATES
// understanding by citing the grounded mock primary/secondary source_ids for BOTH clauses (so the harness
// cite-check verifies them and the gate PASSES — the deep dive proceeds exactly as before). Claims
// in_competence so the deterministic demo/test path is in-circle.
function mockCircleCompetenceForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    cashflow_drivers: [
      { driver: `${companyLabel} recurring membership/subscription revenue grounded in the 10-K`, citation: primaryCite },
    ],
    predictability_breakers: [
      { breaker: `Cyclicality or customer-concentration risk that would make ${companyLabel}'s cashflows unpredictable`, citation: secondaryCite },
    ],
    competence_reasoning: `${companyLabel}'s cashflow engine is understandable and demonstrated from primary filings.`,
    in_competence: true,
    proposed_sources: groundedSources,
  }
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

// MOAT lane (spec-correct decomposition): emits its OWN moat_rubric + runway_rubric (Mechanisms 1+2) +
// the holistic moat_class/runway fallback. Cited rows cite the grounded mock source_ids so they verify
// against the corpus. Upward-to-monopoly carries 2 cited adjustment-evidence items (asymmetric burden).
function mockMoatLaneForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    finding_summary: `${companyLabel} moat lane: wide-to-monopoly durable competitive position with proven reinvestment runway.`,
    confidence: 'medium' as const,
    caveats: [`Mock moat finding — not investment-grade; run a real provider before any decision.`],
    moat_class: 'monopoly' as const,
    runway: 'proven' as const,
    moat_rubric: {
      rubric_scores: [
        { id: 'M1', score: 2 },
        { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: primaryCite },
        { id: 'M4', score: 2, citation_hash: secondaryCite },
        { id: 'M5', score: 2, citation_hash: primaryCite },
        { id: 'M6', score: 2, citation_hash: secondaryCite },
      ],
      proposed_tier: 'monopoly' as const,
      adjustment_evidence: [
        { claim: `${companyLabel} sustained share gains vs funded entrants over the last decade.`, citation_hash: primaryCite },
        { claim: `${companyLabel} shows documented pricing power without volume loss.`, citation_hash: secondaryCite },
      ],
    },
    runway_rubric: {
      rubric_scores: [
        { id: 'R1', score: 2 },
        { id: 'R2', score: 2, citation_hash: primaryCite },
        { id: 'R3', score: 2, citation_hash: secondaryCite },
      ],
      proposed_tier: 'proven' as const,
      adjustment_evidence: [],
    },
    proposed_sources: groundedSources,
  }
}

// SHARIAH lane (spec-correct decomposition): emits its OWN sector_status + impermissible_income overlay;
// the harness recomputes the AAOIFI ratios from EDGAR + market cap + this lane-supplied amount.
function mockShariahLaneForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    finding_summary: `${companyLabel} shariah lane: permissible primary business; trace interest income on cash.`,
    confidence: 'medium' as const,
    caveats: [`Mock shariah finding — not investment-grade; run a real provider before any decision.`],
    sector_status: 'compliant' as const,
    impermissible_income: 0,
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
    // NOTE (spec-correct decomposition): moat_class / runway / moat_rubric / runway_rubric now come from
    // the MOAT lane (mockMoatLaneForTicker) and the sector_status / impermissible_income overlay from the
    // SHARIAH lane (mockShariahLaneForTicker). The synthesis schema no longer carries them.
    growth_assumptions: `${companyLabel} is credited the demonstrated owner-earnings/share CAGR — here illustrated at a near-term rate of 0.08 (above the 0.03 GDP threshold, so flagged as a moat-durability claim that widens the margin of safety), passed through the named single_growth_cap of 0.15 (the agent may argue the rate down, never up; no reinvestment×ROIC band). Owner earnings $14,000M ÷ 1,000M shares = $14/sh. Two-stage DCF (10yr horizon, linear fade over years 6–10 to a uniform 1.5% terminal, flat 10% discount) → fair value ≈ $237.64/sh (implied ≈17.0× OE, under the 18× fv_cap_multiple — a surfaced cap_exceeded flag, not a hard truncation). Uniform 25% MoS → buy below ≈ $178.23.`,
    owner_earnings_bridge: {
      // Company TOTALS in $millions, judgment-grounded. OE_total = 14000+4000−3000−2000−(−1000) = 14000.
      // shares_outstanding 1000M → OE/sh = 14000/1000 = 14.
      net_income: 14000,
      depreciation_amortization: 4000,
      maintenance_capex: 3000,
      maintenance_capex_proxy_tier: '50' as const,
      stock_based_comp: 2000,
      normalized_working_capital_change: -1000,  // negative = structural WC release, adds to OE
      shares_outstanding: 1000,
    },
    roic: 0.25,
    // Normalized INCREMENTAL ROIC (fraction) — reported context (no longer drives a band verdict; R1).
    incremental_roic: 0.20,
    reinvestment_rate: 0.40,
    // RELIGHTENED DECISION (R1): the MODEL proposes the buy-below WITH its cited valuation reasoning. The
    // deterministic side records this number as the buy-below and only sanity-checks it.
    // Deterministic per ticker so tests are stable, and chosen so the cohorts exercise BOTH sanity paths:
    //   - capital-light names (MSFT/GOOGL): an OVER-OPTIMISTIC assumed_growth (0.18, above the 0.15
    //     single_growth_cap) paired with an ATTRACTIVE valuation_status — trips the symmetric sanity-check
    //     (over-optimistic catch). proposed_buy_below set high so it is clearly the model's own number.
    //   - other names: a modest, defensible assumed_growth (0.06) — a CLEAN case (no sanity flag).
    proposed_buy_below: isCapitalLightMock(ticker) ? 320 : 150,
    valuation_reasoning: {
      owner_earnings_basis: `${companyLabel} FY25 owner earnings ≈ $14B per the latest 10-K (NI + D&A − maintenance capex − SBC − ΔWC).`,
      // Founding-risk fix: ground both valuation claims in the decision agent's OWN proposed (and verified)
      // primary source so the harness's deterministic synthesis own-grounding cite-check passes.
      owner_earnings_citation: `mock_${sourceSlugForTicker(ticker)}_primary`,
      assumed_growth: isCapitalLightMock(ticker) ? 0.18 : 0.06,
      assumed_growth_rationale: isCapitalLightMock(ticker)
        ? `${companyLabel} sustains capital-light operating-leverage growth per the latest 10-K cloud/services segment margin expansion at low incremental reinvestment.`
        : `${companyLabel} sustains modest mid-single-digit growth = reinvestment 40% × 20% incremental ROIC (the funded identity), cited to the latest 10-K segment capex.`,
      assumed_growth_citation: `mock_${sourceSlugForTicker(ticker)}_primary`,
    },
    // judgment-objectivity-layer-spec Mechanism 5: the synthesis_response that answers the red team's
    // strongest objection now comes from the dedicated red-team-response call (mockRedTeamResponseForTicker
    // / schema BuffettMungerRedTeamResponse) — NOT this synthesis schema. The synthesis only echoes the
    // objection text (optional, no obligation).
    red_team_strongest_objection: `${companyLabel} revenue is concentrated in a few categories — a shock could compress the moat.`,
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

// judgment-objectivity-layer-spec Mechanism 5 — the dedicated red-team-RESPONSE call (the focused
// decomposition). The mock answers the strongest objection with evidence cited to the grounded corpus so
// the demo + tests render an addressed objection (no red_team_objection_unaddressed flag).
function mockRedTeamResponseForTicker(ticker: string) {
  return {
    synthesis_response: {
      mode: 'answered_with_evidence' as const,
      text: `Concentration is real but diversified across regions and members per the 10-K; renewal rates and pricing power (cited) keep the moat intact. No downgrade warranted.`,
    },
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

// judgment-objectivity-layer-spec Mechanism 5 — Red-Team Pass. The mock emits a plausible adversarial
// output whose strongest objection is cited to the GROUNDED corpus (the same source_ids the harness
// verifies), so the cite-check passes and the demo/tests render a real objection + synthesis response.
function mockRedTeamForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    strongest_bear_case: `${companyLabel}'s premium valuation already prices in a decade of flawless execution; any reinvestment-runway disappointment compresses the multiple hard.`,
    weakest_rubric_items: [
      { lane: 'moat', item: 'M5', why: 'Customer-switching evidence rests on renewal rates, not contractual lock-in.' },
      { lane: 'valuation', item: 'R2', why: 'Visible-headroom claim is qualitative, not quantified against TAM.' },
    ],
    moat_decay_scenario: `A well-funded entrant undercuts on price and erodes ${companyLabel}'s share over 5-7 years as switching costs prove softer than the lanes assume.`,
    growth_credit_attack: `The credited incremental ROIC assumes reinvestment at historical rates; if it mean-reverts toward the cost of capital, the credited growth and the fair value both fall sharply.`,
    shared_narrative_blindspots: [
      `Every lane read the same filings and inherited management's framing of the moat as durable; none stress-tested a demand shock.`,
    ],
    strongest_objection: {
      claim: `${companyLabel}'s growth credit depends on incremental ROIC staying above cost of capital, which most high-ROIC firms fail to sustain for a decade.`,
      severity: 'high' as const,
      citations: [primaryCite, secondaryCite],
    },
    proposed_sources: groundedSources,
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
        case 'BuffettMungerCircleCompetence':
          return mockCircleCompetenceForTicker(ticker)
        case 'BuffettMungerQuickScreen':
          return mockQuickScreenForTicker(ticker)
        case 'BuffettMungerLaneFinding':
          return mockLaneFindingForTicker(ticker)
        case 'BuffettMungerMoatLane':
          return mockMoatLaneForTicker(ticker)
        case 'BuffettMungerShariahLane':
          return mockShariahLaneForTicker(ticker)
        case 'BuffettMungerSynthesisDecision':
          return mockSynthesisDecisionForTicker(ticker)
        case 'BuffettMungerRedTeam':
          return mockRedTeamForTicker(ticker)
        case 'BuffettMungerRedTeamResponse':
          return mockRedTeamResponseForTicker(ticker)
        case 'BuffettMungerGroundedResearch':
          return mockGroundedResearchForTicker(ticker)
        default:
          return buffettMungerAnalysisForTicker(ticker)
      }
    }

    return buffettMungerAnalysisForTicker(extractTicker(request.prompt))
  }
}
