import { extractImpermissibleIncomeExcerpts, buildShariahIncomeBlock } from '../shariahReasoningPass'

describe('extractImpermissibleIncomeExcerpts', () => {
  it('captures a window around an income keyword that has a dollar figure', () => {
    const out = extractImpermissibleIncomeExcerpts('...blah... Interest income was $128 million in fiscal 2025, up from ...more...')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/interest income/i)
    expect(out[0]).toMatch(/\$128 million/)
  })
  it('drops keyword mentions with no dollar figure', () => {
    expect(extractImpermissibleIncomeExcerpts('We earn interest income on our cash balances (see note 4).')).toEqual([])
  })
  it('returns [] for irrelevant/empty text and caps the number of windows', () => {
    expect(extractImpermissibleIncomeExcerpts('the quick brown fox')).toEqual([])
    const many = Array.from({ length: 30 }, (_v, i) => `dividend income of $${i} million`).join(' ; ')
    expect(extractImpermissibleIncomeExcerpts(many).length).toBeLessThanOrEqual(8)
  })
})

describe('buildShariahIncomeBlock', () => {
  it('includes XBRL lines when present', () => {
    const b = buildShariahIncomeBlock([{ concept: 'InterestIncomeOther', label: 'interest income (other)', amount_musd: 4337 }], [])
    expect(b).toMatch(/interest income \(other\) 4337/)
  })
  it('includes text excerpts when XBRL is absent', () => {
    const b = buildShariahIncomeBlock(undefined, ['Interest income was $128 million'])
    expect(b).toMatch(/\$128 million/)
    expect(b).toMatch(/IMPERMISSIBLE-INCOME/)
  })
  it('returns undefined when there is neither', () => {
    expect(buildShariahIncomeBlock(undefined, [])).toBeUndefined()
    expect(buildShariahIncomeBlock([], [])).toBeUndefined()
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import type { Provider, ProviderToolExecutor, ProviderToolLoopRequest, ProviderToolLoopResult } from '@owlfolio/providers'

import { ShariahReasoningAgentSchema, buildShariahReasoningPrompt, runShariahReasoningPass } from '../shariahReasoningPass'
import type { CapturedSource } from '../sourceGrounding'
import type { GroundFn } from '../groundedAgent'

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

  it('tells the model about the harness income block (no-tools fallback instruction)', () => {
    const prompt = buildShariahReasoningPrompt({
      research_case_id: 'rc_x', ticker: 'ACME', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    })
    expect(prompt).toMatch(/HARNESS IMPERMISSIBLE-INCOME GROUNDING/)
    expect(prompt).toMatch(/you do NOT need tools/)
  })
})

describe('runShariahReasoningPass (no-tools provider — harness injects income block)', () => {
  const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
  const filingText = 'Annual Report. Interest income was $128 million in fiscal 2025, up from $95 million. Total revenues were $4,500 million.'
  const primaryId = 'sec_edgar_10k_harness_test'
  const fakeSource: CapturedSource = {
    source_id: primaryId,
    title: 'Test 10-K',
    url: 'https://www.sec.gov/Archives/edgar/data/99/test.htm',
    excerpt: 'Annual Report.',
    availability: 'available',
    fetched_at: '2025-01-01T00:00:00.000Z',
    content: filingText,
    content_hash: sha(filingText),
    source_category: 'filing',
  }

  // No-tools provider: multi-step-tool-loop is unsupported so runValidatedAgent falls back to
  // provider.structured, which lets the test capture the full prompt the harness assembled.
  // We verify the harness injection path (prompt capture) rather than the end-to-end status,
  // because: the loop provider test already covers end-to-end status; the no-tools path is
  // specifically about prompt augmentation that happens BEFORE structured() is called.
  let capturedPrompt = ''
  function makeNoToolsProvider(): Provider {
    capturedPrompt = ''
    return {
      provider_id: 'fake-no-tools',
      capabilities: {
        'text-generation': 'adapter',
        'structured-output': 'adapter',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'unsupported',
        'multi-step-tool-loop': 'unsupported',
        'source-grounding': 'unsupported',
        'citation-metadata': 'unsupported',
        'url-context': 'unsupported',
        'file-context': 'unsupported',
        'source-bundle-production': 'unsupported',
        'code-execution': 'unsupported',
        'computer-use': 'unsupported',
        'browser-use': 'unsupported',
      },
      async complete() { throw new Error('not used') },
      async runWithTools() { throw new Error('not used') },
      async structured<T>(request: { prompt: string }, _schema: unknown): Promise<T> {
        capturedPrompt = request.prompt
        const output = {
          shariah_judgment: { sector_status: 'compliant', impermissible_income: 128, sector_citation: primaryId },
          proposed_sources: [{ source_id: primaryId, title: 'Test 10-K', url: 'https://www.sec.gov/Archives/edgar/data/99/test.htm', excerpt: 'Interest income was $128 million' }],
        }
        return output as T
      },
    } as unknown as Provider
  }

  it('injects HARNESS IMPERMISSIBLE-INCOME GROUNDING block and the $128M figure into the prompt (no-tools path)', async () => {
    const provider = makeNoToolsProvider()
    const readCorpus = new Map([[primaryId, fakeSource]])
    // Fake ground: returns the source as verified so the structured path's cite-check passes.
    const fakeGround: GroundFn = async (sources) => ({
      captured: sources.map((s) => ({ ...fakeSource, source_id: s.source_id })),
      verified_ids: sources.map((s) => s.source_id),
    })

    await runShariahReasoningPass(
      provider,
      {
        research_case_id: 'rc_no_tools',
        ticker: 'ACME',
        model_id: 'm',
        laneDigest: [],
        corpusSourceIds: [primaryId],
        preVerifiedSourceIds: [primaryId],
      },
      { ground: fakeGround, readCorpus },
    )

    // The harness should have read the filing (offset paging — unparseable as 10-K Items), extracted the
    // interest-income window, built the block, and appended it to the prompt BEFORE calling structured.
    expect(capturedPrompt).toContain('HARNESS IMPERMISSIBLE-INCOME GROUNDING')
    expect(capturedPrompt).toContain('$128 million')
  })

  it('does NOT inject income block when there is no readCorpus and no impermissibleIncomeLines (fail-closed)', async () => {
    // Regression guard: when neither a read corpus nor XBRL lines are available, the harness must
    // not fabricate or inject anything — the prompt must arrive at the model unaugmented (fail-closed).
    // NOTE: the base prompt itself refers to "HARNESS IMPERMISSIBLE-INCOME GROUNDING" in a conditional
    // ("if a block appears below..."), so we check for the block's actual header which is only present
    // when the harness injects content: 'HARNESS IMPERMISSIBLE-INCOME GROUNDING (quantify'.
    const provider = makeNoToolsProvider()
    const fakeGround: GroundFn = async (sources) => ({
      captured: sources.map((s) => ({ ...fakeSource, source_id: s.source_id })),
      verified_ids: sources.map((s) => s.source_id),
    })

    await runShariahReasoningPass(
      provider,
      {
        research_case_id: 'rc_fail_closed',
        ticker: 'ACME',
        model_id: 'm',
        laneDigest: [],
        corpusSourceIds: [primaryId],
        preVerifiedSourceIds: [primaryId],
        // no impermissibleIncomeLines
      },
      { ground: fakeGround }, // no readCorpus
    )

    // The injected block starts with 'HARNESS IMPERMISSIBLE-INCOME GROUNDING (quantify'; the base
    // prompt only has a quoted reference. Nothing injected → that prefix must be absent.
    expect(capturedPrompt).not.toContain('HARNESS IMPERMISSIBLE-INCOME GROUNDING (quantify')
  })

  it('injects HARNESS IMPERMISSIBLE-INCOME GROUNDING block from XBRL lines even with no readCorpus (XBRL-present path)', async () => {
    // Regression guard: when XBRL-tagged lines are supplied (impermissibleIncomeLines), the harness
    // must inject the grounding block from those lines alone — no filing read required.
    const provider = makeNoToolsProvider()
    const fakeGround: GroundFn = async (sources) => ({
      captured: sources.map((s) => ({ ...fakeSource, source_id: s.source_id })),
      verified_ids: sources.map((s) => s.source_id),
    })

    await runShariahReasoningPass(
      provider,
      {
        research_case_id: 'rc_xbrl_present',
        ticker: 'ACME',
        model_id: 'm',
        laneDigest: [],
        corpusSourceIds: [primaryId],
        preVerifiedSourceIds: [primaryId],
        impermissibleIncomeLines: [{ concept: 'InterestIncomeOther', label: 'interest income (other)', amount_musd: 4337 }],
      },
      { ground: fakeGround }, // no readCorpus
    )

    // The injected block's header (distinguishes actual injection from the base-prompt reference).
    expect(capturedPrompt).toContain('HARNESS IMPERMISSIBLE-INCOME GROUNDING (quantify')
    expect(capturedPrompt).toContain('interest income (other) 4337')
  })
})
