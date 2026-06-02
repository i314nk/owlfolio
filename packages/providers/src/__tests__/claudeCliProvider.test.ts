import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { ProviderRunRequest } from '../providerContract'
import { resolveProvider } from '../providerFactory'
import { ClaudeCliProvider } from '../claudeCliProvider'

const request: ProviderRunRequest = {
  run_id: 'run_msft_001',
  provider_id: 'claude',
  model_id: 'claude-sonnet-4-6',
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

const ClaudeResearchSchema = z.object({
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

describe('ClaudeCliProvider', () => {
  it('runs a structured request through the Claude CLI transport', async () => {
    const provider = new ClaudeCliProvider({
      env: { ANTHROPIC_API_KEY: 'test-key' },
      runCommand: async (command, args, env) => {
        expect(command).toBe('claude')
        expect(args).toContain('--print')
        expect(args).toContain('--output-format')
        expect(args).toContain('json')
        expect(args).toContain('--json-schema')
        expect(args).toContain(request.prompt)
        expect(env.ANTHROPIC_API_KEY).toBe('test-key')

        return {
          exitCode: 0,
          stdout: JSON.stringify({
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
          }),
          stderr: '',
        }
      },
    })

    const result = await provider.structured(request, ClaudeResearchSchema)

    expect(result.investment_verdict).toBe('WATCH')
    expect(result.source_records).toHaveLength(1)
  })

  it('raises a helpful error when the Claude CLI fails', async () => {
    const provider = new ClaudeCliProvider({
      env: {},
      runCommand: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'authentication required',
      }),
    })

    await expect(provider.structured(request, ClaudeResearchSchema)).rejects.toThrow(
      'Claude CLI failed with exit code 1: authentication required',
    )
  })

  it('uses stdout as the failure message when Claude CLI reports account errors there', async () => {
    const provider = new ClaudeCliProvider({
      env: {},
      runCommand: async () => ({
        exitCode: 1,
        stdout: 'Your organization has disabled Claude subscription access for Claude Code',
        stderr: '',
      }),
    })

    await expect(provider.complete({
      ...request,
      response_format: { kind: 'text' },
    })).rejects.toThrow('disabled Claude subscription access')
  })

  it('resolves Claude through the provider factory', () => {
    const provider = resolveProvider({
      provider_id: 'claude',
      env: { ANTHROPIC_API_KEY: 'test-key' },
      runCommand: async () => ({
        exitCode: 0,
        stdout: '{}',
        stderr: '',
      }),
    })

    expect(provider).toBeInstanceOf(ClaudeCliProvider)
  })
})
