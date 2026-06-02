import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import { AppShell, FinancialNumber, OwlButtonLink, OwlCard } from '../designSystem'
import { AppNavigation } from '../AppNavigation'
import { StatusBadge } from '../StatusBadge'

describe('phase 2 design system primitives', () => {
  it('renders the global app shell with professional shell markers and non-claiming status strip', () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement('main', null, 'Workflow content')))

    expect(html).toContain('data-owl-shell="phase2-professional"')
    expect(html).toContain('Local workspace')
    expect(html).toContain('Shariah context')
    expect(html).toContain('mode-dependent')
    expect(html).not.toContain('policy-gated')
    expect(html).toContain('Workflow content')
  })

  it('renders persistent navigation with dark-shell route pills and command affordance', () => {
    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('aria-label="Primary Owlfolio navigation"')
    expect(html).toContain('class="owl-nav-link owl-focusable"')
    expect(html).toContain('Command Center')
    expect(html).toContain('Watchlist')
    expect(html).toContain('⌘K')
    expect(html).toContain('Audit trail search')
  })

  it('renders reusable card, button, status, and financial-number treatments', () => {
    const html = renderToStaticMarkup(createElement(
      'section',
      null,
      createElement(OwlCard, { eyebrow: 'Audit' }, 'Evidence panel'),
      createElement(OwlButtonLink, { href: '/audit', variant: 'secondary' }, 'Open audit'),
      createElement(StatusBadge, { tone: 'success' }, 'Shariah clear'),
      createElement(FinancialNumber, { value: 1250000, prefix: '$', suffix: ' NAV' }),
    ))

    expect(html).toContain('class="owl-card"')
    expect(html).toContain('Audit')
    expect(html).toContain('Evidence panel')
    expect(html).toContain('class="owl-button owl-button-secondary owl-focusable"')
    expect(html).toContain('href="/audit"')
    expect(html).toContain('class="owl-status-pill owl-status-success"')
    expect(html).toContain('Shariah clear')
    expect(html).toContain('class="owl-financial-number"')
    expect(html).toContain('$1,250,000 NAV')
  })

  it('keeps legacy light-surface route pages from inheriting the global dark shell background', () => {
    const pagePaths = [
      'apps/web/src/app/accounting/monthly/page.tsx',
      'apps/web/src/app/audit/page.tsx',
      'apps/web/src/app/portfolio/page.tsx',
      'apps/web/src/app/purification/page.tsx',
      'apps/web/src/app/research/[caseId]/page.tsx',
      'apps/web/src/app/watchlist/page.tsx',
    ]

    for (const pagePath of pagePaths) {
      const source = readFileSync(join(process.cwd(), pagePath), 'utf8')
      expect(source, pagePath).toContain("background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)'")
      expect(source, pagePath).toContain("color: '#0f172a'")
      expect(source, pagePath).toContain("color: '#047857'")
    }
  })
})
