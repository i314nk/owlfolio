import { afterEach, describe, expect, it } from 'vitest'
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
    // A network error is now TRANSIENT (retried with backoff); inject a no-op sleepImpl to keep the
    // test instant. The fail-closed-after-retries outcome is unchanged.
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: throwing, sleepImpl: async () => {} })
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

describe('fetchAndCaptureSource — User-Agent', () => {
  /** Spy fetchImpl that records the (input, init) of every call and returns the given body/status. */
  function spyFetch(body = 'ok', status = 200): { fetchImpl: typeof fetch; calls: Array<[unknown, RequestInit | undefined]> } {
    const calls: Array<[unknown, RequestInit | undefined]> = []
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      calls.push([input, init])
      return new Response(body, { status })
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  function headerOf(init: RequestInit | undefined, name: string): string | undefined {
    const h = init?.headers as Record<string, string> | undefined
    return h?.[name]
  }

  const SAVED = { ...process.env }
  afterEach(() => {
    process.env = { ...SAVED }
  })

  it('sends a default User-Agent header on the fetch', async () => {
    delete process.env['OWLFOLIO_SOURCE_USER_AGENT']
    delete process.env['OWLFOLIO_SEC_USER_AGENT']
    const { fetchImpl, calls } = spyFetch('body')
    await fetchAndCaptureSource(proposed(), { fetchImpl })
    expect(calls).toHaveLength(1)
    expect(headerOf(calls[0]![1], 'User-Agent')).toBe('Owlfolio research (local)')
    expect(headerOf(calls[0]![1], 'Accept')).toMatch(/text\/html/)
  })

  it('deps.userAgent wins over env over default', async () => {
    process.env['OWLFOLIO_SOURCE_USER_AGENT'] = 'env-source-ua'
    process.env['OWLFOLIO_SEC_USER_AGENT'] = 'env-sec-ua'
    const { fetchImpl, calls } = spyFetch('body')
    await fetchAndCaptureSource(proposed(), { fetchImpl, userAgent: 'explicit-ua' })
    expect(headerOf(calls[0]![1], 'User-Agent')).toBe('explicit-ua')
  })

  it('OWLFOLIO_SOURCE_USER_AGENT wins over OWLFOLIO_SEC_USER_AGENT', async () => {
    process.env['OWLFOLIO_SOURCE_USER_AGENT'] = 'env-source-ua'
    process.env['OWLFOLIO_SEC_USER_AGENT'] = 'env-sec-ua'
    const { fetchImpl, calls } = spyFetch('body')
    await fetchAndCaptureSource(proposed(), { fetchImpl })
    expect(headerOf(calls[0]![1], 'User-Agent')).toBe('env-source-ua')
  })

  it('falls back to OWLFOLIO_SEC_USER_AGENT when OWLFOLIO_SOURCE_USER_AGENT is unset', async () => {
    delete process.env['OWLFOLIO_SOURCE_USER_AGENT']
    process.env['OWLFOLIO_SEC_USER_AGENT'] = 'env-sec-ua'
    const { fetchImpl, calls } = spyFetch('body')
    await fetchAndCaptureSource(proposed(), { fetchImpl })
    expect(headerOf(calls[0]![1], 'User-Agent')).toBe('env-sec-ua')
  })
})

describe('fetchAndCaptureSource — retry/backoff for transient failures', () => {
  it('retries a 429 then succeeds, calling sleepImpl with the backoff schedule', async () => {
    const statuses = [429, 200]
    let i = 0
    const fetchImpl = (async () => {
      const status = statuses[i++] ?? 200
      return status === 200 ? new Response('real body', { status }) : new Response('rate limited', { status })
    }) as unknown as typeof fetch
    const slept: number[] = []
    const sleepImpl = async (ms: number) => { slept.push(ms) }
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl, sleepImpl, retryBaseMs: 250 })
    expect(out.availability).toBe('available')
    expect(out.http_status).toBe(200)
    expect(slept).toEqual([250])
  })

  it('retries a 5xx then succeeds', async () => {
    const statuses = [503, 500, 200]
    let i = 0
    const fetchImpl = (async () => {
      const status = statuses[i++] ?? 200
      return status === 200 ? new Response('real body', { status }) : new Response('err', { status })
    }) as unknown as typeof fetch
    const slept: number[] = []
    const sleepImpl = async (ms: number) => { slept.push(ms) }
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl, sleepImpl, retryBaseMs: 250, maxAttempts: 3 })
    expect(out.availability).toBe('available')
    expect(slept).toEqual([250, 500])
  })

  it('does NOT retry a 404 — fetched exactly once, unavailable with http_status 404', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return new Response('nope', { status: 404 }) }) as unknown as typeof fetch
    const slept: number[] = []
    const sleepImpl = async (ms: number) => { slept.push(ms) }
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl, sleepImpl })
    expect(calls).toBe(1)
    expect(out.availability).toBe('unavailable')
    expect(out.http_status).toBe(404)
    expect(slept).toEqual([])
  })

  it('retries a thrown network error up to maxAttempts then fails closed without throwing', async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const slept: number[] = []
    const sleepImpl = async (ms: number) => { slept.push(ms) }
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl, sleepImpl, maxAttempts: 3, retryBaseMs: 250 })
    expect(calls).toBe(3)
    expect(out.availability).toBe('unavailable')
    expect(slept).toEqual([250, 500])
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
      // no-op sleepImpl: the 500 for 'bad' is now a TRANSIENT status that gets retried, so keep the
      // backoff instant. Assertions (verified_ids/availability) are unchanged by the retry.
      { fetchImpl, concurrency: 2, sleepImpl: async () => {} },
    )
    expect(result.verified_ids).toEqual(['a'])
    expect(result.captured).toHaveLength(2)
    expect(result.captured.find((c) => c.source_id === 'b')?.availability).toBe('unavailable')
  })
})

describe('assertPublicHttpUrl — IPv6 private/mapped forms', () => {
  it('rejects IPv6 loopback ::1', () => {
    expect(() => assertPublicHttpUrl('http://[::1]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv6 ULA fc00::/7 (fc prefix)', () => {
    expect(() => assertPublicHttpUrl('http://[fc00::1]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv6 ULA fc00::/7 (fd prefix)', () => {
    expect(() => assertPublicHttpUrl('http://[fd12:3456::1]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv6 link-local fe80::/10', () => {
    expect(() => assertPublicHttpUrl('http://[fe80::1]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv4-mapped IPv6 ::ffff:127.0.0.1 (loopback)', () => {
    expect(() => assertPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv4-mapped IPv6 ::ffff:169.254.169.254 (link-local metadata)', () => {
    expect(() => assertPublicHttpUrl('http://[::ffff:169.254.169.254]/')).toThrow(/not allowed|private|loopback/i)
  })

  it('rejects IPv4-mapped IPv6 hex form conservatively', () => {
    expect(() => assertPublicHttpUrl('http://[::ffff:7f00:1]/')).toThrow(/not allowed|private|loopback/i)
  })
})

describe('fetchAndCaptureSource — redirect handling', () => {
  it('follows a redirect to a public URL and returns available', async () => {
    let callCount = 0
    const fetchImpl = (async (input: string | URL) => {
      callCount++
      const u = String(input)
      if (u === 'https://www.sec.gov/msft-10k') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' },
        })
      }
      // Second hop: the redirect target
      return new Response('final body content', { status: 200 })
    }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl })
    expect(out.availability).toBe('available')
    expect(out.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(callCount).toBe(2)
  })

  it('does NOT follow a redirect to a private URL (fail-closed)', async () => {
    let privateHostFetched = false
    const fetchImpl = (async (input: string | URL) => {
      const u = String(input)
      if (u.includes('169.254')) {
        // Should never be reached — guard should throw before fetching
        privateHostFetched = true
        return new Response('secret metadata', { status: 200 })
      }
      // First fetch: redirect to private address
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      })
    }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl })
    expect(out.availability).toBe('unavailable')
    expect(privateHostFetched).toBe(false)
  })

  it('returns unavailable when redirects exceed the max limit', async () => {
    let hopCount = 0
    const fetchImpl = (async () => {
      hopCount++
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/redirect' },
      })
    }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed({ url: 'https://example.com/redirect' }), { fetchImpl })
    expect(out.availability).toBe('unavailable')
    // Should stop after MAX_REDIRECTS (3) + 1 initial = 4 fetches total
    expect(hopCount).toBeLessThanOrEqual(4)
  })
})
