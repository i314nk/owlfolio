import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { createResearchCase } from '@owlfolio/workflow'

import { GET } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const SOURCE_IDS = ['src_a', 'src_b']

async function createCase(ledgerPath: string, rc: string): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
    })
  } finally {
    store.close()
  }
}

/** Append N specialist_finding_recorded events → an in-flight deep dive at N/5. */
async function recordFindings(ledgerPath: string, rc: string, count: number): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    for (let index = 0; index < count; index += 1) {
      await store.append({
        event_id: `evt_specialist_finding_recorded_${rc}_${index}`,
        event_type: 'specialist_finding_recorded',
        aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
        actor_type: 'provider', actor_id: 'mock-provider',
        payload: { research_case_id: rc, finding_id: `finding_${index}`, specialist_lane: `lane_${index}` },
        source_ids: SOURCE_IDS,
        created_at: new Date().toISOString(), schema_version: 1,
      })
    }
  } finally {
    store.close()
  }
}

/** Drive the case to a terminal stage via the analysis-drafted event. */
async function draftAnalysis(ledgerPath: string, rc: string): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${rc}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
      actor_type: 'provider', actor_id: 'mock-provider',
      payload: {
        research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
        investment_verdict: 'WATCH',
        valuation: { moat_class: 'wide', moat_passes_gate: true, buy_price_per_share: 42 },
      },
      source_ids: SOURCE_IDS,
      created_at: new Date().toISOString(), schema_version: 1,
    })
  } finally {
    store.close()
  }
}

async function recordRunFailed(ledgerPath: string, rc: string): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await store.append({
      event_id: `evt_research_run_failed_${rc}`,
      event_type: 'research_run_failed',
      aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
      actor_type: 'worker', actor_id: 'worker_local',
      payload: { research_case_id: rc, error_summary: 'provider unavailable' },
      source_ids: [],
      created_at: new Date().toISOString(), schema_version: 1,
    })
  } finally {
    store.close()
  }
}

function callRoute(caseId: string) {
  return GET(
    new Request(`http://localhost/api/research/${caseId}/status`),
    { params: Promise.resolve({ caseId }) },
  )
}

type StatusBody = {
  stage?: string
  currentStage: string
  inProgress: boolean
  failed: boolean
  awaitingApproval: boolean
  lanes: { completed: number; total: number }
  label?: string
}

describe('/api/research/[caseId]/status', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-status-route-'))
    const appConfigPath = join(tempDir, 'app-config.json')
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
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('an in-progress deep dive → inProgress true with the right stage + lane count', async () => {
    const rc = 'rc_status_inflight'
    await createCase(ledgerPath, rc)
    await recordFindings(ledgerPath, rc, 3)

    const res = await callRoute(rc)
    expect(res.status).toBe(200)
    const body = (await res.json()) as StatusBody
    expect(body.inProgress).toBe(true)
    expect(body.failed).toBe(false)
    expect(body.currentStage).toBe('deep_dive')
    expect(body.lanes).toEqual({ completed: 3, total: 3 })
    expect(body.label).toBe('Deep dive — 3/3 specialists')
    expect(body.stage).toBe('specialist_finding_recorded')
  })

  it('a terminal case → inProgress false', async () => {
    const rc = 'rc_status_terminal'
    await createCase(ledgerPath, rc)
    await draftAnalysis(ledgerPath, rc)

    const res = await callRoute(rc)
    expect(res.status).toBe(200)
    const body = (await res.json()) as StatusBody
    expect(body.inProgress).toBe(false)
    expect(body.currentStage).toBe('done')
  })

  it('unknown case → 404', async () => {
    const res = await callRoute('rc_does_not_exist')
    expect(res.status).toBe(404)
  })

  it('a failed run (no case row) → 200 with failed true', async () => {
    const rc = 'rc_status_failed'
    await recordRunFailed(ledgerPath, rc)

    const res = await callRoute(rc)
    expect(res.status).toBe(200)
    const body = (await res.json()) as StatusBody
    expect(body.failed).toBe(true)
    expect(body.inProgress).toBe(false)
  })

  it('a promoted case with no run requested → 200 with inProgress false + notStarted true', async () => {
    // Seed a case (research_case_created) but do NOT append any research_run_requested event.
    const rc = 'rc_status_not_started'
    await createCase(ledgerPath, rc)

    const res = await callRoute(rc)
    expect(res.status).toBe(200)
    const body = (await res.json()) as StatusBody & { notStarted?: boolean }
    expect(body.inProgress).toBe(false)
    expect(body.failed).toBe(false)
    expect(body.notStarted).toBe(true)
    expect(body.currentStage).toBe('not_started')
  })
})
