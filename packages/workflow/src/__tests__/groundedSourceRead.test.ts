import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  fetchAndCaptureSource,
  readGroundedSourceContent,
  type CapturedSource,
  type GroundingDeps,
  type ProposedSource,
} from '../sourceGrounding.js'

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
type FetchImpl = NonNullable<GroundingDeps['fetchImpl']>

function okFetch(body: string): FetchImpl {
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as FetchImpl
}
function throwFetch(): FetchImpl {
  return vi.fn(async (): Promise<Response> => { throw new Error('no network') }) as unknown as FetchImpl
}

const BODY = '<html><body><h3>Item 1A. Risk Factors</h3><p>A major customer loss would hurt.</p></body></html>'
const SRC: ProposedSource = {
  source_id: 's1', title: 't',
  url: 'https://www.sec.gov/Archives/edgar/data/1/000/x.htm', excerpt: 'e',
}

describe('fetchAndCaptureSource retains full content (A2)', () => {
  it('keeps the RAW body on CapturedSource.content, hashed identically to content_hash', async () => {
    const cap = await fetchAndCaptureSource(SRC, { fetchImpl: okFetch(BODY) })
    expect(cap.availability).toBe('available')
    expect(cap.content).toBe(BODY)
    expect(cap.content_hash).toBe(sha(BODY))
  })
})

describe('readGroundedSourceContent', () => {
  const captured = (over: Partial<CapturedSource>): CapturedSource => ({
    source_id: 's1', title: 't', url: SRC.url, excerpt: 'e',
    availability: 'available', fetched_at: 'x', content_hash: sha(BODY), ...over,
  })

  it('A2 fast path: returns retained content with NO fetch', async () => {
    const fetchImpl = throwFetch()
    const out = await readGroundedSourceContent(captured({ content: BODY }), { fetchImpl })
    expect(out).toBe(BODY)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('A1 verification path: re-fetches the immutable URL and verifies the hash matches', async () => {
    const fetchImpl = okFetch(BODY)
    const out = await readGroundedSourceContent(captured({}), { fetchImpl })
    expect(out).toBe(BODY)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('FAILS CLOSED (undefined) when a re-fetch hash MISMATCHES — never laundered', async () => {
    const out = await readGroundedSourceContent(captured({}), { fetchImpl: okFetch('DIFFERENT BODY') })
    expect(out).toBeUndefined()
  })

  it('FAILS CLOSED when retained A2 content does not match its hash (anti-laundering)', async () => {
    // never trust the in-memory copy over the hash
    const out = await readGroundedSourceContent(captured({ content: 'TAMPERED' }), { fetchImpl: throwFetch() })
    expect(out).toBeUndefined()
  })

  it('FAILS CLOSED when there is no content_hash to verify against', async () => {
    const { content_hash: _omit, ...noHash } = captured({ content: BODY })
    void _omit
    const out = await readGroundedSourceContent(noHash, {})
    expect(out).toBeUndefined()
  })

  it('FAILS CLOSED on a re-fetch network error', async () => {
    const out = await readGroundedSourceContent(captured({}), { fetchImpl: throwFetch() })
    expect(out).toBeUndefined()
  })
})
