import { describe, expect, it } from 'vitest'
import type { AnnualFacts } from '../secEdgar'
import { resolveJudgmentTiers } from '../researchSwarmCompute'

// ---------------------------------------------------------------------------
// Grounded-thesis MOAT resolver (B6 reframe) — the moat axis no longer scores a per-row M1-M6 rubric.
// The model emits a GROUNDED CITED THESIS (moat_drivers + proposed_moat_class), the harness cite-verifies
// each driver (mirror of the circle gate), the EDGAR quant (computeMoatAnchor) CORROBORATES, and the tier
// resolves from the grounded thesis. These tests lock the fail-closed + corroboration invariants (1-7).
// ---------------------------------------------------------------------------

// A 10-year series with high ROIC + tight margins (a STRONG quant signal). Mirrors judgmentAnchor.test.
function strongQuantSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const scale = Math.pow(1.10, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: 1000 * scale,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// A 10-year series with LOW ROIC + a wildly swinging margin (a WEAK quant signal).
function weakQuantSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const op = i % 2 === 0 ? 50 : 120
    out.push({
      fiscal_year: 2025 - i,
      currency: 'USD',
      net_income_musd: 40,
      revenue_musd: 1000,
      operating_income_musd: op,
      income_tax_expense_musd: Math.round(op * 0.21),
      stockholders_equity_musd: 1000,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// The harness-verified resolver 10-K source id (the id the lane CAN cite because it's force-added to the
// moat corpus). Mirrors the KO shape: the moat thesis grounds by citing the resolver filing id.
const RESOLVER_10K = 'sec_edgar_10k_0000021344_fy2024'
const SECONDARY = 'company_segment_disclosure_2024'
const verified = new Set<string>([RESOLVER_10K, SECONDARY])

function moat(args: Parameters<typeof resolveJudgmentTiers>[0]) {
  return resolveJudgmentTiers(args).moat!
}

describe('grounded-thesis moat resolver — invariant 1: grounded wide thesis resolves wide', () => {
  it('>=2 grounded moat_drivers + proposed wide -> resolved wide (gate passes)', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power: repriced upward with no volume loss', citation: RESOLVER_10K },
          { advantage: 'Global brand + distribution scale advantage', citation: SECONDARY },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Durable pricing power + brand + scale.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('wide')
    expect(result.moat_grounding_unmet).not.toBe(true)
  })
})

describe('grounded-thesis moat resolver — invariant 2: ungrounded thesis fails closed to narrow', () => {
  it('drivers cited but citations do NOT verify -> narrow + moat_grounding_unmet', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power', citation: 'unverifiable_url_1' },
          { advantage: 'Brand', citation: 'unverifiable_url_2' },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Claims a wide moat.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('narrow')
    expect(result.moat_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis moat resolver — invariant 3: empty advantage text does not count', () => {
  it('empty advantage + verified citation -> not grounded (mirror circle required-text)', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: '   ', citation: RESOLVER_10K },
          { advantage: 'Brand', citation: SECONDARY },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'One driver is empty.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    // Only one grounded driver (the empty-text one does not count) -> below the >=2 wide threshold.
    expect(result.resolved_moat_class).not.toBe('wide')
    expect(result.moat_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis moat resolver — invariant 4: quant cannot substitute (A2 preserved)', () => {
  it('0 grounded drivers + STRONG quant -> narrow (quant alone never passes the gate)', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power', citation: 'unverifiable_a' },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Strong numbers, no grounded thesis.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('narrow')
    expect(result.moat_grounding_unmet).toBe(true)
  })
})

describe('grounded-thesis moat resolver — invariant 5: quant does not override a grounded thesis', () => {
  it('grounded wide thesis + WEAK quant -> resolved wide + advisory quant_contradicts_moat (not blocked)', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power: repriced upward with no volume loss', citation: RESOLVER_10K },
          { advantage: 'Brand + scale advantage', citation: SECONDARY },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'Grounded wide thesis despite weak reported numbers.',
      },
      series: weakQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('wide')
    expect(result.moat_grounding_unmet).not.toBe(true)
    expect(result.quant_contradicts_moat).toBe(true)
  })
})

describe('grounded-thesis moat resolver — invariant 6: the KO shape resolves wide', () => {
  it('>=2 grounded moat_drivers citing the verified resolver id -> wide', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power: concentrate price increases stick', citation: RESOLVER_10K },
          { advantage: 'Brand strength sustains share', citation: RESOLVER_10K },
        ],
        proposed_moat_class: 'wide',
        moat_reasoning: 'KO grounds on the resolver 10-K it did not fetch itself.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('wide')
  })
})

describe('grounded-thesis moat resolver — invariant 7 + monopoly threshold', () => {
  it('model proposes narrow -> resolved narrow, NOT moat_grounding_unmet (genuinely narrow PASS)', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'A modest local advantage', citation: RESOLVER_10K },
        ],
        proposed_moat_class: 'narrow',
        moat_reasoning: 'Genuinely narrow.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('narrow')
    expect(result.moat_grounding_unmet).not.toBe(true)
  })

  it('monopoly needs >=3 grounded drivers; only 2 grounded -> fails closed below monopoly + unmet', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power', citation: RESOLVER_10K },
          { advantage: 'Brand', citation: SECONDARY },
        ],
        proposed_moat_class: 'monopoly',
        moat_reasoning: 'Claims monopoly on two grounded drivers.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).not.toBe('monopoly')
    expect(result.moat_grounding_unmet).toBe(true)
  })

  it('monopoly with >=3 grounded drivers -> resolved monopoly', () => {
    const result = moat({
      moatThesis: {
        moat_drivers: [
          { advantage: 'Pricing power', citation: RESOLVER_10K },
          { advantage: 'Brand', citation: SECONDARY },
          { advantage: 'Distribution scale', citation: RESOLVER_10K },
        ],
        proposed_moat_class: 'monopoly',
        moat_reasoning: 'Three grounded drivers support monopoly.',
      },
      series: strongQuantSeries(),
      verifiedCitationHashes: verified,
    })
    expect(result.resolved_moat_class).toBe('monopoly')
  })
})

describe('grounded-thesis moat resolver — no thesis fails closed', () => {
  it('no moatThesis supplied -> narrow + judgment_degraded (legacy tolerance / silent-skip guard)', () => {
    const result = moat({ series: strongQuantSeries(), verifiedCitationHashes: verified })
    expect(result.resolved_moat_class).toBe('narrow')
    expect(result.judgment_degraded).toBe('rubric_not_emitted')
  })
})
