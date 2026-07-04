import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope, ActorType } from '@owlfolio/ledger/eventEnvelope'
import { projectMonitorAlerts } from '@owlfolio/ledger/projections/monitorAlertProjection'
import { ingestManualSourceBundle } from '@owlfolio/workflow/sourceLedger'
import type { Fundamentals } from '@owlfolio/workflow/secEdgar'

import { defineDefaultScheduledTasks, runScheduledTasks } from '../runtime'

// ---------------------------------------------------------------------------
// Stage C: the `re_review_check` worker task-kind — MANUAL today, scheduler-shaped for the future
// scheduler (one tick, cadence metadata only, nothing loops). Strong triggers spend one grounded
// re-review each (capped per tick); medium/weak triggers are observations with ZERO provider spend;
// BROKEN on a HELD name escalates the existing versioned full re-run; watched/researched BROKEN is
// record-only (the monitor alert is the push surface).
// ---------------------------------------------------------------------------

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`
const PRIOR_10K = 'https://www.sec.gov/Archives/edgar/data/1/prior-10k.htm'
const NEW_8K = 'https://www.sec.gov/Archives/edgar/data/1/new-8k.htm'
const NEW_10Q = 'https://www.sec.gov/Archives/edgar/data/1/new-10q.htm'

const dirs: string[] = []
async function makeSourceLedger(withBundleFor?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-rr-check-'))
  dirs.push(dir)
  const path = join(dir, 'source-ledger')
  if (withBundleFor !== undefined) {
    await ingestManualSourceBundle({
      source_ledger_path: path,
      research_case_id: withBundleFor, ticker: 'COST', strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system', ingested_by_actor_id: 'research_workflow',
      sources: [{ source_id: 's1', kind: 'url', url: PRIOR_10K, content_hash: sha('x'), availability: 'available' }],
    })
  }
  return path
}
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

function ledgerEvent(
  eventType: string, aggregateId: string, payload: Record<string, unknown>, actorType: ActorType = 'provider',
): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_${eventType}_${aggregateId}_${Math.abs(JSON.stringify(payload).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`,
    event_type: eventType,
    aggregate_type: 'research_case',
    aggregate_id: aggregateId,
    correlation_id: aggregateId,
    actor_type: actorType,
    actor_id: actorType === 'user' ? 'user_local' : 'test-provider',
    payload, source_ids: [], created_at: '2026-06-01T00:00:00.000Z', schema_version: 1,
  } as LedgerEventEnvelope<unknown>
}

async function seedDecidedCase(store: InMemoryEventStore<LedgerEventEnvelope<unknown>>, rc: string): Promise<void> {
  await store.append(ledgerEvent('research_case_created', rc, { research_case_id: rc, ticker: 'COST', company_id: 'company_cost', strategy_id: 'buffett-munger' }, 'user'))
  await store.append(ledgerEvent('decision_drafted', rc, { research_case_id: rc, decision: 'WATCH', thesis_summary: 'Membership compounder.', thesis_break_triggers: ['Renewal < 88%'] }))
}

async function appendHolding(store: InMemoryEventStore<LedgerEventEnvelope<unknown>>): Promise<void> {
  await store.append({
    event_id: 'evt_holding_opened_h1', event_type: 'holding_opened',
    aggregate_type: 'holding', aggregate_id: 'h1', correlation_id: 'h1',
    actor_type: 'user', actor_id: 'user_local',
    payload: {
      holding_id: 'h1', watchlist_item_id: 'wl_cost_1', company_id: 'company_cost', ticker: 'COST',
      strategy_id: 'buffett-munger', shares: 10, cost_basis_per_share: 900, currency: 'USD',
      opened_at: '2026-06-01', research_case_id: 'rc_cost_1', thesis_summary: 'Membership compounder.',
    },
    source_ids: [], created_at: '2026-06-01T00:00:00.000Z', schema_version: 1,
  } as LedgerEventEnvelope<unknown>)
}

function fundamentalsWith(recent: { form: string; filed: string; url: string }[]): Fundamentals {
  return {
    cik: '1', entity_name: 'COST', currency: 'USD',
    latest_annual: { fiscal_year: 2025, currency: 'USD' },
    annual_series: [], filings: [], recent_filings: recent,
  } as unknown as Fundamentals
}

const ground = (async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: s.title, url: s.url, excerpt: s.excerpt,
    availability: 'available' as const, fetched_at: 'x', content_hash: sha(s.url),
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as never

function reReviewProvider(assessment: 'INTACT' | 'BROKEN') {
  return {
    provider_id: 'fake-rr',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => ({
      overall_assessment: assessment,
      trigger_assessments: [{ trigger: 'Renewal < 88%', tripped: assessment === 'BROKEN' ? 'yes' : 'no', evidence_citation: 'rr_8k_2026-06-20_0', reasoning: 'r' }],
      changed_dimensions: [],
      ...(assessment === 'BROKEN' ? { broken_claim: 'renewal economics' } : {}),
      narrative: 'n',
      source_ids: ['rr_8k_2026-06-20_0'],
      proposed_sources: [{ source_id: 'rr_8k_2026-06-20_0', title: '8-K', url: NEW_8K, excerpt: 'e' }],
    })),
  }
}

const readiness = {
  provider_id: 'fake-rr', is_ready: true, status_label: 'ready',
  provider_surface_id: 'fake-rr', vendor_id: 'fake', runtime_kind: 'built_in',
  auth_mode: 'built_in_demo', workflow_role: 'scheduled_monitoring_dry_run',
} as never

function runOptions(over: Record<string, unknown>) {
  return {
    as_of: '2026-07-05', dry_run: true, task_kind: 're_review_check',
    provider_readiness: readiness,
    now: () => '2026-07-05T10:00:00.000Z',
    run_id: () => 'run_re_review_check_001',
    ...over,
  } as never
}

describe('re_review_check task', () => {
  it('is defined as a quarterly scheduler-shaped task following thesis_review.enabled', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T10:00:00.000Z' })
    const defined = (await store.list()).filter((e) => e.event_type === 'scheduled_task_defined')
    const reReview = defined.map((e) => e.payload as { task_kind: string; cadence: string; enabled: boolean }).find((p) => p.task_kind === 're_review_check')
    expect(reReview).toBeDefined()
    expect(reReview!.cadence).toBe('0 6 1 */3 *')
  })

  it('STRONG trigger → runs the grounded re-review and records the diff event', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await seedDecidedCase(store, 'rc_cost_1')
    const sourceLedgerPath = await makeSourceLedger('rc_cost_1')
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T09:00:00.000Z' })

    const provider = reReviewProvider('INTACT')
    const result = await runScheduledTasks(store, runOptions({
      provider,
      source_ledger_path: sourceLedgerPath,
      reReview: { ground, fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]) },
    }))
    expect(result).toMatchObject({ completed: 1, failed: 0 })

    const events = await store.list()
    const rr = events.filter((e) => e.event_type === 'research_case_re_review_recorded')
    expect(rr).toHaveLength(1)
    expect((rr[0]!.payload as { assessment: string }).assessment).toBe('INTACT')
    // No escalation on INTACT.
    expect(events.filter((e) => e.event_type === 'research_run_requested')).toHaveLength(0)
  })

  it('MEDIUM-only trigger → observation, ZERO provider spend, no event', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await seedDecidedCase(store, 'rc_cost_1')
    const sourceLedgerPath = await makeSourceLedger('rc_cost_1')
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T09:00:00.000Z' })

    const provider = reReviewProvider('INTACT')
    const result = await runScheduledTasks(store, runOptions({
      provider,
      source_ledger_path: sourceLedgerPath,
      reReview: { ground, fetchFundamentals: async () => fundamentalsWith([{ form: '10-Q', filed: '2026-06-03', url: NEW_10Q }]) },
    }))
    expect(result).toMatchObject({ completed: 1, failed: 0 })
    expect(provider.structured).not.toHaveBeenCalled()
    expect((await store.list()).filter((e) => e.event_type === 'research_case_re_review_recorded')).toHaveLength(0)
  })

  it('BROKEN + HELD → escalates the existing versioned full re-run (re_review_thesis_broken)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await seedDecidedCase(store, 'rc_cost_1')
    await appendHolding(store)
    const sourceLedgerPath = await makeSourceLedger('rc_cost_1')
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T09:00:00.000Z' })

    const result = await runScheduledTasks(store, runOptions({
      provider: reReviewProvider('BROKEN'),
      source_ledger_path: sourceLedgerPath,
      automation: { research_engine_enabled: true },
      reReview: { ground, fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]) },
    }))
    expect(result).toMatchObject({ completed: 1, failed: 0 })

    const events = await store.list()
    const requested = events.filter((e) => e.event_type === 'research_run_requested')
    expect(requested).toHaveLength(1)
    expect(requested[0]!.payload).toMatchObject({
      ticker: 'COST',
      escalation_trigger: 're_review_thesis_broken',
      version: 2,
      supersedes_research_case_id: 'rc_cost_1',
    })
  })

  it('BROKEN + NOT held → record-only (no escalation; the monitor alert is the push surface)', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    await seedDecidedCase(store, 'rc_cost_1')
    const sourceLedgerPath = await makeSourceLedger('rc_cost_1')
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T09:00:00.000Z' })

    await runScheduledTasks(store, runOptions({
      provider: reReviewProvider('BROKEN'),
      source_ledger_path: sourceLedgerPath,
      automation: { research_engine_enabled: true },
      reReview: { ground, fetchFundamentals: async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]) },
    }))
    const events = await store.list()
    expect(events.filter((e) => e.event_type === 'research_case_re_review_recorded')).toHaveLength(1)
    expect(events.filter((e) => e.event_type === 'research_run_requested')).toHaveLength(0)
  })

  it('superseded/archived/thesis-less cases are never selected', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    // Case without a thesis
    await store.append(ledgerEvent('research_case_created', 'rc_nothesis', { research_case_id: 'rc_nothesis', ticker: 'AAA', company_id: 'company_aaa', strategy_id: 'buffett-munger' }, 'user'))
    const sourceLedgerPath = await makeSourceLedger()
    await defineDefaultScheduledTasks(store, { now: () => '2026-07-05T09:00:00.000Z' })

    const fetchFundamentals = vi.fn(async () => fundamentalsWith([{ form: '8-K', filed: '2026-06-20', url: NEW_8K }]))
    const provider = reReviewProvider('INTACT')
    const result = await runScheduledTasks(store, runOptions({
      provider, source_ledger_path: sourceLedgerPath, reReview: { ground, fetchFundamentals },
    }))
    expect(result).toMatchObject({ completed: 1, failed: 0 })
    expect(fetchFundamentals).not.toHaveBeenCalled()
    expect(provider.structured).not.toHaveBeenCalled()
  })
})

describe('monitorAlertProjection thesis_re_review', () => {
  function reReviewEvent(assessment: string): LedgerEventEnvelope<unknown> {
    return ledgerEvent('research_case_re_review_recorded', 'rc_cost_1', {
      re_review_id: `rr_${assessment}`, research_case_id: 'rc_cost_1', ticker: 'COST',
      assessment, trigger_assessments: [], changed_dimensions: [],
      ...(assessment === 'BROKEN' ? { broken_claim: 'renewal economics' } : {}),
      narrative: 'n', prior_thesis_summary: 't',
      new_filings: [{ form: '8-K', filed: '2026-06-20', url: NEW_8K, weight: 'strong' }],
      skipped_filings: [], prior_corpus_size: 1, checked_at: '2026-07-05T00:00:00.000Z',
      reviewed_by_actor_type: 'provider', reviewed_by_actor_id: 'fake-rr',
    })
  }

  it('BROKEN → urgent, WEAKENED → attention, UNVERIFIED → info, INTACT → silent', () => {
    for (const [assessment, severity] of [['BROKEN', 'urgent'], ['WEAKENED', 'attention'], ['UNVERIFIED', 'info']] as const) {
      const alerts = projectMonitorAlerts([reReviewEvent(assessment)])
      const alert = alerts.find((a) => a.kind === 'thesis_re_review')
      expect(alert, assessment).toBeDefined()
      expect(alert!.severity).toBe(severity)
      expect(alert!.human_action.href).toBe('/research/rc_cost_1')
      expect(alert!.is_observation).toBe(true)
    }
    const intact = projectMonitorAlerts([reReviewEvent('INTACT')])
    expect(intact.find((a) => a.kind === 'thesis_re_review')).toBeUndefined()
  })
})
