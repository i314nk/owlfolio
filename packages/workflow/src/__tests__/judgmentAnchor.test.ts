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
  it('high-ROIC + tight-margin series -> M1=2, M2=2, anchor sub-score 4 -> MODERATE anchor (capped)', () => {
    const anchor = computeMoatAnchor(highRoicSeries())
    expect(anchor.computable).toBe(true)
    if (!anchor.computable) return
    expect(anchor.row_scores['M1']).toBe(2)
    expect(anchor.row_scores['M2']).toBe(2)
    expect(anchor.sub_score).toBe(4)
    // SUBSTITUTION BOUNDARY: a perfect computable sub-score (4/4) anchors at MODERATE, NOT wide. The quant
    // corroborates but cannot SUBSTITUTE for a grounded qualitative moat thesis — wide/monopoly are
    // reachable only when the cite-verified qualitative rows (M3-M6) lift the grounded-row-sum. (Was 'wide'
    // — that asserted the hole: the moat gate passing on EDGAR quant alone.)
    expect(anchor.anchor_tier).toBe('moderate')
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

describe('resolveRubricTier — grounded-ceiling clamp (upward bump must be supported by grounded rows)', () => {
  // The CPRT-shaped failure: anchor computable=moderate (M1=2,M2=0), lane proposes WIDE with 3 verified
  // adjustment-evidence items, but EVERY cited moat row (M3..M6) cites a hash NOT in the corpus -> each
  // scores 0. Grounded total = 2 (M1) + 0 = 2 -> tierForScore = 'moderate'. The +-1 upward bump used to
  // manufacture WIDE off the adjustment evidence alone; the clamp denies it.
  it('CPRT shape: moderate->wide with ungrounded cited rows is clamped to the anchor (moderate)', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 0 },
      laneRubricScores: [
        { id: 'M1', score: 2 },
        { id: 'M2', score: 0 },
        // M3..M6 all cite hashes that DO NOT verify against the corpus -> each re-verified to 0.
        { id: 'M3', score: 2, citation_hash: 'sha256:UNVERIFIED-1' },
        { id: 'M4', score: 2, citation_hash: 'sha256:UNVERIFIED-2' },
        { id: 'M5', score: 2, citation_hash: 'sha256:UNVERIFIED-3' },
        { id: 'M6', score: 2, citation_hash: 'sha256:UNVERIFIED-4' },
      ],
      anchorTier: 'moderate',
      proposedTier: 'wide',
      // 3 verified adjustment-evidence items (would satisfy the 2x-upward bar on their own).
      adjustmentEvidence: [
        { claim: 'pricing power', citation_hash: 'sha256:cite-a' },
        { claim: 'share gains', citation_hash: 'sha256:cite-b' },
        { claim: 'competitor exit', citation_hash: 'sha256:cite-c' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('moderate') // NOT wide — grounded rows total 2 -> moderate
    expect(result.adjustment_applied).toBe(false)
    expect(result.grounding_capped).toBe(true)
    expect(result.violations.some((v) => v.includes('grounding-unmet'))).toBe(true)
  })

  it('legit grounded upward bump still works: moderate->wide with verified cited rows (grounded total >=7)', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 0 },
      laneRubricScores: [
        { id: 'M1', score: 2 },
        { id: 'M2', score: 0 },
        // M3..M6 verified -> +8; grounded total = 2 + 8 = 10 -> tierForScore 'monopoly' (>= wide).
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
        { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
      ],
      anchorTier: 'moderate',
      proposedTier: 'wide',
      adjustmentEvidence: [
        { claim: 'pricing power', citation_hash: 'sha256:cite-a' },
        { claim: 'share gains', citation_hash: 'sha256:cite-b' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('wide')
    expect(result.adjustment_applied).toBe(true)
    expect(result.grounding_capped).toBe(false)
  })

  it('downward bump is unaffected by the grounded ceiling (conservative downgrade allowed)', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: [
        { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
        { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
      ],
      anchorTier: 'wide',
      proposedTier: 'moderate',
      adjustmentEvidence: [{ claim: 'patent cliff', citation_hash: 'sha256:cite-a' }],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('moderate') // conservative downgrade, not capped up
    expect(result.adjustment_applied).toBe(true)
    expect(result.grounding_capped).toBe(false)
  })

  it('runway lane: limited->proven with ungrounded R2/R3 is clamped to the anchor (limited)', () => {
    const runway = JUDGMENT_RUBRICS.runway
    const result = resolveRubricTier({
      rubric: runway,
      anchorScores: { R1: 2 }, // R1=2 -> sub-score 2 -> anchor 'limited'
      laneRubricScores: [
        { id: 'R1', score: 2 },
        { id: 'R2', score: 2, citation_hash: 'sha256:UNVERIFIED-1' },
        { id: 'R3', score: 2, citation_hash: 'sha256:UNVERIFIED-2' },
      ],
      anchorTier: 'limited',
      proposedTier: 'proven',
      adjustmentEvidence: [
        { claim: 'TAM headroom', citation_hash: 'sha256:cite-a' },
        { claim: 'reinvestment rate', citation_hash: 'sha256:cite-b' },
        { claim: 'white space', citation_hash: 'sha256:cite-c' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('limited') // grounded total = 2 (R1) -> 'limited'
    expect(result.adjustment_applied).toBe(false)
    expect(result.grounding_capped).toBe(true)
    expect(result.violations.some((v) => v.includes('grounding-unmet'))).toBe(true)
  })
})

describe('resolveRubricTier — quant cannot substitute for a grounded qualitative moat (substitution boundary)', () => {
  // INVARIANT row 1: strong quant (M1=M2=2), zero qualitative -> resolved MODERATE, never wide.
  it('quant-alone (M1=M2=2, M3-M6=0) anchors moderate and resolves moderate — NOT wide', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 }, // perfect quant
      laneRubricScores: [
        { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
        { id: 'M3', score: 0 }, { id: 'M4', score: 0 }, { id: 'M5', score: 0 }, { id: 'M6', score: 0 },
      ],
      anchorTier: 'moderate', // capped quant anchor (post-fix)
      proposedTier: 'moderate',
      adjustmentEvidence: [],
      verifiedCitationHashes: VERIFIED,
    })
    expect(result.resolved_tier).toBe('moderate')
    expect(result.resolved_tier).not.toBe('wide')
  })

  // INVARIANT row 4: grounded MONOPOLY must remain reachable even with the anchor capped at moderate —
  // the GROUNDED ROWS carry the tier all the way up (M3-M6 cite-verified -> grounded sum 12 -> monopoly).
  it('grounded monopoly: anchor moderate, proposed monopoly, M3-M6 cite-verified (sum>=10) -> monopoly', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: [
        { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:cite-c' },
        { id: 'M6', score: 2, citation_hash: 'sha256:cite-d' },
      ],
      anchorTier: 'moderate', // capped quant anchor; proposed monopoly is over-range upward (+2)
      proposedTier: 'monopoly',
      adjustmentEvidence: [
        { claim: 'durable monopoly via X', citation_hash: 'sha256:cite-a' },
        { claim: 'failed entrant exited', citation_hash: 'sha256:cite-b' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    // grounded sum = 2+2+8 = 12 -> monopoly; the grounded rows fully support the top tier -> reachable.
    expect(result.resolved_tier).toBe('monopoly')
    expect(result.grounding_capped).toBe(false)
    expect(result.adjustment_applied).toBe(true)
  })

  // The over-range upward proposal is NOT mechanically clamped to anchor+1 — but the grounded ceiling
  // still caps it to what the grounded rows actually support (here: only M3/M4 verify -> sum 8 -> wide).
  it('over-range upward (moderate->monopoly) with grounded sum only 8 is capped to wide, not monopoly', () => {
    const result = resolveRubricTier({
      rubric: moat,
      anchorScores: { M1: 2, M2: 2 },
      laneRubricScores: [
        { id: 'M1', score: 2 }, { id: 'M2', score: 2 },
        { id: 'M3', score: 2, citation_hash: 'sha256:cite-a' },
        { id: 'M4', score: 2, citation_hash: 'sha256:cite-b' },
        { id: 'M5', score: 2, citation_hash: 'sha256:UNVERIFIED-1' }, // ungrounded -> 0
        { id: 'M6', score: 2, citation_hash: 'sha256:UNVERIFIED-2' }, // ungrounded -> 0
      ],
      anchorTier: 'moderate',
      proposedTier: 'monopoly',
      adjustmentEvidence: [
        { claim: 'a', citation_hash: 'sha256:cite-a' },
        { claim: 'b', citation_hash: 'sha256:cite-b' },
      ],
      verifiedCitationHashes: VERIFIED,
    })
    // grounded sum = 2+2+2+2 = 8 -> wide (the monopoly threshold, 10, is unmet) -> capped to wide.
    expect(result.resolved_tier).toBe('wide')
    expect(result.grounding_capped).toBe(true)
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
