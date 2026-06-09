export const owlfolioModeValues = ['demo', 'personal-local'] as const
export type OwlfolioMode = (typeof owlfolioModeValues)[number]

export const providerIdValues = ['mock-provider', 'claude', 'openai', 'openai-api', 'gemini-developer-api', 'gemini-cli'] as const
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

export type AutomationCadenceDiscovery = 'off' | 'weekly' | 'monthly'
export type AutomationCadenceWatchlist = 'off' | 'daily' | 'weekly'
export type AutomationCadenceReviews = 'off' | 'monthly' | 'quarterly'
export type AutomationCadenceReanalysis = 'off' | 'quarterly' | 'annual'
export type AutomationCadencePurification = 'off' | 'quarterly' | 'annual'
export type AutomationCadenceValuation = 'off' | 'daily' | 'weekly'

export type AutomationSettings = {
  research_engine_enabled: boolean
  discovery: { enabled: boolean; cadence: AutomationCadenceDiscovery }
  quick_screen_approval: 'automatic' | 'review' | 'auto_skip'
  deep_dive_mode: 'swarm' | 'single_agent'
  watchlist_monitoring: { enabled: boolean; cadence: AutomationCadenceWatchlist }
  holding_reviews: { enabled: boolean; cadence: AutomationCadenceReviews }
  reanalysis: { cadence: AutomationCadenceReanalysis }
  purification: { enabled: boolean; cadence: AutomationCadencePurification }
  valuation_refresh: { enabled: boolean; cadence: AutomationCadenceValuation }
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
  deep_dive_mode: 'swarm',
  watchlist_monitoring: { enabled: true, cadence: 'daily' },
  holding_reviews: { enabled: true, cadence: 'quarterly' },
  reanalysis: { cadence: 'quarterly' },
  purification: { enabled: true, cadence: 'quarterly' },
  valuation_refresh: { enabled: true, cadence: 'daily' },
})

/**
 * Merges a (potentially partial or legacy) automation config with defaults.
 * Configs written before the automation field was introduced will not have it;
 * this helper fills in all missing fields without mutating the original.
 */
export const mergeAutomationSettings = (partial?: Partial<AutomationSettings>): AutomationSettings => {
  if (partial === undefined) {
    return defaultAutomationSettings()
  }

  const defaults = defaultAutomationSettings()
  return {
    research_engine_enabled: partial.research_engine_enabled ?? defaults.research_engine_enabled,
    discovery: partial.discovery ?? defaults.discovery,
    quick_screen_approval: partial.quick_screen_approval ?? defaults.quick_screen_approval,
    deep_dive_mode: partial.deep_dive_mode ?? defaults.deep_dive_mode,
    watchlist_monitoring: partial.watchlist_monitoring ?? defaults.watchlist_monitoring,
    holding_reviews: partial.holding_reviews ?? defaults.holding_reviews,
    reanalysis: partial.reanalysis ?? defaults.reanalysis,
    purification: partial.purification ?? defaults.purification,
    valuation_refresh: partial.valuation_refresh ?? defaults.valuation_refresh,
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
