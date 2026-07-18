import { describe, expect, it } from 'vitest'

import {
  CURATED_MODEL_CATALOG_VERSION,
  curatedModelsForProvider,
  curatedRealModelsForProvider,
  getCuratedModelCatalog,
  isCuratedModel,
  type CuratedModel,
} from '../modelCatalog'

describe('curated reasoning-model catalog (tier-free — model tiering removed, owner 2026-07-18)', () => {
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

  it('PROVIDER CONSOLIDATION: only mock-provider and openrouter carry curated lists; the removed direct APIs are gone', () => {
    const catalog = getCuratedModelCatalog()
    expect(Object.keys(catalog).sort()).toEqual(['mock-provider', 'openrouter'])
    expect(curatedModelsForProvider('openai-api')).toEqual([])
    expect(curatedModelsForProvider('anthropic-api')).toEqual([])
    expect(curatedModelsForProvider('gemini-developer-api')).toEqual([])
    // The local (Ollama / vLLM) surface has no curated list — model ids vary per install; the
    // free-form selector input is the entry path.
    expect(curatedModelsForProvider('local')).toEqual([])
  })

  it('openrouter curates the current-generation reasoning candidate menu (exact pinned ids)', () => {
    const routes = curatedModelsForProvider('openrouter')
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.every((m) => m.reasoning)).toBe(true)
    // Exact pinned ids only — no drifting `~*-latest` aliases under a per-target certification.
    expect(routes.every((m) => !m.model_id.includes('~') && !m.model_id.endsWith('-latest'))).toBe(true)
    const ids = routes.map((m) => m.model_id)
    expect(ids).toEqual(expect.arrayContaining(['anthropic/claude-opus-4.8', 'openai/gpt-5.5', 'x-ai/grok-4.3']))
    // Stale prior-generation ids are dropped.
    expect(ids).not.toContain('deepseek/deepseek-r1')
  })

  it('mock-provider deterministic demo model is excluded from real suggestions', () => {
    const mock = curatedModelsForProvider('mock-provider')
    expect(mock.length).toBe(1)
    expect(mock[0]?.demo_only).toBe(true)
    expect(curatedRealModelsForProvider('mock-provider')).toEqual([])
    expect(curatedRealModelsForProvider('openrouter').length).toBeGreaterThan(0)
  })

  it('isCuratedModel recognises a known curated model and rejects an uncurated id', () => {
    expect(isCuratedModel('openrouter', 'anthropic/claude-opus-4.8')).toBe(true)
    expect(isCuratedModel('openrouter', 'some-unverified-model')).toBe(false)
    expect(isCuratedModel('unknown-provider', 'anthropic/claude-opus-4.8')).toBe(false)
  })

  it('returns an empty list for a provider with no curated models', () => {
    expect(curatedModelsForProvider('some-unknown-provider')).toEqual([])
  })

  it('demo-only models are typed as CuratedModel with reasoning still true', () => {
    const mock: CuratedModel = curatedModelsForProvider('mock-provider')[0]!
    expect(mock.reasoning).toBe(true)
  })
})
