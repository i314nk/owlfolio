/**
 * The two-state mode model. `unconfigured` is the FIRST-CLASS "not yet chosen" state — it is the default
 * for a real fresh install, so "no choice made" is an explicit value every branch must handle (rather
 * than a silent fall-through). `personal-local` is the single deliberately CHOSEN working state.
 */
export const owlfolioModeValues = ['unconfigured', 'personal-local'] as const
export type OwlfolioMode = (typeof owlfolioModeValues)[number]

export const providerIdValues = ['mock-provider', 'openrouter', 'openai-api', 'anthropic-api', 'gemini-developer-api'] as const
export type ProviderId = (typeof providerIdValues)[number]

export const providerSupportLevelValues = ['certified', 'experimental', 'unsupported'] as const
export type ProviderSupportLevel = (typeof providerSupportLevelValues)[number]

export const strategyIdValues = ['buffett-munger'] as const
export type StrategyId = (typeof strategyIdValues)[number]

export type ProviderSelection = {
  provider_id: ProviderId
  support_level: ProviderSupportLevel
  model_id?: string
}

export type ShariahDefaults = {
  enabled: boolean
  policy_basis: 'AAOIFI'
  allow_conditional: boolean
  non_compliant_income_threshold: number
}

/**
 * Cash-as-a-first-class-position: the Shariah-compliant savings sleeve config (Phase 5 S5).
 *
 * Idle capital's default home is a Mudarabah-style sleeve: CAPITAL-STABLE (not capital-CERTAIN) and
 * profit-SHARING — NOT a Treasury bill, NOT a guaranteed/risk-free instrument. The single rate here does
 * triple duty (the SAME number): idle-capital return, the deployment hurdle floor (now), and — later — the
 * risk-free anchor.
 *
 * HONEST LABELING IS LOAD-BEARING: `savings_expected_profit_rate` is EXPECTED, NOT GUARANTEED. The field
 * name and docs must never encode false certainty. A Mudarabah profit share is a realized-profit
 * expectation, not a promised yield.
 */
export type SavingsSleeveConfig = {
  /**
   * The ONE rate (annualized, as a fraction e.g. 0.02 = 2%). EXPECTED, NOT GUARANTEED — a Mudarabah
   * profit-share expectation, never a promised/risk-free yield. Drives idle-capital return + the hurdle.
   */
  savings_expected_profit_rate: number
  /** Capital-STABLE, profit-SHARING Mudarabah model — NOT a Treasury bill / guaranteed instrument. */
  savings_model: 'mudarabah'
  /**
   * The margin a candidate's owner-earnings yield must clear ABOVE the expected savings rate to justify
   * deploying idle capital out of the sleeve. hurdle = savings_expected_profit_rate + equity_risk_margin.
   */
  equity_risk_margin: number
  /**
   * VINTAGE of the compliant savings rate: the ISO timestamp when `savings_expected_profit_rate` was last
   * SET to an explicit (non-default) value. Optional + legacy-tolerant — ABSENT means the rate was never
   * set by an owner (the frozen default is in force) or predates vintage tracking. Surfaced read-only so a
   * stale risk-free anchor is VISIBLE rather than silently trusted; never participates in discount math.
   */
  savings_rate_set_at?: string
}

export type MarketUniverseConfig = {
  scope_id: 'public-equities'
  label: string
  broker_required: false
}

export const AutomationCadenceDiscoveryValues = ['off', 'weekly', 'monthly'] as const
export type AutomationCadenceDiscovery = (typeof AutomationCadenceDiscoveryValues)[number]

export const AutomationCadenceWatchlistValues = ['off', 'daily', 'weekly'] as const
export type AutomationCadenceWatchlist = (typeof AutomationCadenceWatchlistValues)[number]

export const AutomationCadenceThesisReviewValues = ['off', 'monthly', 'quarterly'] as const
export type AutomationCadenceThesisReview = (typeof AutomationCadenceThesisReviewValues)[number]

export const AutomationCadenceReanalysisValues = ['off', 'annual'] as const
export type AutomationCadenceReanalysis = (typeof AutomationCadenceReanalysisValues)[number]

export const AutomationCadencePurificationValues = ['off', 'quarterly', 'annual'] as const
export type AutomationCadencePurification = (typeof AutomationCadencePurificationValues)[number]

export const AutomationCadencePriceRefreshValues = ['off', 'daily', 'weekly'] as const
export type AutomationCadencePriceRefresh = (typeof AutomationCadencePriceRefreshValues)[number]

/**
 * Advanced research-depth / cost knob: the maximum number of grounded tool calls (fetch_source /
 * search_filings) a single research lane may make during its Phase-1 evidence gather. Higher = deeper
 * (more primary sources pulled per lane) but more model round-trips + more spend; lower = faster/cheaper
 * but risks shallow research. Threaded into the grounded tool loop's `budget.max_tool_calls`. Bounded so
 * a stray config can neither disable gathering (≥1) nor run away on cost (≤50).
 */
export const DEFAULT_RESEARCH_MAX_TOOL_CALLS = 10
export const RESEARCH_MAX_TOOL_CALLS_MIN = 1
export const RESEARCH_MAX_TOOL_CALLS_MAX = 50

/**
 * Circle-of-competence GATE hardening knobs (the deep-dive grounded model judgment, NOT the owner-policy
 * hard-exclusion pre-filter below). The gate is sampled `k` times per run and the deep dive is entered
 * only on a UNANIMOUS in-competence vote — k=1 restores the single-sample behavior; higher k kills
 * run-to-run judgment flips at one extra model call per extra sample (cheap vs. the 7-lane spend it
 * gates). The evidence floors are the minimum GROUNDED (cite-verified) cashflow drivers / predictability
 * breakers a sample must carry for its judgment to count — a thinner gather votes set-aside (fail-closed).
 */
export const DEFAULT_CIRCLE_GATE_K_SAMPLES = 2
export const CIRCLE_GATE_K_SAMPLES_MIN = 1
export const CIRCLE_GATE_K_SAMPLES_MAX = 5
export const DEFAULT_CIRCLE_GATE_MIN_DRIVERS = 2
export const DEFAULT_CIRCLE_GATE_MIN_BREAKERS = 2
export const CIRCLE_GATE_EVIDENCE_FLOOR_MIN = 1
export const CIRCLE_GATE_EVIDENCE_FLOOR_MAX = 5

/** The selectable UI palettes: token-override themes keyed by data-owl-theme on <html>. */
export const OWL_THEMES = [
  { id: 'emerald', label: 'Emerald (default)' },
  { id: 'sapphire', label: 'Sapphire' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'mono', label: 'Mono (terminal)' },
  { id: 'violet', label: 'Violet' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
] as const
export type OwlThemeId = typeof OWL_THEMES[number]['id']

export type AppearanceSettings = { theme: OwlThemeId }

export const resolveTheme = (appearance?: AppearanceSettings): OwlThemeId => {
  const candidate = appearance?.theme
  return OWL_THEMES.some((t) => t.id === candidate) ? candidate as OwlThemeId : 'emerald'
}

export type AutomationSettings = {
  research_engine_enabled: boolean
  discovery: {
    enabled: boolean
    cadence: AutomationCadenceDiscovery
    /**
     * AUTO-RESEARCH ON PROMOTION (owner, 2026-07-16): when true, promoting a superinvestor
     * candidate immediately starts the research run (provider spend). The run still passes the
     * cheap gates first (Shariah when on + circle of competence), and `deep_dive_approval`
     * separately governs whether the expensive deep dive continues or pauses after they pass.
     * Default false — a promoted case waits for the user to start the analysis.
     */
    auto_research: boolean
  }
  /** Approval pause for the deep dive — applied BEHIND the cheap gates, before lane spend. */
  deep_dive_approval: 'automatic' | 'review'
  watchlist_monitoring: { enabled: boolean; cadence: AutomationCadenceWatchlist }
  /** REVIEW RETIRED (2026-07-14): drives ONLY the quarterly re_review_check (the grounded check-in). */
  thesis_review: { enabled: boolean; cadence: AutomationCadenceThesisReview }
  reanalysis: { cadence: AutomationCadenceReanalysis }
  purification: { enabled: boolean; cadence: AutomationCadencePurification }
  price_refresh: { enabled: boolean; cadence: AutomationCadencePriceRefresh }
  /** Advanced: max grounded tool calls per research lane (Phase-1 gather cap). See the const docs above. */
  research_max_tool_calls: number
  /** Advanced: circle-gate agreement samples (unanimous-to-enter; 1 = single-sample). See const docs. */
  circle_gate_k_samples: number
  /** Advanced: minimum GROUNDED cashflow drivers per circle-gate sample. See const docs. */
  circle_gate_min_drivers: number
  /** Advanced: minimum GROUNDED predictability breakers per circle-gate sample. See const docs. */
  circle_gate_min_breakers: number
}

/** Clamp a (possibly invalid/legacy) max-tool-calls value into the supported integer band; default fallback. */
export const clampResearchMaxToolCalls = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RESEARCH_MAX_TOOL_CALLS
  const rounded = Math.round(value)
  if (rounded < RESEARCH_MAX_TOOL_CALLS_MIN) return RESEARCH_MAX_TOOL_CALLS_MIN
  if (rounded > RESEARCH_MAX_TOOL_CALLS_MAX) return RESEARCH_MAX_TOOL_CALLS_MAX
  return rounded
}

/** Clamp a circle-gate knob into an integer band; non-finite/non-number falls back to the given default. */
const clampCircleGateValue = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

export const clampCircleGateKSamples = (value: unknown): number =>
  clampCircleGateValue(value, DEFAULT_CIRCLE_GATE_K_SAMPLES, CIRCLE_GATE_K_SAMPLES_MIN, CIRCLE_GATE_K_SAMPLES_MAX)
export const clampCircleGateMinDrivers = (value: unknown): number =>
  clampCircleGateValue(value, DEFAULT_CIRCLE_GATE_MIN_DRIVERS, CIRCLE_GATE_EVIDENCE_FLOOR_MIN, CIRCLE_GATE_EVIDENCE_FLOOR_MAX)
export const clampCircleGateMinBreakers = (value: unknown): number =>
  clampCircleGateValue(value, DEFAULT_CIRCLE_GATE_MIN_BREAKERS, CIRCLE_GATE_EVIDENCE_FLOOR_MIN, CIRCLE_GATE_EVIDENCE_FLOOR_MAX)

/**
 * The owner-set OWNER-POLICY HARD-EXCLUSION policy the research harness CHECKS candidates against before
 * spend (cheap, deterministic, config-only pre-filter at the research-start route).
 *
 * IMPORTANT — what this is NOT: this is NOT the circle-of-competence COMPETENCE judgment ("do I understand
 * THIS business well enough to assess its cashflow predictability?"). That is a GROUNDED MODEL JUDGMENT in
 * the deep-dive phase (the circle gate, emitting circle_competence_judged). THIS config is the owner's
 * categorical HARD-EXCLUSIONS ("I categorically WON'T invest in sector/archetype/size X" — an owner CHOICE,
 * not a competence claim). The TYPE NAME + config key (`circle_of_competence`) are retained for persisted-
 * config back-compat; the MEANING is owner-policy exclusions.
 *
 * Default is PERMISSIVE: `{ enabled: false }` with every optional field unset admits everything, so
 * nothing is ever silently excluded until the owner deliberately narrows the policy.
 */
export type CircleOfCompetenceConfig = {
  /** false = permissive (no exclusion); true = enforce the owner-policy exclusions below. Default false. */
  enabled: boolean
  /** When set + enabled, a candidate's SIC code must prefix-match one of these to be admitted. */
  allowed_sic_prefixes?: string[]
  /** When set + enabled, a candidate whose SIC code prefix-matches one of these is rejected. */
  excluded_sic_prefixes?: string[]
  /** When set + enabled, a candidate's business archetype must be one of these to be admitted. */
  allowed_archetypes?: string[]
  /**
   * DEFERRED — Pabrai Principle 5 (size) decision. Market-cap floor in millions USD.
   *
   * Size is the deliberately-deferred axis: the small-investor edge lives DOWN the cap spectrum
   * (sub-$500M names, special situations large funds structurally cannot touch). A high min-cap —
   * e.g. a reflexive "min $2B for liquidity/EDGAR coverage" default — would structurally foreclose
   * exactly that edge. But a very low floor strains other gates: thin small-cap XBRL/data coverage,
   * the moat gate (sub-$500M wide-moats are rarer), and Shariah-screen reliability. There is no safe
   * reflexive default in either direction, so this ships PERMISSIVE (unset). It must be set
   * DELIBERATELY by the owner later, never auto-defaulted, so size never becomes a buried parameter.
   */
  min_market_cap_musd?: number
  /**
   * DEFERRED — Pabrai Principle 5 (size) decision. Market-cap ceiling in millions USD.
   * See `min_market_cap_musd` above: size is a deferred, deliberately-set axis, NOT a reflexive
   * default. Ships PERMISSIVE (unset) so the small-cap edge is never foreclosed by accident.
   */
  max_market_cap_musd?: number
}

export type AppConfig = {
  version: 1
  mode: OwlfolioMode
  provider: ProviderSelection
  strategy_id: StrategyId
  shariah: ShariahDefaults
  /** UI appearance (PALETTES 2026-07-16): absent = the emerald default. */
  appearance?: AppearanceSettings
  savings?: SavingsSleeveConfig
  /** Phase 4 (book alignment): valuation knobs (required_return). Absent → defaults (15%). */
  valuation?: Partial<ValuationConfig>
  /** B7 (book alignment): the passive-sleeve plan (split + monthly DCA). Absent → defaults. */
  passive?: Partial<PassiveSleeveConfig>
  market_universe: MarketUniverseConfig
  automation?: AutomationSettings
  circle_of_competence?: CircleOfCompetenceConfig
  ledger_path?: string
  source_ledger_path?: string
  initialized_at?: string
}

export const defaultShariahDefaults = (): ShariahDefaults => ({
  enabled: true,
  policy_basis: 'AAOIFI',
  allow_conditional: true,
  non_compliant_income_threshold: 0.05,
})

/**
 * Rate band for the savings sleeve. Both `savings_expected_profit_rate` and `equity_risk_margin` are
 * clamped FAIL-CLOSED-TO-DEFAULT into [0, SAVINGS_RATE_MAX]: any out-of-band / non-finite / non-number
 * value reverts to the default (it is NOT silently pinned to the ceiling), so a stray config can never
 * fabricate an implausibly high "expected" rate or hurdle.
 */
export const SAVINGS_RATE_MIN = 0
export const SAVINGS_RATE_MAX = 0.25
export const DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE = 0.02
export const DEFAULT_EQUITY_RISK_MARGIN = 0.05

/** Shared reference value. Prefer `defaultSavingsSleeveConfig()` when you need a fresh, mutable copy. */
export const DEFAULT_SAVINGS_SLEEVE: SavingsSleeveConfig = {
  savings_expected_profit_rate: DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE,
  savings_model: 'mudarabah',
  equity_risk_margin: DEFAULT_EQUITY_RISK_MARGIN,
}

/** Returns a fresh default savings sleeve (capital-stable Mudarabah; rate EXPECTED, NOT guaranteed). */
export const defaultSavingsSleeveConfig = (): SavingsSleeveConfig => ({
  savings_expected_profit_rate: DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE,
  savings_model: 'mudarabah',
  equity_risk_margin: DEFAULT_EQUITY_RISK_MARGIN,
})

// ---------------------------------------------------------------------------------------------------
// B7 (Phase 4, book alignment): the PASSIVE SLEEVE — the book's step-2 foundation. Passive index
// investing on the side via monthly dollar-cost averaging, with a chosen passive/active split.
// Rules 1–3: (1) only commit an amount you can commit to REGULARLY; (2) buy on a consistent
// schedule, no matter what; (3) treat it as a LIFELONG commitment — never be tempted to sell.
// This config is the PLAN; actual contributions are user-authored ledger events
// (passive_contribution_recorded) — local-first, no broker, plan-and-track only.
// ---------------------------------------------------------------------------------------------------
export const PASSIVE_SPLITS = ['80/20', '60/40', '100/0'] as const
export type PassiveSplit = (typeof PASSIVE_SPLITS)[number]
export const DEFAULT_PASSIVE_SPLIT: PassiveSplit = '80/20'
/** Schedule day clamp band (1–28 so every month has the day). */
export const PASSIVE_SCHEDULE_DAY_MIN = 1
export const PASSIVE_SCHEDULE_DAY_MAX = 28
export const DEFAULT_PASSIVE_SCHEDULE_DAY = 1

export type PassiveSleeveConfig = {
  /** The passive/active split (passive share first). */
  split: PassiveSplit
  /** Rule 1 — the monthly amount you can REGULARLY commit (0 = not configured yet). */
  monthly_amount: number
  /** Rule 2 — the day of month (1–28) contributions are due. */
  schedule_day: number
  /** VINTAGE: when the plan was last set to explicit non-default values ("not set" otherwise). */
  passive_set_at?: string
}

export const defaultPassiveSleeveConfig = (): PassiveSleeveConfig => ({
  split: DEFAULT_PASSIVE_SPLIT,
  monthly_amount: 0,
  schedule_day: DEFAULT_PASSIVE_SCHEDULE_DAY,
})

/** Merge a (potentially partial/invalid) passive sleeve — mirror of the savings/valuation merges. */
export const mergePassiveSleeveConfig = (
  partial?: Partial<PassiveSleeveConfig>,
  options: { now?: string } = {},
): PassiveSleeveConfig => {
  if (partial === undefined) return defaultPassiveSleeveConfig()
  const split: PassiveSplit = (PASSIVE_SPLITS as readonly string[]).includes(partial.split as string)
    ? partial.split as PassiveSplit
    : DEFAULT_PASSIVE_SPLIT
  const monthly_amount = typeof partial.monthly_amount === 'number'
    && Number.isFinite(partial.monthly_amount) && partial.monthly_amount >= 0
    ? partial.monthly_amount
    : 0
  const schedule_day = typeof partial.schedule_day === 'number'
    && Number.isInteger(partial.schedule_day)
    && partial.schedule_day >= PASSIVE_SCHEDULE_DAY_MIN
    && partial.schedule_day <= PASSIVE_SCHEDULE_DAY_MAX
    ? partial.schedule_day
    : DEFAULT_PASSIVE_SCHEDULE_DAY
  const isConfigured = monthly_amount > 0
  const stampsThisWrite = options.now !== undefined && isConfigured
  const vintage = stampsThisWrite
    ? options.now
    : (typeof partial.passive_set_at === 'string' && !Number.isNaN(Date.parse(partial.passive_set_at)) ? partial.passive_set_at : undefined)
  return {
    split,
    monthly_amount,
    schedule_day,
    ...(vintage === undefined ? {} : { passive_set_at: vintage }),
  }
}

// ---------------------------------------------------------------------------------------------------
// Phase 4 (book alignment): the REQUIRED RETURN — the flat discount/hurdle for the 10-year FCF
// valuation ("anything less, you might as well buy the index"). Default 15% (the book), user-set in
// Settings; clamped FAIL-CLOSED-TO-DEFAULT like the savings rate. Distinct from the savings anchor
// (which remains the deployment-hurdle baseline).
// ---------------------------------------------------------------------------------------------------
export const REQUIRED_RETURN_MIN = 0.05
export const REQUIRED_RETURN_MAX = 0.40
export const DEFAULT_REQUIRED_RETURN = 0.15

export type ValuationConfig = {
  /** The required annual return (decimal) used to discount the FCF projection. Default 0.15. */
  required_return: number
  /** VINTAGE: when required_return was last set to an explicit non-default value ("not set" otherwise). */
  required_return_set_at?: string
}

export const defaultValuationConfig = (): ValuationConfig => ({ required_return: DEFAULT_REQUIRED_RETURN })

const clampRequiredReturn = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REQUIRED_RETURN
  if (value < REQUIRED_RETURN_MIN || value > REQUIRED_RETURN_MAX) return DEFAULT_REQUIRED_RETURN
  return value
}

/** Merge a (potentially partial/invalid) valuation config — mirror of mergeSavingsSleeveConfig. */
export const mergeValuationConfig = (
  partial?: Partial<ValuationConfig>,
  options: { now?: string; previousRate?: number } = {},
): ValuationConfig => {
  if (partial === undefined) return defaultValuationConfig()
  const required_return = clampRequiredReturn(partial.required_return)
  const stampsThisWrite = options.now !== undefined
    && required_return !== DEFAULT_REQUIRED_RETURN
    && required_return !== options.previousRate
  const vintage = stampsThisWrite ? options.now : normalizeVintageValue(partial.required_return_set_at)
  return {
    required_return,
    ...(vintage === undefined ? {} : { required_return_set_at: vintage }),
  }
}

/**
 * The required return ONLY when the user actually set it (vintage-stamped), else undefined.
 * B8 live finding: callers that thread `mergeValuationConfig(...).required_return` unconditionally
 * make the engine stamp `required_return_basis: 'setting'` for users who never touched Settings —
 * the merge returns the 0.15 book default either way, so "command carries a number" must mean
 * "the user chose it". Thread THIS into research-run commands, never the bare merge result.
 */
export const userSetRequiredReturn = (partial?: Partial<ValuationConfig>): number | undefined =>
  partial?.required_return_set_at !== undefined && normalizeVintageValue(partial.required_return_set_at) !== undefined
    ? mergeValuationConfig(partial).required_return
    : undefined

const normalizeVintageValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

/** Clamp a savings rate into [SAVINGS_RATE_MIN, SAVINGS_RATE_MAX], failing CLOSED TO DEFAULT (never to the ceiling). */
const clampSavingsRate = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < SAVINGS_RATE_MIN || value > SAVINGS_RATE_MAX) return fallback
  return value
}

/** A valid vintage stamp is a non-empty, parseable date string; anything else is dropped (→ "not set"). */
const normalizeVintage = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

/**
 * Merge a (potentially partial, legacy, or invalid) savings sleeve config with the defaults without
 * mutating the input. Out-of-band / invalid rates fail closed to the default; `savings_model` is always
 * pinned to the single supported capital-stable model ('mudarabah') — no tiered-cash / sukuk variants.
 *
 * VINTAGE (`savings_rate_set_at`): records WHEN the rate was last set to an explicit non-default value, so a
 * stale risk-free anchor is visible rather than silently trusted. The stamp is applied on a WRITE that
 * changes/sets the rate — inject `options.now` from the write path (deterministic in tests); never read the
 * clock here. Behaviour:
 *   - `now` given + resolved rate is non-default + it differs from `options.previousRate` → stamp `now`.
 *   - otherwise → preserve any valid incoming `savings_rate_set_at` (a load/round-trip keeps the recorded
 *     vintage), or `undefined` when absent/invalid (legacy + default configs render as "not set").
 */
export const mergeSavingsSleeveConfig = (
  partial?: Partial<SavingsSleeveConfig>,
  options: { now?: string; previousRate?: number } = {},
): SavingsSleeveConfig => {
  if (partial === undefined) {
    return defaultSavingsSleeveConfig()
  }
  const savingsRate = clampSavingsRate(
    partial.savings_expected_profit_rate,
    DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE,
  )
  const stampsThisWrite = options.now !== undefined
    && savingsRate !== DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE
    && savingsRate !== options.previousRate
  const vintage = stampsThisWrite ? options.now : normalizeVintage(partial.savings_rate_set_at)
  return {
    savings_expected_profit_rate: savingsRate,
    savings_model: 'mudarabah',
    equity_risk_margin: clampSavingsRate(partial.equity_risk_margin, DEFAULT_EQUITY_RISK_MARGIN),
    ...(vintage === undefined ? {} : { savings_rate_set_at: vintage }),
  }
}

export const defaultMarketUniverseConfig = (): MarketUniverseConfig => ({
  scope_id: 'public-equities',
  label: 'Public equities discovery universe',
  broker_required: false,
})

export const defaultAutomationSettings = (): AutomationSettings => ({
  research_engine_enabled: true,
  discovery: { enabled: false, cadence: 'off', auto_research: false },
  deep_dive_approval: 'review',
  watchlist_monitoring: { enabled: true, cadence: 'daily' },
  thesis_review: { enabled: true, cadence: 'quarterly' },
  reanalysis: { cadence: 'annual' },
  purification: { enabled: true, cadence: 'quarterly' },
  price_refresh: { enabled: true, cadence: 'daily' },
  research_max_tool_calls: DEFAULT_RESEARCH_MAX_TOOL_CALLS,
  circle_gate_k_samples: DEFAULT_CIRCLE_GATE_K_SAMPLES,
  circle_gate_min_drivers: DEFAULT_CIRCLE_GATE_MIN_DRIVERS,
  circle_gate_min_breakers: DEFAULT_CIRCLE_GATE_MIN_BREAKERS,
})

/**
 * Merges a (potentially partial or legacy) automation config with defaults.
 * Configs written before the automation field was introduced will not have it;
 * this helper fills in all missing fields without mutating the original.
 *
 * Back-compat behaviour for old configs:
 * - deep_dive_mode: ignored (deep dive is always swarm)
 * - valuation_refresh: ignored (replaced by price_refresh — back-compat callers must
 *   migrate via holding_reviews → thesis_review if needed)
 * - holding_reviews: mapped to thesis_review if thesis_review is absent
 * - quick_screen_approval: migrated to deep_dive_approval (same values; 'auto_skip' clamps to 'review')
 * - reanalysis cadence 'quarterly': clamped to 'annual'
 */
export const mergeAutomationSettings = (partial?: Partial<AutomationSettings & {
  // Legacy fields accepted but ignored or remapped
  deep_dive_mode?: unknown
  holding_reviews?: { enabled: boolean; cadence: string }
  valuation_refresh?: unknown
}>): AutomationSettings => {
  if (partial === undefined) {
    return defaultAutomationSettings()
  }

  const defaults = defaultAutomationSettings()

  // Back-compat: map holding_reviews → thesis_review if thesis_review absent
  const legacyHoldingReviews = partial.holding_reviews
  const thesisReviewRaw = partial.thesis_review ?? (legacyHoldingReviews !== undefined
    ? {
      enabled: legacyHoldingReviews.enabled,
      cadence: (AutomationCadenceThesisReviewValues as readonly string[]).includes(legacyHoldingReviews.cadence)
        ? legacyHoldingReviews.cadence as AutomationCadenceThesisReview
        : defaults.thesis_review.cadence,
    }
    : undefined)

  // Back-compat: the retired quick_screen_approval key migrates to deep_dive_approval (the pause
  // moved behind the front gates); removed values ('auto_skip', anything else) clamp to 'review'.
  const rawApproval = (partial.deep_dive_approval
    ?? (partial as { quick_screen_approval?: unknown }).quick_screen_approval) as string | undefined
  const deep_dive_approval: AutomationSettings['deep_dive_approval'] =
    rawApproval === 'automatic' ? 'automatic'
    : rawApproval === 'review' ? 'review'
    : rawApproval !== undefined ? 'review' // clamp 'auto_skip' or any other removed value
    : defaults.deep_dive_approval

  // Back-compat: clamp removed reanalysis cadence values to 'annual'
  const rawReanalysisCadence = partial.reanalysis?.cadence as string | undefined
  const reanalysisCadence: AutomationCadenceReanalysis =
    (AutomationCadenceReanalysisValues as readonly string[]).includes(rawReanalysisCadence ?? '')
      ? rawReanalysisCadence as AutomationCadenceReanalysis
      : rawReanalysisCadence !== undefined ? 'annual' // clamp 'quarterly' or removed values
      : defaults.reanalysis.cadence

  return {
    research_engine_enabled: partial.research_engine_enabled ?? defaults.research_engine_enabled,
    // Spread-merge: configs written before auto_research existed lack the key → default false.
    discovery: { ...defaults.discovery, ...(partial.discovery ?? {}) },
    deep_dive_approval,
    watchlist_monitoring: partial.watchlist_monitoring ?? defaults.watchlist_monitoring,
    thesis_review: thesisReviewRaw ?? defaults.thesis_review,
    reanalysis: partial.reanalysis !== undefined ? { cadence: reanalysisCadence } : defaults.reanalysis,
    purification: partial.purification ?? defaults.purification,
    price_refresh: partial.price_refresh ?? defaults.price_refresh,
    research_max_tool_calls: partial.research_max_tool_calls === undefined
      ? defaults.research_max_tool_calls
      : clampResearchMaxToolCalls(partial.research_max_tool_calls),
    circle_gate_k_samples: partial.circle_gate_k_samples === undefined
      ? defaults.circle_gate_k_samples
      : clampCircleGateKSamples(partial.circle_gate_k_samples),
    circle_gate_min_drivers: partial.circle_gate_min_drivers === undefined
      ? defaults.circle_gate_min_drivers
      : clampCircleGateMinDrivers(partial.circle_gate_min_drivers),
    circle_gate_min_breakers: partial.circle_gate_min_breakers === undefined
      ? defaults.circle_gate_min_breakers
      : clampCircleGateMinBreakers(partial.circle_gate_min_breakers),
  }
}

/**
 * The permissive baseline: disabled, with no lists or caps. Admits every candidate. Used as the
 * shared reference value; prefer `defaultCircleOfCompetenceConfig()` when you need a fresh, mutable
 * copy.
 */
export const DEFAULT_CIRCLE_OF_COMPETENCE: CircleOfCompetenceConfig = { enabled: false }

/** Returns a fresh permissive circle-of-competence config (so callers can't mutate the shared default). */
export const defaultCircleOfCompetenceConfig = (): CircleOfCompetenceConfig => ({ enabled: false })

/** Keep only finite, trimmed, non-empty string entries; collapse an empty result to undefined (permissive). */
const sanitizeStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Clamp a (possibly invalid) market-cap bound (millions USD) to a non-negative integer, or drop it.
 * Fail-closed to permissive: negative / NaN / non-finite / non-number → undefined (no bound applied).
 * Note: bounds are intentionally NOT given a reflexive default — see CircleOfCompetenceConfig docs.
 */
const clampMarketCapMusd = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

/**
 * Merges a (potentially partial, legacy, or invalid) circle-of-competence config with the permissive
 * default without mutating the input. Invalid values fail closed to PERMISSIVE (the offending field is
 * dropped / left unset rather than throwing) so a malformed config can never silently reject candidates.
 */
export const mergeCircleOfCompetenceConfig = (
  partial?: Partial<CircleOfCompetenceConfig>,
): CircleOfCompetenceConfig => {
  if (partial === undefined) {
    return defaultCircleOfCompetenceConfig()
  }

  const merged: CircleOfCompetenceConfig = {
    enabled: partial.enabled === true,
  }

  const allowedSic = sanitizeStringList(partial.allowed_sic_prefixes)
  if (allowedSic !== undefined) merged.allowed_sic_prefixes = allowedSic

  const excludedSic = sanitizeStringList(partial.excluded_sic_prefixes)
  if (excludedSic !== undefined) merged.excluded_sic_prefixes = excludedSic

  const allowedArchetypes = sanitizeStringList(partial.allowed_archetypes)
  if (allowedArchetypes !== undefined) merged.allowed_archetypes = allowedArchetypes

  const minCap = clampMarketCapMusd(partial.min_market_cap_musd)
  if (minCap !== undefined) merged.min_market_cap_musd = minCap

  const maxCap = clampMarketCapMusd(partial.max_market_cap_musd)
  if (maxCap !== undefined) merged.max_market_cap_musd = maxCap

  return merged
}

/**
 * The default config for a REAL fresh install: explicitly `unconfigured`. It carries the shared safe
 * defaults (strategy, Shariah, savings, market universe, automation, circle-of-competence) so every
 * consumer sees a complete config shape, but it points at NO ledger and is NOT initialized — the
 * providers/onboarding flow resolves it into the chosen `personal-local` mode. The provider defaults to
 * `mock-provider`/`certified` only as a neutral placeholder; an unconfigured app must never claim an
 * initialized ledger on the strength of it.
 */
export const defaultUnconfiguredAppConfig = (): AppConfig => ({
  version: 1,
  mode: 'unconfigured',
  provider: {
    provider_id: 'mock-provider',
    support_level: 'certified',
    model_id: 'mock-buffett-munger-demo',
  },
  strategy_id: 'buffett-munger',
  shariah: defaultShariahDefaults(),
  savings: defaultSavingsSleeveConfig(),
  market_universe: defaultMarketUniverseConfig(),
  automation: defaultAutomationSettings(),
  circle_of_competence: defaultCircleOfCompetenceConfig(),
})

export const defaultPersonalLocalAppConfig = (): AppConfig => ({
  version: 1,
  mode: 'personal-local',
  // Default personal-local provider is OpenRouter — the proven grounded function-calling tool-loop path.
  // (The Codex CLI/OAuth and Claude CLI/OAuth providers were retired; the surviving providers are OpenRouter
  // + the direct API-key providers.) A fresh personal-local honestly shows "provider not connected" until
  // OPENROUTER_API_KEY is set.
  provider: {
    provider_id: 'openrouter',
    support_level: 'experimental',
    model_id: 'anthropic/claude-opus-4.8',
  },
  strategy_id: 'buffett-munger',
  shariah: defaultShariahDefaults(),
  savings: defaultSavingsSleeveConfig(),
  market_universe: defaultMarketUniverseConfig(),
  automation: defaultAutomationSettings(),
  circle_of_competence: defaultCircleOfCompetenceConfig(),
})
