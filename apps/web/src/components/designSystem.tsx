import { createElement, type ReactNode } from 'react'

import { AppNavigation } from './AppNavigation'

export type AppShellProps = {
  children?: ReactNode
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

const shellStatusItems = [
  { label: 'Local workspace', value: 'status shown below' },
  { label: 'Shariah context', value: 'mode-dependent' },
  { label: 'Provider readiness', value: 'route-specific' },
]

export function AppShell({ children }: AppShellProps) {
  return createElement(
    'div',
    { className: 'owl-app-shell', 'data-owl-shell': 'phase2-professional' },
    createElement(AppNavigation),
    createElement(
      'div',
      { className: 'owl-app-frame' },
      createElement(
        'div',
        { 'aria-label': 'Owlfolio operating status', className: 'owl-status-strip' },
        ...shellStatusItems.map((item) => createElement(
          'span',
          { key: item.label },
          createElement('strong', null, item.label),
          ` · ${item.value}`,
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
