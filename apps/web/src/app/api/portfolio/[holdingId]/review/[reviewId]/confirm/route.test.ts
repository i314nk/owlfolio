import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { listBusinessItems } from '@owlfolio/strategies/checklistParams'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '@owlfolio/workflow/holdingWorkflow'
import { draftHoldingReview } from '@owlfolio/workflow/holdingReviewWorkflow'

import { POST } from './route'

// Audit-and-decide re-underwrite confirm: the route posts ONLY the single cognitive acknowledgement. The
// server marshals the business findings and gates holding_review_confirmed on a complete audit (every
// business item carries a finding AND the cognitive reflection is acknowledged).

/** Acknowledge the cognitive reflection, mirroring the confirm form's single checkbox. */
function appendCognitiveAck(form: URLSearchParams): void {
  form.set('cognitive_reflection_acknowledged', 'on')
}

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const HOLDING_ID = 'holding_cost_001'
const REVIEW_ID = 'review_holding_cost_001_2026_06_30'

/** Seed a holding with a valuation snapshot and a pending provider-drafted review. */
async function seedHoldingWithDraftReview(ledgerPath: string): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  const provider = new MockProvider()
  try {
    const holding = await openHoldingFromWatchlist(store, {
      holding_id: HOLDING_ID,
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Durable quality compounder.',
      shares: 3,
      cost_basis_per_share: 800,
      opened_at: '2026-05-31',
      currency: 'USD',
      causation_id: 'evt_watchlist_confirmed',
      actor_id: 'user_local',
    })
    await recordHoldingValuationSnapshot(store, {
      snapshot_id: 'valuation_holding_cost_001_2026_06_01',
      holding_id: HOLDING_ID,
      price_per_share: 900,
      currency: 'USD',
      valued_at: '2026-06-01',
      causation_id: holding.event_id,
      actor_id: 'user_local',
    })
    await draftHoldingReview(store, provider, {
      review_id: REVIEW_ID,
      holding_id: HOLDING_ID,
      model_id: 'mock-buffett-munger-demo',
      causation_id: holding.event_id,
    })
  } finally {
    store.close()
  }
}

describe('/api/portfolio/[holdingId]/review/[reviewId]/confirm', () => {
  let tempDir: string
  let appConfigPath: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-confirm-route-'))
    appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir

    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv]
      } else {
        process.env[key as keyof typeof originalEnv] = value
      }
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  function callRoute(form: URLSearchParams) {
    return POST(new Request(`http://localhost/api/portfolio/${HOLDING_ID}/review/${REVIEW_ID}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }), {
      params: Promise.resolve({ holdingId: HOLDING_ID, reviewId: REVIEW_ID }),
    })
  }

  it('confirms the re-underwrite, marshals the audit server-side, persists it, and redirects', async () => {
    await seedHoldingWithDraftReview(ledgerPath)
    const form = new URLSearchParams()
    appendCognitiveAck(form)

    await expect(callRoute(form)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const confirmed = events.find((event) => event.event_type === 'holding_review_confirmed')
      expect(confirmed?.actor_type).toBe('user')
      // The SERVER marshals one business finding per business item + records the cognitive acknowledgement.
      const payload = confirmed?.payload as {
        checklist_audit?: { business_findings?: Record<string, string>; cognitive_acknowledged?: boolean }
      }
      expect(Object.keys(payload.checklist_audit?.business_findings ?? {})).toHaveLength(listBusinessItems().length)
      expect(payload.checklist_audit?.cognitive_acknowledged).toBe(true)

      const holding = projectHoldings(events).find((h) => h.holding_id === HOLDING_ID)
      expect(Object.keys(holding?.checklist_audit?.business_findings ?? {})).toHaveLength(listBusinessItems().length)
    } finally {
      store.close()
    }
  })

  it('returns 400 (completion-block) when the cognitive reflection is not acknowledged', async () => {
    await seedHoldingWithDraftReview(ledgerPath)

    // No cognitive ack posted — the server marshals findings but the audit is incomplete.
    const response = await callRoute(new URLSearchParams())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Re-underwrite sign-off requires/),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((event) => event.event_type === 'holding_review_confirmed')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('does not synthesize the cognitive acknowledgement server-side: an unacknowledged sign-off is rejected', async () => {
    await seedHoldingWithDraftReview(ledgerPath)

    const response = await callRoute(new URLSearchParams())
    expect(response.status).toBe(400)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((event) => event.event_type === 'holding_review_confirmed')).toBe(false)
    } finally {
      store.close()
    }
  })
})
