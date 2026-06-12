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

  it('openai-api default is upgraded to a reasoning model (gpt-4.1-mini is NOT reasoning-capable)', () => {
    const models = curatedModelsForProvider('openai-api')
    expect(models.some((m) => m.model_id === 'gpt-5.5')).toBe(true)
    // The non-reasoning legacy default must never appear in a reasoning-only catalog.
    expect(models.some((m) => m.model_id === 'gpt-4.1-mini')).toBe(false)
  })

  it('claude curated set leads with the frontier reasoning models', () => {
    const models = curatedModelsForProvider('claude')
    const ids = models.map((m) => m.model_id)
    expect(ids).toContain('claude-opus-4-8')
    expect(ids).toContain('claude-sonnet-4-6')
    const opus = models.find((m) => m.model_id === 'claude-opus-4-8')
    expect(opus?.tier_suitability).toContain('T1')
  })

  it('gemini-developer-api curates gemini-2.5-pro (T1/T2)', () => {
    const gemini = curatedModelsForProvider('gemini-developer-api')
    const pro = gemini.find((m) => m.model_id === 'gemini-2.5-pro')
    expect(pro).toBeDefined()
    expect(pro?.tier_suitability).toEqual(expect.arrayContaining(['T1', 'T2']))
  })

  it('openrouter curates a SHORT set of reasoning routes', () => {
    const routes = curatedModelsForProvider('openrouter')
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.length).toBeLessThanOrEqual(4)
    expect(routes.every((m) => m.reasoning)).toBe(true)
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
    expect(curatedModelsForProvider('gemini-cli')).toEqual([])
  })

  it('demo-only models are typed as CuratedModel with reasoning still true', () => {
    const mock: CuratedModel = curatedModelsForProvider('mock-provider')[0]!
    expect(mock.reasoning).toBe(true)
  })
})
