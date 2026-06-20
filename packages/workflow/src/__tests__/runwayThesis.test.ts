import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import { resolveJudgmentTiers } from '../researchSwarmCompute'

// ---------------------------------------------------------------------------
// Grounded-thesis RUNWAY resolver — the runway axis no longer scores a per-row R1-R3 rubric (mirror of
// the moat reframe, db691ac). The model emits a GROUNDED CITED THESIS (runway_drivers + proposed_runway),
// the harness cite-verifies each driver (the SAME primitive the circle + moat use), the EDGAR quant
// (computeRunwayAnchor) CORROBORATES, and the tier resolves from the grounded thesis. Unlike moat, runway
// is NOT a verdict gate — it feeds growth credit — so fail-closed = a CONSERVATIVE runway (no RESEARCH_MORE);
// runway_grounding_unmet / quant_contradicts_runway are ADVISORY flags. These tests lock invariants 1-7.
// ---------------------------------------------------------------------------

// A series with a strongly positive incremental ROIC (a STRONG runway quant signal): owner-earnings /
// invested-capital grows year over year so computeRunwayAnchor's R1 scores 2.
function strongQuantSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const scale = Math.pow(1.12, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: 600 * scale,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// A series with a NEGATIVE/zero incremental ROIC (a WEAK runway quant signal): net income flat while
// invested capital balloons, so the incremental return on new capital is non-positive (R1 -> 0).
function weakQuantSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: 100,
      revenue_musd: 1000,
      operating_income_musd: 120,
      income_tax_expense_musd: 25,
      // Invested capital grows over time while income is flat -> incremental ROIC <= 0.
      stockholders_equity_musd: 500 + (9 - i) * 400,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// The harness-verified resolver 10-K source id (force-added to the runway corpus so the runway thesis can
// cite it even though the lane did not fetch it — mirror of the moat reframe).
const RESOLVER_10K = 'sec_edgar_10k_0000021344_fy2024'
const SECONDARY = 'company_capacity_disclosure_2024'
const verified = new Set<string>([RESOLVER_10K, SECONDARY])

function runway(args: Parameters<typeof resolveJudgmentTiers>[0]) {
  return resolveJudgmentTiers(args).runway!
}

describe('grounded-thesis runway resolver — invariant 1: grounded proven thesis resolves proven', () => {
  it('>=2 grounded runway_drivers + proposed proven -> resolved proven', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'New-market entry: under 10% penetrated in the largest segment per the 10-K', citation: RESOLVER_10K },
          { headroom: 'Announced capacity expansion deploys capital at >20% incremental ROIC', citation: SECONDARY },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'Durable reinvestment headroom at high ROIC.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).toBe('proven')
    expect(result.runway_grounding_unmet).not.toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 2: ungrounded thesis fails closed', () => {
  it('drivers cited but citations do NOT verify -> none/limited + runway_grounding_unmet (NOT proven)', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'New markets', citation: 'unverifiable_url_1' },
          { headroom: 'Capacity expansion', citation: 'unverifiable_url_2' },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'Claims a proven runway.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).not.toBe('proven')
    expect(result.runway_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 3: empty headroom text does not count', () => {
  it('empty headroom + verified citation -> not grounded (mirror circle/moat required-text)', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: '   ', citation: RESOLVER_10K },
          { headroom: 'Announced capacity expansion', citation: SECONDARY },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'One driver is empty.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    // Only one grounded driver (the empty-text one does not count) -> below the >=2 proven threshold.
    expect(result.resolved_runway).not.toBe('proven')
    expect(result.runway_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 4: quant cannot substitute', () => {
  it('0 grounded drivers + STRONG quant -> none/limited (quant alone never reaches proven)', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'Reinvestment headroom', citation: 'unverifiable_a' },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'Strong numbers, no grounded thesis.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).not.toBe('proven')
    expect(result.runway_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 5: quant does not override a grounded thesis', () => {
  it('grounded proven thesis + WEAK quant -> resolved proven + advisory quant_contradicts_runway', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'New-market entry under 10% penetrated', citation: RESOLVER_10K },
          { headroom: 'Announced capacity expansion at high ROIC', citation: SECONDARY },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'Grounded proven runway despite weak reported incremental ROIC.',
      },
      series: weakQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).toBe('proven')
    expect(result.runway_grounding_unmet).not.toBe(true)
    expect(result.quant_contradicts_runway).toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 6: resolved = min(proposed, supported-by-count)', () => {
  it('proposed limited with >=2 grounded drivers -> resolved limited (proposal is the floor, not inflated)', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'New-market entry under 10% penetrated', citation: RESOLVER_10K },
          { headroom: 'Announced capacity expansion at high ROIC', citation: SECONDARY },
        ],
        proposed_runway: 'limited',
        runway_reasoning: 'Genuinely limited despite two grounded drivers.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).toBe('limited')
    expect(result.runway_grounding_unmet).not.toBe(true)
  })

  it('proposed proven with only 1 grounded driver -> resolved limited + runway_grounding_unmet', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'New-market entry under 10% penetrated', citation: RESOLVER_10K },
          { headroom: 'Unverifiable second driver', citation: 'unverifiable_b' },
        ],
        proposed_runway: 'proven',
        runway_reasoning: 'Claims proven on one grounded driver.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).toBe('limited')
    expect(result.runway_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis runway resolver — invariant 7 + no-thesis fail-closed', () => {
  it('proposed none with grounded drivers -> resolved none, NOT runway_grounding_unmet (genuine none)', () => {
    const result = runway({
      runwayThesis: {
        runway_drivers: [
          { headroom: 'Mature business with little remaining headroom', citation: RESOLVER_10K },
        ],
        proposed_runway: 'none',
        runway_reasoning: 'Genuinely no reinvestment runway.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_runway).toBe('none')
    expect(result.runway_grounding_unmet).not.toBe(true)
  })

  it('no runwayThesis supplied -> none (conservative) + judgment_degraded (silent-skip guard)', () => {
    const result = runway({ series: strongQuantSeries(), verifiedCitationHashes: verified })
    expect(result.resolved_runway).toBe('none')
    expect(result.judgment_degraded).toBe('rubric_not_emitted')
  })
})
