import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const fakeSource = (prices: Record<string, number>) => ({
  id: 'fake',
  async getQuote(s: { ticker: string }) {
    const p = prices[s.ticker]
    return p === undefined
      ? { available: false as const, reason: 'no fixture', source: 'fake' }
      : { available: true as const, price_per_share: p, currency: 'USD', as_of: '2026-07-05T00:00:00.000Z', source: 'fake' }
  },
})

/**
 * Replicated from packages/workflow/src/__tests__/priceRefreshFixtures.ts (not exported from package).
 * Seeds a user-approved watchlist item with a research case that has buy_price_per_share.
 * Emits: research_case_created → buffett_munger_analysis_drafted → watchlist_draft_created →
 * watchlist_draft_confirmed.
 */
async function seedConfirmedWatchlistItem(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  { ticker, buy_below }: { ticker: string; buy_below: number },
): Promise<{ watchlist_item_id: string; research_case_id: string }> {
  const id = ticker.toLowerCase()
  const research_case_id = `rc_${id}_fixture`
  const watchlist_item_id = `watch_${id}_fixture`

  await store.append({
    event_id: `evt_research_case_created_${id}_fixture`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: research_case_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker, company_id: `company_${id}`, strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
  })

  await store.append({
    event_id: `evt_analysis_drafted_${id}_fixture`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: research_case_id,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      next_required_action: 'Confirm watchlist draft',
      valuation: { buy_price_per_share: buy_below, moat_class: 'wide' },
    },
    source_ids: [],
    created_at: '2026-01-01T00:01:00.000Z',
    schema_version: 1,
  })

  await store.append({
    event_id: `evt_watchlist_draft_created_${id}_fixture`,
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: watchlist_item_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id,
      ticker,
      user_approved: false,
      company_id: `company_${id}`,
      strategy_id: 'buffett-munger',
      thesis_summary: `Fixture watchlist item for ${ticker}`,
    },
    source_ids: [],
    created_at: '2026-01-01T00:02:00.000Z',
    schema_version: 1,
  })

  await store.append({
    event_id: `evt_watchlist_draft_confirmed_${id}_fixture`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: watchlist_item_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id, ticker, locked_buy_below: buy_below },
    source_ids: [],
    created_at: '2026-01-01T00:03:00.000Z',
    schema_version: 1,
  })

  return { watchlist_item_id, research_case_id }
}

describe('/api/prices/refresh', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-prices-refresh-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      initialized_at: '2026-01-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('returns 200 with refreshed and buy_zone_hits for MSFT at 420 below buy-below of 500', async () => {
    const store = new SQLiteEventStore(ledgerPath)
    try {
      await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })
    } finally {
      store.close()
    }

    const res = await POST(new Request('http://localhost/api/prices/refresh', { method: 'POST' }), undefined, { priceSource: fakeSource({ MSFT: 420 }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { refreshed: string[]; unavailable: string[]; buy_zone_hits: string[] }
    expect(body.refreshed).toContain('MSFT')
    expect(body.buy_zone_hits).toContain('MSFT')
  })

  it('returns 409 when the workflow is not initialized (unconfigured state)', async () => {
    // Point config path at a nonexistent file → getOnboardingState returns unconfigured (is_initialized: false)
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'no-such-config.json')

    const res = await POST(new Request('http://localhost/api/prices/refresh', { method: 'POST' }), undefined, {},
    )
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Personal-local workflow is not initialized/)
  })
})
