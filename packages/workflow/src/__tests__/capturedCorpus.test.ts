import { describe, expect, it } from 'vitest'

import { mergeCapturedIntoCorpus, type CapturedSource } from '../sourceGrounding.js'

function cap(over: Partial<CapturedSource> & { source_id: string }): CapturedSource {
  return {
    title: 't', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', excerpt: 'e',
    availability: 'available', fetched_at: '2026-07-04T12:48:00.000Z', content_hash: 'sha256:aaa',
    ...over,
  }
}

describe('mergeCapturedIntoCorpus — the write-side same-id guard (twin of mergeReadCorpus)', () => {
  it('adds a new id', () => {
    const corpus = new Map<string, CapturedSource>()
    mergeCapturedIntoCorpus(corpus, [cap({ source_id: 'a' })])
    expect(corpus.get('a')).toBeDefined()
  })

  it('LIVE-BUG REPRO: a same-id re-capture with a DIFFERENT hash never replaces the existing capture', () => {
    // The COST dogfood run: the harness grounded the real 10-K; the synthesis model re-proposed the
    // same id with url=cgi-bin/browse-edgar (the SEARCH page); last-write-wins clobbered the capture.
    const corpus = new Map<string, CapturedSource>()
    const harness = cap({
      source_id: 'sec_edgar_10k_0000909832_fy2025',
      url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm',
      content_hash: 'sha256:real10k', filed: '2025-10-08', form: '10-K',
    })
    const imposter = cap({
      source_id: 'sec_edgar_10k_0000909832_fy2025',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar',
      content_hash: 'sha256:searchpage', fetched_at: '2026-07-04T12:55:26.000Z',
    })
    mergeCapturedIntoCorpus(corpus, [harness])
    mergeCapturedIntoCorpus(corpus, [imposter])

    const kept = corpus.get('sec_edgar_10k_0000909832_fy2025')!
    expect(kept.url).toBe(harness.url)
    expect(kept.content_hash).toBe('sha256:real10k')
    expect(kept.filed).toBe('2025-10-08')
    expect(kept.form).toBe('10-K')
  })

  it('a same-id re-capture with the SAME hash merges: provenance preserved, gaps (content) filled', () => {
    const corpus = new Map<string, CapturedSource>()
    const stamped = cap({ source_id: 'x', content_hash: 'sha256:same', source_category: 'proxy', filed: '2025-12-04', form: 'DEF 14A' })
    const recapture = cap({ source_id: 'x', content_hash: 'sha256:same', content: 'THE BODY', title: 'model title' })
    mergeCapturedIntoCorpus(corpus, [stamped])
    mergeCapturedIntoCorpus(corpus, [recapture])

    const merged = corpus.get('x')!
    expect(merged.source_category).toBe('proxy') // provenance preserved
    expect(merged.filed).toBe('2025-12-04')
    expect(merged.form).toBe('DEF 14A')
    expect(merged.title).toBe('t') // existing wins on conflicts
    expect(merged.content).toBe('THE BODY') // gap filled from the re-capture
  })

  it('an UNVERIFIED existing capture is upgraded by a verified re-capture of the same id', () => {
    const corpus = new Map<string, CapturedSource>()
    const failed = { ...cap({ source_id: 'y' }), availability: 'unavailable' as const }
    delete (failed as { content_hash?: string }).content_hash
    const verified = cap({ source_id: 'y', content_hash: 'sha256:good' })
    mergeCapturedIntoCorpus(corpus, [failed])
    mergeCapturedIntoCorpus(corpus, [verified])
    expect(corpus.get('y')!.content_hash).toBe('sha256:good')
    expect(corpus.get('y')!.availability).toBe('available')
  })

  it('a hash-less re-capture never downgrades a verified existing capture', () => {
    const corpus = new Map<string, CapturedSource>()
    const verified = cap({ source_id: 'z', content_hash: 'sha256:good' })
    const failed = { ...cap({ source_id: 'z' }), availability: 'unavailable' as const }
    delete (failed as { content_hash?: string }).content_hash
    mergeCapturedIntoCorpus(corpus, [verified])
    mergeCapturedIntoCorpus(corpus, [failed])
    expect(corpus.get('z')!.content_hash).toBe('sha256:good')
    expect(corpus.get('z')!.availability).toBe('available')
  })
})
