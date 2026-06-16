import { describe, expect, it } from 'vitest'

import { ClaudeCliProvider } from '../claudeCliProvider'
import type { CertificationReport } from '../certificationContract'
import { getProviderCatalog, isInvestmentGradeSuitable } from '../providerCatalog'
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
    expect(surfaceEntry('openai-codex-cli')).toMatchObject({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      vendor_id: 'openai',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      support_level: 'experimental',
      compatibility_provider_id: 'openai',
    })
    expect(surfaceEntry('claude-cli')).toMatchObject({
      provider_id: 'claude',
      provider_surface_id: 'claude-cli',
      vendor_id: 'anthropic',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      support_level: 'experimental',
    })
    expect(surfaceEntry('openrouter-api')).toMatchObject({
      provider_id: 'openrouter',
      provider_surface_id: 'openrouter-api',
      vendor_id: 'openrouter',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      support_level: 'experimental',
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

  })

  it('reduces to the two real provider lanes plus mock + claude (OpenRouter + Codex CLI owner decision)', () => {
    // Owner decision: standardize on OpenRouter (all API models, one key) + Codex CLI. The redundant
    // direct-HTTP adapters (openai-api, gemini-developer-api) and the unwired catalog-only entries
    // (gemini-cli, deepseek, qwen, mistral) are retired.
    const ids = getProviderCatalog().map((entry) => entry.provider_id).sort()
    expect(ids).toEqual(['claude', 'mock-provider', 'openai', 'openrouter'])
  })

  it('keeps OpenRouter the meta-provider as an experimental/fail-closed entry surfaced in onboarding', () => {
    expect(catalogEntry('openrouter')).toMatchObject({
      provider_id: 'openrouter',
      provider_surface_id: 'openrouter-api',
      support_level: 'experimental',
      visible_in_onboarding: true,
      investment_grade_candidate: true,
      model_tier: 'frontier',
    })
    expect(catalogEntry('openrouter').description).toContain('per-model certification still required')

    // Only the mock provider is certified in the catalog.
    expect(getProviderCatalog().filter((entry) => entry.support_level === 'certified').map((entry) => entry.provider_id)).toEqual(['mock-provider'])
  })
})

describe('isInvestmentGradeSuitable gate', () => {
  function completedCertifiedReport(groundedPassed: boolean): Pick<CertificationReport, 'run_status' | 'support_level' | 'cases'> {
    return {
      run_status: 'completed',
      support_level: 'certified',
      cases: [
        {
          scenario_id: 'source-grounded-research-task',
          title: 'Source grounded research task',
          required_for_support_level: 'certified',
          passed: groundedPassed,
          status: groundedPassed ? 'passed' : 'failed',
          details: 'test',
          capability_gates: [],
        },
      ],
    }
  }

  it('marks a candidate suitable only when a certified report passes the grounded-research scenario', () => {
    expect(isInvestmentGradeSuitable({ investment_grade_candidate: true }, completedCertifiedReport(true))).toBe(true)
  })

  it('does not mark an experimental candidate suitable without a certified report', () => {
    expect(isInvestmentGradeSuitable({ investment_grade_candidate: true }, undefined)).toBe(false)
    expect(isInvestmentGradeSuitable({ investment_grade_candidate: true }, { run_status: 'completed', support_level: 'experimental', cases: [] })).toBe(false)
    expect(isInvestmentGradeSuitable({ investment_grade_candidate: true }, completedCertifiedReport(false))).toBe(false)
  })

  it('does not mark a non-candidate suitable even with a certified grounded report', () => {
    expect(isInvestmentGradeSuitable({ investment_grade_candidate: false }, completedCertifiedReport(true))).toBe(false)
    expect(isInvestmentGradeSuitable({}, completedCertifiedReport(true))).toBe(false)
  })

  it('keeps every candidate provider non-suitable today (no certified reports exist)', () => {
    for (const providerId of ['openrouter', 'claude', 'openai'] as const) {
      const entry = getProviderCatalog().find((candidate) => candidate.provider_id === providerId)
      expect(entry).toBeDefined()
      expect(isInvestmentGradeSuitable(entry!, undefined)).toBe(false)
    }
  })
})
