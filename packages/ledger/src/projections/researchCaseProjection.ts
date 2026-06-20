import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseStage =
  | 'discovered'
  | 'quick_screened'
  | 'awaiting_deep_dive_approval'
  | 'queued_for_deep_dive'
  | 'deep_dive_started'
  | 'specialist_finding_recorded'
  | 'deep_dive_in_progress'
  | 'circle_competence_judged'
  | 'deep_dive_synthesis_drafted'
  | 'deep_dive_completed'
  | 'deep_dive_complete'
  | 'decision_pending'
  | 'watchlist'
  | 'holding'
  | 'rejected'
  | 'pass'
  | 'analysis_drafted'
  | 'decision_drafted'
  | 'watchlist_draft'

export type ResearchCaseOwnerEarningsValuationProjection = {
  summary?: string
  normalized_owner_earnings?: string
  assumptions?: string[]
  fair_value_range?: string
  buy_price_range?: string
  margin_of_safety?: string
  sources?: string[]
  confidence?: string
  caveats?: string[]
}

/**
 * MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned). The margin rests on one or both SUBSTITUTABLE sources —
 * the price-vs-value gap ('price') and moat durability ('moat') — with per-source reasoning + a reasoned
 * joint adequacy. NOTE: this is the NEW structured judgment, distinct from the retired legacy
 * `margin_of_safety` haircut STRING on ResearchCaseOwnerEarningsValuationProjection.
 */
export type ResearchCaseMarginOfSafetyJudgment = {
  sources: ('price' | 'moat')[]
  price_gap_reasoning?: string
  moat_durability_reasoning?: string
  adequacy: 'adequate' | 'thin' | 'inadequate'
  reasoning: string
}

export type ResearchCaseSpecialistFindingProjection = {
  finding_id: string
  deep_dive_id?: string
  specialist_lane?: string
  finding_summary?: string
  confidence?: string
  caveats?: string[]
  source_ids?: string[]
  provider_run_id?: string
  owner_earnings_valuation?: ResearchCaseOwnerEarningsValuationProjection
}

export type OwnerEarningsBridgeProjection = {
  /** Reporting currency of the monetary bridge fields (e.g. 'USD', 'DKK') when EDGAR-anchored. */
  reporting_currency?: string
  net_income?: number
  depreciation_amortization?: number
  maintenance_capex?: number
  maintenance_capex_proxy_tier?: string
  stock_based_comp?: number
  normalized_working_capital_change?: number
  /** Diluted weighted-average shares outstanding, in MILLIONS (same scale as the $-millions amounts). */
  shares_outstanding?: number
}

/**
 * Reverse-DCF vs sustainable-growth band ± required-gap verdict band (valuation-core revision).
 * The verdict compares the market-IMPLIED growth (reverse-DCF of today's price) to a grounded
 * sustainable-growth band, with conservatism in the required gap (NOT a price haircut):
 *   BUY-WINDOW  — implied ≤ band_low − required_gap  (market underprices the band = CHEAP)
 *   WATCH-FAIR  — band_low − required_gap < implied ≤ band_low (human-discretion zone; never a buy signal)
 *   WATCH       — implied > band_low (implied_above_band when implied ≥ band_high)
 */
export type ResearchCaseVerdictStateProjection = {
  state?: string
  /** Discount to fair value (%) — legacy price-vs-FV field; retained for back-compat where emitted. */
  discount_to_fv_pct?: number
  implied_multiple?: number
  /** Market-implied near-term growth (reverse-DCF of today's price) — the decision input. */
  market_implied_growth?: number
  /** Grounded sustainable-growth band low edge (honest uncertainty dispersion, not a haircut). */
  band_low?: number
  /** Grounded sustainable-growth band high edge. */
  band_high?: number
  /** Grounded anchor g = reinvestment_rate × incremental_roic. */
  band_center?: number
  /** grounded | unsupported_high | not_computable. */
  band_grounding_status?: string
  /** Citations that ground the band (the identity + any capital-light/cross-check basis). */
  band_basis_citations?: string[]
  /** The single conservatism knob, in growth-rate points. */
  required_gap?: number
  /** (band_low − required_gap) − implied; positive = how far below the buy threshold the market sits. */
  gap_to_band?: number
  /** True when implied ≥ band_high (market prices above what the business sustains). */
  implied_above_band?: boolean
  note?: string
}

/**
 * RELIGHTENED DECISION (R1): the MODEL's cited valuation reasoning — it shows its work. The deterministic
 * side uses assumed_growth + the owner-earnings basis only for the reference cross-check FV (a flag-only
 * sanity-check), never to drive the verdict or the buy-below.
 */
export type ResearchCaseValuationReasoningProjection = {
  /** Cited: the owner-earnings basis the model valued. */
  owner_earnings_basis?: string
  /** The near-term growth the model assumed (a fraction). */
  assumed_growth?: number
  /** Cited: WHY that growth is defensible. */
  assumed_growth_rationale?: string
  /** OPTIONAL: the model's discount-rate reasoning. */
  discount_rationale?: string
}

/**
 * Judgment-objectivity layer (judgment-objectivity-layer-spec Mechanisms 1+2): per-axis rubric scores
 * + the mechanical anchor tier vs the lane's proposed tier + the harness-resolved tier. The harness
 * re-verifies the computable rows, bounds the lane's adjustment to ±1 tier with verified cited evidence
 * (upward needs 2×), and records any violations rather than averaging them away.
 */
export type ResearchCaseJudgmentAxisProjection = {
  anchor_tier?: string
  proposed_tier?: string
  resolved_tier?: string
  adjustment_applied?: boolean
  anchor_computable?: boolean
  verified_evidence_count?: number
  /** True when an upward tier bump was denied because the grounded rows didn't support it. Legacy events omit it. */
  grounding_capped?: boolean
  rubric_scores?: { id: string; score: number }[]
  violations?: string[]
  anchor_note?: string
  // ---- Grounded-thesis MOAT projection (B6) — the moat is the model's grounded cited thesis. ----
  /** The cited durable competitive advantages, each with a cite-verified `grounded` flag. */
  moat_drivers?: { advantage: string; citation: string; grounded: boolean }[]
  /** Count of distinct grounded drivers (non-empty advantage AND cite-verified citation). */
  grounded_driver_count?: number
  /** True when the model proposed a gate-passing tier (wide/monopoly) the grounded thesis couldn't back. */
  moat_grounding_unmet?: boolean
  /** Advisory: a grounded gate-passing moat sits on a WEAK EDGAR quant. Surfaced, never blocks. */
  quant_contradicts_moat?: boolean
  // ---- Grounded-thesis RUNWAY projection (runway reframe) — the runway is the model's grounded cited thesis. ----
  /** The cited reinvestment-runway headroom drivers, each with a cite-verified `grounded` flag. */
  runway_drivers?: { headroom: string; citation: string; grounded: boolean }[]
  /** True when the model proposed proven but the grounded thesis couldn't back it. ADVISORY (runway is NOT a gate). */
  runway_grounding_unmet?: boolean
  /** Advisory: a grounded proven runway sits on a WEAK EDGAR incremental-ROIC quant. Surfaced, never blocks. */
  quant_contradicts_runway?: boolean
}

export type ResearchCaseJudgmentProjection = {
  rubric_version?: string
  moat?: ResearchCaseJudgmentAxisProjection
  runway?: ResearchCaseJudgmentAxisProjection
}

/**
 * Mechanism 3 (Base-Rate Constraints): claims that BEAT a base rate (monopoly, credited g 4-5%, >20%
 * ROIC sustained, margin expansion) must carry a STRUCTURAL exceptionality justification. A claim
 * lacking enough structural evidence is flagged `base_rate_burden_unmet` (status 'unmet') — surfaced,
 * never silently passed.
 */
export type ResearchCaseBaseRateFlagProjection = {
  base_rate_id?: string
  claim?: string
  status?: string
  required_structural_evidence?: number
  structural_evidence_count?: number
}

export type ResearchCaseBaseRateBurdenProjection = {
  version?: string
  unmet_count?: number
  flags?: ResearchCaseBaseRateFlagProjection[]
}

/**
 * Mechanism 6 (Source Discipline): lane-proposed sources the per-lane whitelist REJECTED (visible —
 * a classification lane reasons from primary documents only; an excluded source is recorded, never
 * silently dropped). reason is `excluded_by_lane_policy:<category>` or `excluded_unknown_source`.
 */
export type ResearchCaseSourceRejectionProjection = {
  lane?: string
  source_id?: string
  category?: string
  reason?: string
}

export type ResearchCaseSourceDisciplineProjection = {
  version?: string
  rejected_count?: number
  rejections?: ResearchCaseSourceRejectionProjection[]
}

/**
 * Mechanism 5 (Red-Team Pass): the adversarial pre-synthesis run + the synthesis obligation. Carries
 * the strongest objection (cited to the corpus) and the synthesis response (answered-with-evidence vs
 * accepted→downgraded), plus the deterministic flags: `objection_unaddressed` (synthesis was silent on
 * a live objection — surfaced, never dropped) and the `red_team_incomplete` status (the case was not
 * adversarially tested because the red-team agent timed out/failed).
 */
export type ResearchCaseRedTeamSynthesisResponseProjection = {
  mode?: string
  text?: string
  downgrade?: { dimension?: string; from?: string; to?: string }
}

export type ResearchCaseRedTeamProjection = {
  status?: string
  reason?: string
  strongest_bear_case?: string
  weakest_rubric_items?: { lane?: string; item?: string; why?: string }[]
  moat_decay_scenario?: string
  growth_credit_attack?: string
  shared_narrative_blindspots?: string[]
  strongest_objection?: { claim?: string; severity?: string; citations?: string[] }
  uncited_objection_refs?: string[]
  synthesis_response?: ResearchCaseRedTeamSynthesisResponseProjection
  objection_unaddressed?: boolean
}

// Circle-of-competence judgment: the grounded model judgment of whether it understands THIS business well
// enough to assess its cashflow predictability. Demonstrated (not asserted) — cited drivers + cited
// predictability-breakers (both cite-verified). Outside-competence (model says so OR fail-closed on either
// ungrounded clause) sets the case aside (verdict PASS). Projected legacy-tolerantly (absent on old runs).
export type ResearchCaseCircleClaimProjection = {
  driver?: string
  breaker?: string
  citation?: string
  grounded?: boolean
}
export type ResearchCaseCircleCompetenceProjection = {
  /**
   * The HARNESS outcome: in-competence (true) only when the model judged the cashflows durably predictable
   * AND both clauses grounded (non-empty text + verified citation). DERIVED — kept as the proceed/set-aside
   * signal and for legacy events that only carried this boolean.
   */
  in_competence?: boolean
  /**
   * The model's predictability VERDICT (Bug B): 'durably_predictable' is the ONLY value that proceeds; a
   * well-understood but cyclical/commodity business is 'not_predictable' → set aside. Absent on legacy
   * events (which carried only the in_competence boolean).
   */
  cashflow_predictability?: 'durably_predictable' | 'not_predictable' | 'uncertain'
  /** The model's raw predictability claim (the enum, before the harness's grounding fail-closed). */
  model_claimed_predictability?: 'durably_predictable' | 'not_predictable' | 'uncertain'
  /** LEGACY: the model's raw boolean claim on old events (before the enum). Read for back-compat only. */
  model_claimed_in_competence?: boolean
  competence_reasoning?: string
  cashflow_drivers?: ResearchCaseCircleClaimProjection[]
  predictability_breakers?: ResearchCaseCircleClaimProjection[]
  /** Set when the gate failed closed (model outside-competence OR an ungrounded clause). */
  circle_competence_unmet?: boolean
  reason?: string
}

export type ResearchCaseValuationProjection = {
  /** Set when the case was set aside outside the circle of competence (the deep dive did not run). */
  circle_competence_unmet?: boolean
  /** Mirror flag for the set-aside path (outside the owner-policy + competence circle). */
  outside_circle?: boolean
  moat_class?: string
  moat_passes_gate?: boolean
  /** Reinvestment runway axis (separate from moat): proven | limited | none. */
  runway?: string
  runway_exceptional?: boolean
  discount_rate?: number
  /** Discount provenance (Phase 1.4): the 10y Treasury + uniform equity premium that formed discount_rate. */
  discount_inputs?: { ten_year_treasury?: number; ten_year_treasury_basis?: string; equity_premium?: number }
  growth_assumptions?: string
  /**
   * HEADLINE growth = the MODEL's cite-verified assumed_growth (architecture: the model's grounded judgment
   * is the analysis). Absent when assumed_growth was absent/ungrounded (degraded per A1 — no fall-back to
   * the credited-g). The capped demonstrated CAGR is `demonstrated_growth_reference` (a sanity reference).
   */
  growth_rate?: number
  /**
   * The capped-mechanical CREDITED growth (demonstrated owner-earnings/share CAGR through the forecasting-
   * humility cap; lane may argue lower) — a DEMONSTRATED-HISTORY sanity reference, NOT the headline. An
   * advisory sanity flag fires when the model's headline assumed_growth materially exceeds this.
   */
  demonstrated_growth_reference?: number
  /** Provenance of the growth path (Phase 1.3): 'edgar_oe_cagr' (demonstrated CAGR) or 'none' (no-growth floor). */
  growth_basis?: string
  /**
   * Phase 7 S4 — data-completeness evidence (checklist item 11): the span (years), positive-point count,
   * and estimator the demonstrated owner-earnings growth measure actually used. CARRIED from the existing
   * DemonstratedGrowthResult the valuation already consumed (persist-only). A short/gappy series reads as
   * thin history beside the data_completeness item.
   */
  growth_window_years?: number
  growth_points_used?: number
  growth_method?: string
  /** True when the near-term growth is materially above GDP — a flagged moat-durability claim (Phase 1.3). */
  growth_above_gdp?: boolean
  /** True when the named single_growth_cap bound the growth path (over-optimism backstop bit). */
  growth_cap_binds?: boolean
  /** Terminal-stage growth (g_t) used by the two-stage DCF: monopoly 2% / wide 1%. */
  terminal_growth_rate?: number
  roic?: number
  /** Normalized incremental ROIC (fraction) — drives credited-growth eligibility + magnitude. */
  incremental_roic?: number
  reinvestment_rate?: number
  owner_earnings_bridge?: OwnerEarningsBridgeProjection
  normalized_owner_earnings_per_share?: number
  /**
   * Presentation-only intrinsic-value reference at the sustainable-growth band CENTER (forward DCF at
   * g = band_center). NOT the decision driver — the verdict is market-implied-growth-vs-band (see
   * verdict_state), not price-vs-fair-value.
   */
  fair_value_per_share?: number
  /**
   * Implied multiple = point fair value at the CREDITED growth (forward DCF at g = credited_g) / OE_ps. NOT
   * fair_value_per_share / OE_ps — fair_value_per_share is now the band-center reference, a different anchor.
   */
  implied_multiple?: number
  /** Terminal (Gordon) value as a % of intrinsic value (Phase 1.5) — flagged when > 0.65. */
  terminal_value_pct_of_iv?: number
  /** Phase 1.6: fair value exceeded the 18× OE sanity-flag threshold — surfaced, not truncated. */
  cap_exceeded?: boolean
  /**
   * Founding-risk fix: the decision/synthesis agent's verdict + valuation/growth claims were NOT grounded
   * in a verified source of its OWN (empty dec.verified_ids and/or an owner-earnings/assumed-growth citation
   * that did not verify against the corpus). When true the verdict was fail-closed to RESEARCH_MORE — the
   * model's confident verdict was NOT recorded. Legacy-tolerant: absent on old events.
   */
  synthesis_grounding_unmet?: boolean
  /** Founding-risk fix: human-readable reason naming WHICH grounding layer/claim failed. */
  synthesis_grounding_reason?: string
  /**
   * Moat-gate fix: the moat gate failed because the moat claim was UNGROUNDED (the model reached for a
   * wide+ moat but the cite-verified qualitative rows did not back it, or the moat resolved via the
   * holistic fallback) — NOT because the moat is genuinely narrow. When true the verdict was routed to
   * RESEARCH_MORE (vs PASS for a genuinely-narrow moat). Legacy-tolerant: absent on old events.
   */
  moat_grounding_unmet?: boolean
  /** Moat-gate fix: human-readable reason naming WHY the moat claim was treated as ungrounded. */
  moat_grounding_reason?: string
  /**
   * The price at which market-implied growth rises to the buy-threshold (band_low − required_gap) — i.e.
   * the forward DCF evaluated at g = band_low − required_gap, repurposing the monotonic two-stage DCF as a
   * price-from-growth function. By construction the reverse-DCF implied growth at this price equals the
   * buy-threshold (round-trip-consistent). NOT fair_value × (1 − MoS).
   */
  buy_price_per_share?: number
  /**
   * Phase 2: a formatted low–high (base) fair-value RANGE derived from the growth-measure's own
   * uncertainty (thin history / dispersion widen the band). Absent when not computable; the point
   * fair_value_per_share is the BASE of this range. E.g. "$148–$216 (base $216)".
   */
  fair_value_range?: string
  /**
   * Phase 2: a human-readable note explaining WHY the range is as wide as it is (usable owner-earnings
   * history depth / dispersion). Surfaced so a thin-history name reads as honestly uncertain. Absent
   * when the range is not computable or no widening cause applies.
   */
  fair_value_range_basis?: string
  /**
   * Phase 2: the near-term owner-earnings growth the CURRENT MARKET PRICE implies (reverse-DCF),
   * as a fraction. Absent when no current price was available. Compared against growth_rate (ours)
   * in the dossier as an over-confidence/richness signal.
   */
  market_implied_growth?: number
  /** Phase 2: true when the base fair value is LIMITED by the single growth cap (not the estimate). */
  valuation_cap_binding?: boolean
  /** Provenance of the incremental ROIC used: 'sec_edgar' (computed from the series) or 'model_proposed'. */
  incremental_roic_basis?: string
  /**
   * RELIGHTENED DECISION (R1): the MODEL's proposed buy-below (recorded VERBATIM — NOT a derived FV). Equal
   * to buy_price_per_share now that the band/gap engines no longer source the buy-below.
   */
  proposed_buy_below?: number
  /**
   * RELIGHTENED DECISION (R1): a forward-DCF CROSS-CHECK fair value at the MODEL's assumed growth — a
   * reference only (NOT the decision driver, NOT the buy-below source). Used by the flag-only sanity layer.
   */
  reference_fair_value?: number
  /** RELIGHTENED DECISION (R1): pure arithmetic — current_price <= buy_below. */
  in_buy_zone?: boolean
  /**
   * §2 sanity output (flag-only): the name-specific implied EXIT P/OE multiple — current price ÷ forward
   * owner earnings (OE/share grown to the explicit horizon at the MODEL's assumed growth along the same
   * faded stage-1 path the two-stage DCF uses; NO discount-compounding factor). The exit P/OE the live
   * price requires a future buyer to pay. Absent (legacy-tolerant) when not computable; a directional
   * `sanity_implied_exit_multiple_high` flag fires when it is above the sane cap. Advisory.
   */
  implied_exit_multiple?: number
  /**
   * RELIGHTENED DECISION (R1): the deterministic, SYMMETRIC, flag-only sanity-check messages (over-
   * optimistic + over-pessimistic catches + absurdity flags). NEVER blocks the verdict — advisory only.
   */
  sanity_flags?: string[]
  /** RELIGHTENED DECISION (R1): the MODEL's cited valuation reasoning (it shows its work). */
  valuation_reasoning?: ResearchCaseValuationReasoningProjection
  /**
   * LEGACY (R1 tolerates, R2/R4 remove): the retired band verdict_state. New runs no longer EMIT it; old
   * events that still carry it are projected via the back-compat type so the dossier UI keeps compiling.
   */
  verdict_state?: ResearchCaseVerdictStateProjection
  /** Judgment-objectivity rubric layer (Mechanisms 1+2): anchor-vs-proposed tier + rubric scores. */
  judgment?: ResearchCaseJudgmentProjection
  /** Mechanism 3: base-rate burden flags for claims that beat a base rate (monopoly, g 4-5%, etc.). */
  base_rate_burden?: ResearchCaseBaseRateBurdenProjection
  value_basis?: string
  /** OE-bridge provenance: 'sec_edgar' (anchored to the 10-K) or 'model_proposed'. */
  bridge_basis?: string
  /** Fiscal year of the EDGAR 10-K the bridge was anchored to (when bridge_basis === 'sec_edgar'). */
  bridge_fiscal_year?: number
  /** EDGAR source_id for the 10-K the bridge was anchored to (when bridge_basis === 'sec_edgar'). */
  bridge_source_id?: string
  /**
   * SANITY-CHECK REFERENCE: the deterministic Greenwald/D&A maintenance-capex proxy ($M). NOT the binding OE
   * input — the model judges maintenance capex. Surfaced for the human + the advisory divergence flag
   * (maintenance_capex_below_proxy). Absent when the EDGAR series is too thin to compute either proxy.
   */
  maintenance_capex_proxy_reference?: number
}

/**
 * Harness-computed AAOIFI Shariah FINANCIAL ratios (re-verifying the model). Present only when
 * computable from EDGAR primary data + market cap; absent → the lane's proposed verdict was used.
 */
export type ResearchCaseShariahFinancialProjection = {
  /** interest-bearing debt / market cap (threshold < 0.30). */
  debt_ratio?: number
  /** (cash + interest-bearing securities) / market cap (threshold < 0.30). */
  cash_securities_ratio?: number
  /** impermissible income / total revenue (threshold < 0.05). */
  impermissible_income_pct?: number
  /** Harness verdict: PASS | CONDITIONAL | FAIL. */
  verdict?: string
  /** Purification % carried into the purification engine (= impermissible_income_pct). */
  purification_pct?: number
  /** Market cap ($M) used for the ratios. */
  market_cap?: number
  /** Basis of the market cap (currently current price × diluted shares). */
  market_cap_basis?: string
  /** Fiscal year of the EDGAR primary data the ratios used. */
  bridge_source_fiscal_year?: number
}

/**
 * A grounded risk field on the admit recommendation (Task 4.2c): level + argument + cite-checked
 * citations. The value trap hides in a LOW stated permanent_loss_risk that is actually HIGH, so the
 * judgment carries `uncertainty` and `permanent_loss_risk` as SEPARATE grounded fields.
 */
export type ResearchCaseAdmitRiskFieldProjection = {
  level?: string
  argument?: string
  citations?: string[]
}

/** Cheapness summary (Phase-1 OE / EV) that surfaced the name for the admit judgment. */
export type ResearchCaseAdmitCheapnessProjection = {
  owner_earnings_yield?: number
  ev?: number
  cheap?: boolean
  reason?: string
}

/**
 * Admit-judgment recommendation (Task 4.2c) — the agent-authored OBSERVATION recomputed FRESH on-demand.
 * It is a RECOMMENDATION (`admittable` is a flag), NOT an admit: recording it never transitions the case.
 * The newest recorded recommendation wins (the projection keeps the latest).
 */
export type ResearchCaseAdmitRecommendationProjection = {
  admit_judgment_id?: string
  uncertainty?: ResearchCaseAdmitRiskFieldProjection
  permanent_loss_risk?: ResearchCaseAdmitRiskFieldProjection
  impairment_bear_case?: string
  impairment_call?: string
  admittable?: boolean
  reason?: string
  buy_below?: number
  cheapness?: ResearchCaseAdmitCheapnessProjection
  /**
   * Phase 5 S2 — the concrete per-share downside floor (deterministic balance-sheet arithmetic, GATED for
   * reliability by `permanent_loss_risk.level`). Present only when the floor was computable; `cannot_floor`
   * (e.g. a HIGH permanent-loss level, or missing inputs) leaves all three undefined. `basis` (net_cash vs
   * stressed_book) IS the reliability signal — never flattened to a bare number. Phase-5 sizing reads these.
   */
  downside_floor_per_share?: number
  downside_floor_basis?: string
  downside_floor_reliability?: string
  uncited_refs?: string[]
  recorded_at?: string
}

/** The worst-case block that ALWAYS rides alongside a sizing recommendation (Phase 5 S7). */
export type ResearchCaseSizingWorstCaseProjection = {
  downside_floor_per_share?: number
  /** net_cash (harder) vs stressed_book — the reliability signal, never flattened. */
  downside_floor_basis?: string
  realistic_downside_per_share?: number
  /** Aggregate cluster downside as a fraction of book NAV (the S4 correlated-impairment view). */
  aggregate_cluster_downside_fraction?: number
  /**
   * Phase 7 S4 — the candidate's per-name cluster key + basis (e.g. 'sic:73' / 'sic_proxy', or
   * 'unclustered:TICKER' / 'unclustered'), CARRIED from the same cluster computation (persist-only). Lets
   * the concentration_correlation business-checklist item marshal "which cluster, on what basis".
   */
  cluster_key?: string
  cluster_basis?: string
}

/** One rung of the entry ladder carried on a sizing recommendation. */
export type ResearchCaseSizingLadderLevelProjection = {
  id?: string
  fraction?: number
  trigger_label?: string
  trigger_price_per_share?: number
  buy_price_version?: string
}

/**
 * Sizing recommendation (Phase 5 S7) — the agent-authored OBSERVATION recomputed FRESH on-demand by the
 * S6 assembler. It is a RECOMMENDATION (advisory), NOT a buy: recording it never opens a holding. The
 * newest recorded recommendation wins.
 *
 * `status` is the gate-first outcome:
 *   - `sizeable` — the candidate cleared the deployment hurdle; the size fields + worst_case are present.
 *   - `hold_in_savings` — nothing clears the hurdle → idle capital stays in the savings sleeve. This is
 *     the CORRECT fat-pitch posture, NOT a warning. `reason` + `expected_savings_return` explain it.
 *   - `cannot_size` — fail-closed (no floor / non-investable / bad inputs); `reason` says why. No size.
 */
export type ResearchCaseSizingRecommendationProjection = {
  sizing_recommendation_id?: string
  status?: 'sizeable' | 'hold_in_savings' | 'cannot_size'
  conviction_factor?: number
  target_weight?: number
  sizeable_value?: number
  binding_constraint?: string
  worst_case?: ResearchCaseSizingWorstCaseProjection
  ladder?: ResearchCaseSizingLadderLevelProjection[]
  caveats?: string[]
  reason?: string
  /** EXPECTED (not guaranteed) savings-sleeve return, present on a `hold_in_savings` posture. */
  expected_savings_return?: number
  recorded_at?: string
}

/** The worst case that ALWAYS rides alongside a sell decision (Phase 6 S8). Floor fields from the S2 floor. */
export type ResearchCaseSellWorstCaseProjection = {
  downside_floor_per_share?: number
  /** net_cash (harder) vs stressed_book — the reliability signal, never flattened. */
  downside_floor_basis?: string
  /** The reliability tier of the floor (e.g. high/medium/low) — a second reliability signal. */
  downside_floor_reliability?: string
  /** max(cost - floor, 0); present only when the floor is known. */
  realistic_downside?: number
}

/** One advisory Munger bias caveat carried on a sell decision (Phase 6 S5). Never blocks the decision. */
export type ResearchCaseSellBiasCaveatProjection = {
  kind?: string
  message?: string
}

/**
 * Sell decision (Phase 6 S8) — the agent-authored advisory OBSERVATION (`holding_sell_review_drafted`,
 * is_observation:true) recomputed FRESH on-demand for a HELD name. It is a RECOMMENDATION, NEVER a close:
 * recording it never exits the holding — the close stays the human-authored `closeHolding` transition.
 * The newest recorded observation wins.
 *
 * `decision_status` is the gate-first outcome:
 *   - `sell_review` — the minimum-hold guard released a review; `reason_code` + `requires_human_signoff`
 *     surface, and the CLOSE is still human-authored (there is NO auto-sell).
 *   - `hold` — the guard HELD (a fixable problem inside the hold window). This is the disposition brake
 *     working AS DESIGNED — the CORRECT posture, NOT a warning.
 *   - `escalate_review` — the unresolved / incoherent path; needs the human's judgment (attention, not error).
 *   - `cannot_assess` — fail-closed (missing inputs); a neutral honest message, never a fabricated verdict.
 */
export type ResearchCaseSellRecommendationProjection = {
  decision_status?: 'sell_review' | 'hold' | 'escalate_review' | 'cannot_assess'
  reason_code?: string
  trigger?: string
  impairment_call?: string
  /** The minimum-hold guard's verdict (S2). */
  minimum_hold_decision?: string
  /**
   * The sign-off-frozen normalized owner-earnings/share (scope-reframe; passed in, never recomputed).
   * Present when supplied.
   */
  frozen_oe_ps?: number
  /**
   * The sign-off-frozen REFERENCE fair value the lightened valuation-inverted sell FLAG compares the live
   * price against — also the anchoring guard's price anchor (scope-reframe; passed in, never recomputed).
   * Present when supplied. Legacy events' frozen_iv is read onto this.
   */
  frozen_reference_fair_value?: number
  /** ALWAYS attached — worst-case-first, even on a hold/escalate. */
  worst_case?: ResearchCaseSellWorstCaseProjection
  /** Advisory disposition / anchoring caveats (S5); never block or change the decision. */
  bias_caveats?: ResearchCaseSellBiasCaveatProjection[]
  /** True when a human MUST author/sign the exit as a structural gate (better-opportunity, escalate). */
  requires_human_signoff?: boolean
  recorded_at?: string
}

/**
 * One human checklist answer mirrored onto the research case (Phase 7 S2). Structurally identical to the
 * `ChecklistAnswer` shape in `@owlfolio/strategies/checklist`, redeclared here because `@owlfolio/ledger`
 * must NOT depend on `@owlfolio/strategies`.
 */
export type ResearchCaseChecklistAnswer = {
  addressed: boolean
  note: string
}

/**
 * The harness-marshaled audit mirrored onto the research case (audit-and-decide model). Structurally
 * identical to the `ChecklistAudit` shape in `@owlfolio/strategies/checklistParams`, redeclared here
 * because `@owlfolio/ledger` must NOT depend on `@owlfolio/strategies`.
 */
export type ResearchCaseChecklistAudit = {
  version: string
  business_findings: Record<string, string>
  cognitive_acknowledged: boolean
}

/**
 * The human's Phase 7 hygiene-checklist answers (business + cognitive), captured at sign-off
 * (`watchlist_draft_created`) and mirrored onto the research case so a name's checklist answers travel
 * with its thesis (auditable). Keyed by checklist item id. DECISION-NEUTRAL: a verbatim audit projection
 * — no score/count is derived.
 */
export type ResearchCaseChecklistAnswersProjection = Record<string, ResearchCaseChecklistAnswer>

export type ResearchCaseProjection = {
  research_case_id: string
  version: number
  supersedes_research_case_id?: string
  superseded: boolean
  stage: ResearchCaseStage
  /**
   * The provider that actually AUTHORED the run (defense-in-depth UI honesty): a placeholder/mock run
   * can never masquerade as a real grounded dossier. Derived from the authoring provider event's
   * `actor_id` — the `buffett_munger_analysis_drafted` event (the canonical analysis author) is
   * preferred, falling back to a `specialist_finding_recorded` event when the analysis event is absent.
   * Only set when `actor_type === 'provider'`; undefined for older / user-authored / non-provider runs.
   */
  authored_by_provider_id?: string
  candidate_id?: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  strategy_version?: string
  quick_screen_id?: string
  screening_result?: string
  business_quality?: string
  moat?: string
  management_capital_allocation?: string
  financial_quality?: string
  valuation_sanity?: string
  red_flags?: string[]
  confidence?: string
  caveats?: string[]
  deep_dive_id?: string
  finding_id?: string
  specialist_lane?: string
  specialist_findings?: ResearchCaseSpecialistFindingProjection[]
  owner_earnings_valuation?: ResearchCaseOwnerEarningsValuationProjection
  /** Circle-of-competence judgment (grounded model judgment that gated the deep-dive spend). */
  circle_competence?: ResearchCaseCircleCompetenceProjection
  valuation?: ResearchCaseValuationProjection
  /** Harness-computed AAOIFI Shariah financial ratios (absent → lane-proposed verdict was used). */
  shariah_financial?: ResearchCaseShariahFinancialProjection
  /** SHARIAH lane sector status judgment: compliant | conditional | non_compliant. */
  shariah_sector_status?: string
  /** Mechanism 6: source-discipline rejections (lane-proposed sources the whitelist excluded). */
  source_discipline?: ResearchCaseSourceDisciplineProjection
  /** Mechanism 5: red-team pass — strongest objection + the synthesis response + the deterministic flags. */
  red_team?: ResearchCaseRedTeamProjection
  /** Task 4.2c: the newest admit-judgment recommendation OBSERVATION (recomputed fresh on-demand). */
  admit_recommendation?: ResearchCaseAdmitRecommendationProjection
  /** Phase 5 S7: the newest sizing recommendation OBSERVATION (the S6 assembler, recomputed on-demand). */
  sizing_recommendation?: ResearchCaseSizingRecommendationProjection
  /** Phase 6 S8: the newest sell-decision OBSERVATION for a HELD name (advisory; never closes the holding). */
  sell_recommendation?: ResearchCaseSellRecommendationProjection
  synthesis_id?: string
  decision_id?: string
  investment_verdict?: string
  strategy_compliance?: string
  shariah_status?: string
  valuation_status?: string
  next_required_action?: string
  /**
   * MARGIN-OF-SAFETY AUDIT SURFACE — the synthesis decision's forward-looking model risk judgments.
   * key_wrong_assumption: the SINGLE assumption that, if wrong, breaks the thesis. thesis_break_triggers:
   * the observable events that would invalidate it. Legacy-tolerant (optional, guarded reads) — absent for
   * old analysis events. NOT cite-verified (forward-looking model judgments, not current-fact claims).
   */
  key_wrong_assumption?: string
  thesis_break_triggers?: string[]
  /**
   * MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — the HEADLINE of the MoS audit surface. The margin of
   * safety comes from TWO SUBSTITUTABLE sources: the price-vs-value gap and moat durability. Synthesis names
   * which source(s) the margin rests on, gives the per-source reasoning, and a REASONED adequacy + reasoning.
   * adequacy is audit-only (never a gate). Distinct field name (NOT the retired legacy `margin_of_safety`
   * haircut string on the owner-earnings valuation block) so legacy events replay without collision.
   * Legacy-tolerant: absent on old analysis events.
   */
  margin_of_safety_judgment?: ResearchCaseMarginOfSafetyJudgment
  /**
   * GUARD 2: set true when the synthesis claimed 'moat' as a margin-of-safety source but the moat was NOT
   * grounded / did not pass the grounded moat gate — an incoherent moat-sourced margin (ungrounded moat =
   * ungrounded margin), surfaced visibly rather than silently accepted. Legacy-tolerant (absent on old events).
   */
  margin_of_safety_moat_ungrounded?: boolean
  decision?: string
  user_approved?: boolean
  reason?: string
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
  /**
   * The harness-marshaled audit, captured at admit sign-off — mirrored here so the audit travels with the
   * thesis (auditable). DECISION-NEUTRAL: verbatim, never scored. Present on NEW (audit-and-decide) events.
   */
  checklist_audit?: ResearchCaseChecklistAudit
  /**
   * LEGACY: the human's per-item checklist answers captured under the OLD sign-off model, mirrored at admit.
   * Retained so existing ledgers written before the audit-and-decide migration still project. New events
   * carry `checklist_audit` instead. DECISION-NEUTRAL: verbatim, never scored.
   */
  checklist_answers?: ResearchCaseChecklistAnswersProjection
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined
  }

  return [...value]
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && isFinite(value) ? value : undefined
}

/**
 * MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — legacy-tolerant extraction of the NEW structured
 * judgment. Distinct from the retired legacy `margin_of_safety` haircut STRING (which is intentionally never
 * projected). Only a well-formed judgment (≥1 valid source + valid adequacy + non-empty reasoning) projects;
 * anything else → undefined (graceful fallback). Never throws — old events without it simply project nothing.
 */
function getMarginOfSafetyJudgment(
  payload: Record<string, unknown>,
  key: string,
): ResearchCaseMarginOfSafetyJudgment | undefined {
  const value = payload[key]
  if (!isRecord(value)) return undefined
  const rawSources = value['sources']
  if (!Array.isArray(rawSources)) return undefined
  const sources = rawSources.filter((s): s is 'price' | 'moat' => s === 'price' || s === 'moat')
  if (sources.length === 0) return undefined
  const adequacy = value['adequacy']
  if (adequacy !== 'adequate' && adequacy !== 'thin' && adequacy !== 'inadequate') return undefined
  const reasoning = value['reasoning']
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) return undefined
  const judgment: ResearchCaseMarginOfSafetyJudgment = { sources, adequacy, reasoning }
  const priceGap = value['price_gap_reasoning']
  if (typeof priceGap === 'string' && priceGap.length > 0) judgment.price_gap_reasoning = priceGap
  const moatDurability = value['moat_durability_reasoning']
  if (typeof moatDurability === 'string' && moatDurability.length > 0) judgment.moat_durability_reasoning = moatDurability
  return judgment
}

/**
 * Extract the human checklist answers map from a payload, decision-neutrally — verbatim, no scoring.
 * Only well-formed `{ addressed: boolean; note: string }` entries are kept; undefined when absent.
 */
function getChecklistAnswers(
  payload: Record<string, unknown>,
  key: string,
): ResearchCaseChecklistAnswersProjection | undefined {
  const value = payload[key]
  if (!isRecord(value)) {
    return undefined
  }
  const answers: ResearchCaseChecklistAnswersProjection = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue
    }
    const addressed = entry['addressed']
    const note = entry['note']
    if (typeof addressed === 'boolean' && typeof note === 'string') {
      answers[id] = { addressed, note }
    }
  }
  return answers
}

/**
 * Extract the harness-marshaled audit from a payload, decision-neutrally — verbatim, no scoring. Returns
 * undefined when the field is absent or malformed (older events carry `checklist_answers` instead).
 */
function getChecklistAudit(
  payload: Record<string, unknown>,
  key: string,
): ResearchCaseChecklistAudit | undefined {
  const value = payload[key]
  if (!isRecord(value)) {
    return undefined
  }
  const version = value['version']
  const businessFindings = value['business_findings']
  const cognitiveAcknowledged = value['cognitive_acknowledged']
  if (typeof version !== 'string' || !isRecord(businessFindings) || typeof cognitiveAcknowledged !== 'boolean') {
    return undefined
  }
  const findings: Record<string, string> = {}
  for (const [id, finding] of Object.entries(businessFindings)) {
    if (typeof finding === 'string') {
      findings[id] = finding
    }
  }
  return { version, business_findings: findings, cognitive_acknowledged: cognitiveAcknowledged }
}

function getOwnerEarningsBridgeProjection(val: Record<string, unknown>): OwnerEarningsBridgeProjection | undefined {
  const bridge = val['owner_earnings_bridge']
  if (!isRecord(bridge)) return undefined

  const projected: OwnerEarningsBridgeProjection = {}
  const reporting_currency = getString(bridge, 'reporting_currency')
  if (reporting_currency !== undefined) projected.reporting_currency = reporting_currency
  const net_income = getNumber(bridge, 'net_income')
  if (net_income !== undefined) projected.net_income = net_income
  const depreciation_amortization = getNumber(bridge, 'depreciation_amortization')
  if (depreciation_amortization !== undefined) projected.depreciation_amortization = depreciation_amortization
  const maintenance_capex = getNumber(bridge, 'maintenance_capex')
  if (maintenance_capex !== undefined) projected.maintenance_capex = maintenance_capex
  const maintenance_capex_proxy_tier = getString(bridge, 'maintenance_capex_proxy_tier')
  if (maintenance_capex_proxy_tier !== undefined) projected.maintenance_capex_proxy_tier = maintenance_capex_proxy_tier
  const stock_based_comp = getNumber(bridge, 'stock_based_comp')
  if (stock_based_comp !== undefined) projected.stock_based_comp = stock_based_comp
  const normalized_working_capital_change = getNumber(bridge, 'normalized_working_capital_change')
  if (normalized_working_capital_change !== undefined) projected.normalized_working_capital_change = normalized_working_capital_change
  const shares_outstanding = getNumber(bridge, 'shares_outstanding')
  if (shares_outstanding !== undefined) projected.shares_outstanding = shares_outstanding

  return Object.keys(projected).length === 0 ? undefined : projected
}

function getVerdictState(valuation: Record<string, unknown>): ResearchCaseVerdictStateProjection | undefined {
  const value = valuation['verdict_state']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseVerdictStateProjection = {}
  const state = getString(value, 'state')
  if (state !== undefined) projected.state = state
  const discount_to_fv_pct = getNumber(value, 'discount_to_fv_pct')
  if (discount_to_fv_pct !== undefined) projected.discount_to_fv_pct = discount_to_fv_pct
  const implied_multiple = getNumber(value, 'implied_multiple')
  if (implied_multiple !== undefined) projected.implied_multiple = implied_multiple
  const market_implied_growth = getNumber(value, 'market_implied_growth')
  if (market_implied_growth !== undefined) projected.market_implied_growth = market_implied_growth
  const band_low = getNumber(value, 'band_low')
  if (band_low !== undefined) projected.band_low = band_low
  const band_high = getNumber(value, 'band_high')
  if (band_high !== undefined) projected.band_high = band_high
  const band_center = getNumber(value, 'band_center')
  if (band_center !== undefined) projected.band_center = band_center
  const band_grounding_status = getString(value, 'band_grounding_status')
  if (band_grounding_status !== undefined) projected.band_grounding_status = band_grounding_status
  const band_basis_citations = getStringArray(value, 'band_basis_citations')
  if (band_basis_citations !== undefined) projected.band_basis_citations = band_basis_citations
  const required_gap = getNumber(value, 'required_gap')
  if (required_gap !== undefined) projected.required_gap = required_gap
  const gap_to_band = getNumber(value, 'gap_to_band')
  if (gap_to_band !== undefined) projected.gap_to_band = gap_to_band
  const implied_above_band = getBoolean(value, 'implied_above_band')
  if (implied_above_band !== undefined) projected.implied_above_band = implied_above_band
  const note = getString(value, 'note')
  if (note !== undefined) projected.note = note
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getValuationReasoning(valuation: Record<string, unknown>): ResearchCaseValuationReasoningProjection | undefined {
  const value = valuation['valuation_reasoning']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseValuationReasoningProjection = {}
  const owner_earnings_basis = getString(value, 'owner_earnings_basis')
  if (owner_earnings_basis !== undefined) projected.owner_earnings_basis = owner_earnings_basis
  const assumed_growth = getNumber(value, 'assumed_growth')
  if (assumed_growth !== undefined) projected.assumed_growth = assumed_growth
  const assumed_growth_rationale = getString(value, 'assumed_growth_rationale')
  if (assumed_growth_rationale !== undefined) projected.assumed_growth_rationale = assumed_growth_rationale
  const discount_rationale = getString(value, 'discount_rationale')
  if (discount_rationale !== undefined) projected.discount_rationale = discount_rationale
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getJudgmentAxis(value: unknown): ResearchCaseJudgmentAxisProjection | undefined {
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseJudgmentAxisProjection = {}
  const anchor_tier = getString(value, 'anchor_tier')
  if (anchor_tier !== undefined) projected.anchor_tier = anchor_tier
  const proposed_tier = getString(value, 'proposed_tier')
  if (proposed_tier !== undefined) projected.proposed_tier = proposed_tier
  const resolved_tier = getString(value, 'resolved_tier')
  if (resolved_tier !== undefined) projected.resolved_tier = resolved_tier
  if (typeof value['adjustment_applied'] === 'boolean') projected.adjustment_applied = value['adjustment_applied']
  if (typeof value['anchor_computable'] === 'boolean') projected.anchor_computable = value['anchor_computable']
  if (typeof value['grounding_capped'] === 'boolean') projected.grounding_capped = value['grounding_capped']
  const verified_evidence_count = getNumber(value, 'verified_evidence_count')
  if (verified_evidence_count !== undefined) projected.verified_evidence_count = verified_evidence_count
  const rawScores = value['rubric_scores']
  if (Array.isArray(rawScores)) {
    const scores = rawScores
      .filter(isRecord)
      .map((s) => ({ id: getString(s, 'id'), score: getNumber(s, 'score') }))
      .filter((s): s is { id: string; score: number } => s.id !== undefined && s.score !== undefined)
    if (scores.length > 0) projected.rubric_scores = scores
  }
  const rawViolations = value['violations']
  if (Array.isArray(rawViolations)) {
    const violations = rawViolations.filter((v): v is string => typeof v === 'string')
    if (violations.length > 0) projected.violations = violations
  }
  const anchor_note = getString(value, 'anchor_note')
  if (anchor_note !== undefined) projected.anchor_note = anchor_note
  // ---- Grounded-thesis MOAT fields (B6) — legacy events omit these (tolerated). ----
  const rawDrivers = value['moat_drivers']
  if (Array.isArray(rawDrivers)) {
    const drivers = rawDrivers
      .filter(isRecord)
      .map((d) => ({ advantage: getString(d, 'advantage'), citation: getString(d, 'citation'), grounded: d['grounded'] === true }))
      .filter((d): d is { advantage: string; citation: string; grounded: boolean } => d.advantage !== undefined && d.citation !== undefined)
    if (drivers.length > 0) projected.moat_drivers = drivers
  }
  const grounded_driver_count = getNumber(value, 'grounded_driver_count')
  if (grounded_driver_count !== undefined) projected.grounded_driver_count = grounded_driver_count
  if (value['moat_grounding_unmet'] === true) projected.moat_grounding_unmet = true
  if (value['quant_contradicts_moat'] === true) projected.quant_contradicts_moat = true
  // ---- Grounded-thesis RUNWAY fields (runway reframe) — legacy events omit these (tolerated). ----
  const rawRunwayDrivers = value['runway_drivers']
  if (Array.isArray(rawRunwayDrivers)) {
    const drivers = rawRunwayDrivers
      .filter(isRecord)
      .map((d) => ({ headroom: getString(d, 'headroom'), citation: getString(d, 'citation'), grounded: d['grounded'] === true }))
      .filter((d): d is { headroom: string; citation: string; grounded: boolean } => d.headroom !== undefined && d.citation !== undefined)
    if (drivers.length > 0) projected.runway_drivers = drivers
  }
  if (value['runway_grounding_unmet'] === true) projected.runway_grounding_unmet = true
  if (value['quant_contradicts_runway'] === true) projected.quant_contradicts_runway = true
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getJudgment(valuation: Record<string, unknown>): ResearchCaseJudgmentProjection | undefined {
  const value = valuation['judgment']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseJudgmentProjection = {}
  const rubric_version = getString(value, 'rubric_version')
  if (rubric_version !== undefined) projected.rubric_version = rubric_version
  const moat = getJudgmentAxis(value['moat'])
  if (moat !== undefined) projected.moat = moat
  const runway = getJudgmentAxis(value['runway'])
  if (runway !== undefined) projected.runway = runway
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getBaseRateBurden(valuation: Record<string, unknown>): ResearchCaseBaseRateBurdenProjection | undefined {
  const value = valuation['base_rate_burden']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseBaseRateBurdenProjection = {}
  const version = getString(value, 'version')
  if (version !== undefined) projected.version = version
  const unmet_count = getNumber(value, 'unmet_count')
  if (unmet_count !== undefined) projected.unmet_count = unmet_count
  const rawFlags = value['flags']
  if (Array.isArray(rawFlags)) {
    const flags = rawFlags.filter(isRecord).map((f): ResearchCaseBaseRateFlagProjection => {
      const flag: ResearchCaseBaseRateFlagProjection = {}
      const base_rate_id = getString(f, 'base_rate_id')
      if (base_rate_id !== undefined) flag.base_rate_id = base_rate_id
      const claim = getString(f, 'claim')
      if (claim !== undefined) flag.claim = claim
      const status = getString(f, 'status')
      if (status !== undefined) flag.status = status
      const required = getNumber(f, 'required_structural_evidence')
      if (required !== undefined) flag.required_structural_evidence = required
      const count = getNumber(f, 'structural_evidence_count')
      if (count !== undefined) flag.structural_evidence_count = count
      return flag
    })
    if (flags.length > 0) projected.flags = flags
  }
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getCircleCompetence(payload: Record<string, unknown>): ResearchCaseCircleCompetenceProjection | undefined {
  const value = payload['circle_competence']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseCircleCompetenceProjection = {}
  const isPredictabilityEnum = (v: unknown): v is 'durably_predictable' | 'not_predictable' | 'uncertain' =>
    v === 'durably_predictable' || v === 'not_predictable' || v === 'uncertain'
  // Bug B: project the predictability enum. Legacy-tolerant — old events carry only the in_competence
  // boolean; keep reading it (and map a legacy true → durably_predictable-equivalent for display below).
  if (typeof value['in_competence'] === 'boolean') projected.in_competence = value['in_competence']
  if (isPredictabilityEnum(value['cashflow_predictability'])) projected.cashflow_predictability = value['cashflow_predictability']
  if (isPredictabilityEnum(value['model_claimed_predictability'])) projected.model_claimed_predictability = value['model_claimed_predictability']
  if (typeof value['model_claimed_in_competence'] === 'boolean') projected.model_claimed_in_competence = value['model_claimed_in_competence']
  const competence_reasoning = getString(value, 'competence_reasoning')
  if (competence_reasoning !== undefined) projected.competence_reasoning = competence_reasoning
  const reason = getString(value, 'reason')
  if (reason !== undefined) projected.reason = reason
  if (typeof value['circle_competence_unmet'] === 'boolean') projected.circle_competence_unmet = value['circle_competence_unmet']
  const drivers = value['cashflow_drivers']
  if (Array.isArray(drivers)) {
    const mapped = drivers.filter(isRecord).map((d): ResearchCaseCircleClaimProjection => {
      const c: ResearchCaseCircleClaimProjection = {}
      const driver = getString(d, 'driver')
      if (driver !== undefined) c.driver = driver
      const citation = getString(d, 'citation')
      if (citation !== undefined) c.citation = citation
      if (typeof d['grounded'] === 'boolean') c.grounded = d['grounded']
      return c
    })
    if (mapped.length > 0) projected.cashflow_drivers = mapped
  }
  const breakers = value['predictability_breakers']
  if (Array.isArray(breakers)) {
    const mapped = breakers.filter(isRecord).map((b): ResearchCaseCircleClaimProjection => {
      const c: ResearchCaseCircleClaimProjection = {}
      const breaker = getString(b, 'breaker')
      if (breaker !== undefined) c.breaker = breaker
      const citation = getString(b, 'citation')
      if (citation !== undefined) c.citation = citation
      if (typeof b['grounded'] === 'boolean') c.grounded = b['grounded']
      return c
    })
    if (mapped.length > 0) projected.predictability_breakers = mapped
  }
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getSourceDiscipline(payload: Record<string, unknown>): ResearchCaseSourceDisciplineProjection | undefined {
  const value = payload['source_discipline']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseSourceDisciplineProjection = {}
  const version = getString(value, 'version')
  if (version !== undefined) projected.version = version
  const rejected_count = getNumber(value, 'rejected_count')
  if (rejected_count !== undefined) projected.rejected_count = rejected_count
  const rawRejections = value['rejections']
  if (Array.isArray(rawRejections)) {
    const rejections = rawRejections.filter(isRecord).map((r): ResearchCaseSourceRejectionProjection => {
      const rej: ResearchCaseSourceRejectionProjection = {}
      const lane = getString(r, 'lane')
      if (lane !== undefined) rej.lane = lane
      const source_id = getString(r, 'source_id')
      if (source_id !== undefined) rej.source_id = source_id
      const category = getString(r, 'category')
      if (category !== undefined) rej.category = category
      const reason = getString(r, 'reason')
      if (reason !== undefined) rej.reason = reason
      return rej
    })
    if (rejections.length > 0) projected.rejections = rejections
  }
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getRedTeam(payload: Record<string, unknown>): ResearchCaseRedTeamProjection | undefined {
  const value = payload['red_team']
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseRedTeamProjection = {}
  const status = getString(value, 'status')
  if (status !== undefined) projected.status = status
  const reason = getString(value, 'reason')
  if (reason !== undefined) projected.reason = reason
  const strongest_bear_case = getString(value, 'strongest_bear_case')
  if (strongest_bear_case !== undefined) projected.strongest_bear_case = strongest_bear_case
  const moat_decay_scenario = getString(value, 'moat_decay_scenario')
  if (moat_decay_scenario !== undefined) projected.moat_decay_scenario = moat_decay_scenario
  const growth_credit_attack = getString(value, 'growth_credit_attack')
  if (growth_credit_attack !== undefined) projected.growth_credit_attack = growth_credit_attack
  const blindspots = getStringArray(value, 'shared_narrative_blindspots')
  if (blindspots !== undefined) projected.shared_narrative_blindspots = blindspots
  const uncited = getStringArray(value, 'uncited_objection_refs')
  if (uncited !== undefined) projected.uncited_objection_refs = uncited
  if (typeof value['objection_unaddressed'] === 'boolean') projected.objection_unaddressed = value['objection_unaddressed']

  const rawWeak = value['weakest_rubric_items']
  if (Array.isArray(rawWeak)) {
    const items = rawWeak.filter(isRecord).map((w) => {
      const item: { lane?: string; item?: string; why?: string } = {}
      const lane = getString(w, 'lane'); if (lane !== undefined) item.lane = lane
      const it = getString(w, 'item'); if (it !== undefined) item.item = it
      const why = getString(w, 'why'); if (why !== undefined) item.why = why
      return item
    }).filter((w) => Object.keys(w).length > 0)
    if (items.length > 0) projected.weakest_rubric_items = items
  }

  const rawObj = value['strongest_objection']
  if (isRecord(rawObj)) {
    const obj: { claim?: string; severity?: string; citations?: string[] } = {}
    const claim = getString(rawObj, 'claim'); if (claim !== undefined) obj.claim = claim
    const severity = getString(rawObj, 'severity'); if (severity !== undefined) obj.severity = severity
    const citations = getStringArray(rawObj, 'citations'); if (citations !== undefined) obj.citations = citations
    if (Object.keys(obj).length > 0) projected.strongest_objection = obj
  }

  const rawResp = value['synthesis_response']
  if (isRecord(rawResp)) {
    const resp: ResearchCaseRedTeamSynthesisResponseProjection = {}
    const mode = getString(rawResp, 'mode'); if (mode !== undefined) resp.mode = mode
    const text = getString(rawResp, 'text'); if (text !== undefined) resp.text = text
    const rawDown = rawResp['downgrade']
    if (isRecord(rawDown)) {
      const down: { dimension?: string; from?: string; to?: string } = {}
      const dimension = getString(rawDown, 'dimension'); if (dimension !== undefined) down.dimension = dimension
      const from = getString(rawDown, 'from'); if (from !== undefined) down.from = from
      const to = getString(rawDown, 'to'); if (to !== undefined) down.to = to
      if (Object.keys(down).length > 0) resp.downgrade = down
    }
    if (Object.keys(resp).length > 0) projected.synthesis_response = resp
  }

  return Object.keys(projected).length === 0 ? undefined : projected
}

function getAdmitRiskField(value: unknown): ResearchCaseAdmitRiskFieldProjection | undefined {
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseAdmitRiskFieldProjection = {}
  const level = getString(value, 'level')
  if (level !== undefined) projected.level = level
  const argument = getString(value, 'argument')
  if (argument !== undefined) projected.argument = argument
  const citations = getStringArray(value, 'citations')
  if (citations !== undefined) projected.citations = citations
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getAdmitCheapness(value: unknown): ResearchCaseAdmitCheapnessProjection | undefined {
  if (!isRecord(value)) return undefined
  const projected: ResearchCaseAdmitCheapnessProjection = {}
  const owner_earnings_yield = getNumber(value, 'owner_earnings_yield')
  if (owner_earnings_yield !== undefined) projected.owner_earnings_yield = owner_earnings_yield
  const ev = getNumber(value, 'ev')
  if (ev !== undefined) projected.ev = ev
  const cheap = getBoolean(value, 'cheap')
  if (cheap !== undefined) projected.cheap = cheap
  const reason = getString(value, 'reason')
  if (reason !== undefined) projected.reason = reason
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getAdmitRecommendation(
  payload: Record<string, unknown>,
  recordedAt: string,
): ResearchCaseAdmitRecommendationProjection {
  const projected: ResearchCaseAdmitRecommendationProjection = { recorded_at: recordedAt }
  const admit_judgment_id = getString(payload, 'admit_judgment_id')
  if (admit_judgment_id !== undefined) projected.admit_judgment_id = admit_judgment_id
  const uncertainty = getAdmitRiskField(payload['uncertainty'])
  if (uncertainty !== undefined) projected.uncertainty = uncertainty
  const permanent_loss_risk = getAdmitRiskField(payload['permanent_loss_risk'])
  if (permanent_loss_risk !== undefined) projected.permanent_loss_risk = permanent_loss_risk
  const impairment_bear_case = getString(payload, 'impairment_bear_case')
  if (impairment_bear_case !== undefined) projected.impairment_bear_case = impairment_bear_case
  const impairment_call = getString(payload, 'impairment_call')
  if (impairment_call !== undefined) projected.impairment_call = impairment_call
  const admittable = getBoolean(payload, 'admittable')
  if (admittable !== undefined) projected.admittable = admittable
  const reason = getString(payload, 'reason')
  if (reason !== undefined) projected.reason = reason
  const buy_below = getNumber(payload, 'buy_below')
  if (buy_below !== undefined) projected.buy_below = buy_below
  const cheapness = getAdmitCheapness(payload['cheapness'])
  if (cheapness !== undefined) projected.cheapness = cheapness
  // Phase 5 S2 — the concrete downside floor. Only projected when a floor was computed (status 'floor');
  // a `cannot_floor` result carries no number/basis, so the fields stay undefined.
  const downside_floor = payload['downside_floor']
  if (isRecord(downside_floor) && downside_floor['status'] === 'floor') {
    const floor_per_share = getNumber(downside_floor, 'floor_per_share')
    if (floor_per_share !== undefined) projected.downside_floor_per_share = floor_per_share
    const basis = getString(downside_floor, 'basis')
    if (basis !== undefined) projected.downside_floor_basis = basis
    const reliability = getString(downside_floor, 'reliability')
    if (reliability !== undefined) projected.downside_floor_reliability = reliability
  }
  const uncited_refs = getStringArray(payload, 'uncited_refs')
  if (uncited_refs !== undefined) projected.uncited_refs = uncited_refs
  return projected
}

function getSizingRecommendation(
  payload: Record<string, unknown>,
  recordedAt: string,
): ResearchCaseSizingRecommendationProjection {
  const projected: ResearchCaseSizingRecommendationProjection = { recorded_at: recordedAt }
  const sizing_recommendation_id = getString(payload, 'sizing_recommendation_id')
  if (sizing_recommendation_id !== undefined) projected.sizing_recommendation_id = sizing_recommendation_id
  const status = getString(payload, 'status')
  if (status === 'sizeable' || status === 'hold_in_savings' || status === 'cannot_size') {
    projected.status = status
  }
  const conviction_factor = getNumber(payload, 'conviction_factor')
  if (conviction_factor !== undefined) projected.conviction_factor = conviction_factor
  const target_weight = getNumber(payload, 'target_weight')
  if (target_weight !== undefined) projected.target_weight = target_weight
  const sizeable_value = getNumber(payload, 'sizeable_value')
  if (sizeable_value !== undefined) projected.sizeable_value = sizeable_value
  const binding_constraint = getString(payload, 'binding_constraint')
  if (binding_constraint !== undefined) projected.binding_constraint = binding_constraint
  const worst_case = payload['worst_case']
  if (isRecord(worst_case)) {
    const wc: ResearchCaseSizingWorstCaseProjection = {}
    const floor = getNumber(worst_case, 'downside_floor_per_share')
    if (floor !== undefined) wc.downside_floor_per_share = floor
    const basis = getString(worst_case, 'downside_floor_basis')
    if (basis !== undefined) wc.downside_floor_basis = basis
    const realistic = getNumber(worst_case, 'realistic_downside_per_share')
    if (realistic !== undefined) wc.realistic_downside_per_share = realistic
    const clusterFraction = getNumber(worst_case, 'aggregate_cluster_downside_fraction')
    if (clusterFraction !== undefined) wc.aggregate_cluster_downside_fraction = clusterFraction
    // Phase 7 S4 — carry the per-name cluster key/basis straight off the payload (persist-only).
    const clusterKey = getString(worst_case, 'cluster_key')
    if (clusterKey !== undefined) wc.cluster_key = clusterKey
    const clusterBasis = getString(worst_case, 'cluster_basis')
    if (clusterBasis !== undefined) wc.cluster_basis = clusterBasis
    projected.worst_case = wc
  }
  const ladder = payload['ladder']
  if (Array.isArray(ladder)) {
    const levels = ladder
      .filter(isRecord)
      .map((level): ResearchCaseSizingLadderLevelProjection => {
        const out: ResearchCaseSizingLadderLevelProjection = {}
        const id = getString(level, 'id')
        if (id !== undefined) out.id = id
        const fraction = getNumber(level, 'fraction')
        if (fraction !== undefined) out.fraction = fraction
        const triggerLabel = getString(level, 'trigger_label') ?? getString(level, 'trigger')
        if (triggerLabel !== undefined) out.trigger_label = triggerLabel
        const triggerPrice = getNumber(level, 'trigger_price_per_share') ?? getNumber(level, 'price_per_share')
        if (triggerPrice !== undefined) out.trigger_price_per_share = triggerPrice
        const buyPriceVersion = getString(level, 'buy_price_version')
        if (buyPriceVersion !== undefined) out.buy_price_version = buyPriceVersion
        return out
      })
    projected.ladder = levels
  }
  const caveats = getStringArray(payload, 'caveats')
  if (caveats !== undefined) projected.caveats = caveats
  const reason = getString(payload, 'reason')
  if (reason !== undefined) projected.reason = reason
  const expected_savings_return = getNumber(payload, 'expected_savings_return')
  if (expected_savings_return !== undefined) projected.expected_savings_return = expected_savings_return
  return projected
}

function getSellRecommendation(
  payload: Record<string, unknown>,
  recordedAt: string,
): ResearchCaseSellRecommendationProjection {
  const projected: ResearchCaseSellRecommendationProjection = { recorded_at: recordedAt }
  const decision_status = getString(payload, 'decision_status')
  if (
    decision_status === 'sell_review'
    || decision_status === 'hold'
    || decision_status === 'escalate_review'
    || decision_status === 'cannot_assess'
  ) {
    projected.decision_status = decision_status
  }
  const reason_code = getString(payload, 'reason_code')
  if (reason_code !== undefined) projected.reason_code = reason_code
  const trigger = getString(payload, 'trigger')
  if (trigger !== undefined) projected.trigger = trigger
  const impairment_call = getString(payload, 'impairment_call')
  if (impairment_call !== undefined) projected.impairment_call = impairment_call
  const minimum_hold_decision = getString(payload, 'minimum_hold_decision')
  if (minimum_hold_decision !== undefined) projected.minimum_hold_decision = minimum_hold_decision
  const frozen_oe_ps = getNumber(payload, 'frozen_oe_ps')
  if (frozen_oe_ps !== undefined) projected.frozen_oe_ps = frozen_oe_ps
  // LEGACY TOLERANCE: read the new frozen reference first, falling back to the old frozen_iv so old sell
  // observations still project.
  const frozen_reference_fair_value =
    getNumber(payload, 'frozen_reference_fair_value') ?? getNumber(payload, 'frozen_iv')
  if (frozen_reference_fair_value !== undefined) {
    projected.frozen_reference_fair_value = frozen_reference_fair_value
  }
  const worst_case = payload['worst_case']
  if (isRecord(worst_case)) {
    const wc: ResearchCaseSellWorstCaseProjection = {}
    const floor = getNumber(worst_case, 'downside_floor_per_share')
    if (floor !== undefined) wc.downside_floor_per_share = floor
    const basis = getString(worst_case, 'downside_floor_basis')
    if (basis !== undefined) wc.downside_floor_basis = basis
    const reliability = getString(worst_case, 'downside_floor_reliability')
    if (reliability !== undefined) wc.downside_floor_reliability = reliability
    const realistic = getNumber(worst_case, 'realistic_downside')
    if (realistic !== undefined) wc.realistic_downside = realistic
    projected.worst_case = wc
  }
  const biasCaveats = payload['bias_caveats']
  if (Array.isArray(biasCaveats)) {
    const caveats = biasCaveats
      .filter(isRecord)
      .map((caveat): ResearchCaseSellBiasCaveatProjection => {
        const out: ResearchCaseSellBiasCaveatProjection = {}
        const kind = getString(caveat, 'kind')
        if (kind !== undefined) out.kind = kind
        const message = getString(caveat, 'message')
        if (message !== undefined) out.message = message
        return out
      })
      .filter((caveat) => Object.keys(caveat).length > 0)
    projected.bias_caveats = caveats
  }
  const requires_human_signoff = getBoolean(payload, 'requires_human_signoff')
  if (requires_human_signoff !== undefined) projected.requires_human_signoff = requires_human_signoff
  return projected
}

function getValuation(payload: Record<string, unknown>): ResearchCaseValuationProjection | undefined {
  const value = payload['valuation']
  if (!isRecord(value)) {
    return undefined
  }

  const projected: ResearchCaseValuationProjection = {}
  const circle_competence_unmet = typeof value['circle_competence_unmet'] === 'boolean' ? value['circle_competence_unmet'] : undefined
  if (circle_competence_unmet !== undefined) projected.circle_competence_unmet = circle_competence_unmet
  const outside_circle = typeof value['outside_circle'] === 'boolean' ? value['outside_circle'] : undefined
  if (outside_circle !== undefined) projected.outside_circle = outside_circle
  const moat_class = getString(value, 'moat_class')
  if (moat_class !== undefined) projected.moat_class = moat_class
  const moat_passes_gate = typeof value['moat_passes_gate'] === 'boolean' ? value['moat_passes_gate'] : undefined
  if (moat_passes_gate !== undefined) projected.moat_passes_gate = moat_passes_gate
  const runway = getString(value, 'runway')
  if (runway !== undefined) projected.runway = runway
  const runway_exceptional = typeof value['runway_exceptional'] === 'boolean' ? value['runway_exceptional'] : undefined
  if (runway_exceptional !== undefined) projected.runway_exceptional = runway_exceptional
  const discount_rate = getNumber(value, 'discount_rate')
  if (discount_rate !== undefined) projected.discount_rate = discount_rate
  const discountInputsRaw = value['discount_inputs']
  if (discountInputsRaw !== null && typeof discountInputsRaw === 'object') {
    const di = discountInputsRaw as Record<string, unknown>
    const ten_year_treasury = getNumber(di, 'ten_year_treasury')
    const ten_year_treasury_basis = getString(di, 'ten_year_treasury_basis')
    const equity_premium = getNumber(di, 'equity_premium')
    projected.discount_inputs = {
      ...(ten_year_treasury !== undefined ? { ten_year_treasury } : {}),
      ...(ten_year_treasury_basis !== undefined ? { ten_year_treasury_basis } : {}),
      ...(equity_premium !== undefined ? { equity_premium } : {}),
    }
  }
  const growth_assumptions = getString(value, 'growth_assumptions')
  if (growth_assumptions !== undefined) projected.growth_assumptions = growth_assumptions
  const growth_rate = getNumber(value, 'growth_rate')
  if (growth_rate !== undefined) projected.growth_rate = growth_rate
  const demonstrated_growth_reference = getNumber(value, 'demonstrated_growth_reference')
  if (demonstrated_growth_reference !== undefined) projected.demonstrated_growth_reference = demonstrated_growth_reference
  const growth_basis = getString(value, 'growth_basis')
  if (growth_basis !== undefined) projected.growth_basis = growth_basis
  // Phase 7 S4 — data-completeness evidence (item 11): carry-through of the demonstrated-growth measure's
  // window/points/method already on the event payload (persist-only; never recomputed in the projector).
  const growth_window_years = getNumber(value, 'growth_window_years')
  if (growth_window_years !== undefined) projected.growth_window_years = growth_window_years
  const growth_points_used = getNumber(value, 'growth_points_used')
  if (growth_points_used !== undefined) projected.growth_points_used = growth_points_used
  const growth_method = getString(value, 'growth_method')
  if (growth_method !== undefined) projected.growth_method = growth_method
  const growth_above_gdp = getBoolean(value, 'growth_above_gdp')
  if (growth_above_gdp !== undefined) projected.growth_above_gdp = growth_above_gdp
  const growth_cap_binds = getBoolean(value, 'growth_cap_binds')
  if (growth_cap_binds !== undefined) projected.growth_cap_binds = growth_cap_binds
  const terminal_growth_rate = getNumber(value, 'terminal_growth_rate')
  if (terminal_growth_rate !== undefined) projected.terminal_growth_rate = terminal_growth_rate
  const roic = getNumber(value, 'roic')
  if (roic !== undefined) projected.roic = roic
  const incremental_roic = getNumber(value, 'incremental_roic')
  if (incremental_roic !== undefined) projected.incremental_roic = incremental_roic
  const reinvestment_rate = getNumber(value, 'reinvestment_rate')
  if (reinvestment_rate !== undefined) projected.reinvestment_rate = reinvestment_rate
  const owner_earnings_bridge = getOwnerEarningsBridgeProjection(value)
  if (owner_earnings_bridge !== undefined) projected.owner_earnings_bridge = owner_earnings_bridge
  const normalized_owner_earnings_per_share = getNumber(value, 'normalized_owner_earnings_per_share')
  if (normalized_owner_earnings_per_share !== undefined) projected.normalized_owner_earnings_per_share = normalized_owner_earnings_per_share
  const fair_value_per_share = getNumber(value, 'fair_value_per_share')
  if (fair_value_per_share !== undefined) projected.fair_value_per_share = fair_value_per_share
  const implied_multiple = getNumber(value, 'implied_multiple')
  if (implied_multiple !== undefined) projected.implied_multiple = implied_multiple
  // NOTE: the legacy margin_of_safety / margin_of_safety_applied / margin_of_safety_widening_reasons fields
  // (the retired MoS-as-price-haircut machinery) are intentionally NOT projected. Legacy events that still
  // carry them are tolerated — the fields are simply ignored (conservatism now lives in the required gap).
  const terminal_value_pct_of_iv = getNumber(value, 'terminal_value_pct_of_iv')
  if (terminal_value_pct_of_iv !== undefined) projected.terminal_value_pct_of_iv = terminal_value_pct_of_iv
  const cap_exceeded = getBoolean(value, 'cap_exceeded')
  if (cap_exceeded !== undefined) projected.cap_exceeded = cap_exceeded
  // Founding-risk fix: legacy-tolerant projection of the synthesis own-grounding fail-closed flag + reason.
  const synthesis_grounding_unmet = getBoolean(value, 'synthesis_grounding_unmet')
  if (synthesis_grounding_unmet !== undefined) projected.synthesis_grounding_unmet = synthesis_grounding_unmet
  const synthesis_grounding_reason = getString(value, 'synthesis_grounding_reason')
  if (synthesis_grounding_reason !== undefined) projected.synthesis_grounding_reason = synthesis_grounding_reason
  // Moat-gate fix: legacy-tolerant projection of the moat ungrounded-vs-narrow fail-closed flag + reason.
  const moat_grounding_unmet = getBoolean(value, 'moat_grounding_unmet')
  if (moat_grounding_unmet !== undefined) projected.moat_grounding_unmet = moat_grounding_unmet
  const moat_grounding_reason = getString(value, 'moat_grounding_reason')
  if (moat_grounding_reason !== undefined) projected.moat_grounding_reason = moat_grounding_reason
  const buy_price_per_share = getNumber(value, 'buy_price_per_share')
  if (buy_price_per_share !== undefined) projected.buy_price_per_share = buy_price_per_share
  const fair_value_range = getString(value, 'fair_value_range')
  if (fair_value_range !== undefined) projected.fair_value_range = fair_value_range
  const fair_value_range_basis = getString(value, 'fair_value_range_basis')
  if (fair_value_range_basis !== undefined) projected.fair_value_range_basis = fair_value_range_basis
  const market_implied_growth = getNumber(value, 'market_implied_growth')
  if (market_implied_growth !== undefined) projected.market_implied_growth = market_implied_growth
  const valuation_cap_binding = getBoolean(value, 'valuation_cap_binding')
  if (valuation_cap_binding !== undefined) projected.valuation_cap_binding = valuation_cap_binding
  const incremental_roic_basis = getString(value, 'incremental_roic_basis')
  if (incremental_roic_basis !== undefined) projected.incremental_roic_basis = incremental_roic_basis
  // RELIGHTENED DECISION (R1): the model's buy-below + the deterministic flag-only sanity layer.
  const proposed_buy_below = getNumber(value, 'proposed_buy_below')
  if (proposed_buy_below !== undefined) projected.proposed_buy_below = proposed_buy_below
  const reference_fair_value = getNumber(value, 'reference_fair_value')
  if (reference_fair_value !== undefined) projected.reference_fair_value = reference_fair_value
  const in_buy_zone = getBoolean(value, 'in_buy_zone')
  if (in_buy_zone !== undefined) projected.in_buy_zone = in_buy_zone
  const implied_exit_multiple = getNumber(value, 'implied_exit_multiple')
  if (implied_exit_multiple !== undefined) projected.implied_exit_multiple = implied_exit_multiple
  const sanity_flags = getStringArray(value, 'sanity_flags')
  if (sanity_flags !== undefined) projected.sanity_flags = sanity_flags
  const valuation_reasoning = getValuationReasoning(value)
  if (valuation_reasoning !== undefined) projected.valuation_reasoning = valuation_reasoning
  // LEGACY (R1 tolerates): the retired band verdict_state still projects from old events (no throw); new
  // runs no longer emit it.
  const verdict_state = getVerdictState(value)
  if (verdict_state !== undefined) projected.verdict_state = verdict_state
  const judgment = getJudgment(value)
  if (judgment !== undefined) projected.judgment = judgment
  const base_rate_burden = getBaseRateBurden(value)
  if (base_rate_burden !== undefined) projected.base_rate_burden = base_rate_burden
  const value_basis = getString(value, 'value_basis')
  if (value_basis !== undefined) projected.value_basis = value_basis
  const bridge_basis = getString(value, 'bridge_basis')
  if (bridge_basis !== undefined) projected.bridge_basis = bridge_basis
  const bridge_fiscal_year = getNumber(value, 'bridge_fiscal_year')
  if (bridge_fiscal_year !== undefined) projected.bridge_fiscal_year = bridge_fiscal_year
  const bridge_source_id = getString(value, 'bridge_source_id')
  if (bridge_source_id !== undefined) projected.bridge_source_id = bridge_source_id
  const maintenance_capex_proxy_reference = getNumber(value, 'maintenance_capex_proxy_reference')
  if (maintenance_capex_proxy_reference !== undefined) projected.maintenance_capex_proxy_reference = maintenance_capex_proxy_reference

  return Object.keys(projected).length === 0 ? undefined : projected
}

function getShariahFinancial(payload: Record<string, unknown>): ResearchCaseShariahFinancialProjection | undefined {
  const value = payload['shariah_financial']
  if (!isRecord(value)) {
    return undefined
  }
  const projected: ResearchCaseShariahFinancialProjection = {}
  const debt_ratio = getNumber(value, 'debt_ratio')
  if (debt_ratio !== undefined) projected.debt_ratio = debt_ratio
  const cash_securities_ratio = getNumber(value, 'cash_securities_ratio')
  if (cash_securities_ratio !== undefined) projected.cash_securities_ratio = cash_securities_ratio
  const impermissible_income_pct = getNumber(value, 'impermissible_income_pct')
  if (impermissible_income_pct !== undefined) projected.impermissible_income_pct = impermissible_income_pct
  const verdict = getString(value, 'verdict')
  if (verdict !== undefined) projected.verdict = verdict
  const purification_pct = getNumber(value, 'purification_pct')
  if (purification_pct !== undefined) projected.purification_pct = purification_pct
  const market_cap = getNumber(value, 'market_cap')
  if (market_cap !== undefined) projected.market_cap = market_cap
  const market_cap_basis = getString(value, 'market_cap_basis')
  if (market_cap_basis !== undefined) projected.market_cap_basis = market_cap_basis
  const bridge_source_fiscal_year = getNumber(value, 'bridge_source_fiscal_year')
  if (bridge_source_fiscal_year !== undefined) projected.bridge_source_fiscal_year = bridge_source_fiscal_year
  return Object.keys(projected).length === 0 ? undefined : projected
}

function getOwnerEarningsValuation(payload: Record<string, unknown>): ResearchCaseOwnerEarningsValuationProjection | undefined {
  const value = payload.owner_earnings_valuation
  if (!isRecord(value)) {
    return undefined
  }

  const projected: ResearchCaseOwnerEarningsValuationProjection = {}
  const stringKeys = [
    'summary',
    'normalized_owner_earnings',
    'fair_value_range',
    'buy_price_range',
    'margin_of_safety',
    'confidence',
  ] as const
  for (const key of stringKeys) {
    const stringValue = getString(value, key)
    if (stringValue !== undefined) {
      projected[key] = stringValue
    }
  }
  const assumptions = getStringArray(value, 'assumptions')
  if (assumptions !== undefined) {
    projected.assumptions = assumptions
  }
  const sources = getStringArray(value, 'sources')
  if (sources !== undefined) {
    projected.sources = sources
  }
  const caveats = getStringArray(value, 'caveats')
  if (caveats !== undefined) {
    projected.caveats = caveats
  }

  return Object.keys(projected).length === 0 ? undefined : projected
}

function applyString(
  target: ResearchCaseProjection,
  key: keyof Pick<
    ResearchCaseProjection,
    | 'company_id'
    | 'ticker'
    | 'candidate_id'
    | 'strategy_id'
    | 'strategy_version'
    | 'quick_screen_id'
    | 'screening_result'
    | 'business_quality'
    | 'moat'
    | 'management_capital_allocation'
    | 'financial_quality'
    | 'valuation_sanity'
    | 'deep_dive_id'
    | 'finding_id'
    | 'specialist_lane'
    | 'synthesis_id'
    | 'decision_id'
    | 'investment_verdict'
    | 'strategy_compliance'
    | 'shariah_status'
    | 'valuation_status'
    | 'next_required_action'
    | 'key_wrong_assumption'
    | 'decision'
    | 'reason'
    | 'thesis_summary'
    | 'evidence_summary'
    | 'valuation_rationale'
    | 'shariah_rationale'
    | 'shariah_sector_status'
    | 'confidence'
    | 'supersedes_research_case_id'
  >,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function applyBoolean(
  target: ResearchCaseProjection,
  key: keyof Pick<ResearchCaseProjection, 'user_approved'>,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function applyStringArray(
  target: ResearchCaseProjection,
  key: keyof Pick<ResearchCaseProjection, 'red_flags' | 'caveats' | 'risks' | 'open_questions' | 'thesis_break_triggers'>,
  value: string[] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function recordSpecialistFinding(
  target: ResearchCaseProjection,
  payload: Record<string, unknown>,
): void {
  const findingId = getString(payload, 'finding_id')
  if (findingId === undefined) {
    return
  }

  const finding: ResearchCaseSpecialistFindingProjection = {
    finding_id: findingId,
  }
  const deepDiveId = getString(payload, 'deep_dive_id')
  const specialistLane = getString(payload, 'specialist_lane')
  const findingSummary = getString(payload, 'finding_summary')
  const confidence = getString(payload, 'confidence')
  const caveats = getStringArray(payload, 'caveats')
  const sourceIds = getStringArray(payload, 'source_ids')
  const providerRunId = getString(payload, 'provider_run_id')
  const ownerEarningsValuation = getOwnerEarningsValuation(payload)

  if (deepDiveId !== undefined) {
    finding.deep_dive_id = deepDiveId
  }
  if (specialistLane !== undefined) {
    finding.specialist_lane = specialistLane
  }
  if (findingSummary !== undefined) {
    finding.finding_summary = findingSummary
  }
  if (confidence !== undefined) {
    finding.confidence = confidence
  }
  if (caveats !== undefined) {
    finding.caveats = caveats
  }
  if (sourceIds !== undefined) {
    finding.source_ids = sourceIds
  }
  if (providerRunId !== undefined) {
    finding.provider_run_id = providerRunId
  }
  if (ownerEarningsValuation !== undefined) {
    finding.owner_earnings_valuation = ownerEarningsValuation
    target.owner_earnings_valuation = ownerEarningsValuation
  }

  const previousFindings = target.specialist_findings ?? []
  target.specialist_findings = [
    ...previousFindings.filter((previousFinding) => previousFinding.finding_id !== findingId),
    finding,
  ]
}

function researchCaseIdFor(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): string | undefined {
  if (event.aggregate_type === 'research_case') {
    return event.aggregate_id
  }

  return getString(payload, 'research_case_id') ?? event.correlation_id
}

function upsertCase(
  researchCases: Map<string, ResearchCaseProjection>,
  researchCaseId: string,
  stage: ResearchCaseStage,
  updatedAt: string,
): ResearchCaseProjection {
  const existing = researchCases.get(researchCaseId)
  if (existing !== undefined) {
    existing.stage = stage
    existing.updated_at = updatedAt
    return existing
  }

  const created: ResearchCaseProjection = {
    research_case_id: researchCaseId,
    version: 1,
    superseded: false,
    stage,
    updated_at: updatedAt,
  }
  researchCases.set(researchCaseId, created)
  return created
}

export function projectResearchCases(events: LedgerEventEnvelope<unknown>[]): ResearchCaseProjection[] {
  const researchCases = new Map<string, ResearchCaseProjection>()

  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'research_case_created') {
      const researchCase = upsertCase(researchCases, event.aggregate_id, 'discovered', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      const version = getNumber(event.payload, 'version')
      if (version !== undefined) {
        researchCase.version = version
      }
      applyString(researchCase, 'supersedes_research_case_id', getString(event.payload, 'supersedes_research_case_id'))
      continue
    }

    if (event.event_type === 'quick_screen_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const screeningResult = getString(event.payload, 'screening_result')
      const stage = screeningResult === 'reject' ? 'rejected' : screeningResult === 'pass' ? 'pass' : 'quick_screened'
      const researchCase = upsertCase(researchCases, researchCaseId, stage, event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'quick_screen_id', getString(event.payload, 'quick_screen_id'))
      applyString(researchCase, 'screening_result', screeningResult)
      applyString(researchCase, 'business_quality', getString(event.payload, 'business_quality'))
      applyString(researchCase, 'moat', getString(event.payload, 'moat'))
      applyString(researchCase, 'management_capital_allocation', getString(event.payload, 'management_capital_allocation'))
      applyString(researchCase, 'financial_quality', getString(event.payload, 'financial_quality'))
      applyString(researchCase, 'valuation_sanity', getString(event.payload, 'valuation_sanity'))
      applyString(researchCase, 'shariah_status', getString(event.payload, 'shariah_status'))
      applyStringArray(researchCase, 'red_flags', getStringArray(event.payload, 'red_flags'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      applyString(researchCase, 'next_required_action', getString(event.payload, 'summary'))
      continue
    }

    if (event.event_type === 'deep_dive_approval_pending') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      // Only set stage to awaiting_deep_dive_approval if no queued_for_deep_dive or decision has happened yet.
      // (If the deep dive was subsequently triggered, the queued_for_deep_dive event supersedes this.)
      const existing = researchCases.get(researchCaseId)
      const alreadyProgressed = existing !== undefined && (
        existing.stage === 'queued_for_deep_dive'
        || existing.stage === 'deep_dive_started'
        || existing.stage === 'specialist_finding_recorded'
        || existing.stage === 'deep_dive_in_progress'
        || existing.stage === 'deep_dive_synthesis_drafted'
        || existing.stage === 'deep_dive_completed'
        || existing.stage === 'deep_dive_complete'
        || existing.stage === 'analysis_drafted'
        || existing.stage === 'decision_drafted'
        || existing.stage === 'decision_pending'
        || existing.stage === 'watchlist_draft'
        || existing.stage === 'watchlist'
        || existing.stage === 'holding'
        || existing.stage === 'rejected'
        || existing.stage === 'pass'
      )
      if (!alreadyProgressed) {
        upsertCase(researchCases, researchCaseId, 'awaiting_deep_dive_approval', event.created_at)
      }
      continue
    }

    if (event.event_type === 'queued_for_deep_dive') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'queued_for_deep_dive', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      continue
    }

    if (event.event_type === 'deep_dive_started') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_started', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      continue
    }

    if (event.event_type === 'specialist_finding_recorded') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'specialist_finding_recorded', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'finding_id', getString(event.payload, 'finding_id'))
      applyString(researchCase, 'specialist_lane', getString(event.payload, 'specialist_lane'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      recordSpecialistFinding(researchCase, event.payload)
      // Fallback authoring-provider attribution: a finding's provider author counts only when the
      // canonical analysis author has not already set it (the analysis event always wins).
      if (researchCase.authored_by_provider_id === undefined && event.actor_type === 'provider' && event.actor_id !== undefined) {
        researchCase.authored_by_provider_id = event.actor_id
      }
      continue
    }

    if (event.event_type === 'circle_competence_judged') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }
      // The judgment never advances the stage on its own — the analysis/decision events that follow set the
      // terminal (set-aside) or proceeding stage. Preserve the existing stage; just attach the judgment.
      const existing = researchCases.get(researchCaseId)
      const researchCase = upsertCase(researchCases, researchCaseId, existing?.stage ?? 'circle_competence_judged', event.created_at)
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      const circleCompetence = getCircleCompetence({ circle_competence: event.payload })
      if (circleCompetence !== undefined) {
        researchCase.circle_competence = circleCompetence
      }
      continue
    }

    if (event.event_type === 'deep_dive_synthesis_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_synthesis_drafted', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'synthesis_id', getString(event.payload, 'synthesis_id'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      continue
    }

    if (event.event_type === 'deep_dive_completed') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_completed', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'synthesis_id', getString(event.payload, 'synthesis_id'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      continue
    }

    if (event.event_type === 'strategy_decision_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'decision_pending', event.created_at)
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'decision_id', getString(event.payload, 'decision_id') ?? event.aggregate_id)
      applyString(researchCase, 'decision', getString(event.payload, 'decision'))
      applyString(researchCase, 'reason', getString(event.payload, 'decision_summary'))
      applyBoolean(researchCase, 'user_approved', false)
      continue
    }

    if (event.event_type === 'buffett_munger_analysis_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'analysis_drafted', event.created_at)
      // Canonical authoring-provider attribution (preferred over any specialist-finding fallback): the
      // analysis event's provider author is who actually authored the run. Overwrites the finding fallback.
      if (event.actor_type === 'provider' && event.actor_id !== undefined) {
        researchCase.authored_by_provider_id = event.actor_id
      }
      applyString(researchCase, 'investment_verdict', getString(event.payload, 'investment_verdict'))
      applyString(researchCase, 'strategy_compliance', getString(event.payload, 'strategy_compliance'))
      applyString(researchCase, 'shariah_status', getString(event.payload, 'shariah_status'))
      applyString(researchCase, 'valuation_status', getString(event.payload, 'valuation_status'))
      applyString(researchCase, 'next_required_action', getString(event.payload, 'next_required_action'))
      // MARGIN-OF-SAFETY AUDIT SURFACE — legacy-tolerant guarded reads (absent on old analysis events).
      applyString(researchCase, 'key_wrong_assumption', getString(event.payload, 'key_wrong_assumption'))
      applyStringArray(researchCase, 'thesis_break_triggers', getStringArray(event.payload, 'thesis_break_triggers'))
      // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) + Guard-2 incoherence flag. Distinct field name so
      // the retired legacy `margin_of_safety` haircut string never collides; old events simply project nothing.
      const marginOfSafetyJudgment = getMarginOfSafetyJudgment(event.payload, 'margin_of_safety_judgment')
      if (marginOfSafetyJudgment !== undefined) researchCase.margin_of_safety_judgment = marginOfSafetyJudgment
      const marginOfSafetyMoatUngrounded = getBoolean(event.payload, 'margin_of_safety_moat_ungrounded')
      if (marginOfSafetyMoatUngrounded !== undefined) researchCase.margin_of_safety_moat_ungrounded = marginOfSafetyMoatUngrounded
      const valuation = getValuation(event.payload)
      if (valuation !== undefined) {
        researchCase.valuation = valuation
      }
      const circleCompetence = getCircleCompetence(event.payload)
      if (circleCompetence !== undefined) {
        researchCase.circle_competence = circleCompetence
      }
      const shariahFinancial = getShariahFinancial(event.payload)
      if (shariahFinancial !== undefined) {
        researchCase.shariah_financial = shariahFinancial
      }
      applyString(researchCase, 'shariah_sector_status', getString(event.payload, 'shariah_sector_status'))
      const sourceDiscipline = getSourceDiscipline(event.payload)
      if (sourceDiscipline !== undefined) {
        researchCase.source_discipline = sourceDiscipline
      }
      const redTeam = getRedTeam(event.payload)
      if (redTeam !== undefined) {
        researchCase.red_team = redTeam
      }
      continue
    }

    if (event.event_type === 'admit_judgment_recorded') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      // OBSERVATION, not an admit: do NOT change the stage — recording the recommendation never moves the
      // name to watchlist/holding. Preserve the existing stage (or fall back to 'discovered' for an
      // out-of-order event) so the recommendation can attach without transitioning the case.
      const existing = researchCases.get(researchCaseId)
      const researchCase = upsertCase(researchCases, researchCaseId, existing?.stage ?? 'discovered', event.created_at)
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      // Newest recorded recommendation wins (recomputed fresh on-demand): events are applied in order, so
      // the last admit_judgment_recorded overwrites the field.
      researchCase.admit_recommendation = getAdmitRecommendation(event.payload, event.created_at)
      continue
    }

    if (event.event_type === 'sizing_recommendation_recorded') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      // OBSERVATION, not a buy: do NOT change the stage — recording a sizing recommendation never opens a
      // holding. Preserve the existing stage (or fall back to 'discovered' for an out-of-order event) so
      // the recommendation can attach without transitioning the case.
      const existing = researchCases.get(researchCaseId)
      const researchCase = upsertCase(researchCases, researchCaseId, existing?.stage ?? 'discovered', event.created_at)
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      // Newest recorded recommendation wins (recomputed fresh on-demand): events are applied in order, so
      // the last sizing_recommendation_recorded overwrites the field.
      researchCase.sizing_recommendation = getSizingRecommendation(event.payload, event.created_at)
      continue
    }

    if (event.event_type === 'holding_sell_review_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      // OBSERVATION, not a close: do NOT change the stage — recording a sell decision NEVER exits the
      // holding (the close stays the human-authored closeHolding transition). Preserve the existing stage
      // (a sell decision only ever applies to a HELD name; fall back to 'holding' for an out-of-order
      // event) so the recommendation can attach without transitioning the case.
      const existing = researchCases.get(researchCaseId)
      const researchCase = upsertCase(researchCases, researchCaseId, existing?.stage ?? 'holding', event.created_at)
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      // Newest recorded recommendation wins (recomputed fresh on-demand): events are applied in order, so
      // the last holding_sell_review_drafted overwrites the field.
      researchCase.sell_recommendation = getSellRecommendation(event.payload, event.created_at)
      continue
    }

    if (event.event_type === 'decision_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'decision_drafted', event.created_at)
      applyString(researchCase, 'decision_id', getString(event.payload, 'decision_id') ?? event.aggregate_id)
      applyString(researchCase, 'decision', getString(event.payload, 'decision'))
      applyBoolean(researchCase, 'user_approved', getBoolean(event.payload, 'user_approved'))
      applyString(researchCase, 'reason', getString(event.payload, 'reason'))
      applyString(researchCase, 'thesis_summary', getString(event.payload, 'thesis_summary'))
      applyString(researchCase, 'evidence_summary', getString(event.payload, 'evidence_summary'))
      applyString(researchCase, 'valuation_rationale', getString(event.payload, 'valuation_rationale'))
      applyString(researchCase, 'shariah_rationale', getString(event.payload, 'shariah_rationale'))
      applyStringArray(researchCase, 'risks', getStringArray(event.payload, 'risks'))
      applyStringArray(researchCase, 'open_questions', getStringArray(event.payload, 'open_questions'))
      continue
    }

    if (event.event_type === 'watchlist_draft_created') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'watchlist_draft', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyBoolean(researchCase, 'user_approved', getBoolean(event.payload, 'user_approved'))
      // Mirror the sign-off audit onto the case (auditable; verbatim, never scored). NEW events carry the
      // harness-marshaled `checklist_audit`; LEGACY ledgers carry per-item `checklist_answers` — read both
      // so existing ledgers still project.
      const checklistAudit = getChecklistAudit(event.payload, 'checklist_audit')
      if (checklistAudit !== undefined) {
        researchCase.checklist_audit = checklistAudit
      }
      const checklistAnswers = getChecklistAnswers(event.payload, 'checklist_answers')
      if (checklistAnswers !== undefined) {
        researchCase.checklist_answers = checklistAnswers
      }
      continue
    }

    if (event.event_type === 'watchlist_draft_confirmed') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'watchlist', event.created_at)
      applyBoolean(researchCase, 'user_approved', true)
      continue
    }

    if (event.event_type === 'holding_opened') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'holding', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyBoolean(researchCase, 'user_approved', true)
    }
  }

  // Compute superseded: a case is superseded if any other case has supersedes_research_case_id pointing to it.
  const supersededIds = new Set<string>()
  for (const researchCase of researchCases.values()) {
    if (researchCase.supersedes_research_case_id !== undefined) {
      supersededIds.add(researchCase.supersedes_research_case_id)
    }
  }
  for (const researchCase of researchCases.values()) {
    researchCase.superseded = supersededIds.has(researchCase.research_case_id)
  }

  return [...researchCases.values()]
}

/**
 * Returns all versions of research cases for a given ticker, ordered by version ascending.
 * The last entry (highest version) is the canonical latest.
 */
export function projectResearchCaseVersionsForTicker(events: LedgerEventEnvelope<unknown>[], ticker: string): ResearchCaseProjection[] {
  const all = projectResearchCases(events)
  return all
    .filter((researchCase) => researchCase.ticker?.toUpperCase() === ticker.toUpperCase())
    .sort((a, b) => a.version - b.version)
}

/**
 * Returns the latest non-superseded research case for the given ticker, or undefined if none exists.
 */
export function findLatestResearchCaseForTicker(events: LedgerEventEnvelope<unknown>[], ticker: string): ResearchCaseProjection | undefined {
  const versions = projectResearchCaseVersionsForTicker(events, ticker)
  // The latest version is the one with the highest version number and not superseded
  // (which by definition is the last in sorted order since superseded means a newer one points to it)
  const nonSuperseded = versions.filter((researchCase) => !researchCase.superseded)
  if (nonSuperseded.length === 0) {
    return undefined
  }
  // Return the highest version among non-superseded (should be exactly one in normal flow)
  return nonSuperseded.reduce((best, current) => current.version > best.version ? current : best)
}
