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
  ProviderToolExecutor,
  ProviderToolLoopRequest,
  ProviderToolLoopResult,
  ProviderToolLoopRound,
  ProviderToolRun,
} from './providerContract'

export type OpenRouterProviderOptions = {
  env?: NodeJS.ProcessEnv
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

type OpenRouterChatMessage = {
  role?: string
  content?: string | null
  reasoning?: string | null
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

type OpenRouterChatResponse = {
  id?: string
  choices?: Array<{ message?: OpenRouterChatMessage; finish_reason?: string }>
  error?: { message?: string; code?: string | number; type?: string }
}

/** An OpenAI-compatible chat message on the wire (assistant tool_calls + tool results for the loop). */
type OpenRouterWireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** How many gather rounds the loop allows independent of the per-round tool cap (defensive bound). */
const MAX_TOOL_LOOP_ROUNDS = 24

/**
 * OpenAI's strict json_schema mode (used by openai/* routes via OpenRouter → Azure) rejects any object
 * schema where `required` does not list EVERY key in `properties`, and requires `additionalProperties:
 * false`. Zod's `toJSONSchema` emits optional fields as non-required, so a permissive route (DeepSeek R1)
 * accepts the schema but a strict route returns HTTP 400 `invalid_json_schema`. This transform recursively
 * coerces every object node to OpenAI-strict shape so the SAME structured contract works across routes.
 * (The model is then required to emit every key; our Zod validation still enforces the real contract.)
 */
function toStrictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => toStrictJsonSchema(item))
  }
  if (node === null || typeof node !== 'object') {
    return node
  }
  const record = node as Record<string, unknown>
  // Capture which keys the ORIGINAL schema marked required, before we overwrite `required` for strict mode.
  const originallyRequired = new Set(Array.isArray(record.required) ? (record.required as string[]) : [])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    // OpenAI strict json_schema mode rejects unsupported keywords. `format` values like `uri` (emitted by
    // z.string().url()) and the `$schema` dialect marker are not accepted; drop them. The real contract is
    // still enforced by our Zod validation after parsing, so dropping these from the wire schema is safe.
    if (key === '$schema' || key === 'format') {
      continue
    }
    out[key] = toStrictJsonSchema(value)
  }
  // Dropping `format` removes the only signal that a string must be a URL/email/etc. Some models then fill
  // such fields with prose (e.g. Opus writing "COST 10-K" into a url field), which our Zod validation then
  // rejects. Preserve the constraint as a `description` hint so strict-mode models still produce valid values.
  if (typeof record.format === 'string') {
    const hint = formatHint(record.format)
    if (hint !== undefined) {
      out.description = typeof out.description === 'string' && out.description.length > 0 ? `${out.description} ${hint}` : hint
    }
  }
  if (out.type === 'object' && out.properties !== null && typeof out.properties === 'object') {
    const properties = out.properties as Record<string, unknown>
    out.additionalProperties = false
    // OpenAI strict mode requires `required` to list EVERY key. But forcing an originally-OPTIONAL field
    // to be required would make the model FABRICATE a value (e.g. a junk URL for an optional source list).
    // The strict-mode-correct way to keep optionality is to make those fields nullable, so the model can
    // honestly emit `null` instead of inventing data. (Our Zod schema treats null/absent the same.)
    out.required = Object.keys(properties)
    for (const [key, propValue] of Object.entries(properties)) {
      if (!originallyRequired.has(key) && propValue !== null && typeof propValue === 'object') {
        properties[key] = makeNullable(propValue as Record<string, unknown>)
      }
    }
  }
  return out
}

/**
 * Sanitize an Owlfolio tool name to the charset routed providers accept. Anthropic (and others) require
 * tool names to match ^[a-zA-Z0-9_-]{1,128}$, so `source.fetch` must go on the wire as `source_fetch`.
 * The caller maps the sanitized name back to the original after the response.
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
}

/** Recursively remove object keys whose value is null, so a nullable-strict field reads as absent. */
function stripNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripNullProperties(item))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null) {
      continue
    }
    out[key] = stripNullProperties(entry)
  }
  return out
}

/** A natural-language hint preserving a dropped JSON-schema `format` constraint for strict-mode models. */
function formatHint(format: string): string | undefined {
  switch (format) {
    case 'uri':
    case 'url':
      return 'Must be a fully-qualified absolute https URL (e.g. https://www.sec.gov/...). If you have no real URL, omit this field / use null rather than inventing one.'
    case 'email':
      return 'Must be a valid email address.'
    case 'date-time':
      return 'Must be an ISO 8601 date-time string.'
    default:
      return undefined
  }
}

/** Add `null` to a JSON-schema node's `type` so a strict-mode-required field can be omitted as null. */
function makeNullable(node: Record<string, unknown>): Record<string, unknown> {
  const type = node.type
  if (typeof type === 'string' && type !== 'null') {
    return { ...node, type: [type, 'null'] }
  }
  if (Array.isArray(type) && !type.includes('null')) {
    return { ...node, type: [...type, 'null'] }
  }
  return node
}

/**
 * Detect the reasoning-token-exhaustion case: a reasoning model can spend the entire `max_tokens`
 * budget on reasoning tokens and return empty visible `content` with finish_reason `length`. That is a
 * truncation, not a real empty answer, so the adapter surfaces a precise diagnostic instead of a bare
 * empty string (which downstream callers would misread as a malformed/empty completion).
 */
function truncatedReasoningDiagnostic(body: OpenRouterChatResponse): string | undefined {
  const choice = body.choices?.[0]
  const content = choice?.message?.content
  const hasContent = typeof content === 'string' && content.trim().length > 0
  if (!hasContent && choice?.finish_reason === 'length') {
    return 'OpenRouter response was truncated (finish_reason=length) before any visible content was produced — the reasoning budget likely consumed the entire max_tokens. Increase max_tokens for this reasoning model.'
  }
  return undefined
}

/**
 * OpenRouter is a meta-aggregator that routes one OpenAI-compatible API key to many underlying
 * models/providers. This adapter speaks the OpenAI-compatible `/chat/completions` surface and passes the
 * routed `model_id` (e.g. `deepseek/deepseek-r1`, `openai/gpt-5.5`, `anthropic/claude-opus-4.8`) straight
 * through. Owlfolio's curated routes are reasoning models, so per the OWNER REQUIREMENT this adapter always
 * requests extended reasoning/thinking via OpenRouter's unified `reasoning` parameter.
 *
 * Readiness is NOT certification. Because each routed model has its own capabilities and privacy posture,
 * per-model certification is required: OpenRouter as a provider cannot be certified provider-wide. The
 * certification/qualification harness gates whether a routed target is trusted for real research.
 */
export class OpenRouterProvider implements Provider {
  readonly provider_id = 'openrouter'
  readonly capabilities: ProviderCapabilities = {
    'text-generation': 'adapter',
    'structured-output': 'adapter',
    'tool-function-calling': 'adapter',
    'streaming-observability': 'unsupported',
    'multi-step-tool-loop': 'adapter',
    'source-grounding': 'unsupported',
    'citation-metadata': 'unsupported',
    'url-context': 'unsupported',
    'file-context': 'unsupported',
    'source-bundle-production': 'unsupported',
    'code-execution': 'unsupported',
    'computer-use': 'unsupported',
    'browser-use': 'unsupported',
  }

  private readonly env: NodeJS.ProcessEnv
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenRouterProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.apiKey = options.apiKey ?? this.env.OPENROUTER_API_KEY
    this.baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
  }

  /**
   * Returns true only when an OpenRouter API key is present in the environment/options. Readiness is not
   * certification: a present key still leaves a routed model fail-closed for research execution until a
   * target-specific certification report exists for it.
   */
  isReady(): boolean {
    return this.apiKey !== undefined && this.apiKey.length > 0
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    const response = await this.createChatCompletion(request, {})
    const truncated = truncatedReasoningDiagnostic(response)
    if (truncated !== undefined) {
      throw new Error(truncated)
    }
    const text = this.messageTextFrom(response).trim()

    return {
      text,
      metadata: this.metadataFor(request),
      observations: [
        this.observation('queued', 'OpenRouter queued the request.'),
        this.observation('completed', 'OpenRouter completed the request.'),
      ],
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
    const response = await this.createChatCompletion(request, {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.response_format.kind === 'json-schema' ? request.response_format.schema_name : 'owlfolio_structured_response',
          strict: true,
          schema: toStrictJsonSchema(z.toJSONSchema(schema)),
        },
      },
    })
    const truncated = truncatedReasoningDiagnostic(response)
    if (truncated !== undefined) {
      throw new Error(`Structured output validation failed: ${truncated}`)
    }
    // Originally-optional fields are sent to the strict API as nullable (see toStrictJsonSchema). Strip
    // null-valued keys so an emitted `null` is treated as "absent" — matching a Zod `.optional()` field
    // (which accepts undefined, not null). This keeps optionality honest end-to-end. (parseStructured.)
    return this.parseStructured(response, schema)
  }

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    // Owlfolio tool names like `source.fetch` contain a dot, which some routed providers (notably
    // Anthropic) reject — they require tool names to match ^[a-zA-Z0-9_-]{1,128}$. Sanitize the name on
    // the wire and keep a map back to the original so callers still see the real tool id.
    const sanitizedToOriginal = new Map<string, string>()
    for (const toolName of request.tool_allowlist) {
      sanitizedToOriginal.set(sanitizeToolName(toolName), toolName)
    }

    const response = await this.createChatCompletion(request, {
      tools: request.tool_allowlist.map((toolName) => ({
        type: 'function',
        function: {
          name: sanitizeToolName(toolName),
          description: `Owlfolio-owned tool placeholder for ${toolName}; the provider may request it, but Owlfolio executes and audits the tool outside the adapter.`,
          parameters: { type: 'object', additionalProperties: true },
        },
      })),
      tool_choice: request.tool_allowlist.length > 0 ? 'auto' : undefined,
    })
    const toolCalls = this.toolCallsFrom(response, sanitizedToOriginal)

    return {
      text: this.messageTextFrom(response).trim(),
      metadata: this.metadataFor(request),
      observations: [
        this.observation('queued', 'OpenRouter queued the tool-capable request.'),
        ...toolCalls.map((toolCall) => this.observation('tool-call', `OpenRouter requested Owlfolio-owned tool ${toolCall.tool_name}.`)),
        this.observation('completed', 'OpenRouter completed the tool-capable request.'),
      ],
      tool_calls: toolCalls,
      finish_reason: toolCalls.length > 0 ? 'tool-calls' : 'completed',
      ledger_events_written: 0,
    }
  }

  /**
   * Grounded multi-step tool loop. Phase 1 (gather): with `tools` enabled and NO json schema, the loop
   * calls the model, parses any `tool_calls`, runs the injected harness `executor` for each (the grounding
   * — SSRF + sha256 + ledger — lives there, NOT in this adapter), appends each tool result as a `tool`
   * message, and repeats until the model stops requesting tools OR the `max_tool_calls` cap is reached.
   * Phase 2 (synthesis): one final `structured`-style call with the strict json_schema and NO tools, so
   * the model emits the lane finding citing ONLY ids the executor surfaced. The grounding invariant is
   * structural: the model can only ever read harness-fetched, content-hashed bytes.
   */
  async runToolLoop<T>(
    request: ProviderToolLoopRequest,
    schema: ZodType<T>,
    executor: ProviderToolExecutor,
  ): Promise<ProviderToolLoopResult<T>> {
    const sanitizedToOriginal = new Map<string, string>()
    const tools = request.tool_allowlist.map((toolName) => {
      const wireName = sanitizeToolName(toolName)
      sanitizedToOriginal.set(wireName, toolName)
      const parameters = request.tool_parameters?.[toolName] ?? { type: 'object', additionalProperties: true }
      return {
        type: 'function' as const,
        function: {
          name: wireName,
          description: `Owlfolio-owned grounded tool ${toolName}. Owlfolio executes it and returns harness-verified results; you may only cite sources surfaced by these tool results.`,
          parameters,
        },
      }
    })

    const messages: OpenRouterWireMessage[] = [{ role: 'user', content: request.prompt }]
    const rounds: ProviderToolLoopRound[] = []
    const observations: ProviderObservation[] = [this.observation('queued', 'OpenRouter queued the grounded tool loop.')]
    const maxToolCalls = Math.max(0, request.budget.max_tool_calls)
    let executedToolCalls = 0
    let sawToolCall = false

    // ---- Phase 1: grounded gather loop ----
    for (let round = 0; round < MAX_TOOL_LOOP_ROUNDS; round++) {
      const response = await this.createChatCompletion(request, { tools, tool_choice: 'auto' }, messages)
      const truncated = truncatedReasoningDiagnostic(response)
      if (truncated !== undefined) {
        throw new Error(truncated)
      }
      const message = response.choices?.[0]?.message
      const rawToolCalls = (message?.tool_calls ?? []).filter(
        (call) => typeof call.function?.name === 'string' && sanitizedToOriginal.has(call.function.name),
      )

      if (rawToolCalls.length === 0) {
        // Model answered without (further) tool requests — gather phase is done.
        break
      }
      sawToolCall = true

      // Echo the assistant's tool-call message back into the conversation (required so the following
      // `tool` result messages are valid in the OpenAI-compatible protocol).
      messages.push({
        role: 'assistant',
        content: typeof message?.content === 'string' ? message.content : '',
        tool_calls: rawToolCalls.map((call, index) => ({
          id: call.id ?? `openrouter_tool_call_${round}_${index}`,
          type: 'function',
          function: { name: call.function!.name!, arguments: call.function?.arguments ?? '{}' },
        })),
      })

      for (let index = 0; index < rawToolCalls.length; index++) {
        const call = rawToolCalls[index]!
        const toolCallId = call.id ?? `openrouter_tool_call_${round}_${index}`
        const originalName = sanitizedToOriginal.get(call.function!.name!)!
        if (executedToolCalls >= maxToolCalls) {
          // Cap reached mid-round: tell the model the budget is exhausted so it stops requesting tools.
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: `TOOL BUDGET EXHAUSTED: the maximum of ${maxToolCalls} tool calls has been reached. Do not request further tools; proceed to synthesize your answer from the sources already gathered.`,
          })
          continue
        }
        const args = this.parseToolArguments(call.function?.arguments)
        let result: string
        try {
          result = await executor(originalName, args)
        } catch (error) {
          result = `TOOL ERROR: ${redactProviderDiagnostic(error)}`
        }
        executedToolCalls++
        rounds.push({ tool_name: originalName, args, result })
        observations.push(this.observation('tool-call', `OpenRouter grounded tool ${originalName} executed by the harness.`))
        messages.push({ role: 'tool', tool_call_id: toolCallId, content: result })
      }

      if (executedToolCalls >= maxToolCalls) {
        // Budget spent — stop gathering and proceed to synthesis with what we have.
        break
      }
    }

    // ---- Phase 2: structured synthesis (json schema, NO tools) ----
    const synthesis = await this.createChatCompletion(
      request,
      {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.response_format.kind === 'json-schema' ? request.response_format.schema_name : 'owlfolio_structured_response',
            strict: true,
            schema: toStrictJsonSchema(z.toJSONSchema(schema)),
          },
        },
      },
      [
        ...messages,
        {
          role: 'user',
          content:
            'Now produce your final answer as JSON matching the required schema. Cite ONLY the source ids surfaced by the tool results above; do not invent or cite any source you did not fetch through the tools.',
        },
      ],
    )
    const truncated = truncatedReasoningDiagnostic(synthesis)
    if (truncated !== undefined) {
      throw new Error(`Structured output validation failed: ${truncated}`)
    }
    const analysis = this.parseStructured(synthesis, schema)
    observations.push(this.observation('completed', 'OpenRouter completed the grounded tool loop.'))

    return {
      analysis,
      rounds,
      metadata: this.metadataFor(request),
      observations,
      degraded_no_tools: !sawToolCall,
    }
  }

  private parseStructured<T>(response: OpenRouterChatResponse, schema: ZodType<T>): T {
    const raw = this.messageTextFrom(response)
    let parsed: unknown
    try {
      parsed = stripNullProperties(JSON.parse(this.stripJsonFences(raw)))
    } catch (error) {
      throw new Error(`Structured output validation failed: OpenRouter returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }
    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      throw new Error(`Structured output validation failed: ${validated.error.message}`)
    }
    return validated.data
  }

  private async createChatCompletion(
    request: ProviderRunRequest,
    extraBody: Record<string, unknown>,
    messages?: OpenRouterWireMessage[],
  ): Promise<OpenRouterChatResponse> {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      throw new Error('OpenRouter is not configured: missing OPENROUTER_API_KEY')
    }

    const body = this.omitUndefined({
      model: request.model_id,
      messages: messages ?? [{ role: 'user', content: request.prompt }],
      max_tokens: request.budget.max_tokens,
      // OWNER REQUIREMENT: reasoning/thinking enabled. OpenRouter's unified `reasoning` param toggles
      // extended thinking across providers (Anthropic thinking, OpenAI reasoning effort, DeepSeek R1's
      // native reasoning). `enabled: true` lets each routed provider apply its default reasoning budget.
      reasoning: { enabled: true },
      ...extraBody,
    })

    let response: Response
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter attribution headers (optional but recommended for ranking/usage clarity).
          'HTTP-Referer': 'https://github.com/owlfolio/owlfolio',
          'X-Title': 'Owlfolio',
        },
        body: JSON.stringify(body),
      }, request.timeout_ms)
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error(`OpenRouter timed out after ${request.timeout_ms}ms`)
      }
      throw new Error(`OpenRouter request failed: ${redactProviderDiagnostic(error)}`)
    }

    const parsed = await this.parseResponseBody(response)
    if (!response.ok) {
      throw new Error(this.failureMessageFrom(response, parsed))
    }
    // OpenRouter returns HTTP 200 with an `error` object for some upstream failures.
    if (parsed.error !== undefined) {
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

  private async parseResponseBody(response: Response): Promise<OpenRouterChatResponse> {
    const text = await response.text()
    if (text.trim().length === 0) {
      return {}
    }

    try {
      return JSON.parse(text) as OpenRouterChatResponse
    } catch (error) {
      throw new Error(`OpenRouter returned invalid JSON: ${redactProviderDiagnostic(error)}`)
    }
  }

  private failureMessageFrom(response: Response, body: OpenRouterChatResponse): string {
    const rawDiagnostic = body.error?.message ?? response.statusText ?? 'unknown error'
    const diagnostic = redactProviderDiagnostic(rawDiagnostic)
    const code = `${body.error?.code ?? ''} ${body.error?.type ?? ''}`
    const status = response.status === 200 && typeof body.error?.code === 'number' ? body.error.code : response.status
    const statusPrefix = `OpenRouter failed with status ${status} ${response.statusText || ''}`.trim()

    if (status === 429 || /quota|rate.?limit|too_many_requests|insufficient.?(credits|balance)/i.test(`${code} ${rawDiagnostic}`)) {
      return `OpenRouter quota or rate limit failure: ${diagnostic}`
    }

    if (status === 401 || status === 403 || /auth|unauthorized|forbidden|invalid_api_key|no auth credentials/i.test(`${code} ${rawDiagnostic}`)) {
      return `OpenRouter authentication failure: ${diagnostic}`
    }

    return `${statusPrefix}: ${diagnostic}`
  }

  private messageTextFrom(body: OpenRouterChatResponse): string {
    const content = body.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  }

  /** Some reasoning models wrap structured JSON in ```json fences despite json_schema mode. */
  private stripJsonFences(raw: string): string {
    const trimmed = raw.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
    return fenced !== null ? fenced[1]!.trim() : trimmed
  }

  private toolCallsFrom(body: OpenRouterChatResponse, sanitizedToOriginal: ReadonlyMap<string, string>): ProviderToolCall[] {
    const calls = body.choices?.[0]?.message?.tool_calls ?? []
    return calls
      .filter((call) => typeof call.function?.name === 'string' && sanitizedToOriginal.has(call.function.name))
      .map((call, index) => ({
        tool_call_id: call.id ?? `openrouter_tool_call_${index + 1}`,
        // Map the sanitized wire name back to the original Owlfolio tool id (e.g. source_fetch → source.fetch).
        tool_name: sanitizedToOriginal.get(call.function!.name!)!,
        input: this.parseToolArguments(call.function?.arguments),
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
      provider_surface_id: request.provider_surface_id ?? 'openrouter-api',
      vendor_id: request.vendor_id ?? 'openrouter',
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
    return { at: new Date().toISOString(), stage, message }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }

  private omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined))
  }
}
