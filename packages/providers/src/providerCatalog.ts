import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import type { CertificationReport } from './certificationContract'
import { MockProvider } from './mockProvider'
import { OpenRouterProvider } from './openRouterProvider'
import type {
  ProviderAuthMode,
  ProviderAutomationSuitability,
  ProviderBillingMode,
  ProviderCapabilities,
  ProviderCredentialSourceCategory,
  ProviderDataPolicySource,
  ProviderQuotaSource,
  ProviderQuotaStatus,
  ProviderRetentionOrZdrStatus,
  ProviderRoleCapabilities,
  ProviderRuntimeKind,
  ProviderSurfaceId,
  ProviderVendorId,
  ProviderWorkflowRole,
} from './providerContract'

export type ProviderCatalogEntry = {
  provider_id: ProviderId
  provider_surface_id: ProviderSurfaceId
  vendor_id: ProviderVendorId
  provider_family_id: ProviderVendorId
  compatibility_provider_id?: ProviderId
  label: string
  support_level: ProviderSupportLevel
  visible_in_onboarding: boolean
  description: string
  runtime_kind: ProviderRuntimeKind
  auth_mode: ProviderAuthMode
  default_model_id: string
  credential_source_categories: ProviderCredentialSourceCategory[]
  billing: {
    billing_mode: ProviderBillingMode
    quota_source: ProviderQuotaSource
    quota_status: ProviderQuotaStatus
  }
  privacy: {
    data_policy_source: ProviderDataPolicySource
    retention_or_zdr_status: ProviderRetentionOrZdrStatus
  }
  automation: {
    headless_supported: boolean
    scheduled_workflow_supported: boolean
    automation_suitability: ProviderAutomationSuitability
  }
  workflow_roles: ProviderWorkflowRole[]
  role_capabilities: ProviderRoleCapabilities
  capabilities: ProviderCapabilities
  /**
   * Curation flag (additive, optional). The catalog deliberately lists many providers, but
   * only frontier reasoning + grounding-capable models are flagged as candidates that could
   * become investment-grade once certified. This flag NEVER asserts certification by itself.
   */
  investment_grade_candidate?: boolean
}

const mockCapabilities = new MockProvider().capabilities
const openRouterCapabilities = new OpenRouterProvider({ apiKey: 'catalog-capability-placeholder' }).capabilities

const unsupportedRoleCapabilities: ProviderRoleCapabilities = {
  source_grounding: 'unsupported',
  citation_metadata: 'unsupported',
  url_context: 'unsupported',
  file_context: 'unsupported',
  source_bundle_production: 'unsupported',
  code_execution: 'unsupported',
  computer_use: 'unsupported',
  browser_use: 'unsupported',
}

const builtInDemoRoleCapabilities: ProviderRoleCapabilities = {
  source_grounding: 'native',
  citation_metadata: 'native',
  url_context: 'native',
  file_context: 'adapter',
  source_bundle_production: 'native',
  code_execution: 'unsupported',
  computer_use: 'unsupported',
  browser_use: 'unsupported',
}

const catalog: ProviderCatalogEntry[] = [
  {
    provider_id: 'mock-provider',
    provider_surface_id: 'mock-provider',
    vendor_id: 'mock',
    provider_family_id: 'mock',
    compatibility_provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    visible_in_onboarding: true,
    description: 'Deterministic demo provider for the audited Buffett-Munger vertical slice.',
    runtime_kind: 'built_in',
    auth_mode: 'built_in_demo',
    default_model_id: 'mock-research-v2',
    credential_source_categories: ['built_in'],
    billing: { billing_mode: 'built_in_demo', quota_source: 'built_in', quota_status: 'available' },
    privacy: { data_policy_source: 'built_in_demo', retention_or_zdr_status: 'not_applicable' },
    automation: { headless_supported: true, scheduled_workflow_supported: true, automation_suitability: 'production_headless' },
    workflow_roles: ['evidence_gathering', 'research_draft', 'source_bundle_draft', 'scheduled_monitoring_dry_run'],
    role_capabilities: builtInDemoRoleCapabilities,
    capabilities: { ...mockCapabilities },
  },
  {
    provider_id: 'openrouter',
    provider_surface_id: 'openrouter-api',
    vendor_id: 'openrouter',
    provider_family_id: 'openrouter',
    label: 'OpenRouter',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'Meta-aggregator; routes to many models behind one API key — per-model certification still required. Fail-closed until a target-specific certification report exists for the routed model.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'openrouter/auto',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unknown' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...openRouterCapabilities },
    investment_grade_candidate: true,
  },
  // ── The experimental LOCAL surface (owner, 2026-07-18): an OpenAI-compatible endpoint you run
  // yourself (Ollama / vLLM), executed via the same generalized adapter. EXPLICITLY UNSTABLE AND
  // UNTESTED — the owner has not exercised this lane; it is fail-closed and never described as
  // certified or live. Base URL via OWLFOLIO_LOCAL_API_BASE_URL (defaults to Ollama's
  // http://127.0.0.1:11434/v1); OWLFOLIO_LOCAL_API_KEY is optional (most local servers need none). ──
  {
    provider_id: 'local',
    provider_surface_id: 'local',
    vendor_id: 'local',
    provider_family_id: 'local',
    label: 'Local (Ollama / vLLM) — experimental, untested',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'UNSTABLE / EXPERIMENTAL / UNTESTED: a local OpenAI-compatible endpoint (Ollama or vLLM) you run yourself. This lane has not been tested end-to-end — expect failures; runs fail closed and are never silently trusted. Data stays on your machine, but the quality of every verdict tracks the local model you serve.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'llama3.3:70b',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'built_in_demo', quota_source: 'built_in', quota_status: 'available' },
    privacy: { data_policy_source: 'built_in_demo', retention_or_zdr_status: 'not_applicable' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unknown' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...openRouterCapabilities },
  },
]

export function getProviderCatalog(): ProviderCatalogEntry[] {
  return catalog.map((provider) => ({
    ...provider,
    credential_source_categories: [...provider.credential_source_categories],
    billing: { ...provider.billing },
    privacy: { ...provider.privacy },
    automation: { ...provider.automation },
    workflow_roles: [...provider.workflow_roles],
    role_capabilities: { ...provider.role_capabilities },
    capabilities: { ...provider.capabilities },
  }))
}

/**
 * Honest, certification-bounded investment-grade gate. Returns true ONLY when:
 *  1. the provider is a curated investment-grade candidate (frontier reasoning + grounding), AND
 *  2. a latest certification report backs it: run completed, support_level certified, and the
 *     source-grounded research scenario passed (harness-verified citations).
 *
 * The catalog lists many providers and flags candidates, but a candidate is NOT suitable until a
 * report proves it. No newly-added provider passes today because none has a certified report.
 */
export function isInvestmentGradeSuitable(
  provider: Pick<ProviderCatalogEntry, 'investment_grade_candidate'>,
  latestCertification?: Pick<CertificationReport, 'run_status' | 'support_level' | 'cases'>,
): boolean {
  if (provider.investment_grade_candidate !== true) {
    return false
  }

  if (latestCertification === undefined) {
    return false
  }

  if (latestCertification.run_status !== 'completed' || latestCertification.support_level !== 'certified') {
    return false
  }

  const groundedCase = latestCertification.cases.find((caseResult) => caseResult.scenario_id === 'source-grounded-research-task')
  return groundedCase !== undefined && groundedCase.passed && groundedCase.status === 'passed'
}
