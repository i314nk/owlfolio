import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'

import { RouteHeader } from './designSystem'
import type { CalibrationRunView, CalibrationView } from '../lib/calibration'

export type CalibrationPanelProps = {
  view: CalibrationView
}

const microLabel: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-gold)',
  margin: 0,
}

const monoFigure: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  color: 'var(--owl-color-gold-vivid)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
}

const bodyStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.55,
  margin: 0,
}

function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }): ReactNode {
  const thStyle: CSSProperties = { ...microLabel, textAlign: 'left', padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--owl-color-border)' }
  const tdStyle: CSSProperties = { padding: '0.55rem 0.7rem', borderBottom: '1px solid var(--owl-color-border)', color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', fontVariantNumeric: 'tabular-nums' }
  return createElement(
    'table',
    { style: { width: '100%', borderCollapse: 'collapse' } },
    createElement('thead', null, createElement('tr', null, ...headings.map((h) => createElement('th', { key: h, style: thStyle }, h)))),
    createElement('tbody', null, ...rows.map((row, ri) =>
      createElement('tr', { key: `row-${ri}` }, ...row.map((cell, ci) => createElement('td', { key: `cell-${ri}-${ci}`, style: tdStyle }, cell))),
    )),
  )
}

function Section({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: ReactNode; children: ReactNode }): ReactNode {
  return createElement(
    'section',
    { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, eyebrow),
    createElement('h2', { className: 'owl-section-title' }, title),
    lead === undefined ? null : createElement('p', { style: { ...bodyStyle, maxWidth: '60ch' } }, lead),
    children,
  )
}

function pctOf(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * The Calibration desk (UI-continuity Rule 2 — new page). Operator-facing: the backtest signal log,
 * the deployment-ratio metric per ladder, and the parameter version history. Honest empty state when no
 * backtest has been recorded. Parameter versions are read from the live config, never hardcoded.
 */
export function CalibrationPanel({ view }: CalibrationPanelProps) {
  const latestRun = view.runs[0]

  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Calibration desk',
      title: 'Calibration',
      description: 'Operator evidence behind the valuation and sizing parameters: the backtest signal log, the deployment-ratio metric per ladder, and the parameter version history. Anti-drift: parameters are tuned against this evidence at the annual review, then frozen.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createLedgerLine(view),
    createDeploymentRatioSection(view, latestRun),
    createSignalLogSection(view.runs),
    createParamHistorySection(view),
  )
}

function createLedgerLine(view: CalibrationView) {
  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: '', label: 'Valuation params', value: view.current_valuation_version },
    { figureClass: '', label: 'Sizing params', value: view.current_sizing_version },
    { figureClass: 'owl-ledger-figure-emerald', label: 'Recorded runs', value: String(view.runs.length) },
    { figureClass: '', label: 'Param changes', value: String(view.param_history.length) },
  ]
  return createElement(
    'section',
    { 'aria-label': 'Calibration vital signs', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim(), style: { fontFamily: 'var(--owl-font-mono)', fontSize: 'clamp(0.85rem, 1.2vw, 1.05rem)' } }, stat.value),
    )),
  )
}

function createDeploymentRatioSection(view: CalibrationView, latestRun: CalibrationRunView | undefined) {
  const ratios = latestRun?.deployment_ratios ?? []

  const body = ratios.length > 0
    ? Table({
        headings: ['Ladder', 'Rungs', 'Avg % deployed', 'BUY episodes'],
        rows: view.ladders.map((ladder) => {
          const ratio = ratios.find((r) => r.ladder_id === ladder.ladder_id)
          const rungSummary = ladder.rungs.map((r) => `${r.id} ${Math.round(r.fraction * 100)}%`).join(' · ')
          return [
            createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, ladder.ladder_id),
            rungSummary,
            ratio === undefined ? 'Not in run' : createElement('span', { style: monoFigure }, pctOf(ratio.avg_deployment_ratio)),
            ratio === undefined ? '—' : String(ratio.episodes),
          ]
        }),
      })
    : createElement(
        'div',
        { style: { display: 'grid', gap: '0.6rem' } },
        // Still render the configured ladders so the "per ladder" framing is concrete.
        Table({
          headings: ['Ladder', 'Rungs', 'Avg % deployed'],
          rows: view.ladders.map((ladder) => [
            createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, ladder.ladder_id),
            ladder.rungs.map((r) => `${r.id} ${Math.round(r.fraction * 100)}%`).join(' · '),
            createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Not yet measured'),
          ]),
        }),
        createElement(
          'p',
          { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          'No backtest has recorded a deployment-ratio metric yet. Run the calibration backtest to measure the mean % of each target position actually deployed across historical BUY signals — if a ladder under-deploys, tune its fractions / N against this evidence at the annual review, then freeze.',
        ),
      )

  return Section({
    eyebrow: 'Deployment-ratio metric',
    title: 'Average % deployed, per ladder',
    lead: 'The mean fraction of a target position the ladder would actually have deployed across historical BUY signals. A low ratio means the portfolio runs more diluted than the constitution intends; it is the evidence the ladder fractions are tuned against.',
    children: body,
  })
}

function createSignalLogSection(runs: CalibrationRunView[]) {
  if (runs.length === 0) {
    return Section({
      eyebrow: 'Backtest signal log',
      title: 'Signal episodes & sanity windows',
      lead: 'Each calibration backtest replays the config-driven valuation over ~10 years of month-end prices and maps each month to BUY / WATCH-FAIR / WATCH. The recorded run logs the BUY episodes, buys/year, and the pre-stated sanity windows.',
      children: createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-base)', margin: 0 } },
        'No calibration run has been recorded in this ledger yet. The signal log appears here once a backtest is run and logged as a calibration_run event.',
      ),
    })
  }

  return Section({
    eyebrow: 'Backtest signal log',
    title: 'Recorded calibration runs',
    lead: 'Each run is an append-only ledger artifact: the params version it was run against, the universe, and the per-name signal summary. The most recent run is shown first.',
    children: createElement(
      'div',
      { style: { display: 'grid', gap: '1.1rem' } },
      ...runs.map((run) => createElement(
        'div',
        { key: run.event_id, 'data-calibration-run': run.event_id, style: { display: 'grid', gap: '0.5rem', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem', background: 'var(--owl-color-panel)' } },
        createElement('p', { style: microLabel }, `${run.recorded_at.slice(0, 10)} · params ${run.params_version}`),
        createElement('p', { style: { ...bodyStyle, margin: 0 } }, `Universe: ${run.universe.length === 0 ? '—' : run.universe.join(', ')}`),
        run.summaries.length === 0
          ? createElement('p', { style: { color: 'var(--owl-color-quiet)', margin: 0 } }, 'No per-name summaries recorded.')
          : Table({
              headings: ['Ticker', 'Moat / runway', 'Months', 'BUY months', 'Buys/yr'],
              rows: run.summaries.map((s) => [
                createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, s.ticker),
                `${s.moat_class ?? '—'} / ${s.runway ?? '—'}`,
                s.total_months === undefined ? '—' : String(s.total_months),
                s.buy_months === undefined ? '—' : String(s.buy_months),
                s.buys_per_year === undefined ? '—' : createElement('span', { style: monoFigure }, s.buys_per_year.toFixed(2)),
              ]),
            }),
      )),
    ),
  })
}

function createParamHistorySection(view: CalibrationView) {
  const rows: ReactNode[][] = [
    [
      createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, 'valuation (current)'),
      createElement('span', { style: monoFigure }, view.current_valuation_version),
      'Live config',
    ],
    [
      createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, 'sizing (current)'),
      createElement('span', { style: monoFigure }, view.current_sizing_version),
      `Live config · time-completion ${view.time_completion_months}mo`,
    ],
    ...view.param_history.map((change) => [
      createElement('span', { style: { color: 'var(--owl-color-muted)' } }, change.param_set),
      createElement('span', { style: monoFigure }, `${change.previous_version} → ${change.new_version}`),
      `${change.changed_count} param${change.changed_count === 1 ? '' : 's'} changed · ${change.recorded_at.slice(0, 10)}`,
    ]),
  ]

  return Section({
    eyebrow: 'Parameter version history',
    title: 'Versions & config-change events',
    lead: 'The current live parameter versions (read from config) plus every recorded valuation_config change. Each config change is an append-only ledger event; the anti-drift rule requires a backtest re-run attached to any post-go-live change.',
    children: Table({ headings: ['Parameter set', 'Version', 'Basis'], rows }),
  })
}
