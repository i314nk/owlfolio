import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { Provider } from '@owlfolio/providers'
import { afterEach, describe, expect, it } from 'vitest'

import { runClaudeBuffettMungerResearch } from '../claudeResearchWorkflow'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('runClaudeBuffettMungerResearch', () => {
  it('creates a case, writes a source bundle, drafts analysis, and drafts a decision', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-claude-workflow-'))
    dirs.push(projectDir)

    const store = new InMemoryEventStore()
    const provider: Provider = {
      provider_id: 'claude',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'native',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      async complete() {
        throw new Error('not used in this test')
      },
      structured: async <T>(
        _request: import('@owlfolio/providers').ProviderRunRequest,
        schema: import('zod').ZodType<T>,
      ) => schema.parse({
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        shariah_status: 'COMPLIANT',
        valuation_status: 'FAIR',
        next_required_action: 'Refresh valuation after the next filing.',
        decision_reason: 'High quality business, but wait for a wider margin of safety.',
        source_records: [
          {
            source_id: 'src_msft_10k_2025',
            title: 'Microsoft 10-K FY2025',
            url: 'https://example.test/msft-10k',
            excerpt: 'Azure growth remained durable.',
          },
        ],
      }) as T,
      async runWithTools() {
        throw new Error('not used in this test')
      },
    }

    const result = await runClaudeBuffettMungerResearch(store, provider, {
      research_case_id: 'rc_msft_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
      model_id: 'claude-sonnet-4-6',
      source_ledger_path: join(projectDir, 'data', 'source-ledger'),
      analysis_idempotency_key: 'analysis:rc_msft_001:claude:v1',
      decision_id: 'decision_msft_watch_001',
      decision_idempotency_key: 'decision:rc_msft_001:v1',
    })

    expect(result.analysis.investment_verdict).toBe('WATCH')
    expect(result.decision.decision).toBe('WATCH')
    expect(result.source_bundle.records).toHaveLength(1)

    const bundleText = await readFile(result.source_bundle.bundle_path, 'utf8')
    expect(bundleText).toContain('src_msft_10k_2025')

    const events = await store.list()
    expect(events.map((event) => event.event_type)).toEqual([
      'research_case_created',
      'buffett_munger_analysis_drafted',
      'decision_drafted',
    ])
    expect(events[1]).toMatchObject({
      actor_type: 'provider',
      actor_id: 'claude',
      source_ids: ['src_msft_10k_2025'],
    })
    expect(events[2]).toMatchObject({
      actor_type: 'system',
      source_ids: ['src_msft_10k_2025'],
    })
  })
})
