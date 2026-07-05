import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { createResearchCase, ingestManualSourceBundle } from '@owlfolio/workflow'
import type { Fundamentals } from '@owlfolio/workflow/secEdgar'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
}

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
const RC = 'rc_rr_route'
const KNOWN_10K = 'https://www.sec.gov/Archives/edgar/data/1/prior-10k.htm'
const NEW_8K = 'https://www.sec.gov/Archives/edgar/data/1/new-8k.htm'

function fundamentalsWith(recent: { form: string; filed: string; url: string }[]): Fundamentals {
  return {
    cik: '1', entity_name: 'TST', currency: 'USD',
    latest_annual: { fiscal_year: 2025, currency: 'USD' },
    annual_series: [],
    filings: [],
    recent_filings: recent,
  } as unknown as Fundamentals
}

const ground = (async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: s.title, url: s.url, excerpt: s.excerpt,
    availability: 'available' as const, fetched_at: 'x', content_hash: sha(s.url),
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as never

function fakeProvider() {
  return {
    provider_id: 'fake-rr',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => ({
      overall_assessment: 'INTACT',
      trigger_assessments: [{ trigger: 'Renewal < 88%', tripped: 'no', evidence_citation: 'rr_8k_2026-06-20_0', reasoning: 'r' }],
      changed_dimensions: [],
      narrative: 'Nothing changed.',
      source_ids: ['rr_8k_2026-06-20_0'],
      proposed_sources: [{ source_id: 'rr_8k_2026-06-20_0', title: '8-K', url: NEW_8K, excerpt: 'e' }],
    })),
  }
}

async function seedCase(ledgerPath: string, sourceLedgerPath: string, opts?: { withThesis?: boolean; withBundle?: boolean }): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: RC, company_id: 'company_tst', ticker: 'TST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
    })
    if (opts?.withThesis !== false) {
      await store.append({
        event_id: 'evt_rr_route_decision', event_type: 'decision_drafted',
        aggregate_type: 'research_case', aggregate_id: RC, correlation_id: RC,
        actor_type: 'provider', actor_id: 'fake-rr',
        payload: { research_case_id: RC, decision: 'WATCH', thesis_summary: 'A thesis.', thesis_break_triggers: ['Renewal < 88%'] },
        source_ids: [], created_at: '2026-06-01T00:00:00.000Z', schema_version: 1,
      })
    }
  } finally {
    store.close()
  }
  if (opts?.withBundle !== false) {
    await ingestManualSourceBundle({
      source_ledger_path: sourceLedgerPath,
      research_case_id: RC, ticker: 'TST', strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system', ingested_by_actor_id: 'research_workflow',
      sources: [{ source_id: 's1', kind: 'url', url: KNOWN_10K, content_hash: sha('x'), availability: 'available' }],
    })
  }
}

function callRoute(caseId: string, deps?: unknown) {
  return POST(
    new Request(`http://localhost/api/research/${caseId}/re-review`, { method: 'POST' }),
    { params: Promise.resolve({ caseId }) },
    deps as never,
  )
}

describe('/api/research/[caseId]/re-review', () => {
  let tempDir: string
  let ledgerPath: string
  let sourceLedgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-rr-route-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    sourceLedgerPath = join(tempDir, 'source-ledger')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('records the diff and returns it when a new filing exists (observation event on the case)', async () => {
    await seedCase(ledgerPath, sourceLedgerPath)
    const res = await callRoute(RC, {
      provider: fakeProvider(),
      ground,
      fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; re_review: Record<string, unknown> }
    expect(body.status).toBe('recorded')
    expect(body.re_review.assessment).toBe('INTACT')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const rr = events.filter((e) => e.event_type === 'research_case_re_review_recorded')
      expect(rr).toHaveLength(1)
      expect(rr[0]?.aggregate_id).toBe(RC)
      expect(rr[0]?.actor_type).toBe('provider')
    } finally {
      store.close()
    }
  })

  it('surfaces a threshold insider-selling cluster even with no new conventional filings (§3.3, zero-spend)', async () => {
    await seedCase(ledgerPath, sourceLedgerPath)
    const saleXml = (owner: string) =>
      `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><periodOfReport>2026-06-15</periodOfReport>`
      + `<issuer><issuerCik>1</issuerCik><issuerTradingSymbol>TST</issuerTradingSymbol></issuer>`
      + `<reportingOwner><reportingOwnerId><rptOwnerCik>9</rptOwnerCik><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>`
      + `<reportingOwnerRelationship><isOfficer>true</isOfficer><officerTitle>CFO</officerTitle></reportingOwnerRelationship></reportingOwner>`
      + `<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle>`
      + `<transactionDate><value>2026-06-15</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding>`
      + `<transactionAmounts><transactionShares><value>1000</value></transactionShares>`
      + `<transactionPricePerShare><value>50</value></transactionPricePerShare>`
      + `<transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>`
      + `</nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`
    const provider = fakeProvider()
    // The 10-Q is already in the seeded corpus → no NEW conventional filings; two insiders sold since the decision.
    const fundamentals = {
      cik: '1', entity_name: 'TST', currency: 'USD',
      latest_annual: { fiscal_year: 2025, currency: 'USD' }, annual_series: [], filings: [],
      recent_filings: [{ form: '10-Q', filed: '2026-06-03', url: KNOWN_10K }],
      form4_filings: [
        { form: '4', filed: '2026-06-20', url: 'https://www.sec.gov/x/f4a.xml' },
        { form: '4', filed: '2026-06-22', url: 'https://www.sec.gov/x/f4b.xml' },
      ],
    } as unknown as Fundamentals
    const res = await callRoute(RC, {
      provider, ground,
      fetchFundamentals: async () => fundamentals,
      fetchForm4Document: async (url: string) => (url.includes('f4b') ? saleXml('Bravo Betty') : saleXml('Alpha Adam')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; insider_cluster?: { distinct_sellers: number; meets_threshold: boolean } }
    expect(body.status).toBe('no_new_filings')
    expect(body.insider_cluster).toBeDefined()
    expect(body.insider_cluster?.distinct_sellers).toBe(2)
    expect(body.insider_cluster?.meets_threshold).toBe(true)
    expect(provider.structured).not.toHaveBeenCalled() // still zero provider spend
  })

  it('zero-spend: no new filings → 200 no_new_filings, no event, provider never called', async () => {
    await seedCase(ledgerPath, sourceLedgerPath)
    const provider = fakeProvider()
    const res = await callRoute(RC, {
      provider,
      ground,
      fetchFundamentals: async () => fundamentalsWith([{ form: '10-Q', filed: '2026-06-03', url: KNOWN_10K }]),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('no_new_filings')
    expect(provider.structured).not.toHaveBeenCalled()
  })

  it('no recorded thesis → 409', async () => {
    await seedCase(ledgerPath, sourceLedgerPath, { withThesis: false })
    const res = await callRoute(RC, {
      provider: fakeProvider(), ground,
      fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('no_recorded_thesis')
  })

  it('missing prior bundle → 200 no_prior_corpus, zero spend', async () => {
    await seedCase(ledgerPath, sourceLedgerPath, { withBundle: false })
    const provider = fakeProvider()
    const res = await callRoute(RC, {
      provider, ground,
      fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('no_prior_corpus')
    expect(provider.structured).not.toHaveBeenCalled()
  })

  it('provider not ready → 400 fail-closed before anything runs', async () => {
    await seedCase(ledgerPath, sourceLedgerPath)
    const res = await callRoute(RC, {
      readinessOverride: { is_ready: false, provider_id: 'openrouter', status_label: 'missing key' },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('provider_not_ready')
  })
})
