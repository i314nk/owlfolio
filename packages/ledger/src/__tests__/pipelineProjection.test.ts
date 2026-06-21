import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { buildPipelineDrillDown, projectPipeline } from '../projections/pipelineProjection'

let seq = 0
const evt = (over: Partial<LedgerEventEnvelope<Record<string, unknown>>>): LedgerEventEnvelope<unknown> => {
  seq += 1
  return {
    event_id: `e${seq}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc1',
    actor_type: 'system',
    payload: {},
    source_ids: [],
    created_at: `2026-06-08T00:00:${String(seq).padStart(2, '0')}Z`,
    schema_version: 1,
    ...over,
  } as LedgerEventEnvelope<unknown>
}

describe('projectPipeline — stage counts', () => {
  it('counts cases at each stage and watchlist/holding from their projections', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'qs', event_type: 'research_case_created', payload: { ticker: 'QS' } }),
      evt({ aggregate_id: 'qs', event_type: 'quick_screen_drafted', payload: { research_case_id: 'qs', ticker: 'QS', screening_result: 'continue' } }),

      evt({ aggregate_id: 'dd', event_type: 'research_case_created', payload: { ticker: 'DD' } }),
      evt({ aggregate_id: 'dd', event_type: 'deep_dive_started', payload: { research_case_id: 'dd', ticker: 'DD', deep_dive_id: 'ddid' } }),

      // watchlist item
      evt({ aggregate_id: 'watch1', aggregate_type: 'watchlist_item', event_type: 'watchlist_draft_created', payload: { research_case_id: 'rcw', ticker: 'W', user_approved: false } }),
      evt({ aggregate_id: 'watch1', aggregate_type: 'watchlist_item', event_type: 'watchlist_draft_confirmed', payload: { research_case_id: 'rcw', ticker: 'W' } }),

      // holding
      evt({ aggregate_id: 'hold1', aggregate_type: 'holding', event_type: 'holding_opened', payload: { holding_id: 'hold1', watchlist_item_id: 'watch1', research_case_id: 'rcw', ticker: 'W', shares: 10, cost_basis_per_share: 5 } }),
    ]

    const projection = projectPipeline(events)
    const byKey = Object.fromEntries(projection.stage_counts.map((s) => [s.key, s.count]))
    expect(byKey.quick_screen).toBe(1)
    expect(byKey.deep_dive).toBe(1)
    expect(byKey.watchlist).toBe(1)
    expect(byKey.holding).toBe(1)
  })
})

describe('projectPipeline — run statuses', () => {
  it('derives running, awaiting_approval, rejected and failed', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // running (deep dive started)
      evt({ aggregate_id: 'run', event_type: 'research_case_created', payload: { ticker: 'RUN' } }),
      evt({ aggregate_id: 'run', event_type: 'deep_dive_started', payload: { research_case_id: 'run', ticker: 'RUN', deep_dive_id: 'd1', specialist_lanes: ['business_quality', 'moat'] } }),
      evt({ aggregate_id: 'run', event_type: 'specialist_finding_recorded', payload: { research_case_id: 'run', finding_id: 'f1', specialist_lane: 'business_quality', source_ids: ['s1', 's2'] } }),

      // awaiting approval
      evt({ aggregate_id: 'awa', event_type: 'research_case_created', payload: { ticker: 'AWA' } }),
      evt({ aggregate_id: 'awa', event_type: 'quick_screen_drafted', payload: { research_case_id: 'awa', ticker: 'AWA', screening_result: 'continue' } }),
      evt({ aggregate_id: 'awa', event_type: 'deep_dive_approval_pending', payload: { research_case_id: 'awa' } }),

      // rejected via shariah
      evt({ aggregate_id: 'rej', event_type: 'research_case_created', payload: { ticker: 'REJ' } }),
      evt({ aggregate_id: 'rej', event_type: 'quick_screen_drafted', payload: { research_case_id: 'rej', ticker: 'REJ', screening_result: 'reject', shariah_status: 'rejected' } }),

      // failed run (no recovery)
      evt({ aggregate_id: 'fail', event_type: 'research_run_requested', payload: { research_case_id: 'fail', ticker: 'FAIL' } }),
      evt({ aggregate_id: 'fail', event_type: 'research_run_failed', payload: { research_case_id: 'fail', ticker: 'FAIL' } }),
    ]

    const projection = projectPipeline(events)
    const byTicker = Object.fromEntries(projection.runs.map((r) => [r.ticker, r.status]))
    expect(byTicker.RUN).toBe('running')
    expect(byTicker.AWA).toBe('awaiting_approval')
    expect(byTicker.REJ).toBe('rejected')

    expect(projection.summary.active_runs).toBe(1)
    expect(projection.summary.awaiting_approval).toBe(1)
    expect(projection.summary.failed_recent).toBe(1)
    expect(projection.summary.grounded_sources).toBe(2)

    const rejRun = projection.runs.find((r) => r.ticker === 'REJ')
    expect(rejRun?.verdict).toBe('Shariah')
  })

  it('marks a done run with its verdict', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'done', event_type: 'research_case_created', payload: { ticker: 'DONE' } }),
      evt({ aggregate_id: 'done', event_type: 'decision_drafted', payload: { research_case_id: 'done', decision: 'WATCH' } }),
    ]
    const projection = projectPipeline(events)
    const run = projection.runs.find((r) => r.ticker === 'DONE')
    expect(run?.status).toBe('done')
    expect(run?.verdict).toBe('WATCH')
  })
})

describe('projectPipeline — recovery is order-aware (post-progress failures stay failed)', () => {
  it('keeps a run that progressed and THEN failed as a genuine failure (watchdog-abandoned)', () => {
    // The watchdog auto-fails a run that made progress but stalled. The failure
    // is the LATEST state for the case — it must NOT be masked as "recovered"
    // just because earlier progress events exist for the same case.
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'stall', event_type: 'research_run_requested', payload: { research_case_id: 'stall', ticker: 'STALL' } }),
      evt({ aggregate_id: 'stall', event_type: 'deep_dive_started', payload: { research_case_id: 'stall', ticker: 'STALL', deep_dive_id: 'd1' } }),
      evt({ aggregate_id: 'stall', event_type: 'specialist_finding_recorded', payload: { research_case_id: 'stall', finding_id: 'f1', specialist_lane: 'moat', source_ids: ['s1'] } }),
      evt({ aggregate_id: 'stall', event_type: 'research_run_failed', payload: { research_case_id: 'stall', ticker: 'STALL', error_summary: 'watchdog: abandoned after 300s' } }),
    ]

    const projection = projectPipeline(events)
    expect(projection.summary.failed_recent).toBe(1)
    const failed = projection.failed_runs?.find((r) => r.case_id === 'stall')
    expect(failed).toBeDefined()
    expect(failed?.error_summary).toBe('watchdog: abandoned after 300s')
  })

  it('treats a run that failed and THEN re-ran with progress as recovered (not failed)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'retry', event_type: 'research_run_requested', payload: { research_case_id: 'retry', ticker: 'RETRY' } }),
      evt({ aggregate_id: 'retry', event_type: 'research_run_failed', payload: { research_case_id: 'retry', ticker: 'RETRY', error_summary: 'transient codex stall' } }),
      // re-run made forward progress after the failure → genuinely recovered
      evt({ aggregate_id: 'retry', event_type: 'deep_dive_started', payload: { research_case_id: 'retry', ticker: 'RETRY', deep_dive_id: 'd2' } }),
      evt({ aggregate_id: 'retry', event_type: 'specialist_finding_recorded', payload: { research_case_id: 'retry', finding_id: 'f1', specialist_lane: 'moat', source_ids: ['s1'] } }),
    ]

    const projection = projectPipeline(events)
    expect(projection.summary.failed_recent).toBe(0)
    expect(projection.failed_runs ?? []).toHaveLength(0)
  })

  it('reports the latest failure when a run failed, recovered, then failed again', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'flap', event_type: 'research_run_failed', payload: { research_case_id: 'flap', ticker: 'FLAP', error_summary: 'first failure' } }),
      evt({ aggregate_id: 'flap', event_type: 'deep_dive_started', payload: { research_case_id: 'flap', ticker: 'FLAP', deep_dive_id: 'd1' } }),
      evt({ aggregate_id: 'flap', event_type: 'research_run_failed', payload: { research_case_id: 'flap', ticker: 'FLAP', error_summary: 'second failure' } }),
    ]

    const projection = projectPipeline(events)
    expect(projection.summary.failed_recent).toBe(1)
    expect(projection.failed_runs?.find((r) => r.case_id === 'flap')?.error_summary).toBe('second failure')
  })

  it('treats reaching a terminal decision after a failure as recovered', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'late', event_type: 'research_run_failed', payload: { research_case_id: 'late', ticker: 'LATE', error_summary: 'mid-run stall' } }),
      evt({ aggregate_id: 'late', event_type: 'deep_dive_synthesis_drafted', payload: { research_case_id: 'late', ticker: 'LATE' } }),
      evt({ aggregate_id: 'late', event_type: 'decision_drafted', payload: { research_case_id: 'late', decision: 'WATCH' } }),
    ]

    const projection = projectPipeline(events)
    expect(projection.summary.failed_recent).toBe(0)
  })
})

describe('projectPipeline — a recorded run-failure is discarded from the ACTIVE pipeline', () => {
  it('a failed deep-dive does not count as an active deep-dive (recorded as a fault, run status=failed, not running)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'fd', event_type: 'research_run_requested', payload: { research_case_id: 'fd', ticker: 'FAILDD' } }),
      evt({ aggregate_id: 'fd', event_type: 'research_case_created', payload: { research_case_id: 'fd', ticker: 'FAILDD' } }),
      evt({ aggregate_id: 'fd', event_type: 'deep_dive_started', payload: { research_case_id: 'fd', ticker: 'FAILDD', deep_dive_id: 'd1', specialist_lanes: ['moat'] } }),
      evt({ aggregate_id: 'fd', event_type: 'specialist_finding_recorded', payload: { research_case_id: 'fd', finding_id: 'f1', specialist_lane: 'moat', source_ids: ['s1'] } }),
      evt({ aggregate_id: 'fd', event_type: 'research_run_failed', payload: { research_case_id: 'fd', ticker: 'FAILDD', error_summary: 'watchdog: abandoned' } }),
    ]
    const projection = projectPipeline(events)
    const byKey = Object.fromEntries(projection.stage_counts.map((s) => [s.key, s.count]))
    expect(byKey.deep_dive).toBe(0)            // discarded from the active deep-dive count
    expect(projection.summary.active_runs).toBe(0)
    expect(projection.summary.failed_recent).toBe(1) // but the failure IS recorded
    expect(projection.failed_runs?.some((r) => r.case_id === 'fd')).toBe(true)
    const run = projection.runs.find((r) => r.research_case_id === 'fd')
    expect(run?.status).toBe('failed')         // not 'running'
  })

  it('a failed quick-screen does not count as an active quick-screen', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'fq', event_type: 'research_run_requested', payload: { research_case_id: 'fq', ticker: 'FAILQS' } }),
      evt({ aggregate_id: 'fq', event_type: 'research_case_created', payload: { research_case_id: 'fq', ticker: 'FAILQS' } }),
      evt({ aggregate_id: 'fq', event_type: 'quick_screen_drafted', payload: { research_case_id: 'fq', ticker: 'FAILQS', screening_result: 'continue' } }),
      evt({ aggregate_id: 'fq', event_type: 'research_run_failed', payload: { research_case_id: 'fq', ticker: 'FAILQS', error_summary: 'quick-screen stall' } }),
    ]
    const projection = projectPipeline(events)
    const byKey = Object.fromEntries(projection.stage_counts.map((s) => [s.key, s.count]))
    expect(byKey.quick_screen).toBe(0)
    expect(projection.summary.failed_recent).toBe(1)
    expect(projection.runs.find((r) => r.research_case_id === 'fq')?.status).toBe('failed')
  })

  it('a failed-then-recovered run is active again (order-aware): later progress un-discards it', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'fr', event_type: 'research_case_created', payload: { research_case_id: 'fr', ticker: 'RECOV' } }),
      evt({ aggregate_id: 'fr', event_type: 'deep_dive_started', payload: { research_case_id: 'fr', ticker: 'RECOV', deep_dive_id: 'd1', specialist_lanes: ['moat'] } }),
      evt({ aggregate_id: 'fr', event_type: 'research_run_failed', payload: { research_case_id: 'fr', ticker: 'RECOV', error_summary: 'transient' } }),
      // re-run made forward progress after the failure → genuinely active again
      evt({ aggregate_id: 'fr', event_type: 'deep_dive_started', payload: { research_case_id: 'fr', ticker: 'RECOV', deep_dive_id: 'd2', specialist_lanes: ['moat'] } }),
      evt({ aggregate_id: 'fr', event_type: 'specialist_finding_recorded', payload: { research_case_id: 'fr', finding_id: 'f1', specialist_lane: 'moat', source_ids: ['s1'] } }),
    ]
    const projection = projectPipeline(events)
    const byKey = Object.fromEntries(projection.stage_counts.map((s) => [s.key, s.count]))
    expect(byKey.deep_dive).toBe(1)            // recovered → counted active
    expect(projection.summary.active_runs).toBe(1)
    expect(projection.summary.failed_recent).toBe(0)
    expect(projection.runs.find((r) => r.research_case_id === 'fr')?.status).toBe('running')
  })
})

describe('buildPipelineDrillDown — lane statuses + timeline ordering', () => {
  it('marks recorded lanes done with timing, expected-not-recorded running while live', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'dd', event_type: 'research_case_created', created_at: '2026-06-08T00:00:00Z', payload: { ticker: 'MSFT' } }),
      evt({ aggregate_id: 'dd', event_type: 'quick_screen_drafted', created_at: '2026-06-08T00:00:03Z', payload: { research_case_id: 'dd', ticker: 'MSFT', screening_result: 'continue' } }),
      evt({ aggregate_id: 'dd', event_type: 'deep_dive_started', created_at: '2026-06-08T00:00:04Z', payload: { research_case_id: 'dd', deep_dive_id: 'd1', specialist_lanes: ['business_quality', 'moat', 'shariah'] } }),
      evt({ aggregate_id: 'dd', event_type: 'specialist_finding_recorded', created_at: '2026-06-08T00:00:06Z', payload: { research_case_id: 'dd', finding_id: 'f1', specialist_lane: 'business_quality', source_ids: ['s1', 's2'] } }),
      evt({ aggregate_id: 'dd', event_type: 'specialist_finding_recorded', created_at: '2026-06-08T00:00:07Z', payload: { research_case_id: 'dd', finding_id: 'f2', specialist_lane: 'moat', source_ids: ['s3'] } }),
    ]

    const drill = buildPipelineDrillDown(events, 'dd')
    expect(drill).toBeDefined()
    const laneStatus = Object.fromEntries(drill!.lanes.map((l) => [l.lane, l.status]))
    expect(laneStatus.business_quality).toBe('done')
    expect(laneStatus.moat).toBe('done')
    expect(laneStatus.shariah).toBe('running')

    const bq = drill!.lanes.find((l) => l.lane === 'business_quality')
    expect(bq?.source_count).toBe(2)
    expect(bq?.duration_ms).toBe(2000)

    // timeline is ordered by ts ascending and includes the swarm events
    expect(drill!.timeline.map((t) => t.event_type)).toEqual([
      'quick_screen_drafted',
      'deep_dive_started',
      'specialist_finding_recorded',
      'specialist_finding_recorded',
    ])
    expect(drill!.grounded_source_ids).toEqual(['s1', 's2', 's3'])
    expect(drill!.status).toBe('running')
  })

  it('marks lanes pending when no deep dive has started', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'qs', event_type: 'research_case_created', payload: { ticker: 'QS' } }),
      evt({ aggregate_id: 'qs', event_type: 'quick_screen_drafted', payload: { research_case_id: 'qs', ticker: 'QS', screening_result: 'continue' } }),
    ]
    const drill = buildPipelineDrillDown(events, 'qs')
    expect(drill?.lanes.every((l) => l.status === 'pending')).toBe(true)
  })

  it('a failed run drills down as failed with no live-running lanes', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({ aggregate_id: 'fd', event_type: 'research_case_created', payload: { research_case_id: 'fd', ticker: 'FAILDD' } }),
      evt({ aggregate_id: 'fd', event_type: 'deep_dive_started', payload: { research_case_id: 'fd', ticker: 'FAILDD', deep_dive_id: 'd1', specialist_lanes: ['moat', 'risks'] } }),
      evt({ aggregate_id: 'fd', event_type: 'research_run_failed', payload: { research_case_id: 'fd', ticker: 'FAILDD', error_summary: 'abandoned' } }),
    ]
    const drill = buildPipelineDrillDown(events, 'fd')
    expect(drill?.status).toBe('failed')
    // lanes are NOT shown as live-running once the run has failed (consistent with the active view)
    expect(drill?.lanes.some((l) => l.status === 'running')).toBe(false)
  })
})
