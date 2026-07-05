import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ingestManualSourceBundle } from '../sourceLedger'
import { bundleToReadCorpus, loadPersistedReadCorpus, readSourceLedgerBundle, selectFilingsNotInCorpus } from '../sourceLedgerRead'
import { readGroundedSource } from '../sourceRead.js'
import type { GroundingDeps } from '../sourceGrounding.js'
import type { FilingRef } from '../secEdgar.js'

const here = dirname(fileURLToPath(import.meta.url))
const sample10k = readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'sample-10k.html'), 'utf8')
const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
type FetchImpl = NonNullable<GroundingDeps['fetchImpl']>
const fetchReturning = (body: string): FetchImpl =>
  vi.fn(async () => new Response(body, { status: 200 })) as unknown as FetchImpl

const dirs: string[] = []
async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

const PROXY_URL = 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000200/cost-20251204.htm'

async function ingestProxyBundle(projectDir: string) {
  return await ingestManualSourceBundle({
    source_ledger_path: join(projectDir, 'source-ledger'),
    research_case_id: 'rc_roundtrip',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    ingested_by_actor_type: 'system',
    ingested_by_actor_id: 'research_workflow',
    sources: [{
      source_id: 'sec_edgar_def14a_0000909832_2025-12-04',
      kind: 'url',
      url: PROXY_URL,
      excerpt: 'Definitive annual proxy statement.',
      content_hash: sha(sample10k),
      availability: 'available',
      source_category: 'proxy',
      filing_form: 'DEF 14A',
      filed: '2025-12-04',
      fetched_at: '2026-07-04T00:00:00.000Z',
    }],
  })
}

describe('cross-run round trip: write → read → resolve → A1 re-fetch + hash-verify', () => {
  it('a persisted source is readable in a NEW run via re-fetch of the immutable URL, and the persisted lane category still gates', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-roundtrip-')
    await ingestProxyBundle(projectDir)

    const corpus = await loadPersistedReadCorpus({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_roundtrip',
    })
    const entry = corpus.get('sec_edgar_def14a_0000909832_2025-12-04')
    expect(entry).toBeDefined()
    expect(entry!.content).toBeUndefined() // pointers + hashes only — content is never persisted
    expect(entry!.source_category).toBe('proxy')
    expect(entry!.filed).toBe('2025-12-04')
    expect(entry!.form).toBe('DEF 14A')

    // A1 verification path: the read re-fetches the immutable URL and hash-verifies.
    const fetchImpl = fetchReturning(sample10k)
    const ok = await readGroundedSource('sec_edgar_def14a_0000909832_2025-12-04', corpus, { section: '1A', lane: 'management' }, { fetchImpl })
    expect(ok.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()

    // The persisted category survives the round trip and still gates reads (financial_quality rejects proxy).
    const refused = await readGroundedSource('sec_edgar_def14a_0000909832_2025-12-04', corpus, { section: '1A', lane: 'financial_quality' }, { fetchImpl: fetchReturning(sample10k) })
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('expected refusal')
    expect(refused.reason).toBe('excluded_by_lane_policy:proxy')
  })

  it('TAMPER (fetch side): a mutated live body fails closed to uncitable', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-tamper-fetch-')
    await ingestProxyBundle(projectDir)
    const corpus = await loadPersistedReadCorpus({ source_ledger_path: join(projectDir, 'source-ledger'), research_case_id: 'rc_roundtrip' })

    const res = await readGroundedSource('sec_edgar_def14a_0000909832_2025-12-04', corpus, { section: '1A', lane: 'management' }, { fetchImpl: fetchReturning('MUTATED BODY') })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.reason).toMatch(/content-verified/)
  })

  it('TAMPER (disk side): a flipped content_hash in the bundle JSON fails closed on read', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-tamper-disk-')
    const bundle = await ingestProxyBundle(projectDir)

    // Flip the persisted hash on disk, then resolve + read.
    const raw = JSON.parse(await readFile(bundle.bundle_path, 'utf8')) as { records: { content_hash?: string }[] }
    raw.records[0]!.content_hash = sha('SOMETHING ELSE')
    await writeFile(bundle.bundle_path, JSON.stringify(raw), 'utf8')

    const corpus = await loadPersistedReadCorpus({ source_ledger_path: join(projectDir, 'source-ledger'), research_case_id: 'rc_roundtrip' })
    const res = await readGroundedSource('sec_edgar_def14a_0000909832_2025-12-04', corpus, { section: '1A', lane: 'management' }, { fetchImpl: fetchReturning(sample10k) })
    expect(res.ok).toBe(false)
  })
})

describe('readSourceLedgerBundle', () => {
  it('fail-closed undefined: missing bundle, invalid JSON, wrong shape, unsafe case id', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-read-failclosed-')
    const ledgerDir = join(projectDir, 'source-ledger')

    expect(await readSourceLedgerBundle({ source_ledger_path: ledgerDir, research_case_id: 'rc_missing' })).toBeUndefined()

    await ingestProxyBundle(projectDir)
    await writeFile(join(ledgerDir, 'research-source-bundle-rc_garbage.json'), 'not json', 'utf8')
    expect(await readSourceLedgerBundle({ source_ledger_path: ledgerDir, research_case_id: 'rc_garbage' })).toBeUndefined()

    await writeFile(join(ledgerDir, 'research-source-bundle-rc_shape.json'), JSON.stringify({ nope: true }), 'utf8')
    expect(await readSourceLedgerBundle({ source_ledger_path: ledgerDir, research_case_id: 'rc_shape' })).toBeUndefined()

    await expect(readSourceLedgerBundle({ source_ledger_path: ledgerDir, research_case_id: '../escape' })).rejects.toThrow(/safe source-ledger slug/)
  })

  it('reads back the bundle written by ingestManualSourceBundle', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-read-ok-')
    await ingestProxyBundle(projectDir)
    const bundle = await readSourceLedgerBundle({ source_ledger_path: join(projectDir, 'source-ledger'), research_case_id: 'rc_roundtrip' })
    expect(bundle).toBeDefined()
    expect(bundle!.research_case_id).toBe('rc_roundtrip')
    expect(bundle!.records).toHaveLength(1)
  })
})

describe('bundleToReadCorpus skip rules (fail-closed, never throw)', () => {
  it('skips url-less / unavailable / hash-less / non-sha256 / SSRF-unsafe records; keeps only honestly-readable ones', () => {
    const base = { research_case_id: 'rc', provider_id: 'p', captured_at: '2026-07-04T00:00:00.000Z', metadata: {} }
    const corpus = bundleToReadCorpus({
      bundle_path: '/x', research_case_id: 'rc', provider_id: 'p', captured_at: '2026-07-04T00:00:00.000Z',
      records: [
        { ...base, source_record_id: 'r1', source_id: 'ok', source_type: 'url', url: PROXY_URL, content_hash: sha('x'), availability: 'available', source_category: 'proxy' },
        { ...base, source_record_id: 'r2', source_id: 'no_url', source_type: 'url', content_hash: sha('x'), availability: 'available' },
        { ...base, source_record_id: 'r3', source_id: 'local', source_type: 'local-file', content_hash: sha('x'), availability: 'available' },
        { ...base, source_record_id: 'r4', source_id: 'unavailable', source_type: 'url', url: PROXY_URL, content_hash: sha('x'), availability: 'unavailable' },
        { ...base, source_record_id: 'r5', source_id: 'no_hash', source_type: 'url', url: PROXY_URL, availability: 'available' },
        { ...base, source_record_id: 'r6', source_id: 'bad_hash', source_type: 'url', url: PROXY_URL, content_hash: 'md5:nope', availability: 'available' },
        { ...base, source_record_id: 'r7', source_id: 'ssrf', source_type: 'url', url: 'http://127.0.0.1/secret', content_hash: sha('x'), availability: 'available' },
        { ...base, source_record_id: 'r8', source_id: 'no_availability', source_type: 'url', url: PROXY_URL, content_hash: sha('x') },
      ],
    })
    expect([...corpus.keys()]).toEqual(['ok'])
    // Junk category values are not laundered into the type.
    const junk = bundleToReadCorpus({
      bundle_path: '/x', research_case_id: 'rc', provider_id: 'p', captured_at: 'z',
      records: [{ ...base, source_record_id: 'r9', source_id: 'junkcat', source_type: 'url', url: PROXY_URL, content_hash: sha('x'), availability: 'available', source_category: 'not_a_category' }],
    })
    expect(junk.get('junkcat')!.source_category).toBeUndefined()
  })
})

describe('selectFilingsNotInCorpus (the re-review delta primitive)', () => {
  const ref = (url: string): FilingRef => ({ form: '8-K', filed: '2026-07-01', url })

  it('excludes filings whose (normalized) URL is already in the corpus; empty corpus returns all', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-delta-')
    await ingestProxyBundle(projectDir)
    const corpus = await loadPersistedReadCorpus({ source_ledger_path: join(projectDir, 'source-ledger'), research_case_id: 'rc_roundtrip' })

    const known = ref(PROXY_URL)
    const fresh = ref('https://www.sec.gov/Archives/edgar/data/909832/000090983226000300/cost-8k.htm')
    expect(selectFilingsNotInCorpus([known, fresh], corpus)).toEqual([fresh])
    expect(selectFilingsNotInCorpus([known, fresh], new Map())).toEqual([known, fresh])
  })

  it('normalizes both sides (query/hash/trailing noise never defeats the match)', () => {
    const corpus = bundleToReadCorpus({
      bundle_path: '/x', research_case_id: 'rc', provider_id: 'p', captured_at: 'z',
      records: [{ source_record_id: 'r1', research_case_id: 'rc', provider_id: 'p', captured_at: 'z', metadata: {}, source_id: 'k', source_type: 'url', url: PROXY_URL, content_hash: sha('x'), availability: 'available' }],
    })
    expect(selectFilingsNotInCorpus([ref(`${PROXY_URL}?utm=x#frag`)], corpus)).toEqual([])
  })
})

describe('overwrite contract (documented, not fixed here)', () => {
  it('a later ingest for the same case OVERWRITES the bundle — the read returns the latest write only', async () => {
    const projectDir = await makeTempDir('owlfolio-ledger-overwrite-')
    const common = {
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_overwrite',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system' as const,
      ingested_by_actor_id: 'research_workflow',
    }
    const src = (id: string) => ({ source_id: id, kind: 'url' as const, url: `https://example.test/${id}`, content_hash: sha(id), availability: 'available' as const })

    await ingestManualSourceBundle({ ...common, sources: [src('a'), src('b')] })
    await ingestManualSourceBundle({ ...common, sources: [src('a'), src('b'), src('c')] })

    const bundle = await readSourceLedgerBundle({ source_ledger_path: common.source_ledger_path, research_case_id: 'rc_overwrite' })
    expect(bundle!.records.map((r) => r.source_id)).toEqual(['a', 'b', 'c'])
  })
})
