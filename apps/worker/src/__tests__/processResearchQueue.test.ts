import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import type { GroundFn } from '@owlfolio/workflow/researchSwarm'
import { runProcessResearchQueueTask, reapAbandonedResearchRuns } from '../runtime'

describe('runProcessResearchQueueTask', () => {
  it('claims a pending request and runs the swarm to a decision', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc1', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc1', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc1', ticker: 'TEST', company_id: 'company_test', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd1' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research',
      now: () => new Date('2026-06-08T00:00:00Z'),
    })

    const types = (await store.list()).map((e) => e.event_type)
    expect(types).toContain('research_run_claimed')
    expect(types).toContain('decision_drafted')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('records a research_run_failed event and continues without throwing when the swarm fails the grounding gate', async () => {
    // Inject a ground function that always returns empty captures, forcing the
    // swarm's quick-screen fail-closed (no verified sources → no decision_drafted).
    const failingGround: GroundFn = async () => ({ captured: [], verified_ids: [] })

    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc_fail', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc_fail', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc_fail', ticker: 'FAIL', company_id: 'company_fail', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd_fail' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    // Must not throw — one failed run must not abort the loop.
    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research-fail',
      ground: failingGround,
      now: () => new Date('2026-06-08T01:00:00Z'),
    })

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // The run was claimed before the swarm ran.
    expect(types).toContain('research_run_claimed')
    // A durable failure record must exist.
    expect(types).toContain('research_run_failed')
    // No decision was produced — the swarm failed before drafting one.
    expect(types).not.toContain('decision_drafted')
    // Failure count reflects the one failed run.
    expect(result.failed).toBe(1)
    // processed counts all claimed runs including failed ones.
    expect(result.processed).toBe(1)
  })

  it('fails closed (research_run_failed, zero findings) when the request expects a different provider/mode than the loaded config', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc_mismatch', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc_mismatch', actor_type: 'user', actor_id: 'user_local',
      payload: {
        research_case_id: 'rc_mismatch', ticker: 'MISMATCH', company_id: 'company_mismatch',
        strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd_mismatch',
        expected_provider_id: 'openai', expected_mode: 'personal-local',
      },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      // Loaded config is the deterministic mock/demo path — does NOT match the request's expectation.
      provider: new MockProvider(),
      loaded_provider_id: 'mock-provider',
      loaded_mode: 'unconfigured',
      config_path: '/tmp/owlfolio-worker-research-mismatch/app-config.json',
      source_ledger_path: '/tmp/owlfolio-worker-research-mismatch',
      now: () => new Date('2026-06-08T02:00:00Z'),
    })

    const events = await store.list()
    const types = events.map((e) => e.event_type)

    // A durable, legible failure record must exist.
    expect(types).toContain('research_run_failed')
    const failed = events.find((e) => e.event_type === 'research_run_failed')
    expect(String((failed?.payload as Record<string, unknown>).error_summary)).toContain('openai')
    expect(String((failed?.payload as Record<string, unknown>).error_summary)).toContain('mock-provider')

    // ZERO swarm findings/analysis must be emitted — no mock/demo dossier produced.
    expect(types).not.toContain('quick_screen_drafted')
    expect(types).not.toContain('specialist_finding_recorded')
    expect(types).not.toContain('buffett_munger_analysis_drafted')
    expect(types).not.toContain('decision_drafted')

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(1)
  })

  it('runs the swarm normally when the request expectation matches the loaded config', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc_match', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc_match', actor_type: 'user', actor_id: 'user_local',
      payload: {
        research_case_id: 'rc_match', ticker: 'MATCH', company_id: 'company_match',
        strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd_match',
        expected_provider_id: 'mock-provider', expected_mode: 'personal-local',
      },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      loaded_provider_id: 'mock-provider',
      loaded_mode: 'personal-local',
      config_path: __filename, // an existing path on disk
      source_ledger_path: '/tmp/owlfolio-worker-research-match',
      now: () => new Date('2026-06-08T00:00:00Z'),
    })

    const types = (await store.list()).map((e) => e.event_type)
    expect(types).toContain('research_run_claimed')
    expect(types).toContain('decision_drafted')
    expect(types).not.toContain('research_run_failed')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('runs the swarm for legacy requests with no expected_provider_id/expected_mode (backward-compat)', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc_legacy', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc_legacy', actor_type: 'user', actor_id: 'user_local',
      // No expected_provider_id / expected_mode — legacy ledger request.
      payload: { research_case_id: 'rc_legacy', ticker: 'LEGACY', company_id: 'company_legacy', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd_legacy' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      // Even though loaded provider/mode differ, a legacy request without an expectation must still run.
      loaded_provider_id: 'mock-provider',
      loaded_mode: 'unconfigured',
      config_path: __filename,
      source_ledger_path: '/tmp/owlfolio-worker-research-legacy',
      now: () => new Date('2026-06-08T00:00:00Z'),
    })

    const types = (await store.list()).map((e) => e.event_type)
    expect(types).toContain('research_run_claimed')
    expect(types).toContain('decision_drafted')
    expect(types).not.toContain('research_run_failed')
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
  })
})

describe('reapAbandonedResearchRuns (run watchdog)', () => {
  // A case stuck mid-run: deep_dive_started but no terminal event, and the worker died (no new events).
  async function seedAbandonedCase() {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_created_rc_stuck', event_type: 'research_case_created', aggregate_type: 'research_case',
      aggregate_id: 'rc_stuck', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc_stuck', ticker: 'STUCK', company_id: 'company_stuck', strategy_id: 'buffett-munger' },
      source_ids: [], created_at: '2026-06-08T00:00:00.000Z', schema_version: 1,
    } as never)
    await store.append({
      event_id: 'evt_dd_started_rc_stuck', event_type: 'deep_dive_started', aggregate_type: 'research_case',
      aggregate_id: 'rc_stuck', actor_type: 'worker', actor_id: 'owlfolio-worker',
      payload: { research_case_id: 'rc_stuck', deep_dive_id: 'dd_rc_stuck' },
      source_ids: [], created_at: '2026-06-08T00:30:00.000Z', schema_version: 1,
    } as never)
    return store
  }

  it('appends exactly one research_run_failed with a reason (minute count) for a stale in-flight case', async () => {
    const store = await seedAbandonedCase()
    // 90 min after the last event, well beyond the 25 min default staleness window.
    const result = await reapAbandonedResearchRuns(store, { now: () => new Date('2026-06-08T02:00:00.000Z') })

    expect(result.failed).toBe(1)
    const failures = (await store.list()).filter((e) => e.event_type === 'research_run_failed')
    expect(failures).toHaveLength(1)
    const payload = failures[0]?.payload as Record<string, unknown>
    expect(payload.research_case_id).toBe('rc_stuck')
    expect(payload.run_id).toBe('run_rc_stuck')
    expect(payload.ticker).toBe('STUCK')
    const reason = String(payload.error_summary)
    expect(reason).toContain('90 minutes')
    expect(reason).toContain('worker likely terminated mid-run')
    expect(reason).toContain('Re-run to retry')
  })

  it('is idempotent — running the reaper twice does NOT append a second failure', async () => {
    const store = await seedAbandonedCase()
    await reapAbandonedResearchRuns(store, { now: () => new Date('2026-06-08T02:00:00.000Z') })
    const second = await reapAbandonedResearchRuns(store, { now: () => new Date('2026-06-08T03:00:00.000Z') })

    // The first reap recorded a research_run_failed, so the detector now treats the case as terminal
    // (no double-report) — the second reap finds nothing to fail.
    expect(second.failed).toBe(0)
    const failures = (await store.list()).filter((e) => e.event_type === 'research_run_failed')
    expect(failures).toHaveLength(1)
  })

  it('runProcessResearchQueueTask runs the reaper at the start of the tick', async () => {
    const store = await seedAbandonedCase()
    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research-watchdog',
      now: () => new Date('2026-06-08T02:00:00.000Z'),
    })

    const failures = (await store.list()).filter((e) => e.event_type === 'research_run_failed')
    expect(failures).toHaveLength(1)
    expect(String((failures[0]?.payload as Record<string, unknown>).error_summary)).toContain('90 minutes')
    // The reaped failure is reflected in the tick result.
    expect(result.failed).toBeGreaterThanOrEqual(1)
  })
})
