'use client'

import { useEffect } from 'react'
import { createElement, type FunctionComponent, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

import { ActiveModeIndicator } from './ActiveModeIndicator'
import type { ActiveModeStatus } from '../lib/activeModeStatus'
import type { ModelSwitcher } from '../lib/resolveModelSwitcher'

type NavItem = { href: string; label: string }

type NavSection = { title: string; items: NavItem[] }

const navSections: NavSection[] = [
  {
    title: 'Workflow',
    items: [
      { href: '/', label: 'Command Center' },
      // The 13F superinvestor page — the idea source at the TOP of the funnel (owner, 2026-07-16:
      // renamed from 'Discovery' and moved into the workflow group; the route stays /discovery).
      { href: '/discovery', label: 'Superinvestors' },
      { href: '/research', label: 'Research' },
      { href: '/watchlist', label: 'Watchlist' },
      { href: '/portfolio', label: 'Portfolio' },
      // B7 (book alignment): the passive index foundation — plan, contributions, drift; no sell control.
      { href: '/passive', label: 'Passive' },
    ],
  },
  {
    title: 'Operations & evidence',
    items: [
      { href: '/pipeline', label: 'Pipeline' },
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

/**
 * The brand mark: an open owner's manual with a gold ribbon bookmark — drawn inline so it rides
 * the design tokens and needs no asset pipeline. Sits on the emerald orb gradient.
 */
function BrandBookMark(): ReactNode {
  return createElement(
    'svg',
    { 'aria-hidden': true, fill: 'none', height: 20, viewBox: '0 0 24 24', width: 20, xmlns: 'http://www.w3.org/2000/svg' },
    // The open book: two soft-curved page spreads meeting at the spine.
    createElement('path', {
      d: 'M3 6 C6 4.6 9 4.8 12 6.4 C15 4.8 18 4.6 21 6 V17.4 C18 16 15 16 12 17.6 C9 16 6 16 3 17.4 Z',
      stroke: '#f8fafc',
      strokeLinejoin: 'round',
      strokeWidth: 1.7,
    }),
    createElement('path', { d: 'M12 6.4 V17.6', stroke: '#f8fafc', strokeLinecap: 'round', strokeWidth: 1.7 }),
    // The gold ribbon bookmark on the right-hand page.
    createElement('path', {
      d: 'M16.2 5.1 V10.4 L17.8 9 L19.4 10.4 V5.3',
      stroke: 'var(--owl-color-gold-bright, #f0c96a)',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.5,
    }),
  )
}

export type AppNavigationProps = {
  isSetupComplete?: boolean
  /**
   * Resolved persistent mode/provider/model status. When present, the always-on indicator subsumes
   * the legacy setup card: it shows the CURRENT state on every page and is clickable-to-fix on every
   * not-ready state.
   */
  activeModeStatus?: ActiveModeStatus
  /**
   * When ≥2 models are reachable across connected providers, the indicator becomes an interactive grouped
   * model switcher. Resolved server-side by `resolveModelSwitcher`; absent → the plain status indicator.
   */
  modelSwitcher?: ModelSwitcher
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

export const AppNavigation: FunctionComponent<AppNavigationProps> = function AppNavigation({ isSetupComplete = true, activeModeStatus, modelSwitcher }: AppNavigationProps) {
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
      'aria-label': 'Primary Owner’s Manual navigation',
      className: 'owl-nav-shell',
    },
    createElement(
      'div',
      { className: 'owl-nav-inner' },
      createElement(
        'a',
        { className: 'owl-brand-mark owl-focusable', href: '/' },
        createElement('span', { 'aria-hidden': true, className: 'owl-brand-orb' }, createElement(BrandBookMark)),
        createElement(
          'span',
          { className: 'owl-brand-copy' },
          createElement('span', { className: 'owl-brand-title' }, 'Owner’s Manual'),
          createElement('span', { className: 'owl-brand-kicker' }, 'Fiduciary command center'),
        ),
      ),
      // Persistent, app-wide mode/provider/model indicator. Subsumes the legacy setup card: it is
      // always on screen and clickable-to-fix on every not-ready state.
      activeModeStatus === undefined
        ? null
        : createElement(ActiveModeIndicator, {
            status: activeModeStatus,
            ...(modelSwitcher === undefined ? {} : { modelSwitcher }),
          }),
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
    { 'aria-label': 'Owner’s Manual setup status', className: 'owl-setup-card' },
    createElement('p', { className: 'owl-setup-card-kicker' }, 'Setup needed'),
    createElement('h2', { className: 'owl-setup-card-title' }, 'Start your local workspace'),
    createElement('p', { className: 'owl-setup-card-copy' }, 'Connect a local AI assistant before personal ledger workflows begin.'),
    createElement('a', { className: 'owl-setup-card-action owl-focusable', href: '/settings/providers' }, 'Start setup'),
  )
}
