export const owlfolioModeValues = ['demo', 'personal-local'] as const
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

export type AppConfig = {
  version: 1
  mode: OwlfolioMode
  provider: ProviderSelection
  strategy_id: StrategyId
  shariah: ShariahDefaults
  market_universe: MarketUniverseConfig
  automation?: AutomationSettings
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
  market_universe: defaultMarketUniverseConfig(),
  automation: defaultAutomationSettings(),
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
  market_universe: defaultMarketUniverseConfig(),
  automation: defaultAutomationSettings(),
})
