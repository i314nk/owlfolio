import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { ClaudeCliProvider } from './claudeCliProvider'
import { MockProvider } from './mockProvider'
import { OpenAICodexCliProvider } from './openaiCodexCliProvider'
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
}

const mockCapabilities = new MockProvider().capabilities
const claudeCapabilities = new ClaudeCliProvider().capabilities
const openAICapabilities = new OpenAICodexCliProvider().capabilities

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
  },
  {
    provider_id: 'openai-api',
    provider_surface_id: 'openai-api',
    vendor_id: 'openai',
    provider_family_id: 'openai',
    label: 'OpenAI API',
    support_level: 'unsupported',
    visible_in_onboarding: false,
    description: 'Direct OpenAI API candidate modeled for future certification; adapter not implemented yet.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'gpt-5.5',
    credential_source_categories: ['env_var'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'api_paid_no_training', retention_or_zdr_status: 'available_if_configured' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unsupported' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...unsupportedCapabilities },
  },
  {
    provider_id: 'gemini-developer-api',
    provider_surface_id: 'gemini-developer-api',
    vendor_id: 'google-gemini',
    provider_family_id: 'google-gemini',
    label: 'Gemini Developer API',
    support_level: 'unsupported',
    visible_in_onboarding: false,
    description: 'Gemini Developer API candidate modeled for future certification; adapter not implemented yet.',
    runtime_kind: 'direct_api',
    auth_mode: 'api_key',
    default_model_id: 'gemini-2.5-pro',
    credential_source_categories: ['env_var', 'application_default_credentials', 'service_account'],
    billing: { billing_mode: 'platform_api_billing', quota_source: 'api_project', quota_status: 'unknown' },
    privacy: { data_policy_source: 'unknown', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: true, scheduled_workflow_supported: false, automation_suitability: 'unsupported' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...unsupportedCapabilities },
  },
  {
    provider_id: 'gemini-cli',
    provider_surface_id: 'gemini-cli',
    vendor_id: 'google-gemini',
    provider_family_id: 'google-gemini',
    label: 'Gemini CLI',
    support_level: 'unsupported',
    visible_in_onboarding: true,
    description: 'Gemini CLI Google sign-in surface modeled as a personal-local experimental lane; adapter not implemented yet.',
    runtime_kind: 'cli',
    auth_mode: 'cli_cached_session',
    default_model_id: 'gemini-2.5-pro',
    credential_source_categories: ['default_cli_config', 'configured_secret_file'],
    billing: { billing_mode: 'subscription_entitlement', quota_source: 'subscription_tier', quota_status: 'unknown' },
    privacy: { data_policy_source: 'subscription_workspace_policy', retention_or_zdr_status: 'not_verified' },
    automation: { headless_supported: false, scheduled_workflow_supported: false, automation_suitability: 'personal_local_interactive' },
    workflow_roles: ['research_draft', 'source_bundle_draft'],
    role_capabilities: unsupportedRoleCapabilities,
    capabilities: { ...unsupportedCapabilities },
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
