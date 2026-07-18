import { describe, expect, it } from 'vitest'

import type { CertificationReport } from '../certificationContract'
import { getProviderCatalog, isInvestmentGradeSuitable } from '../providerCatalog'
import { MockProvider } from '../mockProvider'
import { OpenRouterProvider } from '../openRouterProvider'
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
    // OpenRouter + the experimental local surface both run the generalized OpenAI-compatible adapter.
    const openRouterCapabilities = new OpenRouterProvider({ apiKey: 'x' }).capabilities
    expect(catalogEntry('openrouter').capabilities).toEqual(openRouterCapabilities)
    expect(catalogEntry('local').capabilities).toEqual(openRouterCapabilities)
  })

  it('keeps the real providers experimental until certification proves full workflow parity', () => {
    expect(catalogEntry('mock-provider')).toMatchObject({ support_level: 'certified' })
    expect(catalogEntry('openrouter')).toMatchObject({ support_level: 'experimental' })
    expect(catalogEntry('local')).toMatchObject({ support_level: 'experimental' })
  })

  it('freezes distinct provider family and certifiable surface identities', () => {
    expect(surfaceEntry('local')).toMatchObject({
      provider_id: 'local',
      provider_surface_id: 'local',
      vendor_id: 'local',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
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

    expect(surfaceEntry('openrouter-api')).toMatchObject({
      billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
      privacy: { retention_or_zdr_status: 'not_verified' },
      workflow_roles: expect.arrayContaining(['research_draft', 'source_bundle_draft']),
    })

  })

  it('offers mock + OpenRouter + the experimental local surface only (PROVIDER CONSOLIDATION)', () => {
    // PROVIDER CONSOLIDATION (owner, 2026-07-18): OpenRouter is the one real provider; 'local'
    // (Ollama / vLLM) is the experimental UNTESTED surface; the direct API-key providers are removed.
    const ids = getProviderCatalog().map((entry) => entry.provider_id).sort()
    expect(ids).toEqual(['local', 'mock-provider', 'openrouter'])
  })

  it('keeps OpenRouter the meta-provider as an experimental/fail-closed entry surfaced in onboarding', () => {
    expect(catalogEntry('openrouter')).toMatchObject({
      provider_id: 'openrouter',
      provider_surface_id: 'openrouter-api',
      support_level: 'experimental',
      visible_in_onboarding: true,
      investment_grade_candidate: true,
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
    for (const providerId of ['openrouter', 'local'] as const) {
      const entry = getProviderCatalog().find((candidate) => candidate.provider_id === providerId)
      expect(entry).toBeDefined()
      expect(isInvestmentGradeSuitable(entry!, undefined)).toBe(false)
    }
  })
})
