import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import type { Provider, ProviderToolExecutor, ProviderToolLoopRequest, ProviderToolLoopResult } from '@owlfolio/providers'

import { ShariahReasoningAgentSchema, buildShariahReasoningPrompt, runShariahReasoningPass } from '../shariahReasoningPass'
import type { CapturedSource } from '../sourceGrounding'

describe('ShariahReasoningAgentSchema', () => {
  it('parses a grounded overlay (sector_status + impermissible_income + citation + proposed_sources)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: 128, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
  it('accepts impermissible_income null (undetermined — never guessed 0)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: null, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('runShariahReasoningPass (grounded tool loop — the SPGI-class quantification slice)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const sample10k = readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'sample-10k.html'), 'utf8')
  const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
  const tenK: CapturedSource = {
    source_id: 'sec_edgar_10k_x', title: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm',
    excerpt: 'e', availability: 'available', fetched_at: 'x',
    content: sample10k, content_hash: sha(sample10k), source_category: 'filing',
  }

  function loopProvider(script: (executor: ProviderToolExecutor) => Promise<unknown>): Provider {
    return {
      provider_id: 'fake-loop',
      capabilities: {
        'text-generation': 'adapter', 'structured-output': 'adapter', 'tool-function-calling': 'adapter',
        'streaming-observability': 'unsupported', 'multi-step-tool-loop': 'adapter',
        'source-grounding': 'unsupported', 'citation-metadata': 'unsupported', 'url-context': 'unsupported',
        'file-context': 'unsupported', 'source-bundle-production': 'unsupported', 'code-execution': 'unsupported',
        'computer-use': 'unsupported', 'browser-use': 'unsupported',
      },
      async complete() { throw new Error('not used') },
      async structured() { throw new Error('the pass must use the TOOL LOOP when the provider supports it') },
      async runWithTools() { throw new Error('not used') },
      async runToolLoop<T>(request: ProviderToolLoopRequest, schema: z.ZodType<T>, executor: ProviderToolExecutor): Promise<ProviderToolLoopResult<T>> {
        const analysis = await script(executor)
        return {
          analysis: schema.parse(analysis),
          rounds: [],
          metadata: {
            provider_id: 'fake-loop', run_id: request.run_id, model_id: request.model_id,
            timeout_ms: request.timeout_ms, tool_allowlist: [...request.tool_allowlist],
            task_kind: request.task_kind, response_format: request.response_format,
          },
          observations: [],
          degraded_no_tools: false,
        }
      },
    } as unknown as Provider
  }

  it('reads the pre-verified filing via read_source and quantifies impermissible income from what it read', async () => {
    // The SPGI gap: neither the lane digest nor XBRL carries an interest-income figure — the number
    // lives only in the filing's notes. The pass now runs the grounded tool loop, so it can READ the
    // harness-verified 10-K by Item and quantify from the text (cite-checked like every grounded read).
    let readResult = ''
    const provider = loopProvider(async (executor) => {
      readResult = await executor('read_source', { source_id: 'sec_edgar_10k_x', section: '1A' })
      return {
        shariah_judgment: { sector_status: 'compliant', impermissible_income: 128, sector_citation: 'sec_edgar_10k_x' },
        proposed_sources: [{ source_id: 'sec_edgar_10k_x', title: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', excerpt: 'e' }],
      }
    })
    const outcome = await runShariahReasoningPass(provider, {
      research_case_id: 'rc_loop', ticker: 'SPGI', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    }, { readCorpus: new Map([[tenK.source_id, tenK]]) })
    // The executor really served hash-verified filing text to the model.
    expect(readResult).toContain('status=available')
    expect(readResult).toContain('loss of a major customer')
    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.shariah_judgment.impermissible_income).toBe(128)
      // The read made the filing citable in this loop.
      expect(outcome.verified_ids).toContain('sec_edgar_10k_x')
    }
  })
})

describe('buildShariahReasoningPrompt', () => {
  it('instructs the overlay + that the harness owns the AAOIFI ratios (model supplies grounded inputs only)', () => {
    const prompt = buildShariahReasoningPrompt({
      research_case_id: 'rc_x', ticker: 'MSFT', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    })
    expect(prompt).toMatch(/sector_status/)
    expect(prompt).toMatch(/impermissible_income/)
    expect(prompt).toMatch(/do NOT.*(ratio|purification)/i)
    expect(prompt).toMatch(/null/i)
  })

  it('tells the model it can READ the filing (read_source) to locate and quantify the interest-income line', () => {
    const prompt = buildShariahReasoningPrompt({
      research_case_id: 'rc_x', ticker: 'SPGI', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    })
    expect(prompt).toMatch(/read_source/)
    expect(prompt).toMatch(/interest income|investment income/i)
  })
})
