import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { OpenAICodexCliProvider } from '../openaiCodexCliProvider'
import { resolveProvider } from '../providerFactory'
import type { ProviderRunRequest } from '../providerContract'

const request: ProviderRunRequest = {
  run_id: 'run_msft_openai_001',
  provider_id: 'openai',
  model_id: 'codex-mini-latest',
  task_kind: 'structured-output',
  prompt: 'Analyze Microsoft as a Buffett-Munger candidate.',
  timeout_ms: 30_000,
  budget: {
    max_tool_calls: 0,
    max_tokens: 4_000,
  },
  tool_allowlist: [],
  response_format: {
    kind: 'json-schema',
    schema_name: 'buffett_munger_research',
  },
}

const OpenAIResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT']),
  valuation_status: z.string(),
  next_required_action: z.string(),
  decision_reason: z.string(),
  source_records: z.array(
    z.object({
      source_id: z.string(),
      title: z.string(),
      url: z.string().url(),
      excerpt: z.string(),
    }),
  ),
})

describe('OpenAICodexCliProvider', () => {
  it('runs a structured request through the Codex CLI transport', async () => {
    const provider = new OpenAICodexCliProvider({
      env: { CODEX_ACCESS_TOKEN: 'test-access-token' },
      runCommand: async (command: string, args: string[], env: NodeJS.ProcessEnv, _timeoutMs: number, stdin?: string) => {
        expect(command).toBe('codex')
        expect(args).toContain('exec')
        expect(args).toContain('--output-schema')
        expect(args).toContain('--json')
        expect(args).toContain('-')
        expect(args).not.toContain(request.prompt)
        expect(stdin).toBe(request.prompt)
        expect(env.CODEX_ACCESS_TOKEN).toBe('test-access-token')

        const outputIndex = args.indexOf('-o')
        const schemaIndex = args.indexOf('--output-schema')
        expect(outputIndex).toBeGreaterThanOrEqual(0)
        expect(schemaIndex).toBeGreaterThanOrEqual(0)

        const outputPath = args[outputIndex + 1]
        const schemaPath = args[schemaIndex + 1]
        expect(outputPath).toBeDefined()
        expect(schemaPath).toBeDefined()

        const schemaJson = JSON.parse(await readFile(schemaPath!, 'utf8')) as {
          type?: string
          properties?: {
            source_records?: {
              items?: {
                properties?: {
                  url?: {
                    type?: string
                    format?: string
                  }
                  citation_locator?: unknown
                  content_hash?: unknown
                }
                required?: string[]
              }
            }
          }
        }
        expect(schemaJson.type).toBe('object')
        expect(schemaJson.properties?.source_records?.items?.properties?.url?.type).toBe('string')
        expect(schemaJson.properties?.source_records?.items?.properties?.url?.format).toBeUndefined()
        expect(schemaJson.properties?.source_records?.items?.properties?.citation_locator).toBeUndefined()
        expect(schemaJson.properties?.source_records?.items?.properties?.content_hash).toBeUndefined()
        expect(schemaJson.properties?.source_records?.items?.required).toEqual(['source_id', 'title', 'url', 'excerpt'])

        await writeFile(outputPath!, JSON.stringify({
          investment_verdict: 'WATCH',
          strategy_compliance: 'CONDITIONAL',
          shariah_status: 'COMPLIANT',
          valuation_status: 'FAIR',
          next_required_action: 'Refresh valuation after the next filing.',
          decision_reason: 'High quality business, but wait for a better margin of safety.',
          source_records: [
            {
              source_id: 'src_msft_10k_2025',
              title: 'Microsoft 10-K FY2025',
              url: 'https://example.test/msft-10k',
              excerpt: 'Azure growth remained durable.',
            },
          ],
        }), 'utf8')

        return {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: 'thread.started', thread_id: 'thread_001' }),
            JSON.stringify({ type: 'turn.started' }),
            JSON.stringify({ type: 'turn.completed' }),
          ].join('\n'),
          stderr: '',
        }
      },
    })

    const result = await provider.structured(request, OpenAIResearchSchema)

    expect(result.investment_verdict).toBe('WATCH')
    expect(result.source_records).toHaveLength(1)
  })

  const validOutput = JSON.stringify({
    investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT',
    valuation_status: 'FAIR', next_required_action: 'x', decision_reason: 'y', source_records: [],
  })

  it('passes OWLFOLIO_CODEX_REASONING_EFFORT as a -c model_reasoning_effort override', async () => {
    let captured: string[] = []
    const provider = new OpenAICodexCliProvider({
      env: { CODEX_ACCESS_TOKEN: 'test-access-token', OWLFOLIO_CODEX_REASONING_EFFORT: 'xhigh' },
      runCommand: async (_command, args) => {
        captured = args
        await writeFile(args[args.indexOf('-o') + 1]!, validOutput, 'utf8')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    await provider.structured(request, OpenAIResearchSchema)
    expect(captured).toContain('-c')
    expect(captured).toContain('model_reasoning_effort=xhigh')
  })

  it('omits the reasoning override when OWLFOLIO_CODEX_REASONING_EFFORT is unset', async () => {
    let captured: string[] = []
    const provider = new OpenAICodexCliProvider({
      env: { CODEX_ACCESS_TOKEN: 'test-access-token' },
      runCommand: async (_command, args) => {
        captured = args
        await writeFile(args[args.indexOf('-o') + 1]!, validOutput, 'utf8')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    await provider.structured(request, OpenAIResearchSchema)
    expect(captured.some((a) => a.startsWith('model_reasoning_effort='))).toBe(false)
  })

  it('ignores an invalid reasoning effort value (falls back to the Codex default)', async () => {
    let captured: string[] = []
    const provider = new OpenAICodexCliProvider({
      env: { CODEX_ACCESS_TOKEN: 'test-access-token', OWLFOLIO_CODEX_REASONING_EFFORT: 'banana' },
      runCommand: async (_command, args) => {
        captured = args
        await writeFile(args[args.indexOf('-o') + 1]!, validOutput, 'utf8')
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    await provider.structured(request, OpenAIResearchSchema)
    expect(captured.some((a) => a.startsWith('model_reasoning_effort='))).toBe(false)
  })

  it('raises a helpful error when the Codex CLI fails', async () => {
    const provider = new OpenAICodexCliProvider({
      env: {},
      runCommand: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({
          type: 'turn.failed',
          error: {
            message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
          },
        }),
        stderr: '',
      }),
    })

    await expect(provider.structured(request, OpenAIResearchSchema)).rejects.toThrow(
      'Codex CLI failed with exit code 1: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
    )
  })

  it('resolves OpenAI through the provider factory', () => {
    const provider = resolveProvider({
      provider_id: 'openai',
      env: { CODEX_ACCESS_TOKEN: 'test-access-token' },
      runCommand: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
      }),
    })

    expect(provider).toBeInstanceOf(OpenAICodexCliProvider)
  })
})
