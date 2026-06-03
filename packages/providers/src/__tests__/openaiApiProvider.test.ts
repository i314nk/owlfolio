import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { OpenAIAPIProvider } from '../openaiApiProvider'
import { resolveProvider } from '../providerFactory'
import type { ProviderRunRequest } from '../providerContract'

const request: ProviderRunRequest = {
  run_id: 'run_msft_openai_api_001',
  provider_id: 'openai-api',
  provider_surface_id: 'openai-api',
  vendor_id: 'openai',
  runtime_kind: 'direct_api',
  auth_mode: 'api_key',
  workflow_role: 'research_draft',
  model_id: 'gpt-4.1-mini',
  task_kind: 'structured-output',
  prompt: 'Analyze Microsoft as a Buffett-Munger candidate.',
  timeout_ms: 30_000,
  budget: {
    max_tool_calls: 1,
    max_tokens: 4_000,
  },
  tool_allowlist: ['source.fetch'],
  response_format: {
    kind: 'json-schema',
    schema_name: 'buffett_munger_research',
  },
}

const OpenAIResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string(),
  source_ids: z.array(z.string()),
  source_records: z.array(z.object({
    source_id: z.string(),
    title: z.string(),
    url: z.string().url(),
    excerpt: z.string(),
  })),
})

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const responseInit: ResponseInit = {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(init.headers).entries()) },
  }
  if (init.statusText !== undefined) {
    responseInit.statusText = init.statusText
  }

  return new Response(JSON.stringify(body), responseInit)
}

describe('OpenAIAPIProvider', () => {
  it('sends structured output requests to the direct OpenAI API surface without using Codex credentials', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} })
      return jsonResponse({
        id: 'resp_structured_001',
        output_text: JSON.stringify({
          investment_verdict: 'WATCH',
          strategy_compliance: 'CONDITIONAL',
          shariah_status: 'COMPLIANT',
          valuation_status: 'FAIR',
          next_required_action: 'Refresh valuation after the next filing.',
          source_ids: ['src_msft_10k_2025'],
          source_records: [
            {
              source_id: 'src_msft_10k_2025',
              title: 'Microsoft 10-K FY2025',
              url: 'https://example.test/msft-10k',
              excerpt: 'Azure growth remained durable.',
            },
          ],
        }),
      })
    })
    const provider = new OpenAIAPIProvider({
      env: {
        OPENAI_API_KEY: 'sk-test-openai-api-key',
        CODEX_ACCESS_TOKEN: 'codex-token-must-not-be-used',
      },
      fetch: fetchImpl,
    })

    const result = await provider.structured(request, OpenAIResearchSchema)

    expect(result.investment_verdict).toBe('WATCH')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchCalls[0]?.url).toBe('https://api.openai.com/v1/responses')
    expect(fetchCalls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer sk-test-openai-api-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.stringify(fetchCalls[0]?.init.headers)).not.toContain('codex-token-must-not-be-used')
    const body = JSON.parse(String(fetchCalls[0]?.init.body)) as any
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      input: request.prompt,
      max_output_tokens: 4_000,
      text: {
        format: {
          type: 'json_schema',
          name: 'buffett_munger_research',
          strict: true,
        },
      },
    })
    expect(body.text.format.schema.properties.source_records).toBeDefined()
    expect(body.tools).toBeUndefined()
  })

  it('maps OpenAI function-call responses into provider tool runs while reporting zero direct ledger writes', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} })
      return jsonResponse({
      id: 'resp_tools_001',
      output: [
        {
          type: 'function_call',
          id: 'fc_001',
          call_id: 'call_source_fetch_001',
          name: 'source.fetch',
          arguments: '{"ticker":"MSFT","filing":"10-K"}',
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Use the returned source bundle before drafting research.' }],
        },
      ],
      })
    })
    const provider = new OpenAIAPIProvider({ env: { OPENAI_API_KEY: 'sk-test-openai-api-key' }, fetch: fetchImpl })

    const run = await provider.runWithTools({ ...request, task_kind: 'tool-loop', response_format: { kind: 'text' } })

    expect(run).toMatchObject({
      text: 'Use the returned source bundle before drafting research.',
      finish_reason: 'tool-calls',
      ledger_events_written: 0,
      metadata: {
        provider_id: 'openai-api',
        provider_surface_id: 'openai-api',
        runtime_kind: 'direct_api',
        auth_mode: 'api_key',
      },
      tool_calls: [
        {
          tool_call_id: 'call_source_fetch_001',
          tool_name: 'source.fetch',
          input: { ticker: 'MSFT', filing: '10-K' },
          output: { status: 'proposed', note: 'Tool execution is owned by Owlfolio, not the provider adapter.' },
        },
      ],
    })
    const body = JSON.parse(String(fetchCalls[0]?.init.body)) as any
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'source.fetch',
        description: expect.stringContaining('Owlfolio-owned'),
      }),
    ])
    expect(JSON.stringify(run)).not.toContain('sk-test-openai-api-key')
  })

  it('classifies OpenAI API failures with redacted diagnostics', async () => {
    const provider = new OpenAIAPIProvider({
      env: { OPENAI_API_KEY: 'sk-test-openai-api-key' },
      fetch: async () => jsonResponse({
        error: {
          message: 'Rate limit exhausted for Authorization: Bearer sk-live-secret and OPENAI_API_KEY=sk-live-secret',
          code: 'rate_limit_exceeded',
        },
      }, { status: 429, statusText: 'Too Many Requests' }),
    })

    let error: unknown
    try {
      await provider.complete({ ...request, task_kind: 'text-generation', response_format: { kind: 'text' } })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toMatch(/OpenAI API quota or rate limit failure.*\[redacted-secret\]/)
    expect(message).not.toContain('***')
    expect(message).not.toContain('sk-tes...-key')
  })

  it('reports request timeouts without leaking request credentials', async () => {
    const provider = new OpenAIAPIProvider({
      env: { OPENAI_API_KEY: 'sk-test-openai-api-key' },
      fetch: async () => Promise.reject(Object.assign(new Error('The operation was aborted with sk-test-openai-api-key'), { name: 'AbortError' })),
    })

    await expect(provider.complete({ ...request, timeout_ms: 123, task_kind: 'text-generation', response_format: { kind: 'text' } })).rejects.toThrow(
      'OpenAI API timed out after 123ms',
    )
  })

  it('resolves openai-api separately from the OpenAI Codex CLI provider', () => {
    const provider = resolveProvider({ provider_id: 'openai-api', env: { OPENAI_API_KEY: 'sk-test-openai-api-key' } })

    expect(provider).toBeInstanceOf(OpenAIAPIProvider)
    expect(provider.provider_id).toBe('openai-api')
  })
})
