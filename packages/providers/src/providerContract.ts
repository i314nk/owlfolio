import type { ZodType } from 'zod'

export interface ProviderBudget {
  max_tool_calls: number
  max_tokens: number
}

export interface ProviderTaskRequest {
  run_id: string
  model_id: string
  prompt: string
  timeout_ms: number
  budget: ProviderBudget
  tool_allowlist: string[]
}

export interface ProviderRunMetadata {
  provider_id: string
  run_id: string
  model_id: string
  timeout_ms: number
  tool_allowlist: string[]
}

export interface ProviderCompletion {
  text: string
  metadata: ProviderRunMetadata
}

export interface ProviderToolCall {
  tool_name: string
  input: unknown
  output: unknown
}

export interface ProviderToolRun {
  text: string
  metadata: ProviderRunMetadata
  tool_calls: ProviderToolCall[]
  ledger_events_written: 0
}

export interface ProviderRunResult {
  metadata: ProviderRunMetadata
  text: string
  tool_calls: ProviderToolCall[]
  ledger_events_written: 0
}

export interface Provider {
  readonly provider_id: string
  complete(request: ProviderTaskRequest): Promise<ProviderCompletion>
  structured<T>(request: ProviderTaskRequest, schema: ZodType<T>): Promise<T>
  runWithTools(request: ProviderTaskRequest): Promise<ProviderToolRun>
}
