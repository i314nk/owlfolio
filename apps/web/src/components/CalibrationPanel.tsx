import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'

import { RouteHeader } from './designSystem'
import { RunCalibrationButton } from './RunCalibrationButton'
import {
  CalibrationUniverseAddForm,
  CalibrationUniverseRemoveButton,
  CalibrationUniverseSuggestionAddButton,
} from './CalibrationUniverseControls'
import type {
  CalibrationCoverageView,
  CalibrationRunView,
  CalibrationUniverseView,
  CalibrationView,
} from '../lib/calibration'

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
    createUniverseSection(view.universe),
    createRunBacktestSection(),
    createDeploymentRatioSection(view, latestRun),
    createSignalLogSection(view.runs),
    createCoverageSection(latestRun),
    createParamHistorySection(view),
    createConfigChangeSection(view),
  )
}

const COVERAGE_LABEL: Record<CalibrationCoverageView['status'], string> = {
  resolved_edgar: 'Resolved · EDGAR',
  resolved_local_manual: 'Resolved · local-manual',
  // Deferred is the calm, EXPECTED bucket — a non-SEC filer with no automated source, intentionally skipped.
  deferred: 'Deferred · no automated source',
  // Unresolved now means an ACTIVE name that unexpectedly failed to resolve — a real problem.
  unresolved: 'Unresolved · active name failed',
}

/** Statuses we render in the calm/muted (non-alarming) tone: deferred + unresolved are quiet, not red. */
function isQuietCoverage(status: CalibrationCoverageView['status']): boolean {
  return status === 'unresolved' || status === 'deferred'
}

function createUniverseSection(universe: CalibrationUniverseView | undefined) {
  if (universe === undefined) {
    return Section({
      eyebrow: 'Calibration universe',
      title: 'User-curated universe',
      lead: 'The calibration universe is a user-owned, versioned list (the spec pre-states the UNIVERSE as part of the target). It is read from config/calibration_universe.json.',
      children: createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-base)', margin: 0 } },
        'No calibration universe config was found (config/calibration_universe.json missing or invalid).',
      ),
    })
  }

  const nameRows = universe.names.map((name) => {
    // Every name gets a per-row remove (×) control: removing a SEED name tombstones it (a user-authored
    // calibration_universe_member_removed event); re-adding via the suggestions/form un-tombstones it.
    const removeControl = createElement(CalibrationUniverseRemoveButton, { ticker: name.ticker })
    // Deferred names get their own calm, honest line (NOT a red "needs data" error): a non-SEC filer with
    // no automated fundamentals source. Manual entry is intentionally not used, so this is expected.
    if (name.status === 'deferred') {
      return [
        createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, name.ticker),
        name.company,
        name.market,
        createElement(
          'span',
          { style: { color: 'var(--owl-color-quiet)' }, title: name.defer_reason ?? '' },
          `Deferred — no automated fundamentals source${name.defer_reason === undefined ? '' : ` · ${name.defer_reason}`}`,
        ),
        removeControl,
      ]
    }
    return [
      createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, name.ticker),
      name.company,
      name.market,
      name.coverage_status === undefined
        ? createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, `not yet run${name.fundamentals_hint === undefined ? '' : ` (${name.fundamentals_hint})`}`)
        : createElement(
            'span',
            { style: { color: isQuietCoverage(name.coverage_status) ? 'var(--owl-color-quiet)' : 'var(--owl-color-muted)' }, title: name.coverage_reason ?? '' },
            COVERAGE_LABEL[name.coverage_status],
          ),
      removeControl,
    ]
  })

  const suggestionBody = universe.suggestions.length === 0
    ? createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, 'No suggested additions: every researched / 13F-discovered name is already in the universe.')
    : Table({
        headings: ['Suggested ticker', 'Company', 'Surfaced from', ''],
        rows: universe.suggestions.map((s) => [
          createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, s.ticker),
          s.company ?? '—',
          s.sources.map((src) => (src === '13f_discovered' ? '13F discovery' : 'researched case')).join(' · '),
          createElement(CalibrationUniverseSuggestionAddButton, { ticker: s.ticker, ...(s.company === undefined ? {} : { company: s.company }) }),
        ]),
      })

  const hasDeferred = universe.names.some((name) => name.status === 'deferred')

  return Section({
    eyebrow: 'Calibration universe',
    title: `User-curated universe · ${universe.version}`,
    lead: 'The automated-fundamentals universe is SEC filers: US 10-K filers (full EDGAR XBRL history) plus foreign 20-F/40-F filers (EDGAR IFRS, ~2022+). The human owns this list and curates it right here — add a gate-plausible SEC-filing name or remove one (×). The list is a projection: the seed config plus your add/remove edits, recorded as user-authored ledger events (removing a seed name tombstones it; re-adding un-tombstones). A recorded run freezes the resulting universe version for reproducibility. Coverage status comes from the latest recorded run.',
    children: createElement(
      'div',
      { style: { display: 'grid', gap: '1rem' } },
      Table({ headings: ['Ticker', 'Company', 'Market', 'Coverage (latest run)', ''], rows: nameRows }),
      createElement('p', { style: { ...microLabel, color: 'var(--owl-color-gold)' } }, 'Add a ticker'),
      createElement(CalibrationUniverseAddForm, null),
      hasDeferred
        ? createElement(
            'p',
            { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0, maxWidth: '60ch' } },
            'Deferred names are non-SEC filers (e.g. DFM/ADX listings) with no automated primary fundamentals source. They are listed for transparency but skipped — we do not hand-key figures and we rely on no keyed aggregator. Known limitation: deferring these makes the calibration SEC-filer-centric.',
          )
        : null,
      createElement('p', { style: { ...microLabel, color: 'var(--owl-color-gold)' } }, 'Suggested additions (human curates — not auto-added)'),
      suggestionBody,
    ),
  })
}

function createRunBacktestSection() {
  return Section({
    eyebrow: 'Run the backtest',
    title: 'Deliberate, observation-only backtest',
    lead: 'Running a calibration backtest is a deliberate, enqueued action — not a casual tune knob. It replays the config-driven valuation over the frozen universe via the tiered fundamentals resolver (EDGAR foreign-filers → local-manual → fail-closed) and records a calibration_run with the signal frequency, deployment-ratio metric, and the non-US coverage report. It never changes parameters.',
    children: createElement(RunCalibrationButton, null),
  })
}

function createCoverageSection(latestRun: CalibrationRunView | undefined) {
  if (latestRun === undefined || latestRun.coverage.length === 0) {
    return Section({
      eyebrow: 'Coverage report',
      title: 'Fundamentals coverage',
      lead: 'Each run classifies every universe name into four buckets: resolved via EDGAR (US 10-K or foreign 20-F/40-F), resolved via the optional local-manual seam, deferred (a non-SEC filer with no automated source — expected, intentionally skipped), or unresolved (an active name that unexpectedly failed — a real problem). Never fabricated, no third-party aggregator.',
      children: createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-base)', margin: 0 } },
        'No coverage report yet. Run the calibration backtest to see how each name classifies.',
      ),
    })
  }
  return Section({
    eyebrow: 'Coverage report',
    title: 'Fundamentals coverage (latest run)',
    lead: 'Four buckets: resolved · EDGAR, resolved · local-manual, deferred (non-SEC filer, no automated source — expected), and unresolved (an active name that unexpectedly failed — investigate). Deferred is calm and expected; unresolved is the only one that flags a problem.',
    children: Table({
      headings: ['Ticker', 'Status', 'Currency', 'Reason'],
      rows: latestRun.coverage.map((c) => [
        createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, c.ticker),
        createElement('span', { style: { color: isQuietCoverage(c.status) ? 'var(--owl-color-quiet)' : 'var(--owl-color-muted)' } }, COVERAGE_LABEL[c.status]),
        c.currency ?? '—',
        c.reason ?? '—',
      ]),
    }),
  })
}

function createConfigChangeSection(view: CalibrationView) {
  const latestRun = view.runs[0]
  const hasRun = latestRun !== undefined
  return Section({
    eyebrow: 'Propose parameter change',
    title: 'Deliberate, human-confirmed config change (anti-drift)',
    lead: 'Parameters are frozen after go-live. A change is permitted ONLY at the annual system review, ONLY with a backtest re-run attached, and ONLY against the same pre-stated target. "It has been quiet lately" is never grounds. A proposal is a logged, human-confirmed config-change DRAFT — never a quick tune knob, never auto-applied.',
    children: createElement(
      'div',
      { style: { display: 'grid', gap: '0.6rem' } },
      createElement(
        'p',
        { style: { ...bodyStyle, margin: 0 } },
        hasRun
          ? `A parameter-change draft must attach the latest recorded backtest (${latestRun.event_id.slice(0, 18)}…). Confirming a draft is a separate, human-authored ledger transition that writes a valuation_config event; it never mutates the live config silently.`
          : 'No backtest has been recorded yet. The anti-drift rule requires an attached calibration_run before any parameter-change draft can be proposed — run the backtest first.',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
        'The constitutional 10% discount rate is never a calibration target and cannot be proposed for change.',
      ),
    ),
  })
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
