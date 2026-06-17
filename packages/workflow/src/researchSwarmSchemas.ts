import { z } from 'zod'
import { ProposedSourcesSchema } from './groundedAgent'

// ---------------------------------------------------------------------------
// Per-stage Zod schemas (each includes proposed_sources for grounding)
// ---------------------------------------------------------------------------

export const QuickScreenAgentSchema = z.object({
  summary: z.string().min(1),
  business_quality: z.string().min(1),
  moat: z.string().min(1),
  management_capital_allocation: z.string().min(1),
  financial_quality: z.string().min(1),
  valuation_sanity: z.string().min(1),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'PENDING']),
  red_flags: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  screening_result: z.enum(['pass', 'reject', 'needs_data', 'deep_dive_candidate']),
  proposed_sources: ProposedSourcesSchema,
})

export const LaneAgentSchema = z.object({
  finding_summary: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

const LaneAgentBaseShape = {
  finding_summary: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
}

export const OwnerEarningsBridgeSchema = z.object({
  // Company TOTALS in $MILLIONS, judgment-grounded by the valuation specialist from the latest 10-K.
  // These are aggregate amounts, NOT per-share — the harness divides total owner earnings by
  // shares_outstanding to get owner earnings per share.
  net_income: z.number(),
  depreciation_amortization: z.number(),
  maintenance_capex: z.number(),
  maintenance_capex_proxy_tier: z.enum(['20', '50', '80']),
  stock_based_comp: z.number(),
  // SIGNED: positive = WC is a use of cash (reduces OE); negative = structural WC release (adds to OE)
  normalized_working_capital_change: z.number(),
  // Diluted weighted-average shares outstanding, in MILLIONS, from the latest 10-K — same scale as
  // the $-millions amounts above. Required to convert total owner earnings to a per-share figure.
  shares_outstanding: z.number(),
})

// SHARIAH lane JUDGMENT overlay (the LLM identifies; the harness recomputes the financial ratios).
// sector_status confirms the Stage-0 finding with segment data; impermissible_income is the dollar
// amount ($MILLIONS) of non-permissible income (interest income, prohibited-segment revenue). The
// harness divides this by EDGAR revenue — it does NOT trust the model's own ratio arithmetic.
const ShariahJudgmentSchema = z.object({
  sector_status: z.enum(['compliant', 'conditional', 'non_compliant']),
  // Impermissible income in $MILLIONS (same scale as EDGAR revenue). 0 when fully permissible.
  impermissible_income: z.number().min(0),
})

// judgment-objectivity-layer-spec Mechanisms 1+2: the lane scores each rubric item (0/1/2) with a
// citation_hash for the cited rows, proposes a tier, and supplies cited adjustment evidence. The HARNESS
// re-verifies the computable rows, computes the mechanical anchor, and resolves the final tier under the
// +-1 bound + citation rules — the lane's claims here are inputs, not the authority.
const RubricScoreSchema = z.object({
  id: z.string().min(1),
  score: z.number().int().min(0).max(2),
  // Required for CITED rows (verified against the fetched corpus); omitted for computable rows.
  citation_hash: z.string().min(1).optional(),
})
const AdjustmentEvidenceSchema = z.object({
  claim: z.string().min(1),
  citation_hash: z.string().min(1),
})
const LaneRubricSchema = z.object({
  rubric_scores: z.array(RubricScoreSchema).min(1),
  // The lane's proposed tier (its judgment adjustment from the mechanical anchor). The harness bounds it.
  proposed_tier: z.string().min(1),
  // Cited evidence the quantitative score cannot see (patent cliff, announced entrant, etc.).
  adjustment_evidence: z.array(AdjustmentEvidenceSchema).default([]),
})

// ---------------------------------------------------------------------------
// Per-lane JUDGMENT schemas (spec-correct decomposition — Integration Point #1).
// The judgment-objectivity spec says each judgment-heavy LANE scores its OWN rubric. The moat lane
// therefore emits moat_rubric + runway_rubric as REQUIRED fields (Mechanisms 1+2); the shariah lane
// emits the sector_status + impermissible_income overlay as REQUIRED. These are small, FOCUSED schemas
// (the lane's base finding + just its judgment block) so a live model is not asked to fill one giant
// monolithic synthesis schema (the dogfood failure). Each is run under runValidatedAgent with its
// judgment fields as requiredFields — the retry FORCES them; only after 2 fails does the visible
// holistic/unverified fallback apply. The harness still re-verifies the computable rows + citations.
export const MoatLaneSchema = z.object({
  ...LaneAgentBaseShape,
  // The MOAT lane's own rubric judgment (REQUIRED on this lane's schema). It also classifies the
  // holistic moat_class + runway as a fallback the harness uses ONLY when the rubric resolves to a
  // non-downstream tier.
  moat_class: z.enum(['narrow', 'moderate', 'wide', 'monopoly']),
  runway: z.enum(['proven', 'limited', 'none']),
  // Optional: the lane may flag an exceptional runway (with headroom evidence) to allow the top of a
  // growth band. Defaults to false when omitted.
  runway_exceptional: z.boolean().optional(),
  moat_rubric: LaneRubricSchema,
  runway_rubric: LaneRubricSchema,
})

export const ShariahLaneSchema = z.object({
  ...LaneAgentBaseShape,
  // The SHARIAH lane's own judgment overlay (REQUIRED on this lane's schema): sector_status +
  // impermissible_income ($M). The harness recomputes the AAOIFI ratios from EDGAR + market cap +
  // this lane-supplied impermissible_income — it does NOT trust the model's own ratio arithmetic.
  sector_status: ShariahJudgmentSchema.shape.sector_status,
  impermissible_income: ShariahJudgmentSchema.shape.impermissible_income,
})

export const DecisionAgentSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  // NOTE (spec-correct decomposition): the moat_class / runway / runway_exceptional / moat_rubric /
  // runway_rubric judgment fields now live on the MOAT lane's schema (MoatLaneSchema), and the Shariah
  // sector_status + impermissible_income overlay lives on the SHARIAH lane's schema (ShariahLaneSchema).
  // The judgment-objectivity spec assigns rubric scoring to the producing LANE — so the synthesis schema
  // no longer carries them (the dogfood failure: a live model omitted them from this monolithic schema).
  // The harness reads moat_class/runway/rubrics from the moat lane output and the Shariah overlay from
  // the shariah lane output; synthesis keeps only synthesis_response (its red-team obligation).
  growth_assumptions: z.string().min(1),
  // Owner-earnings bridge — totals in $millions, judgment-grounded
  owner_earnings_bridge: OwnerEarningsBridgeSchema,
  // ROIC inputs. `roic` is reported context; `incremental_roic` (normalized INCREMENTAL ROIC, a
  // fraction, e.g. 0.20) is context the deterministic side records (no longer drives a band verdict).
  roic: z.number(),
  incremental_roic: z.number(),
  reinvestment_rate: z.number(),
  // RELIGHTENED DECISION (R1): the MODEL proposes the price below which it would buy, WITH its cited
  // reasoning. This is the buy-below the harness records — NOT a number derived from any fair value.
  // The deterministic side only sanity-checks it (flag-only, never blocks) + computes the arithmetic
  // price-vs-buy-below comparison. Required in the schema, but a degraded/absent payload is tolerated by
  // the harness (it falls back to INSUFFICIENT_DATA / RESEARCH_MORE rather than fabricating a number).
  proposed_buy_below: z.number(),
  // The model's CITED valuation reasoning (it shows its work). Replaces the retired band_economics block:
  // the model OWNS the valuation judgment, so it states the owner-earnings basis it valued, the growth it
  // assumed, WHY that growth is defensible (cited), and optionally the discount rationale. The harness uses
  // assumed_growth + the owner-earnings basis ONLY to compute a reference cross-check fair value (a flag-
  // only sanity-check), never to drive the verdict or the buy-below. Optional so a degraded payload still
  // flows through (the sanity-check then simply has less to cross-check).
  valuation_reasoning: z.object({
    // Cited: the owner-earnings basis the model valued (e.g. "FY25 owner earnings $8.4B per the 10-K").
    owner_earnings_basis: z.string().min(1),
    // The near-term growth the model assumed in its valuation (a fraction, e.g. 0.08).
    assumed_growth: z.number(),
    // Cited: WHY that growth is defensible (the durable-source argument the model is accountable for).
    assumed_growth_rationale: z.string().min(1),
    // OPTIONAL: the model's discount-rate reasoning, if it argues one.
    discount_rationale: z.string().optional(),
  }).optional(),
  // judgment-objectivity-layer-spec Mechanism 5 — Red-Team Pass obligation. The synthesis_response that
  // answers the red team's strongest objection is NO LONGER produced here: a live model kept dropping it
  // from this monolithic schema (synthesis_schema_retry_exhausted: [synthesis_response]). Following the
  // SAME decomposition that got the moat rubric emitting live, it now comes from a dedicated FOCUSED
  // grounded call (runRedTeamResponsePass) that runs ONLY when a live cite-checked objection exists. The
  // harness still deterministically flags red_team_objection_unaddressed when that focused call yields no
  // usable response — silence is not an option. (red_team_strongest_objection stays as a harmless OPTIONAL
  // echo the synthesis may set; it carries no obligation now.)
  red_team_strongest_objection: z.string().optional(),
  proposed_sources: ProposedSourcesSchema,
})

// A focused classification-only agent for the cross-check: a SECOND model re-classifies the single
// high-stakes dimension from the lane digest + grounded corpus. It is deliberately narrow (one enum,
// one cited source) so the doubled cost is minimal — "don't extend everywhere".
export const MoatCrossCheckSchema = z.object({
  moat_class: z.enum(['narrow', 'moderate', 'wide', 'monopoly']),
  proposed_sources: ProposedSourcesSchema,
})
export const ShariahCrossCheckSchema = z.object({
  sector_status: z.enum(['compliant', 'conditional', 'non_compliant']),
  proposed_sources: ProposedSourcesSchema,
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Per-agent (per-lane) call timeout. Default 300s (5 min) — a GENEROUS BACKSTOP, not the anti-stuck
// mechanism. Real codex calls run ~60s; the timeout must be generous enough never to sever legitimate
// analysis. The real anti-stuck protection is the process-group HARD-KILL of a hung codex (already
// fixed), the single retry, and the run WATCHDOG that fails-closes abandoned runs — NOT a short timeout.
// (A previous 180s default risked cutting off a slow-but-legitimate call; the hard-kill already bounds a
// truly-hung process regardless of this value.) Override with OWLFOLIO_AGENT_TIMEOUT_MS (read at module
// load — set when LAUNCHING, not at runtime). Single source of truth; redTeamPass/admitJudgment import it.
export const DEFAULT_AGENT_TIMEOUT_MS = 300_000

/**
 * Resolve the per-agent call timeout from an OWLFOLIO_AGENT_TIMEOUT_MS-style raw value.
 * A valid positive integer wins; anything invalid (unset, empty, zero, negative, non-numeric)
 * falls back to DEFAULT_AGENT_TIMEOUT_MS. The resolved value flows through to each codex exec
 * subprocess kill timer via the per-request timeout_ms the swarm passes to the provider.
 */
export function resolveAgentTimeoutMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_TIMEOUT_MS
}

export const AGENT_TIMEOUT_MS = resolveAgentTimeoutMs(process.env['OWLFOLIO_AGENT_TIMEOUT_MS'])

// MOAT-lane judgment instructions (moved here from the synthesis prompt — spec-correct: the LANE scores
// its own rubric). The moat lane emits moat_rubric + runway_rubric (Mechanisms 1+2) AND a holistic
// moat_class/runway the harness uses only as a fallback when the rubric resolves to a non-downstream tier.
export const MOAT_RUBRIC_PROMPT =
  ` As the MOAT lane you ALSO produce the judgment classification + rubrics for this case. `
  + `Classify the durable competitive moat_class ('narrow' | 'moderate' | 'wide' | 'monopoly') and the `
  + `reinvestment runway ('proven' | 'limited' | 'none' — a SEPARATE axis from moat width; proven means `
  + `≥5 yrs of incremental capital deployed at high ROIC with visible remaining headroom). Set `
  + `runway_exceptional only with explicit headroom evidence. `
  + `JUDGMENT RUBRICS — REQUIRED, do not omit (omitting them forces the harness to degrade to a holistic tier and flag the dossier as rubric_not_emitted): emit BOTH moat_rubric and runway_rubric. `
  + `Score the MOAT rubric (M1 ROIC>15% in ≥9/10yr [computable], M2 gross-margin band [computable], M3 price increases without share loss, M4 share vs entrant, M5 customer switching, M6 competitor exits) `
  + `and the RUNWAY rubric (R1 incremental capital at high ROIC [computable], R2 visible headroom, R3 demonstrated reinvestment rate). `
  + `For EACH item give a score 0/1/2; CITED rows (M3–M6, R2, R3) MUST carry a citation_hash that matches a fetched primary source (the harness scores 0 for any uncited cited row and re-computes M1/M2/R1 from filings itself). `
  + `Then give proposed_tier (moat: narrow|moderate|wide|monopoly; runway: none|limited|proven) and adjustment_evidence — cited claims the quantitative score cannot see (patent cliff, announced entrant, technology substitution). `
  + `The harness anchors the tier in the computable rows and accepts your proposed_tier ONLY as a bounded ±1-tier adjustment with verified cited evidence; an UPWARD adjustment needs 2× the cited evidence items of a downward one. `
  + `EXAMPLE moat_rubric (shape only): {"rubric_scores":[{"id":"M1","score":2},{"id":"M2","score":2},{"id":"M3","score":2,"citation_hash":"<hash-of-a-fetched-source>"},{"id":"M4","score":1,"citation_hash":"<hash>"},{"id":"M5","score":2,"citation_hash":"<hash>"},{"id":"M6","score":1,"citation_hash":"<hash>"}],"proposed_tier":"wide","adjustment_evidence":[{"claim":"insurer contracts repriced upward with no share loss","citation_hash":"<hash>"}]}.`

// SHARIAH-lane judgment overlay instructions (moved here from the synthesis prompt). The lane supplies
// the JUDGMENT only; the harness recomputes the AAOIFI ratios + verdict + purification % from filings.
export const SHARIAH_OVERLAY_PROMPT =
  ` As the SHARIAH lane you ALSO produce the judgment overlay — REQUIRED, do not omit (omitting it leaves the AAOIFI ratios unverified and flags shariah_ratios_unverified): `
  + `sector_status ('compliant' | 'conditional' | 'non_compliant') confirmed with segment revenue, and impermissible_income — the dollar amount in $MILLIONS of non-permissible income (interest income on cash, prohibited-segment revenue), 0 if fully permissible. `
  + `The harness recomputes the AAOIFI debt/cash/impermissible ratios + verdict + purification % from the primary filings + market cap; do NOT compute the ratios yourself. `
  + `EXAMPLE (shape only): {"sector_status":"compliant","impermissible_income":128.0}.`

// Lanes that receive the primary-filing data injection (they consume hard financials).
export const PRIMARY_FILING_LANES: ReadonlySet<string> = new Set(['financial_quality', 'valuation', 'shariah'])
