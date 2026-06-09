import { createElement, type ReactNode } from 'react'
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google'

import { AppNavigation } from './AppNavigation'

// Self-hosted (no runtime CDN) refined-luxury type system.
// Display serif for titles/section headings, warm grotesk body, mono for labels/figures.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz'],
})

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

const fontVariableClassName = `${fraunces.variable} ${hanken.variable} ${jetbrains.variable}`

export type AppShellProps = {
  children?: ReactNode
  isSetupComplete?: boolean
}

export type OwlCardProps = {
  children?: ReactNode
  className?: string
  eyebrow?: string
  title?: string
}

export type OwlButtonLinkProps = {
  children?: ReactNode
  href: string
  variant?: 'primary' | 'secondary' | 'danger'
}

export type FinancialNumberProps = {
  maximumFractionDigits?: number
  minimumFractionDigits?: number
  prefix?: string
  suffix?: string
  value: number
}

export type PageHeaderProps = {
  actions?: ReactNode
  description?: ReactNode
  eyebrow?: string
  title: string
}

export type EmptyStateProps = {
  description?: ReactNode
  primaryAction?: ReactNode
  provenance?: ReactNode
  secondaryAction?: ReactNode
  title: string
}

export type SourceChipProps = {
  href?: string
  id: string
  label?: string
}

const shellStatusItems = [
  { label: 'Local ledger', value: 'Route-aware' },
  { label: 'Shariah context', value: 'Policy visible' },
  { label: 'Provider readiness', value: 'Shown inline' },
]

export function AppShell({ children, isSetupComplete = true }: AppShellProps) {
  return createElement(
    'div',
    { className: `owl-app-shell ${fontVariableClassName}`, 'data-owl-shell': 'clean-sidebar' },
    createElement(AppNavigation, { isSetupComplete }),
    createElement(
      'div',
      { className: 'owl-app-frame' },
      createElement(
        'div',
        { 'aria-label': 'Owlfolio operating context', className: 'owl-shell-context-bar' },
        ...shellStatusItems.map((item) => createElement(
          'span',
          { className: 'owl-shell-context-chip', key: item.label },
          createElement('span', { className: 'owl-shell-context-label' }, item.label),
          createElement('span', { className: 'owl-shell-context-value' }, item.value),
        )),
      ),
      createElement('div', { className: 'owl-main-region' }, children),
    ),
  )
}

export function OwlCard({ children, className, eyebrow, title }: OwlCardProps) {
  const classes = className === undefined ? 'owl-card' : `owl-card ${className}`

  return createElement(
    'article',
    { className: classes },
    eyebrow === undefined ? null : createElement('p', { className: 'owl-card-eyebrow' }, eyebrow),
    title === undefined ? null : createElement('h2', { className: 'owl-card-title' }, title),
    children,
  )
}

export function OwlButtonLink({ children, href, variant = 'primary' }: OwlButtonLinkProps) {
  return createElement(
    'a',
    { className: `owl-button owl-button-${variant} owl-focusable`, href },
    children,
  )
}

export function FinancialNumber({
  maximumFractionDigits = 0,
  minimumFractionDigits = 0,
  prefix = '',
  suffix = '',
  value,
}: FinancialNumberProps) {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value)

  return createElement('span', { className: 'owl-financial-number' }, `${prefix}${formatted}${suffix}`)
}

export function PageHeader({ actions, description, eyebrow, title }: PageHeaderProps) {
  return createElement(
    'header',
    { className: 'owl-page-header' },
    createElement(
      'div',
      { className: 'owl-page-header-copy' },
      eyebrow === undefined ? null : createElement('p', { className: 'owl-page-eyebrow' }, eyebrow),
      createElement('h1', { className: 'owl-page-title' }, title),
      description === undefined ? null : createElement('p', { className: 'owl-page-description' }, description),
    ),
    actions === undefined ? null : createElement('div', { className: 'owl-page-actions' }, actions),
  )
}

export type RouteHeaderProps = {
  description?: ReactNode
  kicker: string
  title: string
}

/**
 * Unified page header matching the Strategy/Pipeline page chrome: a gold mono
 * kicker above the refined `owl-page-title`, with an optional description.
 */
export function RouteHeader({ description, kicker, title }: RouteHeaderProps) {
  return createElement(
    'header',
    { className: 'owl-route-header' },
    createElement('p', { className: 'owl-route-kicker' }, kicker),
    createElement('h1', { className: 'owl-page-title' }, title),
    description === undefined ? null : createElement('p', { className: 'owl-page-description' }, description),
  )
}

export function EmptyState({ description, primaryAction, provenance, secondaryAction, title }: EmptyStateProps) {
  const actions = [primaryAction, secondaryAction].filter((action): action is ReactNode => action !== undefined)

  return createElement(
    'section',
    { className: 'owl-empty-state' },
    createElement('p', { className: 'owl-empty-state-kicker' }, 'Awaiting setup'),
    createElement('h2', { className: 'owl-empty-state-title' }, title),
    description === undefined ? null : createElement('p', { className: 'owl-empty-state-description' }, description),
    provenance === undefined ? null : createElement('div', { className: 'owl-empty-state-provenance' }, provenance),
    actions.length === 0 ? null : createElement('div', { className: 'owl-empty-state-actions' }, ...actions),
  )
}

export function SourceChip({ href, id, label = 'Source' }: SourceChipProps) {
  const content = [
    createElement('span', { className: 'owl-source-chip-label', key: 'label' }, label),
    createElement('span', { className: 'owl-source-chip-id', key: 'id' }, id),
  ]

  if (href === undefined) {
    return createElement('span', { className: 'owl-source-chip' }, ...content)
  }

  return createElement('a', { className: 'owl-source-chip owl-focusable', href }, ...content)
}

// ── New gold-forward dashboard components ─────────────────────────────────────

export type OwlRingGaugeTone = 'gold' | 'emerald' | 'risk' | 'amber'

export type OwlRingGaugeProps = {
  /** 0..1 or 0..100 — normalised internally to 0..1 */
  value: number
  label?: string
  tone?: OwlRingGaugeTone
  size?: number
}

const RING_TONE_COLORS: Record<OwlRingGaugeTone, { stroke: string; text: string }> = {
  gold: { stroke: '#e8c97a', text: '#e8c97a' },
  emerald: { stroke: '#34d399', text: '#34d399' },
  risk: { stroke: '#f87171', text: '#f87171' },
  amber: { stroke: '#f0b429', text: '#f0b429' },
}

/**
 * SVG donut/ring gauge.  Renders the percentage in the centre.
 * Dependency-free; SSR-safe (no client-only APIs).
 */
export function OwlRingGauge({ value, label, tone = 'gold', size = 80 }: OwlRingGaugeProps) {
  const norm = value > 1 ? Math.min(value / 100, 1) : Math.min(Math.max(value, 0), 1)
  const pct = Math.round(norm * 100)

  const r = 34
  const cx = 44
  const cy = 44
  const strokeWidth = 7
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - norm)

  const { stroke, text } = RING_TONE_COLORS[tone]
  const trackColor = 'rgba(182,201,173,0.12)'

  // Font size scales with the container
  const pctFontSize = size * 0.22
  const labelFontSize = size * 0.13

  const svgSize = 88 // viewBox units
  const ariaLabel = label !== undefined ? `${label}: ${pct}%` : `${pct}%`

  return createElement(
    'span',
    { className: 'owl-ring-gauge', style: { width: size, height: size } },
    createElement(
      'svg',
      {
        'aria-label': ariaLabel,
        className: 'owl-ring-gauge-svg',
        height: size,
        role: 'img',
        viewBox: `0 0 ${svgSize} ${svgSize}`,
        width: size,
      },
      // Track ring
      createElement('circle', {
        cx,
        cy,
        fill: 'none',
        r,
        stroke: trackColor,
        strokeWidth,
      }),
      // Progress arc
      createElement('circle', {
        cx,
        cy,
        fill: 'none',
        r,
        stroke,
        strokeDasharray: circumference,
        strokeDashoffset: dashOffset,
        strokeLinecap: 'round',
        strokeWidth,
        style: { transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` },
      }),
    ),
    // Centre text (absolute overlay)
    createElement(
      'span',
      { className: 'owl-ring-gauge-center', 'aria-hidden': 'true' },
      createElement(
        'span',
        {
          className: 'owl-ring-gauge-pct',
          style: { color: text, fontSize: pctFontSize },
        },
        `${pct}%`,
      ),
      label !== undefined
        ? createElement(
            'span',
            { className: 'owl-ring-gauge-label', style: { fontSize: labelFontSize } },
            label,
          )
        : null,
    ),
  )
}

export type OwlKpiStatTone = 'gold' | 'emerald' | 'risk'
export type OwlKpiStatDeltaTone = 'up' | 'down' | 'neutral'

export type OwlKpiStatProps = {
  label: string
  value: string
  delta?: string
  deltaTone?: OwlKpiStatDeltaTone
  tone?: OwlKpiStatTone
}

const DELTA_ARROWS: Record<OwlKpiStatDeltaTone, string> = {
  up: '▲',
  down: '▼',
  neutral: '–',
}

/**
 * Dashboard KPI block: small uppercase label, big GOLD value, optional delta.
 */
export function OwlKpiStat({ label, value, delta, deltaTone = 'neutral', tone = 'gold' }: OwlKpiStatProps) {
  const valueClass = `owl-kpi-stat-value owl-kpi-stat-value-${tone}`
  const deltaClass = `owl-kpi-stat-delta owl-kpi-stat-delta-${deltaTone}`

  return createElement(
    'div',
    { className: 'owl-kpi-stat' },
    createElement('p', { className: 'owl-kpi-stat-label' }, label),
    createElement('p', { className: valueClass }, value),
    delta !== undefined
      ? createElement(
          'span',
          { className: deltaClass, 'aria-label': `Change: ${delta}` },
          createElement('span', { 'aria-hidden': 'true' }, DELTA_ARROWS[deltaTone]),
          delta,
        )
      : null,
  )
}

export type OwlValuationKind = 'undervalued' | 'overvalued' | 'fair' | 'approved' | 'watch'

export type OwlValuationChipProps = {
  kind: OwlValuationKind
  label?: string
}

const VALUATION_DEFAULTS: Record<OwlValuationKind, { dot: string; text: string }> = {
  undervalued: { dot: '#86efac', text: 'UNDERVALUED' },
  overvalued: { dot: '#fca5a5', text: 'OVERVALUED' },
  fair: { dot: '#e8c97a', text: 'FAIR VALUE' },
  approved: { dot: '#86efac', text: 'WAHED-APPROVED' },
  watch: { dot: '#f0b429', text: 'WATCH' },
}

/**
 * alphaspread-style valuation status chip.
 * undervalued/approved → emerald, overvalued → red, fair → gold, watch → amber.
 */
export function OwlValuationChip({ kind, label }: OwlValuationChipProps) {
  const { dot, text } = VALUATION_DEFAULTS[kind]
  const displayLabel = label ?? text

  return createElement(
    'span',
    {
      className: `owl-valuation-chip owl-valuation-chip-${kind}`,
      role: 'status',
      'aria-label': displayLabel,
    },
    createElement('span', {
      className: 'owl-valuation-chip-dot',
      style: { background: dot },
      'aria-hidden': 'true',
    }),
    displayLabel,
  )
}

export type OwlGaugeBarProps = {
  /** 0..1 or 0..100 */
  value: number
  label?: string
  height?: number
}

/**
 * Horizontal gradient bar (emerald→amber→red) with a marker.
 * For risk/sentiment visualisation.
 */
export function OwlGaugeBar({ value, label, height = 8 }: OwlGaugeBarProps) {
  const norm = value > 1 ? Math.min(value / 100, 1) : Math.min(Math.max(value, 0), 1)
  const pct = Math.round(norm * 100)

  // Marker colour transitions: emerald < 40 %, amber 40–65 %, red > 65 %
  let markerColor: string
  if (norm < 0.4) {
    markerColor = '#34d399'
  } else if (norm < 0.65) {
    markerColor = '#f0b429'
  } else {
    markerColor = '#f87171'
  }

  return createElement(
    'div',
    { className: 'owl-gauge-bar', 'aria-label': label !== undefined ? `${label}: ${pct}%` : `${pct}%` },
    createElement(
      'div',
      { className: 'owl-gauge-bar-track-wrap', style: { height } },
      createElement('div', { className: 'owl-gauge-bar-track' }),
      createElement('div', {
        className: 'owl-gauge-bar-marker',
        style: { left: `${norm * 100}%`, background: markerColor },
      }),
    ),
    createElement(
      'div',
      { className: 'owl-gauge-bar-meta' },
      label !== undefined
        ? createElement('span', { className: 'owl-gauge-bar-label' }, label)
        : createElement('span', {}),
      createElement('span', { className: 'owl-gauge-bar-value' }, `${pct}%`),
    ),
  )
}
