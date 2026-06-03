import { z, type ZodType } from 'zod'

import { redactProviderDiagnostic } from './providerSecurity'
import type {
  Provider,
  ProviderCompletion,
  ProviderObservation,
  ProviderRunMetadata,
  ProviderRunRequest,
  ProviderToolCall,
  ProviderToolRun,
} from './providerContract'

export type OpenAIAPIProviderOptions = {
  env?: NodeJS.ProcessEnv
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

type OpenAIResponseOutputItem = {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
}

type OpenAIResponseBody = {
  id?: string
  output_text?: string
  output?: OpenAIResponseOutputItem[]
  error?: {
    message?: string
    code?: string
    type?: string
  }
}

export class OpenAIAPIProvider implements Provider {
  readonly provider_id = 'openai-api'
  readonly capabilities = {
    'text-generation': 'native',
    'structured-output': 'native',
    'tool-function-calling': 'native',
    'streaming-observability': 'adapter',
    'multi-step-tool-loop': 'unsupported',
    'source-grounding': 'adapter',
    'citation-metadata': 'adapter',
    'url-context': 'unsupported',
    'file-context': 'unsupported',
    'source-bundle-production': 'adapter',
    'code-execution': 'unsupported',
    'computer-use': 'unsupported',
    'browser-use': 'unsupported',
  } as const

  private readonly env: NodeJS.ProcessEnv
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAIAPIProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.apiKey = options.apiKey ?? this.env.OPENAI_API_KEY
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    const response = await this.createResponse(request, {})
    const text = this.outputTextFrom(response).trim()

    return {
      text,
      metadata: this.metadataFor(request),
      observations: [
        this.observation('queued', 'OpenAI API queued the request.'),
        this.observation('completed', 'OpenAI API completed the request.'),
      ],
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
    const response = await this.createResponse(request, {
      text: {
        format: {
          type: 'json_schema',
          name: request.response_format.kind === 'json-schema' ? request.response_format.schema_name : 'owlfolio_structured_response',
          strict: true,
          schema: z.toJSONSchema(schema),
        },
      },
    })
    const text = this.outputTextFrom(response)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`Structured output validation failed: OpenAI API returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }

    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      throw new Error(`Structured output validation failed: ${validated.error.message}`)
    }

    return validated.data
  }

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    const response = await this.createResponse(request, {
      tools: request.tool_allowlist.map((toolName) => ({
        type: 'function',
        name: toolName,
        description: `Owlfolio-owned tool placeholder for ${toolName}; the provider may request it, but Owlfolio executes and audits the tool outside the adapter.`,
        parameters: {
          type: 'object',
          additionalProperties: true,
        },
      })),
      tool_choice: request.tool_allowlist.length > 0 ? 'auto' : undefined,
    })
    const toolCalls = this.toolCallsFrom(response, new Set(request.tool_allowlist))

    return {
      text: this.outputTextFrom(response).trim(),
      metadata: this.metadataFor(request),
      observations: [
        this.observation('queued', 'OpenAI API queued the tool-capable request.'),
        ...toolCalls.map((toolCall) => this.observation('tool-call', `OpenAI API requested Owlfolio-owned tool ${toolCall.tool_name}.`)),
        this.observation('completed', 'OpenAI API completed the tool-capable request.'),
      ],
      tool_calls: toolCalls,
      finish_reason: toolCalls.length > 0 ? 'tool-calls' : 'completed',
      ledger_events_written: 0,
    }
  }

  private async createResponse(request: ProviderRunRequest, extraBody: Record<string, unknown>): Promise<OpenAIResponseBody> {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      throw new Error('OpenAI API is not configured: missing OPENAI_API_KEY')
    }

    const body = this.omitUndefined({
      model: request.model_id,
      input: request.prompt,
      max_output_tokens: request.budget.max_tokens,
      ...extraBody,
    })

    let response: Response
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, request.timeout_ms)
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error(`OpenAI API timed out after ${request.timeout_ms}ms`)
      }
      throw new Error(`OpenAI API request failed: ${redactProviderDiagnostic(error)}`)
    }

    const parsed = await this.parseResponseBody(response)
    if (!response.ok) {
      throw new Error(this.failureMessageFrom(response, parsed))
    }

    return parsed
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async parseResponseBody(response: Response): Promise<OpenAIResponseBody> {
    const text = await response.text()
    if (text.trim().length === 0) {
      return {}
    }

    try {
      return JSON.parse(text) as OpenAIResponseBody
    } catch (error) {
      throw new Error(`OpenAI API returned invalid JSON: ${redactProviderDiagnostic(error)}`)
    }
  }

  private failureMessageFrom(response: Response, body: OpenAIResponseBody): string {
    const rawDiagnostic = body.error?.message ?? response.statusText ?? 'unknown error'
    const diagnostic = redactProviderDiagnostic(rawDiagnostic)
    const code = body.error?.code ?? body.error?.type ?? ''
    const statusPrefix = `OpenAI API failed with status ${response.status} ${response.statusText || ''}`.trim()

    if (response.status === 429 || /quota|rate.?limit|too_many_requests/i.test(`${code} ${rawDiagnostic}`)) {
      return `OpenAI API quota or rate limit failure: ${diagnostic}`
    }

    if (response.status === 401 || response.status === 403 || /auth|unauthorized|forbidden|invalid_api_key/i.test(`${code} ${rawDiagnostic}`)) {
      return `OpenAI API authentication failure: ${diagnostic}`
    }

    return `${statusPrefix}: ${diagnostic}`
  }

  private outputTextFrom(body: OpenAIResponseBody): string {
    if (typeof body.output_text === 'string') {
      return body.output_text
    }

    return (body.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
      .map((content) => content.text!)
      .join('\n')
  }

  private toolCallsFrom(body: OpenAIResponseBody, allowedToolNames: ReadonlySet<string>): ProviderToolCall[] {
    return (body.output ?? [])
      .filter((item) => item.type === 'function_call' && typeof item.name === 'string' && allowedToolNames.has(item.name))
      .map((item, index) => ({
        tool_call_id: item.call_id ?? item.id ?? `openai_api_tool_call_${index + 1}`,
        tool_name: item.name!,
        input: this.parseToolArguments(item.arguments),
        output: { status: 'proposed', note: 'Tool execution is owned by Owlfolio, not the provider adapter.' },
      }))
  }

  private parseToolArguments(value: string | undefined): unknown {
    if (value === undefined || value.trim().length === 0) {
      return {}
    }

    try {
      return JSON.parse(value)
    } catch {
      return { raw_arguments: redactProviderDiagnostic(value) }
    }
  }

  private metadataFor(request: ProviderRunRequest): ProviderRunMetadata {
    return {
      provider_id: this.provider_id,
      provider_surface_id: request.provider_surface_id ?? 'openai-api',
      vendor_id: request.vendor_id ?? 'openai',
      runtime_kind: request.runtime_kind ?? 'direct_api',
      auth_mode: request.auth_mode ?? 'api_key',
      ...(request.workflow_role === undefined ? {} : { workflow_role: request.workflow_role }),
      run_id: request.run_id,
      model_id: request.model_id,
      timeout_ms: request.timeout_ms,
      tool_allowlist: [...request.tool_allowlist],
      task_kind: request.task_kind,
      response_format: request.response_format,
    }
  }

  private observation(stage: ProviderObservation['stage'], message: string): ProviderObservation {
    return {
      at: new Date().toISOString(),
      stage,
      message,
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }

  private omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined))
  }
}
