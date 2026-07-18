import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/pipeline',
}))

import { PipelineObservatory } from '../PipelineObservatory'
import type {
  PipelineDrillDown,
  PipelineProjection,
} from '@owlfolio/ledger/projections/pipelineProjection'

const pipeline: PipelineProjection = {
  stage_counts: [
    { key: 'shariah_gate', label: 'Shariah gate', count: 5, health: 'ok' },
    { key: 'deep_dive', label: 'Deep dive · 5 lanes', count: 2, health: 'warn' },
    { key: 'synthesis', label: 'Synthesis', count: 1, health: 'ok' },
    { key: 'decision', label: 'Decision', count: 4, health: 'ok' },
    { key: 'watchlist', label: 'Watchlist', count: 2, health: 'ok' },
    { key: 'holding', label: 'Holding', count: 1, health: 'ok' },
    { key: 'review', label: 'Review', count: 1, health: 'ok' },
  ],
  summary: { active_runs: 1, awaiting_approval: 1, failed_recent: 0, grounded_sources: 8 },
  runs: [
    { research_case_id: 'rc-msft', ticker: 'MSFT', version: 2, stage_label: 'Deep dive (2/5 lanes)', status: 'running', source_count: 8, started_at: '2026-06-08T00:00:06Z', updated_at: '2026-06-08T00:00:06Z' },
    { research_case_id: 'rc-rej', ticker: 'ADULT', version: 1, stage_label: 'Rejected', status: 'rejected', verdict: 'Shariah', source_count: 2, started_at: '2026-06-08T00:00:01Z', updated_at: '2026-06-08T00:00:01Z' },
  ],
}

const drillDown: PipelineDrillDown = {
  research_case_id: 'rc-msft',
  ticker: 'MSFT',
  version: 2,
  status: 'running',
  lanes: [
    { lane: 'business_quality', label: 'Business quality', status: 'done', source_count: 2, duration_ms: 2000 },
    { lane: 'shariah', label: 'Shariah', status: 'running', source_count: 0 },
  ],
  grounded_source_ids: ['mock_msft_primary', 'sec_10k_2025'],
  timeline: [
    { event_type: 'deep_dive_started', label: 'deep_dive_started', at: '2026-06-08T00:00:04Z' },
    { event_type: 'specialist_finding_recorded', label: 'specialist_finding · business_quality', at: '2026-06-08T00:00:06Z' },
  ],
}

describe('the Shariah-gate stage under the screening toggle', () => {
  const pipeline = {
    summary: { discovered: 0, in_research: 0, watchlist: 0, holdings: 0 },
    stage_counts: [
      { key: 'shariah_gate', label: 'Shariah gate', count: 2, health: 'ok' },
      { key: 'decision', label: 'Decision', count: 1, health: 'ok' },
    ],
    runs: [],
  } as never

  it('renders the gate stage as OFF when the mode is off (never an ok/green screen claim)', () => {
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local', shariahEnabled: false }))
    expect(html).toContain('Shariah gate · OFF')
  })

  it('keeps the normal stage when the mode is on', () => {
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local', shariahEnabled: true }))
    expect(html).not.toContain('Shariah gate · OFF')
    expect(html).toContain('Shariah gate')
  })
})

describe('PipelineObservatory', () => {
  it('renders KPIs, flow map, runs table and drill-down', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineObservatory, { pipeline, drillDown, selectedCaseId: 'rc-msft', mode: 'personal-local' }),
    )
    expect(html).toContain('Strategy pipeline observatory')
    expect(html).toContain('Active runs')
    expect(html).toContain('Grounded sources')
    expect(html).toContain('Pipeline flow')
    expect(html).toContain('Deep dive · 5 lanes')
    expect(html).toContain('MSFT')
    expect(html).toContain('running')
    expect(html).toContain('Shariah')
    expect(html).toContain('Specialist lanes')
    expect(html).toContain('mock_msft_primary')
    expect(html).toContain('/pipeline?case=rc-msft')
  })

  it('renders distinct verdict-state badges (TOO-HARD / GATED / WATCH-FAIR) and an inversion step slot', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineObservatory, { pipeline, drillDown, selectedCaseId: 'rc-msft', mode: 'personal-local' }),
    )
    expect(html).toContain('data-verdict-state="TOO-HARD"')
    expect(html).toContain('data-verdict-state="GATED"')
    expect(html).toContain('data-verdict-state="WATCH-FAIR"')
    expect(html).toContain('data-pipeline-step="red_team"')
    expect(html).toContain('Inversion pass')
  })

  it('shows an honest empty state when there are no runs', () => {
    const empty: PipelineProjection = {
      stage_counts: pipeline.stage_counts.map((s) => ({ ...s, count: 0, health: 'ok' })),
      summary: { active_runs: 0, awaiting_approval: 0, failed_recent: 0, grounded_sources: 0 },
      runs: [],
    }
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: empty, mode: 'personal-local' }))
    expect(html).toContain('No research runs yet')
  })

  it('renders the page chrome in Arabic when locale is ar (run data stays as recorded)', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineObservatory, { pipeline, drillDown, selectedCaseId: 'rc-msft', mode: 'personal-local', locale: 'ar' }),
    )
    // Header, stats, and section chrome follow the locale…
    expect(html).toContain('مرصد خط الاستراتيجية')
    expect(html).toContain('تشغيلات نشطة')
    expect(html).toContain('تدفق الخط')
    expect(html).not.toContain('Strategy pipeline observatory')
    expect(html).not.toContain('Active runs')
    // …while projection data (tickers, stage labels) does not.
    expect(html).toContain('MSFT')
    expect(html).toContain('Deep dive · 5 lanes')
  })

  it('renders the Arabic empty-runs message and defaults to English without a locale', () => {
    const empty: PipelineProjection = {
      stage_counts: pipeline.stage_counts.map((s) => ({ ...s, count: 0, health: 'ok' })),
      summary: { active_runs: 0, awaiting_approval: 0, failed_recent: 0, grounded_sources: 0 },
      runs: [],
    }
    const arHtml = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: empty, mode: 'personal-local', locale: 'ar' }))
    expect(arHtml).toContain('لا تشغيلات بحث بعد')
    expect(arHtml).not.toContain('No research runs yet')

    const enHtml = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: empty, mode: 'personal-local' }))
    expect(enHtml).toContain('Strategy pipeline observatory')
    expect(enHtml).toContain('No research runs yet')
  })

  it('labels unresolved failures honestly — no "recent" window exists in the projection', () => {
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local' }))
    expect(html).toContain('Failed (unresolved)')
    expect(html).not.toContain('Failed (recent)')
  })

  it('windows finished runs to 3 days (view-only): old finished hidden with a library note, active and recent finished stay', () => {
    const recentDone = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const windowed: PipelineProjection = {
      ...pipeline,
      runs: [
        ...pipeline.runs,
        { research_case_id: 'rc-fresh', ticker: 'FRSH', version: 1, stage_label: 'Decision drafted', status: 'done', verdict: 'WATCH', source_count: 4, started_at: recentDone, updated_at: recentDone },
      ],
    }
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: windowed, mode: 'personal-local' }))
    // Running stays regardless of age; a fresh finished run stays.
    expect(html).toContain('MSFT')
    expect(html).toContain('FRSH')
    // The old rejected run (2026-06-08) leaves the table — its home is the Research library.
    expect(html).not.toContain('ADULT')
    expect(html).toContain('older finished run')
    expect(html).toContain('href="/research"')
  })

  it('keeps an old finished run visible while it is the selected drill-down target', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineObservatory, { pipeline, mode: 'personal-local', selectedCaseId: 'rc-rej' }),
    )
    expect(html).toContain('ADULT')
  })

  it('mounts the live auto-refresh indicator only while a run is active', () => {
    const liveHtml = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local' }))
    expect(liveHtml).toContain('data-testid="pipeline-live-refresh"')

    const idle: PipelineProjection = {
      ...pipeline,
      summary: { ...pipeline.summary, active_runs: 0 },
      runs: [],
    }
    const idleHtml = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: idle, mode: 'personal-local' }))
    expect(idleHtml).not.toContain('data-testid="pipeline-live-refresh"')
  })

  it('makes failed runs actionable: the ticker links to the dossier and each row carries archive + restart', () => {
    const withFailure: PipelineProjection = {
      ...pipeline,
      failed_runs: [
        { case_id: 'rc-dead', ticker: 'DEAD', failed_at: '2026-07-17T00:00:00Z', error_summary: 'synthesis stage failed after retry' },
      ],
    }
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: withFailure, mode: 'personal-local' }))
    expect(html).toContain('Failed runs')
    expect(html).toContain('href="/research/rc-dead"')
    expect(html).toContain('data-testid="archive-run-button"')
    // Restart = the existing supersession re-run (confirm-gated: it spends a full provider run).
    expect(html).toContain('data-testid="rerun-analysis-button"')
    // A single failure needs no bulk action.
    expect(html).not.toContain('data-testid="archive-all-runs-button"')
  })

  it('offers Archive all when several runs have failed', () => {
    const withFailures: PipelineProjection = {
      ...pipeline,
      failed_runs: [
        { case_id: 'rc-dead-1', ticker: 'AAA', failed_at: '2026-07-17T00:00:00Z', error_summary: 'x' },
        { case_id: 'rc-dead-2', ticker: 'BBB', failed_at: '2026-07-17T01:00:00Z', error_summary: 'y' },
      ],
    }
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline: withFailures, mode: 'personal-local' }))
    expect(html).toContain('data-testid="archive-all-runs-button"')
  })

  it('renders the worker-log diagnostics pane when a tail is provided, collapsed, and not otherwise', () => {
    const withLog = renderToStaticMarkup(createElement(PipelineObservatory, {
      pipeline,
      mode: 'personal-local',
      workerLog: { file: 'process_deep_dive_queue-2026-07-18.log', tail: 'lane moat started\nread_source sec_10k → verified' },
    }))
    expect(withLog).toContain('Worker log')
    expect(withLog).toContain('process_deep_dive_queue-2026-07-18.log')
    expect(withLog).toContain('read_source sec_10k → verified')

    const withoutLog = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local' }))
    expect(withoutLog).not.toContain('Worker log')
  })

  it('collapses the verdict-state legend behind a toggle (the chips stay in the DOM)', () => {
    const html = renderToStaticMarkup(createElement(PipelineObservatory, { pipeline, mode: 'personal-local' }))
    expect(html).toContain('Show the states')
    expect(html).toMatch(/<details[^>]*>[\s\S]*data-verdict-state="TOO-HARD"/)
  })
})
