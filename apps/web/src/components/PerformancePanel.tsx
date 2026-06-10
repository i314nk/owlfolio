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
    createDisclaimer(report),
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
