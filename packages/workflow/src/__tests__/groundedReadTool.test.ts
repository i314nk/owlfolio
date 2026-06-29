import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildGroundedToolExecutor, GROUNDED_TOOL_NAMES, GROUNDED_TOOL_PARAMETERS } from '../groundedAgent.js'
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
const corpus = (...c: CapturedSource[]) => new Map(c.map((x) => [x.source_id, x]))

describe('read_source grounded tool registration', () => {
  it('is registered as a grounded tool name + parameter schema', () => {
    expect(GROUNDED_TOOL_NAMES).toContain('read_source')
    expect(GROUNDED_TOOL_PARAMETERS['read_source']).toBeDefined()
  })
})

describe('read_source executor handler', () => {
  it('reads a 10-K Item from a verified, in-lane source and marks it citable', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'risks', readCorpus: corpus(cap({})) })
    const out = await tool.executor('read_source', { source_id: 'sec_10k', section: '1A' })
    expect(out).toContain('status=available')
    expect(out).toContain('loss of a major customer')
    expect(tool.verified_ids).toContain('sec_10k')
  })

  it('INVARIANT 1: a content_hash mismatch is uncitable and NEVER added to verified_ids', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'risks', readCorpus: corpus(cap({ content: 'TAMPERED' })) })
    const out = await tool.executor('read_source', { source_id: 'sec_10k', section: '1A' })
    expect(out).toContain('status=uncitable')
    expect(out).toContain('content_hash_mismatch')
    expect(tool.verified_ids).not.toContain('sec_10k')
  })

  it('INVARIANT 2: lane tag preserved — an out-of-lane read fails closed and is not verified', async () => {
    const { source_category: _omit, ...media } = cap({
      source_id: 'm1', url: 'https://www.bloomberg.com/news/x', content: 'body text', content_hash: sha('body text'),
    })
    void _omit
    const tool = buildGroundedToolExecutor({ lane: 'moat', readCorpus: corpus(media) })
    const out = await tool.executor('read_source', { source_id: 'm1', section: '1A' })
    expect(out).toContain('status=uncitable')
    expect(out).toMatch(/financial_media|policy/)
    expect(tool.verified_ids).not.toContain('m1')
  })

  it('an unknown source_id is uncitable and not verified', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'risks', readCorpus: corpus(cap({})) })
    const out = await tool.executor('read_source', { source_id: 'nope' })
    expect(out).toContain('status=uncitable')
    expect(out).toContain('unknown_source_id')
    expect(tool.verified_ids).not.toContain('nope')
  })

  it('reports available sections when a requested Item is absent', async () => {
    const tool = buildGroundedToolExecutor({ lane: 'risks', readCorpus: corpus(cap({})) })
    const out = await tool.executor('read_source', { source_id: 'sec_10k', section: '5' })
    expect(out).toContain('status=uncitable')
    expect(out).toContain('section_not_found')
    expect(out).toContain('1A')
    expect(tool.verified_ids).not.toContain('sec_10k')
  })
})
