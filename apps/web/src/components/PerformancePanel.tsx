import { createElement, type CSSProperties } from 'react'

import type { AppPerformanceReport } from '../lib/performance'
import { OwlKpiStat, RouteHeader } from './designSystem'

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
    performance.sufficient
      ? createSufficientView(report)
      : createInsufficientView(report),
    createDisclaimer(report),
  )
}

function createSufficientView(report: AppPerformanceReport) {
  const performance = report.performance
  if (!performance.sufficient) {
    return null
  }

  const portfolioTone = performance.portfolio_twr > 0 ? 'emerald' : performance.portfolio_twr < 0 ? 'risk' : 'gold'
  const benchmarkAvailable = performance.benchmark_return !== null
  const benchmarkTone = !benchmarkAvailable
    ? 'gold'
    : (performance.benchmark_return ?? 0) > 0 ? 'emerald' : (performance.benchmark_return ?? 0) < 0 ? 'risk' : 'gold'
  const excessTone = !benchmarkAvailable
    ? 'gold'
    : (performance.excess_return ?? 0) > 0 ? 'emerald' : (performance.excess_return ?? 0) < 0 ? 'risk' : 'gold'

  return createElement(
    'div',
    { style: { display: 'grid', gap: '1rem' } },
    createElement(
      'section',
      { 'aria-label': 'Performance summary', className: 'owl-kpi-row' },
      createElement(
        'div',
        { className: 'owl-kpi-panel owl-kpi-panel-gold' },
        createElement(OwlKpiStat, {
          label: `Portfolio return (${performance.period_start} → ${performance.period_end})`,
          value: formatPercent(performance.portfolio_twr),
          tone: portfolioTone,
        }),
      ),
      createElement(
        'div',
        { className: 'owl-kpi-panel' },
        createElement(OwlKpiStat, {
          label: `Benchmark (${report.benchmark_symbol}) return`,
          value: benchmarkAvailable ? formatPercent(performance.benchmark_return ?? 0) : '—',
          tone: benchmarkTone,
        }),
      ),
      createElement(
        'div',
        { className: 'owl-kpi-panel' },
        createElement(OwlKpiStat, {
          label: 'Excess return (portfolio − benchmark)',
          value: benchmarkAvailable ? formatPercent(performance.excess_return ?? 0) : '—',
          tone: excessTone,
        }),
      ),
    ),
    benchmarkAvailable
      ? createComparisonBars(performance.portfolio_twr, performance.benchmark_return ?? 0, report.benchmark_symbol)
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
    { 'aria-label': 'Portfolio vs benchmark comparison', style: cardStyle },
    createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.9rem' } }, `Portfolio vs ${benchmarkSymbol}`),
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
