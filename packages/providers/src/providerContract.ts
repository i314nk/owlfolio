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

export const providerVendorIds = ['mock', 'anthropic', 'openai', 'google', 'openrouter', 'unknown'] as const
export type ProviderVendorId = (typeof providerVendorIds)[number]

export const providerSurfaceIds = [
  'mock-provider',
  'openrouter-api',
  // Direct OpenAI-compatible API surfaces (key path), executed via the generalized OpenAI-compatible adapter.
  'openai-api',
  'anthropic-api',
  'gemini-developer-api',
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
  /**
   * S5 cost stamping: total tokens the provider API reported for this run, summed across every
   * request the run issued (tool-loop rounds + synthesis + repair retries). Optional — absent when
   * the provider/route does not report usage. This is the raw data the scheduler's unattended-spend
   * policy will be written against.
   */
  input_tokens?: number
  output_tokens?: number
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

/**
 * The grounded multi-step tool-loop seam. The HARNESS (packages/workflow) owns the tool EXECUTORS
 * (grounding via fetchAndCaptureSource/secEdgar — which packages/providers must NOT import); the PROVIDER
 * owns only the tool-calling TRANSPORT + loop mechanics. The provider drives the loop: it calls the model
 * with the lane prompt + tool definitions, parses returned `tool_calls`, invokes this injected `executor`
 * for each call, appends the executor's string result to the conversation, and repeats until the model
 * stops requesting tools OR `max_tool_calls` is hit. It then issues ONE final structured call against the
 * lane's strict json_schema. The grounding invariant is therefore structural: the model can only ever read
 * (and later cite) bytes the harness fetched + hashed inside the executor.
 */
export type ProviderToolExecutor = (toolName: string, args: unknown) => Promise<string>

export interface ProviderToolLoopRequest extends ProviderRunRequest {
  /** Tool function-name → JSON Schema for the tool's arguments (OpenAI function-tool `parameters`). */
  tool_parameters?: Record<string, unknown>
}

export interface ProviderToolLoopRound {
  tool_name: string
  args: unknown
  result: string
}

export interface ProviderToolLoopResult<T> {
  /** The validated structured Phase-2 output (the lane finding) parsed against the supplied schema. */
  analysis: T
  /** The tool rounds executed in Phase 1 (tool name, parsed args, executor result), newest last. */
  rounds: ProviderToolLoopRound[]
  metadata: ProviderRunMetadata
  observations: ProviderObservation[]
  /**
   * True when the loop hit `max_tool_calls` (or otherwise stopped) WITHOUT the model ever requesting a
   * tool, i.e. nothing was gathered — the harness records this so a degraded (ungrounded) run is visible.
   */
  degraded_no_tools: boolean
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
  /**
   * Grounded multi-step tool loop (Phase 1 gather → Phase 2 structured synthesis). Optional: only
   * providers whose `multi-step-tool-loop` capability is not 'unsupported' implement it. The harness
   * selects the loop path by capability and falls back to `structured` (propose-then-verify) otherwise.
   * The `executor` is the harness-owned grounded tool executor (grounding stays in packages/workflow).
   */
  runToolLoop?<T>(
    request: ProviderToolLoopRequest,
    schema: ZodType<T>,
    executor: ProviderToolExecutor,
  ): Promise<ProviderToolLoopResult<T>>
}
