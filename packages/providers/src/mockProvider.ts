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
// durable predictability by citing the grounded mock primary/secondary source_ids for BOTH clauses (with
// substantive TEXT) so the harness cite-check verifies them and the gate PASSES — the deep dive proceeds
// exactly as before. Reports business_understanding='understood' (Bug B enum) so the test path
// is in-circle.
function mockCircleCompetenceForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    // Two cited clauses each: meets the circle-gate default evidence floor (min 2 grounded drivers +
    // 2 grounded breakers), mirroring what the hardened gate prompt asks a live model for.
    understanding_drivers: [
      { driver: `${companyLabel} recurring membership/subscription revenue grounded in the 10-K`, citation: primaryCite },
      { driver: `${companyLabel} installed-base renewal economics disclosed in the annual filing`, citation: primaryCite },
    ],
    key_moving_parts: [
      { breaker: `Cyclicality or customer-concentration risk that would make ${companyLabel}'s cashflows unpredictable`, citation: secondaryCite },
      { breaker: `Competitive pricing pressure compressing ${companyLabel}'s unit economics`, citation: secondaryCite },
    ],
    competence_reasoning: `${companyLabel}'s cashflow engine is understandable and its cashflows are durably predictable, demonstrated from primary filings.`,
    business_understanding: 'understood',
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

// MOAT lane (B6 + runway reframe): emits TWO GROUNDED CITED THESES — the moat thesis (moat_drivers +
// proposed_moat_class + moat_reasoning) and the runway thesis (runway_drivers + proposed_runway +
// runway_reasoning) — both mirroring the circle gate. Each driver cites a grounded mock source_id so it
// verifies against the corpus; 3 grounded distinct moat advantages clear the monopoly threshold (>=3) and
// 2 grounded distinct runway headroom drivers clear the proven threshold (>=2).
function mockMoatLaneForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    finding_summary: `${companyLabel} moat lane: wide-to-monopoly durable competitive position with proven reinvestment runway.`,
    confidence: 'medium' as const,
    caveats: [`Mock moat finding — not investment-grade; run a real provider before any decision.`],
    moat_drivers: [
      { advantage: `${companyLabel} documented pricing power — price increases stick without volume loss.`, citation: primaryCite, moat_type: 'brand' as const },
      { advantage: `${companyLabel} sustained market-share gains versus funded entrants over the last decade.`, citation: secondaryCite, moat_type: 'scale_advantage' as const },
      { advantage: `${companyLabel} cost/scale + distribution advantage competitors cannot replicate.`, citation: primaryCite, moat_type: 'cost_advantage' as const },
    ],
    // S3 pillar extensions: a grounded stable direction + an in-line peer judgment (labeled model-asserted).
    moat_direction: 'stable' as const,
    direction_drivers: [
      { evidence: `${companyLabel} share and price realization stable across the filing window.`, citation: primaryCite },
    ],
    direction_reasoning: `No cited evidence of erosion or widening for ${companyLabel}.`,
    peer_standout: {
      peers: [{ name: 'Mock Peer Co', gross_margin_note: '~30% FY2025 gross margin' }],
      judgment: 'in_line' as const,
      reasoning: `${companyLabel} gross margin sits roughly in line with the named mock peer.`,
    },
    proposed_moat_class: 'monopoly' as const,
    moat_reasoning: `${companyLabel} combines durable pricing power, share durability, and a structural cost/scale advantage — a grounded monopoly-class moat.`,
    runway: 'proven' as const,
    runway_drivers: [
      { headroom: `${companyLabel} under-penetrated emerging markets — decades of volume runway per the filing.`, citation: primaryCite },
      { headroom: `${companyLabel} announced capacity expansion deploys incremental capital at high ROIC.`, citation: secondaryCite },
    ],
    proposed_runway: 'proven' as const,
    runway_reasoning: `${companyLabel} can deploy incremental capital at high ROIC for years with visible remaining headroom — a grounded proven runway.`,
    proposed_sources: groundedSources,
  }
}

// UNDERSTAND lane (B3, Phase 4): the book's seven-item one-pager distillation.
function mockUnderstandLaneForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    finding_summary: `${companyLabel} understand lane: membership-driven bulk retail with fee-led profits.`,
    confidence: 'medium' as const,
    caveats: [`Mock understand finding — not investment-grade; run a real provider before any decision.`],
    one_pager: {
      plain_english: `${companyLabel} sells memberships that grant access to low-priced bulk goods.`,
      segments: ['Core operations', 'International', 'Digital'],
      revenue_drivers: ['Membership fees', 'Merchandise sales at thin markups'],
      most_profitable_segments: ['Membership fees (the bulk of operating profit)'],
      strengths: ['Renewal economics', 'Scale purchasing power'],
      weak_spots: ['Thin merchandise margins leave little room for error'],
      growth_levers: ['New locations', 'Fee increases'],
    },
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

// MANAGEMENT lane (S5, Phase 3 pillars): emits the two-trait judgment — integrity (communication +
// DEF 14A comp structure) and talent (capital allocation reconciled with the injected T0 block) —
// each cited to grounded mock source_ids so the resolver honors them.
function mockManagementLaneForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    finding_summary: `${companyLabel} management lane: candid communication, owner-aligned pay, disciplined capital allocation.`,
    confidence: 'medium' as const,
    caveats: [`Mock management finding — not investment-grade; run a real provider before any decision.`],
    integrity: {
      communication_observations: [
        { observation: `${companyLabel} MD&A discusses setbacks plainly and quantifies them.`, citation: primaryCite },
      ],
      comp_structure: {
        summary: `Cash bonus on ROIC and per-share FCF growth; PSUs on 3-year relative TSR.`,
        incentive_metrics: ['ROIC', 'FCF/share', 'relative TSR'],
        alignment: 'aligned' as const,
        citation: secondaryCite,
      },
      integrity_flags: [],
      proposed_integrity: 'clean' as const,
      integrity_reasoning: `${companyLabel} communicates candidly and pays on owner-aligned metrics.`,
    },
    talent: {
      talent_drivers: [
        { evidence: `${companyLabel} a decade of high returns on incremental capital through two cycles.`, citation: primaryCite },
        { evidence: `${companyLabel} buybacks concentrated in drawdown years below intrinsic value.`, citation: secondaryCite },
      ],
      proposed_talent: 'excellent' as const,
      talent_reasoning: `${companyLabel} capital-allocation record reconciles with the harness T0 observations.`,
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
    roic: 0.25,
    // Normalized INCREMENTAL ROIC (fraction) — reported context (no longer drives a band verdict; R1).
    incremental_roic: 0.20,
    reinvestment_rate: 0.40,
    // MARGIN-OF-SAFETY AUDIT SURFACE — business-specific forward-looking risk judgments (required +
    // substantive; NOT cite-gated). Concrete assumption that, if wrong, breaks the thesis + observable
    // invalidating events tied to this name (not boilerplate).
    key_wrong_assumption: `${companyLabel}'s assumed ${isCapitalLightMock(ticker) ? '18%' : '6%'} durable owner-earnings growth holds — if pricing power or segment margins erode, the moat-durability premium and the thesis break.`,
    thesis_break_triggers: [
      `${companyLabel} gross margin falls below the current band for two consecutive fiscal years.`,
      `Top-customer / top-segment concentration rises materially (a funded entrant takes share).`,
      `Incremental ROIC on reinvested owner earnings drops below the 10% discount rate.`,
    ],
    // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — the margin rests on TWO substitutable sources:
    // the price-vs-value gap and moat durability. Business-specific per-source reasoning; the moat reasoning
    // anchors on the GROUNDED moat thesis the moat gate verified. adequacy is audit-only (never a gate).
    margin_of_safety: {
      sources: ['price', 'moat'] as ('price' | 'moat')[],
      price_gap_reasoning: `${companyLabel} trades at a discount to the model's proposed_buy_below, supplying a price-vs-value cushion against estimate error.`,
      moat_durability_reasoning: `${companyLabel}'s grounded wide/monopoly moat (verified by the moat gate) lets time bail out modest valuation error, so a smaller price discount is required.`,
      adequacy: 'adequate' as const,
      reasoning: `The price gap and the grounded moat durability jointly supply an adequate margin for ${companyLabel}; either source alone would be thinner.`,
    },
    // RELIGHTENED DECISION (R1): the MODEL proposes the buy-below WITH its cited valuation reasoning. The
    // deterministic side records this number as the buy-below and only sanity-checks it.
    // Deterministic per ticker so tests are stable, and chosen so the cohorts exercise BOTH sanity paths:
    //   - capital-light names (MSFT/GOOGL): an OVER-OPTIMISTIC assumed_growth (0.18, above the 0.15
    //     single_growth_cap) paired with an ATTRACTIVE valuation_status — trips the symmetric sanity-check
    //     (over-optimistic catch). proposed_buy_below set high so it is clearly the model's own number.
    //   - other names: a modest, defensible assumed_growth (0.06) — a CLEAN case (no sanity flag).
    proposed_buy_below: isCapitalLightMock(ticker) ? 320 : 150,
    valuation_reasoning: {
      // E2: the OE basis/citation/bridge are retired — growth (cited) + the exit multiple are the
      // model's remaining valuation judgments; the harness owns the FCF basis.
      assumed_growth: isCapitalLightMock(ticker) ? 0.18 : 0.06,
      assumed_growth_rationale: isCapitalLightMock(ticker)
        ? `${companyLabel} sustains capital-light operating-leverage growth per the latest 10-K cloud/services segment margin expansion at low incremental reinvestment.`
        : `${companyLabel} sustains modest mid-single-digit growth = reinvestment 40% × 20% incremental ROIC (the funded identity), cited to the latest 10-K segment capex.`,
      assumed_growth_citation: `mock_${sourceSlugForTicker(ticker)}_primary`,
    },
    // judgment-objectivity-layer-spec Mechanism 5: the synthesis_response that answers the red team's
    // strongest objection comes from the INVERSION pass (mockInversionForTicker / schema
    // BuffettMungerInversion) — NOT this synthesis schema. The synthesis only echoes the
    // objection text (optional, no obligation).
    red_team_strongest_objection: `${companyLabel} revenue is concentrated in a few categories — a shock could compress the moat.`,
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

// Phase 2 V4 — the dedicated always-on VALUATION stage (valuation_judgment_drafted): the mock serves
// the same bridge/buy-below/status/reasoning the monolithic synthesis used to carry (the slimmed
// decision schema strips them there; the stage is the owner now).
function mockValuationReasoningForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  return {
    valuation_reasoning: {
      assumed_growth: isCapitalLightMock(ticker) ? 0.18 : 0.06,
      assumed_growth_rationale: isCapitalLightMock(ticker)
        ? `${companyLabel} sustains capital-light operating-leverage growth per the latest 10-K cloud/services segment margin expansion at low incremental reinvestment.`
        : `${companyLabel} sustains modest mid-single-digit growth = reinvestment 40% × 20% incremental ROIC (the funded identity), cited to the latest 10-K segment capex.`,
      assumed_growth_citation: `mock_${sourceSlugForTicker(ticker)}_primary`,
      proposed_buy_below: isCapitalLightMock(ticker) ? 320 : 150,
      valuation_status: 'EXPENSIVE' as const,
      industry_exit_multiple: { multiple: 15, basis_note: 'Mock industry norm: ~15× FCF (not investment-grade).' },
    },
    proposed_sources: mockSourcesForTicker(ticker),
  }
}

// E1 — the Munger INVERSION pass (replaces the red team). The mock argues the case against itself with
// a strongest objection cited to the GROUNDED corpus (the same source_ids the harness verifies), so the
// cite-check passes and the demo/tests render a real cite-checked inversion on the lattice.
function mockInversionForTicker(ticker: string) {
  const companyLabel = companyLabelForTicker(ticker)
  const groundedSources = mockSourcesForTicker(ticker)
  const primaryCite = groundedSources[0].source_id
  const secondaryCite = groundedSources[1].source_id
  return {
    strongest_case_against: `${companyLabel}'s premium valuation already prices in a decade of flawless execution; any reinvestment-runway disappointment compresses the multiple hard.`,
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
  // Grounded contract: the holding review now runs through the grounded-agent path. The mock proposes
  // real-shaped primary sources (the harness fetches + content-hashes them) and cites the SAME verified
  // source_ids in its judgment, so the harness cite-check verifies them and the thesis_health is emitted
  // as grounded (the deterministic demo/test path stays in-grounding, no fail-closed degrade).
  const groundedSources = mockSourcesForTicker(ticker)
  return {
    thesis_health: 'HEALTHY',
    action_stance: 'HOLD',
    rationale: 'The original Buffett-Munger thesis remains intact: durable moat, aligned management, Shariah-compliant operations, and no evidence of thesis drift.',
    evidence_summary: 'Reviewed the existing research case, source ledger references, holding cost basis, and latest valuation snapshot.',
    uncertainty: 'Needs a refreshed primary-source review after the next quarterly filing.',
    next_review_at: '2026-09-30',
    source_ids: groundedSources.map((s) => s.source_id),
    proposed_sources: groundedSources,
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
        case 'BuffettMungerUnderstandLane':
          return mockUnderstandLaneForTicker(ticker)
        case 'BuffettMungerManagementLane':
          return mockManagementLaneForTicker(ticker)
        case 'BuffettMungerShariahLane':
          return mockShariahLaneForTicker(ticker)
        case 'BuffettMungerSynthesisDecision':
          return mockSynthesisDecisionForTicker(ticker)
        case 'BuffettMungerValuationReasoning':
          return mockValuationReasoningForTicker(ticker)
        case 'BuffettMungerInversion':
          return mockInversionForTicker(ticker)
        case 'BuffettMungerGroundedResearch':
          return mockGroundedResearchForTicker(ticker)
        default:
          return buffettMungerAnalysisForTicker(ticker)
      }
    }

    return buffettMungerAnalysisForTicker(extractTicker(request.prompt))
  }
}
