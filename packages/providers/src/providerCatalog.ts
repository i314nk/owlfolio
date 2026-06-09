import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import type { CertificationReport } from './certificationContract'
import { ClaudeCliProvider } from './claudeCliProvider'
import { GeminiDeveloperApiProvider } from './geminiDeveloperApiProvider'
import { MockProvider } from './mockProvider'
import { OpenAIAPIProvider } from './openaiApiProvider'
import { OpenAICodexCliProvider } from './openaiCodexCliProvider'
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
  /** Curation tier (additive, optional): 'frontier' candidate vs broader 'experimental'. */
  model_tier?: ProviderModelTier
}

export type ProviderModelTier = 'frontier' | 'experimental'

const mockCapabilities = new MockProvider().capabilities
const claudeCapabilities = new ClaudeCliProvider().capabilities
const openAICapabilities = new OpenAICodexCliProvider().capabilities
const openAIAPICapabilities = new OpenAIAPIProvider().capabilities
const geminiDeveloperApiCapabilities = new GeminiDeveloperApiProvider({ apiKey: 'catalog-capability-placeholder' }).capabilities
const openRouterCapabilities = new OpenRouterProvider({ apiKey: 'catalog-capability-placeholder' }).capabilities

// Curated frontier candidates without a live adapter yet. Capabilities are claimed at the
// 'adapter' level only where Owlfolio would build a thin OpenAI-compatible adapter, and stay
// 'unsupported' for grounding/tool-loop until proven. None of these are certified.
const directApiCandidateCapabilities: ProviderCapabilities = {
  'text-generation': 'adapter',
  'structured-output': 'adapter',
  'tool-function-calling': 'adapter',
  'streaming-observability': 'unsupported',
  'multi-step-tool-loop': 'unsupported',
  'source-grounding': 'unsupported',
  'citation-metadata': 'unsupported',
  'url-context': 'unsupported',
  'file-context': 'unsupported',
  'source-bundle-production': 'unsupported',
  'code-execution': 'unsupported',
  'computer-use': 'unsupported',
  'browser-use': 'unsupported',
}

const unsupportedCapabilities: ProviderCapabilities = {
  'text-generation': 'unsupported',
  'structured-output': 'unsupported',
  'tool-function-calling': 'unsupported',
  'streaming-observability': 'unsupported',
  'multi-step-tool-loop': 'unsupported',
  'source-grounding': 'unsupported',
  'citation-metadata': 'unsupported',
  'url-context': 'unsupported',
  'file-context': 'unsupported',
  'source-bundle-production': 'unsupported',
  'code-execution': 'unsupported',
  'computer-use': 'unsupported',
  'browser-use': 'unsupported',
}

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

const draftRoleCapabilities: ProviderRoleCapabilities = {
  source_grounding: 'adapter',
  citation_metadata: 'adapter',
  url_context: 'unsupported',
  file_context: 'adapter',
  source_bundle_production: 'adapter',
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
    provider_id: 'claude',
    provider_surface_id: 'claude-cli',
    vendor_id: 'anthropic',
    provider_family_id: 'anthropic',
    compatibility_provider_id: 'claude',
    label: 'Claude',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'CLI-backed real provider path behind readiness and certification checks.',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    default_model_id: 'claude-sonnet-4-6',
    credential_source_categories: ['env_var', 'configured_secret_file', 'default_cli_config'],
    billing: { billing_mode: 'subscription_entitlement', quota_source: 'subscription_tier', quota_status: 'unknown' },
    privacy: { data_policy_source: 'subscription_workspace_policy', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: false, scheduled_workflow_supported: false, automation_suitability: 'personal_local_interactive' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: draftRoleCapabilities,
    capabilities: { ...claudeCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'openai',
    provider_surface_id: 'openai-codex-cli',
    vendor_id: 'openai',
    provider_family_id: 'openai',
    compatibility_provider_id: 'openai',
    label: 'OpenAI Codex CLI',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'CLI-backed Codex provider path behind readiness and certification checks.',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    default_model_id: 'gpt-5.5',
    credential_source_categories: ['env_var', 'configured_secret_file', 'default_cli_config'],
    billing: { billing_mode: 'subscription_entitlement', quota_source: 'subscription_tier', quota_status: 'unknown' },
    privacy: { data_policy_source: 'subscription_workspace_policy', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: false, scheduled_workflow_supported: false, automation_suitability: 'personal_local_interactive' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: draftRoleCapabilities,
    capabilities: { ...openAICapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'openai-api',
    provider_surface_id: 'openai-api',
    vendor_id: 'openai',
    provider_family_id: 'openai',
    label: 'OpenAI API',
    support_level: 'experimental',
    visible_in_onboarding: false,
    description: 'Direct OpenAI API provider candidate behind separate certification gates from the Codex CLI surface.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'gpt-4.1-mini',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'api_paid_no_training', retention_or_zdr_status: 'available_if_configured' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'production_headless' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: draftRoleCapabilities,
    capabilities: { ...openAIAPICapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'gemini-developer-api',
    provider_surface_id: 'gemini-developer-api',
    vendor_id: 'google-gemini',
    provider_family_id: 'google-gemini',
    label: 'Gemini Developer API',
    support_level: 'experimental',
    visible_in_onboarding: false,
    description: 'Direct Gemini Developer API candidate with structured output, function calling, Google Search grounding, and URL context behind privacy/certification gates.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'gemini-2.5-pro',
    credential_source_categories: ['env_var', 'application_default_credentials', 'service_account'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'api_free_training_possible', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'production_headless' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: {
      ...draftRoleCapabilities,
      source_grounding: 'native',
      citation_metadata: 'native',
      url_context: 'native',
      file_context: 'unsupported',
      source_bundle_production: 'adapter',
    },
    capabilities: { ...geminiDeveloperApiCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'gemini-cli',
    provider_surface_id: 'gemini-cli',
    vendor_id: 'google-gemini',
    provider_family_id: 'google-gemini',
    label: 'Gemini CLI',
    support_level: 'experimental',
    visible_in_onboarding: true,
    description: 'Gemini CLI Google sign-in surface modeled as a personal-local experimental lane; adapter not implemented yet.',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    default_model_id: 'gemini-2.5-pro',
    credential_source_categories: ['default_cli_config', 'configured_secret_file'],
    billing: { billing_mode: 'subscription_entitlement', quota_source: 'subscription_tier', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: false, scheduled_workflow_supported: false, automation_suitability: 'personal_local_interactive' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...unsupportedCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'openrouter',
    provider_surface_id: 'openrouter-api',
    vendor_id: 'openrouter',
    provider_family_id: 'openrouter',
    label: 'OpenRouter',
    support_level: 'experimental',
    visible_in_onboarding: false,
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
    model_tier: 'frontier',
  },
  {
    provider_id: 'deepseek',
    provider_surface_id: 'deepseek-api',
    vendor_id: 'deepseek',
    provider_family_id: 'deepseek',
    label: 'DeepSeek',
    support_level: 'experimental',
    visible_in_onboarding: false,
    description: 'DeepSeek direct API candidate (frontier reasoning models, OpenAI/Anthropic-compatible). Experimental and fail-closed; no adapter or certification report exists yet.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'deepseek-reasoner',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unknown' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...directApiCandidateCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'qwen',
    provider_surface_id: 'qwen-dashscope-api',
    vendor_id: 'alibaba-qwen',
    provider_family_id: 'alibaba-qwen',
    label: 'Qwen (DashScope)',
    support_level: 'experimental',
    visible_in_onboarding: false,
    description: 'Alibaba Qwen via DashScope direct API candidate (frontier long-context models). Experimental and fail-closed; no adapter or certification report exists yet, and data-region posture is unverified.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'qwen-max',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unknown' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...directApiCandidateCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
  },
  {
    provider_id: 'mistral',
    provider_surface_id: 'mistral-api',
    vendor_id: 'mistral',
    provider_family_id: 'mistral',
    label: 'Mistral',
    support_level: 'experimental',
    visible_in_onboarding: false,
    description: 'Mistral direct API candidate (frontier models, OpenAI-compatible). Experimental and fail-closed; no adapter or certification report exists yet.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'mistral-large-latest',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unknown' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...directApiCandidateCapabilities },
    investment_grade_candidate: true,
    model_tier: 'frontier',
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
