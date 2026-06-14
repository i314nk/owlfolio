import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseStage =
  | 'discovered'
  | 'quick_screened'
  | 'awaiting_deep_dive_approval'
  | 'queued_for_deep_dive'
  | 'deep_dive_started'
  | 'specialist_finding_recorded'
  | 'deep_dive_in_progress'
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
 * Price → verdict band for a gate-clean name (valuation-recalibration-spec §2).
 *   BUY-WINDOW  — price ≤ buy price
 *   WATCH-FAIR  — buy price < price ≤ fair value (human-discretion zone; never a harness buy signal)
 *   WATCH       — price > fair value
 */
export type ResearchCaseVerdictStateProjection = {
  state?: string
  /** Discount to fair value (%), present for WATCH-FAIR. */
  discount_to_fv_pct?: number
  implied_multiple?: number
  note?: string
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
  rubric_scores?: { id: string; score: number }[]
  violations?: string[]
  anchor_note?: string
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

export type ResearchCaseValuationProjection = {
  moat_class?: string
  moat_passes_gate?: boolean
  /** Reinvestment runway axis (separate from moat): proven | limited | none. */
  runway?: string
  runway_exceptional?: boolean
  discount_rate?: number
  /** Discount provenance (Phase 1.4): the 10y Treasury + uniform equity premium that formed discount_rate. */
  discount_inputs?: { ten_year_treasury?: number; ten_year_treasury_basis?: string; equity_premium?: number }
  growth_assumptions?: string
  growth_rate?: number
  /** Provenance of the growth path (Phase 1.3): 'edgar_oe_cagr' (demonstrated CAGR) or 'none' (no-growth floor). */
  growth_basis?: string
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
  fair_value_per_share?: number
  /** Implied multiple = fair_value_per_share / OE_ps. */
  implied_multiple?: number
  margin_of_safety?: number
  /** Terminal (Gordon) value as a % of intrinsic value (Phase 1.5) — flagged + widens MoS when > 0.65. */
  terminal_value_pct_of_iv?: number
  /** Phase 1.6: fair value exceeded the 18× OE sanity-flag threshold — surfaced, not truncated. */
  cap_exceeded?: boolean
  /** Phase 1.7: the end-stage margin of safety actually applied (base floor + widening). */
  margin_of_safety_applied?: number
  /** Phase 1.6: the reasons the single MoS knob widened beyond the moat base floor. */
  margin_of_safety_widening_reasons?: string[]
  buy_price_per_share?: number
  /** Provenance of the incremental ROIC used: 'sec_edgar' (computed from the series) or 'model_proposed'. */
  incremental_roic_basis?: string
  /**
   * Price → verdict band (valuation-recalibration-spec §2): BUY-WINDOW | WATCH-FAIR | WATCH.
   * WATCH-FAIR is the "wonderful at fair" human-discretion zone — never a harness buy signal.
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

export type ResearchCaseProjection = {
  research_case_id: string
  version: number
  supersedes_research_case_id?: string
  superseded: boolean
  stage: ResearchCaseStage
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
  valuation?: ResearchCaseValuationProjection
  /** Harness-computed AAOIFI Shariah financial ratios (absent → lane-proposed verdict was used). */
  shariah_financial?: ResearchCaseShariahFinancialProjection
  /** SHARIAH lane sector status judgment: compliant | conditional | non_compliant. */
  shariah_sector_status?: string
  /** Mechanism 6: source-discipline rejections (lane-proposed sources the whitelist excluded). */
  source_discipline?: ResearchCaseSourceDisciplineProjection
  /** Mechanism 5: red-team pass — strongest objection + the synthesis response + the deterministic flags. */
  red_team?: ResearchCaseRedTeamProjection
  synthesis_id?: string
  decision_id?: string
  investment_verdict?: string
  strategy_compliance?: string
  shariah_status?: string
  valuation_status?: string
  next_required_action?: string
  decision?: string
  user_approved?: boolean
  reason?: string
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
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
  const note = getString(value, 'note')
  if (note !== undefined) projected.note = note
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

function getValuation(payload: Record<string, unknown>): ResearchCaseValuationProjection | undefined {
  const value = payload['valuation']
  if (!isRecord(value)) {
    return undefined
  }

  const projected: ResearchCaseValuationProjection = {}
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
  const growth_basis = getString(value, 'growth_basis')
  if (growth_basis !== undefined) projected.growth_basis = growth_basis
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
  const margin_of_safety = getNumber(value, 'margin_of_safety')
  if (margin_of_safety !== undefined) projected.margin_of_safety = margin_of_safety
  const terminal_value_pct_of_iv = getNumber(value, 'terminal_value_pct_of_iv')
  if (terminal_value_pct_of_iv !== undefined) projected.terminal_value_pct_of_iv = terminal_value_pct_of_iv
  const cap_exceeded = getBoolean(value, 'cap_exceeded')
  if (cap_exceeded !== undefined) projected.cap_exceeded = cap_exceeded
  const margin_of_safety_applied = getNumber(value, 'margin_of_safety_applied')
  if (margin_of_safety_applied !== undefined) projected.margin_of_safety_applied = margin_of_safety_applied
  const margin_of_safety_widening_reasons = getStringArray(value, 'margin_of_safety_widening_reasons')
  if (margin_of_safety_widening_reasons !== undefined) projected.margin_of_safety_widening_reasons = margin_of_safety_widening_reasons
  const buy_price_per_share = getNumber(value, 'buy_price_per_share')
  if (buy_price_per_share !== undefined) projected.buy_price_per_share = buy_price_per_share
  const incremental_roic_basis = getString(value, 'incremental_roic_basis')
  if (incremental_roic_basis !== undefined) projected.incremental_roic_basis = incremental_roic_basis
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
  key: keyof Pick<ResearchCaseProjection, 'red_flags' | 'caveats' | 'risks' | 'open_questions'>,
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
      applyString(researchCase, 'investment_verdict', getString(event.payload, 'investment_verdict'))
      applyString(researchCase, 'strategy_compliance', getString(event.payload, 'strategy_compliance'))
      applyString(researchCase, 'shariah_status', getString(event.payload, 'shariah_status'))
      applyString(researchCase, 'valuation_status', getString(event.payload, 'valuation_status'))
      applyString(researchCase, 'next_required_action', getString(event.payload, 'next_required_action'))
      const valuation = getValuation(event.payload)
      if (valuation !== undefined) {
        researchCase.valuation = valuation
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
