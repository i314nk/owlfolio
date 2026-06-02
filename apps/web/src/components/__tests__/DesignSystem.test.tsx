import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import { AppShell, EmptyState, FinancialNumber, OwlButtonLink, OwlCard, PageHeader, SourceChip } from '../designSystem'
import { AppNavigation } from '../AppNavigation'
import { StatusBadge } from '../StatusBadge'

describe('phase 3 design system primitives', () => {
  it('renders the global app shell with product-grade operating context chips', () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement('main', null, 'Workflow content')))

    expect(html).toContain('data-owl-shell="phase3-professional"')
    expect(html).toContain('owl-shell-context-bar')
    expect(html).toContain('Local ledger')
    expect(html).toContain('Provider readiness')
    expect(html).toContain('Route-aware')
    expect(html).not.toContain('status shown below')
    expect(html).not.toContain('LOCAL WORKSPACE')
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

  it('renders reusable card, button, status, source, and financial-number treatments', () => {
    const html = renderToStaticMarkup(createElement(
      'section',
      null,
      createElement(OwlCard, { eyebrow: 'Audit' }, 'Evidence panel'),
      createElement(OwlButtonLink, { href: '/audit', variant: 'secondary' }, 'Open audit'),
      createElement(StatusBadge, { tone: 'success' }, 'Shariah clear'),
      createElement(StatusBadge, { tone: 'certified' }, 'Certified'),
      createElement(StatusBadge, { tone: 'experimental' }, 'Experimental'),
      createElement(StatusBadge, { tone: 'blocked' }, 'Unsupported'),
      createElement(StatusBadge, { tone: 'draft' }, 'Awaiting user'),
      createElement(StatusBadge, { tone: 'manual' }, 'Manual'),
      createElement(StatusBadge, { tone: 'compliance' }, 'Compliant'),
      createElement(FinancialNumber, { value: 1250000, prefix: '$', suffix: ' NAV' }),
      createElement(SourceChip, { href: '/audit?query=src_cost_10k_2025', id: 'src_cost_10k_2025', label: 'Source' }),
    ))

    expect(html).toContain('class="owl-card"')
    expect(html).toContain('Audit')
    expect(html).toContain('Evidence panel')
    expect(html).toContain('class="owl-button owl-button-secondary owl-focusable"')
    expect(html).toContain('href="/audit"')
    expect(html).toContain('class="owl-status-pill owl-status-success"')
    expect(html).toContain('class="owl-status-pill owl-status-certified"')
    expect(html).toContain('class="owl-status-pill owl-status-experimental"')
    expect(html).toContain('class="owl-status-pill owl-status-blocked"')
    expect(html).toContain('class="owl-status-pill owl-status-draft"')
    expect(html).toContain('class="owl-status-pill owl-status-manual"')
    expect(html).toContain('class="owl-status-pill owl-status-compliance"')
    expect(html).toContain('Shariah clear')
    expect(html).toContain('class="owl-financial-number"')
    expect(html).toContain('$1,250,000 NAV')
    expect(html).toContain('class="owl-source-chip owl-focusable"')
    expect(html).toContain('src_cost_10k_2025')
    expect(html).toContain('href="/audit?query=src_cost_10k_2025"')
  })

  it('renders page headers and empty states as reusable product-grade patterns', () => {
    const html = renderToStaticMarkup(createElement(
      'section',
      null,
      createElement(PageHeader, {
        actions: createElement(OwlButtonLink, { href: '/research/new', variant: 'primary' }, 'Start research'),
        description: 'Monitor provider-backed recommendations with local ledger provenance.',
        eyebrow: 'Workflow',
        title: 'Research pipeline',
      }),
      createElement(EmptyState, {
        description: 'Initialize personal-local mode before recording live decisions.',
        primaryAction: createElement(OwlButtonLink, { href: '/onboarding', variant: 'primary' }, 'Open onboarding'),
        provenance: createElement(SourceChip, { id: 'event_setup_required', label: 'Audit' }),
        secondaryAction: createElement(OwlButtonLink, { href: '/audit', variant: 'secondary' }, 'View audit'),
        title: 'No personal ledger yet',
      }),
    ))

    expect(html).toContain('class="owl-page-header"')
    expect(html).toContain('class="owl-page-eyebrow"')
    expect(html).toContain('Research pipeline')
    expect(html).toContain('Start research')
    expect(html).toContain('class="owl-empty-state"')
    expect(html).toContain('No personal ledger yet')
    expect(html).toContain('class="owl-empty-state-actions"')
    expect(html).toContain('event_setup_required')
  })

  it('defines phase-3 CSS invariants for focus, custom forms, source chips, empty states, and responsive navigation', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8')

    expect(css).toContain('--owl-color-status-certified')
    expect(css).toContain('--owl-color-source-bg')
    expect(css).toContain('.owl-shell-context-bar')
    expect(css).toContain('.owl-shell-context-chip')
    expect(css).toContain('select:focus-visible')
    expect(css).toContain('appearance: none')
    expect(css).toContain('.owl-select-wrap::after')
    expect(css).toContain('.owl-source-chip')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('.owl-empty-state')
    expect(css).toContain('.owl-page-header')
    expect(css).toContain('@media (max-width: 760px)')
    expect(css).toContain('overflow-x: auto')
  })

  it('keeps workflow route pages inside the phase-3 dark shell instead of legacy full-page light/green surfaces', () => {
    const pagePaths = [
      'apps/web/src/app/accounting/monthly/page.tsx',
      'apps/web/src/app/audit/page.tsx',
      'apps/web/src/app/portfolio/page.tsx',
      'apps/web/src/app/providers/page.tsx',
      'apps/web/src/app/purification/page.tsx',
      'apps/web/src/app/research/[caseId]/page.tsx',
      'apps/web/src/app/research/new/ResearchIntakeForm.tsx',
      'apps/web/src/app/watchlist/page.tsx',
      'apps/web/src/app/onboarding/OnboardingWizard.tsx',
    ]

    for (const pagePath of pagePaths) {
      const source = readFileSync(join(process.cwd(), pagePath), 'utf8')
      expect(source, pagePath).not.toContain("minHeight: '100vh'")
      expect(source, pagePath).not.toContain("background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)'")
      expect(source, pagePath).not.toContain("background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)'")
      expect(source, pagePath).not.toContain("color: '#047857'")
    }
  })
})
