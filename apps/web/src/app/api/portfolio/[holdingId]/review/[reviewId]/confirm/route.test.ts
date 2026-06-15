import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '@owlfolio/workflow/holdingWorkflow'
import { draftHoldingReview } from '@owlfolio/workflow/holdingReviewWorkflow'

import { POST } from './route'

// Phase 7 S3 — the re-underwrite sign-off route gates holding_review_confirmed on the 17-item checklist.

/** Append a fully-addressed per-item checklist (note + addressed) to a form, mirroring the confirm form. */
function appendCompleteChecklist(form: URLSearchParams): void {
  for (const item of CHECKLIST_PARAMS.items) {
    form.set(`checklist_note[${item.id}]`, `Addressed ${item.id} at re-underwrite.`)
    form.set(`checklist_addressed[${item.id}]`, 'on')
  }
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

  it('confirms the re-underwrite, persists the checklist answers, and redirects', async () => {
    await seedHoldingWithDraftReview(ledgerPath)
    const form = new URLSearchParams()
    appendCompleteChecklist(form)

    await expect(callRoute(form)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const confirmed = events.find((event) => event.event_type === 'holding_review_confirmed')
      expect(confirmed?.actor_type).toBe('user')
      const payload = confirmed?.payload as { checklist_answers?: Record<string, { addressed: boolean; note: string }> }
      expect(Object.keys(payload.checklist_answers ?? {})).toHaveLength(CHECKLIST_PARAMS.items.length)

      const holding = projectHoldings(events).find((h) => h.holding_id === HOLDING_ID)
      expect(Object.keys(holding?.checklist_answers ?? {})).toHaveLength(CHECKLIST_PARAMS.items.length)
    } finally {
      store.close()
    }
  })

  it('returns 400 with the unaddressed ids when shariah_drift is unaddressed (completion-block)', async () => {
    await seedHoldingWithDraftReview(ledgerPath)
    const form = new URLSearchParams()
    for (const item of CHECKLIST_PARAMS.items) {
      if (item.id === 'shariah_drift') {
        continue
      }
      form.set(`checklist_note[${item.id}]`, `Addressed ${item.id}.`)
      form.set(`checklist_addressed[${item.id}]`, 'on')
    }

    const response = await callRoute(form)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Re-underwrite sign-off requires.*shariah_drift/),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((event) => event.event_type === 'holding_review_confirmed')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('does not synthesize cognitive answers server-side: an empty checklist is rejected, not auto-filled', async () => {
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
