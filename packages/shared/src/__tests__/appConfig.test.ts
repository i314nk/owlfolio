import { describe, expect, it } from 'vitest'

import {
  type AutomationCadenceReanalysis,
  type AutomationSettings,
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
    expect(settings.watchlist_monitoring).toEqual({ enabled: true, cadence: 'daily' })
    expect(settings.thesis_review).toEqual({ enabled: true, cadence: 'quarterly' })
    expect(settings.reanalysis).toEqual({ cadence: 'annual' })
    expect(settings.purification).toEqual({ enabled: true, cadence: 'quarterly' })
    expect(settings.price_refresh).toEqual({ enabled: true, cadence: 'daily' })
    expect(settings.research_max_tool_calls).toBe(10)
    // Removed fields must not be present on the default
    expect((settings as Record<string, unknown>).deep_dive_mode).toBeUndefined()
    expect((settings as Record<string, unknown>).holding_reviews).toBeUndefined()
    expect((settings as Record<string, unknown>).valuation_refresh).toBeUndefined()
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
      thesis_review: { enabled: true, cadence: 'monthly' },
    })
    expect(merged.watchlist_monitoring).toEqual({ enabled: false, cadence: 'off' })
    expect(merged.thesis_review).toEqual({ enabled: true, cadence: 'monthly' })
    // Untouched field stays default
    expect(merged.price_refresh).toEqual({ enabled: true, cadence: 'daily' })
  })

  // --- Back-compat tests ---

  it('back-compat: maps legacy holding_reviews to thesis_review when thesis_review absent', () => {
    const merged = mergeAutomationSettings({ holding_reviews: { enabled: true, cadence: 'monthly' } })
    expect(merged.thesis_review).toEqual({ enabled: true, cadence: 'monthly' })
    expect((merged as Record<string, unknown>).holding_reviews).toBeUndefined()
  })

  it('back-compat: prefers explicit thesis_review over legacy holding_reviews', () => {
    const merged = mergeAutomationSettings({
      holding_reviews: { enabled: false, cadence: 'off' },
      thesis_review: { enabled: true, cadence: 'quarterly' },
    })
    expect(merged.thesis_review).toEqual({ enabled: true, cadence: 'quarterly' })
  })

  it('back-compat: ignores deep_dive_mode field (removed)', () => {
    const merged = mergeAutomationSettings({ deep_dive_mode: 'single_agent' } as Record<string, unknown>)
    expect((merged as Record<string, unknown>).deep_dive_mode).toBeUndefined()
    expect(merged.research_engine_enabled).toBe(true)
  })

  it('back-compat: clamps auto_skip quick_screen_approval to review', () => {
    const merged = mergeAutomationSettings({ quick_screen_approval: 'auto_skip' as AutomationSettings['quick_screen_approval'] })
    expect(merged.quick_screen_approval).toBe('review')
  })

  it('back-compat: clamps removed reanalysis quarterly cadence to annual', () => {
    const merged = mergeAutomationSettings({ reanalysis: { cadence: 'quarterly' as AutomationCadenceReanalysis } })
    expect(merged.reanalysis).toEqual({ cadence: 'annual' })
  })

  it('back-compat: ignores valuation_refresh field (replaced by price_refresh)', () => {
    const merged = mergeAutomationSettings({ valuation_refresh: { enabled: true, cadence: 'daily' } } as Record<string, unknown>)
    expect((merged as Record<string, unknown>).valuation_refresh).toBeUndefined()
    expect(merged.price_refresh).toEqual({ enabled: true, cadence: 'daily' })
  })

  it('research_max_tool_calls: honors a valid value', () => {
    expect(mergeAutomationSettings({ research_max_tool_calls: 18 }).research_max_tool_calls).toBe(18)
  })

  it('research_max_tool_calls: defaults when absent', () => {
    expect(mergeAutomationSettings({ research_engine_enabled: true }).research_max_tool_calls).toBe(10)
  })

  it('research_max_tool_calls: clamps below the minimum to the floor', () => {
    expect(mergeAutomationSettings({ research_max_tool_calls: 0 }).research_max_tool_calls).toBe(1)
    expect(mergeAutomationSettings({ research_max_tool_calls: -5 }).research_max_tool_calls).toBe(1)
  })

  it('research_max_tool_calls: clamps above the maximum to the ceiling', () => {
    expect(mergeAutomationSettings({ research_max_tool_calls: 999 }).research_max_tool_calls).toBe(50)
  })

  it('research_max_tool_calls: rounds + rejects non-finite to the default', () => {
    expect(mergeAutomationSettings({ research_max_tool_calls: 12.7 }).research_max_tool_calls).toBe(13)
    expect(mergeAutomationSettings({ research_max_tool_calls: Number.NaN }).research_max_tool_calls).toBe(10)
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
