import { describe, expect, it } from 'vitest'

import {
  certificationScenarioIds,
  getProviderCatalog,
  MockProvider,
  providerCapabilityIds,
  type ProviderRunRequest,
} from '../index'

describe('provider contract freeze', () => {
  it('exposes the Milestone 2 provider capability set', () => {
    expect(providerCapabilityIds).toEqual([
      'text-generation',
      'structured-output',
      'tool-function-calling',
      'streaming-observability',
      'multi-step-tool-loop',
      'source-grounding',
      'citation-metadata',
      'url-context',
      'file-context',
      'source-bundle-production',
      'code-execution',
      'computer-use',
      'browser-use',
    ])
  })

  it('locks provider support semantics and onboarding visibility', () => {
    const catalog = getProviderCatalog()

    // PROVIDER CONSOLIDATION (owner, 2026-07-18): OpenRouter is the one real provider; 'local'
    // (Ollama / vLLM) is the experimental UNTESTED surface; mock-provider is internal test
    // infrastructure. The direct openai-api/anthropic-api/gemini-developer-api surfaces are removed.
    expect(catalog.map((provider) => provider.provider_id).sort()).toEqual(['local', 'mock-provider', 'openrouter'])
    expect(catalog.find((provider) => provider.provider_id === 'openrouter')).toMatchObject({
      support_level: 'experimental',
      visible_in_onboarding: true,
    })
    const local = catalog.find((provider) => provider.provider_id === 'local')
    expect(local).toMatchObject({
      support_level: 'experimental',
      visible_in_onboarding: true,
    })
    // The local surface must SAY it is unstable/experimental/untested — never quietly normal.
    expect(`${local?.label} ${local?.description}`.toLowerCase()).toContain('untested')
    expect(`${local?.label} ${local?.description}`.toLowerCase()).toContain('experimental')
    expect(local?.description.toLowerCase()).toContain('unstable')
    expect(catalog.find((provider) => provider.provider_id === 'mock-provider')).toMatchObject({
      support_level: 'certified',
      visible_in_onboarding: true,
    })
  })

  it('defines the minimum certification scenario set before real adapters land', () => {
    expect(certificationScenarioIds).toContain('simple-completion')
    expect(certificationScenarioIds).toContain('multi-step-tool-loop')
    expect(certificationScenarioIds).toContain('ledger-update-proposal')
    expect(certificationScenarioIds).toContain('end-to-end-demo-workflow')
  })

  it('defines structured provider runs with explicit observability fields', () => {
    const request: ProviderRunRequest = {
      run_id: 'run_contract_001',
      provider_id: 'mock-provider',
      model_id: 'mock-research-v2',
      task_kind: 'structured-output',
      prompt: 'Return a Buffett-Munger research summary',
      timeout_ms: 1000,
      budget: { max_tool_calls: 1, max_tokens: 500 },
      tool_allowlist: ['source.fetch'],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
    }

    expect(request.task_kind).toBe('structured-output')
    expect(request.response_format.kind).toBe('json-schema')
  })

  it('preserves provider surface/auth/runtime/role context in adapter run metadata', async () => {
    const request: ProviderRunRequest = {
      run_id: 'run_contract_surface_metadata_001',
      provider_id: 'mock-provider',
      provider_surface_id: 'mock-provider',
      vendor_id: 'mock',
      runtime_kind: 'built_in',
      auth_mode: 'built_in_demo',
      workflow_role: 'research_draft',
      model_id: 'mock-research-v2',
      task_kind: 'structured-output',
      prompt: 'Return a Buffett-Munger research summary',
      timeout_ms: 1000,
      budget: { max_tool_calls: 1, max_tokens: 500 },
      tool_allowlist: ['source.fetch'],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
    }

    const completion = await new MockProvider().complete(request)

    expect(completion.metadata).toMatchObject({
      provider_id: 'mock-provider',
      provider_surface_id: 'mock-provider',
      vendor_id: 'mock',
      runtime_kind: 'built_in',
      auth_mode: 'built_in_demo',
      workflow_role: 'research_draft',
      run_id: 'run_contract_surface_metadata_001',
    })
  })
})
