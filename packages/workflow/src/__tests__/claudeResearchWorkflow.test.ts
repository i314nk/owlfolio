import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { Provider } from '@owlfolio/providers'
import { afterEach, describe, expect, it } from 'vitest'

import { runClaudeBuffettMungerResearch } from '../claudeResearchWorkflow'

const dirs: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getPayloadString(payload: unknown, key: string): string | undefined {
  return isRecord(payload) && typeof payload[key] === 'string' ? payload[key] : undefined
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('runClaudeBuffettMungerResearch', () => {
  it('creates a case, writes a source bundle, drafts analysis, and drafts a decision', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-claude-workflow-'))
    dirs.push(projectDir)

    const store = new InMemoryEventStore()
    let capturedRequest: import('@owlfolio/providers').ProviderRunRequest | undefined
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
        request: import('@owlfolio/providers').ProviderRunRequest,
        schema: import('zod').ZodType<T>,
      ) => {
        capturedRequest = request
        return schema.parse({
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
        quick_screen: {
          summary: 'Single-agent quality screen recommends deep dive; valuation is not the quick-screen gate.',
          business_quality: 'Quality screen: sticky enterprise software demand and resilient cash generation.',
          moat: 'Moat screen: switching costs, ecosystem breadth, and developer lock-in need deep-dive validation.',
          management_capital_allocation: 'Capital allocation screen: verify buyback discipline and AI capex returns.',
          financial_quality: 'Financial quality screen: high margins and free-cash-flow conversion clear the first pass.',
          shariah_data_availability: 'Shariah/data screen: source records exist, ratio refresh still required.',
          red_flags: ['Valuation may be demanding but is deferred to deep dive', 'Shariah ratio evidence needs refresh'],
          confidence: 'medium',
          caveats: ['Single-agent screen only'],
          deep_dive_recommendation: 'deep_dive_candidate',
        },
        owner_earnings_valuation: {
          summary: 'Owner-earnings valuation points to a watchlist posture until price offers a margin of safety.',
          normalized_owner_earnings: '$85B normalized owner earnings',
          assumptions: ['5% ten-year growth', '10% discount rate', '25x terminal owner-earnings multiple'],
          fair_value_range: '$360–$420/share',
          buy_price_range: '$260–$300/share',
          margin_of_safety: '25%–35%',
          sources: ['src_msft_10k_2025'],
          confidence: 'medium',
          caveats: ['AI capex normalization is the key swing factor'],
        },
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
      }) as T
      },
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

    expect(capturedRequest?.prompt).toContain('Quick Screen is a single-agent business-quality gate only')
    expect(capturedRequest?.prompt).toContain('Do not reject or pass primarily on valuation')
    expect(capturedRequest?.prompt).toContain('owner-earnings buy-price')
    expect(capturedRequest?.prompt).toContain('business quality, moat, management/capital allocation, financial quality, red flags, Shariah/data availability')

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
        summary: 'Single-agent quality screen recommends deep dive; valuation is not the quick-screen gate.',
        business_quality: 'Quality screen: sticky enterprise software demand and resilient cash generation.',
        moat: 'Moat screen: switching costs, ecosystem breadth, and developer lock-in need deep-dive validation.',
        management_capital_allocation: 'Capital allocation screen: verify buyback discipline and AI capex returns.',
        financial_quality: 'Financial quality screen: high margins and free-cash-flow conversion clear the first pass.',
        shariah_status: 'COMPLIANT',
        red_flags: ['Valuation may be demanding but is deferred to deep dive', 'Shariah ratio evidence needs refresh'],
        caveats: ['Single-agent screen only'],
      }),
    })
    const specialistLanes = events
      .filter((event) => event.event_type === 'specialist_finding_recorded')
      .map((event) => getPayloadString(event.payload, 'specialist_lane'))
    expect(specialistLanes).toEqual([
      'business_quality',
      'moat',
      'management',
      'financial_quality',
      'shariah',
      'risks',
      'valuation',
    ])
    const valuationFinding = events.find(
      (event) => event.event_type === 'specialist_finding_recorded'
        && getPayloadString(event.payload, 'specialist_lane') === 'valuation',
    )
    expect(valuationFinding).toMatchObject({
      actor_type: 'provider',
      actor_id: 'claude',
      payload: expect.objectContaining({
        finding_summary: 'Owner-earnings valuation points to a watchlist posture until price offers a margin of safety.',
        owner_earnings_valuation: expect.objectContaining({
          normalized_owner_earnings: '$85B normalized owner earnings',
          fair_value_range: '$360–$420/share',
          buy_price_range: '$260–$300/share',
          margin_of_safety: '25%–35%',
          sources: ['src_msft_10k_2025'],
          confidence: 'medium',
          caveats: ['AI capex normalization is the key swing factor'],
        }),
      }),
    })
    const deepDiveCompletedEvent = events[12]
    if (deepDiveCompletedEvent === undefined) {
      throw new Error('expected deep_dive_completed event at index 12')
    }
    expect(events[12]).toMatchObject({
      event_type: 'deep_dive_completed',
      actor_type: 'system',
      source_ids: ['src_msft_10k_2025'],
    })
    expect(events[13]).toMatchObject({
      actor_type: 'provider',
      actor_id: 'claude',
      source_ids: ['src_msft_10k_2025'],
    })
    expect(events[14]).toMatchObject({
      actor_type: 'system',
      source_ids: ['src_msft_10k_2025'],
      causation_id: deepDiveCompletedEvent.event_id,
    })
  })
})
