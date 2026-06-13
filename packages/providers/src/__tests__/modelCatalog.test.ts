import { describe, expect, it } from 'vitest'

import {
  CURATED_MODEL_CATALOG_VERSION,
  curatedModelsForProvider,
  getCuratedModelCatalog,
  isCuratedModel,
  type CuratedModel,
} from '../modelCatalog'

describe('curated reasoning-model catalog', () => {
  it('is versioned (these lists go stale; the version makes that explicit)', () => {
    expect(typeof CURATED_MODEL_CATALOG_VERSION).toBe('string')
    expect(CURATED_MODEL_CATALOG_VERSION.length).toBeGreaterThan(0)
  })

  it('OWNER INVARIANT: every curated entry is reasoning/thinking-capable', () => {
    const catalog = getCuratedModelCatalog()
    const allModels = Object.values(catalog).flat()
    expect(allModels.length).toBeGreaterThan(0)
    for (const model of allModels) {
      expect(model.reasoning).toBe(true)
    }
  })

  it('every non-demo curated entry declares at least one valid tier suitability', () => {
    for (const model of Object.values(getCuratedModelCatalog()).flat()) {
      if (model.demo_only !== true) {
        expect(model.tier_suitability.length).toBeGreaterThan(0)
      }
      for (const tier of model.tier_suitability) {
        expect(['T1', 'T2', 'T3']).toContain(tier)
      }
    }
  })

  it('anchors on the repo defaults: openai/codex CLI -> gpt-5.5 (T1/T2)', () => {
    const models = curatedModelsForProvider('openai')
    const gpt = models.find((m) => m.model_id === 'gpt-5.5')
    expect(gpt).toBeDefined()
    expect(gpt?.tier_suitability).toEqual(expect.arrayContaining(['T1', 'T2']))
  })

  it('claude curated set leads with the frontier reasoning models', () => {
    const models = curatedModelsForProvider('claude')
    const ids = models.map((m) => m.model_id)
    expect(ids).toContain('claude-opus-4-8')
    expect(ids).toContain('claude-sonnet-4-6')
    const opus = models.find((m) => m.model_id === 'claude-opus-4-8')
    expect(opus?.tier_suitability).toContain('T1')
  })

  it('openrouter curates the current-generation reasoning candidate menu across every tier (exact pinned ids)', () => {
    const routes = curatedModelsForProvider('openrouter')
    expect(routes.length).toBeGreaterThan(0)
    // Reasoning-only invariant + every tier represented (T1/T2/T3) for the tier selectors.
    expect(routes.every((m) => m.reasoning)).toBe(true)
    const tiers = new Set(routes.flatMap((m) => m.tier_suitability))
    expect(tiers.has('T1')).toBe(true)
    expect(tiers.has('T2')).toBe(true)
    expect(tiers.has('T3')).toBe(true)
    // Exact pinned ids only — no drifting `~*-latest` aliases under a per-target certification.
    expect(routes.every((m) => !m.model_id.includes('~') && !m.model_id.endsWith('-latest'))).toBe(true)
    // T1 anchors on the frontier reasoning ids the owner curated.
    const t1 = routes.filter((m) => m.tier_suitability.includes('T1')).map((m) => m.model_id)
    expect(t1).toEqual(expect.arrayContaining(['anthropic/claude-opus-4.8', 'openai/gpt-5.5', 'x-ai/grok-4.3']))
    // Stale prior-generation ids are dropped.
    expect(routes.some((m) => m.model_id === 'deepseek/deepseek-r1')).toBe(false)
  })

  it('mock-provider deterministic demo model is excluded from real-tier suggestions', () => {
    const mock = curatedModelsForProvider('mock-provider')
    expect(mock.length).toBe(1)
    expect(mock[0]?.demo_only).toBe(true)
    // Demo-only models carry no real-tier suitability.
    expect(mock[0]?.tier_suitability.length).toBe(0)
  })

  it('isCuratedModel recognises a known curated model and rejects an uncurated id', () => {
    expect(isCuratedModel('claude', 'claude-opus-4-8')).toBe(true)
    expect(isCuratedModel('claude', 'some-unverified-model')).toBe(false)
    expect(isCuratedModel('unknown-provider', 'claude-opus-4-8')).toBe(false)
  })

  it('returns an empty list for a provider with no curated models', () => {
    expect(curatedModelsForProvider('some-unknown-provider')).toEqual([])
  })

  it('demo-only models are typed as CuratedModel with reasoning still true', () => {
    const mock: CuratedModel = curatedModelsForProvider('mock-provider')[0]!
    expect(mock.reasoning).toBe(true)
  })
})
