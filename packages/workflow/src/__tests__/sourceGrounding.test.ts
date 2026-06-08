import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl, fetchAndCaptureSource, groundProposedSources, type ProposedSource } from '../sourceGrounding'

describe('assertPublicHttpUrl', () => {
  it('accepts public https urls', () => {
    expect(assertPublicHttpUrl('https://www.sec.gov/cgi-bin/browse-edgar').hostname).toBe('www.sec.gov')
  })

  it('rejects non-http protocols', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/protocol/i)
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow(/protocol/i)
  })

  it('rejects localhost, loopback, link-local and private ranges', () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(/not allowed|private|loopback/i)
    }
  })
})

const proposed = (over: Partial<ProposedSource> = {}): ProposedSource => ({
  source_id: 'msft_10k', title: 'MSFT 10-K', url: 'https://www.sec.gov/msft-10k',
  excerpt: 'claimed excerpt', ...over,
})

function fakeFetch(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch
}

describe('fetchAndCaptureSource', () => {
  it('marks available with a sha256 hash when fetch succeeds', async () => {
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: fakeFetch('annual report body text') })
    expect(out.availability).toBe('available')
    expect(out.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.http_status).toBe(200)
  })

  it('marks unavailable (no hash) on non-2xx', async () => {
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: fakeFetch('not found', 404) })
    expect(out.availability).toBe('unavailable')
    expect(out.content_hash).toBeUndefined()
  })

  it('marks unavailable on network error instead of throwing', async () => {
    const throwing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: throwing })
    expect(out.availability).toBe('unavailable')
  })

  it('marks unavailable for a disallowed (private) url without fetching', async () => {
    let called = false
    const spy = (async () => { called = true; return new Response('x') }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed({ url: 'http://169.254.169.254/' }), { fetchImpl: spy })
    expect(out.availability).toBe('unavailable')
    expect(called).toBe(false)
  })
})

describe('groundProposedSources', () => {
  it('returns verified ids only for fetched sources and captures all attempts', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const u = String(input)
      return u.includes('good') ? new Response('real body') : new Response('x', { status: 500 })
    }) as unknown as typeof fetch
    const result = await groundProposedSources(
      [
        proposed({ source_id: 'a', url: 'https://example.com/good' }),
        proposed({ source_id: 'b', url: 'https://example.com/bad' }),
      ],
      { fetchImpl, concurrency: 2 },
    )
    expect(result.verified_ids).toEqual(['a'])
    expect(result.captured).toHaveLength(2)
    expect(result.captured.find((c) => c.source_id === 'b')?.availability).toBe('unavailable')
  })
})
