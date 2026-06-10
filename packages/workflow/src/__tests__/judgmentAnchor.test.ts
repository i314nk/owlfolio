import { describe, expect, it } from 'vitest'
import { JUDGMENT_RUBRICS } from '@owlfolio/strategies/judgmentRubrics'
import type { AnnualFacts } from '../secEdgar'
import {
  computeMoatAnchor,
  computeRunwayAnchor,
  resolveRubricTier,
} from '../judgmentAnchor'

// A 10-year series where ROIC (NOPAT/invested-capital proxy) is comfortably > 15% every year and
// operating margin is held within a tight band. operating_income/equity chosen so each year's
// ROIC = op*(1-0.21)/equity >= 0.15 (op=300, equity=1000 -> 0.237). Margin = op/revenue held ~ 0.30.
function highRoicSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const fy = 2025 - i
    // Newest year (i=0) is the largest; the business grows revenue/op/equity ~10%/yr so invested
    // capital rises (incremental ROIC computable) while ROIC and operating margin stay high + tight.
    const scale = Math.pow(1.10, 9 - i)
    const revenue = 1000 * scale
    const op = revenue * 0.30
    const equity = 1000 * scale
    out.push({
      fiscal_year: fy,
      currency: 'USD',
      net_income_musd: op * 0.79,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: op * 0.21,
      stockholders_equity_musd: equity,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

// A series with low ROIC every year (op tiny vs equity) and a wildly swinging margin.
function lowRoicSeries(): AnnualFacts[] {
  const out: AnnualFacts[] = []
  for (let i = 0; i < 10; i += 1) {
    const fy = 2025 - i
    const revenue = 1000
    // operating income oscillates so the margin band blows past +-300bps, ROIC ~ 0.04
    const op = i % 2 === 0 ? 50 : 120
    out.push({
      fiscal_year: fy,
      currency: 'USD',
      net_income_musd: 40,
      revenue_musd: revenue,
      operating_income_musd: op,
      income_tax_expense_musd: Math.round(op * 0.21),
      stockholders_equity_musd: 1000,
      total_debt_musd: 0,
      cash_and_securities_musd: 0,
    })
  }
  return out
}

describe('computeMoatAnchor — mechanical anchor from computable rows (M1, M2)', () => {
  it('high-ROIC + tight-margin series -> M1=2, M2=2, anchor sub-score 4 -> wide anchor', () => {
    const anchor = computeMoatAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['M1']).toBe(2)
    expect(anchor.row_scores['M2']).toBe(2)
    expect(anchor.sub_score).toBe(4)
    // 4 computable points (the full computable max) maps to the WIDE anchor — the prior the lane
    // adjusts from. It cannot be 'monopoly' from computable rows alone (cited rows are needed).
    expect(anchor.anchor_tier).toBe('wide')
  })

  it('low-ROIC + swinging-margin series -> M1=0, M2=0, anchor sub-score 0 -> narrow anchor', () => {
    const anchor = computeMoatAnchor(lowRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['M1']).toBe(0)
    expect(anchor.row_scores['M2']).toBe(0)
    expect(anchor.sub_score).toBe(0)
    expect(anchor.anchor_tier).toBe('narrow')
  })

  it('fails closed to not-computable when the series is too short', () => {
    const anchor = computeMoatAnchor(highRoicSeries().slice(0, 1))
    expect(anchor.computable).toBe(false)
  })

  it('fails closed to not-computable on an empty series', () => {
    const anchor = computeMoatAnchor([])
    expect(anchor.computable).toBe(false)
  })
})

describe('computeRunwayAnchor — R1 from incremental ROIC', () => {
  it('high incremental ROIC -> R1=2, proven-leaning anchor', () => {
    const anchor = computeRunwayAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['R1']).toBe(2)
  })

  it('fails closed when incremental ROIC is not computable', () => {
    const anchor = computeRunwayAnchor([])
    expect(anchor.computable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveRubricTier — the bounded +-1 adjustment + citation enforcement.
// ---------------------------------------------------------------------------
const moat = JUDGMENT_RUBRICS.moat
const VERIFIED = new Set(['sha256:cite-a', 'sha256:cite-b', 'sha256:cite-c', 'sha256:cite-d'])

describe('resolveRubricTier — computable-row re-verification (lane cannot inflate)', () => {
  it('uses the harness score for computable rows even when the lane claims more', () => {
    // Lane claims M1=2,M2=2 but the harness computed M1=0,M2=0.
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 0, M2: 0 },
      laneRubricScores: [
        { id: 'M1', score: 2 },
        { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
        { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
      ],
      anchorTier: 'narrow',
      proposedTier: 'narrow',
      adjustmentEvidence: [],
      verifiedCitationHashes: VERIFIED,
    })
    // The two computable rows are forced to 0; the cited rows (8) stand -> total 8 if the lane controlled
    // them, but the resolved tier is the proposed tier (== anchor here), and the re-verified rows are 0.
    expect(result.resolved_row_scores['M1']).toBe(0)
    expect(result.resolved_row_scores['M2']).toBe(0)
    expect(result.resolved_tier).toBe('narrow')
  })
})

describe('resolveRubricTier — +-1 bound', () => {
  function citedRows(hashes: string[]) {
    return [
      { id: 'M1', score: 2 },
      { id: 'M2', score: 2 },
      ...hashes.map((h, idx) => ({ id: `M${idx + 3}`, score: 2, citation_hash: h })),
    ]
  }

  it('anchor wide + proposed monopoly with 2x evidence (upward) -> allowed', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: citedRows(['sha256:cite-a', 'sha256:cite-b', 'sha256:cite-c', 'sha256:cite-d']),
      anchorTier: 'wide',
      proposedTier: 'monopoly',
      adjustmentEvidence: [
        { claim: 'durable monopoly via X', citation_hash: 'sha256:cite-a' },
        { claim: 'failed entrant Y exited', citation_hash: 'sha256:cite-b' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('monopoly')
    expect(result.adjustment_applied).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('anchor wide + proposed narrow (2 tiers down) -> clamped to moderate + violation', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: citedRows(['sha256:cite-a', 'sha256:cite-b', 'sha256:cite-c', 'sha256:cite-d']),
      anchorTier: 'wide',
      proposedTier: 'narrow',
      adjustmentEvidence: [{ claim: 'patent cliff', citation_hash: 'sha256:cite-a' }],
      verifiedCitationHashes: VERIFIED,
    })
    // 2 tiers below wide is narrow; clamped to at most 1 below = moderate.
    expect(result.resolved_tier).toBe('moderate')
    expect(result.violations.some((v) => v.includes('2'))).toBe(true)
  })
})

describe('resolveRubricTier — citation enforcement', () => {
  function rows() {
    return [
      { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
      { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
      { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
      { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
      { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
    ]
  }

  it('uncited adjustment -> rejected, anchor stands', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: rows(),
      anchorTier: 'wide',
      proposedTier: 'moderate',
      adjustmentEvidence: [], // no citation
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('wide') // anchor stands
    expect(result.adjustment_applied).toBe(false)
    expect(result.violations.some((v) => v.toLowerCase().includes('uncited') || v.toLowerCase().includes('citation'))).toBe(true)
  })

  it('adjustment whose citation_hash does not verify against the corpus -> rejected, anchor stands', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: rows(),
      anchorTier: 'wide',
      proposedTier: 'moderate',
      adjustmentEvidence: [{ claim: 'regulatory change', citation_hash: 'sha256:NOT-IN-CORPUS' }],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('wide')
    expect(result.adjustment_applied).toBe(false)
  })
})

describe('resolveRubricTier — upward needs 2x evidence (asymmetry)', () => {
  function rows() {
    return [
      { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
      { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
      { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
      { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
      { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
    ]
  }

  it('downward adjustment needs only 1 cited evidence item -> allowed', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: rows(),
      anchorTier: 'wide',
      proposedTier: 'moderate',
      adjustmentEvidence: [{ claim: 'announced entrant', citation_hash: 'sha256:cite-a' }],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('moderate')
    expect(result.adjustment_applied).toBe(true)
  })

  it('upward adjustment with only 1 cited evidence item -> rejected (needs 2x), anchor stands', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: rows(),
      anchorTier: 'wide',
      proposedTier: 'monopoly',
      adjustmentEvidence: [{ claim: 'monopoly via X', citation_hash: 'sha256:cite-a' }],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('wide')
    expect(result.adjustment_applied).toBe(false)
    expect(result.violations.some((v) => v.toLowerCase().includes('2x') || v.toLowerCase().includes('upward'))).toBe(true)
  })
})

describe('resolveRubricTier — not-computable anchor fallback', () => {
  it('when the anchor is not computable, the lane full-rubric score stands (no +-1 clamp)', () => {
    // Lane proposes monopoly with a full cited rubric; the anchor could not be computed (no EDGAR).
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: undefined, // not computable
      laneRubricScores: [
        { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
        { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
      ],
      anchorTier: undefined,
      proposedTier: 'monopoly',
      adjustmentEvidence: [],
      verifiedCitationHashes: VERIFIED,
    })
    // Total cited score 12 -> monopoly; lane's full-rubric score stands.
    expect(result.anchor_computable).toBe(false)
    expect(result.resolved_tier).toBe('monopoly')
  })
})
