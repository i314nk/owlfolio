import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'
import { JUDGMENT_RUBRICS, type RubricTier } from '@owlfolio/strategies/judgmentRubrics'
import {
  computeMoatAnchor,
  type ResolveRubricTierResult,
} from './judgmentAnchor'
import type { AnnualFacts, Fundamentals } from './secEdgar'
import type { InsiderSummaryComputed } from './secForm4'
import { isCitationGrounded } from './sourceGrounding'

/**
 * The moat TYPE taxonomy (S3, owner-locked 2026-07-11). `monopoly_position` (a granted/structural
 * monopoly — regulatory, patent, utility) is deliberately NOT the WIDTH class value `monopoly`;
 * the two axes never share an id.
 */
export const MOAT_TYPES = [
  'brand',
  'switching_costs',
  'network_effect',
  'intangible_assets',
  'toll_bridge',
  'cost_advantage',
  'scale_advantage',
  'barrier_to_entry',
  'monopoly_position',
] as const
export type MoatType = (typeof MOAT_TYPES)[number]

/** A single cited durable competitive advantage from the MOAT lane's grounded thesis (B6 reframe).
 *  `moat_type` (S3) tags which taxonomy type the advantage is — optional on read (legacy drivers are
 *  untyped; an untyped driver still counts for WIDTH, it just contributes no type chip). */
export type MoatDriverInput = {
  advantage: string
  citation: string
  moat_type?: MoatType
}

/** A single cited moat-DIRECTION driver (S3): the observable evidence the direction claim rests on. */
export type MoatDirectionDriverInput = {
  evidence: string
  citation: string
}

/** The peer-standout judgment (S3): named industry peers + their gross margins, cited-or-labeled.
 *  Peers are NOT harness-fetched in v1 — a peer whose citation does not verify is stamped
 *  model_asserted by the resolver and the dossier labels it; it is never silently trusted. */
export type PeerStandoutInput = {
  peers: Array<{ name: string; gross_margin_note: string; citation?: string }>
  judgment: 'stands_out' | 'in_line' | 'lags' | 'cannot_assess'
  reasoning: string
}

/** The MOAT lane's GROUNDED CITED THESIS (B6 reframe — mirrors the circle gate): cited drivers + the
 *  model's proposed moat_class + reasoning. The harness cite-verifies the drivers and resolves the tier
 *  from the grounded thesis with the EDGAR quant as corroboration (NOT a per-row M1-M6 rubric). */
export type MoatThesisInput = {
  moat_drivers: MoatDriverInput[]
  proposed_moat_class: 'narrow' | 'moderate' | 'wide' | 'monopoly'
  moat_reasoning: string
  // ---- S3 optional judgment extensions (absent on legacy lane outputs — each fails closed) ----
  /** The model's moat-direction judgment. Resolves only when >=1 direction driver grounds. */
  moat_direction?: 'widening' | 'stable' | 'narrowing'
  direction_drivers?: MoatDirectionDriverInput[]
  direction_reasoning?: string
  /** The peer-standout judgment (peers cited-or-labeled; company-side numbers are the T0 moat tests). */
  peer_standout?: PeerStandoutInput
}

/** The MOAT lane's judgment output (C2: the runway judged axis is retired). moat_thesis is OPTIONAL —
 *  the schema-retry fallback (lane omitted its judgment block) leaves it absent, which fails the axis
 *  closed to narrow + judgment_degraded (never a silent admit). */
export type MoatLaneJudgment = {
  moat_thesis?: MoatThesisInput
}

// ---------------------------------------------------------------------------------------------------
// S5 (Phase 3 pillars): the MANAGEMENT pillar's judgment — two core traits (owner-locked 2026-07-11):
// INTEGRITY (communication monitoring via filings/letters/calls + executive-comp structure from the
// DEF 14A) and TALENT (ROIC / dividends-and-buybacks / debt management, reconciled against the
// injected T0 block). Same grounding spine as the moat/circle. The WORST tiers (red_flag / poor)
// carry VETO teeth downstream (BUY → RESEARCH_MORE naming the failed trait), so they are honored
// ONLY when grounded — the veto can never fire on hallucination.
// ---------------------------------------------------------------------------------------------------

/** The management lane's raw judgment blocks (both optional — absent = degrade, never silent-clean). */
export type ManagementLaneThesis = {
  integrity?: {
    communication_observations: Array<{ observation: string; citation: string }>
    comp_structure: { summary: string; incentive_metrics?: string[] | undefined; alignment: 'aligned' | 'mixed' | 'misaligned'; citation: string }
    integrity_flags: Array<{ claim: string; severity: 'low' | 'medium' | 'high'; citation: string }>
    proposed_integrity: 'clean' | 'concerns' | 'red_flag'
    integrity_reasoning: string
  }
  talent?: {
    talent_drivers: Array<{ evidence: string; citation: string }>
    proposed_talent: 'excellent' | 'adequate' | 'poor'
    talent_reasoning: string
  }
}

export type ResolvedManagementJudgment = {
  /** clean/concerns honored per grounding; red_flag ONLY with a grounded HIGH-severity flag. */
  resolved_integrity: 'clean' | 'concerns' | 'red_flag' | 'undetermined'
  /** excellent needs >=2 grounded drivers (capped to adequate below); poor honored only when grounded. */
  resolved_talent: 'excellent' | 'adequate' | 'poor' | 'undetermined'
  integrity?: {
    communication_observations: Array<{ observation: string; citation: string; grounded: boolean }>
    comp_structure: { summary: string; incentive_metrics?: string[] | undefined; alignment: 'aligned' | 'mixed' | 'misaligned'; citation: string }
    comp_grounded: boolean
    flags: Array<{ claim: string; severity: 'low' | 'medium' | 'high'; citation: string; grounded: boolean }>
    grounded_high_flag_count: number
    proposed_integrity: 'clean' | 'concerns' | 'red_flag'
    integrity_reasoning: string
  }
  talent?: {
    talent_drivers: Array<{ evidence: string; citation: string; grounded: boolean }>
    grounded_driver_count: number
    proposed_talent: 'excellent' | 'adequate' | 'poor'
    talent_reasoning: string
    /** True when an 'excellent' proposal was capped by the grounded-driver count. */
    talent_grounding_capped?: boolean
  }
  /** Set when the lane omitted its judgment blocks (retry exhausted) — surfaced, never silent. */
  judgment_degraded?: boolean
  /** Advisory: a grounded excellent talent sits on a WEAK T0 ROIC band. Surfaced, never blocks. */
  t0_contradicts_talent?: boolean
}

/** Minimum grounded talent drivers for 'excellent' (mirror of the moat's wide threshold). */
const GROUNDED_DRIVERS_FOR_EXCELLENT = 2

export function resolveManagementJudgment(args: {
  thesis: ManagementLaneThesis
  verifiedCitationHashes: ReadonlySet<string>
  /** The T0 ROIC band (from computeManagementTalentT0) for the advisory contradiction flag. */
  t0RoicBand?: 'excellent' | 'solid' | 'weak'
}): ResolvedManagementJudgment {
  const { thesis, verifiedCitationHashes } = args
  const grounded = (text: string | undefined, citation: string | undefined): boolean =>
    (text?.trim().length ?? 0) > 0 && citation !== undefined && isCitationGrounded(citation, verifiedCitationHashes)

  // ---- INTEGRITY ----
  let resolved_integrity: ResolvedManagementJudgment['resolved_integrity'] = 'undetermined'
  let integrity: ResolvedManagementJudgment['integrity']
  if (thesis.integrity !== undefined) {
    const obs = thesis.integrity.communication_observations.map((o) => ({
      observation: o.observation ?? '',
      citation: o.citation,
      grounded: grounded(o.observation, o.citation),
    }))
    const comp_grounded = isCitationGrounded(thesis.integrity.comp_structure.citation, verifiedCitationHashes)
    const flags = thesis.integrity.integrity_flags.map((f) => ({
      claim: f.claim ?? '',
      severity: f.severity,
      citation: f.citation,
      grounded: grounded(f.claim, f.citation),
    }))
    const grounded_high_flag_count = flags.filter((f) => f.grounded && f.severity === 'high').length
    const groundedObsCount = obs.filter((o) => o.grounded).length
    const groundedFlagCount = flags.filter((f) => f.grounded).length
    // red_flag ONLY on a grounded high-severity flag (veto teeth); concerns needs SOME grounded
    // evidence; clean must be DEMONSTRATED (grounded comp citation + >=1 grounded observation) —
    // an unverifiable "all clear" is undetermined, not clean.
    resolved_integrity = thesis.integrity.proposed_integrity === 'red_flag'
      ? (grounded_high_flag_count >= 1 ? 'red_flag' : 'undetermined')
      : thesis.integrity.proposed_integrity === 'concerns'
        ? (groundedFlagCount >= 1 || groundedObsCount >= 1 ? 'concerns' : 'undetermined')
        : (comp_grounded && groundedObsCount >= 1 ? 'clean' : 'undetermined')
    integrity = {
      communication_observations: obs,
      comp_structure: thesis.integrity.comp_structure,
      comp_grounded,
      flags,
      grounded_high_flag_count,
      proposed_integrity: thesis.integrity.proposed_integrity,
      integrity_reasoning: thesis.integrity.integrity_reasoning,
    }
  }

  // ---- TALENT ----
  let resolved_talent: ResolvedManagementJudgment['resolved_talent'] = 'undetermined'
  let talent: ResolvedManagementJudgment['talent']
  let talent_grounding_capped = false
  if (thesis.talent !== undefined) {
    const drivers = thesis.talent.talent_drivers.map((d) => ({
      evidence: d.evidence ?? '',
      citation: d.citation,
      grounded: grounded(d.evidence, d.citation),
    }))
    const grounded_driver_count = new Set(
      drivers.filter((d) => d.grounded).map((d) => d.evidence.trim().toLowerCase()),
    ).size
    if (thesis.talent.proposed_talent === 'poor') {
      // poor carries veto teeth — honored only when grounded.
      resolved_talent = grounded_driver_count >= 1 ? 'poor' : 'undetermined'
    } else if (thesis.talent.proposed_talent === 'excellent') {
      resolved_talent = grounded_driver_count >= GROUNDED_DRIVERS_FOR_EXCELLENT
        ? 'excellent'
        : grounded_driver_count >= 1
          ? 'adequate'
          : 'undetermined'
      talent_grounding_capped = resolved_talent !== 'excellent' && grounded_driver_count >= 1
    } else {
      resolved_talent = grounded_driver_count >= 1 ? 'adequate' : 'undetermined'
    }
    talent = {
      talent_drivers: drivers,
      grounded_driver_count,
      proposed_talent: thesis.talent.proposed_talent,
      talent_reasoning: thesis.talent.talent_reasoning,
      ...(talent_grounding_capped ? { talent_grounding_capped: true } : {}),
    }
  }

  const judgment_degraded = thesis.integrity === undefined && thesis.talent === undefined
  const t0_contradicts_talent = resolved_talent === 'excellent' && args.t0RoicBand === 'weak'

  return {
    resolved_integrity,
    resolved_talent,
    ...(integrity !== undefined ? { integrity } : {}),
    ...(talent !== undefined ? { talent } : {}),
    ...(judgment_degraded ? { judgment_degraded: true } : {}),
    ...(t0_contradicts_talent ? { t0_contradicts_talent: true } : {}),
  }
}

/** The SHARIAH lane's judgment overlay (the harness recomputes the AAOIFI ratios from this). */
export type ShariahLaneJudgment = {
  sector_status: 'compliant' | 'conditional' | 'non_compliant'
  /**
   * Non-permissible income in $M. `null` = UNDETERMINED — the lane could not extract / the filing does
   * not separately disclose it. The harness fails CLOSED on null (ratios not-computable → UNDETERMINED
   * verdict), NEVER treating it as a clean 0%. A numeric 0 is a real, affirmatively-verified value.
   */
  impermissible_income: number | null
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
// Judgment objectivity: grounded cited theses (moat + runway) -> tier, with the EDGAR quant corroborating.
// (The per-row rubric input shape + resolveRubricTier mapping was retired when both axes were reframed.)
// ---------------------------------------------------------------------------

/** Why an axis resolved holistically rather than from a grounded thesis (visible degradation, never silent). */
export type JudgmentDegraded = 'rubric_not_emitted'

/** Conservative explicit defaults when NEITHER a rubric NOR a holistic value exists. These fail the
 *  moat gate (narrow) / earn no growth credit (none) — never an undefined that silently voids the
 *  valuation downstream. */
const DEFAULT_MOAT_CLASS = 'narrow' as const

/** A single moat-thesis driver after cite-verification (the grounded flag mirrors the circle gate). */
export type ResolvedMoatDriver = {
  advantage: string
  citation: string
  grounded: boolean
  /** S3: the taxonomy type the driver claims (absent on legacy/untyped drivers). */
  moat_type?: MoatType
}

/** A single moat-direction driver after cite-verification (S3). */
export type ResolvedMoatDirectionDriver = {
  evidence: string
  citation: string
  grounded: boolean
}

/** One named peer after the deterministic cited-or-labeled stamp (S3). */
export type ResolvedPeerStandoutPeer = {
  name: string
  gross_margin_note: string
  citation?: string
  /** True when the peer's figure did NOT verify against the corpus — displayed as "model-asserted". */
  model_asserted: boolean
  grounded: boolean
}

/** The resolved peer-standout judgment (S3): verbatim judgment + per-peer grounding stamps. */
export type ResolvedPeerStandout = {
  peers: ResolvedPeerStandoutPeer[]
  judgment: 'stands_out' | 'in_line' | 'lags' | 'cannot_assess'
  reasoning: string
  grounded_peer_count: number
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
    // ---- S3 (Phase 3): taxonomy + direction + peer standout ----
    /** Distinct taxonomy types of the GROUNDED drivers only (taxonomy never rests on ungrounded claims). */
    resolved_moat_types?: MoatType[]
    /** Grounded-only direction: the proposal iff >=1 direction driver grounds; else 'undetermined'
     *  (NEVER a silent 'stable' default; an undetermined direction has no policy teeth). */
    moat_direction?: 'widening' | 'stable' | 'narrowing' | 'undetermined'
    /** The direction drivers with cite-verified grounded stamps. */
    direction_drivers?: ResolvedMoatDirectionDriver[]
    /** True when a direction was PROPOSED but no driver grounded (claimed-but-unbacked, surfaced). */
    direction_ungrounded?: boolean
    direction_reasoning?: string
    /** The peer-standout judgment with per-peer model_asserted/grounded stamps. */
    peer_standout?: ResolvedPeerStandout
  }
}

// ---------------------------------------------------------------------------
// Grounded-thesis MOAT resolver (B6 reframe) — replaces the per-row M1-M6 rubric path FOR MOAT ONLY.
// (Runway is now ALSO a grounded cited thesis — see resolveRunwayThesis below; resolveRubricTier is dead.)
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
    // S3: carry the taxonomy type through cite-verification (absent on legacy/untyped drivers).
    ...(d.moat_type !== undefined && (MOAT_TYPES as readonly string[]).includes(d.moat_type) ? { moat_type: d.moat_type } : {}),
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

  // ---- S3: taxonomy — the distinct types of GROUNDED drivers only (no taxonomy theater). ----
  const resolved_moat_types = [...new Set(
    moat_drivers.filter((d) => d.grounded && d.moat_type !== undefined).map((d) => d.moat_type as MoatType),
  )]

  // ---- S3: direction — grounded-only; NEVER a silent 'stable' default. ----
  // "A narrowing moat is a sell signal no matter how wide it still looks" — so the claim carries
  // policy teeth downstream (BUY→WATCH), which means ONLY a grounded direction may resolve. A
  // proposed-but-unbacked direction is 'undetermined' + direction_ungrounded (claimed, surfaced,
  // toothless); an omitted/legacy direction is 'undetermined' without the flag (nothing claimed).
  const direction_drivers: ResolvedMoatDirectionDriver[] = (thesis.direction_drivers ?? []).map((d) => ({
    evidence: d.evidence ?? '',
    citation: d.citation,
    grounded: (d.evidence?.trim().length ?? 0) > 0 && isCitationGrounded(d.citation, verifiedCitationHashes),
  }))
  const directionGroundedCount = direction_drivers.filter((d) => d.grounded).length
  const moat_direction: NonNullable<JudgmentResolution['moat']>['moat_direction'] =
    thesis.moat_direction !== undefined && directionGroundedCount >= 1 ? thesis.moat_direction : 'undetermined'
  const direction_ungrounded = thesis.moat_direction !== undefined && directionGroundedCount === 0

  // ---- S3: peer standout — cited-or-labeled, stamped deterministically. ----
  // Peers are not harness-fetched in v1: a peer figure whose citation verifies against the corpus is
  // grounded; anything else (no citation, or a citation that does not verify) is model_asserted and
  // the dossier labels it. The judgment is recorded VERBATIM either way — it is display/judgment
  // context feeding the lane's thesis, never anchor arithmetic (that upgrade ships with peer fetching).
  const peer_standout: ResolvedPeerStandout | undefined = thesis.peer_standout === undefined
    ? undefined
    : (() => {
        const peers: ResolvedPeerStandoutPeer[] = thesis.peer_standout.peers.map((p) => {
          const grounded = p.citation !== undefined && isCitationGrounded(p.citation, verifiedCitationHashes)
          return {
            name: p.name,
            gross_margin_note: p.gross_margin_note,
            ...(p.citation !== undefined ? { citation: p.citation } : {}),
            model_asserted: !grounded,
            grounded,
          }
        })
        return {
          peers,
          judgment: thesis.peer_standout.judgment,
          reasoning: thesis.peer_standout.reasoning,
          grounded_peer_count: peers.filter((p) => p.grounded).length,
        }
      })()

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
    // S3: taxonomy + direction + peer standout.
    resolved_moat_types,
    moat_direction,
    ...(direction_drivers.length > 0 ? { direction_drivers } : {}),
    ...(direction_ungrounded ? { direction_ungrounded: true } : {}),
    ...(thesis.direction_reasoning !== undefined ? { direction_reasoning: thesis.direction_reasoning } : {}),
    ...(peer_standout !== undefined ? { peer_standout } : {}),
  }
}

// ---------------------------------------------------------------------------
// Grounded-thesis RUNWAY resolver (runway reframe) — replaces the per-row R1-R3 rubric path FOR RUNWAY.
// Mirror of resolveMoatThesis. KEY DIFFERENCE: runway is NOT a verdict gate (it feeds growth credit), so
// runway_grounding_unmet + quant_contradicts_runway are ADVISORY flags — there is NO RESEARCH_MORE routing.
// Fail-closed for runway = a CONSERVATIVE runway (limited/none) feeding less growth credit.
// ---------------------------------------------------------------------------

/** Minimum distinct GROUNDED runway_drivers each tier requires. A proven runway needs at least two
 *  independently-cited durable headroom drivers; a limited runway at least one; below that -> none (the
 *  rarest, highest-stakes claim — proven — carries the higher burden). Mirror of the moat thresholds. */



/**
 * Resolve the moat + runway tiers — ALWAYS yielding a defined resolved tier so the omission of either
 * grounded thesis can never silently void the downstream valuation.
 *
 * MOAT (B6 reframe): resolved from the model's GROUNDED CITED THESIS (resolveMoatThesis) — NOT a per-row
 * rubric. The quant (computeMoatAnchor) corroborates; it never substitutes/overrides. A gate-passing class
 * is honored only when enough drivers ground; an ungrounded wide/monopoly claim FAILS CLOSED + flags
 * moat_grounding_unmet. No thesis at all -> narrow + judgment_degraded (silent-skip guard).
 *
 * RUNWAY (runway reframe): resolved from the model's GROUNDED CITED THESIS (resolveRunwayThesis) — NOT a
 * per-row rubric. Same shape as moat. KEY DIFFERENCE: runway is NOT a verdict gate (it feeds growth credit),
 * so an ungrounded proven claim FAILS CLOSED to a conservative runway with an ADVISORY runway_grounding_unmet
 * flag (no RESEARCH_MORE). No thesis at all -> none (conservative) + judgment_degraded.
 */
export function resolveJudgmentTiers(args: {
  /** The MOAT lane's grounded cited thesis (B6). When absent -> fail closed to narrow + judgment_degraded. */
  moatThesis?: MoatThesisInput | undefined
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

  // C2 (owner-locked): the runway judged axis is retired.
  return { moat }
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
  // ---- S3 (Phase 3): taxonomy + direction + peer standout (moat axis only). ----
  resolved_moat_types?: MoatType[]
  moat_direction?: 'widening' | 'stable' | 'narrowing' | 'undetermined'
  direction_drivers?: ResolvedMoatDirectionDriver[]
  direction_ungrounded?: boolean
  direction_reasoning?: string
  peer_standout?: ResolvedPeerStandout
}

type JudgmentProjection = {
  rubric_version: string
  /** Composite engine-version marker (derived from the methodology versions) — the run's reasoning vintage. */
  engine_version: string
  /** Best-effort provenance: the engine git commit, ONLY when OWLFOLIO_ENGINE_COMMIT is set+nonempty. */
  engine_commit?: string
  moat?: JudgmentAxisProjection
  runway?: JudgmentAxisProjection
}

// Best-effort engine-commit provenance: read ONLY from the env var (never shell out to git). Omitted when
// the var is unset or empty so legacy/local runs simply carry no commit field.
export function resolveEngineCommit(): string | undefined {
  const commit = process.env.OWLFOLIO_ENGINE_COMMIT
  return commit !== undefined && commit.trim() !== '' ? commit.trim() : undefined
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
      // S3 (moat axis only).
      resolved_moat_types?: MoatType[]
      moat_direction?: 'widening' | 'stable' | 'narrowing' | 'undetermined'
      direction_drivers?: ResolvedMoatDirectionDriver[]
      direction_ungrounded?: boolean
      direction_reasoning?: string
      peer_standout?: ResolvedPeerStandout
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
      // S3 (Phase 3): taxonomy + direction + peer standout (moat axis only).
      ...(r.resolved_moat_types === undefined ? {} : { resolved_moat_types: r.resolved_moat_types }),
      ...(r.moat_direction === undefined ? {} : { moat_direction: r.moat_direction }),
      ...(r.direction_drivers === undefined ? {} : { direction_drivers: r.direction_drivers }),
      ...(r.direction_ungrounded ? { direction_ungrounded: true } : {}),
      ...(r.direction_reasoning === undefined ? {} : { direction_reasoning: r.direction_reasoning }),
      ...(r.peer_standout === undefined ? {} : { peer_standout: r.peer_standout }),
    }
  }
  const moat = axis(judgment.moat)
  if (moat === undefined) return undefined
  const engineCommit = resolveEngineCommit()
  return {
    rubric_version: JUDGMENT_RUBRICS.version,
    // Engine-version marker: stamps the run's reasoning vintage so the dossier can flag stale runs.
    engine_version: ENGINE_VERSION,
    ...(engineCommit === undefined ? {} : { engine_commit: engineCommit }),
    ...(moat === undefined ? {} : { moat }),
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
    + `You can READ these sources by Item with the read_source tool — e.g. read_source(source_id, section="1A") `
    + `for Risk Factors, "1" for Business, "7" for MD&A — to ground your qualitative reasoning in the primary `
    + `filing text rather than memory. `
    + `For any filing-backed claim — the moat qualitative rows, the circle-of-competence cashflow drivers `
    + `and predictability breakers, and the valuation owner-earnings / assumed-growth citations — set the `
    + `citation to one of these pre-verified source_ids. You may still propose ADDITIONAL sources for `
    + `non-EDGAR facts, but a filing-backed claim citing an unverified id will be dropped.`
  )
}

/**
 * Build the RECENT INTERIM FILINGS affordance block — 8-K / 10-Q narrative grounded for interim recency
 * (Slice B). Lists the harness-verified readable source_ids (form + filed date) and instructs the model
 * to read_source them for thesis-break developments. NUMBERS are explicitly out of bounds (the harness
 * computes valuation on the annual basis only). Returns '' for an empty list.
 */
export function buildRecentFilingsBlock(
  entries: readonly { source_id: string; form: string; filed: string }[],
): string {
  if (entries.length === 0) return ''
  const lines = entries.map((e) => `  - ${e.form} filed ${e.filed}: read_source("${e.source_id}")`).join('\n')
  return (
    `\n\nRECENT INTERIM FILINGS (8-K / 6-K material events + 10-Q interim narrative filed SINCE the latest annual report — `
    + `already fetched + content-verified by the harness). READ them by Item/section with read_source for `
    + `recent developments that can break the thesis: impairments, guidance cuts, executive departures, `
    + `M&A, litigation, updated risk factors:\n${lines}\n`
    + `Use these for QUALITATIVE / recency context and cite the source_id. Do NOT use interim quarterly `
    + `NUMBERS for valuation — the harness computes valuation on the ANNUAL basis only.`
  )
}

/**
 * Build the LATEST PROXY STATEMENT affordance block (3.1) — the definitive DEF 14A grounded as a
 * readable document for the management (+ moat) lanes. Points the model at incentive structure,
 * governance, insider ownership, and related-party text; proxy NUMBERS are explicitly out of bounds
 * (comp tables are read as text for qualitative judgment, never computed figures). Returns '' when
 * no proxy grounded (append-safe).
 */
export function buildProxyBlock(entry: { source_id: string; filed: string } | undefined): string {
  if (entry === undefined || entry.source_id.length === 0) return ''
  return (
    `\n\nLATEST PROXY STATEMENT (DEF 14A, filed ${entry.filed} — already fetched + content-verified by `
    + `the harness). READ it with read_source("${entry.source_id}") for executive compensation structure `
    + `and incentive alignment (EPS-linked vs revenue vs return-on-capital), insider ownership, board `
    + `composition/independence, dual-class/entrenchment provisions, and related-party transactions; `
    + `cite the source_id for proxy-backed claims. Do NOT use proxy numbers for valuation — the harness `
    + `computes valuation on the annual filing basis only.`
  )
}

/**
 * Build the INSIDER TRANSACTIONS affordance block (§3.3) — the deterministically-parsed Form 4 summary
 * injected into the MANAGEMENT lane. This is a harness OBSERVATION (computed, not narrative to read):
 * discretionary open-market buys/sells only; mechanical RSU/option/tax activity is surfaced separately so
 * it is never mistaken for insider selling. Always given a computable summary; callers omit it otherwise.
 */
export function buildInsiderBlock(summary: InsiderSummaryComputed): string {
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
  const sh = (v: number) => v.toLocaleString('en-US')
  const clusterLine = summary.cluster === undefined
    ? ''
    : `\n  - CLUSTER: ${summary.cluster.discretionary_sell_count} discretionary sale(s) by `
      + `${summary.cluster.distinct_sellers} insider(s) within ${summary.cluster.window_days} days `
      + `(~${usd(summary.cluster.net_sell_value)} net).`
  const truncatedNote = summary.window_truncated
    ? ` (NOTE: filing window capped — older Form 4s beyond the cap are not included, so counts are a recent-window floor.)`
    : ''
  return (
    `\n\nINSIDER TRANSACTIONS (SEC Form 4, trailing ${summary.window_months} months as of ${summary.as_of} — `
    + `deterministically parsed by the harness; treat as an OBSERVATION, do NOT re-derive or fetch).${truncatedNote} `
    + `Discretionary OPEN-MARKET activity only — option/RSU exercises, grants, and tax-withholding are mechanical and EXCLUDED from these buy/sell figures:\n`
    + `  - Discretionary BUYS: ${sh(summary.discretionary_buy_shares)} shares (~${usd(summary.discretionary_buy_value)}) by ${summary.distinct_buyers} insider(s).\n`
    + `  - Discretionary SELLS: ${sh(summary.discretionary_sell_shares)} shares (~${usd(summary.discretionary_sell_value)}) by ${summary.distinct_sellers} insider(s); `
    + `officers/directors ${sh(summary.officer_director_sell_shares)} shares, 10% owners ${sh(summary.ten_percent_owner_sell_shares)} shares.\n`
    + `  - Mechanical (RSU vest / option exercise / tax withholding), NOT sales: ${sh(summary.mechanical_disposed_shares)} shares disposed.`
    + `${clusterLine}\n`
    + `Weigh this as a management-quality signal (insider conviction vs distribution). Cite it as harness-computed Form 4 data; NEVER treat mechanical vesting/withholding as discretionary insider selling.`
  )
}

/**
 * Build a compact, grounded primary-filing context block for injection into a lane prompt. Includes
 * the OE-bridge raw inputs, revenue, debt, cash, interest expense, the multi-year series, and the
 * grounded EDGAR source_id the lane MUST cite.
 */
export function buildPrimaryFilingBlock(f: Fundamentals, sourceId: string, form = '10-K'): string {
  const la = f.latest_annual
  const series = f.annual_series.slice(0, 11) // latest + up to 10 prior years
  const seriesLines = series.map((a) =>
    `  FY${a.fiscal_year}: NI ${fmtMusd(a.net_income_musd)}, rev ${fmtMusd(a.revenue_musd)}, `
    + `D&A ${fmtMusd(a.d_and_a_musd)}, capex ${fmtMusd(a.capex_musd)}, SBC ${fmtMusd(a.sbc_musd)}, `
    + `diluted shares ${fmtShares(a.diluted_shares_m)}`,
  ).join('\n')

  return (
    `\n\nPrimary filing data (SEC EDGAR, FY${la.fiscal_year}, source ${sourceId}) — ${f.entity_name} (CIK ${f.cik}). `
    + `These are RAW values from the latest ${form}, in $millions and share-millions. USE these primary numbers `
    + `as the authoritative basis for your finding (you may still normalize, e.g. estimate the maintenance-capex `
    + `fraction of total capex), and CITE source ${sourceId} (the EDGAR ${form}) in proposed_sources.\n`
    + `Latest annual (FY${la.fiscal_year}): net_income ${fmtMusd(la.net_income_musd)}, revenue ${fmtMusd(la.revenue_musd)}, `
    + `D&A ${fmtMusd(la.d_and_a_musd)}, total_capex ${fmtMusd(la.capex_musd)}, SBC ${fmtMusd(la.sbc_musd)}, `
    + `diluted_shares ${fmtShares(la.diluted_shares_m)}, shares_outstanding ${fmtShares(la.shares_outstanding_m)}, `
    + `total_debt ${fmtMusd(la.total_debt_musd)}, cash_and_securities ${fmtMusd(la.cash_and_securities_musd)}, `
    + `interest_expense ${fmtMusd(la.interest_expense_musd)}.\n`
    + `Multi-year annual series (newest first, ${series.length} of ${f.annual_series.length} yrs):\n${seriesLines}`
  )
}

/**
 * Build the QUICK-SCREEN-specific grounded-filing block. UNLIKE buildPreVerifiedSourcesBlock /
 * buildPrimaryFilingBlock (which instruct the model to put the source_id INTO proposed_sources / cite a
 * source in proposed_sources — correct for the deep-dive/circle schemas that HAVE a `citation` field), the
 * quick-screen schema has NO citation field, so a source_id must NEVER land in proposed_sources. This block
 * (a) names the harness pre-verified filing source_id for reference, (b) folds in the real harness-fetched
 * financials so the worth-investigating read is grounded in numbers, and (c) ends with an unambiguous rule:
 * proposed_sources is for REAL fetched URLs ONLY — never a source_id, never an invented URL — and may be the
 * empty array [] when the model fetched nothing extra (the filing is already harness-verified). This is the
 * regression fix: the source_id-in-proposed_sources.url invalid-URL crash can no longer happen.
 */
export function buildQuickScreenFilingBlock(f: Fundamentals, sourceId: string): string {
  const la = f.latest_annual
  return (
    `\n\nHARNESS PRE-VERIFIED PRIMARY FILING (already fetched + content-verified by the harness — this IS your `
    + `grounding; you do NOT need to fetch or propose anything to be grounded). Reference source_id: ${sourceId} `
    + `(${f.entity_name} ${la ? `FY${la.fiscal_year} ` : ''}annual filing, SEC EDGAR, CIK ${f.cik}). `
    + `Ground STEP 1 (Shariah permissibility) in this filer's described business activities / revenue mix, and `
    + `ground STEP 2 (worth-investigating) in these harness-fetched financials ($millions, share-millions):\n`
    + (la
      ? `Latest annual (FY${la.fiscal_year}): net_income ${fmtMusd(la.net_income_musd)}, revenue ${fmtMusd(la.revenue_musd)}, `
        + `D&A ${fmtMusd(la.d_and_a_musd)}, total_capex ${fmtMusd(la.capex_musd)}, diluted_shares ${fmtShares(la.diluted_shares_m)}, `
        + `total_debt ${fmtMusd(la.total_debt_musd)}, cash_and_securities ${fmtMusd(la.cash_and_securities_musd)}.\n`
      : '')
    + `PROPOSED_SOURCES RULE (read carefully): proposed_sources is for REAL fetched URLs ONLY — NEVER put a `
    + `source_id (e.g. ${sourceId}) or an invented URL there. The filing above is already harness-verified, so `
    + `if you did not fetch any ADDITIONAL real URL, return proposed_sources as an empty array [].`
  )
}
