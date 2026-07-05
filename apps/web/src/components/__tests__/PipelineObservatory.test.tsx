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
    { key: 'quick_screen', label: 'Quick screen', count: 5, health: 'ok' },
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

  it('renders distinct verdict-state badges (TOO-HARD / GATED / WATCH-FAIR) and a red-team step slot', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineObservatory, { pipeline, drillDown, selectedCaseId: 'rc-msft', mode: 'personal-local' }),
    )
    expect(html).toContain('data-verdict-state="TOO-HARD"')
    expect(html).toContain('data-verdict-state="GATED"')
    expect(html).toContain('data-verdict-state="WATCH-FAIR"')
    expect(html).toContain('data-pipeline-step="red_team"')
    expect(html).toContain('Red-team pass')
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
})
