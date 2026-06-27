import { z } from 'zod'
import { ProposedSourceSchema, ProposedSourcesSchema } from './groundedAgent'

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
  // QUICK-SCREEN ONLY: proposed_sources allows EMPTY (no `.min(1)`). On the configured no-tools codex
  // provider the gate's grounding comes from the HARNESS pre-fetch (the verified primary filing is injected
  // and its source_id is folded into qs.verified_ids), so the model does NOT need to propose any source. The
  // shared ProposedSourcesSchema (min 1) forced the model to emit something and — with no citation field on
  // this schema to hold a source_id — it put the harness source_id into proposed_sources[0].url, an invalid
  // URL that rejected the whole structured output (the research_run_failed regression). Empty is now valid;
  // any REAL fetched URLs the model proposes still flow through unchanged. All OTHER stage schemas keep
  // ProposedSourcesSchema (min 1). z.infer of both is ProposedSource[], so the runGroundedAgentWithTools
  // `T extends { proposed_sources: ... }` constraint is still satisfied.
  proposed_sources: z.array(ProposedSourceSchema),
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

// NOTE (runway reframe): the per-row LaneRubricSchema (rubric_scores 0/1/2 + proposed_tier +
// adjustment_evidence) was the input shape for the MOAT (db691ac) and then the RUNWAY (this reframe) lane
// rubrics. Both lanes now emit GROUNDED CITED THESES instead (moat_drivers/runway_drivers), so the per-row
// rubric schema has no remaining lane consumer and was removed. The underlying resolver (resolveRubricTier
// in judgmentAnchor.ts) is likewise dead now and is flagged for a Goal-2 cleanup pass.

// ---------------------------------------------------------------------------
// Per-lane JUDGMENT schemas (spec-correct decomposition — Integration Point #1).
// Each judgment-heavy LANE produces its OWN judgment. B6 reframe: the moat lane emits a GROUNDED CITED
// THESIS (moat_drivers + proposed_moat_class — mirror of the circle gate) PLUS the (still-rubric) runway
// axis; the shariah lane emits the sector_status + impermissible_income overlay as REQUIRED. These are
// small, FOCUSED schemas (the lane's base finding + just its judgment block) so a live model is not asked
// to fill one giant monolithic synthesis schema (the dogfood failure). Each is run under runValidatedAgent
// with its judgment fields as requiredFields — the retry FORCES them; only after 2 fails does the visible
// fallback apply. The harness cite-verifies the moat drivers + re-computes the EDGAR quant corroboration.
// A single cited durable competitive ADVANTAGE: the advantage TEXT (REQUIRED — mirrors the circle's
// CashflowDriverSchema; an empty claim must not clear the bar on its citation alone) + the source_id (or
// content_hash) of a VERIFIED primary source. The harness cite-verifies the citation AND requires
// non-empty text to count the driver grounded (the grounded-thesis moat reframe, B6).
export const MoatDriverSchema = z.object({
  // A specific durable competitive advantage of THIS business (pricing power, switching costs, network
  // effects, brand, cost/scale advantage, etc.). REQUIRED.
  advantage: z.string().min(1),
  // REQUIRED — the source_id (or content_hash) of a VERIFIED primary source backing the advantage (a real
  // grounded id, NOT prose). The harness cite-verifies this against the corpus; ungrounded → not counted.
  citation: z.string().min(1),
})

// A single cited REINVESTMENT-RUNWAY driver: the headroom TEXT (REQUIRED — mirrors MoatDriverSchema; an
// empty claim must not clear the bar on its citation alone) + the source_id (or content_hash) of a
// VERIFIED primary source. The runway reframe (mirror of the moat reframe, db691ac): the model argues the
// durable reinvestment opportunities/headroom (TAM, new markets/segments, reinvestment-at-high-ROIC
// runway), each cited; the harness cite-verifies and requires non-empty text to count the driver grounded.
export const RunwayDriverSchema = z.object({
  // A specific durable reinvestment opportunity / source of headroom for THIS business (TAM under-
  // penetration, new markets/segments, announced capacity, demonstrated reinvestment-at-high-ROIC). REQUIRED.
  headroom: z.string().min(1),
  // REQUIRED — the source_id (or content_hash) of a VERIFIED primary source backing the headroom (a real
  // grounded id, NOT prose). The harness cite-verifies this against the corpus; ungrounded → not counted.
  citation: z.string().min(1),
})

// MOAT lane (B6 reframe): the lane emits a GROUNDED CITED THESIS, mirroring the circle gate — NOT a per-row
// M1-M6 numeric rubric. The model argues the durable competitive advantages (each cited to a verified
// primary source), proposes the moat_class, and gives its reasoning. The QUANT (M1 ROIC + M2 margin) is
// computed by the HARNESS from EDGAR — the model does NOT score it. The harness cite-verifies each driver
// (mirror of the circle), resolves the tier from the grounded thesis, and uses the quant as corroboration.
export const MoatLaneSchema = z.object({
  ...LaneAgentBaseShape,
  // The durable competitive advantages, each with REQUIRED text + a verified-primary-source citation.
  // (Mirror cashflow_drivers.) The harness cite-verifies these; an upward moat class must be GROUNDED here.
  moat_drivers: z.array(MoatDriverSchema).min(1),
  // The model's grounded moat judgment (the tier its cited drivers argue for).
  proposed_moat_class: z.enum(['narrow', 'moderate', 'wide', 'monopoly']),
  // The model's narrative moat reasoning.
  moat_reasoning: z.string().min(1),
  // RUNWAY axis (reframe — mirror of the moat reframe): a GROUNDED CITED THESIS, NOT a per-row R1-R3 rubric.
  // The model argues the durable reinvestment opportunities/headroom (each cited to a verified primary
  // source), proposes the runway, and gives its reasoning. The QUANT (R1 incremental ROIC) is computed by
  // the HARNESS from EDGAR to CORROBORATE; the harness cite-verifies each driver and resolves the tier.
  // The runway lane keeps emitting the holistic `runway` (used as the legacy holistic fallback when the
  // grounded thesis is absent) — its grounded judgment is `proposed_runway` below.
  runway: z.enum(['proven', 'limited', 'none']),
  // Optional: the lane may flag an exceptional runway (with headroom evidence) to allow the top of a
  // growth band. Defaults to false when omitted.
  runway_exceptional: z.boolean().optional(),
  // The durable reinvestment-runway drivers, each with REQUIRED text + a verified-primary-source citation
  // (mirror moat_drivers). The harness cite-verifies these; a proven/limited runway must be GROUNDED here.
  runway_drivers: z.array(RunwayDriverSchema).min(1),
  // The model's grounded runway judgment (the tier its cited drivers argue for).
  proposed_runway: z.enum(['proven', 'limited', 'none']),
  // The model's narrative runway reasoning.
  runway_reasoning: z.string().min(1),
})

export const ShariahLaneSchema = z.object({
  ...LaneAgentBaseShape,
  // The SHARIAH lane's own judgment overlay (REQUIRED on this lane's schema): sector_status +
  // impermissible_income ($M). The harness recomputes the AAOIFI ratios from EDGAR + market cap +
  // this lane-supplied impermissible_income — it does NOT trust the model's own ratio arithmetic.
  sector_status: ShariahJudgmentSchema.shape.sector_status,
  impermissible_income: ShariahJudgmentSchema.shape.impermissible_income,
})

// ---------------------------------------------------------------------------
// CIRCLE-OF-COMPETENCE judgment schema (sequential PRE-deep-dive stage).
//
// The circle of competence is a MODEL JUDGMENT, not a config screen: "do I understand THIS business well
// enough to assess its cashflow predictability?" The model must DEMONSTRATE it, not assert it — it cites
// (from filings) the specific drivers of this business's cashflows AND what would make those cashflows
// UNPREDICTABLE. The harness cite-verifies BOTH clauses against the grounded corpus with the SAME hardened
// primitive the lanes use; if EITHER clause is ungrounded, the model is OUTSIDE its competence (fail-closed).
// Ungrounded competence = outside competence.
// ---------------------------------------------------------------------------

// A single cited cashflow DRIVER: the driver TEXT (REQUIRED — Bug A: text was previously optional, so an
// empty claim cleared the bar on its citation alone) + the source_id (or content_hash) of a VERIFIED
// primary source. The harness cite-verifies the citation AND requires non-empty text to count it grounded.
export const CashflowDriverSchema = z.object({
  // A specific driver of THIS business's cashflows that makes them DURABLE/predictable. REQUIRED.
  driver: z.string().min(1),
  // REQUIRED — the source_id (or content_hash) of a VERIFIED primary source backing the claim (a real
  // grounded id, NOT prose). The harness cite-verifies this against the corpus; ungrounded → fail-closed.
  citation: z.string().min(1),
})

// A single cited PREDICTABILITY BREAKER: what would make those cashflows UNPREDICTABLE. THE DEEPER TEST —
// held to the SAME rigor as the drivers; the breaker TEXT is REQUIRED (Bug A) and the citation cite-verified.
export const PredictabilityBreakerSchema = z.object({
  // A specific thing that would make THIS business's cashflows UNPREDICTABLE. REQUIRED.
  breaker: z.string().min(1),
  // REQUIRED — same cite-verify rigor as the drivers; ungrounded → fail-closed.
  citation: z.string().min(1),
})

export const CircleCompetenceSchema = z.object({
  // The specific drivers of THIS business's cashflows, each with REQUIRED text + a filing citation.
  cashflow_drivers: z.array(CashflowDriverSchema).min(1),
  // What would make those cashflows UNPREDICTABLE, each with REQUIRED text + a cited filing source. THE
  // DEEPER TEST — held to the SAME cite-verify rigor as the drivers; not ungrounded prose.
  predictability_breakers: z.array(PredictabilityBreakerSchema).min(1),
  // The model's narrative judgment.
  competence_reasoning: z.string().min(1),
  // Bug B fix: the question is NOT "do I understand this business" — it is "are THIS business's cashflows
  // DURABLY PREDICTABLE enough to value with confidence?". A well-understood but cyclical/commodity-driven
  // business is `not_predictable` → OUTSIDE the circle (set aside), a valid+common+correct Buffett answer.
  // The gate proceeds ONLY when this is `durably_predictable` AND both clauses ground (non-empty text +
  // verified citation); `not_predictable` OR `uncertain` OR ungrounded → set aside.
  cashflow_predictability: z.enum(['durably_predictable', 'not_predictable', 'uncertain']),
  proposed_sources: ProposedSourcesSchema,
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
  // MARGIN-OF-SAFETY AUDIT SURFACE — forward-looking model risk judgments (NOT current-fact claims, so
  // deliberately NOT cite-gated; required + substantive is the guard). key_wrong_assumption: the SINGLE
  // assumption that, if wrong, breaks the thesis (name a concrete assumption actually made — the assumed
  // growth rate, the moat-durability claim, the maintenance-capex judgment — not boilerplate).
  key_wrong_assumption: z.string().min(1),
  // thesis_break_triggers: the observable events that would invalidate the thesis (concrete + tied to THIS
  // business — "gross margin falls below X%", "top-2 customer concentration rises" — not "if growth slows").
  thesis_break_triggers: z.array(z.string().min(1)).min(1),
  // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — the margin of safety comes from TWO SUBSTITUTABLE
  // sources: the PRICE-vs-value gap and MOAT durability ("a fortress moat lets time bail out errors, so it
  // needs less price discount"). Synthesis OWNS this as a single joint judgment, naming which source(s) the
  // margin rests on, the per-source reasoning, and a REASONED adequacy + reasoning. GUARD: adequacy is an
  // audit judgment DISPLAYED for the human — it is NEVER a gate (the retired MoS-as-haircut stays dead). A
  // moat-sourced margin must rest on the GROUNDED moat-gate thesis (the harness flags a moat source claimed
  // on an ungrounded moat). Cite-checked? No — like key_wrong_assumption it is forward-looking reasoning;
  // required + substantive (the schema + synthesisRequiredFields retry + the prompt specificity are the guard).
  margin_of_safety: z.object({
    // Which substitutable source(s) the margin rests on. 'price' = the price-vs-value gap; 'moat' = moat
    // durability bailing out time/error. At least one; both is valid (a discounted price AND a fortress moat).
    sources: z.array(z.enum(['price', 'moat'])).min(1),
    // Required-in-prompt when 'price' is a source: WHY the price-vs-value gap supplies adequate margin.
    price_gap_reasoning: z.string().optional(),
    // Required-in-prompt when 'moat' is a source: WHY moat durability supplies margin — anchored on the
    // GROUNDED moat thesis the moat gate verified, NOT a fresh claim.
    moat_durability_reasoning: z.string().optional(),
    // A REASONED JUDGMENT of whether the joint margin is adequate. Audit-only — NEVER gates the verdict.
    adequacy: z.enum(['adequate', 'thin', 'inadequate']),
    // The joint reasoning tying the named source(s) together into the adequacy judgment.
    reasoning: z.string().min(1),
  }),
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
    // GROUNDING (founding-risk fix): the source_id (or content_hash) of a VERIFIED primary source from the
    // model's own proposed_sources / the corpus that backs the owner-earnings figure — a real grounded
    // source_id, NOT a prose hand-wave. The harness fail-closes the synthesis verdict when this does not
    // verify against the post-synthesis corpus (deterministic grounding; relevance stays the human's audit).
    owner_earnings_citation: z.string().min(1),
    // The near-term growth the model assumed in its valuation (a fraction, e.g. 0.08).
    assumed_growth: z.number(),
    // Cited: WHY that growth is defensible (the durable-source argument the model is accountable for).
    assumed_growth_rationale: z.string().min(1),
    // GROUNDING (founding-risk fix): the source_id (or content_hash) of a VERIFIED primary source backing
    // the assumed-growth rationale — a real grounded source_id, NOT a prose hand-wave. Cite-checked exactly
    // like owner_earnings_citation; an absent/unverifiable citation fail-closes the synthesis verdict.
    assumed_growth_citation: z.string().min(1),
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

// MOAT-lane judgment instructions (B6 reframe — the moat is the model's GROUNDED CITED THESIS, mirroring
// the circle gate, NOT a per-row numeric rubric). The lane argues the durable competitive advantages, each
// cited to a verified primary source; proposes the moat_class; and states the quant (ROIC/margins) will
// corroborate. The harness cite-verifies each driver, resolves the tier from the grounded thesis, and uses
// the EDGAR quant (M1/M2) only as corroboration. The RUNWAY axis is now ALSO a grounded cited thesis
// (runway_drivers + proposed_runway) — same reframe; the harness cite-verifies the runway_drivers and uses
// the EDGAR incremental-ROIC quant (R1) only as corroboration (never substitutes/overrides).
export const MOAT_RUBRIC_PROMPT =
  ` As the MOAT lane you ALSO produce the durable-moat judgment for this case — as a GROUNDED CITED THESIS, `
  + `the SAME discipline as the circle-of-competence gate: argue it, do not assert it. `
  + `Emit moat_drivers: the SPECIFIC durable competitive advantages of THIS business — pricing power, switching `
  + `costs, network effects, brand, cost/scale advantage, regulatory/IP barriers — EACH with concrete TEXT (the `
  + `advantage) AND a citation (the source_id of a VERIFIED primary source backing it). Then set `
  + `proposed_moat_class ('narrow' | 'moderate' | 'wide' | 'monopoly') — your grounded judgment of the moat width — `
  + `and moat_reasoning (your narrative). The quant (ROIC durability + margin stability) will be computed by the `
  + `harness from the EDGAR filings to CORROBORATE your thesis; do NOT score it yourself. `
  + `GROUNDING IS THE BAR (mirror the circle): the harness cite-verifies each moat_driver against the corpus and `
  + `counts ONLY drivers with non-empty advantage text AND a citation that verifies. A wide/monopoly class is `
  + `honored ONLY when enough drivers GROUND (≈2 grounded distinct advantages for wide, ≈3 for monopoly); an `
  + `ungrounded wide/monopoly claim FAILS CLOSED to narrow. STEER: for filing-backed claims, cite the named `
  + `harness-verified source_ids (e.g. sec_edgar_10k_<cik>_fy<year>) listed in the pre-verified sources; do NOT `
  + `fetch or cite your OWN SEC archive URL for the primary 10-K (it fetches unreliably and will FAIL the `
  + `cite-check). outside/narrow is a valid, common answer — do NOT over-claim a moat you cannot ground. `
  + `ALSO produce the REINVESTMENT-RUNWAY judgment — a SEPARATE axis from moat width — as a GROUNDED CITED `
  + `THESIS, the SAME discipline (argue it, do not assert it). The runway is the DURABLE REINVESTMENT `
  + `OPPORTUNITY: can this business deploy incremental capital at high ROIC for years with visible remaining `
  + `headroom? Emit runway_drivers: the SPECIFIC sources of that headroom for THIS business — TAM under- `
  + `penetration, new markets/segments, announced capacity, demonstrated reinvestment-at-high-ROIC runway — `
  + `EACH with concrete TEXT (the headroom) AND a citation (the source_id of a VERIFIED primary source). Then `
  + `set proposed_runway ('proven' | 'limited' | 'none' — your grounded judgment; proven means ≥5 yrs of `
  + `incremental capital deployed at high ROIC WITH visible remaining headroom) and runway_reasoning (your `
  + `narrative). The quant (computed incremental-ROIC headroom) will be computed by the harness from the EDGAR `
  + `filings to CORROBORATE your thesis; do NOT score it yourself. GROUNDING IS THE BAR (mirror the moat): the `
  + `harness cite-verifies each runway_driver and counts ONLY drivers with non-empty headroom text AND a `
  + `citation that verifies; a proven runway is honored ONLY when enough drivers GROUND (≈2 grounded distinct `
  + `headroom drivers for proven, ≈1 for limited). STEER: for filing-backed claims, cite the named harness- `
  + `verified source_ids (e.g. sec_edgar_10k_<cik>_fy<year>) listed in the pre-verified sources; do NOT fetch `
  + `or cite your OWN SEC archive URL for the primary 10-K (it fetches unreliably and will FAIL the cite-check). `
  + `limited/none is a valid, common answer — do NOT over-claim a runway you cannot ground. Set the holistic `
  + `runway field to the same grounded judgment, and runway_exceptional only with explicit headroom evidence. `
  + `EXAMPLE moat_drivers (shape only): [{"advantage":"concentrate price increases stick with no volume loss","citation":"sec_edgar_10k_<cik>_fy<year>"},{"advantage":"global brand + bottler distribution scale advantage","citation":"<verified-source_id>"}]. `
  + `EXAMPLE runway_drivers (shape only): [{"headroom":"emerging-market per-capita consumption under 1/4 of developed markets — decades of volume runway","citation":"sec_edgar_10k_<cik>_fy<year>"},{"headroom":"announced bottling-capacity expansion deploys capital at >20% incremental ROIC","citation":"<verified-source_id>"}].`

// VALUATION-lane discount-ownership note (F.2 conformance). The harness OWNS the discount + the
// intrinsic-value computation deterministically; the valuation lane must reason about VALUE, not free-lance
// a textbook DCF with its own required return / cost of capital / government-bond anchor (the model's
// training prior), which would contradict the system's config-driven uniform discount. Appended ONLY to the
// valuation lane's prompt (NOT the other generic lanes). PHRASING NOTE (consistency tripwire): the discount
// prohibitions in the constant below are NEGATIONS ("do NOT …"), deliberately phrased so they do NOT match the
// superseded-discount patterns in supersededTermConsistency.test.ts — no allow-list entry is needed, and those
// patterns still catch any NEW as-current discount methodology that slips into a lane prompt.
export const VALUATION_LANE_DISCOUNT_NOTE =
  ` DISCOUNT OWNERSHIP (read carefully — THE HARNESS OWNS THE DISCOUNT, not you): the harness discounts `
  + `owner earnings deterministically at a single config-driven UNIFORM rate (the compliant SAVINGS rate `
  + `plus a fixed equity premium, ≈7.5% by default, the SAME for every business). The risk-free anchor is `
  + `the compliant SAVINGS rate the owner can actually hold — it is explicitly NOT the interest-bearing `
  + `10-year Treasury, which a compliant investor cannot hold, so do NOT anchor your reasoning to the `
  + `10-year Treasury or any government-bond yield. Therefore you MUST NOT specify, assume, or assert your `
  + `own required return, discount rate, cost of capital, WACC, or hurdle (do NOT, for example, assert a `
  + `9-10% required return) and you MUST NOT present a textbook DCF or an intrinsic-value range computed off `
  + `a self-chosen rate — that math is the harness's job and your numbers would contradict the system's `
  + `deterministic discount. INSTEAD, reason about VALUE: the owner-earnings BASIS (normalized owner `
  + `earnings, the maintenance-capex and one-off adjustments behind it), the DURABILITY and defensibility of `
  + `growth, and a QUALITATIVE cheap / fair / expensive read versus today's price. Leave the discount rate `
  + `and the intrinsic-value / DCF computation entirely to the harness.`

// SHARIAH-lane judgment overlay instructions (moved here from the synthesis prompt). The lane supplies
// the JUDGMENT only; the harness recomputes the AAOIFI ratios + verdict + purification % from filings.
export const SHARIAH_OVERLAY_PROMPT =
  ` As the SHARIAH lane you ALSO produce the judgment overlay — REQUIRED, do not omit (omitting it leaves the AAOIFI ratios unverified and flags shariah_ratios_unverified): `
  + `sector_status ('compliant' | 'conditional' | 'non_compliant') confirmed with segment revenue, and impermissible_income — the dollar amount in $MILLIONS of non-permissible income (interest income on cash, prohibited-segment revenue), 0 if fully permissible. `
  + `The harness recomputes the AAOIFI debt/cash/impermissible ratios + verdict + purification % from the primary filings + market cap; do NOT compute the ratios yourself. `
  + `EXAMPLE (shape only): {"sector_status":"compliant","impermissible_income":128.0}.`

// CIRCLE-OF-COMPETENCE judgment prompt (the sequential pre-deep-dive gate). The model must DEMONSTRATE
// understanding, not assert it — and grounding BOTH clauses is the bar. Ungrounded = outside competence.
export const CIRCLE_COMPETENCE_PROMPT =
  `You are the Buffett-Munger CIRCLE-OF-COMPETENCE gate. The question is NOT "do I understand this `
  + `business?" — it is "are THIS business's cashflows DURABLY PREDICTABLE enough to value with confidence?". `
  + `These are DIFFERENT: understanding the business is NOT the same as competence to value it. A business you `
  + `understand well but whose cashflows are CYCLICAL, COMMODITY-DRIVEN, or otherwise UNPREDICTABLE (think a `
  + `well-understood memory-chip maker whose earnings swing with a commodity price cycle) is NOT durably `
  + `predictable — that is OUTSIDE the circle (set aside), and it is a VALID, COMMON, CORRECT Buffett answer. `
  + `You must DEMONSTRATE your judgment, not assert it: cite (from primary filings) the specific DRIVERS that `
  + `make this business's cashflows DURABLE/predictable (cashflow_drivers — each with concrete TEXT describing `
  + `the driver AND a citation: the source_id of a VERIFIED primary source you fetched) AND what would make `
  + `those cashflows UNPREDICTABLE (predictability_breakers — each ALSO with concrete TEXT + a cited verified `
  + `primary source; this clause is held to the SAME rigor as the drivers — do NOT hand-wave it as prose, and `
  + `do NOT omit the text). Then set cashflow_predictability: 'durably_predictable' ONLY if the drivers `
  + `genuinely support durable predictability AND the breakers are not dominant; otherwise 'not_predictable' `
  + `(you understand it but the cashflows are not durably predictable) or 'uncertain'. If you cannot GROUND `
  + `BOTH clauses, you are OUTSIDE the circle (the harness fails closed). Do NOT rationalize predictability you `
  + `cannot demonstrate. Gather your own primary sources and return them in proposed_sources with real URLs; `
  + `cite real grounded source_ids in every citation field. Also give competence_reasoning (your narrative).`

// Lanes that receive the primary-filing data injection (they consume hard financials). The MOAT lane is
// included (B6 reframe) so the harness-verified resolver 10-K source_id is force-added to the moat lane's
// verified set + tool-loop captured corpus — making the resolver id CITABLE by the grounded moat thesis
// even though the model did not fetch it (the circle gate grounds by citing it; the moat must be able to
// too). The grounded RUNWAY thesis (runway_drivers) is emitted by the SAME moat lane (runway reframe), so
// the resolver id is already citable by the runway drivers — no separate `runway` lane exists. Note: the
// moat lane does NOT get the full primary-filing NUMBERS block (that stays on the financial lanes), so
// neither the moat nor the runway thesis gets the numbers block — only the citable id; injectFiling only
// governs the withFiling verified-id force-add for the moat lane (see researchSwarm.ts).
export const PRIMARY_FILING_LANES: ReadonlySet<string> = new Set(['financial_quality', 'valuation', 'shariah', 'moat'])
