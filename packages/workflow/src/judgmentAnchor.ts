// Mechanical quant anchor — judgment-objectivity-layer-spec Mechanism 1 (computable-row corroboration).
//
// "Judgment doesn't disappear — it moves into rubrics, priors, and scoring rules written once, in
// advance. Lanes score evidence; the harness maps scores to conclusions."
//
// This module is the quant-corroboration side of the harness:
//   computeMoatAnchor / computeRunwayAnchor — score the COMPUTABLE rubric rows from PRIMARY EDGAR
//   data alone (deterministic), sum them to a sub-score, and map that to a mechanical `anchor_tier`
//   (the quant prior). Fail-closed to { computable: false } when EDGAR is insufficient.
//
// The anchor CORROBORATES a grounded qualitative thesis but never SUBSTITUTES for one: the moat anchor is
// capped at 'moderate' and the runway anchor at 'limited' — gate-passing tiers require the cite-verified
// grounded thesis (resolveMoatThesis / resolveRunwayThesis in researchSwarmCompute), not the quant alone.
//
// ResolveRubricTierResult below is the result shape consumed by researchSwarmCompute for both axes.
// (The per-row resolveRubricTier mapping was retired by the rubric→grounded-thesis migration.)

import { type RubricTier } from '@owlfolio/strategies/judgmentRubrics'
import { computeIncrementalRoic, type AnnualFacts } from './secEdgar'
import { yearGrossMargin, yearOperatingMargin, yearRoic } from './annualRatios'
import { computeMoatTests } from './moatTests'

// The per-year ratio primitives moved to annualRatios.ts (S4 — shared with moatTests without a
// cycle); re-exported here so existing importers keep working.
export { yearGrossMargin, yearOperatingMargin, yearRoic }

/** Minimum usable years required before the anchor is scoreable at all (else not-computable). */
const MIN_YEARS_FOR_MOAT_ANCHOR = 5

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
// CONSERVATIVELY: a perfect computable sub-score lands at the mid tier, and reaching ANY gate-passing
// tier always requires the lane's cited rows (verified) lifting the grounded-row-sum, never the quant
// alone. This is deliberate and documented — it is NOT interpolation of the cited rows (an unscoreable
// row is 0, never guessed).
//
// SUBSTITUTION BOUNDARY (the contract): the quant CORROBORATES a grounded qualitative moat thesis — it
// must NEVER SUBSTITUTE for one. High ROIC/margins are real moat evidence, but they can be a cyclical
// peak, an accounting artifact, or a temporary monopoly; on their own they cannot prove a durable moat.
// So the moat anchor is CAPPED AT 'moderate' — the computable rows {M1,M2} can never reach a gate-passing
// tier (wide/monopoly) by themselves. 'wide'+ is reachable ONLY when the cite-verified qualitative rows
// (M3 pricing power, M4 share, M5 switching, M6 competitor exits) lift the grounded thesis to the
// wide/monopoly threshold (resolveMoatThesis in researchSwarmCompute). A name with
// perfect numbers but zero grounded qualitative evidence anchors at 'moderate' and FAILS the moat gate.
//
// Moat computable rows {M1,M2} -> max 4:  >=2 -> moderate · <2 -> narrow.  (NEVER wide/monopoly: the
//   quant cannot substitute for cited qualitative evidence — gate-passing needs the grounded-row-sum.)
// Runway computable row {R1}    -> max 2:  >=1 -> limited · 0 -> none.     (proven needs cited headroom.)

function moatTierForSubScore(subScore: number): RubricTier {
  // Capped at 'moderate' — see the SUBSTITUTION BOUNDARY note above. The quant anchor must never reach a
  // gate-passing tier on its own; wide/monopoly require the cite-verified qualitative rows.
  if (subScore >= 2) return 'moderate'
  return 'narrow'
}

function runwayTierForSubScore(subScore: number): RubricTier {
  if (subScore >= 1) return 'limited'
  return 'none'
}

// ---------------------------------------------------------------------------
// Moat anchor (S4 recomposition, owner-locked 2026-07-11): the anchor components are the owner's
// NAMED moat tests — CE (capital efficiency) + TE (two-engine) — replacing M1 (years-above-threshold
// ROIC durability) + M2 (margin stability band). The named tests are computed ONCE (moatTests.ts)
// and consumed here, so the dossier's three-tests table and the anchor can never drift apart.
// STANDOUT is deliberately NOT an anchor component: its grade is peer-relative and the peer half is
// a labeled model judgment in v1 — it joins the anchor arithmetic when peer-filing grounding ships.
// Behavior deltas vs M1/M2 are pinned in judgmentAnchor.test.ts (the owner-facing recomposition diff).
// ---------------------------------------------------------------------------

/**
 * Compute the moat mechanical anchor from the owner's named tests over the latest <=10 years:
 *   CE (capital efficiency): median-ROIC band — excellent=2, solid=1, weak=0.
 *   TE (two-engine): both engines running=2 (revenue growing AND margins holding/improving within
 *   the noise dead-band), one engine=1, none=0. Not-computable TE scores 0 with the reason noted.
 * Fail-closed to { computable: false } when CE is not computable (ROIC is the load-bearing row —
 * mirror of the retired M1 requirement). The substitution boundary is unchanged: capped at moderate.
 */
export function computeMoatAnchor(series: AnnualFacts[]): RubricAnchor {
  const window = [...series].sort((a, b) => b.fiscal_year - a.fiscal_year).slice(0, 10)
  if (window.length < MIN_YEARS_FOR_MOAT_ANCHOR) {
    return { computable: false, reason: `fewer than ${MIN_YEARS_FOR_MOAT_ANCHOR} years available for the moat anchor (${window.length})` }
  }

  const tests = computeMoatTests(series)

  // CE is load-bearing: without a computable capital-efficiency read the anchor is not computable.
  if (!tests.capital_efficiency.computable) {
    return { computable: false, reason: tests.capital_efficiency.reason }
  }
  const ce = tests.capital_efficiency.band === 'excellent' ? 2 : tests.capital_efficiency.band === 'solid' ? 1 : 0

  let te = 0
  const teNote = tests.two_engine.computable
    ? `revenue ${(tests.two_engine.revenue_cagr * 100).toFixed(1)}%/yr ${tests.two_engine.revenue_engine ? 'ON' : 'off'}, `
      + `margin trend ${tests.two_engine.margin_trend_bps_per_year.toFixed(0)}bps/yr ${tests.two_engine.margin_engine ? 'ON' : 'off'}`
    : `not computable (${tests.two_engine.reason}), scored 0`
  if (tests.two_engine.computable) {
    te = (tests.two_engine.revenue_engine ? 1 : 0) + (tests.two_engine.margin_engine ? 1 : 0)
  }

  const row_scores: Record<string, number> = { CE: ce, TE: te }
  const sub_score = ce + te
  const sub_score_max = 4
  const anchor_tier = moatTierForSubScore(sub_score)
  const note =
    `Moat anchor from the owner's named tests: capital-efficiency=${ce} (median ROIC `
    + `${(tests.capital_efficiency.median_roic * 100).toFixed(1)}% — ${tests.capital_efficiency.band}), `
    + `two-engine=${te} (${teNote}). Standout is displayed with the tests but NOT scored — its peer half `
    + `is a labeled model judgment until peer-filing grounding ships. `
    + `Computable sub-score ${sub_score}/${sub_score_max} -> anchor tier '${anchor_tier}' (capped at moderate; `
    + `the quant corroborates but cannot substitute for a grounded qualitative moat thesis).`
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
// Moat/runway resolution result shape (consumed by researchSwarmCompute)
// ---------------------------------------------------------------------------

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
