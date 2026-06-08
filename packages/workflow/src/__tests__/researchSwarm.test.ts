import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runGroundedAgent, ProposedSourcesSchema } from '../researchSwarm'
import type { CapturedSource } from '../sourceGrounding'

function fakeProvider(payload: unknown) {
  return {
    provider_id: 'fake',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => payload),
  }
}

describe('runGroundedAgent', () => {
  it('returns analysis plus only verified source ids', async () => {
    const schema = z.object({ summary: z.string(), proposed_sources: ProposedSourcesSchema })
    const provider = fakeProvider({
      summary: 'hi',
      proposed_sources: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e' },
      ],
    })
    const ground = vi.fn(async () => ({
      captured: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e', availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e', availability: 'unavailable' as const, fetched_at: 'x' },
      ] as CapturedSource[],
      verified_ids: ['ok'],
    }))
    const out = await runGroundedAgent(provider as never, {
      run_id: 'r1', model_id: 'm', prompt: 'p', timeout_ms: 1000,
    }, schema, { ground })
    expect(out.analysis.summary).toBe('hi')
    expect(out.verified_ids).toEqual(['ok'])
    expect(out.captured).toHaveLength(2)
  })
})
