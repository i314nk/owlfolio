import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { listBusinessItems } from '@owlfolio/strategies/checklistParams'
import { createResearchCase, draftDecision } from '@owlfolio/workflow'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const SOURCE_IDS = ['src_adbe_10k_2025', 'src_adbe_proxy_2025', 'src_adbe_q2_2026']

/** Seed a Shariah-compliant ADBE research case that has reached decision_drafted (WATCH). */
async function seedCompletedAdbeCase(ledgerPath: string): Promise<string> {
  const researchCaseId = 'rc_adbe_route_test'
  const decisionId = 'decision_adbe_route_test'
  const store = new SQLiteEventStore(ledgerPath)
  try {
    const created = await createResearchCase(store, {
      research_case_id: researchCaseId,
      company_id: 'company_adbe',
      ticker: 'ADBE',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${researchCaseId}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: 'mock-provider',
      payload: {
        research_case_id: researchCaseId,
        company_id: 'company_adbe',
        ticker: 'ADBE',
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        shariah_status: 'COMPLIANT',
        valuation_status: 'FAIR',
        next_required_action: 'Monitor for a wider margin of safety.',
        thesis_summary: 'Adobe is a wide-moat software franchise worth watching.',
        evidence_summary: 'Source records cover the latest annual report and recent quarterly momentum.',
        valuation_rationale: 'Quality at fair value; conditional margin of safety.',
        shariah_rationale: 'Core activity is software; sector compliant.',
        risks: ['AI disruption risk'],
        open_questions: ['Is AI revenue incremental?'],
      },
      source_ids: SOURCE_IDS,
      created_at: new Date().toISOString(),
      schema_version: 1,
    })
    await draftDecision(store, {
      research_case_id: researchCaseId,
      decision_id: decisionId,
      decision: 'WATCH',
      reason: 'Durable quality business at a fair valuation; watch for a wider margin of safety.',
      causation_id: created.event_id,
      source_ids: SOURCE_IDS,
    })
  } finally {
    store.close()
  }
  return researchCaseId
}

describe('/api/research/[caseId]/watchlist', () => {
  let tempDir: string
  let appConfigPath: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-route-'))
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

  // The human-typed signed thesis is REQUIRED on this path (Task 4.3) — there is no auto-fallback to the
  // agent draft — so the route is posted with a form-encoded signed_thesis like the real admit control.
  const HUMAN_SIGNED_THESIS = 'I am admitting ADBE: wide-moat franchise, low permanent-loss risk, fair-to-cheap.'

  // Audit-and-decide: the human posts only the final signed thesis + the SINGLE cognitive acknowledgement.
  // No per-item findings are posted — the server marshals them at sign-off.
  function callRoute(caseId: string, signedThesis: string = HUMAN_SIGNED_THESIS, acknowledged = true) {
    const form = new URLSearchParams()
    form.set('signed_thesis', signedThesis)
    if (acknowledged) {
      form.set('cognitive_reflection_acknowledged', 'on')
    }
    return POST(new Request(`http://localhost/api/research/${caseId}/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }), {
      params: Promise.resolve({ caseId }),
    })
  }

  it('appends a user-authored watchlist draft linked to the research case and redirects', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    // redirect() throws a NEXT_REDIRECT control-flow error; treat that as the success signal.
    await expect(callRoute(caseId)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const draftEvents = events.filter((event) => event.event_type === 'watchlist_draft_created')
      expect(draftEvents).toHaveLength(1)
      expect(draftEvents[0]?.actor_type).toBe('user')
      // The signed thesis is the human's typed text passed through — never the agent thesis_summary.
      const payload = draftEvents[0]?.payload as Record<string, unknown> | undefined
      expect(payload?.['signed_thesis']).toBe(HUMAN_SIGNED_THESIS)
      expect(payload?.['signed_thesis']).not.toBe(payload?.['thesis_summary'])

      // Phase 8 S4: the single gated promote emits the confirmation atomically alongside the draft.
      expect(events.filter((event) => event.event_type === 'watchlist_draft_confirmed')).toHaveLength(1)
      const watchlist = projectWatchlist(events)
      expect(watchlist).toHaveLength(1)
      expect(watchlist[0]).toMatchObject({
        research_case_id: caseId,
        ticker: 'ADBE',
        // Lands user-confirmed in one gated step (no separate confirm action remains).
        user_approved: true,
        created_by_actor_type: 'user',
        confirmed_by_actor_type: 'user',
      })
      // The watchlist item links back to the case so the monitors (buy-window etc.) can work on it.
      expect(watchlist[0]?.watchlist_item_id).toBe(`watch_${caseId.replace(/^rc_/, '')}`)
    } finally {
      store.close()
    }
  })

  it('is idempotent: POSTing twice converges to a single watchlist item', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    await expect(callRoute(caseId)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    await expect(callRoute(caseId)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.filter((event) => event.event_type === 'watchlist_draft_created')).toHaveLength(1)
      expect(projectWatchlist(events)).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it('rejects an admit with no human-typed thesis (no auto-fallback to the agent summary)', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    const response = await callRoute(caseId, '   ')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/human-signed thesis is required/),
    })

    // No watchlist draft was created — the rubber-stamp path is closed.
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('marshals the business findings server-side and persists the audit (auditable) with affirm provenance', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    await expect(callRoute(caseId)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const draft = events.find((event) => event.event_type === 'watchlist_draft_created')
      const payload = draft?.payload as {
        checklist_audit?: { version: string; business_findings: Record<string, string>; cognitive_acknowledged: boolean }
        signed_thesis_draft?: string
        thesis_amended?: boolean
      }
      // The server marshaled one finding per BUSINESS item — the human never posted them.
      expect(Object.keys(payload.checklist_audit?.business_findings ?? {})).toHaveLength(listBusinessItems().length)
      expect(payload.checklist_audit?.cognitive_acknowledged).toBe(true)
      // The human typed a thesis DISTINCT from the agent draft, so it's recorded as an amendment.
      expect(payload.signed_thesis_draft).toBeTruthy()
      expect(payload.thesis_amended).toBe(true)

      const [item] = projectWatchlist(events)
      expect(Object.keys(item?.checklist_audit?.business_findings ?? {})).toHaveLength(listBusinessItems().length)
    } finally {
      store.close()
    }
  })

  it('records an AFFIRM (thesis_amended=false) when the human signs the agent draft verbatim', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    // The seeded case has reason "Durable quality business..."; the agent draft thesis is `Watch ADBE: <reason>`.
    const agentDraft = 'Watch ADBE: Durable quality business at a fair valuation; watch for a wider margin of safety.'
    await expect(callRoute(caseId, agentDraft)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const draft = (await store.list()).find((event) => event.event_type === 'watchlist_draft_created')
      const payload = draft?.payload as { thesis_amended?: boolean; signed_thesis?: string; signed_thesis_draft?: string }
      expect(payload.signed_thesis).toBe(payload.signed_thesis_draft)
      expect(payload.thesis_amended).toBe(false)
    } finally {
      store.close()
    }
  })

  it('returns 400 when the single cognitive acknowledgement is missing (completion-block)', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    const response = await callRoute(caseId, HUMAN_SIGNED_THESIS, false)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/complete audit.*cognitive_acknowledgement/),
    })

    // No draft was appended — the completion-block closed the path.
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('succeeds with ZERO business free-text posted: the server marshals findings, the human only acks', async () => {
    const caseId = await seedCompletedAdbeCase(ledgerPath)

    // Post ONLY the thesis + the single ack — no business findings at all (acceptance gate §6.2).
    const form = new URLSearchParams()
    form.set('signed_thesis', HUMAN_SIGNED_THESIS)
    form.set('cognitive_reflection_acknowledged', 'on')
    await expect(POST(new Request(`http://localhost/api/research/${caseId}/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }), { params: Promise.resolve({ caseId }) })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const draft = events.find((event) => event.event_type === 'watchlist_draft_created')
      const payload = draft?.payload as { checklist_audit?: { business_findings: Record<string, string> } }
      // The findings were marshaled server-side even though the client posted none.
      expect(Object.keys(payload.checklist_audit?.business_findings ?? {})).toHaveLength(listBusinessItems().length)
    } finally {
      store.close()
    }
  })

  it('returns 404 when the research case does not exist', async () => {
    const response = await callRoute('rc_does_not_exist')
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Unknown research case/),
    })
  })
})
