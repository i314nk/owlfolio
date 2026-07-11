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

/**
 * Per-year ROIC = NOPAT / invested capital. undefined when either proxy is missing/non-positive IC.
 * Exported (S1): the moat tests (capital-efficiency) and the management talent block reuse the SAME
 * arithmetic the anchor uses — one source of truth, never recomputed differently.
 */
export function yearRoic(a: AnnualFacts): number | undefined {
  const nopat = nopatProxy(a)
  const ic = investedCapitalProxy(a)
  if (nopat === undefined || ic === undefined || !(ic > 0)) return undefined
  return nopat / ic
}

/** Per-year operating margin = operating income / revenue. undefined when either is missing/<=0 rev. */
export function yearOperatingMargin(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const rev = a.revenue_musd
  if (op === undefined || rev === undefined || !(rev > 0)) return undefined
  return op / rev
}

/** Per-year gross margin = gross profit / revenue. undefined when either is missing/<=0 rev. */
export function yearGrossMargin(a: AnnualFacts): number | undefined {
  const gp = a.gross_profit_musd
  const rev = a.revenue_musd
  if (gp === undefined || rev === undefined || !(rev > 0)) return undefined
  return gp / rev
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
    + `Computable sub-score ${sub_score}/${sub_score_max} -> anchor tier '${anchor_tier}' (capped at moderate; `
    + `the quant corroborates but cannot substitute for cited qualitative moat rows — wide+ needs the grounded-row-sum).`
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
