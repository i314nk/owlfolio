import { createElement, type ReactNode } from 'react'

import { AppNavigation } from './AppNavigation'

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
    { className: 'owl-app-shell', 'data-owl-shell': 'clean-sidebar' },
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
