'use client'

import { useEffect } from 'react'
import { createElement, type FunctionComponent, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

import { ActiveModeIndicator } from './ActiveModeIndicator'
import type { ActiveModeStatus } from '../lib/activeModeStatus'

type NavItem = { href: string; label: string }

type NavSection = { title: string; items: NavItem[] }

const navSections: NavSection[] = [
  {
    title: 'Workflow',
    items: [
      { href: '/', label: 'Command Center' },
      { href: '/research', label: 'Research' },
      { href: '/lifecycle', label: 'Lifecycle' },
      { href: '/watchlist', label: 'Watchlist' },
      { href: '/portfolio', label: 'Portfolio' },
    ],
  },
  {
    title: 'Books & compliance',
    items: [
      { href: '/accounting/monthly', label: 'Accounting' },
      { href: '/performance', label: 'Performance' },
      { href: '/purification', label: 'Purification' },
    ],
  },
  {
    title: 'Operations & evidence',
    items: [
      { href: '/pipeline', label: 'Pipeline' },
      { href: '/calibration', label: 'Calibration' },
      { href: '/audit', label: 'Audit' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { href: '/learn', label: 'Learn' },
      // Single provider surface: keys + connections + trust/certification all live here now.
      { href: '/settings/providers', label: 'Providers' },
      { href: '/settings/automation', label: 'Settings' },
      { href: '/settings/data-safety', label: 'Advanced / Data Safety' },
    ],
  },
]

export type AppNavigationProps = {
  isSetupComplete?: boolean
  /**
   * Resolved persistent mode/provider/model status. When present, the always-on indicator subsumes
   * the legacy setup card: it shows the CURRENT state on every page and is clickable-to-fix on every
   * not-ready state.
   */
  activeModeStatus?: ActiveModeStatus
}

const SEARCH_TRIGGER_HREF = '/audit?focus=1'

export function isAuditSearchShortcut(event: {
  ctrlKey?: boolean
  metaKey?: boolean
  key?: string
}): boolean {
  if (!(event.ctrlKey || event.metaKey)) {
    return false
  }

  return typeof event.key === 'string' && event.key.toLowerCase() === 'k'
}

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/'
  }

  if (href === '/research') {
    return pathname.startsWith('/research')
  }

  if (href === '/accounting/monthly') {
    return pathname.startsWith('/accounting')
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

export const AppNavigation: FunctionComponent<AppNavigationProps> = function AppNavigation({ isSetupComplete = true, activeModeStatus }: AppNavigationProps) {
  const pathname = usePathname() ?? '/'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAuditSearchShortcut(event)) {
        return
      }

      const target = event.target as Element | null
      if (
        target instanceof HTMLElement
        && (
          target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable
          || target.closest('[contenteditable="true"]') !== null
        )
      ) {
        return
      }

      event.preventDefault()
      window.location.href = SEARCH_TRIGGER_HREF
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return createElement(
    'nav',
    {
      'aria-label': 'Primary Owlfolio navigation',
      className: 'owl-nav-shell',
    },
    createElement(
      'div',
      { className: 'owl-nav-inner' },
      createElement(
        'a',
        { className: 'owl-brand-mark owl-focusable', href: '/' },
        createElement('span', { 'aria-hidden': true, className: 'owl-brand-orb' }, 'O'),
        createElement(
          'span',
          { className: 'owl-brand-copy' },
          createElement('span', { className: 'owl-brand-title' }, 'Owlfolio'),
          createElement('span', { className: 'owl-brand-kicker' }, 'Fiduciary command center'),
        ),
      ),
      // Persistent, app-wide mode/provider/model indicator. Subsumes the legacy setup card: it is
      // always on screen and clickable-to-fix on every not-ready state.
      activeModeStatus === undefined
        ? null
        : createElement(ActiveModeIndicator, { status: activeModeStatus }),
      createElement(
        'div',
        { className: 'owl-nav-sections' },
        ...navSections.map((section) => renderNavSection(section.title, section.items, pathname)),
      ),
      // Legacy fallback only when no status was resolved (e.g. callers not yet wired to S2).
      activeModeStatus === undefined && !isSetupComplete ? createElement(SetupCard) : null,
      createElement(
        'a',
        { className: 'owl-command-trigger owl-focusable', href: SEARCH_TRIGGER_HREF, 'aria-label': 'Audit trail search with keyboard shortcut ⌘K' },
        createElement('span', null, 'Audit trail search'),
        createElement('span', { className: 'owl-command-key' }, '⌘K'),
      ),
    ),
  )
}

function renderNavSection(
  title: string,
  items: NavItem[],
  pathname: string,
): ReactNode {
  return createElement(
    'section',
    { className: 'owl-nav-section', key: title },
    createElement('p', { className: 'owl-nav-section-title' }, title),
    createElement(
      'ul',
      { className: 'owl-nav-list' },
      ...items.map((item) => {
        const isActive = isActiveRoute(pathname, item.href)
        return createElement(
          'li',
          { key: item.href },
          createElement(
            'a',
            {
              className: isActive ? 'owl-nav-link owl-nav-link-active owl-focusable' : 'owl-nav-link owl-focusable',
              href: item.href,
              ...(isActive ? { 'aria-current': 'page' } : {}),
            },
            item.label,
          ),
        )
      }),
    ),
  )
}

function SetupCard() {
  return createElement(
    'section',
    { 'aria-label': 'Owlfolio setup status', className: 'owl-setup-card' },
    createElement('p', { className: 'owl-setup-card-kicker' }, 'Setup needed'),
    createElement('h2', { className: 'owl-setup-card-title' }, 'Start your local workspace'),
    createElement('p', { className: 'owl-setup-card-copy' }, 'Choose demo mode or connect a local AI assistant before personal ledger workflows begin.'),
    createElement('a', { className: 'owl-setup-card-action owl-focusable', href: '/onboarding' }, 'Start setup'),
  )
}
