import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { OpenRouterProvider } from '../openRouterProvider'
import { resolveProvider } from '../providerFactory'
import type { ProviderRunRequest } from '../providerContract'

const request: ProviderRunRequest = {
  run_id: 'run_openrouter_001',
  provider_id: 'openrouter',
  provider_surface_id: 'openrouter-api',
  vendor_id: 'openrouter',
  runtime_kind: 'direct_api',
  auth_mode: 'api_key',
  workflow_role: 'research_draft',
  model_id: 'deepseek/deepseek-r1',
  task_kind: 'text-generation',
  prompt: 'Analyze Microsoft as a Buffett-Munger candidate.',
  timeout_ms: 30_000,
  budget: { max_tool_calls: 1, max_tokens: 4_000 },
  tool_allowlist: [],
  response_format: { kind: 'text' },
}

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OpenRouterProvider (credential detection)', () => {
  it('is not ready without OPENROUTER_API_KEY', () => {
    const provider = new OpenRouterProvider({ env: {} })
    expect(provider.isReady()).toBe(false)
  })

  it('reports ready credential detection when OPENROUTER_API_KEY is present', () => {
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'test-key' } })
    expect(provider.isReady()).toBe(true)
  })

  it('fails closed on completion when no credentials are present', async () => {
    const provider = new OpenRouterProvider({ env: {} })
    await expect(provider.complete(request)).rejects.toThrow(/not configured: missing OPENROUTER_API_KEY/)
  })

  it('is resolvable through the provider factory', () => {
    const provider = resolveProvider({ provider_id: 'openrouter', env: { OPENROUTER_API_KEY: 'test-key' } })
    expect(provider.provider_id).toBe('openrouter')
  })

  it('does not overclaim capabilities', () => {
    const provider = new OpenRouterProvider({ env: {} })
    // Source grounding stays UNSUPPORTED on the provider: grounding (SSRF + sha256 + ledger) lives in the
    // workflow harness, never in the adapter. The provider owns only the tool-calling transport + loop.
    expect(provider.capabilities['source-grounding']).toBe('unsupported')
    // The multi-step tool loop is now an adapter capability (runToolLoop drives Phase 1 gather + Phase 2).
    expect(provider.capabilities['multi-step-tool-loop']).toBe('adapter')
  })
})

describe('OpenRouterProvider (live execution path)', () => {
  it('completes via the OpenAI-compatible chat/completions endpoint and passes the model id through', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body.model).toBe('deepseek/deepseek-r1')
      expect(body.messages[0].content).toContain('Buffett-Munger')
      return jsonResponse({ choices: [{ message: { content: 'COST is a wide-moat retailer.' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })

    const completion = await provider.complete(request)
    expect(completion.text).toBe('COST is a wide-moat retailer.')
    expect(completion.finish_reason).toBe('completed')
    const url = fetchImpl.mock.calls[0]![0] as string
    expect(url).toContain('/chat/completions')
  })

  it('requests reasoning/thinking for the routed model (owner requirement)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body.reasoning).toBeDefined()
      expect(body.reasoning.enabled).toBe(true)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await provider.complete(request)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends the OpenRouter attribution headers and bearer auth', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer k')
      expect(headers.get('HTTP-Referer')).toBeTruthy()
      expect(headers.get('X-Title')).toBeTruthy()
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await provider.complete(request)
  })

  it('generalizes to a direct OpenAI-compatible endpoint (custom baseUrl/key, reasoning omitted)', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(String(url)).toBe('https://api.example.com/v1/chat/completions')
      expect(headers.get('Authorization')).toBe('Bearer direct-k')
      const body = JSON.parse(init?.body as string)
      // Direct endpoints that reject OpenRouter's `reasoning` param are configured with an empty reasoningBody.
      expect(body.reasoning).toBeUndefined()
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const provider = new OpenRouterProvider({
      env: { EXAMPLE_API_KEY: 'direct-k' },
      apiKeyEnvVar: 'EXAMPLE_API_KEY',
      baseUrl: 'https://api.example.com/v1',
      label: 'Example',
      reasoningBody: {},
      fetch: fetchImpl as unknown as typeof fetch,
    })
    expect(provider.isReady()).toBe(true)
    await provider.complete(request)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('uses the configured label + key env var in the missing-credential error', async () => {
    const provider = new OpenRouterProvider({ env: {}, apiKeyEnvVar: 'EXAMPLE_API_KEY', label: 'Example' })
    await expect(provider.complete(request)).rejects.toThrow(/Example is not configured: missing EXAMPLE_API_KEY/)
  })

  it('validates structured output against the schema and strips reasoning fences', async () => {
    const schema = z.object({ verdict: z.string() })
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body.response_format.type).toBe('json_schema')
      return jsonResponse({ choices: [{ message: { content: '```json\n{"verdict":"BUY"}\n```' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(result.verdict).toBe('BUY')
  })

  it('sends an OpenAI-strict json_schema (every key required, additionalProperties false) so strict routes accept it', async () => {
    const schema = z.object({ verdict: z.string(), reason: z.string().optional(), nested: z.object({ a: z.string() }) })
    let sentSchema: any
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentSchema = JSON.parse(init?.body as string).response_format.json_schema.schema
      return jsonResponse({ choices: [{ message: { content: '{"verdict":"BUY","reason":"x","nested":{"a":"y"}}' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(sentSchema.additionalProperties).toBe(false)
    expect([...sentSchema.required].sort()).toEqual(['nested', 'reason', 'verdict'])
    // The transform recurses into nested objects too.
    expect(sentSchema.properties.nested.additionalProperties).toBe(false)
    expect(sentSchema.properties.nested.required).toEqual(['a'])
    // Originally-required fields keep a plain type; originally-optional ones become nullable so the model
    // can emit null instead of FABRICATING a value (the strict-mode-correct way to preserve optionality).
    expect(sentSchema.properties.verdict.type).toBe('string')
    expect(sentSchema.properties.reason.type).toEqual(['string', 'null'])
  })

  it('treats an emitted null for an optional field as absent (does not fabricate / does not fail validation)', async () => {
    const schema = z.object({ verdict: z.string(), reason: z.string().optional() })
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"verdict":"PASS","reason":null}' } }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(result.verdict).toBe('PASS')
    expect(result.reason).toBeUndefined()
  })

  it('preserves an emitted null for a REQUIRED nullable field (null is a meaningful answer, not absence)', async () => {
    // Regression: the Shariah reasoning pass declares impermissible_income as required-and-nullable —
    // null = "not separately disclosed, fail closed to UNDETERMINED". Stripping that null before
    // validation deletes the model's honest answer and fails the pass on every non-disclosing filer.
    const schema = z.object({ sector_status: z.string(), impermissible_income: z.number().min(0).nullable() })
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"sector_status":"compliant","impermissible_income":null}' } }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(result.sector_status).toBe('compliant')
    expect(result.impermissible_income).toBeNull()
  })

  it('strips a rejected optional-field null while preserving an accepted nullable null in the SAME payload', async () => {
    // Mixed payload: `note` is optional (null on the wire only because strict mode synthesized
    // nullability — must read as absent) while `amount` is genuinely nullable (null must survive).
    const schema = z.object({ amount: z.number().nullable(), note: z.string().optional() })
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"amount":null,"note":null}' } }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(result.amount).toBeNull()
    expect(result.note).toBeUndefined()
  })

  it('strips json-schema keywords OpenAI strict mode rejects (format uri, $schema dialect)', async () => {
    const schema = z.object({ url: z.string().url() })
    let sentSchema: any
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentSchema = JSON.parse(init?.body as string).response_format.json_schema.schema
      return jsonResponse({ choices: [{ message: { content: '{"url":"https://example.com"}' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema)
    expect(sentSchema.$schema).toBeUndefined()
    expect(sentSchema.properties.url.format).toBeUndefined()
    // The dropped `uri` format is preserved as a natural-language description hint so strict-mode models
    // still emit a valid URL (or null) instead of fabricating prose into the field.
    expect(sentSchema.properties.url.description).toMatch(/https URL/i)
  })

  it('throws a schema validation error when structured JSON does not match', async () => {
    const schema = z.object({ verdict: z.string() })
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"wrong":1}' } }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await expect(
      provider.structured({ ...request, task_kind: 'structured-output', response_format: { kind: 'json-schema', schema_name: 'T' } }, schema),
    ).rejects.toThrow(/Structured output validation failed/)
  })

  it('classifies a 401 as an authentication failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'No auth credentials found' } }, { status: 401, statusText: 'Unauthorized' }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await expect(provider.complete(request)).rejects.toThrow(/authentication failure/i)
  })

  it('classifies a 429 as a quota/rate-limit failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429, statusText: 'Too Many Requests' }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await expect(provider.complete(request)).rejects.toThrow(/quota or rate limit/i)
  })

  it('throws a precise diagnostic when a reasoning model truncates with empty content (finish_reason=length)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await expect(provider.complete(request)).rejects.toThrow(/truncated.*reasoning budget|reasoning budget likely consumed/i)
  })

  it('sanitizes dotted tool names on the wire and maps them back (Anthropic name-pattern compatibility)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      // The wire name must satisfy ^[a-zA-Z0-9_-]+$ — no dot.
      expect(body.tools[0].function.name).toBe('source_fetch')
      return jsonResponse({
        choices: [{
          message: {
            content: null,
            // Provider echoes the sanitized name; the adapter maps it back to the original.
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'source_fetch', arguments: '{"url":"https://example.com"}' } }],
          },
        }],
      })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const run = await provider.runWithTools({ ...request, task_kind: 'tool-loop', tool_allowlist: ['source.fetch'] })
    expect(run.tool_calls).toHaveLength(1)
    expect(run.tool_calls[0]!.tool_name).toBe('source.fetch')
    expect(run.finish_reason).toBe('tool-calls')
    expect(run.ledger_events_written).toBe(0)
  })
})

describe('OpenRouterProvider (grounded multi-step tool loop — runToolLoop)', () => {
  const toolRequest = {
    ...request,
    task_kind: 'tool-loop' as const,
    tool_allowlist: ['fetch_source', 'search_filings'],
    response_format: { kind: 'json-schema' as const, schema_name: 'LaneFinding' },
    budget: { max_tool_calls: 5, max_tokens: 4_000 },
  }
  const schema = z.object({ finding: z.string(), source_ids: z.array(z.string()) })

  it('flips the multi-step-tool-loop capability to adapter', () => {
    const provider = new OpenRouterProvider({ env: {} })
    expect(provider.capabilities['multi-step-tool-loop']).toBe('adapter')
    expect(provider.capabilities['tool-function-calling']).toBe('adapter')
  })

  it('runs Phase 1 (executes injected tool calls) then Phase 2 (structured synthesis)', async () => {
    const executor = vi.fn(async (toolName: string, args: unknown) => {
      expect(toolName).toBe('fetch_source')
      expect(args).toEqual({ url: 'https://www.sec.gov/x' })
      return 'FETCHED source_id=src_1 available excerpt="real bytes"'
    })

    let call = 0
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      call += 1
      if (call === 1) {
        // Phase 1 round 1: tools enabled, NO json schema, reasoning ON.
        expect(body.tools).toBeDefined()
        expect(body.response_format).toBeUndefined()
        expect(body.reasoning.enabled).toBe(true)
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fetch_source', arguments: '{"url":"https://www.sec.gov/x"}' } }],
            },
          }],
        })
      }
      if (call === 2) {
        // Phase 1 round 2: the prior tool result must have been appended; model now answers with no tools.
        const toolMsg = body.messages.find((m: any) => m.role === 'tool')
        expect(toolMsg).toBeDefined()
        expect(toolMsg.content).toContain('src_1')
        return jsonResponse({ choices: [{ message: { content: 'gathered enough' } }] })
      }
      // Phase 2: structured synthesis — json_schema present, NO tools.
      expect(body.response_format.type).toBe('json_schema')
      expect(body.tools).toBeUndefined()
      return jsonResponse({ choices: [{ message: { content: '{"finding":"wide moat","source_ids":["src_1"]}' } }] })
    })

    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.runToolLoop(toolRequest, schema, executor)

    expect(executor).toHaveBeenCalledOnce()
    expect(result.rounds).toHaveLength(1)
    expect(result.rounds[0]!.tool_name).toBe('fetch_source')
    expect(result.analysis.finding).toBe('wide moat')
    expect(result.analysis.source_ids).toEqual(['src_1'])
    expect(result.degraded_no_tools).toBe(false)
    expect(call).toBe(3)
  })

  it('handles parallel tool_calls in one round', async () => {
    const executor = vi.fn(async (toolName: string) => `ran ${toolName}`)
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'fetch_source', arguments: '{"url":"https://a.com"}' } },
                { id: 'c2', type: 'function', function: { name: 'search_filings', arguments: '{"ticker":"MSFT"}' } },
              ],
            },
          }],
        })
      }
      if (call === 2) return jsonResponse({ choices: [{ message: { content: 'done' } }] })
      return jsonResponse({ choices: [{ message: { content: '{"finding":"x","source_ids":[]}' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.runToolLoop(toolRequest, schema, executor)
    expect(executor).toHaveBeenCalledTimes(2)
    expect(result.rounds).toHaveLength(2)
  })

  it('enforces max_tool_calls: stops gathering at the cap and proceeds to Phase 2', async () => {
    const executor = vi.fn(async () => 'ok')
    let call = 0
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      call += 1
      // The model keeps requesting one tool every round; only the cap stops it.
      if (body.tools !== undefined) {
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: `c${call}`, type: 'function', function: { name: 'fetch_source', arguments: '{"url":"https://a.com"}' } }],
            },
          }],
        })
      }
      // Phase 2 (no tools sent).
      return jsonResponse({ choices: [{ message: { content: '{"finding":"capped","source_ids":[]}' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.runToolLoop({ ...toolRequest, budget: { max_tool_calls: 3, max_tokens: 4_000 } }, schema, executor)
    // Exactly the cap of tool executions, then it stopped and synthesized.
    expect(executor).toHaveBeenCalledTimes(3)
    expect(result.analysis.finding).toBe('capped')
  })

  it('no-tool-call path: model answers directly, Phase 2 still runs, degraded flag set', async () => {
    const executor = vi.fn(async () => 'ok')
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) return jsonResponse({ choices: [{ message: { content: 'I will not call tools' } }] })
      return jsonResponse({ choices: [{ message: { content: '{"finding":"no tools","source_ids":[]}' } }] })
    })
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    const result = await provider.runToolLoop(toolRequest, schema, executor)
    expect(executor).not.toHaveBeenCalled()
    expect(result.degraded_no_tools).toBe(true)
    expect(result.analysis.finding).toBe('no tools')
  })

  it('surfaces the reasoning-truncation diagnostic during the gather loop', async () => {
    const executor = vi.fn(async () => 'ok')
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }))
    const provider = new OpenRouterProvider({ env: { OPENROUTER_API_KEY: 'k' }, fetch: fetchImpl as unknown as typeof fetch })
    await expect(provider.runToolLoop(toolRequest, schema, executor)).rejects.toThrow(/truncated|reasoning budget/i)
  })
})
