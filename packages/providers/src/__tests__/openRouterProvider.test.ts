import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { OpenRouterProvider } from '../openRouterProvider'
import { resolveProvider } from '../providerFactory'
import type { ProviderRunRequest } from '../providerContract'

const request: ProviderRunRequest = {
  run_id: 'run_openrouter_001',
  provider_id: 'openrouter',
  provider_surface_id: 'openrouter-api',
  vendor_id: 'openrouter',
  runtime_kind: 'direct_api',
  auth_mode: 'api_key',
  workflow_role: 'research_draft',
  model_id: 'openrouter/auto',
  task_kind: 'text-generation',
  prompt: 'Analyze Microsoft as a Buffett-Munger candidate.',
  timeout_ms: 30_000,
  budget: { max_tool_calls: 1, max_tokens: 4_000 },
  tool_allowlist: [],
  response_format: { kind: 'text' },
}

describe('OpenRouterProvider (fail-closed skeleton)', () => {
  it('is not ready without OPENROUTER_API_KEY', () => {
    const provider = new OpenRouterProvider({ env: {} })
    expect(provider.isReady()).toBe(false)
  })

  it('reports ready credential detection when OPENROUTER_API_KEY is present', () => {
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'test-key' } })
    expect(provider.isReady()).toBe(true)
  })

  it('fails closed on completion when no credentials are present', async () => {
    const provider = new OpenRouterProvider({ env: {} })
    await expect(provider.complete(request)).rejects.toThrow(/not configured: missing OPENROUTER_API_KEY/)
  })

  it('fails closed for research execution even when credentials are present (no certification yet)', async () => {
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'test-key' } })
    await expect(provider.complete(request)).rejects.toThrow(/not certified for Owlfolio research/)
    await expect(provider.structured(request, z.object({ ok: z.boolean() }))).rejects.toThrow(/not certified for Owlfolio research/)
    await expect(provider.runWithTools(request)).rejects.toThrow(/not certified for Owlfolio research/)
  })

  it('is resolvable through the provider factory', () => {
    const provider = resolveProvider({ provider_id: 'openrouter', env: { OPENROUTER_API_KEY: 'test-key' } })
    expect(provider.provider_id).toBe('openrouter')
  })

  it('does not overclaim capabilities', () => {
    const provider = new OpenRouterProvider({ env: {} })
    expect(provider.capabilities['source-grounding']).toBe('unsupported')
    expect(provider.capabilities['multi-step-tool-loop']).toBe('unsupported')
  })
})
