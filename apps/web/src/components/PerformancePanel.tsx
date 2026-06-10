import { createElement, type CSSProperties } from 'react'

import type { AppPerformanceReport } from '../lib/performance'
import { RouteHeader } from './designSystem'

export type PerformancePanelProps = {
  report: AppPerformanceReport
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
}

const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: '1.15rem 1.3rem',
}

function formatPercent(value: number): string {
  const pct = value * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function PerformancePanel({ report }: PerformancePanelProps) {
  const { performance } = report

  return createElement(
    'section',
    { style: shellStyle },
    createElement(RouteHeader, {
      kicker: 'Performance',
      title: 'Performance vs benchmark',
      description: `Time-weighted portfolio return compared with the ${report.benchmark_label} benchmark, derived from local ledger valuation snapshots and cash flows.`,
    }),
    createElement('hr', { className: 'owl-rule' }),
    performance.sufficient
      ? createSufficientView(report)
      : createInsufficientView(report),
    createAnalyticsView(report),
    createDisciplineView(report),
    createDisclaimer(report),
  )
}

/** Module 8: money-weighted return + per-position contribution + realized/unrealized split. */
function createAnalyticsView(report: AppPerformanceReport) {
  const { analytics } = report
  const mwr = analytics.mwr

  const mwrStat = mwr.computable
    ? createLedgerStat('Money-weighted return (IRR)', formatPercent(mwr.mwr), figureClassFor(mwr.mwr))
    : createLedgerStat('Money-weighted return (IRR)', 'Not computable', '')

  const split = analytics.realized_unrealized
  const splitLine = createElement(
    'section',
    { 'aria-label': 'Realized vs unrealized', className: 'owl-ledger-line' },
    createLedgerStat('Realized (incl. dividends)', formatMoney(split.realized_gain_loss), figureClassFor(split.realized_gain_loss)),
    createLedgerStat('Unrealized', formatMoney(split.unrealized_gain_loss), figureClassFor(split.unrealized_gain_loss)),
    createLedgerStat('Total gain / loss', formatMoney(split.total_gain_loss), figureClassFor(split.total_gain_loss)),
  )

  const contributionRows = analytics.contributions.length === 0
    ? createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0 } }, 'No positions to attribute yet.')
    : createElement(
        'table',
        { className: 'owl-table', style: { width: '100%' } },
        createElement(
          'thead',
          null,
          createElement(
            'tr',
            null,
            createElement('th', { style: { textAlign: 'left' } }, 'Position'),
            createElement('th', { style: { textAlign: 'right' } }, 'Unrealized'),
            createElement('th', { style: { textAlign: 'right' } }, 'Total P&L'),
            createElement('th', { style: { textAlign: 'right' } }, 'Contribution'),
          ),
        ),
        createElement(
          'tbody',
          null,
          ...analytics.contributions.map((contribution) => createElement(
            'tr',
            { key: contribution.holding_id },
            createElement('td', null, contribution.ticker ?? contribution.holding_id),
            createElement('td', { style: { textAlign: 'right', color: contribution.unrealized_gain_loss >= 0 ? 'var(--owl-color-emerald, #34d399)' : 'var(--owl-color-risk, #f87171)' } }, formatMoney(contribution.unrealized_gain_loss)),
            createElement('td', { style: { textAlign: 'right' } }, formatMoney(contribution.total_gain_loss)),
            createElement('td', { style: { textAlign: 'right' } }, contribution.contribution_share === undefined ? '—' : formatPercent(contribution.contribution_share)),
          )),
        ),
      )

  return createElement(
    'section',
    { 'aria-label': 'Portfolio analytics', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Money-weighted & attribution'),
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.6rem' } }, 'Return composition'),
    createElement('section', { 'aria-label': 'MWR', className: 'owl-ledger-line' }, mwrStat),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.2rem 0 0.8rem', fontSize: 'var(--owl-text-sm)' } }, 'Money-weighted return reflects the timing of your buys, dividends, and ending value; it answers a different question than the time-weighted return above. Not computable until there is an offsetting inflow (sale or ending value).'),
    splitLine,
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-md)', margin: '1rem 0 0.5rem' } }, 'Per-position contribution'),
    contributionRows,
  )
}

/** Module 8 discipline reports: discount-at-purchase, gate-override integrity, thesis-review latency. */
function createDisciplineView(report: AppPerformanceReport) {
  const { discipline } = report

  const override = discipline.gate_override
  const overrideTone = override.integrity_ok ? 'var(--owl-color-emerald, #34d399)' : 'var(--owl-color-risk, #f87171)'
  const overrideCard = createElement(
    'div',
    { 'aria-label': 'Gate-override integrity', style: { display: 'flex', alignItems: 'baseline', gap: '0.6rem', margin: '0 0 0.8rem' } },
    createElement('span', { style: { color: 'var(--owl-color-muted)', fontWeight: 700 } }, 'Gate-override attempts (BUY despite a failing hard gate)'),
    createElement('span', { style: { color: overrideTone, fontWeight: 900, fontSize: 'var(--owl-text-lg)' } }, String(override.count)),
    createElement('span', { style: { color: overrideTone, fontWeight: 700 } }, override.integrity_ok ? 'green — no gate was price-overridden' : 'INTEGRITY ALERT'),
  )

  const discountRows = discipline.discount_at_purchase.length === 0
    ? createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0 } }, 'No holdings with a recorded entry yet.')
    : createElement(
        'table',
        { className: 'owl-table', style: { width: '100%' } },
        createElement(
          'thead',
          null,
          createElement(
            'tr',
            null,
            createElement('th', { style: { textAlign: 'left' } }, 'Position'),
            createElement('th', { style: { textAlign: 'right' } }, 'Discount to fair value'),
            createElement('th', { style: { textAlign: 'right' } }, '1-yr outcome'),
            createElement('th', { style: { textAlign: 'right' } }, 'Since entry'),
          ),
        ),
        createElement(
          'tbody',
          null,
          ...discipline.discount_at_purchase.map((row) => createElement(
            'tr',
            { key: row.holding_id },
            createElement('td', null, row.ticker ?? row.holding_id),
            createElement('td', { style: { textAlign: 'right' } }, row.entry_discount_to_fv === undefined ? '—' : formatPercent(row.entry_discount_to_fv)),
            createElement('td', { style: { textAlign: 'right' } }, row.one_year_outcome === undefined ? '—' : formatPercent(row.one_year_outcome)),
            createElement('td', { style: { textAlign: 'right' } }, row.since_outcome === undefined ? '—' : formatPercent(row.since_outcome)),
          )),
        ),
      )

  const latencyRows = discipline.thesis_review_latency.length === 0
    ? createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.4rem 0 0' } }, 'No thesis-review triggers recorded.')
    : createElement(
        'ul',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.3rem', margin: '0.4rem 0 0', paddingLeft: '1.1rem' } },
        ...discipline.thesis_review_latency.map((row) => createElement(
          'li',
          { key: `${row.holding_id}_${row.triggered_at}` },
          `${row.ticker ?? row.holding_id}: ${row.resolved ? `${row.latency_days} days to review` : 'review still open'}`,
        )),
      )

  return createElement(
    'section',
    { 'aria-label': 'Discipline reports', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Discipline'),
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.6rem' } }, 'Calibration & integrity'),
    overrideCard,
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-md)', margin: '0.5rem 0 0.4rem' } }, 'Discount-at-purchase vs subsequent outcome'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0 0 0.5rem', fontSize: 'var(--owl-text-sm)' } }, 'The data that, over time, calibrates whether the margin-of-safety levels are right.'),
    discountRows,
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-md)', margin: '1rem 0 0' } }, 'Thesis-review latency'),
    latencyRows,
  )
}

/** Map a signed return to the ledger-figure tone class (positive→emerald, negative→risk, flat→gold default). */
function figureClassFor(value: number): string {
  if (value > 0) {
    return 'owl-ledger-figure-emerald'
  }
  if (value < 0) {
    return 'owl-ledger-figure-risk'
  }
  return ''
}

function createLedgerStat(label: string, value: string, figureClass: string) {
  return createElement(
    'article',
    { className: 'owl-ledger-stat', key: label },
    createElement('p', { className: 'owl-ledger-label' }, label),
    createElement('p', { className: `owl-ledger-figure ${figureClass}`.trim() }, value),
  )
}

function createSufficientView(report: AppPerformanceReport) {
  const performance = report.performance
  if (!performance.sufficient) {
    return null
  }

  const benchmarkAvailable = performance.benchmark_return !== null
  const benchmarkReturn = performance.benchmark_return ?? 0
  const excessReturn = performance.excess_return ?? 0

  // Vital signs: portfolio TWR / benchmark / excess as a hairline ledger line —
  // emerald when positive, risk when negative, never boxy KPI tiles.
  return createElement(
    'div',
    { style: { display: 'grid', gap: '1rem' } },
    createElement(
      'section',
      { 'aria-label': 'Performance summary', className: 'owl-ledger-line' },
      createLedgerStat(
        `Portfolio return (${performance.period_start} → ${performance.period_end})`,
        formatPercent(performance.portfolio_twr),
        figureClassFor(performance.portfolio_twr),
      ),
      createLedgerStat(
        `Benchmark (${report.benchmark_symbol}) return`,
        benchmarkAvailable ? formatPercent(benchmarkReturn) : '—',
        benchmarkAvailable ? figureClassFor(benchmarkReturn) : '',
      ),
      createLedgerStat(
        'Excess return (portfolio − benchmark)',
        benchmarkAvailable ? formatPercent(excessReturn) : '—',
        benchmarkAvailable ? figureClassFor(excessReturn) : '',
      ),
    ),
    benchmarkAvailable
      ? createComparisonBars(performance.portfolio_twr, benchmarkReturn, report.benchmark_symbol)
      : createBenchmarkPendingCard(report, performance.benchmark_reason),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', margin: 0 } },
      `Based on ${report.snapshot_count} monthly valuation ${report.snapshot_count === 1 ? 'snapshot' : 'snapshots'} from the local ledger.`,
    ),
  )
}

function createComparisonBars(portfolio: number, benchmark: number, benchmarkSymbol: string) {
  const maxMagnitude = Math.max(Math.abs(portfolio), Math.abs(benchmark), 0.0001)
  const widthFor = (value: number): string => `${Math.min((Math.abs(value) / maxMagnitude) * 100, 100).toFixed(1)}%`

  const bar = (label: string, value: number, color: string) => createElement(
    'div',
    { key: label, style: { display: 'grid', gap: '0.3rem' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' } },
      createElement('span', { style: { color: 'var(--owl-color-muted)', fontWeight: 700 } }, label),
      createElement('span', { style: { color, fontWeight: 800 } }, formatPercent(value)),
    ),
    createElement(
      'div',
      { style: { background: 'var(--owl-color-panel-deep)', borderRadius: '0.4rem', height: '0.7rem', overflow: 'hidden' } },
      createElement('div', {
        style: {
          background: color,
          height: '100%',
          width: widthFor(value),
        },
      }),
    ),
  )

  return createElement(
    'section',
    { 'aria-label': 'Portfolio vs benchmark comparison', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Relative performance'),
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.6rem' } }, `Portfolio vs ${benchmarkSymbol}`),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.9rem' } },
      bar('Portfolio', portfolio, portfolio >= 0 ? '#34d399' : '#f87171'),
      bar(`Benchmark (${benchmarkSymbol})`, benchmark, '#e8c97a'),
    ),
  )
}

function createBenchmarkPendingCard(report: AppPerformanceReport, reason?: string) {
  const message = reason ?? 'Benchmark data unavailable / pending price feed.'
  return createElement(
    'section',
    {
      'aria-label': 'Benchmark unavailable',
      style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' },
    },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.5rem' } }, `Benchmark (${report.benchmark_symbol}) pending`),
    createElement('p', { style: { color: 'var(--owl-color-amber)', fontWeight: 700, margin: 0 } }, message),
  )
}

function createInsufficientView(report: AppPerformanceReport) {
  const reason = report.performance.sufficient ? '' : report.performance.reason
  return createElement(
    'section',
    {
      'aria-label': 'Insufficient performance data',
      style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' },
    },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.5rem' } }, 'Performance pending'),
    createElement('p', { style: { color: 'var(--owl-color-amber)', fontWeight: 700, margin: '0 0 0.4rem' } }, reason),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', margin: 0 } },
      `Record valuation snapshots over at least two months to compute a time-weighted return vs ${report.benchmark_label}.`,
    ),
  )
}

function createDisclaimer(report: AppPerformanceReport) {
  return createElement(
    'details',
    { 'aria-label': 'Performance limitations', style: { ...cardStyle, background: 'rgba(251, 191, 36, 0.08)', borderColor: 'rgba(251, 191, 36, 0.28)' } },
    createElement('summary', { style: { color: 'var(--owl-color-amber)', cursor: 'pointer', fontSize: 'var(--owl-text-md)', fontWeight: 900 } }, 'Performance methodology and limitations'),
    createElement(
      'ul',
      { style: { color: 'var(--owl-color-amber)', display: 'grid', gap: '0.4rem', margin: '0.8rem 0 0', paddingLeft: '1.25rem' } },
      createElement('li', { key: 'benchmark-label' }, `Benchmark: ${report.benchmark_label} (${report.benchmark_symbol}). Local accounting aid, not a broker statement.`),
      ...report.limitations.map((limitation) => createElement('li', { key: limitation }, limitation)),
    ),
  )
}
