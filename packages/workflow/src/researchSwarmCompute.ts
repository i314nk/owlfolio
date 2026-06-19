import { JUDGMENT_RUBRICS, type RubricTier } from '@owlfolio/strategies/judgmentRubrics'
import {
  computeMoatAnchor,
  computeRunwayAnchor,
  resolveRubricTier,
  type LaneRubricScore,
  type AdjustmentEvidence,
  type ResolveRubricTierResult,
} from './judgmentAnchor'
import type { AnnualFacts, Fundamentals } from './secEdgar'

/** The MOAT lane's judgment output (Mechanisms 1+2): rubrics + the holistic moat_class/runway fallback. */
export type MoatLaneJudgment = {
  moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  runway: 'proven' | 'limited' | 'none'
  runway_exceptional?: boolean
  moat_rubric?: LaneRubricInput
  runway_rubric?: LaneRubricInput
}

/** The SHARIAH lane's judgment overlay (the harness recomputes the AAOIFI ratios from this). */
export type ShariahLaneJudgment = {
  sector_status: 'compliant' | 'conditional' | 'non_compliant'
  impermissible_income: number
}

/**
 * Maintenance-capex fraction implied by the LLM's proxy tier. The model proposes the TIER (judgment);
 * the harness applies the fraction to EDGAR capex deterministically (per buffett-valuation-method-v2:
 * maintenance_capex = min(D&A, capex × fraction)).
 */
export function maintenanceFractionForTier(tier: '20' | '50' | '80'): number {
  return Number(tier) / 100
}

/** A percentage counts as a growth claim only when a growth keyword sits within this many chars of it. */
const GROWTH_KEYWORD_PROXIMITY = 24
/** Keywords that mark a percentage as a GROWTH rate (vs a margin / ROIC / payout / share-of-revenue figure). */
const GROWTH_KEYWORD = /\b(grow|grew|growth|compound|cagr|grows|growing)\b/i

/**
 * Extract a lane-argued near-term growth rate from the free-text growth_assumptions, as a DECIMAL
 * (Phase 1.3). The harness only honours a lane argument that is LOWER than the demonstrated CAGR (the
 * agent may argue down, never up — enforced in `creditedGrowth`), so even a misparse is safe (it can only
 * make the valuation MORE conservative). To avoid silent, noise-driven haircuts, this is NOT a naive
 * first-percentage grab: a percentage is treated as a growth claim ONLY when a growth keyword
 * (grow/growth/compound/CAGR…) sits within ~24 chars of it. This rejects the common misfire surface —
 * a margin / ROIC / buyback / share-of-revenue figure quoted before the growth statement
 * (e.g. "margins expanded 12% while growth decelerates"). Among the qualifying figures it takes the
 * LOWEST (the agent argues DOWN, so the most conservative growth claim in the prose binds). Returns
 * undefined when no growth-adjacent percentage is present, or it is outside the 0–60% sanity band.
 *
 * NOTE (review, pre-1.9): free-text parsing of a number that moves the valuation is inherently fragile.
 * The durable fix — if lanes are ever expected to routinely argue growth down — is a STRUCTURED growth
 * field on the lane schema, not prose. The adjacency rule + the strictly-lower guard keep the current
 * free-text path fail-safe (conservative-only) in the meantime; see parseLaneArguedGrowth.test.ts.
 */
export function parseLaneArguedGrowth(growthAssumptions: string | undefined): number | undefined {
  if (typeof growthAssumptions !== 'string') return undefined
  const candidates: number[] = []
  const re = /(\d{1,2}(?:\.\d+)?)\s*%/g
  let match: RegExpExecArray | null
  while ((match = re.exec(growthAssumptions)) !== null) {
    const pct = Number(match[1])
    if (!Number.isFinite(pct) || pct < 0 || pct > 60) continue
    // Require a growth keyword within proximity on EITHER side of the percentage (handles
    // "growth ~8%" and "8% growth"), so a bare margin/ROIC/payout figure is not read as a growth claim.
    const start = Math.max(0, match.index - GROWTH_KEYWORD_PROXIMITY)
    const end = Math.min(growthAssumptions.length, match.index + match[0].length + GROWTH_KEYWORD_PROXIMITY)
    const window = growthAssumptions.slice(start, end)
    if (GROWTH_KEYWORD.test(window)) candidates.push(pct / 100)
  }
  if (candidates.length === 0) return undefined
  // The agent may only argue DOWN — bind the LOWEST growth-adjacent figure stated.
  return Math.min(...candidates)
}

// ---------------------------------------------------------------------------
// Judgment objectivity (Mechanisms 1+2): rubric → mechanical anchor → bounded ±1 adjustment
// ---------------------------------------------------------------------------

export type LaneRubricInput = {
  rubric_scores: { id: string; score: number; citation_hash?: string | undefined }[]
  proposed_tier: string
  adjustment_evidence: { claim: string; citation_hash: string }[]
}

const VALID_MOAT_CLASSES = new Set(['narrow', 'moderate', 'wide', 'monopoly'])
const VALID_RUNWAYS = new Set(['proven', 'limited', 'none'])

/** Map the lane rubric payload shape onto the harness resolver's input shape. */
function toLaneRubricScores(scores: LaneRubricInput['rubric_scores']): LaneRubricScore[] {
  return scores.map((s) => ({
    id: s.id,
    score: s.score,
    ...(s.citation_hash === undefined ? {} : { citation_hash: s.citation_hash }),
  }))
}

function toAdjustmentEvidence(evidence: LaneRubricInput['adjustment_evidence']): AdjustmentEvidence[] {
  return evidence.map((e) => ({ claim: e.claim, citation_hash: e.citation_hash }))
}

/** Why an axis resolved holistically rather than from a scored rubric (visible degradation, never silent). */
export type JudgmentDegraded = 'rubric_not_emitted'

/** Conservative explicit defaults when NEITHER a rubric NOR a holistic value exists. These fail the
 *  moat gate (narrow) / earn no growth credit (none) — never an undefined that silently voids the
 *  valuation downstream. */
const DEFAULT_MOAT_CLASS = 'narrow' as const
const DEFAULT_RUNWAY = 'none' as const

export type JudgmentResolution = {
  moat?: ResolveRubricTierResult & {
    /** ALWAYS defined: rubric-resolved tier -> holistic fallback -> conservative default. Never undefined. */
    resolved_moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
    anchor_note?: string
    /** Set when the tier was NOT rubric-scored (resolved holistically / by default). Surfaced, not silent. */
    judgment_degraded?: JudgmentDegraded
  }
  runway?: ResolveRubricTierResult & {
    /** ALWAYS defined: rubric-resolved tier -> holistic fallback -> conservative default. Never undefined. */
    resolved_runway: 'proven' | 'limited' | 'none'
    anchor_note?: string
    /** Set when the tier was NOT rubric-scored (resolved holistically / by default). Surfaced, not silent. */
    judgment_degraded?: JudgmentDegraded
  }
}

/**
 * Resolve the moat + runway tiers from the lane rubrics (Mechanisms 1+2) — ALWAYS yielding a defined
 * resolved tier so the omission of an OPTIONAL rubric can never silently void the downstream valuation.
 *
 * Precedence (documented, deterministic):
 *   1. Rubric present + sufficient  -> mechanical anchor (EDGAR) + bounded ±1 adjustment (resolveRubricTier).
 *   2. Rubric absent OR resolves to a tier not valid downstream -> the MOAT axis FAILS CLOSED to `narrow`
 *      (never admit on the model's ungrounded bare holistic moat_class — the same fail-closed-on-ungrounded
 *      principle as the moat gate and the decision agent), flagged `judgment_degraded: 'rubric_not_emitted'`
 *      so the degradation is VISIBLE. (Runway keeps its holistic fallback — it cannot pass a moat gate.)
 *   3. Neither rubric nor holistic -> a conservative explicit default (narrow moat / none runway) that
 *      fails the gate, still flagged degraded. NEVER `undefined`.
 *
 * Grounding/citation verification (resolveRubricTier) is unchanged.
 */
export function resolveJudgmentTiers(args: {
  moatRubric?: LaneRubricInput | undefined
  runwayRubric?: LaneRubricInput | undefined
  /** Holistic moat_class the synthesis lane proposes (the schema-required field). Used as the fallback. */
  holisticMoatClass?: 'narrow' | 'moderate' | 'wide' | 'monopoly' | undefined
  /** Holistic runway the synthesis lane proposes (the schema-required field). Used as the fallback. */
  holisticRunway?: 'proven' | 'limited' | 'none' | undefined
  series?: AnnualFacts[] | undefined
  verifiedCitationHashes: ReadonlySet<string>
}): JudgmentResolution {
  const series = args.series ?? []

  // A degraded ResolveRubricTierResult skeleton for the holistic/default fallback path (no rubric scored).
  const degradedResult = (resolved_tier: RubricTier): ResolveRubricTierResult => ({
    anchor_computable: false,
    anchor_tier: undefined,
    proposed_tier: resolved_tier,
    resolved_tier,
    resolved_row_scores: {},
    adjustment_applied: false,
    verified_evidence_count: 0,
    grounding_capped: false,
    violations: [],
  })

  // --- Moat axis ---
  let moat: JudgmentResolution['moat']
  if (args.moatRubric !== undefined) {
    const anchor = computeMoatAnchor(series)
    const resolved = resolveRubricTier({
      rubric: JUDGMENT_RUBRICS.moat,
      anchorScores: anchor.computable ? anchor.row_scores : undefined,
      laneRubricScores: toLaneRubricScores(args.moatRubric.rubric_scores),
      anchorTier: anchor.computable ? anchor.anchor_tier : undefined,
      proposedTier: args.moatRubric.proposed_tier,
      adjustmentEvidence: toAdjustmentEvidence(args.moatRubric.adjustment_evidence),
      verifiedCitationHashes: args.verifiedCitationHashes,
    })
    if (VALID_MOAT_CLASSES.has(resolved.resolved_tier)) {
      moat = {
        ...resolved,
        resolved_moat_class: resolved.resolved_tier as 'narrow' | 'moderate' | 'wide' | 'monopoly',
        ...(anchor.computable ? { anchor_note: anchor.note } : { anchor_note: `Moat anchor not computable: ${anchor.reason}` }),
      }
    } else {
      // Rubric resolved to a non-downstream tier — FAIL CLOSED to narrow (never admit on the model's
      // ungrounded bare word), VISIBLY flagged. The holistic moat_class is NOT trusted to pass the gate.
      moat = {
        ...resolved,
        resolved_moat_class: DEFAULT_MOAT_CLASS,
        judgment_degraded: 'rubric_not_emitted',
        ...(anchor.computable ? { anchor_note: anchor.note } : { anchor_note: `Moat anchor not computable: ${anchor.reason}` }),
      }
    }
  } else {
    // No rubric supplied — FAIL CLOSED to narrow (do NOT admit on the model's ungrounded bare holistic
    // moat_class), VISIBLY flagged. wide+ requires scored, cite-verified rubric rows — not a model claim.
    moat = {
      ...degradedResult(DEFAULT_MOAT_CLASS as RubricTier),
      resolved_moat_class: DEFAULT_MOAT_CLASS,
      judgment_degraded: 'rubric_not_emitted',
      anchor_note: 'Moat rubric not emitted by the model — failed closed to narrow (the holistic moat_class is NOT trusted to pass the gate without scored, cite-verified rubric rows).',
    }
  }

  // --- Runway axis ---
  let runway: JudgmentResolution['runway']
  if (args.runwayRubric !== undefined) {
    const anchor = computeRunwayAnchor(series)
    const resolved = resolveRubricTier({
      rubric: JUDGMENT_RUBRICS.runway,
      anchorScores: anchor.computable ? anchor.row_scores : undefined,
      laneRubricScores: toLaneRubricScores(args.runwayRubric.rubric_scores),
      anchorTier: anchor.computable ? anchor.anchor_tier : undefined,
      proposedTier: args.runwayRubric.proposed_tier,
      adjustmentEvidence: toAdjustmentEvidence(args.runwayRubric.adjustment_evidence),
      verifiedCitationHashes: args.verifiedCitationHashes,
    })
    if (VALID_RUNWAYS.has(resolved.resolved_tier)) {
      runway = {
        ...resolved,
        resolved_runway: resolved.resolved_tier as 'proven' | 'limited' | 'none',
        ...(anchor.computable ? { anchor_note: anchor.note } : { anchor_note: `Runway anchor not computable: ${anchor.reason}` }),
      }
    } else {
      const fallback = args.holisticRunway ?? DEFAULT_RUNWAY
      runway = {
        ...resolved,
        resolved_runway: fallback,
        judgment_degraded: 'rubric_not_emitted',
        ...(anchor.computable ? { anchor_note: anchor.note } : { anchor_note: `Runway anchor not computable: ${anchor.reason}` }),
      }
    }
  } else {
    // Runway keeps its holistic fallback: runway feeds GROWTH credit, not the moat admission gate, so an
    // ungrounded holistic runway cannot itself admit a name (unlike moat, which fails closed above).
    const fallback = args.holisticRunway ?? DEFAULT_RUNWAY
    runway = {
      ...degradedResult(fallback as RubricTier),
      resolved_runway: fallback,
      judgment_degraded: 'rubric_not_emitted',
      anchor_note: 'Runway rubric not emitted by the model — resolved from the holistic runway (or conservative default).',
    }
  }

  return { moat, runway }
}

type JudgmentAxisProjection = {
  anchor_tier?: string
  proposed_tier: string
  resolved_tier: string
  adjustment_applied: boolean
  anchor_computable: boolean
  verified_evidence_count: number
  /** True when an upward bump was denied because the grounded rows didn't support it (tier clamped). */
  grounding_capped: boolean
  rubric_scores: { id: string; score: number }[]
  violations: string[]
  anchor_note?: string
  /** Set when the axis resolved holistically (rubric not emitted) rather than from scored rubric rows. */
  judgment_degraded?: JudgmentDegraded
}

type JudgmentProjection = {
  rubric_version: string
  moat?: JudgmentAxisProjection
  runway?: JudgmentAxisProjection
}

/** Build the serializable judgment-layer projection (rubric scores + anchor-vs-proposed) for the dossier. */
export function buildJudgmentProjection(judgment: JudgmentResolution): JudgmentProjection | undefined {
  function axis(r: (ResolveRubricTierResult & { anchor_note?: string; judgment_degraded?: JudgmentDegraded }) | undefined): JudgmentAxisProjection | undefined {
    if (r === undefined) return undefined
    return {
      ...(r.anchor_tier === undefined ? {} : { anchor_tier: r.anchor_tier }),
      proposed_tier: r.proposed_tier,
      resolved_tier: r.resolved_tier,
      adjustment_applied: r.adjustment_applied,
      anchor_computable: r.anchor_computable,
      verified_evidence_count: r.verified_evidence_count,
      grounding_capped: r.grounding_capped,
      rubric_scores: Object.entries(r.resolved_row_scores).map(([id, score]) => ({ id, score })),
      violations: r.violations,
      ...(r.anchor_note === undefined ? {} : { anchor_note: r.anchor_note }),
      ...(r.judgment_degraded === undefined ? {} : { judgment_degraded: r.judgment_degraded }),
    }
  }
  const moat = axis(judgment.moat)
  const runway = axis(judgment.runway)
  if (moat === undefined && runway === undefined) return undefined
  return {
    rubric_version: JUDGMENT_RUBRICS.version,
    ...(moat === undefined ? {} : { moat }),
    ...(runway === undefined ? {} : { runway }),
  }
}

function fmtMusd(v: number | undefined): string {
  return v === undefined ? 'n/a' : `$${Math.round(v).toLocaleString('en-US')}M`
}

function fmtShares(v: number | undefined): string {
  return v === undefined ? 'n/a' : `${v.toFixed(1)}M`
}

/**
 * Build a compact, grounded primary-filing context block for injection into a lane prompt. Includes
 * the OE-bridge raw inputs, revenue, debt, cash, interest expense, the multi-year series, and the
 * grounded EDGAR source_id the lane MUST cite.
 */
export function buildPrimaryFilingBlock(f: Fundamentals, sourceId: string): string {
  const la = f.latest_annual
  const series = f.annual_series.slice(0, 11) // latest + up to 10 prior years
  const seriesLines = series.map((a) =>
    `  FY${a.fiscal_year}: NI ${fmtMusd(a.net_income_musd)}, rev ${fmtMusd(a.revenue_musd)}, `
    + `D&A ${fmtMusd(a.d_and_a_musd)}, capex ${fmtMusd(a.capex_musd)}, SBC ${fmtMusd(a.sbc_musd)}, `
    + `diluted shares ${fmtShares(a.diluted_shares_m)}`,
  ).join('\n')

  return (
    `\n\nPrimary filing data (SEC EDGAR, FY${la.fiscal_year}, source ${sourceId}) — ${f.entity_name} (CIK ${f.cik}). `
    + `These are RAW values from the latest 10-K, in $millions and share-millions. USE these primary numbers `
    + `as the authoritative basis for your finding (you may still normalize, e.g. estimate the maintenance-capex `
    + `fraction of total capex), and CITE source ${sourceId} (the EDGAR 10-K) in proposed_sources.\n`
    + `Latest annual (FY${la.fiscal_year}): net_income ${fmtMusd(la.net_income_musd)}, revenue ${fmtMusd(la.revenue_musd)}, `
    + `D&A ${fmtMusd(la.d_and_a_musd)}, total_capex ${fmtMusd(la.capex_musd)}, SBC ${fmtMusd(la.sbc_musd)}, `
    + `diluted_shares ${fmtShares(la.diluted_shares_m)}, shares_outstanding ${fmtShares(la.shares_outstanding_m)}, `
    + `total_debt ${fmtMusd(la.total_debt_musd)}, cash_and_securities ${fmtMusd(la.cash_and_securities_musd)}, `
    + `interest_expense ${fmtMusd(la.interest_expense_musd)}.\n`
    + `Multi-year annual series (newest first, ${series.length} of ${f.annual_series.length} yrs):\n${seriesLines}`
  )
}
