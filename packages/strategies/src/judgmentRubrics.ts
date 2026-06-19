// Versioned judgment rubrics — the SINGLE source of truth for the lane-classification scoring rules.
//
// judgment-objectivity-layer-spec Mechanism 1 (Rubric Decomposition): each judgment-heavy lane gets a
// rubric of falsifiable, citeable sub-questions. The lane scores each item 0/1/2 with evidence; the
// HARNESS maps the total score to the classification. Judgment does not disappear — it moves into the
// rubrics, priors, and scoring rules written once, deliberately, in advance (this file). Changing a
// rubric is a deliberate, logged act (bump `version`), never an in-flight accommodation for a name.
//
// Each item is { id, question, max_score (always 2), computable, evidence_required }:
//   - computable=true  rows are scored by the harness from PRIMARY filings (EDGAR) — the lane cannot
//     inflate them (the harness re-verifies and overrides the lane's claim for these rows).
//   - computable=false ("cited") rows are scored by the lane and require a citation_hash that verifies
//     against the fetched corpus.
// An unscoreable item (no data) scores 0 — never interpolated (spec Mechanism 1).
//
// Mirrors the versioned-config pattern of valuationParams.ts (a frozen typed object + a version field).

/** The four classification axes that get a rubric. */
export type RubricId = 'moat' | 'management' | 'predictability' | 'runway'

/** A single falsifiable sub-question scored 0/1/2. */
export type RubricItem = {
  /** Stable item id (e.g. 'M1'). */
  id: string
  /** The falsifiable sub-question. */
  question: string
  /** Always 2 — every item is scored 0/1/2. */
  max_score: 2
  /** true: harness scores from filings (lane cannot inflate). false: lane scores with a citation. */
  computable: boolean
  /** What evidence the item requires (computed-from-filings vs cited instances). */
  evidence_required: string
}

/** Ordered classification tiers, lowest → highest, for a rubric. */
export type RubricTier = string

/** A score→tier threshold: a total score >= `min_score` maps to `tier` (evaluated highest-first). */
export type RubricThreshold = {
  /** Inclusive minimum total score for this tier. */
  min_score: number
  /** The classification this score range maps to. */
  tier: RubricTier
}

export type Rubric = {
  id: RubricId
  /** Human label. */
  name: string
  /** Falsifiable scored sub-questions. */
  items: readonly RubricItem[]
  /**
   * Score→tier thresholds (mechanical mapping), ordered HIGHEST min_score first. The harness picks the
   * first threshold whose min_score the total score meets; below the lowest threshold falls to `floor_tier`.
   */
  thresholds: readonly RubricThreshold[]
  /** The tier assigned when the total score is below every threshold. */
  floor_tier: RubricTier
}

export type JudgmentRubrics = {
  /** Monotonic version string. Bump on any rubric change; pairs with a logged config event. */
  version: string
  moat: Rubric
  management: Rubric
  predictability: Rubric
  runway: Rubric
}

// ---------------------------------------------------------------------------
// Moat rubric (spec M1–M6). M1/M2 are computable from filings; M3–M6 are cited.
// Harness mapping: >=10 monopoly · 7–9 wide · 4–6 moderate · <4 narrow.
// ---------------------------------------------------------------------------
const MOAT_RUBRIC: Rubric = {
  id: 'moat',
  name: 'Moat rubric',
  items: [
    { id: 'M1', question: 'ROIC > 15% in >=9 of last 10 yrs (incl. a recession yr if present)', max_score: 2, computable: true, evidence_required: 'computed from filings (annual_series ROIC)' },
    { id: 'M2', question: 'Gross margin held within +-300bps band over 10 yrs', max_score: 2, computable: true, evidence_required: 'computed from filings (gross-margin band)' },
    { id: 'M3', question: 'Documented price increases without volume/share loss', max_score: 2, computable: false, evidence_required: 'cited instances (transcripts, filings)' },
    { id: 'M4', question: 'Market share held/grown vs a funded entrant', max_score: 2, computable: false, evidence_required: 'cited' },
    { id: 'M5', question: 'Customer switching evidence (retention, contract length, churn)', max_score: 2, computable: false, evidence_required: 'cited' },
    { id: 'M6', question: 'Competitor exits or failed entries in last 10 yrs', max_score: 2, computable: false, evidence_required: 'cited' },
  ],
  thresholds: [
    { min_score: 10, tier: 'monopoly' },
    { min_score: 7, tier: 'wide' },
    { min_score: 4, tier: 'moderate' },
  ],
  floor_tier: 'narrow',
}

// ---------------------------------------------------------------------------
// Management rubric — capital-allocation discipline (all cited from proxies/transcripts/insider data).
// 6 items, max 12. Mapping mirrors the moat scale: >=10 exemplary · 7–9 strong · 4–6 adequate · <4 weak.
// ---------------------------------------------------------------------------
const MANAGEMENT_RUBRIC: Rubric = {
  id: 'management',
  name: 'Management rubric',
  items: [
    { id: 'MG1', question: 'Buybacks executed at low prices, not high', max_score: 2, computable: false, evidence_required: 'cited (buyback timing vs price, filings)' },
    { id: 'MG2', question: 'Acquisitions earned returns above cost of capital', max_score: 2, computable: false, evidence_required: 'cited (deal returns, filings)' },
    { id: 'MG3', question: 'Dividend discipline (sustainable payout, no destructive raises)', max_score: 2, computable: false, evidence_required: 'cited (payout history)' },
    { id: 'MG4', question: 'Insider alignment (meaningful ownership, sensible incentives)', max_score: 2, computable: false, evidence_required: 'cited (proxy, insider-trading data)' },
    { id: 'MG5', question: 'Candor — admits mistakes, transparent on misses', max_score: 2, computable: false, evidence_required: 'cited (letters, transcripts)' },
    { id: 'MG6', question: 'Compensation reasonable vs dilution (SBC not destroying per-share value)', max_score: 2, computable: false, evidence_required: 'cited (proxy comp, dilution)' },
  ],
  thresholds: [
    { min_score: 10, tier: 'exemplary' },
    { min_score: 7, tier: 'strong' },
    { min_score: 4, tier: 'adequate' },
  ],
  floor_tier: 'weak',
}

// ---------------------------------------------------------------------------
// Predictability rubric — BUSINESS_QUALITY lane. 5 items, max 10.
// Mapping: >=8 high · 5–7 moderate · <5 low.
//
// H4 RECONCILIATION (circle-of-competence-as-model-judgment): cashflow PREDICTABILITY is the SAME axis as
// the circle-of-competence COMPETENCE judgment ("do I understand THIS business well enough to assess its
// cashflow predictability?"), which is now a GROUNDED MODEL JUDGMENT (researchSwarm.ts → the circle gate,
// emitting circle_competence_judged: cite-verified cashflow_drivers + predictability_breakers). The model's
// grounded judgment SUBSUMES this deterministic score→tier as the predictability assessment.
//
// VERIFIED (do not assume otherwise): this deterministic PREDICTABILITY_RUBRIC is currently DORMANT — only
// JUDGMENT_RUBRICS.moat and .runway are consumed (researchSwarmCompute.ts → resolveJudgmentTiers). The
// predictability (and management) rubrics are NOT wired into any binding admit/quality gate (a repo-wide
// grep confirms no production consumer beyond this definition + its unit test). So there is NO admit gate
// to break: the fold-in is clean — predictability now lives in the circle judgment. The frozen rubric is
// retained (config provenance / possible future deterministic cross-check), explicitly superseded here.
// ---------------------------------------------------------------------------
const PREDICTABILITY_RUBRIC: Rubric = {
  id: 'predictability',
  name: 'Predictability rubric',
  items: [
    { id: 'P1', question: 'Business-model simplicity (understandable, few moving parts)', max_score: 2, computable: false, evidence_required: 'cited (filings, disclosures)' },
    { id: 'P2', question: 'Revenue recurrence / visibility (contracts, subscriptions, backlog)', max_score: 2, computable: false, evidence_required: 'cited (filings, disclosures)' },
    { id: 'P3', question: 'Customer concentration (low — no single-customer dependence)', max_score: 2, computable: false, evidence_required: 'cited (segment/customer disclosures)' },
    { id: 'P4', question: 'Low cyclicality (demand stable through a cycle)', max_score: 2, computable: false, evidence_required: 'cited (multi-year revenue, filings)' },
    { id: 'P5', question: 'Secular tailwind, not headwind', max_score: 2, computable: false, evidence_required: 'cited (industry/regulatory data)' },
  ],
  thresholds: [
    { min_score: 8, tier: 'high' },
    { min_score: 5, tier: 'moderate' },
  ],
  floor_tier: 'low',
}

// ---------------------------------------------------------------------------
// Runway rubric — reinvestment runway. 3 items, max 6.
// R1 (incremental capital deployed at high ROIC) is COMPUTABLE from the EDGAR series; R2/R3 are cited.
// Mapping (downstream contract uses proven/limited/none): >=5 proven · 2–4 limited · <2 none.
// ---------------------------------------------------------------------------
const RUNWAY_RUBRIC: Rubric = {
  id: 'runway',
  name: 'Runway rubric',
  items: [
    { id: 'R1', question: 'Incremental capital deployed at high ROIC (>10%) over the lookback', max_score: 2, computable: true, evidence_required: 'computed from filings (incremental ROIC)' },
    { id: 'R2', question: 'Visible reinvestment headroom remaining (TAM, white space)', max_score: 2, computable: false, evidence_required: 'cited (filings, disclosures)' },
    { id: 'R3', question: 'Demonstrated reinvestment rate (capital actually absorbed, not distributed)', max_score: 2, computable: false, evidence_required: 'cited (cash-flow statement, filings)' },
  ],
  thresholds: [
    { min_score: 5, tier: 'proven' },
    { min_score: 2, tier: 'limited' },
  ],
  floor_tier: 'none',
}

/**
 * The frozen DEFAULT judgment rubrics. Bump `version` on any change and log it as a deliberate config
 * change (spec Mechanism 1 — never an in-flight accommodation).
 */
export const JUDGMENT_RUBRICS: JudgmentRubrics = Object.freeze({
  version: 'judgment-rubrics-2026-06-mechanism-1-2-v1',
  moat: MOAT_RUBRIC,
  management: MANAGEMENT_RUBRIC,
  predictability: PREDICTABILITY_RUBRIC,
  runway: RUNWAY_RUBRIC,
}) as JudgmentRubrics

/**
 * Map a total rubric score to its classification tier (mechanical, spec Mechanism 1). Picks the first
 * threshold (ordered highest-first) whose min_score the score meets; falls to floor_tier below all.
 */
export function tierForScore(rubric: Rubric, totalScore: number): RubricTier {
  for (const t of rubric.thresholds) {
    if (totalScore >= t.min_score) return t.tier
  }
  return rubric.floor_tier
}

/** Ordered tiers lowest→highest for a rubric (floor first, then thresholds ascending by min_score). */
export function orderedTiers(rubric: Rubric): RubricTier[] {
  const ascending = [...rubric.thresholds].sort((a, b) => a.min_score - b.min_score).map((t) => t.tier)
  return [rubric.floor_tier, ...ascending]
}

/** Numeric index of a tier within the ordered tiers (0 = floor). -1 when the tier is unknown. */
export function tierIndex(rubric: Rubric, tier: RubricTier): number {
  return orderedTiers(rubric).indexOf(tier)
}

/** The ids of the computable rows of a rubric (harness-scored from filings). */
export function computableItemIds(rubric: Rubric): string[] {
  return rubric.items.filter((i) => i.computable).map((i) => i.id)
}

/** Maximum total score across ALL rows of a rubric (2 × item count). */
export function maxTotalScore(rubric: Rubric): number {
  return rubric.items.reduce((sum, i) => sum + i.max_score, 0)
}

/** Maximum total score across only the COMPUTABLE rows of a rubric. */
export function maxComputableScore(rubric: Rubric): number {
  return rubric.items.filter((i) => i.computable).reduce((sum, i) => sum + i.max_score, 0)
}
