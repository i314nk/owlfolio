import { createElement, type CSSProperties, type ReactNode } from 'react'


import { ArchiveAllRunsButton } from './ArchiveAllRunsButton'
import { ArchiveRunButton } from './ArchiveRunButton'
import { PipelineLiveRefresh } from './PipelineLiveRefresh'
import { RerunAnalysisButton } from './RerunAnalysisButton'
import { RouteHeader } from './designSystem'
import { t } from '../lib/i18n'
import type {
  PipelineDrillDown,
  PipelineFailedRun,
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
  /** SCREENING TOGGLE (owner, 2026-07-16): false renders the Shariah-gate stage as OFF. */
  shariahEnabled?: boolean
  /** i18n: the page chrome language (projection data stays as recorded). */
}

// i18n: render-scoped locale — set once per page render; all helpers run inside the same
// synchronous server render pass.

// VIEW WINDOW (owner-approved 2026-07-18): finished runs (done/rejected) older than this leave the
// observatory's table — their permanent home is the Research library. Active, failed, and the
// currently selected run always stay. View-only: the ledger keeps everything.
const FINISHED_RUN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

function isFinishedRun(run: PipelineRun): boolean {
  return run.status === 'done' || run.status === 'rejected'
}

// ── Scoped style vocabulary ───────────────────────────────────────────────────
// The page leans on the shared editorial classes (owl-route-header, owl-rule,
// owl-ledger-line, owl-section-card, owl-section-accent, owl-section-title,
// owl-row*). Only structures with no shared class — the stage-flow nodes, the
// runs/failed tables, the lane cards and the timeline — keep scoped inline
// styles. Gold-forward / emerald; no blue or purple.

const monoLabel: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 'var(--owl-weight-label)',
  letterSpacing: '0.14em',
  margin: 0,
  textTransform: 'uppercase',
}

const monoMeta: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  whiteSpace: 'nowrap',
}

const sectionNoteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontSize: 'var(--owl-text-sm)',
  margin: 0,
}

const HEALTH_DOT_COLOR: Record<PipelineStageHealth, string> = {
  ok: 'var(--owl-color-accent-bright)',
  warn: 'var(--owl-color-amber)',
  err: 'var(--owl-color-risk)',
  off: 'rgba(148, 163, 184, 0.7)',
}

const LANE_DOT_COLOR: Record<PipelineLaneStatus, string> = {
  done: 'var(--owl-color-accent-bright)',
  running: 'var(--owl-color-amber)',
  pending: 'var(--owl-color-quiet)',
}

const RUN_CHIP: Record<PipelineRunStatus, { bg: string; border: string; color: string; label: string }> = {
  running: { bg: 'rgba(240,180,41,0.12)', border: 'rgba(240,180,41,0.34)', color: '#f6d990', label: 'running' },
  awaiting_approval: { bg: 'rgba(214,178,94,0.12)', border: 'rgba(214,178,94,0.34)', color: 'var(--owl-color-gold-vivid)', label: 'awaiting deep-dive approval' },
  done: { bg: 'rgba(var(--owl-rgb-shariah), 0.13)', border: 'var(--owl-color-border-strong)', color: 'var(--owl-color-positive-soft)', label: 'done' },
  rejected: { bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.4)', color: 'var(--owl-color-risk-soft)', label: 'rejected' },
  failed: { bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.4)', color: 'var(--owl-color-risk-soft)', label: 'failed' },
}

const thStyle: CSSProperties = {
  ...monoLabel,
  borderBottom: '1px solid var(--owl-color-border)',
  letterSpacing: '0.08em',
  padding: '0.55rem 0.7rem',
  textAlign: 'left',
}

const tdStyle: CSSProperties = {
  borderBottom: '1px solid rgba(182,201,173,0.08)',
  padding: '0.65rem 0.7rem',
}

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - Date.parse(isoString)
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return isoString.slice(0, 10)
  }
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function statusDot(color: string, size = '0.5rem'): ReactNode {
  return createElement('span', {
    'aria-hidden': 'true',
    style: {
      background: color,
      borderRadius: '50%',
      display: 'inline-block',
      height: size,
      marginRight: '0.4rem',
      width: size,
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
        alignItems: 'center',
        background: chip.bg,
        border: `1px solid ${chip.border}`,
        borderRadius: '999px',
        color: chip.color,
        display: 'inline-flex',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        gap: '0.35rem',
        letterSpacing: '0.02em',
        padding: '0.2rem 0.55rem',
      },
    },
    label,
  )
}

// ── Section header — accent kicker + sans title + a quiet note ─────────────────

function sectionHead(accent: string, title: string, note?: string, titleColor?: string): ReactNode {
  return createElement(
    'div',
    { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.85rem', justifyContent: 'space-between' } },
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.15rem' } },
      createElement('p', { className: 'owl-section-accent' }, accent),
      createElement('h2', { className: 'owl-section-title', style: titleColor !== undefined ? { color: titleColor } : undefined }, title),
    ),
    note !== undefined ? createElement('p', { style: sectionNoteStyle }, note) : null,
  )
}

// ── The ledger line — vital signs of the swarm ────────────────────────────────

function LedgerLine({ summary }: { summary: PipelineProjection['summary'] }): ReactNode {
  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: 'owl-ledger-figure', label: t('pp_stat_active'), value: String(summary.active_runs) },
    { figureClass: 'owl-ledger-figure', label: t('pp_stat_awaiting'), value: String(summary.awaiting_approval) },
    {
      figureClass: `owl-ledger-figure ${summary.failed_recent > 0 ? 'owl-ledger-figure-risk' : 'owl-ledger-figure-emerald'}`,
      label: t('pp_stat_failed'),
      value: String(summary.failed_recent),
    },
    { figureClass: 'owl-ledger-figure owl-ledger-figure-emerald', label: t('pp_stat_sources'), value: String(summary.grounded_sources) },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Swarm vital signs', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: stat.figureClass }, stat.value),
    )),
  )
}

// ── Verdict-state legend (UI-continuity Rule 2) ───────────────────────────────
// Distinct badges for the lifecycle/recalibration verdict states the pipeline can emit, so an operator
// reads the same vocabulary the case view uses. These are LABELS for states the cases carry, not new state.
type VerdictBadge = { state: string; bg: string; border: string; color: string; note: string }

const VERDICT_BADGES: VerdictBadge[] = [
  { state: 'TOO-HARD', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.32)', color: 'var(--owl-color-muted)', note: 'Outside the circle of competence — set aside, not failed.' },
  { state: 'GATED', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.36)', color: 'var(--owl-color-risk-soft)', note: 'Stopped at a hard gate (sub-wide moat or Shariah) — deep dive skipped.' },
  { state: 'WATCH-FAIR', bg: 'rgba(214,178,94,0.16)', border: 'rgba(214,178,94,0.42)', color: 'var(--owl-color-gold-bright)', note: 'Wonderful at fair — human-discretion zone, never a harness buy signal.' },
]

function verdictBadgeChip(badge: VerdictBadge): ReactNode {
  return createElement(
    'span',
    {
      key: badge.state,
      'data-verdict-state': badge.state,
      style: {
        alignItems: 'center',
        background: badge.bg,
        border: `1px solid ${badge.border}`,
        borderRadius: '999px',
        color: badge.color,
        display: 'inline-flex',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        letterSpacing: '0.04em',
        padding: '0.2rem 0.6rem',
      },
    },
    badge.state,
  )
}

function VerdictStateLegend(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.5rem' } },
    ...VERDICT_BADGES.map((badge) => createElement(
      'div',
      { key: badge.state, style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      verdictBadgeChip(badge),
      createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, badge.note),
    )),
  )
}

// ── The stage-flow map ────────────────────────────────────────────────────────

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
            background: 'var(--owl-color-panel)',
            border: `1px solid ${stage.health === 'warn' ? 'var(--owl-color-border-strong)' : 'var(--owl-color-border)'}`,
            borderRadius: 'var(--owl-radius-card)',
            flex: 1,
            minWidth: '120px',
            padding: '0.7rem 0.8rem',
            position: 'relative',
          },
        },
        statusDot(HEALTH_DOT_COLOR[stage.health]),
        createElement('span', { style: { ...monoLabel, color: 'var(--owl-color-muted)', letterSpacing: '0.06em' } }, stage.label),
        createElement(
          'div',
          {
            style: {
              color: stage.health === 'err'
                ? 'var(--owl-color-risk)'
                : stage.health === 'warn'
                  ? 'var(--owl-color-amber)'
                  : 'var(--owl-color-gold-bright)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-lg)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 800,
              marginTop: '0.25rem',
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
          { key: `arrow-${stage.key}`, 'aria-hidden': 'true', style: { alignSelf: 'center', color: 'var(--owl-color-gold)', fontSize: 'var(--owl-text-md)' } },
          '→',
        ),
      )
    }
  })

  return createElement(
    'div',
    { style: { alignItems: 'stretch', display: 'flex', gap: '0.45rem', overflowX: 'auto', paddingBottom: '0.2rem' } },
    ...nodes,
  )
}

function sourceCountBadge(count: number): ReactNode {
  return createElement(
    'span',
    {
      style: {
        alignItems: 'center',
        background: 'var(--owl-color-panel-elevated)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: '999px',
        color: count > 0 ? 'var(--owl-color-accent-bright)' : 'var(--owl-color-quiet)',
        display: 'inline-flex',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 700,
        padding: '0.15rem 0.5rem',
      },
    },
    `${count} ${count === 1 ? 'source' : 'sources'}`,
  )
}

// ── The runs table ────────────────────────────────────────────────────────────

function RunsTable({ runs, selectedCaseId }: { runs: PipelineRun[]; selectedCaseId?: string }): ReactNode {
  if (runs.length === 0) {
    return createElement(
      'div',
      { className: 'owl-row', style: { color: 'var(--owl-color-muted)', gridTemplateColumns: '1fr' } },
      t('pp_runs_empty'),
    )
  }

  return createElement(
    'div',
    { style: { overflowX: 'auto' } },
    createElement(
      'table',
      { style: { borderCollapse: 'collapse', fontSize: 'var(--owl-text-base)', width: '100%' } },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          ...['Ticker', 'Started', 'Stage', 'Status', 'Sources'].map((heading) =>
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
              style: isSelected ? { background: 'var(--owl-color-panel-elevated)' } : undefined,
            },
            createElement(
              'td',
              { style: tdStyle },
              createElement(
                'a',
                {
                  className: 'owl-focusable',
                  href: `/pipeline?case=${encodeURIComponent(run.research_case_id)}`,
                  style: { color: 'var(--owl-color-gold-bright)', fontWeight: 800, textDecoration: 'none' },
                },
                run.ticker,
              ),
            ),
            createElement('td', { style: { ...tdStyle, ...monoMeta } }, relativeTime(run.started_at)),
            createElement('td', { style: { ...tdStyle, color: 'var(--owl-color-muted)' } }, run.stage_label),
            createElement('td', { style: tdStyle }, runChip(run)),
            createElement('td', { style: tdStyle }, sourceCountBadge(run.source_count)),
          )
        }),
      ),
    ),
  )
}

// ── Failed runs ───────────────────────────────────────────────────────────────

function FailedRunsSection({ failedRuns }: { failedRuns: PipelineFailedRun[] }): ReactNode {
  if (failedRuns.length === 0) return null

  return createElement(
    'section',
    { className: 'owl-section-card', style: { borderColor: 'rgba(239,68,68,0.24)', gap: 'var(--owl-space-3)' } },
    sectionHead(t('pp_failed_accent'), t('pp_failed_title'), t('pp_failed_note'), 'var(--owl-color-risk-bright)'),
    // Bulk acknowledge for a pile of failures — each archive stays an individual auditable event.
    failedRuns.length > 1
      ? createElement(
          'div',
          null,
          createElement(ArchiveAllRunsButton, { cases: failedRuns.map((run) => ({ caseId: run.case_id, ticker: run.ticker })) }),
        )
      : null,
    createElement(
      'div',
      { style: { overflowX: 'auto' } },
      createElement(
        'table',
        { style: { borderCollapse: 'collapse', fontSize: 'var(--owl-text-base)', width: '100%' } },
        createElement(
          'thead',
          null,
          createElement(
            'tr',
            null,
            ...['Ticker', 'Failed', 'Reason', 'Actions'].map((heading) =>
              createElement('th', { key: heading, style: thStyle }, heading),
            ),
          ),
        ),
        createElement(
          'tbody',
          null,
          // Failures are ACTIONABLE where they surface: the ticker opens the dossier (the error +
          // re-run live there), and Archive acknowledges + discards in place. Never a dead end.
          ...failedRuns.map((run) =>
            createElement(
              'tr',
              { key: run.case_id },
              createElement(
                'td',
                { style: tdStyle },
                createElement(
                  'a',
                  {
                    className: 'owl-focusable',
                    href: `/research/${encodeURIComponent(run.case_id)}`,
                    style: { color: 'var(--owl-color-gold-bright)', fontWeight: 800, textDecoration: 'none' },
                  },
                  run.ticker,
                ),
              ),
              createElement('td', { style: { ...tdStyle, ...monoMeta } }, relativeTime(run.failed_at)),
              createElement('td', { style: { ...tdStyle, color: 'var(--owl-color-risk)' } }, run.error_summary ?? '—'),
              createElement(
                'td',
                { style: tdStyle },
                createElement(
                  'div',
                  { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' } },
                  createElement(ArchiveRunButton, { caseId: run.case_id, ticker: run.ticker }),
                  // Restart = the existing supersession re-run (confirm-gated: full provider spend).
                  // Hidden when the ticker is a case-id fallback (legacy cases without a recorded
                  // ticker) — a re-run needs the real symbol; the dossier link remains the path.
                  /^rc[_-]/i.test(run.ticker)
                    ? null
                    : createElement(RerunAnalysisButton, { caseId: run.case_id, ticker: run.ticker }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

// ── The per-run drill-down ────────────────────────────────────────────────────

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
          alignItems: 'center',
          background: 'var(--owl-color-panel)',
          border: '1px solid var(--owl-color-border)',
          borderRadius: 'var(--owl-radius-card)',
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.55rem 0.7rem',
        },
      },
      createElement(
        'span',
        { style: { fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.04em', textTransform: 'uppercase' } },
        statusDot(LANE_DOT_COLOR[lane.status]),
        lane.label,
      ),
      createElement('span', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)' } }, laneMeta(lane)),
    ),
  )

  const sourceCount = drillDown.grounded_source_ids.length
  const sourceSummary = sourceCount === 0
    ? createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, 'No grounded sources recorded yet.')
    : createElement(
        'div',
        null,
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' } },
          sourceCountBadge(sourceCount),
          createElement('span', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)' } }, 'sha-256 verified, replayable'),
        ),
        createElement(
          'details',
          null,
          createElement('summary', { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)' } }, 'Show source IDs'),
          createElement(
            'div',
            { style: { color: 'var(--owl-color-accent-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', marginTop: '0.3rem', wordBreak: 'break-all' } },
            drillDown.grounded_source_ids.join(' · '),
          ),
        ),
      )

  const laneLabelStyle: CSSProperties = { ...monoLabel, color: 'var(--owl-color-gold)', letterSpacing: '0.1em' }

  return createElement(
    'div',
    { style: { display: 'grid', gap: '1.1rem', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 0.9fr)' } },
    createElement(
      'div',
      null,
      createElement('p', { style: { ...laneLabelStyle, marginBottom: '0.5rem' } }, 'Specialist lanes'),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
        ...laneCards,
      ),
      createElement('p', { style: { ...laneLabelStyle, margin: '1rem 0 0.4rem' } }, `Grounded sources (${sourceCount})`),
      sourceSummary,
    ),
    createElement(
      'div',
      null,
      createElement('p', { style: { ...laneLabelStyle, marginBottom: '0.4rem' } }, 'Event timeline'),
      drillDown.timeline.length === 0
        ? createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, 'No swarm events recorded for this run yet.')
        : createElement(
            'ul',
            // The breadcrumb feed scrolls INSIDE the card (never stretches the page). column-reverse
            // over a newest-first list keeps the visual order ascending while pinning the scroll to
            // the newest entry — the live feed reads like a log tail with no client JS.
            { style: { display: 'flex', flexDirection: 'column-reverse', fontSize: 'var(--owl-text-sm)', listStyle: 'none', margin: '0.3rem 0 0', maxHeight: '22rem', overflowY: 'auto', padding: 0 } },
            ...[...drillDown.timeline].reverse().map((entry, index) =>
              createElement(
                'li',
                {
                  key: `${entry.event_type}-${index}`,
                  style: {
                    borderBottom: '1px solid rgba(182,201,173,0.08)',
                    display: 'flex',
                    gap: '0.6rem',
                    justifyContent: 'space-between',
                    padding: '0.34rem 0',
                  },
                },
                createElement('span', { style: { color: 'var(--owl-color-text)' } }, entry.label),
                createElement('span', { style: monoMeta }, new Date(entry.at).toISOString().slice(11, 19)),
              ),
            ),
          ),
    ),
  )
}

function DrillDownSection({ drillDown }: { drillDown: PipelineDrillDown }): ReactNode {
  return createElement(
    'section',
    { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.85rem', justifyContent: 'space-between' } },
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.15rem' } },
        createElement('p', { className: 'owl-section-accent' }, 'Swarm drill-down'),
        createElement(
          'h2',
          { className: 'owl-section-title', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
          `${drillDown.ticker} · v${drillDown.version}`,
          createElement('span', { style: { ...monoMeta, fontWeight: 600 } }, RUN_CHIP[drillDown.status].label),
        ),
      ),
      createElement(
        'a',
        {
          className: 'owl-focusable',
          href: `/research/${encodeURIComponent(drillDown.research_case_id)}`,
          style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' },
        },
        'Open dossier →',
      ),
    ),
    createElement(DrillDown, { drillDown }),
  )
}

// ── The page ──────────────────────────────────────────────────────────────────

export function PipelineObservatory({ pipeline, drillDown, selectedCaseId, shariahEnabled = true }: PipelineObservatoryProps): ReactNode {
  const { summary, stage_counts, runs, failed_runs = [], snapshot_at } = pipeline

  const snapshotTime = snapshot_at !== undefined
    ? new Date(snapshot_at).toISOString().slice(11, 19)
    : undefined

  // The finished-run view window; active runs and the selected drill-down target always stay.
  const now = Date.now()
  const visibleRuns = runs.filter((run) =>
    !isFinishedRun(run)
    || run.research_case_id === selectedCaseId
    || now - Date.parse(run.updated_at) <= FINISHED_RUN_WINDOW_MS,
  )
  const hiddenFinishedCount = runs.length - visibleRuns.length

  return createElement(
    'section',
    { 'aria-label': 'Pipeline observatory', style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    createElement(RouteHeader, {
      kicker: t('pp_kicker'),
      title: t('pp_title'),
      description: t('pp_desc'),
    }),
    createElement('hr', { className: 'owl-rule' }),

    // Vital signs + snapshot + the live auto-refresh indicator (mounted only while a run executes,
    // so the "live" claim in the header is actually true).
    createElement(LedgerLine, { summary }),
    summary.active_runs > 0 || snapshotTime !== undefined
      ? createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' } },
          summary.active_runs > 0 ? createElement(PipelineLiveRefresh, { label: t('pp_live') }) : null,
          snapshotTime !== undefined
            ? createElement('p', { style: { ...monoMeta, margin: 0 } }, `Snapshot taken at ${snapshotTime}`)
            : null,
        )
      : null,

    // Stage-flow map
    createElement(
      'section',
      { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
      sectionHead(t('pp_flow_accent'), t('pp_flow_title'), t('pp_flow_note')),
      // SCREENING OFF: the gate stage reads OFF (gray dot) — the funnel never implies a screen that
      // is not running. The count stays (historical + DISABLED pass-throughs still move through it).
      createElement(StageFlowMap, {
        stages: shariahEnabled
          ? stage_counts
          : stage_counts.map((stage) => stage.key === 'shariah_gate' ? { ...stage, label: 'Shariah gate · OFF', health: 'off' as const } : stage),
      }),
      // Inversion step slot (UI-continuity Rule 2): the Munger inversion pass — the case argued against
      // itself pre-synthesis. The objection renders on the case view's case-against card; step id stays stable.
      createElement(
        'div',
        {
          'data-pipeline-step': 'red_team',
          style: {
            alignItems: 'center',
            background: 'var(--owl-color-panel)',
            border: '1px dashed var(--owl-color-border-strong)',
            borderRadius: 'var(--owl-radius-card)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem 0.85rem',
            padding: '0.7rem 0.85rem',
          },
        },
        createElement('span', { style: { ...monoLabel, color: 'var(--owl-color-gold)', letterSpacing: '0.08em' } }, 'Inversion pass'),
        createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, 'Adversarial pre-synthesis step — the strongest objection + synthesis response render on each case verdict.'),
      ),
    ),

    // Verdict states legend — TOO-HARD / GATED / WATCH-FAIR
    createElement(
      'section',
      { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
      sectionHead(t('pp_verdict_accent'), t('pp_verdict_title'), t('pp_verdict_note')),
      // Collapsed by default: the legend is identical every visit — page space goes to what needs
      // the user now. The states stay one click away.
      createElement(
        'details',
        null,
        createElement('summary', { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.05em' } }, t('pp_legend_toggle')),
        createElement('div', { style: { marginTop: '0.6rem' } }, createElement(VerdictStateLegend)),
      ),
    ),

    // Active & recent runs
    createElement(
      'section',
      { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
      sectionHead(t('pp_runs_accent'), t('pp_runs_title'), t('pp_runs_note')),
      createElement(RunsTable, { runs: visibleRuns, ...(selectedCaseId !== undefined ? { selectedCaseId } : {}) }),
      // The view window is visible, never silent: say how many finished runs left the table.
      hiddenFinishedCount > 0
        ? createElement(
            'p',
            { style: sectionNoteStyle },
            hiddenFinishedCount === 1 ? t('pp_hidden_finished_one') : t('pp_hidden_finished_many').replace('{count}', String(hiddenFinishedCount)),
            ' ',
            createElement('a', { className: 'owl-focusable', href: '/research', style: { color: 'var(--owl-color-gold-bright)', fontWeight: 700, textDecoration: 'none' } }, t('pp_open_library')),
          )
        : null,
    ),

    // Failed runs
    createElement(FailedRunsSection, { failedRuns: failed_runs }),

    // Per-run drill-down
    drillDown !== undefined
      ? createElement(DrillDownSection, { drillDown })
      : runs.length > 0
        ? createElement(
            'p',
            { style: sectionNoteStyle },
            t('pp_select_run'),
          )
        : null,
  )
}
