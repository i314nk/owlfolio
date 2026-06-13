import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  Provider,
  ProviderToolExecutor,
  ProviderToolLoopRequest,
  ProviderToolLoopResult,
} from '@owlfolio/providers'
import {
  buildGroundedToolExecutor,
  runGroundedAgentWithTools,
  GROUNDED_TOOL_NAMES,
} from '../groundedAgent'
import type { CapturedSource, GroundingResult } from '../sourceGrounding'
import type { GroundFn } from '../groundedAgent'
import type { Fundamentals } from '../secEdgar'

// A stub grounding fn: returns "available" for sec.gov urls, "unavailable" otherwise (SSRF/dead).
const stubGround: GroundFn = async (sources): Promise<GroundingResult> => {
  const captured: CapturedSource[] = sources.map((s) => {
    const available = s.url.includes('sec.gov')
    return {
      source_id: s.source_id,
      title: s.title,
      url: s.url,
      excerpt: available ? 'REAL FETCHED BYTES from the filing' : s.excerpt,
      availability: available ? ('available' as const) : ('unavailable' as const),
      fetched_at: '2026-06-09T00:00:00.000Z',
      ...(available ? { content_hash: 'sha256:abc' } : {}),
    }
  })
  return { captured, verified_ids: captured.filter((c) => c.availability === 'available').map((c) => c.source_id) }
}

const fundamentals: Fundamentals = {
  cik: '0000789019',
  entity_name: 'MICROSOFT CORP',
  currency: 'USD',
  latest_annual: { fiscal_year: 2024, currency: 'USD' },
  annual_series: [{ fiscal_year: 2024, currency: 'USD' }],
  filings: [
    { form: '10-K', filed: '2024-07-30', url: 'https://www.sec.gov/Archives/edgar/data/789019/msft-10k.htm' },
    { form: '10-K', filed: '2023-07-27', url: 'https://www.sec.gov/Archives/edgar/data/789019/msft-10k-2023.htm' },
  ],
}

describe('buildGroundedToolExecutor', () => {
  it('fetch_source routes through grounding and returns the verified source_id + excerpt', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'moat', ground: stubGround })
    const out = await tool.executor('fetch_source', { url: 'https://www.sec.gov/Archives/edgar/data/789019/x.htm' })

    expect(out).toMatch(/source_id=/)
    expect(out).toMatch(/available/i)
    expect(out).toContain('REAL FETCHED BYTES')
    expect(tool.captured).toHaveLength(1)
    expect(tool.verified_ids).toHaveLength(1)
    // The returned source_id is exactly the one accumulated (the only thing Phase 2 may cite).
    expect(out).toContain(tool.verified_ids[0]!)
  })

  it('fetch_source returns UNAVAILABLE (not a crash) for an SSRF-blocked / dead url and does not verify it', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'moat', ground: stubGround })
    const out = await tool.executor('fetch_source', { url: 'https://random-blog.example.com/post' })
    // moat lane policy rejects non-primary categories OR grounding marks it unavailable — either way not verified.
    expect(out).toMatch(/unavailable|rejected|not allowed|excluded/i)
    expect(tool.verified_ids).toHaveLength(0)
  })

  it('fetch_source rejects a per-lane-policy-excluded category as an ADDITIONAL gate', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'moat', ground: stubGround })
    // A media/sell-side category is excluded for the moat (classification) lane BEFORE fetching.
    const out = await tool.executor('fetch_source', { url: 'https://www.bloomberg.com/news/articles/x' })
    expect(out).toMatch(/excluded|rejected|policy/i)
    expect(tool.captured).toHaveLength(0)
    expect(tool.verified_ids).toHaveLength(0)
    expect(tool.policy_rejections.length).toBeGreaterThan(0)
  })

  it('fetch_source handles a missing/invalid url argument gracefully', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'moat', ground: stubGround })
    const out = await tool.executor('fetch_source', {})
    expect(out).toMatch(/error|missing|invalid|url/i)
    expect(tool.verified_ids).toHaveLength(0)
  })

  it('search_filings returns candidate filing urls (discovery only — not citable)', async () => {
    const fetchFundamentals = vi.fn(async () => fundamentals)
    const tool = buildGroundedToolExecutor({ lane: 'financial_quality', ground: stubGround, fetchFundamentals })
    const out = await tool.executor('search_filings', { ticker: 'MSFT' })

    expect(fetchFundamentals).toHaveBeenCalledWith('MSFT')
    expect(out).toContain('msft-10k.htm')
    expect(out).toMatch(/10-K/)
    // Discovery does NOT verify anything — only fetch_source can.
    expect(tool.verified_ids).toHaveLength(0)
  })

  it('search_filings degrades gracefully when EDGAR returns nothing', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'financial_quality', ground: stubGround, fetchFundamentals: async () => undefined })
    const out = await tool.executor('search_filings', { ticker: 'NOPE' })
    expect(out).toMatch(/no filings|not found|none/i)
  })
})

// ---- A fake loop-capable provider that drives a scripted Phase-1 / Phase-2 sequence. ----
function fakeLoopProvider(opts: {
  capability?: 'native' | 'adapter' | 'unsupported'
  script: (executor: ProviderToolExecutor) => Promise<{ analysis: unknown; sawTool: boolean; rounds: number }>
}): Provider {
  const capability = opts.capability ?? 'adapter'
  return {
    provider_id: 'fake-loop',
    capabilities: {
      'text-generation': 'adapter',
      'structured-output': 'adapter',
      'tool-function-calling': 'adapter',
      'streaming-observability': 'unsupported',
      'multi-step-tool-loop': capability,
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
    async structured() { throw new Error('fallback structured() should not be called when loop is supported') },
    async runWithTools() { throw new Error('not used') },
    async runToolLoop<T>(request: ProviderToolLoopRequest, schema: z.ZodType<T>, executor: ProviderToolExecutor): Promise<ProviderToolLoopResult<T>> {
      const scripted = await opts.script(executor)
      return {
        analysis: schema.parse(scripted.analysis),
        rounds: [],
        metadata: {
          provider_id: 'fake-loop',
          run_id: request.run_id,
          model_id: request.model_id,
          timeout_ms: request.timeout_ms,
          tool_allowlist: [...request.tool_allowlist],
          task_kind: request.task_kind,
          response_format: request.response_format,
        },
        observations: [],
        degraded_no_tools: !scripted.sawTool,
      }
    },
  }
}

const LaneSchema = z.object({
  finding_summary: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string()),
  source_ids: z.array(z.string()),
  proposed_sources: z.array(
    z.object({ source_id: z.string(), title: z.string(), url: z.string().url(), excerpt: z.string() }),
  ),
})

describe('runGroundedAgentWithTools (loop selection + grounding invariant)', () => {
  const baseRequest = {
    run_id: 'run_loop_1',
    model_id: 'deepseek/deepseek-r1',
    prompt: 'Analyze MSFT moat.',
    timeout_ms: 30_000,
    schema_name: 'LaneFinding',
  }

  it('uses the loop path and emits a finding citing a verified source_id', async () => {
    const provider = fakeLoopProvider({
      script: async (executor) => {
        const res = await executor('fetch_source', { url: 'https://www.sec.gov/Archives/edgar/data/789019/x.htm' })
        const id = /source_id=(\S+)/.exec(res)![1]!
        return {
          sawTool: true,
          rounds: 1,
          analysis: {
            finding_summary: 'MSFT has a wide moat.',
            confidence: 'high',
            caveats: [],
            source_ids: [id],
            proposed_sources: [{ source_id: id, title: 't', url: 'https://www.sec.gov/Archives/edgar/data/789019/x.htm', excerpt: 'e' }],
          },
        }
      },
    })
    const result = await runGroundedAgentWithTools(provider, baseRequest, LaneSchema, { ground: stubGround }, { lane: 'moat' })
    expect(result.verified_ids.length).toBeGreaterThan(0)
    expect(result.analysis.source_ids[0]).toBe(result.verified_ids[0])
    expect(result.degraded_no_tools).toBe(false)
  })

  it('keeps the fail-closed invariant: a finding citing a NON-fetched id is not in verified_ids', async () => {
    const provider = fakeLoopProvider({
      script: async (executor) => {
        await executor('fetch_source', { url: 'https://www.sec.gov/Archives/edgar/data/789019/x.htm' })
        return {
          sawTool: true,
          rounds: 1,
          analysis: {
            finding_summary: 'fabricated',
            confidence: 'low',
            caveats: [],
            source_ids: ['totally_made_up_id'],
            proposed_sources: [{ source_id: 'totally_made_up_id', title: 't', url: 'https://www.sec.gov/x', excerpt: 'e' }],
          },
        }
      },
    })
    const result = await runGroundedAgentWithTools(provider, baseRequest, LaneSchema, { ground: stubGround }, { lane: 'moat' })
    // The harness only ever verifies what it fetched; the fabricated id is NOT verified.
    expect(result.verified_ids).not.toContain('totally_made_up_id')
  })

  it('falls back to the structured propose-then-verify path when the provider does NOT support the loop', async () => {
    const structured = vi.fn(async () => ({
      finding_summary: 'fallback',
      confidence: 'medium' as const,
      caveats: [],
      source_ids: ['msft_10k'],
      proposed_sources: [{ source_id: 'msft_10k', title: 't', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    }))
    const provider: Provider = {
      provider_id: 'no-loop',
      capabilities: {
        'text-generation': 'adapter', 'structured-output': 'adapter', 'tool-function-calling': 'unsupported',
        'streaming-observability': 'unsupported', 'multi-step-tool-loop': 'unsupported', 'source-grounding': 'unsupported',
        'citation-metadata': 'unsupported', 'url-context': 'unsupported', 'file-context': 'unsupported',
        'source-bundle-production': 'unsupported', 'code-execution': 'unsupported', 'computer-use': 'unsupported', 'browser-use': 'unsupported',
      },
      async complete() { throw new Error('nu') },
      structured: structured as unknown as Provider['structured'],
      async runWithTools() { throw new Error('nu') },
    }
    const result = await runGroundedAgentWithTools(provider, baseRequest, LaneSchema, { ground: stubGround }, { lane: 'moat' })
    expect(structured).toHaveBeenCalledOnce()
    expect(result.analysis.finding_summary).toBe('fallback')
    expect(result.verified_ids).toContain('msft_10k')
  })

  it('exposes the grounded tool names for the provider tool_allowlist', () => {
    expect(GROUNDED_TOOL_NAMES).toContain('fetch_source')
    expect(GROUNDED_TOOL_NAMES).toContain('search_filings')
  })
})
