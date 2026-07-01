import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readGroundedSource } from '../sourceRead.js'
import type { CapturedSource } from '../sourceGrounding.js'

const here = dirname(fileURLToPath(import.meta.url))
const sample10k = readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'sample-10k.html'), 'utf8')
const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`

function cap(over: Partial<CapturedSource>): CapturedSource {
  return {
    source_id: 'sec_10k', title: '10-K', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm',
    excerpt: 'e', availability: 'available', fetched_at: 'x',
    content: sample10k, content_hash: sha(sample10k), source_category: 'filing', ...over,
  }
}
const corpusOf = (...c: CapturedSource[]) => new Map(c.map((x) => [x.source_id, x]))

describe('readGroundedSource', () => {
  it('reads a 10-K Item (1A) from a verified, in-lane source', async () => {
    const res = await readGroundedSource('sec_10k', corpusOf(cap({})), { section: '1A', lane: 'moat' })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.text).toContain('loss of a major customer')
    expect(res.available_items).toEqual(['1', '1A', '2', '7', '8'])
  })

  it('with no section, returns the readable-section index', async () => {
    const res = await readGroundedSource('sec_10k', corpusOf(cap({})), { lane: 'moat' })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.text).toContain('1A')
    expect(res.available_items).toContain('7')
  })

  it('fails closed for an unknown source_id', async () => {
    const res = await readGroundedSource('nope', corpusOf(cap({})), {})
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected fail')
    expect(res.reason).toMatch(/not found/i)
  })

  it('enforces the lane whitelist (moat rejects financial_media)', async () => {
    const { source_category: _omit, ...media } = cap({ source_id: 'm1', url: 'https://www.bloomberg.com/news/x', content: 'x', content_hash: sha('x') })
    void _omit
    const res = await readGroundedSource('m1', corpusOf(media), { lane: 'moat', section: '1A' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected fail')
    expect(res.reason).toMatch(/financial_media|policy/i)
  })

  it('fails closed when content cannot be hash-verified', async () => {
    const tampered = cap({ content: 'TAMPERED' }) // content_hash still = sha(sample10k)
    const res = await readGroundedSource('sec_10k', corpusOf(tampered), { section: '1A' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected fail')
    expect(res.reason).toMatch(/verif|hash|read/i)
  })

  it('reports available items when a requested section is absent', async () => {
    const res = await readGroundedSource('sec_10k', corpusOf(cap({})), { section: '5' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected fail')
    expect(res.available_items).toContain('1A')
  })

  it('offset-pages an unparseable document (fallback)', async () => {
    const prose = 'X'.repeat(50)
    const doc = cap({ source_id: 'p1', content: prose, content_hash: sha(prose) })
    const res = await readGroundedSource('p1', corpusOf(doc), { offset: 0, limit: 20 })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.text.length).toBe(20)
    expect(res.next_offset).toBe(20)
  })
})
