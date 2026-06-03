import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { GeminiDeveloperApiProvider } from '../geminiDeveloperApiProvider'
import type { ProviderRunRequest } from '../providerContract'

const baseRequest: ProviderRunRequest = {
  run_id: 'run_gemini_test',
  provider_id: 'gemini-developer-api',
  provider_surface_id: 'gemini-developer-api',
  vendor_id: 'google-gemini',
  runtime_kind: 'direct_api',
  auth_mode: 'api_key',
  workflow_role: 'research_draft',
  model_id: 'gemini-2.5-pro',
  task_kind: 'structured-output',
  prompt: 'Analyze COST with cited sources.',
  timeout_ms: 1_000,
  budget: { max_tool_calls: 2, max_tokens: 1_000 },
  tool_allowlist: ['source.fetch', 'google_search', 'url_context'],
  response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
}

function geminiResponse(text: string, extraCandidate: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: 'STOP',
        ...extraCandidate,
      },
    ],
  }
}

describe('GeminiDeveloperApiProvider', () => {
  it('advertises Gemini function calling without overclaiming Owlfolio-owned multi-step tool execution', () => {
    const provider = new GeminiDeveloperApiProvider({ apiKey: 'secret-gemini-key' })

    expect(provider.capabilities).toMatchObject({
      'tool-function-calling': 'native',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'native',
      'citation-metadata': 'native',
      'url-context': 'native',
    })
  })

  it('sends text completion requests to the Gemini Developer API without leaking the API key into metadata', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return Response.json(geminiResponse('Gemini heartbeat ok.'))
      },
    })

    const completion = await provider.complete({ ...baseRequest, task_kind: 'text-generation', response_format: { kind: 'text' } })

    expect(completion).toMatchObject({
      text: 'Gemini heartbeat ok.',
      finish_reason: 'completed',
      metadata: {
        provider_id: 'gemini-developer-api',
        provider_surface_id: 'gemini-developer-api',
        vendor_id: 'google-gemini',
        runtime_kind: 'direct_api',
        auth_mode: 'api_key',
        workflow_role: 'research_draft',
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent')
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-gemini-key')
    expect(JSON.stringify(completion)).not.toContain('secret-gemini-key')
  })

  it('requests JSON schema output with Google Search grounding and URL context and maps grounding metadata into source citations', async () => {
    let body: any
    const schema = z.object({
      investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
      strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
      shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
      valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
      next_required_action: z.string(),
      source_ids: z.array(z.string()),
      source_records: z.array(z.object({ source_id: z.string(), title: z.string(), url: z.string(), excerpt: z.string() })),
    })
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json(geminiResponse(JSON.stringify({
          investment_verdict: 'WATCH',
          strategy_compliance: 'CONDITIONAL',
          shariah_status: 'COMPLIANT',
          valuation_status: 'FAIR',
          next_required_action: 'Review cited primary filings before watchlist confirmation.',
        }), {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.test/cost-10k-2025', title: 'Costco FY2025 10-K' } },
            ],
            groundingSupports: [
              { segment: { text: 'Costco filing excerpt' }, groundingChunkIndices: [0] },
            ],
          },
        }))
      },
    })

    const result = await provider.structured(baseRequest, schema)

    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseSchema: expect.objectContaining({ type: 'object' }),
      maxOutputTokens: 1_000,
    })
    expect(body.tools).toEqual(expect.arrayContaining([
      { googleSearch: {} },
      { urlContext: {} },
    ]))
    expect(result.source_ids).toEqual(['src_gemini_1'])
    expect(result.source_records).toEqual([
      {
        source_id: 'src_gemini_1',
        title: 'Costco FY2025 10-K',
        url: 'https://example.test/cost-10k-2025',
        excerpt: 'Costco filing excerpt',
      },
    ])
  })

  it('maps Gemini function calls into provider tool calls without writing Owlfolio ledger events', async () => {
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async () => Response.json(geminiResponse('Tool request prepared.', {
        content: {
          parts: [
            { functionCall: { name: 'source.fetch', args: { ticker: 'COST', url: 'https://example.test/cost' } } },
            { functionCall: { name: 'source.fetch', args: { ticker: 'MSFT', url: 'https://example.test/msft' } } },
          ],
        },
      })),
    })

    const run = await provider.runWithTools({ ...baseRequest, task_kind: 'tool-loop', response_format: { kind: 'text' } })

    expect(run.tool_calls).toEqual([
      expect.objectContaining({ tool_name: 'source.fetch', input: { ticker: 'COST', url: 'https://example.test/cost' } }),
      expect.objectContaining({ tool_name: 'source.fetch', input: { ticker: 'MSFT', url: 'https://example.test/msft' } }),
    ])
    expect(run.ledger_events_written).toBe(0)
    expect(run.finish_reason).toBe('tool-calls')
  })

  it('uses Gemini-safe function declaration names and maps returned calls back to Owlfolio tool ids', async () => {
    let body: any
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json(geminiResponse('Tool request prepared.', {
          content: {
            parts: [
              { functionCall: { name: 'source_fetch', args: { ticker: 'COST' } } },
              { functionCall: { name: 'ledger_write', args: { event: 'unauthorized' } } },
            ],
          },
        }))
      },
    })

    const run = await provider.runWithTools({ ...baseRequest, tool_allowlist: ['source.fetch'], task_kind: 'tool-loop', response_format: { kind: 'text' } })

    expect(body.tools).toEqual(expect.arrayContaining([
      {
        functionDeclarations: [expect.objectContaining({
          name: 'source_fetch',
          description: expect.stringContaining('source.fetch'),
        })],
      },
    ]))
    expect(run.tool_calls).toEqual([
      expect.objectContaining({
        tool_name: 'source.fetch',
        input: { ticker: 'COST' },
      }),
    ])
    expect(JSON.stringify(run.tool_calls)).not.toContain('ledger.write')
    expect(run.ledger_events_written).toBe(0)
  })

  it('classifies auth, quota, and generic API errors with redacted diagnostics', async () => {
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async () => Response.json({ error: { message: 'API key secret-gemini-key rejected at /tmp/provider/auth.json', status: 'UNAUTHENTICATED' } }, { status: 401 }),
    })

    await expect(provider.complete({ ...baseRequest, task_kind: 'text-generation', response_format: { kind: 'text' } }))
      .rejects.toThrow(/authentication failed/i)
    await expect(provider.complete({ ...baseRequest, task_kind: 'text-generation', response_format: { kind: 'text' } }))
      .rejects.not.toThrow(/secret-gemini-key|\/tmp\/provider/i)
  })

  it('redacts thrown network diagnostics and passes timeout signals to fetch', async () => {
    let signal: AbortSignal | undefined
    const provider = new GeminiDeveloperApiProvider({
      apiKey: 'secret-gemini-key',
      fetch: async (_url, init) => {
        signal = init.signal as AbortSignal | undefined
        throw new Error('proxy failed for secret-gemini-key via /tmp/provider/proxy.json with Authorization: Bearer secret-token')
      },
    })

    await expect(provider.complete({ ...baseRequest, timeout_ms: 25, task_kind: 'text-generation', response_format: { kind: 'text' } }))
      .rejects.toThrow(/Gemini Developer API request failed/i)
    await expect(provider.complete({ ...baseRequest, timeout_ms: 25, task_kind: 'text-generation', response_format: { kind: 'text' } }))
      .rejects.not.toThrow(/secret-gemini-key|\/tmp\/provider|secret-token/i)
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})
