import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkForNewFilings, filingFormWeight, type CheckForNewFilingsDeps } from '../reReviewTrigger.js'
import { ingestManualSourceBundle } from '../sourceLedger'
import type { Fundamentals } from '../secEdgar.js'

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

const KNOWN_10Q_URL = 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000120/cost-10q.htm'

function fundamentalsWith(over: Partial<Fundamentals>): Fundamentals {
  return {
    cik: '0000909832',
    entity_name: 'COSTCO',
    currency: 'USD',
    latest_annual: { fiscal_year: 2025, currency: 'USD' },
    annual_series: [],
    filings: [{ form: '10-K', filed: '2025-10-08', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-10k.htm' }],
    ...over,
  } as Fundamentals
}

async function seedBundle(projectDir: string, urls: string[]) {
  await ingestManualSourceBundle({
    source_ledger_path: join(projectDir, 'source-ledger'),
    research_case_id: 'rc_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    ingested_by_actor_type: 'system',
    ingested_by_actor_id: 'research_workflow',
    sources: urls.map((url, i) => ({
      source_id: `src_${i}`,
      kind: 'url' as const,
      url,
      content_hash: 'sha256:abc',
      availability: 'available' as const,
    })),
  })
}

function deps(fundamentals: Fundamentals | undefined): CheckForNewFilingsDeps {
  return { fetchFundamentals: vi.fn(async () => fundamentals), now: () => '2026-07-05T00:00:00.000Z' }
}

describe('filingFormWeight', () => {
  it('maps interim/event forms to weights and everything else to undefined', () => {
    expect(filingFormWeight('8-K')).toBe('strong')
    expect(filingFormWeight('8-K/A')).toBe('strong')
    expect(filingFormWeight('6-K')).toBe('strong')
    expect(filingFormWeight('6-K/A')).toBe('strong')
    expect(filingFormWeight('10-Q')).toBe('medium')
    expect(filingFormWeight('10-Q/A')).toBe('medium')
    expect(filingFormWeight('DEF 14A')).toBe('weak')
    expect(filingFormWeight('10-K')).toBeUndefined()
    expect(filingFormWeight('SC 13G')).toBeUndefined()
    expect(filingFormWeight('')).toBeUndefined()
  })
})

describe('checkForNewFilings', () => {
  const input = (projectDir: string) => ({
    ticker: 'COST',
    research_case_id: 'rc_cost',
    source_ledger_path: join(projectDir, 'source-ledger'),
  })

  it('returns only filings NOT in the persisted corpus, weighted and ordered strong→medium→weak, newest-first within weight', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-trigger-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])

    const f = fundamentalsWith({
      recent_filings: [
        { form: '10-Q', filed: '2026-06-03', url: KNOWN_10Q_URL }, // already in corpus
        { form: '10-Q', filed: '2026-03-11', url: 'https://www.sec.gov/x/q2.htm' },
        { form: '8-K', filed: '2026-05-28', url: 'https://www.sec.gov/x/8k-old.htm' },
        { form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/x/8k-new.htm' },
      ],
      proxy_filings: [{ form: 'DEF 14A', filed: '2025-12-04', url: 'https://www.sec.gov/x/proxy.htm' }],
    })
    const check = await checkForNewFilings(input(projectDir), deps(f))

    expect(check).toBeDefined()
    expect(check!.no_prior_corpus).toBe(false)
    expect(check!.prior_corpus_size).toBe(1)
    expect(check!.new_filings.map((x) => `${x.weight}:${x.filed}`)).toEqual([
      'strong:2026-06-20', 'strong:2026-05-28', 'medium:2026-03-11', 'weak:2025-12-04',
    ])
    expect(check!.strongest_trigger).toBe('strong')
    expect(check!.checked_at).toBe('2026-07-05T00:00:00.000Z')
  })

  it('URL normalization: query/hash noise never defeats corpus membership', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-norm-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const f = fundamentalsWith({
      recent_filings: [{ form: '10-Q', filed: '2026-06-03', url: `${KNOWN_10Q_URL}?utm=x#frag` }],
    })
    const check = await checkForNewFilings(input(projectDir), deps(f))
    expect(check!.new_filings).toEqual([])
    expect(check!.strongest_trigger).toBeUndefined()
  })

  it('FAIL-CLOSED: missing bundle → no_prior_corpus flag, EMPTY delta (never fabricated)', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-nobundle-')
    const f = fundamentalsWith({
      recent_filings: [{ form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/x/8k.htm' }],
    })
    const check = await checkForNewFilings(input(projectDir), deps(f))
    expect(check!.no_prior_corpus).toBe(true)
    expect(check!.new_filings).toEqual([])
    expect(check!.prior_corpus_size).toBe(0)
  })

  it('FAIL-CLOSED: unresolvable fundamentals → undefined (no claim either way)', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-nofund-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    expect(await checkForNewFilings(input(projectDir), deps(undefined))).toBeUndefined()
  })

  it('a NEW annual filing raises the honesty flag but never enters the weighted delta', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-annual-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const newTenK = { form: '10-K', filed: '2026-10-07', url: 'https://www.sec.gov/x/new-10k.htm' }
    const f = fundamentalsWith({ filings: [newTenK], recent_filings: [] })
    const check = await checkForNewFilings(input(projectDir), deps(f))
    expect(check!.new_annual_filing).toEqual(newTenK)
    expect(check!.new_filings).toEqual([])
  })
})
