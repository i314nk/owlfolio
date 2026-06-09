import { createElement, type CSSProperties, type ReactNode } from 'react'

import { OwlKpiStat } from './designSystem'
import type {
  PipelineDrillDown,
  PipelineLane,
  PipelineLaneStatus,
  PipelineProjection,
  PipelineRun,
  PipelineRunStatus,
  PipelineStageCount,
  PipelineStageHealth,
} from '@owlfolio/ledger/projections/pipelineProjection'
import type { WorkflowMode } from '../lib/workflow'

export type PipelineObservatoryProps = {
  pipeline: PipelineProjection
  drillDown?: PipelineDrillDown
  selectedCaseId?: string
  mode: WorkflowMode
}

const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  padding: '1.15rem 1.3rem',
  boxShadow: 'var(--owl-shadow-panel)',
}

const monoLabel: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-quiet)',
}

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  margin: '1.3rem 0 0.5rem',
}

const HEALTH_DOT_COLOR: Record<PipelineStageHealth, string> = {
  ok: 'var(--owl-color-accent-bright)',
  warn: 'var(--owl-color-amber)',
  err: 'var(--owl-color-risk)',
}

const LANE_DOT_COLOR: Record<PipelineLaneStatus, string> = {
  done: 'var(--owl-color-accent-bright)',
  running: 'var(--owl-color-amber)',
  pending: 'var(--owl-color-quiet)',
}

const RUN_CHIP: Record<PipelineRunStatus, { bg: string; border: string; color: string; label: string }> = {
  running: { bg: 'rgba(240,180,41,0.12)', border: 'rgba(240,180,41,0.34)', color: '#f6d990', label: 'running' },
  awaiting_approval: { bg: 'rgba(214,178,94,0.12)', border: 'rgba(214,178,94,0.34)', color: '#f0d999', label: 'awaiting deep-dive approval' },
  done: { bg: 'rgba(34,197,94,0.13)', border: 'var(--owl-color-border-strong)', color: '#bbf7d0', label: 'done' },
  rejected: { bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.4)', color: '#fca5a5', label: 'rejected' },
  failed: { bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.4)', color: '#fca5a5', label: 'failed' },
}

function statusDot(color: string, size = '0.5rem'): ReactNode {
  return createElement('span', {
    'aria-hidden': 'true',
    style: {
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      marginRight: '0.4rem',
    },
  })
}

function runChip(run: PipelineRun): ReactNode {
  const chip = RUN_CHIP[run.status]
  const label = run.verdict !== undefined && run.verdict.length > 0
    ? `${chip.label} · ${run.verdict}`
    : chip.label
  return createElement(
    'span',
    {
      role: 'status',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.55rem',
        borderRadius: '999px',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        background: chip.bg,
        border: `1px solid ${chip.border}`,
        color: chip.color,
      },
    },
    label,
  )
}

function StageFlowMap({ stages }: { stages: PipelineStageCount[] }): ReactNode {
  const nodes: ReactNode[] = []
  stages.forEach((stage, index) => {
    nodes.push(
      createElement(
        'div',
        {
          key: stage.key,
          'aria-label': `${stage.label}: ${stage.count}`,
          style: {
            flex: 1,
            minWidth: '120px',
            background: 'var(--owl-color-panel-elevated)',
            border: `1px solid ${stage.health === 'warn' ? 'var(--owl-color-border-strong)' : 'var(--owl-color-border)'}`,
            borderRadius: '0.7rem',
            padding: '0.7rem 0.75rem',
            position: 'relative',
          },
        },
        statusDot(HEALTH_DOT_COLOR[stage.health]),
        createElement('div', { style: { ...monoLabel, color: 'var(--owl-color-muted)' } }, stage.label),
        createElement(
          'div',
          {
            style: {
              fontSize: 'var(--owl-text-lg)',
              fontWeight: 800,
              marginTop: '0.2rem',
              fontVariantNumeric: 'tabular-nums',
              color: stage.health === 'err'
                ? 'var(--owl-color-risk)'
                : stage.health === 'warn'
                  ? 'var(--owl-color-amber)'
                  : 'var(--owl-color-gold-bright)',
            },
          },
          String(stage.count),
        ),
      ),
    )
    if (index < stages.length - 1) {
      nodes.push(
        createElement(
          'div',
          { key: `arrow-${stage.key}`, 'aria-hidden': 'true', style: { alignSelf: 'center', color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-md)' } },
          '→',
        ),
      )
    }
  })

  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'stretch',
        gap: '0.4rem',
        overflowX: 'auto',
        padding: '0.3rem 0 0.5rem',
      },
    },
    ...nodes,
  )
}

function RunsTable({ runs, selectedCaseId }: { runs: PipelineRun[]; selectedCaseId?: string }): ReactNode {
  if (runs.length === 0) {
    return createElement(
      'div',
      { style: { ...cardStyle, color: 'var(--owl-color-muted)' } },
      'No research runs yet — enqueue a research run to populate the swarm pipeline.',
    )
  }

  const thStyle: CSSProperties = {
    textAlign: 'left',
    ...monoLabel,
    padding: '0.5rem 0.6rem',
    borderBottom: '1px solid var(--owl-color-border)',
  }
  const tdStyle: CSSProperties = {
    padding: '0.6rem 0.6rem',
    borderBottom: '1px solid rgba(182,201,173,0.08)',
  }

  return createElement(
    'div',
    { style: { ...cardStyle, padding: '0.4rem 0.6rem' } },
    createElement(
      'table',
      { style: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--owl-text-base)' } },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          ...['Ticker', 'Ver', 'Stage', 'Status', 'Sources'].map((heading) =>
            createElement('th', { key: heading, style: thStyle }, heading),
          ),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...runs.map((run) => {
          const isSelected = run.research_case_id === selectedCaseId
          return createElement(
            'tr',
            {
              key: run.research_case_id,
              ...(isSelected ? { 'aria-current': 'true' } : {}),
              style: isSelected ? { background: 'rgba(214,178,94,0.07)' } : undefined,
            },
            createElement(
              'td',
              { style: tdStyle },
              createElement(
                'a',
                {
                  className: 'owl-focusable',
                  href: `/pipeline?case=${encodeURIComponent(run.research_case_id)}`,
                  style: { fontWeight: 800, color: 'var(--owl-color-gold-bright)', textDecoration: 'none' },
                },
                run.ticker,
              ),
            ),
            createElement('td', { style: tdStyle }, `v${run.version}`),
            createElement('td', { style: tdStyle }, run.stage_label),
            createElement('td', { style: tdStyle }, runChip(run)),
            createElement('td', { style: tdStyle }, String(run.source_count)),
          )
        }),
      ),
    ),
  )
}

function laneMeta(lane: PipelineLane): string {
  if (lane.status === 'done') {
    const seconds = lane.duration_ms !== undefined ? ` · ${(lane.duration_ms / 1000).toFixed(1)}s` : ''
    return `${lane.source_count} src${seconds}`
  }
  if (lane.status === 'running') {
    return 'running…'
  }
  return 'queued'
}

function DrillDown({ drillDown }: { drillDown: PipelineDrillDown }): ReactNode {
  const laneCards = drillDown.lanes.map((lane) =>
    createElement(
      'div',
      {
        key: lane.lane,
        style: {
          background: 'var(--owl-color-panel-elevated)',
          border: '1px solid var(--owl-color-border)',
          borderRadius: '0.6rem',
          padding: '0.55rem 0.7rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
      createElement(
        'span',
        { style: { fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', textTransform: 'uppercase', letterSpacing: '0.04em' } },
        statusDot(LANE_DOT_COLOR[lane.status]),
        lane.label,
      ),
      createElement('span', { style: { fontSize: 'var(--owl-text-2xs)', color: 'var(--owl-color-quiet)' } }, laneMeta(lane)),
    ),
  )

  const sourceText = drillDown.grounded_source_ids.length === 0
    ? 'No grounded sources recorded yet.'
    : `${drillDown.grounded_source_ids.join(' · ')} (sha-256 verified, replayable)`

  return createElement(
    'div',
    { style: cardStyle },
    createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 0.9fr)', gap: '1rem' } },
      createElement(
        'div',
        null,
        createElement('p', { style: { ...monoLabel, color: 'var(--owl-color-gold)', fontWeight: 800, marginBottom: '0.5rem' } }, 'Specialist lanes'),
        createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.55rem' } },
          ...laneCards,
        ),
        createElement(
          'p',
          { style: { ...monoLabel, color: 'var(--owl-color-gold)', fontWeight: 800, margin: '0.9rem 0 0.4rem' } },
          `Grounded sources (${drillDown.grounded_source_ids.length})`,
        ),
        createElement('div', { style: { fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', color: 'var(--owl-color-accent-bright)' } }, sourceText),
      ),
      createElement(
        'div',
        null,
        createElement('p', { style: { ...monoLabel, color: 'var(--owl-color-gold)', fontWeight: 800, marginBottom: '0.4rem' } }, 'Event timeline'),
        drillDown.timeline.length === 0
          ? createElement('p', { style: { fontSize: 'var(--owl-text-sm)', color: 'var(--owl-color-muted)' } }, 'No swarm events recorded for this run yet.')
          : createElement(
              'ul',
              { style: { listStyle: 'none', margin: '0.3rem 0 0', padding: 0, fontSize: 'var(--owl-text-sm)' } },
              ...drillDown.timeline.map((entry, index) =>
                createElement(
                  'li',
                  {
                    key: `${entry.event_type}-${index}`,
                    style: {
                      padding: '0.32rem 0',
                      borderBottom: '1px solid rgba(182,201,173,0.08)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.6rem',
                    },
                  },
                  createElement('span', { style: { color: 'var(--owl-color-text)' } }, entry.label),
                  createElement(
                    'span',
                    { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', whiteSpace: 'nowrap' } },
                    new Date(entry.at).toISOString().slice(11, 19),
                  ),
                ),
              ),
            ),
      ),
    ),
  )
}

export function PipelineObservatory({ pipeline, drillDown, selectedCaseId }: PipelineObservatoryProps): ReactNode {
  const { summary, stage_counts, runs } = pipeline

  return createElement(
    'section',
    { style: { display: 'grid', gap: '0.4rem' } },
    createElement('p', { style: { ...monoLabel, color: 'var(--owl-color-gold)', fontWeight: 800, margin: '0 0 0.35rem' } }, 'Observability'),
    createElement('h1', { className: 'owl-page-title', style: { margin: '0.1rem 0 0.2rem' } }, 'Strategy pipeline observatory'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', margin: '0 0 1.2rem', fontSize: 'var(--owl-text-base)' } },
      'Live view of the autonomous research swarm and the whole workflow — projection-driven from the audit ledger.',
    ),

    // KPI row
    createElement(
      'div',
      { className: 'owl-kpi-row', style: { marginBottom: '1.1rem' } },
      createElement(OwlKpiStat, { label: 'Active runs', value: String(summary.active_runs), tone: 'gold' }),
      createElement(OwlKpiStat, { label: 'Awaiting approval', value: String(summary.awaiting_approval), tone: 'gold' }),
      createElement(OwlKpiStat, { label: 'Failed (recent)', value: String(summary.failed_recent), tone: summary.failed_recent > 0 ? 'risk' : 'emerald' }),
      createElement(OwlKpiStat, { label: 'Grounded sources', value: String(summary.grounded_sources), tone: 'emerald' }),
    ),

    // Flow map
    createElement(
      'div',
      { style: cardStyle },
      createElement(
        'div',
        { style: { ...sectionHeaderStyle, marginTop: 0 } },
        createElement('h2', { style: { fontSize: 'var(--owl-text-md)', margin: 0 } }, 'Pipeline flow'),
        createElement('span', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, 'counts = cases currently at / passed each stage'),
      ),
      createElement(StageFlowMap, { stages: stage_counts }),
    ),

    // Runs
    createElement(
      'div',
      { style: sectionHeaderStyle },
      createElement('h2', { style: { fontSize: 'var(--owl-text-md)', margin: 0 } }, 'Active & recent runs'),
      createElement('span', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, 'select a run to drill into the swarm'),
    ),
    createElement(RunsTable, { runs, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) }),

    // Drill-down
    drillDown !== undefined
      ? createElement(
          'div',
          null,
          createElement(
            'div',
            { style: sectionHeaderStyle },
            createElement('h2', { style: { fontSize: 'var(--owl-text-md)', margin: 0 } }, `${drillDown.ticker} · v${drillDown.version} — swarm drill-down`),
            createElement('span', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, RUN_CHIP[drillDown.status].label),
          ),
          createElement(DrillDown, { drillDown }),
        )
      : runs.length > 0
        ? createElement(
            'div',
            { style: { ...sectionHeaderStyle } },
            createElement('span', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, 'Select a run above to inspect its specialist swarm.'),
          )
        : null,
  )
}
