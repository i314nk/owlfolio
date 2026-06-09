import { describe, expect, it } from 'vitest'

import {
  defaultAutomationSettings,
  defaultDemoAppConfig,
  defaultPersonalLocalAppConfig,
  mergeAutomationSettings,
} from '../appConfig'

describe('defaultAutomationSettings', () => {
  it('returns the correct default shape', () => {
    const settings = defaultAutomationSettings()
    expect(settings.research_engine_enabled).toBe(true)
    expect(settings.discovery).toEqual({ enabled: false, cadence: 'off' })
    expect(settings.quick_screen_approval).toBe('review')
    expect(settings.deep_dive_mode).toBe('swarm')
    expect(settings.watchlist_monitoring).toEqual({ enabled: true, cadence: 'daily' })
    expect(settings.holding_reviews).toEqual({ enabled: true, cadence: 'quarterly' })
    expect(settings.reanalysis).toEqual({ cadence: 'quarterly' })
    expect(settings.purification).toEqual({ enabled: true, cadence: 'quarterly' })
    expect(settings.valuation_refresh).toEqual({ enabled: true, cadence: 'daily' })
  })
})

describe('mergeAutomationSettings', () => {
  it('returns full defaults when called with no argument', () => {
    expect(mergeAutomationSettings()).toEqual(defaultAutomationSettings())
  })

  it('returns full defaults when called with undefined', () => {
    expect(mergeAutomationSettings(undefined)).toEqual(defaultAutomationSettings())
  })

  it('overrides only specified fields, leaving others at defaults', () => {
    const merged = mergeAutomationSettings({ research_engine_enabled: false })
    expect(merged.research_engine_enabled).toBe(false)
    // All other fields fall back to defaults
    expect(merged.watchlist_monitoring).toEqual({ enabled: true, cadence: 'daily' })
    expect(merged.discovery).toEqual({ enabled: false, cadence: 'off' })
    expect(merged.purification).toEqual({ enabled: true, cadence: 'quarterly' })
  })

  it('overrides nested cadence fields when provided', () => {
    const merged = mergeAutomationSettings({
      watchlist_monitoring: { enabled: false, cadence: 'off' },
      holding_reviews: { enabled: true, cadence: 'monthly' },
    })
    expect(merged.watchlist_monitoring).toEqual({ enabled: false, cadence: 'off' })
    expect(merged.holding_reviews).toEqual({ enabled: true, cadence: 'monthly' })
    // Untouched field stays default
    expect(merged.valuation_refresh).toEqual({ enabled: true, cadence: 'daily' })
  })
})

describe('defaultDemoAppConfig back-compat', () => {
  it('includes automation with defaults', () => {
    const config = defaultDemoAppConfig()
    expect(config.automation).toEqual(defaultAutomationSettings())
  })

  it('parses correctly when automation is absent (legacy config)', () => {
    // Simulate a legacy config read from disk (no automation field)
    const legacyConfig = {
      version: 1 as const,
      mode: 'demo' as const,
      provider: { provider_id: 'mock-provider' as const, support_level: 'certified' as const, model_id: 'mock-buffett-munger-demo' },
      strategy_id: 'buffett-munger' as const,
      shariah: { enabled: true, policy_basis: 'AAOIFI' as const, allow_conditional: true, non_compliant_income_threshold: 0.05 },
      market_universe: { scope_id: 'public-equities' as const, label: 'Public equities', broker_required: false as const },
    }
    // automation is absent in legacy configs; cast to AppConfig to verify mergeAutomationSettings fills it in
    const automation = mergeAutomationSettings((legacyConfig as import('../appConfig').AppConfig).automation)
    expect(automation).toEqual(defaultAutomationSettings())
  })
})

describe('defaultPersonalLocalAppConfig back-compat', () => {
  it('includes automation with defaults', () => {
    const config = defaultPersonalLocalAppConfig()
    expect(config.automation).toEqual(defaultAutomationSettings())
  })
})
