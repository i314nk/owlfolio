import { describe, expect, it } from 'vitest'

import {
  deriveAutoTierAssignment,
  type AutoTierConnectedProvider,
} from '../autoTierAssignment'
import { modelRoleIds, type ModelRoleId } from '../modelRegistry'

// A small in-test catalog lookup mirroring the providers modelCatalog shape, so strategies stays free of
// a providers dependency (the catalog is injected).
const CATALOG: Record<string, Array<{ model_id: string; reasoning: true; tier_suitability: Array<'T1' | 'T2' | 'T3'> }>> = {
  claude: [
    { model_id: 'claude-opus-4-8', reasoning: true, tier_suitability: ['T1'] },
    { model_id: 'claude-sonnet-4-6', reasoning: true, tier_suitability: ['T1', 'T2'] },
    { model_id: 'claude-haiku-4-5', reasoning: true, tier_suitability: ['T3'] },
  ],
  openai: [{ model_id: 'gpt-5.5', reasoning: true, tier_suitability: ['T1', 'T2'] }],
  'gemini-developer-api': [{ model_id: 'gemini-2.5-pro', reasoning: true, tier_suitability: ['T1', 'T2'] }],
}

function modelCatalogLookup(providerId: string) {
  return CATALOG[providerId] ?? []
}

const T1_ROLES: ModelRoleId[] = ['synthesis', 'lane_moat', 'lane_shariah', 'lanes_default', 'lane_moat_crosscheck', 'lane_shariah_crosscheck']
const T2_ROLES: ModelRoleId[] = ['quick_screen', 'red_team']
const T3_ROLES: ModelRoleId[] = ['monitors', 'entity_resolve']

describe('deriveAutoTierAssignment', () => {
  it('NO connected providers -> empty assignment (every role inherits the run default)', () => {
    const result = deriveAutoTierAssignment({ connectedProviders: [], modelCatalogLookup })
    expect(result.assignments).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('SINGLE connected provider -> all roles inherit (no per-role pins emitted)', () => {
    const connectedProviders: AutoTierConnectedProvider[] = [
      { provider_id: 'claude', qualified: true },
    ]
    const result = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })
    // Single-provider: today's behavior is inherit-everything — emit no assignments.
    expect(result.assignments).toEqual({})
  })

  it('frontier qualified + cheap connected -> T1/T2/T3 split across roles', () => {
    const connectedProviders: AutoTierConnectedProvider[] = [
      { provider_id: 'claude', qualified: true },
      { provider_id: 'openai', qualified: true },
    ]
    const result = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })

    // Every role is assigned a concrete provider/model.
    for (const role of modelRoleIds) {
      expect(result.assignments[role]).toBeDefined()
      expect(result.assignments[role]?.model.length).toBeGreaterThan(0)
    }

    // T1 roles get the best frontier reasoning model.
    for (const role of T1_ROLES) {
      expect(result.assignments[role]?.model).toBe('claude-opus-4-8')
    }
    // T3 roles get the cheapest connected reasoning model.
    for (const role of T3_ROLES) {
      expect(result.assignments[role]?.model).toBe('claude-haiku-4-5')
    }
    // T2 roles get a mid reasoning model (sonnet or gpt-5.5 — a T2-suitable one).
    for (const role of T2_ROLES) {
      const t2Model = result.assignments[role]?.model
      expect(['claude-sonnet-4-6', 'gpt-5.5']).toContain(t2Model)
    }
  })

  it('NEVER auto-assigns an UNQUALIFIED provider to T1 — falls back to inherit + a warning', () => {
    // The only connected frontier provider is NOT qualified.
    const connectedProviders: AutoTierConnectedProvider[] = [
      { provider_id: 'claude', qualified: false },
    ]
    const result = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })

    // No T1 role may be pinned onto the unqualified provider.
    for (const role of T1_ROLES) {
      expect(result.assignments[role]).toBeUndefined()
    }
    expect(result.warnings.some((w) => /qualif|frontier/i.test(w))).toBe(true)
  })

  it('a qualified frontier provider + an unqualified provider -> T1 only ever uses the qualified one', () => {
    const connectedProviders: AutoTierConnectedProvider[] = [
      { provider_id: 'claude', qualified: true },
      { provider_id: 'gemini-developer-api', qualified: false },
    ]
    const result = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })
    for (const role of T1_ROLES) {
      expect(result.assignments[role]?.provider_id).toBe('claude')
    }
  })

  it('is deterministic — same input yields the same assignment', () => {
    const connectedProviders: AutoTierConnectedProvider[] = [
      { provider_id: 'openai', qualified: true },
      { provider_id: 'claude', qualified: true },
    ]
    const a = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })
    const b = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })
    expect(a).toEqual(b)
  })
})
