import { createElement, type CSSProperties } from 'react'

const navShellStyle: CSSProperties = {
  background: '#ffffff',
  borderBottom: '1px solid #dbeafe',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
  position: 'sticky',
  top: 0,
  zIndex: 10,
}

const navInnerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  justifyContent: 'space-between',
  margin: '0 auto',
  maxWidth: '1120px',
  padding: '0.85rem clamp(1rem, 4vw, 4rem)',
}

const brandStyle: CSSProperties = {
  color: '#047857',
  fontSize: '0.95rem',
  fontWeight: 900,
  letterSpacing: '0.08em',
  textDecoration: 'none',
  textTransform: 'uppercase',
}

const listStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const linkStyle: CSSProperties = {
  border: '1px solid #dbeafe',
  borderRadius: '999px',
  color: '#0f172a',
  display: 'inline-flex',
  fontSize: '0.88rem',
  fontWeight: 800,
  padding: '0.48rem 0.7rem',
  textDecoration: 'none',
}

const navItems = [
  { href: '/', label: 'Command Center' },
  { href: '/research/new', label: 'Research' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/accounting/monthly', label: 'Accounting' },
  { href: '/purification', label: 'Purification' },
  { href: '/audit', label: 'Audit' },
  { href: '/providers', label: 'Providers' },
  { href: '/onboarding', label: 'Onboarding' },
]

export function AppNavigation() {
  return createElement(
    'nav',
    {
      'aria-label': 'Primary Owlfolio navigation',
      style: navShellStyle,
    },
    createElement(
      'div',
      { style: navInnerStyle },
      createElement('a', { href: '/', style: brandStyle }, 'Owlfolio'),
      createElement(
        'ul',
        { style: listStyle },
        ...navItems.map((item) => createElement(
          'li',
          { key: item.href },
          createElement('a', { href: item.href, style: linkStyle }, item.label),
        )),
      ),
    ),
  )
}
