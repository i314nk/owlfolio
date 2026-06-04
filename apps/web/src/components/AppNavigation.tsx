'use client'

import { useEffect } from 'react'
import { createElement } from 'react'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/', label: 'Command Center' },
  { href: '/research/new', label: 'Research' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/accounting/monthly', label: 'Accounting' },
  { href: '/purification', label: 'Purification' },
  { href: '/audit', label: 'Audit' },
  { href: '/providers', label: 'Providers' },
  { href: '/learn', label: 'Learn' },
  { href: '/onboarding', label: 'Onboarding' },
]

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

  if (href === '/research/new') {
    return pathname.startsWith('/research')
  }

  if (href === '/accounting/monthly') {
    return pathname.startsWith('/accounting')
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppNavigation() {
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
      createElement(
        'ul',
        { className: 'owl-nav-list' },
        ...navItems.map((item) => {
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
      createElement(
        'a',
        { className: 'owl-command-trigger owl-focusable', href: SEARCH_TRIGGER_HREF, 'aria-label': 'Audit trail search with keyboard shortcut ⌘K' },
        createElement('span', null, 'Audit trail search'),
        createElement('span', { className: 'owl-command-key' }, '⌘K'),
      ),
    ),
  )
}
