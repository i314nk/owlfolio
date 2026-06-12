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
    expect(provider.capabilities['source-grounding']).toBe('unsupported')
    expect(provider.capabilities['multi-step-tool-loop']).toBe('unsupported')
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
