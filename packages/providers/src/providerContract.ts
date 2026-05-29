import type { ZodType } from 'zod'

export const providerCapabilityIds = [
  'text-generation',
  'structured-output',
  'tool-function-calling',
  'streaming-observability',
  'multi-step-tool-loop',
] as const

export type ProviderCapabilityId = (typeof providerCapabilityIds)[number]
export type ProviderCapabilitySupport = 'native' | 'adapter' | 'unsupported'
export type ProviderCapabilities = Record<ProviderCapabilityId, ProviderCapabilitySupport>

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
