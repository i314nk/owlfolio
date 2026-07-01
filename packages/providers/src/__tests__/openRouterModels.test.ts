import { describe, expect, it } from 'vitest'

import { fetchOpenRouterModels, isHarnessSelectableModel, type OpenRouterCatalogModel } from '../openRouterModels'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

describe('fetchOpenRouterModels', () => {
  it('normalizes, de-duplicates, and id-sorts the live catalog; sends the key without leaking it', async () => {
    let sentAuth: string | undefined
    let requestedUrl: string | undefined
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      requestedUrl = url
      sentAuth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return jsonResponse({
        data: [
          { id: 'z-ai/glm-5.2', name: 'GLM 5.2', context_length: 200000, supported_parameters: ['tools', 'tool_choice', 'response_format', 'reasoning'] },
          { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', supported_parameters: ['tools', 'structured_outputs', 'reasoning'] },
          { id: 'z-ai/glm-5.2', name: 'duplicate dropped' },
          { id: '', name: 'empty id dropped' },
          { name: 'missing id dropped' },
        ],
      })
    }) as unknown as typeof fetch

    const models = await fetchOpenRouterModels({ apiKey: 'or-secret-key', fetchImpl })

    expect(requestedUrl).toBe('https://openrouter.ai/api/v1/models')
    expect(sentAuth).toBe('Bearer or-secret-key')
    // de-duplicated + id-sorted, invalid entries dropped
    expect(models.map((model) => model.id)).toEqual(['anthropic/claude-opus-4.8', 'z-ai/glm-5.2'])
    expect(models[1]).toMatchObject({ id: 'z-ai/glm-5.2', name: 'GLM 5.2', context_length: 200000 })
    // a model with no name falls back to its id
    expect(models[0]?.name).toBe('Claude Opus 4.8')
    // capability flags parsed from supported_parameters (reasoning + tools + structured output)
    expect(models[0]).toMatchObject({ reasoning: true, tools: true, structured_output: true })
    expect(models[1]).toMatchObject({ reasoning: true, tools: true, structured_output: true })
    // the key never appears in the serialized result
    expect(JSON.stringify(models)).not.toContain('or-secret-key')
  })

  it('omits the Authorization header when no key is provided (public endpoint)', async () => {
    let sentAuth: string | undefined | null = null
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentAuth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return jsonResponse({ data: [{ id: 'openai/gpt-5.5', name: 'GPT-5.5' }] })
    }) as unknown as typeof fetch

    const models = await fetchOpenRouterModels({ fetchImpl })
    expect(sentAuth).toBeUndefined()
    expect(models).toHaveLength(1)
  })

  it('throws on a non-OK response so callers can fail-closed to the curated list', async () => {
    const fetchImpl = (async () => jsonResponse({}, { ok: false, status: 503 })) as unknown as typeof fetch
    await expect(fetchOpenRouterModels({ fetchImpl })).rejects.toThrow(/HTTP 503/)
  })

  it('tolerates a missing data array', async () => {
    const fetchImpl = (async () => jsonResponse({})) as unknown as typeof fetch
    expect(await fetchOpenRouterModels({ fetchImpl })).toEqual([])
  })
})

describe('isHarnessSelectableModel', () => {
  const base: OpenRouterCatalogModel = { id: 'x', name: 'x', reasoning: true, tools: true, structured_output: true }

  it('requires reasoning AND tools AND structured output', () => {
    expect(isHarnessSelectableModel(base)).toBe(true)
    expect(isHarnessSelectableModel({ ...base, reasoning: false })).toBe(false)   // non-reasoning excluded
    expect(isHarnessSelectableModel({ ...base, tools: false })).toBe(false)        // can't run the grounded loop
    expect(isHarnessSelectableModel({ ...base, structured_output: false })).toBe(false) // synthesis would fail
  })
})
