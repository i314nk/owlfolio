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

// finding_summary is NOT placeholder-guarded at the schema level ON PURPOSE. A refine that rejected a
// bare placeholder ("...") failed the WHOLE structured output, which discarded the lane's already-grounded
// sources → the lane fell to verified_ids:0 → skipped, so a lane vanished whenever the model returned a
// lazy "...". The placeholder case is handled at DISPLAY time instead (isPlaceholderLaneSummary in
// ResearchCasePanel renders it as an honest "incomplete" slot with its sources), so the lane stays present.
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


// NOTE (runway reframe): the per-row LaneRubricSchema (rubric_scores 0/1/2 + proposed_tier +
// adjustment_evidence) was the input shape for the MOAT (db691ac) and then the RUNWAY (this reframe) lane
// rubrics. Both lanes now emit GROUNDED CITED THESES instead (moat_drivers/runway_drivers), so the per-row
// rubric schema has no remaining lane consumer and was removed. The underlying resolver (resolveRubricTier
// in judgmentAnchor.ts) is likewise dead now and is flagged for a Goal-2 cleanup pass.

// ---------------------------------------------------------------------------
// Per-lane JUDGMENT schemas (spec-correct decomposition — Integration Point #1).
// Each judgment-heavy LANE produces its OWN judgment. B6 reframe: the moat lane emits a GROUNDED CITED
// THESIS (moat_drivers + proposed_moat_class — mirror of the circle gate) PLUS the (still-rubric) runway
// axis; the sector_status + impermissible_income overlay is now produced by the focused
// Shariah-reasoning pass (shariahReasoningPass), not a parallel lane. These are
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
  // S3 (owner taxonomy): WHICH kind of moat this advantage is. `monopoly_position` = a granted/structural
  // monopoly (regulatory/patent/utility) — deliberately NOT the width-class value 'monopoly' (distinct
  // axes). Optional at the schema level (legacy tolerance); the prompt demands it and the retry forces it.
  moat_type: z.enum([
    'brand', 'switching_costs', 'network_effect', 'intangible_assets', 'toll_bridge',
    'cost_advantage', 'scale_advantage', 'barrier_to_entry', 'monopoly_position',
  ]).optional(),
})

// A single cited moat-DIRECTION driver (S3): the observable evidence behind widening/stable/narrowing.
// Same cite-verify rigor as moat_drivers; an ungrounded direction claim resolves 'undetermined' and
// carries NO policy teeth (the narrowing→WATCH clamp fires only on a GROUNDED narrowing).
export const MoatDirectionDriverSchema = z.object({
  evidence: z.string().min(1),
  citation: z.string().min(1),
})

// The peer-standout judgment (S3, the owner's standout test): named industry peers + their gross
// margins. A peer figure is honored as GROUNDED only when its citation verifies against the corpus;
// an uncited/unverified peer is stamped model_asserted and labeled on the dossier. The company-side
// gross-margin series is computed T0 by the harness (moatTests) — the model judges only the comparison.
export const PeerStandoutSchema = z.object({
  peers: z.array(z.object({
    name: z.string().min(1),
    // e.g. "~38% FY2024 gross margin" — the peer's figure with its period.
    gross_margin_note: z.string().min(1),
    // OPTIONAL: cite ONLY a corpus-verifiable source; omit when asserting from knowledge (labeled).
    citation: z.string().optional(),
  })).min(1),
  judgment: z.enum(['stands_out', 'in_line', 'lags', 'cannot_assess']),
  reasoning: z.string().min(1),
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
  // ---- S3 (Phase 3 pillars): direction + peer standout. Optional at the schema level (legacy
  // tolerance + degrade-not-destroy); the prompt demands them and the requiredFields retry forces them.
  // Moat DIRECTION: "a narrowing moat is a sell signal no matter how wide it still looks." Resolves
  // ONLY when >=1 direction_driver grounds; a grounded narrowing derates a BUY to WATCH downstream.
  moat_direction: z.enum(['widening', 'stable', 'narrowing']).optional(),
  direction_drivers: z.array(MoatDirectionDriverSchema).optional(),
  direction_reasoning: z.string().optional(),
  // The owner's STANDOUT test (peer half): gross margin vs the industry pack, cited-or-labeled.
  peer_standout: PeerStandoutSchema.optional(),
})

// ---------------------------------------------------------------------------------------------------
// UNDERSTAND lane (B3, Phase 4 book alignment): the ONE-PAGER — the book's distillation of Pillar 1.
// "Now that you've broken down what the company is and how it makes its money, distill that
// understanding into something simple and actionable." Seven required items (the book's bare
// minimum). The one-pager is a JUDGMENT DISTILLATION riding a grounded lane — the lane's verified
// sources ground it collectively (per-item citations would turn a one-pager into a bibliography);
// the harness never re-derives it. Optional at the schema level (degrade-not-destroy) and
// retry-FORCED via requiredFields, exactly like the moat/management judgment blocks.
// ---------------------------------------------------------------------------------------------------
export const OnePagerSchema = z.object({
  /** 1. What the company does, in plain English — ONE sentence. */
  plain_english: z.string().min(1),
  /** 2. The company's major divisions/segments. */
  segments: z.array(z.string().min(1)).min(1),
  /** 3. The main revenue drivers (how it makes money). */
  revenue_drivers: z.array(z.string().min(1)).min(1),
  /** 4. Where the real profits come from. */
  most_profitable_segments: z.array(z.string().min(1)).min(1),
  /** 5. Key strengths / potential competitive advantages. */
  strengths: z.array(z.string().min(1)).min(1),
  /** 6. Key risks or weak spots — what could go wrong. */
  weak_spots: z.array(z.string().min(1)).min(1),
  /** 7. Growth levers — what will increase profits and expand the business. */
  growth_levers: z.array(z.string().min(1)).min(1),
})

export const UnderstandLaneSchema = z.object({
  ...LaneAgentBaseShape,
  one_pager: OnePagerSchema.optional(),
})

export const UNDERSTAND_PILLAR_PROMPT =
  ` As the UNDERSTAND lane you ALSO distill the business into the ONE-PAGER — a simple, actionable `
  + `summary of the essence of the business, from the grounded filings (the 10-K first). Emit one_pager `
  + `with EXACTLY these seven items: plain_english (what the company does, ONE sentence, no jargon); `
  + `segments (the major divisions); revenue_drivers (bullet points on how it actually makes money); `
  + `most_profitable_segments (where the real profits come from — not just the biggest revenue); `
  + `strengths (what makes the business hard to compete with); weak_spots (what could go wrong); `
  + `growth_levers (what will increase profits and expand the business). Every item must be SPECIFIC to `
  + `THIS business — a one-pager that could describe any company is worthless. Keep it distilled: this `
  + `is the page you would hand someone who has never heard of the company.`

// ---------------------------------------------------------------------------------------------------
// MANAGEMENT lane (S5, Phase 3 pillars): the pillar's two core traits (owner-locked 2026-07-11) —
// INTEGRITY (communication monitoring + executive-comp structure) and TALENT (ROIC / dividends &
// buybacks / debt management, reconciled against the injected harness T0 block). Both judgment
// blocks are OPTIONAL at the schema level (degrade-not-destroy) and retry-FORCED via requiredFields.
// The worst tiers (red_flag / poor) carry veto teeth downstream, so grounding is the bar: the
// resolver honors them only on cite-verified evidence.
// ---------------------------------------------------------------------------------------------------
export const ManagementIntegritySchema = z.object({
  // Candor evidence from the company's OWN words — filings narrative (MD&A), shareholder letters,
  // earnings calls where a transcript actually grounds. Each observation cite-verified.
  communication_observations: z.array(z.object({
    observation: z.string().min(1),
    citation: z.string().min(1),
  })).min(1),
  // HOW management is paid — the compensation categories/metrics from the DEF 14A (grounded proxyBlock).
  comp_structure: z.object({
    summary: z.string().min(1),
    incentive_metrics: z.array(z.string()).optional(),
    alignment: z.enum(['aligned', 'mixed', 'misaligned']),
    // Must cite the grounded DEF 14A source_id (or another corpus-verified source).
    citation: z.string().min(1),
  }),
  // Cited integrity red flags (related-party dealings, restatements, candor failures, egregious
  // comp). MAY be empty; a HIGH-severity flag that GROUNDS is the only thing that can veto a BUY.
  integrity_flags: z.array(z.object({
    claim: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high']),
    citation: z.string().min(1),
  })),
  proposed_integrity: z.enum(['clean', 'concerns', 'red_flag']),
  integrity_reasoning: z.string().min(1),
})

export const ManagementTalentSchema = z.object({
  // The cited capital-allocation evidence (buyback timing vs value, acquisition discipline,
  // dividend consistency, deleveraging). Must RECONCILE with the injected T0 block, not re-derive it.
  talent_drivers: z.array(z.object({
    evidence: z.string().min(1),
    citation: z.string().min(1),
  })).min(1),
  proposed_talent: z.enum(['excellent', 'adequate', 'poor']),
  talent_reasoning: z.string().min(1),
})

export const ManagementLaneSchema = z.object({
  ...LaneAgentBaseShape,
  integrity: ManagementIntegritySchema.optional(),
  talent: ManagementTalentSchema.optional(),
})

export const MANAGEMENT_PILLAR_PROMPT =
  ` As the MANAGEMENT lane you ALSO produce the management-pillar judgment — the two core traits, `
  + `each as a GROUNDED CITED THESIS (argue it, do not assert it). `
  + `TRAIT 1 — INTEGRITY: monitor management's COMMUNICATION through the grounded filings (MD&A candor, `
  + `shareholder-letter language where present, earnings-call transcripts ONLY if a transcript source `
  + `actually verifies) — emit communication_observations [{observation, citation}]. You are answering `
  + `ONE question: is this person being honest, clear, and transparent — or dancing around the truth? `
  + `Apply the five candor tests: (1) do they explain complex issues clearly, or hide behind jargon? `
  + `(2) are they open about challenges, or do they only focus on the positives? (3) when something goes `
  + `wrong, do they take responsibility, or blame external factors? (4) do they sound like a thoughtful `
  + `leader, or a politician dodging hard questions? (5) after reading, do you trust them more or less? `
  + `The two 10-K sections that reveal the most: Part I Item 1 (the business description) and Part II `
  + `Item 7 (the MD&A) — read them via read_source where available. Assess HOW `
  + `management is PAID from the DEF 14A proxy: comp_structure {summary, incentive_metrics, alignment, `
  + `citation} — cite the grounded proxy source_id. Emit integrity_flags [{claim, severity, citation}] `
  + `for cited red flags (related-party dealings, restatements, candor failures, egregious pay); an `
  + `empty list is a valid answer. Then proposed_integrity ('clean' | 'concerns' | 'red_flag') + `
  + `integrity_reasoning. A grounded HIGH-severity flag VETOES an unattended BUY downstream — claim `
  + `'red_flag' only on cite-verified evidence; 'clean' must also be DEMONSTRATED (grounded comp citation `
  + `+ at least one grounded observation), not asserted. `
  + `TRAIT 2 — TALENT: judge capital allocation against the HARNESS-COMPUTED T0 observations injected `
  + `above (ROIC, dividends & buybacks discipline, debt management, the retained-earnings test) — `
  + `RECONCILE with those numbers, never re-derive them. Emit talent_drivers [{evidence, citation}] `
  + `(buyback timing vs value, acquisition discipline, dividend consistency, deleveraging), then `
  + `proposed_talent ('excellent' | 'adequate' | 'poor') + talent_reasoning. 'excellent' is honored only `
  + `with >=2 grounded distinct drivers; 'poor' (which also vetoes a BUY) only when grounded. `
  + `GROUNDING IS THE BAR: ungrounded claims resolve 'undetermined' and carry no weight either way.`

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
  // Phase 2 V4: valuation_status is OWNED by the valuation stage (valuationReasoningPass) — dropped
  // here (an emitted value is stripped as an unknown key; the stage artifact is the record).
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
  // sector_status + impermissible_income overlay is produced by the focused shariah reasoning pass
  // (shariahReasoningPass) — not by a synthesis field.
  // The judgment-objectivity spec assigns rubric scoring to the producing LANE — so the synthesis schema
  // no longer carries them (the dogfood failure: a live model omitted them from this monolithic schema).
  // The harness reads moat_class/runway/rubrics from the moat lane output and the Shariah overlay from
  // the focused pass output; synthesis keeps only synthesis_response (its red-team obligation).
  growth_assumptions: z.string().min(1),
  // Phase 2 V4: the owner_earnings_bridge is OWNED by the valuation stage — dropped here.
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
    // Phase 2 V2 (owner-validated 2026-07-11): the GRADE is now T0-computed (margin_of_safety_grade on
    // the valuation payload — the buy-below's discount to the reference value vs the uniform required
    // margin). The model no longer grades its own margin; tolerated read-only on legacy payloads.
    adequacy: z.enum(['adequate', 'thin', 'inadequate']).optional(),
    // The joint reasoning tying the named source(s) together (the NARRATIVE — which source(s) the
    // margin rests on and why; the human weighs it against the T0 grade).
    reasoning: z.string().min(1),
  }),
  // Phase 2 V4: proposed_buy_below + valuation_reasoning are OWNED by the valuation stage
  // (valuationReasoningPass runs ALWAYS between the lanes and synthesis, cite-checked there). The
  // monolithic schema no longer carries them — a live model kept under-filling these exact fields
  // (SPGI/COST dogfood), and the focused stage is where the model is reliable. Emitted values are
  // stripped as unknown keys; the stage artifact drives the T0 valuation (V1b).
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
export const MOAT_PILLAR_PROMPT =
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
  + `EXAMPLE runway_drivers (shape only): [{"headroom":"emerging-market per-capita consumption under 1/4 of developed markets — decades of volume runway","citation":"sec_edgar_10k_<cik>_fy<year>"},{"headroom":"announced bottling-capacity expansion deploys capital at >20% incremental ROIC","citation":"<verified-source_id>"}]. `
  // ---- S3 (Phase 3 pillars): taxonomy + direction + peer standout ----
  + `TAG EVERY moat_driver with its moat_type — WHICH kind of moat the advantage is, from EXACTLY this `
  + `taxonomy: 'brand' (loyalty/pricing power from the name), 'switching_costs', 'network_effect', `
  + `'intangible_assets' (secret sauce: patents, formulas, proprietary data/process), 'toll_bridge' (the `
  + `unavoidable path everyone must pay to cross), 'cost_advantage' (structurally lower unit costs), `
  + `'scale_advantage', 'barrier_to_entry' (regulatory/licensing/capital walls), 'monopoly_position' (a `
  + `granted or de-facto monopoly — NOTE this is a moat TYPE, distinct from the 'monopoly' WIDTH class). `
  + `ALSO judge the moat DIRECTION — moat_direction: 'widening' | 'stable' | 'narrowing' — with `
  + `direction_drivers: the SPECIFIC observable evidence [{evidence, citation}] cited to verified sources, `
  + `and direction_reasoning. Calibration: a NARROWING moat is a sell signal no matter how wide it still `
  + `looks — a grounded 'narrowing' derates a BUY to WATCH, so claim it ONLY on cited evidence (share `
  + `erosion, price-realization decline, a structural attacker); an ungrounded direction resolves `
  + `'undetermined' and carries no weight. `
  + `ALSO produce the STANDOUT peer comparison — peer_standout: does this business clearly rise above the `
  + `pack on GROSS MARGIN within its industry? Name the 2-5 closest peers with their gross margins `
  + `(gross_margin_note like "~38% FY2024 gross margin") and judge 'stands_out' | 'in_line' | 'lags' | `
  + `'cannot_assess' with reasoning. For each peer, include a citation ONLY when the figure comes from a `
  + `corpus-verifiable source; otherwise OMIT the citation — the harness labels the figure model-asserted `
  + `(honest labeling beats a fake citation, which FAILS the cite-check). The company's OWN gross-margin `
  + `series is computed by the harness from EDGAR; do not restate it.`

// RISKS-lane recency framing (the "web tier"). The risks lane is the only allow_unknown lane — it may cite
// web/media — so it is the seam where recency could masquerade as decision-grade. This note keeps both
// trees honest: web/media recency is best-effort COLOR; thesis-critical recency (material 8-K events) is
// grounded by the EDGAR tree as hashed primary documents (see docs/architecture/read-source-contract.md),
// not by web here. Appended to the risks lane's sourceDiscipline in researchSwarm.ts. Leading space so it
// concatenates cleanly onto the preceding sentence.
export const RISKS_RECENCY_NOTE =
  ` This is best-effort recency/consensus COLOR, not decision-grade primary evidence: thesis-critical `
  + `recency (material 8-K events — impairment, guidance cut, exec departure, M&A, litigation) is grounded `
  + `by the EDGAR tree as hashed primary documents, not by web/media here.`

// CIRCLE-OF-COMPETENCE judgment prompt (the sequential pre-deep-dive gate). The model must DEMONSTRATE
// understanding, not assert it — and grounding BOTH clauses is the bar. Ungrounded = outside competence.
export const CIRCLE_COMPETENCE_PROMPT =
  `You are the Buffett-Munger CIRCLE-OF-COMPETENCE gate. The question is NOT "do I understand this `
  + `business?" — it is "are THIS business's cashflows DURABLY PREDICTABLE enough to value with confidence?". `
  + `These are DIFFERENT: understanding the business is NOT the same as competence to value it. `
  + `BOTH answers are equally valid Buffett outputs when demonstrated: setting a genuinely unpredictable `
  + `business aside is correct, and judging a genuinely durable business in-circle is EQUALLY correct — do `
  + `not treat "outside" as the safe answer. `
  + `You must DEMONSTRATE your judgment, not assert it: cite (from primary filings) the specific DRIVERS that `
  + `make this business's cashflows DURABLE/predictable (cashflow_drivers — each with concrete TEXT describing `
  + `the driver AND a citation: the source_id of a VERIFIED primary source you fetched) AND what would make `
  + `those cashflows UNPREDICTABLE (predictability_breakers — each ALSO with concrete TEXT + a cited verified `
  + `primary source; this clause is held to the SAME rigor as the drivers — do NOT hand-wave it as prose, and `
  + `do NOT omit the text). IMPORTANT — the breakers you were required to list do NOT by themselves imply `
  + `unpredictability: EVERY durable business has real, citable breakers (litigation, competition, regulation, `
  + `technology shifts). The judgment is whether the DRIVERS dominate THROUGH A FULL ECONOMIC CYCLE, not `
  + `whether breakers exist. CALIBRATION for cashflow_predictability: 'durably_predictable' = the core `
  + `revenue is recurring/contractual/network/consumer-staple in nature and owner earnings would stay `
  + `recognizably stable across a decade INCLUDING recessions (think a dominant beverage brand, a `
  + `warehouse-club membership model, a payments network, a toll-road-like franchise) — ordinary cyclical `
  + `wiggle and headline risks do NOT disqualify it; 'not_predictable' = earnings are DOMINATED by forces `
  + `you cannot forecast — commodity prices, credit/issuance cycles, binary product or legal outcomes `
  + `(think a memory-chip maker whose earnings swing with a commodity price cycle); 'uncertain' = you `
  + `genuinely CANNOT make the through-cycle judgment from the filings — it is NOT a safe middle ground `
  + `for "the business has risks", and choosing it because breakers exist is a MISCALIBRATION. If you `
  + `cannot GROUND BOTH clauses, you are OUTSIDE the circle (the harness fails closed). Do NOT rationalize `
  + `predictability you cannot demonstrate — and equally, do NOT manufacture doubt you cannot ground. `
  + `Gather your own primary sources and return them in proposed_sources with real URLs; `
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
export const PRIMARY_FILING_LANES: ReadonlySet<string> = new Set(['understand', 'moat'])
