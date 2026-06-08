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
        'source-grounding': 'adapter',
        'citation-metadata': 'adapter',
        'url-context': 'unsupported',
        'file-context': 'adapter',
        'source-bundle-production': 'adapter',
        'code-execution': 'unsupported',
        'computer-use': 'unsupported',
        'browser-use': 'unsupported',
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
        thesis_summary: 'Microsoft is a durable compounder but currently belongs on watchlist, not buy list.',
        evidence_summary: 'Source records point to resilient cloud growth and strong cash generation.',
        valuation_rationale: 'Market price appears fair to expensive versus required margin of safety.',
        shariah_rationale: 'No prohibited-business evidence was identified in the cited source set.',
        risks: ['Valuation compression', 'Cloud growth deceleration'],
        open_questions: ['Refresh valuation after the next filing'],
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
    expect(result.analysis.thesis_summary).toBe('Microsoft is a durable compounder but currently belongs on watchlist, not buy list.')
    expect(result.analysis.valuation_rationale).toBe('Market price appears fair to expensive versus required margin of safety.')
    expect(result.analysis.risks).toEqual(['Valuation compression', 'Cloud growth deceleration'])
    expect(result.decision.decision).toBe('WATCH')
    expect(result.decision.thesis_summary).toBe('Microsoft is a durable compounder but currently belongs on watchlist, not buy list.')
    expect(result.source_bundle.records).toHaveLength(1)
    expect(result.source_bundle.records[0]).toMatchObject({
      source_id: 'src_msft_10k_2025',
      source_type: 'url',
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: 'claude',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      metadata: {
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
      },
    })

    const bundleText = await readFile(result.source_bundle.bundle_path, 'utf8')
    expect(bundleText).toContain('src_msft_10k_2025')

    const events = await store.list()
    expect(events.map((event) => event.event_type)).toEqual([
      'research_case_created',
      'quick_screen_drafted',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
      'deep_dive_completed',
      'buffett_munger_analysis_drafted',
      'decision_drafted',
    ])
    expect(events[1]).toMatchObject({
      actor_type: 'provider',
      actor_id: 'claude',
      source_ids: ['src_msft_10k_2025'],
      payload: expect.objectContaining({
        screening_result: 'deep_dive_candidate',
        summary: 'Microsoft is a durable compounder but currently belongs on watchlist, not buy list.',
      }),
    })
    expect(events[4]).toMatchObject({
      event_type: 'specialist_finding_recorded',
      actor_type: 'provider',
      actor_id: 'claude',
      payload: expect.objectContaining({ specialist_lane: 'moat' }),
    })
    const deepDiveCompletedEvent = events[11]
    if (deepDiveCompletedEvent === undefined) {
      throw new Error('expected deep_dive_completed event at index 11')
    }
    expect(events[11]).toMatchObject({
      event_type: 'deep_dive_completed',
      actor_type: 'system',
      source_ids: ['src_msft_10k_2025'],
    })
    expect(events[12]).toMatchObject({
      actor_type: 'provider',
      actor_id: 'claude',
      source_ids: ['src_msft_10k_2025'],
    })
    expect(events[13]).toMatchObject({
      actor_type: 'system',
      source_ids: ['src_msft_10k_2025'],
      causation_id: deepDiveCompletedEvent.event_id,
    })
  })
})
