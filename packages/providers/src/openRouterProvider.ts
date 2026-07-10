import { z, type ZodType } from 'zod'

import type { ProviderId } from '@owlfolio/shared'

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
  // Generalization knobs so this OpenAI-compatible adapter also serves the direct OpenAI/Anthropic/Gemini
  // `/chat/completions` surfaces. Defaults preserve OpenRouter behavior byte-identically.
  /** provider_id this instance reports (default 'openrouter'). */
  providerId?: ProviderId
  /** Display label used in observations/errors (default 'OpenRouter'). */
  label?: string
  /** Env var read for the API key when `apiKey` is not passed (default 'OPENROUTER_API_KEY'). */
  apiKeyEnvVar?: string
  /** Extra body merged into every request (default OpenRouter's unified reasoning param). Pass {} to omit. */
  reasoningBody?: Record<string, unknown>
  /** Extra request headers (default OpenRouter attribution headers). */
  extraHeaders?: Record<string, string>
  /** provider_surface_id / vendor_id fallbacks for run metadata (default OpenRouter's). */
  surfaceId?: NonNullable<ProviderRunMetadata['provider_surface_id']>
  vendorId?: NonNullable<ProviderRunMetadata['vendor_id']>
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
  /** OpenAI-compatible usage block (OpenRouter forwards it for most routed models). */
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; code?: string | number; type?: string; metadata?: { raw?: string; provider_name?: string } }
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

/** Numeric range keywords Anthropic's structured output rejects on the wire (dropped; Zod re-enforces). */
const NUMERIC_RANGE_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']

/**
 * Pinned sampling temperature for every call. At the routes' default (~1.0), back-to-back runs on the
 * SAME model + filing wandered 26% apart on owner-earnings/share purely from judgment-input sampling
 * (maintenance-capex tier, argued growth). Low-but-nonzero keeps judgments stable without the degenerate
 * repetition some routes exhibit at exactly 0. Live-probed 2026-07-03: anthropic/* (with the unified
 * reasoning param — OpenRouter normalizes the thinking/temperature conflict) and z-ai/* both accept it.
 */
const SAMPLING_TEMPERATURE = 0.2

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
    // z.string().url()) and the `$schema` dialect marker are not accepted; drop them. Anthropic's
    // structured output additionally 400s on numeric range keywords ("For 'number' type, property
    // 'minimum' is not supported" — live-probed 2026-07-03), so z.number().min(0) breaks anthropic/*
    // routes; drop those too. The real contract is still enforced by our Zod validation after parsing,
    // so dropping these from the wire schema is safe.
    if (key === '$schema' || key === 'format' || NUMERIC_RANGE_KEYWORDS.includes(key)) {
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
  // Preserve dropped numeric bounds as a natural-language hint (same pattern as `format` above) so the
  // model still respects the range; Zod re-enforces it after parsing and the validated-agent retry
  // bounces violations.
  const rangeHints: string[] = []
  if (typeof record.minimum === 'number') rangeHints.push(`>= ${record.minimum}`)
  if (typeof record.maximum === 'number') rangeHints.push(`<= ${record.maximum}`)
  if (typeof record.exclusiveMinimum === 'number') rangeHints.push(`> ${record.exclusiveMinimum}`)
  if (typeof record.exclusiveMaximum === 'number') rangeHints.push(`< ${record.exclusiveMaximum}`)
  if (rangeHints.length > 0) {
    const hint = `Must be ${rangeHints.join(' and ')}.`
    out.description = typeof out.description === 'string' && out.description.length > 0 ? `${out.description} ${hint}` : hint
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

/**
 * Remove ONLY the null-valued object keys the schema actually rejected (by Zod issue path), so an
 * originally-OPTIONAL field emitted as null (strict mode forces every key, `makeNullable` lets the model
 * emit null instead of fabricating) reads as absent — while a genuinely REQUIRED-nullable field's null
 * (e.g. the Shariah pass's impermissible_income, where null = "not separately disclosed", fail-closed)
 * survives to validation. A blanket pre-parse null-strip destroyed that honest answer.
 * Returns true when at least one key was removed (progress — the caller re-validates).
 */
function removeRejectedNulls(parsed: unknown, issues: readonly { path: PropertyKey[] }[]): boolean {
  let removed = false
  for (const issue of issues) {
    if (issue.path.length === 0) continue
    let parent: unknown = parsed
    for (const segment of issue.path.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object') {
        parent = undefined
        break
      }
      parent = (parent as Record<PropertyKey, unknown>)[segment]
    }
    const key = issue.path[issue.path.length - 1]
    // Only delete a null-valued plain-object property (array elements are left alone — deleting would
    // shift indexes; the schema error then surfaces as-is).
    if (
      key !== undefined && typeof key === 'string'
      && parent !== null && typeof parent === 'object' && !Array.isArray(parent)
      && (parent as Record<string, unknown>)[key] === null
    ) {
      delete (parent as Record<string, unknown>)[key]
      removed = true
    }
  }
  return removed
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
function truncatedReasoningDiagnostic(body: OpenRouterChatResponse, label: string): string | undefined {
  const choice = body.choices?.[0]
  const content = choice?.message?.content
  const hasContent = typeof content === 'string' && content.trim().length > 0
  if (!hasContent && choice?.finish_reason === 'length') {
    return `${label} response was truncated (finish_reason=length) before any visible content was produced — the reasoning budget likely consumed the entire max_tokens. Increase max_tokens for this reasoning model.`
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
  readonly provider_id: ProviderId
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
  private readonly apiKeyEnvVar: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly label: string
  private readonly reasoningBody: Record<string, unknown>
  private readonly extraHeaders: Record<string, string>
  private readonly surfaceId: NonNullable<ProviderRunMetadata['provider_surface_id']>
  private readonly vendorId: NonNullable<ProviderRunMetadata['vendor_id']>

  constructor(options: OpenRouterProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.provider_id = options.providerId ?? 'openrouter'
    this.label = options.label ?? 'OpenRouter'
    this.apiKeyEnvVar = options.apiKeyEnvVar ?? 'OPENROUTER_API_KEY'
    this.apiKey = options.apiKey ?? this.env[this.apiKeyEnvVar]
    this.baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.reasoningBody = options.reasoningBody ?? { reasoning: { enabled: true } }
    this.extraHeaders = options.extraHeaders ?? {
      // OpenRouter attribution headers (optional but recommended for ranking/usage clarity).
      'HTTP-Referer': 'https://github.com/owlfolio/owlfolio',
      'X-Title': 'Owlfolio',
    }
    this.surfaceId = options.surfaceId ?? 'openrouter-api'
    this.vendorId = options.vendorId ?? 'openrouter'
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
    const truncated = truncatedReasoningDiagnostic(response, this.label)
    if (truncated !== undefined) {
      throw new Error(truncated)
    }
    const text = this.messageTextFrom(response).trim()

    return {
      text,
      metadata: this.metadataFor(request),
      observations: [
        this.observation('queued', `${this.label} queued the request.`),
        this.observation('completed', `${this.label} completed the request.`),
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
    const truncated = truncatedReasoningDiagnostic(response, this.label)
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
        this.observation('queued', `${this.label} queued the tool-capable request.`),
        ...toolCalls.map((toolCall) => this.observation('tool-call', `${this.label} requested Owlfolio-owned tool ${toolCall.tool_name}.`)),
        this.observation('completed', `${this.label} completed the tool-capable request.`),
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
    // S5 cost stamping: sum reported usage across EVERY request this loop issues (gather rounds,
    // synthesis, repair retries). Undefined until the route reports usage at least once.
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    const addUsage = (response: OpenRouterChatResponse): void => {
      const usage = response.usage
      if (usage === undefined) return
      if (typeof usage.prompt_tokens === 'number') inputTokens = (inputTokens ?? 0) + usage.prompt_tokens
      if (typeof usage.completion_tokens === 'number') outputTokens = (outputTokens ?? 0) + usage.completion_tokens
    }
    const observations: ProviderObservation[] = [this.observation('queued', `${this.label} queued the grounded tool loop.`)]
    const maxToolCalls = Math.max(0, request.budget.max_tool_calls)
    let executedToolCalls = 0
    let sawToolCall = false

    // ---- Phase 1: grounded gather loop ----
    for (let round = 0; round < MAX_TOOL_LOOP_ROUNDS; round++) {
      const response = await this.createChatCompletion(request, { tools, tool_choice: 'auto' }, messages)
      addUsage(response)
      const truncated = truncatedReasoningDiagnostic(response, this.label)
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
        observations.push(this.observation('tool-call', `${this.label} grounded tool ${originalName} executed by the harness.`))
        messages.push({ role: 'tool', tool_call_id: toolCallId, content: result })
      }

      if (executedToolCalls >= maxToolCalls) {
        // Budget spent — stop gathering and proceed to synthesis with what we have.
        break
      }
    }

    // ---- Phase 2: structured synthesis (json schema, NO tools) ----
    // Final synthesis with ONE schema-repair retry (live find: Kimi K2 Thinking returned a circle-gate
    // object missing required judgment fields and the whole run died on first parse). On validation
    // failure the model gets its own reply back plus the exact validation errors and one chance to
    // return corrected JSON — a judgment field is never invented harness-side. A second failure throws.
    const synthesisFormat = {
      response_format: {
        type: 'json_schema' as const,
        json_schema: {
          name: request.response_format.kind === 'json-schema' ? request.response_format.schema_name : 'owlfolio_structured_response',
          strict: true,
          schema: toStrictJsonSchema(z.toJSONSchema(schema)),
        },
      },
    }
    let synthesisMessages = [
      ...messages,
      {
        role: 'user' as const,
        content:
          'Now produce your final answer as JSON matching the required schema. Cite ONLY the source ids surfaced by the tool results above; do not invent or cite any source you did not fetch through the tools.',
      },
    ]
    let analysis: T | undefined
    let lastParseError: Error | undefined
    for (let attempt = 0; attempt < 2 && analysis === undefined; attempt++) {
      const synthesis = await this.createChatCompletion(request, synthesisFormat, synthesisMessages)
      addUsage(synthesis)
      const truncated = truncatedReasoningDiagnostic(synthesis, this.label)
      if (truncated !== undefined) {
        throw new Error(`Structured output validation failed: ${truncated}`)
      }
      try {
        analysis = this.parseStructured(synthesis, schema)
      } catch (error) {
        lastParseError = error instanceof Error ? error : new Error(String(error))
        observations.push(this.observation('running', `${this.label} structured output failed validation; requesting a corrected response (attempt ${attempt + 1}).`))
        synthesisMessages = [
          ...synthesisMessages,
          { role: 'assistant' as const, content: this.messageTextFrom(synthesis) },
          {
            role: 'user' as const,
            content: `Your previous response failed schema validation with these errors:\n${lastParseError.message}\nReturn ONLY the corrected JSON object matching the required schema — include EVERY required field and use only the allowed enum values.`,
          },
        ]
      }
    }
    if (analysis === undefined) {
      throw lastParseError ?? new Error('Structured output validation failed')
    }
    observations.push(this.observation('completed', `${this.label} completed the grounded tool loop.`))

    return {
      analysis,
      rounds,
      metadata: {
        ...this.metadataFor(request),
        ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
        ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
      },
      observations,
      degraded_no_tools: !sawToolCall,
    }
  }

  private parseStructured<T>(response: OpenRouterChatResponse, schema: ZodType<T>): T {
    const raw = this.messageTextFrom(response)
    let parsed: unknown
    try {
      parsed = JSON.parse(this.stripJsonFences(raw))
    } catch (error) {
      throw new Error(`Structured output validation failed: ${this.label} returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }
    // Validate as-is first so a schema-ACCEPTED null (a required-nullable field's meaningful answer)
    // survives; only nulls the schema rejects are removed (per issue path) and validation retried.
    // Terminates: every retry must have removed at least one key, else it throws.
    for (;;) {
      const validated = schema.safeParse(parsed)
      if (validated.success) {
        return validated.data
      }
      if (!removeRejectedNulls(parsed, validated.error.issues)) {
        throw new Error(`Structured output validation failed: ${validated.error.message}`)
      }
    }
  }

  private async createChatCompletion(
    request: ProviderRunRequest,
    extraBody: Record<string, unknown>,
    messages?: OpenRouterWireMessage[],
  ): Promise<OpenRouterChatResponse> {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      throw new Error(`${this.label} is not configured: missing ${this.apiKeyEnvVar}`)
    }

    const body = this.omitUndefined({
      model: request.model_id,
      messages: messages ?? [{ role: 'user', content: request.prompt }],
      max_tokens: request.budget.max_tokens,
      temperature: SAMPLING_TEMPERATURE,
      // OWNER REQUIREMENT: reasoning/thinking enabled. For OpenRouter this is the unified `reasoning` param
      // (Anthropic thinking, OpenAI reasoning effort, DeepSeek R1 native). Direct OpenAI-compat surfaces that
      // reject an unknown `reasoning` param are configured with an empty reasoningBody (omitted) instead.
      ...this.reasoningBody,
      ...extraBody,
    })

    let response: Response
    try {
      response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
      }, request.timeout_ms)
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error(`${this.label} timed out after ${request.timeout_ms}ms`)
      }
      throw new Error(`${this.label} request failed: ${redactProviderDiagnostic(error)}`)
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
      throw new Error(`${this.label} returned invalid JSON: ${redactProviderDiagnostic(error)}`)
    }
  }

  private failureMessageFrom(response: Response, body: OpenRouterChatResponse): string {
    // OpenRouter wraps routed-provider failures as a bare "Provider returned error"; the actionable
    // upstream diagnostic (e.g. Anthropic's schema-keyword rejection) lives in error.metadata.raw.
    // Surface it so a degraded flag in the ledger is diagnosable without re-running the request.
    const upstreamRaw = body.error?.metadata?.raw
    const upstream = typeof upstreamRaw === 'string' && upstreamRaw.trim().length > 0
      ? ` [${body.error?.metadata?.provider_name ?? 'upstream'}: ${upstreamRaw.slice(0, 500)}]`
      : ''
    const rawDiagnostic = `${body.error?.message ?? response.statusText ?? 'unknown error'}${upstream}`
    const diagnostic = redactProviderDiagnostic(rawDiagnostic)
    const code = `${body.error?.code ?? ''} ${body.error?.type ?? ''}`
    const status = response.status === 200 && typeof body.error?.code === 'number' ? body.error.code : response.status
    const statusPrefix = `${this.label} failed with status ${status} ${response.statusText || ''}`.trim()

    if (status === 429 || /quota|rate.?limit|too_many_requests|insufficient.?(credits|balance)/i.test(`${code} ${rawDiagnostic}`)) {
      return `${this.label} quota or rate limit failure: ${diagnostic}`
    }

    if (status === 401 || status === 403 || /auth|unauthorized|forbidden|invalid_api_key|no auth credentials/i.test(`${code} ${rawDiagnostic}`)) {
      return `${this.label} authentication failure: ${diagnostic}`
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
      provider_surface_id: request.provider_surface_id ?? this.surfaceId,
      vendor_id: request.vendor_id ?? this.vendorId,
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
