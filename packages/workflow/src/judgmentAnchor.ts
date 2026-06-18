// Mechanical anchor + bounded +-1-tier adjustment — judgment-objectivity-layer-spec Mechanism 2.
//
// "Judgment doesn't disappear — it moves into rubrics, priors, and scoring rules written once, in
// advance. Lanes score evidence; the harness maps scores to conclusions."
//
// This module is the HARNESS side of Mechanisms 1+2:
//   1. computeMoatAnchor / computeRunwayAnchor — score the COMPUTABLE rubric rows from PRIMARY EDGAR
//      data alone (deterministic), sum them to a sub-score, and map that to a mechanical `anchor_tier`
//      (the prior the lane adjusts from). Fail-closed to { computable: false } when EDGAR is insufficient.
//   2. resolveRubricTier — takes the lane's rubric scores + proposed tier + cited adjustment evidence
//      and resolves the FINAL tier under three rules, enforced here (not in a prompt):
//        - computable rows: the harness uses ITS score, never the lane's claim (lane can't inflate M1/M2/R1);
//        - the proposed tier may differ from the anchor by AT MOST +-1 tier (>=2 -> clamped + violation);
//        - any adjustment (proposed != anchor) requires verified cited evidence (uncited/unverifiable ->
//          rejected, anchor stands); an UPWARD adjustment needs 2x the evidence items of a downward one.
//      When the anchor is not computable, the lane's full-rubric score stands (no clamp), still re-verifying
//      whatever computable rows it can and requiring citations on the cited rows.
//
// Grounding/citation verification is UNCHANGED: a citation_hash is accepted only when it is present in
// the set of verified content hashes from the fetched corpus (sourceGrounding). Nothing here weakens that.

import {
  type Rubric,
  type RubricTier,
  tierForScore,
  orderedTiers,
  tierIndex,
} from '@owlfolio/strategies/judgmentRubrics'
import { computeIncrementalRoic, type AnnualFacts } from './secEdgar'

// ---------------------------------------------------------------------------
// Computable-row scoring constants (pinned; documented mapping the tests freeze)
// ---------------------------------------------------------------------------

/** ROIC threshold for the M1 "high-ROIC durability" row. */
const M1_ROIC_THRESHOLD = 0.15
/** Years (of the last 10) at/above the ROIC threshold for full M1 credit. */
const M1_FULL_CREDIT_YEARS = 9
/** Years at/above the threshold for partial (1-point) M1 credit. */
const M1_PARTIAL_CREDIT_YEARS = 7
/** Minimum usable years required before M1/M2 are scoreable at all (else not-computable). */
const MIN_YEARS_FOR_MOAT_ANCHOR = 5

/** Operating-margin band (bps) for full M2 credit — proxy for the spec's gross-margin band. */
const M2_TIGHT_BAND_BPS = 300
/** Operating-margin band (bps) for partial M2 credit. */
const M2_LOOSE_BAND_BPS = 600

/** Assumed effective tax rate when a year's operating income/tax is missing (mirrors secEdgar). */
const DEFAULT_TAX_RATE = 0.21

// ---------------------------------------------------------------------------
// Anchor result types
// ---------------------------------------------------------------------------

export type RubricAnchor =
  | {
      computable: true
      /** Per-row computed scores (0/1/2) for the computable rows only, keyed by item id. */
      row_scores: Record<string, number>
      /** Sum of the computable row scores. */
      sub_score: number
      /** Max possible sub-score across the computable rows. */
      sub_score_max: number
      /** Mechanical anchor tier the lane adjusts from. */
      anchor_tier: RubricTier
      /** Human-readable note on what was computed (for the dossier / audit). */
      note: string
    }
  | { computable: false; reason: string }

// ---------------------------------------------------------------------------
// Computable sub-score -> anchor tier (pinned per rubric; NEVER interpolated)
// ---------------------------------------------------------------------------
//
// The anchor is the PRIOR computed from the computable rows ALONE. Because the higher tiers of each
// rubric require CITED evidence the quant score cannot see (a true monopoly needs price-power/share/
// switching evidence; a proven runway needs visible headroom), the computable-only sub-score is mapped
// CONSERVATIVELY: a perfect computable sub-score lands at the mid/high tier, and reaching the TOP tier
// always requires the lane's cited rows + a (bounded, evidenced) upward adjustment. This is deliberate
// and documented — it is NOT interpolation of the cited rows (an unscoreable row is 0, never guessed).
//
// Moat computable rows {M1,M2} -> max 4:  4 -> wide · 2..3 -> moderate · <2 -> narrow.
// Runway computable row {R1}    -> max 2:  >=1 -> limited · 0 -> none.   (proven needs cited headroom.)

function moatTierForSubScore(subScore: number): RubricTier {
  if (subScore >= 4) return 'wide'
  if (subScore >= 2) return 'moderate'
  return 'narrow'
}

function runwayTierForSubScore(subScore: number): RubricTier {
  if (subScore >= 1) return 'limited'
  return 'none'
}

// ---------------------------------------------------------------------------
// Per-year computable signals from the EDGAR series
// ---------------------------------------------------------------------------

/** NOPAT proxy for a year: operating income x (1 - eff. tax); else NI + after-tax interest. */
function nopatProxy(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const tax = a.income_tax_expense_musd
  if (op !== undefined && Number.isFinite(op)) {
    let rate = DEFAULT_TAX_RATE
    if (tax !== undefined && Number.isFinite(tax) && op > 0) {
      const implied = tax / op
      if (implied >= 0 && implied <= 0.5) rate = implied
    }
    return op * (1 - rate)
  }
  const ni = a.net_income_musd
  if (ni !== undefined && Number.isFinite(ni)) {
    const interest = a.interest_expense_musd ?? 0
    return ni + (Number.isFinite(interest) ? interest * (1 - DEFAULT_TAX_RATE) : 0)
  }
  return undefined
}

/** Invested-capital proxy: equity + total debt - cash. undefined when equity is missing. */
function investedCapitalProxy(a: AnnualFacts): number | undefined {
  const equity = a.stockholders_equity_musd
  if (equity === undefined || !Number.isFinite(equity)) return undefined
  const debt = a.total_debt_musd ?? 0
  const cash = a.cash_and_securities_musd ?? 0
  return equity + (Number.isFinite(debt) ? debt : 0) - (Number.isFinite(cash) ? cash : 0)
}

/** Per-year ROIC = NOPAT / invested capital. undefined when either proxy is missing/non-positive IC. */
function yearRoic(a: AnnualFacts): number | undefined {
  const nopat = nopatProxy(a)
  const ic = investedCapitalProxy(a)
  if (nopat === undefined || ic === undefined || !(ic > 0)) return undefined
  return nopat / ic
}

/** Per-year operating margin = operating income / revenue. undefined when either is missing/<=0 rev. */
function yearOperatingMargin(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const rev = a.revenue_musd
  if (op === undefined || rev === undefined || !(rev > 0)) return undefined
  return op / rev
}

// ---------------------------------------------------------------------------
// Moat anchor (M1 + M2)
// ---------------------------------------------------------------------------

/**
 * Compute the moat mechanical anchor from the computable rows (M1 ROIC durability, M2 margin band) using
 * the latest <=10 years of the EDGAR series. Fail-closed to { computable: false } when fewer than
 * MIN_YEARS_FOR_MOAT_ANCHOR years carry the needed proxies. M2 uses OPERATING margin as a documented
 * proxy because the EDGAR adapter does not surface gross profit / COGS; the note records this.
 */
export function computeMoatAnchor(series: AnnualFacts[]): RubricAnchor {
  const window = [...series].sort((a, b) => b.fiscal_year - a.fiscal_year).slice(0, 10)
  if (window.length < MIN_YEARS_FOR_MOAT_ANCHOR) {
    return { computable: false, reason: `fewer than ${MIN_YEARS_FOR_MOAT_ANCHOR} years available for the moat anchor (${window.length})` }
  }

  // --- M1: ROIC > 15% in >=9 of the last 10 yrs ---
  const roics = window.map(yearRoic).filter((r): r is number => r !== undefined)
  if (roics.length < MIN_YEARS_FOR_MOAT_ANCHOR) {
    return { computable: false, reason: `fewer than ${MIN_YEARS_FOR_MOAT_ANCHOR} years with computable ROIC (${roics.length})` }
  }
  const yearsAboveThreshold = roics.filter((r) => r > M1_ROIC_THRESHOLD).length
  // Scale the year thresholds to however many usable years we actually have (never interpolate; this is
  // a count of passing years against a proportional bar so a 9-yr series isn't unfairly capped).
  const fullBar = Math.round((M1_FULL_CREDIT_YEARS / 10) * roics.length)
  const partialBar = Math.round((M1_PARTIAL_CREDIT_YEARS / 10) * roics.length)
  const m1 = yearsAboveThreshold >= fullBar ? 2 : yearsAboveThreshold >= partialBar ? 1 : 0

  // --- M2: margin held within +-300bps band over the window (operating-margin proxy) ---
  const margins = window.map(yearOperatingMargin).filter((m): m is number => m !== undefined)
  let m2 = 0
  let m2Computed = false
  if (margins.length >= MIN_YEARS_FOR_MOAT_ANCHOR) {
    m2Computed = true
    const min = Math.min(...margins)
    const max = Math.max(...margins)
    const bandBps = (max - min) * 10_000
    m2 = bandBps <= M2_TIGHT_BAND_BPS ? 2 : bandBps <= M2_LOOSE_BAND_BPS ? 1 : 0
  }

  const row_scores: Record<string, number> = { M1: m1, M2: m2 }
  const sub_score = m1 + m2
  const sub_score_max = 4
  const anchor_tier = moatTierForSubScore(sub_score)
  const note =
    `Moat anchor from EDGAR: M1=${m1} (ROIC>15% in ${yearsAboveThreshold}/${roics.length} yrs), `
    + `M2=${m2} (${m2Computed ? 'operating-margin band proxy — gross margin not surfaced by the filing adapter' : 'margin not computable, scored 0'}). `
    + `Computable sub-score ${sub_score}/${sub_score_max} -> anchor tier '${anchor_tier}' (top tier needs cited rows).`
  return { computable: true, row_scores, sub_score, sub_score_max, anchor_tier, note }
}

// ---------------------------------------------------------------------------
// Runway anchor (R1)
// ---------------------------------------------------------------------------

/**
 * Compute the runway mechanical anchor from the single computable row R1 (incremental capital deployed at
 * high ROIC), reusing computeIncrementalRoic. R1=2 when incremental ROIC > 10%, 1 when positive, else 0.
 * Fail-closed to { computable: false } when incremental ROIC is not computable.
 */
export function computeRunwayAnchor(series: AnnualFacts[]): RubricAnchor {
  if (series.length < 2) {
    return { computable: false, reason: 'fewer than two years for the runway anchor' }
  }
  const inc = computeIncrementalRoic(series)
  if (!inc.computable) {
    return { computable: false, reason: `incremental ROIC not computable: ${inc.reason}` }
  }
  const r1 = inc.incremental_roic > 0.10 ? 2 : inc.incremental_roic > 0 ? 1 : 0
  const row_scores: Record<string, number> = { R1: r1 }
  const sub_score = r1
  const sub_score_max = 2
  const anchor_tier = runwayTierForSubScore(sub_score)
  const note =
    `Runway anchor from EDGAR: R1=${r1} (incremental ROIC ${(inc.incremental_roic * 100).toFixed(1)}% `
    + `FY${inc.from_fiscal_year}->FY${inc.to_fiscal_year}). Sub-score ${sub_score}/${sub_score_max} -> '${anchor_tier}' (proven needs cited headroom).`
  return { computable: true, row_scores, sub_score, sub_score_max, anchor_tier, note }
}

// ---------------------------------------------------------------------------
// Bounded +-1 adjustment resolution
// ---------------------------------------------------------------------------

export type LaneRubricScore = {
  id: string
  score: number
  citation_hash?: string
}

export type AdjustmentEvidence = {
  claim: string
  citation_hash: string
}

export type ResolveRubricTierArgs = {
  rubric: Rubric
  /** Harness-computed scores for the COMPUTABLE rows (keyed by item id). undefined => anchor not computable. */
  anchorScores: Record<string, number> | undefined
  /** The lane's full rubric scores (one per item; computable rows are re-verified against anchorScores). */
  laneRubricScores: LaneRubricScore[]
  /** The mechanical anchor tier (undefined when the anchor is not computable). */
  anchorTier: RubricTier | undefined
  /** The lane's proposed tier (its judgment adjustment). */
  proposedTier: RubricTier
  /** Cited evidence the quant score cannot see, supporting an adjustment away from the anchor. */
  adjustmentEvidence: AdjustmentEvidence[]
  /** Set of verified content hashes from the fetched corpus (grounding). A citation is valid iff present. */
  verifiedCitationHashes: ReadonlySet<string>
}

export type ResolveRubricTierResult = {
  /** Whether the mechanical anchor was computable. */
  anchor_computable: boolean
  /** Echoed anchor tier (undefined when not computable). */
  anchor_tier: RubricTier | undefined
  /** The lane's proposed tier (echoed). */
  proposed_tier: RubricTier
  /** The HARNESS-resolved final tier fed downstream (valuation reads this). */
  resolved_tier: RubricTier
  /** Per-row scores after re-verifying the computable rows (lane can't inflate them). */
  resolved_row_scores: Record<string, number>
  /** True when the lane's proposed tier was applied (an evidenced, bounded adjustment); false when rejected/clamped. */
  adjustment_applied: boolean
  /** Number of adjustment-evidence items whose citation_hash verified against the corpus. */
  verified_evidence_count: number
  /**
   * True when an UPWARD adjustment was DENIED because the grounded rubric rows don't support it: the
   * resolved tier was clamped down to max(anchor, grounded-row-sum tier). Fail-closed-on-ungrounded, at
   * the tier — an upward bump may not ride on adjustment evidence the substantive rows don't back.
   */
  grounding_capped: boolean
  /** Recorded rule violations (over-range, uncited, unverifiable, insufficient-for-upward). */
  violations: string[]
}

/**
 * Resolve the final rubric tier under Mechanism 2's rules (deterministic; no averaging). See module
 * header. Computable rows are re-verified from `anchorScores`; the lane's claim for those rows is
 * discarded. The proposed tier is accepted only as an evidenced, cited, +-1-bounded adjustment from the
 * anchor (upward needs 2x the evidence items of downward). Rejected/over-range adjustments do NOT
 * average — they clamp to +-1 (over-range) or fall back to the anchor (uncited/unverifiable/insufficient).
 */
export function resolveRubricTier(args: ResolveRubricTierArgs): ResolveRubricTierResult {
  const { rubric, anchorScores, laneRubricScores, anchorTier, proposedTier, adjustmentEvidence, verifiedCitationHashes } = args
  const violations: string[] = []

  // --- Re-verify computable rows: harness score wins, lane claim discarded ---
  const resolved_row_scores: Record<string, number> = {}
  for (const item of rubric.items) {
    const laneRow = laneRubricScores.find((r) => r.id === item.id)
    if (item.computable) {
      const harnessScore = anchorScores?.[item.id]
      if (harnessScore !== undefined) {
        resolved_row_scores[item.id] = harnessScore
        if (laneRow !== undefined && laneRow.score !== harnessScore) {
          violations.push(`row ${item.id}: lane claimed ${laneRow.score} but harness computed ${harnessScore} from filings (harness value used)`)
        }
      } else {
        // Computable row but no harness score (anchor not computable): the harness has nothing to
        // re-verify against, so per the spec ("lane's full-rubric score stands") we fall back to the
        // lane's claimed score for this row. This branch is only reached when anchorScores is undefined.
        resolved_row_scores[item.id] = laneRow !== undefined ? clampItemScore(laneRow.score) : 0
      }
    } else {
      // Cited row: the lane's score counts only when backed by a verified citation_hash; else 0.
      const cited = laneRow?.citation_hash !== undefined && verifiedCitationHashes.has(laneRow.citation_hash)
      resolved_row_scores[item.id] = cited ? clampItemScore(laneRow!.score) : 0
      if (laneRow !== undefined && laneRow.score > 0 && !cited) {
        violations.push(`row ${item.id}: scored ${laneRow.score} without a verified citation -> scored 0`)
      }
    }
  }

  // Count verified adjustment-evidence items (citation_hash present in the corpus).
  const verifiedEvidence = adjustmentEvidence.filter((e) => verifiedCitationHashes.has(e.citation_hash))
  const verified_evidence_count = verifiedEvidence.length

  // --- Anchor not computable: the lane's full-rubric score stands (re-verified rows), no +-1 clamp ---
  if (anchorScores === undefined || anchorTier === undefined) {
    const total = Object.values(resolved_row_scores).reduce((s, v) => s + v, 0)
    const resolved = tierForScore(rubric, total)
    return {
      anchor_computable: false,
      anchor_tier: undefined,
      proposed_tier: proposedTier,
      resolved_tier: resolved,
      resolved_row_scores,
      // The lane's tier is its own full-rubric mapping; "applied" iff it matches the re-verified mapping.
      adjustment_applied: resolved === proposedTier,
      verified_evidence_count,
      grounding_capped: false,
      violations,
    }
  }

  // --- Anchor computable: bounded +-1 adjustment from the anchor tier ---
  const anchorIdx = tierIndex(rubric, anchorTier)
  const proposedIdx = tierIndex(rubric, proposedTier)
  const tiers = orderedTiers(rubric)

  // No adjustment proposed (proposed == anchor): anchor stands, no evidence needed.
  if (proposedIdx === anchorIdx) {
    return finalize(anchorTier, false)
  }

  // Over-range (>=2 tiers): reject the magnitude, clamp to +-1 from the anchor, record a violation.
  const delta = proposedIdx - anchorIdx
  const direction = delta > 0 ? 'upward' : 'downward'
  if (Math.abs(delta) >= 2) {
    violations.push(`proposed tier '${proposedTier}' is ${Math.abs(delta)} tiers from anchor '${anchorTier}' (max +-1) -> clamped`)
    const clampedIdx = anchorIdx + (delta > 0 ? 1 : -1)
    const clampedTier = tiers[clampedIdx] ?? anchorTier
    // A clamp still requires the adjustment to be evidenced; otherwise fall back to the anchor entirely.
    if (!hasSufficientEvidence(direction, verified_evidence_count, violations)) {
      return finalize(anchorTier, false)
    }
    return finalize(clampedTier, true)
  }

  // +-1 adjustment: requires verified cited evidence (asymmetric: upward needs 2x a downward's items).
  if (verifiedEvidence.length === 0) {
    if (adjustmentEvidence.length === 0) {
      violations.push(`adjustment from '${anchorTier}' to '${proposedTier}' is uncited (no citation evidence) -> rejected (anchor stands)`)
    } else {
      violations.push(`adjustment from '${anchorTier}' to '${proposedTier}' cites no hash that verifies against the corpus -> rejected (anchor stands)`)
    }
    return finalize(anchorTier, false)
  }
  if (!hasSufficientEvidence(direction, verified_evidence_count, violations)) {
    return finalize(anchorTier, false)
  }
  return finalize(proposedTier, true)

  function finalize(tier: RubricTier, applied: boolean): ResolveRubricTierResult {
    let resolvedTier = tier
    let adjustment_applied = applied
    let grounding_capped = false

    // --- Grounded ceiling: an UPWARD adjustment may not raise the tier above the higher of
    // {the filings anchor, the grounded-row-sum tier}. The resolved_row_scores already use the
    // harness score for computable rows and verified-or-0 for cited rows, so their sum IS the
    // grounded evidence. A bump the grounded rows don't support is denied (fail-closed-on-ungrounded,
    // at the gate). Downward adjustments (tier below the anchor) are conservative and never capped. ---
    const candidateIdx = tierIndex(rubric, resolvedTier)
    if (candidateIdx > anchorIdx) {
      const groundedTotal = Object.values(resolved_row_scores).reduce((s, v) => s + v, 0)
      const groundedRowTier = tierForScore(rubric, groundedTotal)
      const ceilingIdx = Math.max(anchorIdx, tierIndex(rubric, groundedRowTier))
      if (candidateIdx > ceilingIdx) {
        const cappedTier: RubricTier = tiers[ceilingIdx] ?? anchorTier!
        violations.push(
          `${rubric.id}-grounding-unmet: proposed tier '${proposedTier}' exceeds grounded support `
          + `(anchor '${anchorTier}', grounded rows total ${groundedTotal} -> '${groundedRowTier}') `
          + `— cited rows ungrounded, tier not raised (clamped to '${cappedTier}')`,
        )
        resolvedTier = cappedTier
        adjustment_applied = false
        grounding_capped = true
      }
    }

    return {
      anchor_computable: true,
      anchor_tier: anchorTier,
      proposed_tier: proposedTier,
      resolved_tier: resolvedTier,
      resolved_row_scores,
      adjustment_applied,
      verified_evidence_count,
      grounding_capped,
      violations,
    }
  }
}

/** Minimum verified-evidence items for a downward (1) vs an upward (2x = 2) adjustment. */
const DOWNWARD_MIN_EVIDENCE = 1
const UPWARD_MIN_EVIDENCE = DOWNWARD_MIN_EVIDENCE * 2

function hasSufficientEvidence(direction: 'upward' | 'downward', verifiedCount: number, violations: string[]): boolean {
  const required = direction === 'upward' ? UPWARD_MIN_EVIDENCE : DOWNWARD_MIN_EVIDENCE
  if (verifiedCount >= required) return true
  violations.push(
    `${direction} adjustment requires ${required} verified evidence item(s)`
    + `${direction === 'upward' ? ' (2x a downward adjustment)' : ''} but only ${verifiedCount} verified -> rejected (anchor stands)`,
  )
  return false
}

/** Clamp a row score to the valid 0..2 range (defensive against a malformed lane payload). */
function clampItemScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(2, Math.round(score)))
}
