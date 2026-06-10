import { describe, expect, it } from 'vitest'
import { groundProposedSourcesForLane } from '../sourceGrounding'
import type { ProposedSource } from '../sourceGrounding'

// A grounding impl stub that "verifies" every source it is handed (so we isolate the policy gate from
// the network fetch — the policy must reject sources BEFORE they reach the fetcher).
const verifyAll = async (sources: ProposedSource[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id,
    title: s.title,
    url: s.url,
    excerpt: s.excerpt,
    availability: 'available' as const,
    fetched_at: '2026-06-09T00:00:00.000Z',
    content_hash: `sha256:${s.source_id}`,
  })),
  verified_ids: sources.map((s) => s.source_id),
})

const filing: ProposedSource = {
  source_id: 's_filing',
  title: '10-K',
  url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm',
  excerpt: 'filing',
}
const media: ProposedSource = {
  source_id: 's_media',
  title: 'Bloomberg piece',
  url: 'https://www.bloomberg.com/news/articles/x',
  excerpt: 'media',
}
const proxy: ProposedSource = {
  source_id: 's_proxy',
  title: 'DEF 14A',
  url: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
  excerpt: 'proxy',
}
const unknownSrc: ProposedSource = {
  source_id: 's_unknown',
  title: 'mystery',
  url: 'https://random-unknown-xyz.example/page',
  excerpt: 'unknown',
}

describe('groundProposedSourcesForLane — per-lane source whitelist (Mechanism 6)', () => {
  it('MOAT rejects a financial_media source and records the reason', async () => {
    const result = await groundProposedSourcesForLane('moat', [filing, media], { ground: verifyAll })
    expect(result.verified_ids).toEqual(['s_filing'])
    expect(result.verified_ids).not.toContain('s_media')
    const rejected = result.policy_rejections.find((r) => r.source_id === 's_media')
    expect(rejected?.reason).toBe('excluded_by_lane_policy:financial_media')
  })

  it('RISKS admits the same financial_media source (consensus IS the job)', async () => {
    const result = await groundProposedSourcesForLane('risks', [filing, media], { ground: verifyAll })
    expect(result.verified_ids).toEqual(expect.arrayContaining(['s_filing', 's_media']))
    expect(result.policy_rejections.length).toBe(0)
  })

  it('MANAGEMENT admits a proxy and rejects a media profile', async () => {
    const result = await groundProposedSourcesForLane('management', [proxy, media], { ground: verifyAll })
    expect(result.verified_ids).toContain('s_proxy')
    expect(result.verified_ids).not.toContain('s_media')
    expect(result.policy_rejections.some((r) => r.source_id === 's_media')).toBe(true)
  })

  it('classification lanes conservatively exclude an unknown-category source and record excluded_unknown_source', async () => {
    const result = await groundProposedSourcesForLane('moat', [filing, unknownSrc], { ground: verifyAll })
    expect(result.verified_ids).toEqual(['s_filing'])
    const rejected = result.policy_rejections.find((r) => r.source_id === 's_unknown')
    expect(rejected?.reason).toBe('excluded_unknown_source')
  })

  it('RISKS admits an unknown-category source', async () => {
    const result = await groundProposedSourcesForLane('risks', [unknownSrc], { ground: verifyAll })
    expect(result.verified_ids).toContain('s_unknown')
  })

  it('keeps grounding guarantees: only the admitted sources are passed to the fetcher (sha256/SSRF intact downstream)', async () => {
    const seen: string[] = []
    const spyGround = async (sources: ProposedSource[]) => {
      sources.forEach((s) => seen.push(s.source_id))
      return verifyAll(sources)
    }
    await groundProposedSourcesForLane('moat', [filing, media, unknownSrc], { ground: spyGround })
    expect(seen).toEqual(['s_filing'])
  })

  it('records categories on captured sources for visibility', async () => {
    const result = await groundProposedSourcesForLane('moat', [filing, media], { ground: verifyAll })
    const filingCap = result.captured.find((c) => c.source_id === 's_filing')
    expect(filingCap?.source_category).toBe('filing')
  })
})
