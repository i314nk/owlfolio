import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  parse13fInfoTable,
  detectManagerSignals,
  detectClusterSignals,
  resolveIssuerTicker,
  applyShariahSectorPreFilter,
  rankDiscoverySignals,
  runDiscovery13f,
  CLONER_LIST,
  __resetCompanyTickersCacheForTests,
  fetchOpenFigiTickers,
  __resetCusipTickerCacheForTests,
  detectManagerSells,
  type ManagerQuarter,
  type CompanyTickerEntry,
} from '../discovery13f'
import { __resetTickerCacheForTests } from '../secEdgar'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, '..', '__fixtures__', 'sec-edgar')

function fixtureText(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

const tickersFixture: CompanyTickerEntry[] = [
  { cik_str: 909832, ticker: 'COST', title: 'COSTCO WHOLESALE CORP /NEW' },
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
  { cik_str: 1, ticker: 'ALLY', title: 'ALLY FINANCIAL INC' },
]

beforeEach(() => {
  __resetCompanyTickersCacheForTests()
  __resetTickerCacheForTests()
})

// ---------------------------------------------------------------------------
// Pure parser
// ---------------------------------------------------------------------------

describe('parse13fInfoTable', () => {
  it('parses each infoTable row into a normalized holding', () => {
    const holdings = parse13fInfoTable(fixtureText('13f-berkshire-current.xml'))
    expect(holdings).toHaveLength(5)
    const apple = holdings.find((h) => h.cusip === '037833100')
    expect(apple).toEqual({
      issuer: 'APPLE INC',
      cusip: '037833100',
      title_class: 'COM',
      value: 69_900_000_000,
      shares: 300_000_000,
    })
  })

  it('returns an empty array for malformed/empty xml (fail-closed)', () => {
    expect(parse13fInfoTable('')).toEqual([])
    expect(parse13fInfoTable('<not-a-13f/>')).toEqual([])
  })

  it('normalizes pre-2023 $thousands values to dollars when magnitude indicates thousands', () => {
    // A row whose `value` is clearly in $thousands (small magnitude vs huge share count) is scaled up.
    const xml = `<informationTable><infoTable>
      <nameOfIssuer>OLD FILER CO</nameOfIssuer><titleOfClass>COM</titleOfClass>
      <cusip>111111111</cusip><value>498992</value>
      <shrsOrPrnAmt><sshPrnamt>12719675</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    </infoTable></informationTable>`
    const [holding] = parse13fInfoTable(xml, { value_unit: 'thousands' })
    expect(holding?.value).toBe(498_992_000)
  })
})

// ---------------------------------------------------------------------------
// Signal detection (pure)
// ---------------------------------------------------------------------------

function berkshireQuarter(): ManagerQuarter {
  return {
    manager_name: 'Berkshire Hathaway',
    cik: '0001067983',
    period: '2025Q1',
    holdings: parse13fInfoTable(fixtureText('13f-berkshire-current.xml')),
    prior_holdings: parse13fInfoTable(fixtureText('13f-berkshire-prior.xml')),
  }
}

describe('detectManagerSignals', () => {
  it('flags NEW_POSITION for a cusip present this quarter but absent prior', () => {
    const signals = detectManagerSignals(berkshireQuarter())
    const costco = signals.find((s) => s.cusip === '22160K105')
    expect(costco?.signal_type).toBe('NEW_POSITION')
    expect(costco?.manager_name).toBe('Berkshire Hathaway')
  })

  it('flags MEANINGFUL_ADD when shares rise more than 25% vs prior', () => {
    const signals = detectManagerSignals(berkshireQuarter())
    // Ally: 8,000,000 -> 12,719,675 = +59%
    const ally = signals.find((s) => s.cusip === '02005N100')
    expect(ally?.signal_type).toBe('MEANINGFUL_ADD')
  })

  it('does NOT flag a small add under the 25% threshold', () => {
    const signals = detectManagerSignals(berkshireQuarter())
    // Apple: 280,000,000 -> 300,000,000 = +7%
    expect(signals.find((s) => s.cusip === '037833100')).toBeUndefined()
  })

  it('records conviction_pct as position value over the manager total 13F value', () => {
    const signals = detectManagerSignals(berkshireQuarter())
    const costco = signals.find((s) => s.cusip === '22160K105')
    // total = 69.9B + 4B + 1B + 2B + 0.5B = 77.4B; costco 4B / 77.4B
    expect(costco?.conviction_pct).toBeCloseTo(4_000_000_000 / 77_400_000_000, 6)
  })
})

describe('detectClusterSignals', () => {
  it('flags CLUSTER_BUY when >= 2 distinct managers initiate the same cusip', () => {
    const berkshire = berkshireQuarter()
    const pabrai: ManagerQuarter = {
      manager_name: 'Pabrai Investment Funds',
      cik: '0001549575',
      period: '2025Q1',
      holdings: [
        { issuer: 'COSTCO WHOLESALE CORP /NEW', cusip: '22160K105', title_class: 'COM', value: 200_000_000, shares: 250_000 },
      ],
      prior_holdings: [],
    }
    const clusters = detectClusterSignals([berkshire, pabrai])
    const costco = clusters.find((c) => c.cusip === '22160K105')
    expect(costco?.signal_type).toBe('CLUSTER_BUY')
    expect(costco?.contributing_managers.sort()).toEqual(['Berkshire Hathaway', 'Pabrai Investment Funds'])
  })

  it('does NOT flag a cluster when only one manager initiates a name', () => {
    const clusters = detectClusterSignals([berkshireQuarter()])
    // MSFT is a Berkshire-only NEW_POSITION; it stays NEW_POSITION, never escalates to CLUSTER_BUY.
    expect(clusters.find((c) => c.cusip === '594918104')?.signal_type).toBe('NEW_POSITION')
    expect(clusters.every((c) => c.signal_type !== 'CLUSTER_BUY')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CUSIP / name -> ticker
// ---------------------------------------------------------------------------

describe('resolveIssuerTicker', () => {
  it('resolves an issuer name to a ticker by normalized company-name match', () => {
    const result = resolveIssuerTicker('COSTCO WHOLESALE CORP /NEW', tickersFixture)
    expect(result).toEqual({ ticker: 'COST', company_name: 'COSTCO WHOLESALE CORP /NEW', resolution: 'matched' })
  })

  it('flags an unresolved issuer rather than fabricating a ticker', () => {
    const result = resolveIssuerTicker('OBSCURE HOLDINGS LLC', tickersFixture)
    expect(result.ticker).toBeUndefined()
    expect(result.resolution).toBe('unresolved')
  })
})

// ---------------------------------------------------------------------------
// Shariah sector pre-filter
// ---------------------------------------------------------------------------

describe('applyShariahSectorPreFilter', () => {
  it('drops issuers whose name matches an excluded sector keyword', () => {
    const kept = applyShariahSectorPreFilter([
      { issuer: 'ALLY FINANCIAL INC', cusip: '02005N100' },
      { issuer: 'COSTCO WHOLESALE CORP /NEW', cusip: '22160K105' },
    ])
    expect(kept.map((k) => k.cusip)).toEqual(['22160K105'])
  })

  it('keeps a name with unknown sector so the quick screen can catch it', () => {
    const kept = applyShariahSectorPreFilter([{ issuer: 'OBSCURE HOLDINGS LLC', cusip: '999999999' }])
    expect(kept).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Cloner list
// ---------------------------------------------------------------------------

describe('CLONER_LIST', () => {
  it('contains Berkshire with the confirmed CIK and never emits a guessed CIK', () => {
    const berkshire = CLONER_LIST.find((m) => m.manager_name.includes('Berkshire'))
    expect(berkshire?.cik).toBe('0001067983')
    // Every entry either has a verified 10-digit CIK or is explicitly flagged unverified (no guesses).
    for (const m of CLONER_LIST) {
      if (m.cik !== undefined) {
        expect(m.cik).toMatch(/^\d{10}$/)
      } else {
        expect(m.cik_unverified).toBe(true)
      }
    }
  })

  it('tracks the owner-requested roster (2026-07-16) with SEC-verified CIKs', () => {
    const byCik = new Map(CLONER_LIST.map((m) => [m.cik, m]))
    // Verified live against https://data.sec.gov/submissions/CIK{cik}.json on 2026-07-16.
    expect(byCik.get('0001067983')?.manager_name).toContain('Berkshire')
    expect(byCik.get('0001173334')?.manager_name).toContain('Pabrai')
    expect(byCik.get('0001649339')?.manager_name).toContain('Scion')
    expect(byCik.get('0001709323')?.manager_name).toContain('Himalaya')
    expect(byCik.get('0001061768')?.manager_name).toContain('Baupost')
    expect(byCik.get('0001336528')?.manager_name).toContain('Pershing Square')
    expect(byCik.get('0002104187')?.manager_name).toContain('Aquamarine')
    // Removed for now (owner 2026-07-16): Akre + Giverny.
    expect(byCik.has('0001112520')).toBe(false)
    expect(byCik.has('0001641864')).toBe(false)
    expect(CLONER_LIST).toHaveLength(7)
    // Every entry names the investor alongside the firm (except single-identity firms).
    for (const m of CLONER_LIST) {
      if (!m.manager_name.includes('Akre')) {
        expect(m.manager_name).toMatch(/\(.+\)/)
      }
    }
    // Intermittent filers carry an honest staleness note so the page never fakes a live book.
    expect(byCik.get('0001649339')?.note).toMatch(/intermittent|deregist|2025Q3/i)
    expect(byCik.get('0001173334')?.note).toMatch(/2012/)
  })
})

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

describe('rankDiscoverySignals', () => {
  it('ranks CLUSTER_BUY above NEW_POSITION above MEANINGFUL_ADD', () => {
    const ranked = rankDiscoverySignals([
      { cusip: 'c', signal_type: 'MEANINGFUL_ADD', conviction_pct: 0.5, contributing_managers: ['m'], issuer: 'i' },
      { cusip: 'a', signal_type: 'CLUSTER_BUY', conviction_pct: 0.01, contributing_managers: ['m1', 'm2'], issuer: 'i' },
      { cusip: 'b', signal_type: 'NEW_POSITION', conviction_pct: 0.2, contributing_managers: ['m'], issuer: 'i' },
    ])
    expect(ranked.map((r) => r.cusip)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// Integration: runDiscovery13f
// ---------------------------------------------------------------------------

function makeMemoryStore(): { store: InMemoryEventStore } {
  return { store: new InMemoryEventStore() }
}

describe('runDiscovery13f', () => {
  const berkshire = berkshireQuarter()
  const pabrai: ManagerQuarter = {
    manager_name: 'Pabrai Investment Funds',
    cik: '0001549575',
    period: '2025Q1',
    holdings: [
      { issuer: 'COSTCO WHOLESALE CORP /NEW', cusip: '22160K105', title_class: 'COM', value: 200_000_000, shares: 250_000 },
    ],
    prior_holdings: [],
  }

  const deps = {
    fetchManagerQuarters: async () => [berkshire, pabrai],
    fetchCompanyTickers: async () => tickersFixture,
    now: () => '2025-05-15T00:00:00.000Z',
  }

  it('records source:13f_clone CANDIDATE entries for surviving signals, dropping Shariah-excluded sectors', async () => {
    const { store } = makeMemoryStore()
    const result = await runDiscovery13f(store, { ...deps, test_mode: true })

    const candidates = projectDiscoveryCandidates(await store.list())
    const tickers = candidates.map((c) => c.ticker).sort()
    // Costco (CLUSTER_BUY), MSFT (NEW_POSITION) survive; Ally (MEANINGFUL_ADD) is a financial -> dropped by sector filter.
    expect(tickers).toContain('COST')
    expect(tickers).toContain('MSFT')
    expect(candidates.find((c) => c.ticker === 'ALLY')).toBeUndefined()
    expect(candidates.every((c) => c.discovery_source === '13f_clone')).toBe(true)
    // Candidates stamp the strategy's CANONICAL version (buffett-munger@1.0.0), so a promoted case
    // matches the pipeline's strategy-version guard — NOT a bespoke '2026.06'.
    expect(candidates.every((c) => c.strategy_id === 'buffett-munger' && c.strategy_version === '1.0.0')).toBe(true)
    expect(result.candidates_created).toBeGreaterThan(0)
  })

  it('carries signal_type, contributing managers and conviction in candidate metadata', async () => {
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, { ...deps, test_mode: true })
    const events = await store.list()
    const costcoEvent = events.find(
      (e) => e.event_type === 'discovery_candidate_discovered'
        && (e.payload as { ticker?: string }).ticker === 'COST',
    )
    const meta = (costcoEvent?.payload as { discovery_metadata?: Record<string, unknown> }).discovery_metadata
    expect(meta?.['signal_type']).toBe('CLUSTER_BUY')
    expect(meta?.['contributing_managers']).toEqual(expect.arrayContaining(['Berkshire Hathaway', 'Pabrai Investment Funds']))
    expect(typeof meta?.['conviction_pct']).toBe('number')
  })

  it('is idempotent: re-running the same quarter does not create duplicate candidates', async () => {
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, { ...deps, test_mode: true })
    const first = projectDiscoveryCandidates(await store.list()).length
    await runDiscovery13f(store, { ...deps, test_mode: true })
    const second = projectDiscoveryCandidates(await store.list()).length
    expect(second).toBe(first)
  })

  it('does NOT auto-advance candidates past discovered (human/quick-screen gate stays)', async () => {
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, { ...deps, test_mode: true })
    const candidates = projectDiscoveryCandidates(await store.list())
    expect(candidates.every((c) => c.status === 'discovered' || c.status === 'duplicate')).toBe(true)
  })

  it('records an unresolved candidate (no fabricated ticker) for an unmatched issuer name', async () => {
    const onlyUnresolved: ManagerQuarter = {
      manager_name: 'Test Mgr',
      cik: '0000000001',
      period: '2025Q1',
      holdings: [{ issuer: 'OBSCURE HOLDINGS LLC', cusip: '999999999', title_class: 'COM', value: 9_000_000, shares: 1000 }],
      prior_holdings: [],
    }
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, {
      fetchManagerQuarters: async () => [onlyUnresolved],
      fetchCompanyTickers: async () => tickersFixture,
      now: () => '2025-05-15T00:00:00.000Z',
      test_mode: true,
    })
    const events = await store.list()
    const ev = events.find((e) => e.event_type === 'discovery_candidate_discovered')
    const meta = (ev?.payload as { discovery_metadata?: Record<string, unknown> }).discovery_metadata
    expect(meta?.['ticker_resolution']).toBe('unresolved')
    expect((ev?.payload as { ticker?: string }).ticker).toBe('UNRESOLVED:999999999')
  })

  it('fails closed in test_mode with no fetch deps (no live SEC in unit tests)', async () => {
    const { store } = makeMemoryStore()
    await expect(runDiscovery13f(store, { test_mode: true } as never)).rejects.toThrow()
  })

  it('resolves ticker by CUSIP (OpenFIGI) ahead of name-match, recording provenance', async () => {
    __resetCompanyTickersCacheForTests()
    const { store } = makeMemoryStore()
    const cusipMap = new Map<string, string>([['22160K105', 'COST'], ['594918104', 'MSFT']])
    await runDiscovery13f(store, { ...deps, test_mode: true, fetchCusipTickers: async () => cusipMap })
    const candidates = projectDiscoveryCandidates(await store.list())
    const cost = candidates.find((c) => c.ticker === 'COST')
    expect((cost?.discovery_metadata as Record<string, unknown> | undefined)?.['ticker_resolution']).toBe('matched_by_cusip')
  })

  it('falls back to name-match when the CUSIP map lacks the cusip', async () => {
    __resetCompanyTickersCacheForTests()
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, { ...deps, test_mode: true, fetchCusipTickers: async () => new Map() })
    const candidates = projectDiscoveryCandidates(await store.list())
    const cost = candidates.find((c) => c.ticker === 'COST')
    expect(cost).toBeDefined()
    expect((cost?.discovery_metadata as Record<string, unknown> | undefined)?.['ticker_resolution']).toBe('matched_by_name')
  })
})

// ---------------------------------------------------------------------------
// fetchOpenFigiTickers
// ---------------------------------------------------------------------------

describe('fetchOpenFigiTickers', () => {
  beforeEach(() => __resetCusipTickerCacheForTests())

  function figiFetch(map: Record<string, string | null>): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      const body = jobs.map((j) => {
        const t = map[j.idValue.toUpperCase()]
        return t === null || t === undefined ? { warning: 'No identifier found.' } : { data: [{ ticker: t }] }
      })
      return { ok: true, json: async () => body } as Response
    }) as unknown as typeof fetch
  }

  it('maps CUSIP -> upper-cased ticker, skipping no-data/warning jobs', async () => {
    const out = await fetchOpenFigiTickers(['053015103', '02079K107', 'BADCUSIP00'], {
      fetchImpl: figiFetch({ '053015103': 'ADP', '02079K107': 'GOOG', BADCUSIP00: null }),
    })
    expect(out.get('053015103')).toBe('ADP')
    expect(out.get('02079K107')).toBe('GOOG')
    expect(out.has('BADCUSIP00')).toBe(false)
  })

  it('resolves distinct share-class CUSIPs to distinct tickers', async () => {
    const out = await fetchOpenFigiTickers(['02079K107', '02079K305'], {
      fetchImpl: figiFetch({ '02079K107': 'GOOG', '02079K305': 'GOOGL' }),
    })
    expect(out.get('02079K107')).toBe('GOOG')
    expect(out.get('02079K305')).toBe('GOOGL')
  })

  it('chunks >10 cusips into multiple requests', async () => {
    let calls = 0
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      calls += 1
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      return { ok: true, json: async () => jobs.map((j) => ({ data: [{ ticker: `T${j.idValue}` }] })) } as Response
    }) as unknown as typeof fetch
    const cusips = Array.from({ length: 23 }, (_v, i) => `CUSIP${i.toString().padStart(5, '0')}`)
    const out = await fetchOpenFigiTickers(cusips, { fetchImpl })
    expect(calls).toBe(3)
    expect(out.size).toBe(23)
  })

  it('is fail-closed: a non-200 / throwing fetch yields an empty map, never throws', async () => {
    const bad = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    await expect(fetchOpenFigiTickers(['053015103'], { fetchImpl: bad })).resolves.toEqual(new Map())
    const non200 = (async () => ({ ok: false } as Response)) as unknown as typeof fetch
    await expect(fetchOpenFigiTickers(['053015103'], { fetchImpl: non200 })).resolves.toEqual(new Map())
  })

  it('caches resolved cusips across calls (no second fetch)', async () => {
    let calls = 0
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      calls += 1
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      return { ok: true, json: async () => jobs.map(() => ({ data: [{ ticker: 'ADP' }] })) } as Response
    }) as unknown as typeof fetch
    await fetchOpenFigiTickers(['053015103'], { fetchImpl })
    await fetchOpenFigiTickers(['053015103'], { fetchImpl })
    expect(calls).toBe(1)
  })
})

describe('detectManagerSells (the sell side of the QoQ diff — 13F page S1)', () => {
  it('flags EXIT for a cusip present prior but absent this quarter (with the unwound conviction)', () => {
    const quarter: ManagerQuarter = {
      manager_name: 'M',
      cik: '0000000001',
      period: '2025Q1',
      holdings: [
        { issuer: 'KeepCo', cusip: 'KEEP000001', title_class: 'COM', value: 300, shares: 30, put_call: undefined },
      ] as never,
      prior_holdings: [
        { issuer: 'KeepCo', cusip: 'KEEP000001', title_class: 'COM', value: 300, shares: 30, put_call: undefined },
        { issuer: 'GoneCo', cusip: 'GONE000001', title_class: 'COM', value: 100, shares: 10, put_call: undefined },
      ] as never,
    }
    const sells = detectManagerSells(quarter)
    const exit = sells.find((s) => s.cusip === 'GONE000001')
    expect(exit?.signal_type).toBe('EXIT')
    expect(exit?.prior_shares).toBe(10)
    expect(exit?.current_shares).toBe(0)
    // GoneCo was 100 of a 400 prior book.
    expect(exit?.prior_conviction_pct).toBeCloseTo(0.25, 6)
    // The kept name stays quiet.
    expect(sells.find((s) => s.cusip === 'KEEP000001')).toBeUndefined()
  })

  it('flags MEANINGFUL_TRIM when shares fall more than 25% vs prior (the buy threshold mirrored)', () => {
    const quarter: ManagerQuarter = {
      manager_name: 'M',
      cik: '0000000001',
      period: '2025Q1',
      holdings: [
        { issuer: 'TrimCo', cusip: 'TRIM000001', title_class: 'COM', value: 50, shares: 60, put_call: undefined },
        { issuer: 'SmallTrimCo', cusip: 'SMALL00001', title_class: 'COM', value: 90, shares: 90, put_call: undefined },
      ] as never,
      prior_holdings: [
        { issuer: 'TrimCo', cusip: 'TRIM000001', title_class: 'COM', value: 100, shares: 100, put_call: undefined },
        { issuer: 'SmallTrimCo', cusip: 'SMALL00001', title_class: 'COM', value: 100, shares: 100, put_call: undefined },
      ] as never,
    }
    const sells = detectManagerSells(quarter)
    const trim = sells.find((s) => s.cusip === 'TRIM000001')
    expect(trim?.signal_type).toBe('MEANINGFUL_TRIM')
    expect(trim?.prior_shares).toBe(100)
    expect(trim?.current_shares).toBe(60)
    // −10% stays quiet.
    expect(sells.find((s) => s.cusip === 'SMALL00001')).toBeUndefined()
  })
})

describe('runDiscovery13f — quarter snapshots (13F page S1)', () => {
  const berkshire = berkshireQuarter()
  const deps = {
    fetchManagerQuarters: async () => [berkshire],
    fetchCompanyTickers: async () => tickersFixture,
    now: () => '2025-05-15T00:00:00.000Z',
  }

  it('records one discovery_13f_quarter_recorded per manager quarter (idempotent), with top holdings + QoQ chips + sells', async () => {
    const { store } = makeMemoryStore()
    await runDiscovery13f(store, { ...deps, test_mode: true })
    await runDiscovery13f(store, { ...deps, test_mode: true })

    const events = (await store.list()).filter((e) => e.event_type === 'discovery_13f_quarter_recorded')
    expect(events).toHaveLength(1)
    const p = events[0]!.payload as Record<string, unknown>
    expect(p.manager_name).toBe('Berkshire Hathaway')
    expect(p.period).toBe('2025Q1')
    expect(typeof p.total_value).toBe('number')
    expect(typeof p.position_count).toBe('number')

    const holdings = p.top_holdings as Record<string, unknown>[]
    expect(holdings.length).toBeGreaterThan(0)
    expect(holdings.length).toBeLessThanOrEqual(15)
    // Sorted by value desc — Apple leads the fixture book.
    expect(holdings[0]).toMatchObject({ cusip: '037833100', change: 'UNCHANGED' })
    expect(typeof holdings[0]!.pct).toBe('number')
    // Costco is a NEW position; Ally a MEANINGFUL add.
    expect(holdings.find((h) => h.cusip === '22160K105')?.change).toBe('NEW')
    // The snapshot resolves tickers (name-fallback in test mode) — the cross-reference alert needs them.
    expect(holdings.find((h) => h.cusip === '22160K105')?.ticker).toBe('COST')
    expect(holdings.find((h) => h.cusip === '02005N100')?.change).toBe('ADD')

    // Sells ride the same event (the fixture book has no exits/trims → empty but PRESENT).
    expect(Array.isArray(p.sells)).toBe(true)

    // v2: per-manager BUYS ride the event too — the heat-map matrix needs per-manager conviction.
    const buys = p.buys as Record<string, unknown>[]
    expect(buys.find((b) => b.cusip === '22160K105')).toMatchObject({ ticker: 'COST', signal_type: 'NEW_POSITION' })
    expect(buys.find((b) => b.cusip === '02005N100')?.signal_type).toBe('MEANINGFUL_ADD')
    for (const b of buys) {
      expect(typeof b.conviction_pct).toBe('number')
    }
  })
})
