import { z, type ZodType } from 'zod'

import { redactProviderDiagnostic } from './providerSecurity'
import type {
  Provider,
  ProviderCapabilities,
  ProviderCompletion,
  ProviderObservation,
  ProviderRunMetadata,
  ProviderRunRequest,
  ProviderToolCall,
  ProviderToolRun,
} from './providerContract'

export type GeminiDeveloperApiProviderOptions = {
  apiKey?: string
  env?: NodeJS.ProcessEnv
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  endpoint?: string
}

type GeminiPart = {
  text?: string
  functionCall?: {
    name?: string
    args?: unknown
  }
}

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[]
  }
  finishReason?: string
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
    groundingSupports?: Array<{ segment?: { text?: string }; groundingChunkIndices?: number[] }>
  }
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
  error?: {
    message?: string
    status?: string
  }
}

export class GeminiDeveloperApiProvider implements Provider {
  readonly provider_id = 'gemini-developer-api'
  readonly capabilities: ProviderCapabilities = {
    'text-generation': 'native',
    'structured-output': 'native',
    'tool-function-calling': 'native',
    'streaming-observability': 'adapter',
    'multi-step-tool-loop': 'unsupported',
    'source-grounding': 'native',
    'citation-metadata': 'native',
    'url-context': 'native',
    'file-context': 'unsupported',
    'source-bundle-production': 'adapter',
    'code-execution': 'unsupported',
    'computer-use': 'unsupported',
    'browser-use': 'unsupported',
  }

  private readonly apiKey: string | undefined
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>
  private readonly endpoint: string

  constructor(options: GeminiDeveloperApiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? options.env?.GEMINI_API_KEY ?? options.env?.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    this.fetchImpl = options.fetch ?? fetch
    this.endpoint = options.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta'
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    const observations = this.observationsFor('Gemini Developer API queued the request.')
    const response = await this.generateContent(request, { includeGrounding: false })
    observations.push(this.observation('completed', 'Gemini Developer API completed the request.'))

    return {
      text: this.textFrom(response).trim(),
      metadata: this.metadataFor(request),
      observations,
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
    const response = await this.generateContent(request, { schema, includeGrounding: true })
    const text = this.textFrom(response)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`Gemini structured output validation failed: provider returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }

    const enriched = this.withGroundingCitations(parsed, response)
    const validated = schema.safeParse(enriched)
    if (!validated.success) {
      throw new Error(`Gemini structured output validation failed: ${validated.error.message}`)
    }
    return validated.data
  }

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    const observations = this.observationsFor('Gemini Developer API queued the tool request.')
    const response = await this.generateContent(request, { includeGrounding: true })
    const toolCalls = this.toolCallsFrom(response)
    observations.push(this.observation(toolCalls.length > 0 ? 'tool-call' : 'completed', `Gemini Developer API returned ${toolCalls.length} tool call(s).`))

    return {
      text: this.textFrom(response).trim(),
      metadata: this.metadataFor(request),
      observations,
      tool_calls: toolCalls,
      finish_reason: toolCalls.length > 0 ? 'tool-calls' : 'completed',
      ledger_events_written: 0,
    }
  }

  private async generateContent(
    request: ProviderRunRequest,
    options: { schema?: ZodType<unknown>; includeGrounding: boolean },
  ): Promise<GeminiResponse> {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      throw new Error('Gemini Developer API authentication failed: missing GEMINI_API_KEY or GOOGLE_API_KEY')
    }

    const response = await this.fetchImpl(`${this.endpoint}/models/${encodeURIComponent(request.model_id)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(this.bodyFor(request, options)),
    })

    const payload = await this.parsePayload(response)
    if (!response.ok) {
      throw new Error(this.errorMessageFor(response.status, payload))
    }
    if (payload.error !== undefined) {
      throw new Error(this.errorMessageFor(response.status, payload))
    }
    return payload
  }

  private bodyFor(
    request: ProviderRunRequest,
    { schema, includeGrounding }: { schema?: ZodType<unknown>; includeGrounding: boolean },
  ): Record<string, unknown> {
    return {
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        maxOutputTokens: request.budget.max_tokens,
        ...(request.response_format.kind === 'json-schema'
          ? {
              responseMimeType: 'application/json',
              responseSchema: schema === undefined ? undefined : z.toJSONSchema(schema),
            }
          : {}),
      },
      tools: this.toolsFor(request, includeGrounding),
    }
  }

  private toolsFor(request: ProviderRunRequest, includeGrounding: boolean): unknown[] {
    const tools: unknown[] = []
    if (request.tool_allowlist.length > 0) {
      tools.push({
        functionDeclarations: request.tool_allowlist
          .filter((toolName) => toolName.includes('.'))
          .map((toolName) => ({
            name: toolName,
            description: `Owlfolio-controlled tool ${toolName}; provider must not write ledger events directly.`,
            parameters: { type: 'object', properties: {} },
          })),
      })
    }
    if (includeGrounding || request.tool_allowlist.includes('google_search')) {
      tools.push({ googleSearch: {} })
    }
    if (includeGrounding || request.tool_allowlist.includes('url_context')) {
      tools.push({ urlContext: {} })
    }
    return tools.filter((tool) => {
      if (typeof tool !== 'object' || tool === null || !('functionDeclarations' in tool)) {
        return true
      }
      return Array.isArray((tool as { functionDeclarations?: unknown[] }).functionDeclarations)
        && (tool as { functionDeclarations: unknown[] }).functionDeclarations.length > 0
    })
  }

  private async parsePayload(response: Response): Promise<GeminiResponse> {
    try {
      return await response.json() as GeminiResponse
    } catch (error) {
      throw new Error(`Gemini Developer API returned non-JSON response: ${this.redact(error)}`)
    }
  }

  private textFrom(response: GeminiResponse): string {
    const parts = response.candidates?.[0]?.content?.parts ?? []
    return parts.map((part) => part.text ?? '').join('').trim()
  }

  private toolCallsFrom(response: GeminiResponse): ProviderToolCall[] {
    const parts = response.candidates?.[0]?.content?.parts ?? []
    return parts.flatMap((part, index) => {
      const functionCall = part.functionCall
      if (functionCall?.name === undefined) {
        return []
      }
      return [{
        tool_call_id: `gemini_tool_${index + 1}`,
        tool_name: functionCall.name,
        input: functionCall.args ?? {},
        output: { status: 'not_executed_by_provider_adapter' },
      }]
    })
  }

  private withGroundingCitations(value: unknown, response: GeminiResponse): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }
    const record = { ...(value as Record<string, unknown>) }
    const sourceRecords = this.sourceRecordsFromGrounding(response)
    if (sourceRecords.length === 0) {
      return record
    }
    if (!Array.isArray(record.source_records) || record.source_records.length === 0) {
      record.source_records = sourceRecords
    }
    if (!Array.isArray(record.source_ids) || record.source_ids.length === 0) {
      record.source_ids = sourceRecords.map((sourceRecord) => sourceRecord.source_id)
    }
    return record
  }

  private sourceRecordsFromGrounding(response: GeminiResponse): Array<{ source_id: string; title: string; url: string; excerpt: string }> {
    const metadata = response.candidates?.[0]?.groundingMetadata
    const chunks = metadata?.groundingChunks ?? []
    const supports = metadata?.groundingSupports ?? []
    return chunks.flatMap((chunk, index) => {
      const uri = chunk.web?.uri
      if (uri === undefined || uri.length === 0) {
        return []
      }
      const support = supports.find((candidateSupport) => candidateSupport.groundingChunkIndices?.includes(index))
      return [{
        source_id: `src_gemini_${index + 1}`,
        title: chunk.web?.title ?? `Gemini grounded source ${index + 1}`,
        url: uri,
        excerpt: support?.segment?.text ?? 'Gemini grounding citation metadata was returned for this source.',
      }]
    })
  }

  private errorMessageFor(statusCode: number, payload: GeminiResponse): string {
    const diagnostic = this.redact(payload.error?.message ?? payload.error?.status ?? `HTTP ${statusCode}`)
    if (statusCode === 401 || statusCode === 403 || /unauthenticated|permission_denied|api key|oauth|auth/i.test(diagnostic)) {
      return `Gemini Developer API authentication failed: ${diagnostic}`
    }
    if (statusCode === 429 || /quota|rate.?limit|resource_exhausted/i.test(diagnostic)) {
      return `Gemini Developer API quota limited: ${diagnostic}`
    }
    return `Gemini Developer API request failed: ${diagnostic}`
  }

  private redact(value: unknown): string {
    const text = value instanceof Error ? value.message : String(value)
    return redactProviderDiagnostic(this.apiKey === undefined ? text : text.replaceAll(this.apiKey, '[redacted-secret]'))
  }

  private metadataFor(request: ProviderRunRequest): ProviderRunMetadata {
    return {
      provider_id: this.provider_id,
      ...(request.provider_surface_id === undefined ? {} : { provider_surface_id: request.provider_surface_id }),
      ...(request.vendor_id === undefined ? {} : { vendor_id: request.vendor_id }),
      ...(request.runtime_kind === undefined ? {} : { runtime_kind: request.runtime_kind }),
      ...(request.auth_mode === undefined ? {} : { auth_mode: request.auth_mode }),
      ...(request.workflow_role === undefined ? {} : { workflow_role: request.workflow_role }),
      run_id: request.run_id,
      model_id: request.model_id,
      timeout_ms: request.timeout_ms,
      tool_allowlist: [...request.tool_allowlist],
      task_kind: request.task_kind,
      response_format: request.response_format,
    }
  }

  private observationsFor(message: string): ProviderObservation[] {
    return [this.observation('queued', message), this.observation('running', 'Gemini Developer API request started.')]
  }

  private observation(stage: ProviderObservation['stage'], message: string): ProviderObservation {
    return { at: new Date().toISOString(), stage, message }
  }
}
