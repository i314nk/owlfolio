import { describe, expect, it } from 'vitest'

import {
  certificationScenarioIds,
  getProviderCatalog,
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
    ])
  })

  it('locks provider support semantics and onboarding visibility', () => {
    const catalog = getProviderCatalog()

    expect(catalog.find((provider) => provider.provider_id === 'claude')).toMatchObject({
      support_level: 'experimental',
      visible_in_onboarding: true,
    })
    expect(catalog.find((provider) => provider.provider_id === 'openai')).toMatchObject({
      support_level: 'experimental',
      visible_in_onboarding: true,
    })
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
})
