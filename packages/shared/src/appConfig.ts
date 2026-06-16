/**
 * The three-state mode model. `unconfigured` is the FIRST-CLASS "not yet chosen" state — it is the
 * default for a real fresh install, so "no choice made" is an explicit value every branch must handle
 * (rather than a silent fall-through to `demo`). `demo` and `personal-local` are deliberately CHOSEN
 * states; nothing should ever land in `demo` by default.
 */
export const owlfolioModeValues = ['unconfigured', 'demo', 'personal-local'] as const
export type OwlfolioMode = (typeof owlfolioModeValues)[number]

export const providerIdValues = ['mock-provider', 'claude', 'openai', 'openrouter'] as const
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

export type AutomationSettings = {
  research_engine_enabled: boolean
  discovery: { enabled: boolean; cadence: AutomationCadenceDiscovery }
  quick_screen_approval: 'automatic' | 'review'
  watchlist_monitoring: { enabled: boolean; cadence: AutomationCadenceWatchlist }
  thesis_review: { enabled: boolean; cadence: AutomationCadenceThesisReview }
  reanalysis: { cadence: AutomationCadenceReanalysis }
  purification: { enabled: boolean; cadence: AutomationCadencePurification }
  price_refresh: { enabled: boolean; cadence: AutomationCadencePriceRefresh }
  /** Advanced: max grounded tool calls per research lane (Phase-1 gather cap). See the const docs above. */
  research_max_tool_calls: number
}

/** Clamp a (possibly invalid/legacy) max-tool-calls value into the supported integer band; default fallback. */
export const clampResearchMaxToolCalls = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RESEARCH_MAX_TOOL_CALLS
  const rounded = Math.round(value)
  if (rounded < RESEARCH_MAX_TOOL_CALLS_MIN) return RESEARCH_MAX_TOOL_CALLS_MIN
  if (rounded > RESEARCH_MAX_TOOL_CALLS_MAX) return RESEARCH_MAX_TOOL_CALLS_MAX
  return rounded
}

/**
 * The owner-set "circle of competence" boundary the research harness CHECKS candidates against
 * before spend (the check + pre-spend gate live in a later task; this is the config only).
 *
 * Default is PERMISSIVE: `{ enabled: false }` with every optional field unset admits everything, so
 * nothing is ever silently rejected until the owner deliberately narrows the boundary.
 */
export type CircleOfCompetenceConfig = {
  /** false = permissive (no rejection); true = enforce the boundary below. Default false. */
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
  savings?: SavingsSleeveConfig
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

/** Clamp a savings rate into [SAVINGS_RATE_MIN, SAVINGS_RATE_MAX], failing CLOSED TO DEFAULT (never to the ceiling). */
const clampSavingsRate = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < SAVINGS_RATE_MIN || value > SAVINGS_RATE_MAX) return fallback
  return value
}

/**
 * Merge a (potentially partial, legacy, or invalid) savings sleeve config with the defaults without
 * mutating the input. Out-of-band / invalid rates fail closed to the default; `savings_model` is always
 * pinned to the single supported capital-stable model ('mudarabah') — no tiered-cash / sukuk variants.
 */
export const mergeSavingsSleeveConfig = (partial?: Partial<SavingsSleeveConfig>): SavingsSleeveConfig => {
  if (partial === undefined) {
    return defaultSavingsSleeveConfig()
  }
  return {
    savings_expected_profit_rate: clampSavingsRate(
      partial.savings_expected_profit_rate,
      DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE,
    ),
    savings_model: 'mudarabah',
    equity_risk_margin: clampSavingsRate(partial.equity_risk_margin, DEFAULT_EQUITY_RISK_MARGIN),
  }
}

export const defaultMarketUniverseConfig = (): MarketUniverseConfig => ({
  scope_id: 'public-equities',
  label: 'Public equities discovery universe',
  broker_required: false,
})

export const defaultAutomationSettings = (): AutomationSettings => ({
  research_engine_enabled: true,
  discovery: { enabled: false, cadence: 'off' },
  quick_screen_approval: 'review',
  watchlist_monitoring: { enabled: true, cadence: 'daily' },
  thesis_review: { enabled: true, cadence: 'quarterly' },
  reanalysis: { cadence: 'annual' },
  purification: { enabled: true, cadence: 'quarterly' },
  price_refresh: { enabled: true, cadence: 'daily' },
  research_max_tool_calls: DEFAULT_RESEARCH_MAX_TOOL_CALLS,
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
 * - quick_screen_approval 'auto_skip': clamped to 'review'
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

  // Back-compat: clamp removed quick_screen_approval values to 'review'
  const rawApproval = partial.quick_screen_approval as string | undefined
  const quick_screen_approval: AutomationSettings['quick_screen_approval'] =
    rawApproval === 'automatic' ? 'automatic'
    : rawApproval === 'review' ? 'review'
    : rawApproval !== undefined ? 'review' // clamp 'auto_skip' or any other removed value
    : defaults.quick_screen_approval

  // Back-compat: clamp removed reanalysis cadence values to 'annual'
  const rawReanalysisCadence = partial.reanalysis?.cadence as string | undefined
  const reanalysisCadence: AutomationCadenceReanalysis =
    (AutomationCadenceReanalysisValues as readonly string[]).includes(rawReanalysisCadence ?? '')
      ? rawReanalysisCadence as AutomationCadenceReanalysis
      : rawReanalysisCadence !== undefined ? 'annual' // clamp 'quarterly' or removed values
      : defaults.reanalysis.cadence

  return {
    research_engine_enabled: partial.research_engine_enabled ?? defaults.research_engine_enabled,
    discovery: partial.discovery ?? defaults.discovery,
    quick_screen_approval,
    watchlist_monitoring: partial.watchlist_monitoring ?? defaults.watchlist_monitoring,
    thesis_review: thesisReviewRaw ?? defaults.thesis_review,
    reanalysis: partial.reanalysis !== undefined ? { cadence: reanalysisCadence } : defaults.reanalysis,
    purification: partial.purification ?? defaults.purification,
    price_refresh: partial.price_refresh ?? defaults.price_refresh,
    research_max_tool_calls: partial.research_max_tool_calls === undefined
      ? defaults.research_max_tool_calls
      : clampResearchMaxToolCalls(partial.research_max_tool_calls),
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
 * providers/onboarding flow resolves it into a chosen `demo` or `personal-local` mode. The provider
 * defaults to `mock-provider`/`certified` only as a neutral placeholder; an unconfigured app must never
 * render demo data or claim an initialized ledger on the strength of it.
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

export const defaultDemoAppConfig = (): AppConfig => ({
  version: 1,
  mode: 'demo',
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
  provider: {
    provider_id: 'claude',
    support_level: 'experimental',
  },
  strategy_id: 'buffett-munger',
  shariah: defaultShariahDefaults(),
  savings: defaultSavingsSleeveConfig(),
  market_universe: defaultMarketUniverseConfig(),
  automation: defaultAutomationSettings(),
  circle_of_competence: defaultCircleOfCompetenceConfig(),
})
