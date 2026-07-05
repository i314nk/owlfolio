import { describe, expect, it } from 'vitest'

import {
  type AutomationCadenceReanalysis,
  type AutomationSettings,
  type CircleOfCompetenceConfig,
  DEFAULT_CIRCLE_OF_COMPETENCE,
  defaultAutomationSettings,
  defaultCircleOfCompetenceConfig,
  defaultPersonalLocalAppConfig,
  defaultUnconfiguredAppConfig,
  owlfolioModeValues,
  mergeAutomationSettings,
  mergeCircleOfCompetenceConfig,
  type SavingsSleeveConfig,
  DEFAULT_SAVINGS_SLEEVE,
  SAVINGS_RATE_MAX,
  defaultSavingsSleeveConfig,
  mergeSavingsSleeveConfig,
} from '../appConfig'

describe('two-state mode model', () => {
  it('includes unconfigured as an explicit enum member alongside personal-local', () => {
    expect(owlfolioModeValues).toEqual(['unconfigured', 'personal-local'])
  })

  it('defaultUnconfiguredAppConfig is an explicit unconfigured config that points at no ledger', () => {
    const config = defaultUnconfiguredAppConfig()
    expect(config.mode).toBe('unconfigured')
    // Unconfigured must not be initialized or point at any ledger.
    expect(config.ledger_path).toBeUndefined()
    expect(config.source_ledger_path).toBeUndefined()
    expect(config.initialized_at).toBeUndefined()
    // It still carries the shared safe defaults so every consumer has a complete config shape.
    expect(config.strategy_id).toBe('buffett-munger')
    expect(config.shariah.enabled).toBe(true)
  })

  it('defaultPersonalLocalAppConfig keeps its explicit mode', () => {
    expect(defaultPersonalLocalAppConfig().mode).toBe('personal-local')
  })
})

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

  it('circle-gate knobs: defaults when absent (k=2, floors 2/2)', () => {
    const merged = mergeAutomationSettings({ research_engine_enabled: true })
    expect(merged.circle_gate_k_samples).toBe(2)
    expect(merged.circle_gate_min_drivers).toBe(2)
    expect(merged.circle_gate_min_breakers).toBe(2)
  })

  it('circle-gate knobs: honor valid values and clamp into [1,5]', () => {
    const merged = mergeAutomationSettings({ circle_gate_k_samples: 3, circle_gate_min_drivers: 1, circle_gate_min_breakers: 4 })
    expect(merged.circle_gate_k_samples).toBe(3)
    expect(merged.circle_gate_min_drivers).toBe(1)
    expect(merged.circle_gate_min_breakers).toBe(4)
    expect(mergeAutomationSettings({ circle_gate_k_samples: 0 }).circle_gate_k_samples).toBe(1)
    expect(mergeAutomationSettings({ circle_gate_k_samples: 99 }).circle_gate_k_samples).toBe(5)
    expect(mergeAutomationSettings({ circle_gate_min_drivers: -1 }).circle_gate_min_drivers).toBe(1)
    expect(mergeAutomationSettings({ circle_gate_min_breakers: 7 }).circle_gate_min_breakers).toBe(5)
    expect(mergeAutomationSettings({ circle_gate_k_samples: Number.NaN }).circle_gate_k_samples).toBe(2)
    expect(mergeAutomationSettings({ circle_gate_k_samples: 2.6 }).circle_gate_k_samples).toBe(3)
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

describe('defaultCircleOfCompetenceConfig', () => {
  it('is permissive by default: disabled with no caps or lists', () => {
    const config = defaultCircleOfCompetenceConfig()
    expect(config.enabled).toBe(false)
    expect(config.allowed_sic_prefixes).toBeUndefined()
    expect(config.excluded_sic_prefixes).toBeUndefined()
    expect(config.allowed_archetypes).toBeUndefined()
    expect(config.min_market_cap_musd).toBeUndefined()
    expect(config.max_market_cap_musd).toBeUndefined()
  })

  it('DEFAULT_CIRCLE_OF_COMPETENCE matches the factory default and is frozen-safe (no shared mutation)', () => {
    expect(defaultCircleOfCompetenceConfig()).toEqual(DEFAULT_CIRCLE_OF_COMPETENCE)
    // Factory returns a fresh object each call so callers cannot mutate the shared default
    expect(defaultCircleOfCompetenceConfig()).not.toBe(defaultCircleOfCompetenceConfig())
  })
})

describe('mergeCircleOfCompetenceConfig', () => {
  it('returns the permissive default when called with no argument', () => {
    expect(mergeCircleOfCompetenceConfig()).toEqual(defaultCircleOfCompetenceConfig())
  })

  it('returns the permissive default when called with undefined', () => {
    expect(mergeCircleOfCompetenceConfig(undefined)).toEqual(defaultCircleOfCompetenceConfig())
  })

  it('does not mutate the partial passed in', () => {
    const partial: Partial<CircleOfCompetenceConfig> = { enabled: true, excluded_sic_prefixes: ['6'] }
    const snapshot = JSON.parse(JSON.stringify(partial))
    mergeCircleOfCompetenceConfig(partial)
    expect(partial).toEqual(snapshot)
  })

  it('spreads a partial over the permissive default: enabled + excluded_sic_prefixes', () => {
    const merged = mergeCircleOfCompetenceConfig({ enabled: true, excluded_sic_prefixes: ['6'] })
    expect(merged.enabled).toBe(true)
    expect(merged.excluded_sic_prefixes).toEqual(['6'])
    // Untouched optional fields stay undefined (permissive)
    expect(merged.allowed_sic_prefixes).toBeUndefined()
    expect(merged.allowed_archetypes).toBeUndefined()
    expect(merged.min_market_cap_musd).toBeUndefined()
    expect(merged.max_market_cap_musd).toBeUndefined()
  })

  it('keeps valid allowed lists and archetypes (string arrays)', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      allowed_sic_prefixes: ['20', '28'],
      allowed_archetypes: ['compounder', 'special-situation'],
    })
    expect(merged.allowed_sic_prefixes).toEqual(['20', '28'])
    expect(merged.allowed_archetypes).toEqual(['compounder', 'special-situation'])
  })

  // --- Fail-closed-to-permissive on invalid values ---

  it('fail-closed: non-array list fields are dropped (treated as permissive/unset)', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      allowed_sic_prefixes: 'not-an-array' as unknown as string[],
      excluded_sic_prefixes: 42 as unknown as string[],
      allowed_archetypes: {} as unknown as string[],
    })
    expect(merged.allowed_sic_prefixes).toBeUndefined()
    expect(merged.excluded_sic_prefixes).toBeUndefined()
    expect(merged.allowed_archetypes).toBeUndefined()
  })

  it('fail-closed: non-string entries inside a list are filtered out', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      allowed_sic_prefixes: ['20', 28 as unknown as string, '', '  ', '28'] as string[],
    })
    expect(merged.allowed_sic_prefixes).toEqual(['20', '28'])
  })

  it('fail-closed: an all-invalid list collapses to undefined (permissive)', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      allowed_sic_prefixes: [42, null, ''] as unknown as string[],
    })
    expect(merged.allowed_sic_prefixes).toBeUndefined()
  })

  it('fail-closed: negative market-cap bounds are dropped (permissive)', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      min_market_cap_musd: -100,
      max_market_cap_musd: -1,
    })
    expect(merged.min_market_cap_musd).toBeUndefined()
    expect(merged.max_market_cap_musd).toBeUndefined()
  })

  it('fail-closed: NaN / non-finite market-cap bounds are dropped (permissive)', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      min_market_cap_musd: Number.NaN,
      max_market_cap_musd: Number.POSITIVE_INFINITY,
    })
    expect(merged.min_market_cap_musd).toBeUndefined()
    expect(merged.max_market_cap_musd).toBeUndefined()
  })

  it('market-cap bounds: valid values are kept and rounded sanely', () => {
    const merged = mergeCircleOfCompetenceConfig({
      enabled: true,
      min_market_cap_musd: 250.4,
      max_market_cap_musd: 2000.6,
    })
    expect(merged.min_market_cap_musd).toBe(250)
    expect(merged.max_market_cap_musd).toBe(2001)
  })

  it('market-cap bounds: zero min is permitted (down-the-cap edge), kept as 0', () => {
    const merged = mergeCircleOfCompetenceConfig({ enabled: true, min_market_cap_musd: 0 })
    expect(merged.min_market_cap_musd).toBe(0)
  })

  it('never throws on garbage input', () => {
    expect(() => mergeCircleOfCompetenceConfig({
      enabled: 'yes' as unknown as boolean,
      allowed_sic_prefixes: null as unknown as string[],
      min_market_cap_musd: 'big' as unknown as number,
    })).not.toThrow()
  })
})

describe('legacy config back-compat', () => {
  it('parses correctly when automation is absent (legacy config)', () => {
    // Simulate a legacy config read from disk (no automation field)
    const legacyConfig = {
      version: 1 as const,
      mode: 'personal-local' as const,
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

  it('includes a permissive circle_of_competence by default', () => {
    const config = defaultPersonalLocalAppConfig()
    expect(config.circle_of_competence).toEqual(defaultCircleOfCompetenceConfig())
  })
})

describe('defaultSavingsSleeveConfig', () => {
  it('has sensible owner-tunable defaults: 2% expected rate, mudarabah, 5% equity risk margin', () => {
    expect(defaultSavingsSleeveConfig()).toEqual<SavingsSleeveConfig>({
      savings_expected_profit_rate: 0.02,
      savings_model: 'mudarabah',
      equity_risk_margin: 0.05,
    })
  })

  it('uses a capital-stable profit-sharing model (mudarabah), NOT a Treasury bill', () => {
    // The model is mudarabah — capital-stable, profit-sharing — never a guaranteed/risk-free instrument.
    expect(defaultSavingsSleeveConfig().savings_model).toBe('mudarabah')
  })

  it('returns a fresh copy so callers cannot mutate the shared default', () => {
    const a = defaultSavingsSleeveConfig()
    a.savings_expected_profit_rate = 0.99
    expect(defaultSavingsSleeveConfig().savings_expected_profit_rate).toBe(0.02)
    expect(DEFAULT_SAVINGS_SLEEVE.savings_expected_profit_rate).toBe(0.02)
  })
})

describe('mergeSavingsSleeveConfig', () => {
  it('returns defaults for undefined / legacy config (no savings field)', () => {
    expect(mergeSavingsSleeveConfig()).toEqual(defaultSavingsSleeveConfig())
    expect(mergeSavingsSleeveConfig(undefined)).toEqual(defaultSavingsSleeveConfig())
  })

  it('merges over a partial config, filling missing fields with defaults', () => {
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03 })).toEqual<SavingsSleeveConfig>({
      savings_expected_profit_rate: 0.03,
      savings_model: 'mudarabah',
      equity_risk_margin: 0.05,
    })
    expect(mergeSavingsSleeveConfig({ equity_risk_margin: 0.08 })).toEqual<SavingsSleeveConfig>({
      savings_expected_profit_rate: 0.02,
      savings_model: 'mudarabah',
      equity_risk_margin: 0.08,
    })
  })

  it('always pins savings_model to mudarabah (the only supported capital-stable model)', () => {
    expect(mergeSavingsSleeveConfig({ savings_model: 'treasury' as never }).savings_model).toBe('mudarabah')
  })

  it('clamps rates fail-closed-to-default for invalid / out-of-band values', () => {
    // negative, NaN, non-finite, non-number → default
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: -0.5 }).savings_expected_profit_rate).toBe(0.02)
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: Number.NaN }).savings_expected_profit_rate).toBe(0.02)
    expect(mergeSavingsSleeveConfig({ equity_risk_margin: 'x' as never }).equity_risk_margin).toBe(0.05)
    // above the [0, ~0.25] band → fail closed to default (not silently clamped to the ceiling)
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.9 }).savings_expected_profit_rate).toBe(0.02)
    expect(mergeSavingsSleeveConfig({ equity_risk_margin: SAVINGS_RATE_MAX + 0.01 }).equity_risk_margin).toBe(0.05)
  })

  it('accepts in-band values including the boundaries 0 and the max', () => {
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0 }).savings_expected_profit_rate).toBe(0)
    expect(mergeSavingsSleeveConfig({ equity_risk_margin: SAVINGS_RATE_MAX }).equity_risk_margin).toBe(SAVINGS_RATE_MAX)
  })

  it('does not mutate the input partial', () => {
    const partial = { savings_expected_profit_rate: 0.03 }
    mergeSavingsSleeveConfig(partial)
    expect(partial).toEqual({ savings_expected_profit_rate: 0.03 })
  })

  // VINTAGE (#3) — savings_rate_set_at: optional, legacy-tolerant, stamped on a write that sets a non-default
  // rate (injected clock); preserved on round-trip; absent for default / legacy / never-set configs.
  it('leaves savings_rate_set_at undefined for default and legacy configs (never-set)', () => {
    expect(mergeSavingsSleeveConfig().savings_rate_set_at).toBeUndefined()
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03 }).savings_rate_set_at).toBeUndefined()
    // legacy config with a non-default rate but NO vintage stays "not set" when no clock is injected (load).
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.04 }).savings_rate_set_at).toBeUndefined()
  })

  it('stamps savings_rate_set_at with the injected clock when a non-default rate is set/changed', () => {
    const now = '2026-06-28T09:00:00.000Z'
    expect(
      mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03 }, { now }).savings_rate_set_at,
    ).toBe(now)
    // a CHANGE from a prior rate re-stamps.
    expect(
      mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.04 }, { now, previousRate: 0.03 }).savings_rate_set_at,
    ).toBe(now)
  })

  it('does NOT stamp when the rate is the default, or unchanged from the previous rate', () => {
    const now = '2026-06-28T09:00:00.000Z'
    // setting to the frozen default never stamps a vintage (default = "not set").
    expect(mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.02 }, { now }).savings_rate_set_at).toBeUndefined()
    // an unchanged non-default rate (e.g. a write that only touches equity_risk_margin) preserves vintage, no re-stamp.
    expect(
      mergeSavingsSleeveConfig(
        { savings_expected_profit_rate: 0.03, savings_rate_set_at: '2026-01-01T00:00:00.000Z' },
        { now, previousRate: 0.03 },
      ).savings_rate_set_at,
    ).toBe('2026-01-01T00:00:00.000Z')
  })

  it('preserves a valid incoming vintage on round-trip and drops an invalid one', () => {
    expect(
      mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03, savings_rate_set_at: '2026-02-15T00:00:00.000Z' }).savings_rate_set_at,
    ).toBe('2026-02-15T00:00:00.000Z')
    expect(
      mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03, savings_rate_set_at: 'not-a-date' as never }).savings_rate_set_at,
    ).toBeUndefined()
    expect(
      mergeSavingsSleeveConfig({ savings_expected_profit_rate: 0.03, savings_rate_set_at: '' }).savings_rate_set_at,
    ).toBeUndefined()
  })
})

describe('app config defaults include the savings sleeve', () => {
  it('personal-local config carries the default savings sleeve', () => {
    expect(defaultPersonalLocalAppConfig().savings).toEqual(defaultSavingsSleeveConfig())
  })

  it('leaves version unchanged at 1 (additive field, no migration)', () => {
    expect(defaultPersonalLocalAppConfig().version).toBe(1)
  })
})
