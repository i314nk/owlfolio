import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkForNewFilings, eightKItemWeight, filingFormWeight, type CheckForNewFilingsDeps } from '../reReviewTrigger.js'
import { ingestManualSourceBundle } from '../sourceLedger'
import type { Fundamentals } from '../secEdgar.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'sec-edgar')
async function saleFixtureFor(ownerName: string): Promise<string> {
  const xml = await readFile(join(fixtureDir, 'insider-form4-sale.xml'), 'utf8')
  return xml.replace('Doe John A', ownerName)
}

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

describe('eightKItemWeight (v2 item-code weighting)', () => {
  it('unscheduled thesis-break items are STRONG', () => {
    expect(eightKItemWeight('2.06,9.01')).toBe('strong') // material impairment
    expect(eightKItemWeight('4.02')).toBe('strong') // non-reliance / restatement
    expect(eightKItemWeight('5.02,9.01')).toBe('strong') // exec/director departure (COST live: CEO-succession 8-K)
    expect(eightKItemWeight('1.01')).toBe('strong') // material agreement (M&A)
    expect(eightKItemWeight('1.03')).toBe('strong') // bankruptcy
    expect(eightKItemWeight('2.02,5.02')).toBe('strong') // max wins on multi-item
  })

  it('scheduled/ambiguous items are MEDIUM — visible, never auto-spend', () => {
    expect(eightKItemWeight('2.02,9.01')).toBe('medium') // earnings release (COST live: the quarterly noise)
    expect(eightKItemWeight('8.01,9.01')).toBe('medium') // other events (COST live: dividend declaration)
    expect(eightKItemWeight('7.01')).toBe('medium') // Reg FD
    expect(eightKItemWeight('5.07,8.01')).toBe('medium') // shareholder votes (COST live)
    expect(eightKItemWeight('9.01')).toBe('medium') // exhibits-only
  })

  it('missing/unparseable item metadata fails toward attention: STRONG', () => {
    expect(eightKItemWeight(undefined)).toBe('strong')
    expect(eightKItemWeight('')).toBe('strong')
    expect(eightKItemWeight('garbage')).toBe('strong')
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

  it('an 8-K carrying item codes takes its ITEM weight — a routine earnings 8-K is medium, not strong', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-items-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const f = fundamentalsWith({
      recent_filings: [
        { form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/x/8k-earnings.htm', items: '2.02,9.01' },
        { form: '8-K', filed: '2026-06-18', url: 'https://www.sec.gov/x/8k-exec.htm', items: '5.02,9.01' },
        { form: '8-K', filed: '2026-06-15', url: 'https://www.sec.gov/x/8k-noitems.htm' },
      ] as never,
    })
    const check = await checkForNewFilings(input(projectDir), deps(f))
    const byUrl = new Map(check!.new_filings.map((x) => [x.url, x.weight]))
    expect(byUrl.get('https://www.sec.gov/x/8k-earnings.htm')).toBe('medium')
    expect(byUrl.get('https://www.sec.gov/x/8k-exec.htm')).toBe('strong')
    expect(byUrl.get('https://www.sec.gov/x/8k-noitems.htm')).toBe('strong') // no metadata → attention
    expect(check!.strongest_trigger).toBe('strong')
  })

  it('SINCE bound: filings filed before the decision date are excluded even when not in the corpus', async () => {
    // The decision corpus only holds what the run READ (~6 interim filings) — without the since bound,
    // a company's entire unread 8-K history looks "new" (live dogfood found COST surfacing 8-Ks back to
    // 2022). The trigger is "filed SINCE the last synthesis", not "everything the run didn't read".
    const projectDir = await makeTempDir('owlfolio-rr-since-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const f = fundamentalsWith({
      recent_filings: [
        { form: '8-K', filed: '2022-03-09', url: 'https://www.sec.gov/x/8k-ancient.htm' }, // unread, old
        { form: '8-K', filed: '2026-07-04', url: 'https://www.sec.gov/x/8k-decision-day.htm' }, // same day, unread
        { form: '8-K', filed: '2026-07-20', url: 'https://www.sec.gov/x/8k-fresh.htm' }, // genuinely new
      ],
      filings: [{ form: '10-K', filed: '2024-10-08', url: 'https://www.sec.gov/x/old-10k.htm' }], // pre-decision annual
    })
    const check = await checkForNewFilings({ ...input(projectDir), since: '2026-07-04T12:55:27.155Z' }, deps(f))
    // Same-day stays (it may have landed after synthesis; the corpus diff already drops anything read).
    expect(check!.new_filings.map((x) => x.filed)).toEqual(['2026-07-20', '2026-07-04'])
    // The old unread annual is NOT flagged as due either.
    expect(check!.new_annual_filing).toBeUndefined()
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

describe('checkForNewFilings — insider Form 4 cluster (§3.3)', () => {
  const input = (projectDir: string) => ({
    ticker: 'COST',
    research_case_id: 'rc_cost',
    source_ledger_path: join(projectDir, 'source-ledger'),
    since: '2026-01-01',
  })

  it('fires a STRONG insider_cluster when >=2 insiders made discretionary sales since the decision', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-insider-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const aXml = await saleFixtureFor('Alpha Adam')
    const bXml = await saleFixtureFor('Bravo Betty')
    const f = fundamentalsWith({
      form4_filings: [
        { form: '4', filed: '2026-06-20', url: 'https://www.sec.gov/x/form4-a.xml' },
        { form: '4', filed: '2026-06-22', url: 'https://www.sec.gov/x/form4-b.xml' },
      ],
    })
    const clusterDeps: CheckForNewFilingsDeps = {
      fetchFundamentals: vi.fn(async () => f),
      now: () => '2026-07-05T00:00:00.000Z',
      fetchForm4Document: async (url) => (url.includes('form4-b') ? bXml : aXml),
    }
    const check = await checkForNewFilings(input(projectDir), clusterDeps)
    expect(check?.insider_cluster).toBeDefined()
    expect(check?.insider_cluster?.distinct_sellers).toBe(2)
    expect(check?.insider_cluster?.meets_threshold).toBe(true)
    expect(check?.strongest_trigger).toBe('strong')
  })

  it('does NOT fire for a single insider sale (not a cluster)', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-insider-single-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const aXml = await saleFixtureFor('Alpha Adam')
    const f = fundamentalsWith({
      form4_filings: [{ form: '4', filed: '2026-06-20', url: 'https://www.sec.gov/x/form4-a.xml' }],
      recent_filings: [],
    })
    const singleDeps: CheckForNewFilingsDeps = {
      fetchFundamentals: vi.fn(async () => f),
      now: () => '2026-07-05T00:00:00.000Z',
      fetchForm4Document: async () => aXml,
    }
    const check = await checkForNewFilings(input(projectDir), singleDeps)
    expect(check?.insider_cluster?.meets_threshold ?? false).toBe(false)
    expect(check?.strongest_trigger).toBeUndefined()
  })

  it('ignores RSU/mechanical-only Form 4 activity (no discretionary sales, no cluster)', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-insider-rsu-')
    await seedBundle(projectDir, [KNOWN_10Q_URL])
    const rsuXml = await readFile(join(fixtureDir, 'aapl-form4-rsu.xml'), 'utf8')
    const f = fundamentalsWith({
      form4_filings: [
        { form: '4', filed: '2026-06-18', url: 'https://www.sec.gov/x/form4-r1.xml' },
        { form: '4', filed: '2026-06-19', url: 'https://www.sec.gov/x/form4-r2.xml' },
      ],
      recent_filings: [],
    })
    const rsuDeps: CheckForNewFilingsDeps = {
      fetchFundamentals: vi.fn(async () => f),
      now: () => '2026-07-05T00:00:00.000Z',
      fetchForm4Document: async () => rsuXml,
    }
    const check = await checkForNewFilings(input(projectDir), rsuDeps)
    expect(check?.insider_cluster?.meets_threshold ?? false).toBe(false)
  })
})
