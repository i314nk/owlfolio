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
import { isCitationGrounded } from './sourceGrounding'

/** A single cited durable competitive advantage from the MOAT lane's grounded thesis (B6 reframe). */
export type MoatDriverInput = {
  advantage: string
  citation: string
}

/** The MOAT lane's GROUNDED CITED THESIS (B6 reframe — mirrors the circle gate): cited drivers + the
 *  model's proposed moat_class + reasoning. The harness cite-verifies the drivers and resolves the tier
 *  from the grounded thesis with the EDGAR quant as corroboration (NOT a per-row M1-M6 rubric). */
export type MoatThesisInput = {
  moat_drivers: MoatDriverInput[]
  proposed_moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  moat_reasoning: string
}

/** The MOAT lane's judgment output: the grounded moat thesis + the (still-rubric) runway axis. The
 *  moat_thesis is OPTIONAL — the schema-retry fallback (lane omitted its judgment block) leaves it absent,
 *  which fails the moat axis closed to narrow + judgment_degraded (never a silent admit). */
export type MoatLaneJudgment = {
  moat_thesis?: MoatThesisInput
  runway: 'proven' | 'limited' | 'none'
  runway_exceptional?: boolean
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

/** A single moat-thesis driver after cite-verification (the grounded flag mirrors the circle gate). */
export type ResolvedMoatDriver = {
  advantage: string
  citation: string
  grounded: boolean
}

export type JudgmentResolution = {
  moat?: ResolveRubricTierResult & {
    /** ALWAYS defined: grounded-thesis resolved tier -> conservative default. Never undefined. */
    resolved_moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
    anchor_note?: string
    /** Set when no grounded thesis existed (the moat thesis was not emitted). Surfaced, not silent. */
    judgment_degraded?: JudgmentDegraded
    // ---- Grounded-thesis moat fields (B6 reframe — mirror the circle gate) ----
    /** The cited moat drivers, each with a cite-verified `grounded` flag. */
    moat_drivers?: ResolvedMoatDriver[]
    /** Count of distinct grounded drivers (non-empty advantage AND cite-verified citation). */
    grounded_driver_count?: number
    /** The EDGAR quant corroboration signal (M1 ROIC + M2 margin) — corroborates, never substitutes/overrides. */
    quant_anchor_tier?: RubricTier
    /** True when the model proposed a gate-passing tier (wide/monopoly) but the grounded thesis was insufficient. */
    moat_grounding_unmet?: boolean
    /** Advisory: a grounded wide/monopoly thesis sits on a WEAK quant (anchor narrow). Surfaced, never blocks. */
    quant_contradicts_moat?: boolean
  }
  runway?: ResolveRubricTierResult & {
    /** ALWAYS defined: rubric-resolved tier -> holistic fallback -> conservative default. Never undefined. */
    resolved_runway: 'proven' | 'limited' | 'none'
    anchor_note?: string
    /** Set when the tier was NOT rubric-scored (resolved holistically / by default). Surfaced, not silent. */
    judgment_degraded?: JudgmentDegraded
  }
}

// ---------------------------------------------------------------------------
// Grounded-thesis MOAT resolver (B6 reframe) — replaces the per-row M1-M6 rubric path FOR MOAT ONLY.
// (Runway still uses resolveRubricTier — a later follow-up reframes it.)
// ---------------------------------------------------------------------------

/** Minimum distinct GROUNDED moat_drivers a gate-passing tier requires. KO (pricing-power + brand + scale)
 *  clears the wide bar; monopoly demands a third grounded advantage. Defensible + conservative: a wide moat
 *  needs at least two independently-cited durable advantages, a monopoly at least three (these are the
 *  rarest, highest-stakes claims — the burden rises with the claim). Below the threshold → fail closed. */
const GROUNDED_DRIVERS_FOR_WIDE = 2
const GROUNDED_DRIVERS_FOR_MONOPOLY = 3

const MOAT_CLASS_ORDER: readonly ('narrow' | 'moderate' | 'wide' | 'monopoly')[] = ['narrow', 'moderate', 'wide', 'monopoly']

/**
 * Resolve the MOAT tier from the model's GROUNDED CITED THESIS (B6) — mirroring the circle gate's
 * grounded-thesis structure rather than the fragile per-row M1-M6 numeric rubric. The model emits
 * moat_drivers (each {advantage, citation}) + a proposed_moat_class; the harness cite-verifies each driver
 * with the SAME primitive the circle uses (non-empty text AND isCitationGrounded), counts the grounded
 * distinct drivers, and resolves the tier:
 *   - a gate-passing class (wide/monopoly) is HONORED only when enough drivers ground (>=2 for wide, >=3
 *     for monopoly); otherwise FAIL CLOSED to the tier the grounded drivers support + moat_grounding_unmet.
 *   - the EDGAR quant (computeMoatAnchor: M1 ROIC + M2 margin) CORROBORATES but never substitutes (0
 *     grounded drivers -> narrow regardless of a strong quant — A2 preserved) and never overrides (a
 *     grounded wide thesis resolves wide even on a weak quant — a weak quant raises an ADVISORY
 *     quant_contradicts_moat flag, surfaced, never blocks).
 */
function resolveMoatThesis(args: {
  thesis: MoatThesisInput
  series: AnnualFacts[]
  verifiedCitationHashes: ReadonlySet<string>
}): NonNullable<JudgmentResolution['moat']> {
  const { thesis, series, verifiedCitationHashes } = args

  // Cite-verify each driver (mirror the circle: non-empty TEXT AND a citation that verifies against the
  // content-hash-verified corpus). An empty advantage with a verified citation does NOT count (Bug A).
  const moat_drivers = thesis.moat_drivers.map((d) => ({
    advantage: d.advantage ?? '',
    citation: d.citation,
    grounded: (d.advantage?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, verifiedCitationHashes),
  }))
  // Count DISTINCT grounded advantages (dedupe identical advantage text so a repeated driver can't pad).
  const grounded_driver_count = new Set(
    moat_drivers.filter((d) => d.grounded).map((d) => d.advantage.trim().toLowerCase()),
  ).size

  // The tier the GROUNDED thesis supports (the cap): >=3 -> wide is supported AND monopoly is reachable;
  // >=2 -> wide; >=1 -> moderate; 0 grounded -> narrow (no grounded thesis = no moat, A2).
  const supportedClass: 'narrow' | 'moderate' | 'wide' | 'monopoly' =
    grounded_driver_count >= GROUNDED_DRIVERS_FOR_MONOPOLY
      ? 'monopoly'
      : grounded_driver_count >= GROUNDED_DRIVERS_FOR_WIDE
        ? 'wide'
        : grounded_driver_count >= 1
          ? 'moderate'
          : 'narrow'

  // The resolved class is the MIN of what the model proposed and what the grounded thesis supports — the
  // grounded thesis is a CEILING (it can only cap a proposal down, never inflate it). A narrow proposal
  // stays narrow even with many grounded drivers (the model's grounded judgment is honored both ways).
  const proposedIdx = MOAT_CLASS_ORDER.indexOf(thesis.proposed_moat_class)
  const supportedIdx = MOAT_CLASS_ORDER.indexOf(supportedClass)
  const resolvedIdx = Math.min(proposedIdx, supportedIdx)
  const resolved_moat_class = MOAT_CLASS_ORDER[resolvedIdx]!

  // moat_grounding_unmet: the model REACHED for a gate-passing tier (wide/monopoly) but the grounded
  // thesis could not back it (resolved below the proposal). This is the "ungrounded wide claim" — the
  // verdict routes to RESEARCH_MORE downstream. A genuinely-narrow proposal (or one fully supported) is
  // NOT unmet (PASS / set aside).
  const modelClaimedPassing = thesis.proposed_moat_class === 'wide' || thesis.proposed_moat_class === 'monopoly'
  const moat_grounding_unmet = modelClaimedPassing && resolvedIdx < proposedIdx

  // The EDGAR quant corroboration (M1 ROIC + M2 margin). Capped at 'moderate' on its own (it can never
  // substitute for a grounded thesis). quant_contradicts_moat is an ADVISORY flag: a grounded gate-passing
  // moat sitting on a WEAK quant (anchor 'narrow' / not computable) — surfaced for the human, NEVER blocks.
  const anchor = computeMoatAnchor(series)
  const quant_anchor_tier: RubricTier | undefined = anchor.computable ? anchor.anchor_tier : undefined
  const resolvedIsPassing = resolved_moat_class === 'wide' || resolved_moat_class === 'monopoly'
  const quant_contradicts_moat =
    resolvedIsPassing && (!anchor.computable || anchor.anchor_tier === 'narrow')

  const anchor_note = anchor.computable
    ? anchor.note
    : `Moat quant corroboration not computable: ${anchor.reason}`

  const violations: string[] = []
  if (moat_grounding_unmet) {
    violations.push(
      `moat-grounding-unmet: proposed '${thesis.proposed_moat_class}' but only ${grounded_driver_count} grounded `
      + `driver(s) (need ${thesis.proposed_moat_class === 'monopoly' ? GROUNDED_DRIVERS_FOR_MONOPOLY : GROUNDED_DRIVERS_FOR_WIDE}) `
      + `— failed closed to '${resolved_moat_class}'`,
    )
  }
  if (quant_contradicts_moat) {
    violations.push(
      `quant-contradicts-moat (advisory): a grounded '${resolved_moat_class}' moat thesis sits on a weak EDGAR `
      + `quant (${quant_anchor_tier ?? 'not computable'}) — surfaced, does NOT block the grounded thesis`,
    )
  }

  return {
    // ResolveRubricTierResult-compatible fields so downstream consumers + the projection keep working.
    anchor_computable: anchor.computable,
    anchor_tier: quant_anchor_tier,
    proposed_tier: thesis.proposed_moat_class,
    resolved_tier: resolved_moat_class,
    resolved_row_scores: anchor.computable ? anchor.row_scores : {},
    adjustment_applied: false,
    verified_evidence_count: grounded_driver_count,
    grounding_capped: moat_grounding_unmet,
    violations,
    // Grounded-thesis fields.
    resolved_moat_class,
    moat_drivers,
    grounded_driver_count,
    ...(quant_anchor_tier !== undefined ? { quant_anchor_tier } : {}),
    ...(moat_grounding_unmet ? { moat_grounding_unmet: true } : {}),
    ...(quant_contradicts_moat ? { quant_contradicts_moat: true } : {}),
    anchor_note,
  }
}

/**
 * Resolve the moat + runway tiers — ALWAYS yielding a defined resolved tier so the omission of the moat
 * thesis / runway rubric can never silently void the downstream valuation.
 *
 * MOAT (B6 reframe): resolved from the model's GROUNDED CITED THESIS (resolveMoatThesis) — NOT a per-row
 * rubric. The quant (computeMoatAnchor) corroborates; it never substitutes/overrides. A gate-passing class
 * is honored only when enough drivers ground; an ungrounded wide/monopoly claim FAILS CLOSED + flags
 * moat_grounding_unmet. No thesis at all -> narrow + judgment_degraded (silent-skip guard).
 *
 * RUNWAY (unchanged): mechanical anchor (EDGAR) + bounded ±1 adjustment (resolveRubricTier). Runway feeds
 * GROWTH credit, not the moat gate, so it keeps its holistic fallback.
 */
export function resolveJudgmentTiers(args: {
  /** The MOAT lane's grounded cited thesis (B6). When absent -> fail closed to narrow + judgment_degraded. */
  moatThesis?: MoatThesisInput | undefined
  runwayRubric?: LaneRubricInput | undefined
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

  // --- Moat axis (B6 reframe: GROUNDED CITED THESIS, not a per-row rubric) ---
  let moat: JudgmentResolution['moat']
  if (args.moatThesis !== undefined) {
    moat = resolveMoatThesis({
      thesis: args.moatThesis,
      series,
      verifiedCitationHashes: args.verifiedCitationHashes,
    })
  } else {
    // No moat thesis supplied — FAIL CLOSED to narrow (do NOT admit on a bare/absent claim), VISIBLY
    // flagged. wide+ requires a grounded, cite-verified moat thesis — not a model assertion or silence.
    moat = {
      ...degradedResult(DEFAULT_MOAT_CLASS as RubricTier),
      resolved_moat_class: DEFAULT_MOAT_CLASS,
      judgment_degraded: 'rubric_not_emitted',
      anchor_note: 'Moat thesis not emitted by the model — failed closed to narrow (a moat class requires a grounded, cite-verified moat thesis; an absent thesis is not trusted to pass the gate).',
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
  // ---- Grounded-thesis MOAT projection (B6) — the cited advantages + their grounded flags + the flags. ----
  moat_drivers?: ResolvedMoatDriver[]
  grounded_driver_count?: number
  moat_grounding_unmet?: boolean
  quant_contradicts_moat?: boolean
}

type JudgmentProjection = {
  rubric_version: string
  moat?: JudgmentAxisProjection
  runway?: JudgmentAxisProjection
}

/** Build the serializable judgment-layer projection (rubric scores + anchor-vs-proposed) for the dossier. */
export function buildJudgmentProjection(judgment: JudgmentResolution): JudgmentProjection | undefined {
  function axis(
    r: (ResolveRubricTierResult & {
      anchor_note?: string
      judgment_degraded?: JudgmentDegraded
      // B6 grounded-thesis moat fields (present only on the moat axis).
      moat_drivers?: ResolvedMoatDriver[]
      grounded_driver_count?: number
      moat_grounding_unmet?: boolean
      quant_contradicts_moat?: boolean
    }) | undefined,
  ): JudgmentAxisProjection | undefined {
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
      // B6 grounded-thesis moat projection (the cited advantages + grounded flags + the flags).
      ...(r.moat_drivers === undefined ? {} : { moat_drivers: r.moat_drivers }),
      ...(r.grounded_driver_count === undefined ? {} : { grounded_driver_count: r.grounded_driver_count }),
      ...(r.moat_grounding_unmet ? { moat_grounding_unmet: true } : {}),
      ...(r.quant_contradicts_moat ? { quant_contradicts_moat: true } : {}),
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
 * Build the PRE-VERIFIED PRIMARY SOURCES prompt block (citation/corpus-alignment fix for the KO
 * regression). Lists the harness's ALREADY-fetched + content-hash-verified EDGAR primary source_ids
 * (the resolver 10-K, and any 10-Q / submissions ids) and instructs the agent to cite THOSE source_ids
 * for filing-backed claims, rather than inventing its own SEC archive URLs (which fetch unreliably and
 * then fail the strict content-hash cite-check — exactly the bug that scored KO's wide-moat rows to 0).
 * Returns '' for an empty list so callers can append unconditionally. This does NOT loosen verification:
 * the ids listed here are precisely the ones the harness already verified.
 */
export function buildPreVerifiedSourcesBlock(sourceIds: readonly string[]): string {
  const ids = sourceIds.filter((id) => id.trim().length > 0)
  if (ids.length === 0) return ''
  return (
    `\n\nPRE-VERIFIED PRIMARY SOURCES (already fetched + content-verified by the harness — cite THESE `
    + `source_ids for filing-backed claims; do NOT invent your own SEC archive URLs, which fetch `
    + `unreliably and will FAIL the harness cite-check): [${ids.join(', ')}]. `
    + `For any filing-backed claim — the moat qualitative rows, the circle-of-competence cashflow drivers `
    + `and predictability breakers, and the valuation owner-earnings / assumed-growth citations — set the `
    + `citation to one of these pre-verified source_ids. You may still propose ADDITIONAL sources for `
    + `non-EDGAR facts, but a filing-backed claim citing an unverified id will be dropped.`
  )
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
