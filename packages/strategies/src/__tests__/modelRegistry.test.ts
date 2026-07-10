import { describe, expect, it } from 'vitest'
import {
  MODEL_REGISTRY,
  modelRoleIds,
  resolveModelForRole,
  type ModelRoleId,
} from '../modelRegistry'

describe('MODEL_REGISTRY', () => {
  it('is a frozen, versioned config covering every role', () => {
    expect(typeof MODEL_REGISTRY.version).toBe('string')
    expect(Object.isFrozen(MODEL_REGISTRY)).toBe(true)
    for (const role of modelRoleIds) {
      expect(MODEL_REGISTRY.roles[role]).toBeDefined()
    }
  })

  it('keeps temperatures low (0–0.3) for every role per the spec', () => {
    for (const role of modelRoleIds) {
      const t = MODEL_REGISTRY.roles[role].temperature
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(0.3)
    }
  })

  it('does NOT hardcode a provider/model by default — every role inherits (provider/model undefined)', () => {
    // The single-provider default path: no role pins a provider_id or model, so a run reuses its
    // active provider/model unchanged. (Names go stale; the registry + resolver is the durable part.)
    for (const role of modelRoleIds) {
      expect(MODEL_REGISTRY.roles[role].provider_id).toBeUndefined()
      expect(MODEL_REGISTRY.roles[role].model).toBeUndefined()
    }
  })
})

describe('resolveModelForRole', () => {
  const fallback = { fallbackProviderId: 'mock-provider' as const, fallbackModel: 'mock-model' }

  it('defaults a role to the run active provider/model when neither config nor env overrides it', () => {
    const resolved = resolveModelForRole('synthesis', fallback)
    expect(resolved.provider_id).toBe('mock-provider')
    expect(resolved.model).toBe('mock-model')
    expect(resolved.overridden).toBe(false)
    // Temperature comes from the registry, not the fallback.
    expect(resolved.temperature).toBe(MODEL_REGISTRY.roles.synthesis.temperature)
  })

  it('applies a per-role override from an injected config (different provider + model)', () => {
    const resolved = resolveModelForRole('red_team', {
      ...fallback,
      overrides: { red_team: { provider_id: 'openai', model: 'codex-x', temperature: 0.0 } },
    })
    expect(resolved.provider_id).toBe('openai')
    expect(resolved.model).toBe('codex-x')
    expect(resolved.temperature).toBe(0.0)
    expect(resolved.overridden).toBe(true)
  })

  it('applies a per-role override from env (OWLFOLIO_MODEL_ROLE_<ROLE>)', () => {
    const env = { OWLFOLIO_MODEL_ROLE_LANE_MOAT: 'openai:codex-pro@0.1' }
    const resolved = resolveModelForRole('lane_moat', { ...fallback, env })
    expect(resolved.provider_id).toBe('openai')
    expect(resolved.model).toBe('codex-pro')
    expect(resolved.temperature).toBe(0.1)
    expect(resolved.overridden).toBe(true)
  })

  it('lets env override only the model, inheriting the fallback provider', () => {
    const env = { OWLFOLIO_MODEL_ROLE_RED_TEAM: 'codex-mini' }
    const resolved = resolveModelForRole('red_team', { ...fallback, env })
    expect(resolved.provider_id).toBe('mock-provider') // inherited
    expect(resolved.model).toBe('codex-mini')
    expect(resolved.overridden).toBe(true)
  })

  it('exposes a stable role id set', () => {
    const expected: ModelRoleId[] = [
      'synthesis',
      'lanes_default',
      'lane_moat',
      'lane_shariah',
      'red_team',
      'monitors',
      'entity_resolve',
      'lane_moat_crosscheck',
      'lane_shariah_crosscheck',
    ]
    expect([...modelRoleIds].sort()).toEqual([...expected].sort())
  })
})
