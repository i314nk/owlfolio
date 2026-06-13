import type { ZodType } from 'zod'

export const providerCapabilityIds = [
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
] as const

export type ProviderCapabilityId = (typeof providerCapabilityIds)[number]
export type ProviderCapabilitySupport = 'native' | 'adapter' | 'unsupported'
export type ProviderCapabilities = Record<ProviderCapabilityId, ProviderCapabilitySupport>

export const providerVendorIds = ['mock', 'anthropic', 'openai', 'openrouter', 'unknown'] as const
export type ProviderVendorId = (typeof providerVendorIds)[number]

export const providerSurfaceIds = [
  'mock-provider',
  'claude-cli',
  'openai-codex-cli',
  'openrouter-api',
] as const
export type ProviderSurfaceId = (typeof providerSurfaceIds)[number]

export const providerRuntimeKinds = ['built_in', 'direct_api', 'cli', 'cloud_enterprise_api'] as const
export type ProviderRuntimeKind = (typeof providerRuntimeKinds)[number]

export const providerAuthModes = [
  'built_in_demo',
  'api_key',
  'oauth_browser_login',
  'cli_cached_session',
  'cli_access_token',
  'application_default_credentials',
  'service_account',
] as const
export type ProviderAuthMode = (typeof providerAuthModes)[number]

export const providerReadinessStates = [
  'ready',
  'missing_credentials',
  'reauth_required',
  'auth_expired',
  'quota_limited',
  'not_configured',
  'unsupported_surface',
  'certification_blocked',
  'unknown',
] as const
export type ProviderReadinessState = (typeof providerReadinessStates)[number]

export const providerCredentialSourceCategories = [
  'env_var',
  'configured_secret_file',
  'default_cli_config',
  'cloud_adc',
  'application_default_credentials',
  'service_account',
  'built_in',
  'missing',
] as const
export type ProviderCredentialSourceCategory = (typeof providerCredentialSourceCategories)[number]

export const providerBillingModes = [
  'platform_api_billing',
  'subscription_entitlement',
  'cloud_project_billing',
  'built_in_demo',
  'unknown',
] as const
export type ProviderBillingMode = (typeof providerBillingModes)[number]

export const providerQuotaSources = ['api_project', 'subscription_tier', 'workspace_entitlement', 'cloud_project', 'built_in', 'unknown'] as const
export type ProviderQuotaSource = (typeof providerQuotaSources)[number]
export type ProviderQuotaStatus = 'available' | 'limited' | 'exhausted' | 'unknown'

export const providerDataPolicySources = [
  'api_paid_no_training',
  'api_free_training_possible',
  'enterprise_contract',
  'subscription_workspace_policy',
  'built_in_demo',
  // Owner-attested account configuration (e.g. an OpenRouter account's per-route ZDR/exemption setting).
  // The basis is an owner ACCOUNT CONFIGURATION, NOT a contractual/legal verification — see dataPosturePolicy.
  'owner_attested_account_policy',
  'unknown',
] as const
export type ProviderDataPolicySource = (typeof providerDataPolicySources)[number]
export type ProviderRetentionOrZdrStatus =
  | 'not_applicable'
  | 'available_if_configured'
  | 'not_verified'
  | 'unknown'
  // Owner-attested account configuration enforces zero-data-retention routing for this route.
  | 'zdr_routing_enforced'
  // Owner-attested: route runs under the vendor's standard no-training API terms (bounded
  // abuse-monitoring retention) — OpenRouter-recommended exemption from ZDR-only for frontier vendors.
  | 'vendor_standard_no_training_terms'
export type ProviderAutomationSuitability = 'production_headless' | 'personal_local_interactive' | 'manual_only' | 'unsupported' | 'unknown'

export const providerWorkflowRoles = [
  'evidence_gathering',
  'research_draft',
  'source_bundle_draft',
  'shariah_policy_review_draft',
  'final_memo_draft',
  'scheduled_monitoring_dry_run',
] as const
export type ProviderWorkflowRole = (typeof providerWorkflowRoles)[number]

export type ProviderRoleCapabilities = {
  source_grounding: ProviderCapabilitySupport
  citation_metadata: ProviderCapabilitySupport
  url_context: ProviderCapabilitySupport
  file_context: ProviderCapabilitySupport
  source_bundle_production: ProviderCapabilitySupport
  code_execution: ProviderCapabilitySupport
  computer_use: ProviderCapabilitySupport
  browser_use: ProviderCapabilitySupport
}

export type ProviderTaskKind = 'text-generation' | 'structured-output' | 'tool-loop'
export type ProviderRunStage = 'queued' | 'running' | 'tool-call' | 'completed' | 'failed'
export type ProviderFinishReason = 'completed' | 'tool-calls' | 'failed'

export interface ProviderBudget {
  max_tool_calls: number
  max_tokens: number
}

export type ProviderResponseFormat =
  | { kind: 'text' }
  | { kind: 'json-schema'; schema_name: string }

export interface ProviderRunRequest {
  run_id: string
  provider_id?: string
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
  model_id: string
  task_kind: ProviderTaskKind
  prompt: string
  timeout_ms: number
  budget: ProviderBudget
  tool_allowlist: string[]
  response_format: ProviderResponseFormat
}

export type ProviderTaskRequest = ProviderRunRequest

export interface ProviderRunMetadata {
  provider_id: string
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
  run_id: string
  model_id: string
  timeout_ms: number
  tool_allowlist: string[]
  task_kind: ProviderTaskKind
  response_format: ProviderResponseFormat
}

export interface ProviderObservation {
  at: string
  stage: ProviderRunStage
  message: string
}

export interface ProviderCompletion {
  text: string
  metadata: ProviderRunMetadata
  observations: ProviderObservation[]
  finish_reason: ProviderFinishReason
}

export interface ProviderToolCall {
  tool_call_id: string
  tool_name: string
  input: unknown
  output: unknown
}

export interface ProviderToolRun {
  text: string
  metadata: ProviderRunMetadata
  observations: ProviderObservation[]
  tool_calls: ProviderToolCall[]
  finish_reason: ProviderFinishReason
  ledger_events_written: 0
}

export interface ProviderRunResult {
  metadata: ProviderRunMetadata
  text: string
  observations: ProviderObservation[]
  tool_calls: ProviderToolCall[]
  finish_reason: ProviderFinishReason
  ledger_events_written: 0
}

export interface Provider {
  readonly provider_id: string
  readonly capabilities: ProviderCapabilities
  complete(request: ProviderRunRequest): Promise<ProviderCompletion>
  structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T>
  runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun>
}
