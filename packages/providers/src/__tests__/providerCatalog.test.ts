import { describe, expect, it } from 'vitest'

import { ClaudeCliProvider } from '../claudeCliProvider'
import { getProviderCatalog } from '../providerCatalog'
import { MockProvider } from '../mockProvider'
import { OpenAICodexCliProvider } from '../openaiCodexCliProvider'
import { providerCapabilityIds } from '../providerContract'

function catalogEntry(providerId: string) {
  const entry = getProviderCatalog().find((provider) => provider.provider_id === providerId)
  if (entry === undefined) {
    throw new Error(`Missing provider catalog entry: ${providerId}`)
  }
  return entry
}

function surfaceEntry(surfaceId: string) {
  const entry = getProviderCatalog().find((provider) => provider.provider_surface_id === surfaceId)
  if (entry === undefined) {
    throw new Error(`Missing provider catalog surface: ${surfaceId}`)
  }
  return entry
}

describe('provider catalog support semantics', () => {
  it('does not advertise capabilities above the resolved adapter implementation', () => {
    expect(catalogEntry('mock-provider').capabilities).toEqual(new MockProvider().capabilities)
    expect(catalogEntry('claude').capabilities).toEqual(new ClaudeCliProvider().capabilities)
    expect(catalogEntry('openai').capabilities).toEqual(new OpenAICodexCliProvider().capabilities)
  })

  it('keeps CLI-backed real providers experimental until certification proves full workflow parity', () => {
    expect(catalogEntry('mock-provider')).toMatchObject({ support_level: 'certified' })
    expect(catalogEntry('claude')).toMatchObject({ support_level: 'experimental' })
    expect(catalogEntry('openai')).toMatchObject({ support_level: 'experimental' })
  })

  it('freezes distinct provider family and certifiable surface identities', () => {
    expect(surfaceEntry('openai-api')).toMatchObject({
      provider_surface_id: 'openai-api',
      vendor_id: 'openai',
      provider_family_id: 'openai',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      support_level: 'unsupported',
      visible_in_onboarding: false,
    })
    expect(surfaceEntry('openai-api')).not.toHaveProperty('compatibility_provider_id')
    expect(surfaceEntry('openai-codex-cli')).toMatchObject({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      vendor_id: 'openai',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      support_level: 'experimental',
      compatibility_provider_id: 'openai',
    })
    expect(surfaceEntry('gemini-developer-api')).toMatchObject({
      provider_surface_id: 'gemini-developer-api',
      vendor_id: 'google-gemini',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      visible_in_onboarding: false,
    })
    expect(surfaceEntry('gemini-cli')).toMatchObject({
      provider_surface_id: 'gemini-cli',
      vendor_id: 'google-gemini',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      visible_in_onboarding: true,
    })
  })

  it('carries auth, billing, quota, privacy, automation, and workflow-role metadata without capability overclaims', () => {
    expect(providerCapabilityIds).toEqual(expect.arrayContaining([
      'source-grounding',
      'citation-metadata',
      'url-context',
      'file-context',
      'source-bundle-production',
      'code-execution',
      'computer-use',
      'browser-use',
    ]))

    expect(surfaceEntry('openai-codex-cli')).toMatchObject({
      billing: { billing_mode: 'subscription_entitlement', quota_source: 'subscription_tier', quota_status: 'unknown' },
      privacy: { data_policy_source: 'subscription_workspace_policy', retention_or_zdr_status: 'not_verified' },
      automation: { headless_supported: false, scheduled_workflow_supported: false, automation_suitability: 'personal_local_interactive' },
      workflow_roles: expect.arrayContaining(['research_draft', 'source_bundle_draft']),
      role_capabilities: expect.objectContaining({
        source_grounding: 'adapter',
        source_bundle_production: 'adapter',
        code_execution: 'unsupported',
        browser_use: 'unsupported',
      }),
    })

    expect(surfaceEntry('openai-api').capabilities).toMatchObject({
      'tool-function-calling': 'unsupported',
      'multi-step-tool-loop': 'unsupported',
    })
    expect(surfaceEntry('gemini-developer-api').support_level).toBe('unsupported')
    expect(surfaceEntry('gemini-cli').support_level).toBe('unsupported')
  })
})
