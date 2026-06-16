import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import {
  AppShell,
  EmptyState,
  FinancialNumber,
  OwlButtonLink,
  OwlCard,
  OwlGaugeBar,
  OwlKpiStat,
  OwlRingGauge,
  OwlValuationChip,
  PageHeader,
  SourceChip,
  BOUNDARIES_FOOTER_TEXT,
} from '../designSystem'
import { AppNavigation } from '../AppNavigation'
import { StatusBadge } from '../StatusBadge'

describe('phase 3 design system primitives', () => {
  it('renders the global app shell with product-grade operating context chips', () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement('main', null, 'Workflow content')))

    expect(html).toContain('data-owl-shell="clean-sidebar"')
    expect(html).toContain('owl-shell-context-bar')
    expect(html).toContain('Local ledger')
    expect(html).toContain('Provider readiness')
    expect(html).toContain('Route-aware')
    expect(html).not.toContain('status shown below')
    expect(html).not.toContain('LOCAL WORKSPACE')
    expect(html).not.toContain('policy-gated')
    expect(html).toContain('Workflow content')
  })

  it('renders the honest-boundaries footer on every page via the app shell', () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement('main', null, 'Workflow content')))
    expect(html).toContain('owl-boundaries-footer')
    expect(html).toContain(BOUNDARIES_FOOTER_TEXT)
    expect(html).toContain('Automated output is a draft or observation — never a recommendation to act.')
    expect(html).toContain('Every irreversible transition is human-authored.')
  })

  it('renders persistent navigation with dark-shell route pills and command affordance', () => {
    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('aria-label="Primary Owlfolio navigation"')
    expect(html).toContain('class="owl-nav-link owl-focusable"')
    expect(html).toContain('Command Center')
    expect(html).toContain('Watchlist')
    expect(html).toContain('Settings')
    expect(html).toContain('⌘K')
    expect(html).toContain('Audit trail search')
    expect(html).not.toContain('>Onboarding</a>')
  })

  it('renders setup status in the sidebar when personal-local setup is incomplete', () => {
    const html = renderToStaticMarkup(createElement(AppShell, { isSetupComplete: false }, createElement('main', null, 'Setup needed content')))

    expect(html).toContain('class="owl-setup-card"')
    expect(html).toContain('Setup needed')
    expect(html).toContain('Start setup')
    expect(html).toContain('href="/onboarding"')
    expect(html).toContain('Setup needed content')
  })

  it('renders the persistent active-mode indicator app-wide and subsumes the legacy setup card', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          isSetupComplete: false,
          activeModeStatus: {
            kind: 'provider-not-connected' as const,
            label: 'Personal-local · provider not connected',
            href: '/settings/providers',
          },
        },
        createElement('main', null, 'Workflow content'),
      ),
    )

    // The indicator is present, shows the current state, and is clickable-to-fix.
    expect(html).toContain('data-active-mode-kind="provider-not-connected"')
    expect(html).toContain('Personal-local · provider not connected')
    expect(html).toContain('href="/settings/providers"')
    // The legacy setup card is subsumed — no two conflicting setup affordances.
    expect(html).not.toContain('class="owl-setup-card"')
  })

  it('renders the ready active-mode indicator with provider / model and no fix link', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          activeModeStatus: {
            kind: 'ready' as const,
            label: 'Personal-local · openrouter / claude-opus-4.8',
          },
        },
        createElement('main', null, 'Workflow content'),
      ),
    )

    expect(html).toContain('data-active-mode-kind="ready"')
    expect(html).toContain('Personal-local · openrouter / claude-opus-4.8')
    expect(html).not.toContain('class="owl-setup-card"')
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
    expect(css).toContain('grid-template-columns: minmax(15rem, 17.5rem) minmax(0, 1fr)')
    expect(css).toContain('.owl-nav-shell')
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain('overflow-x: auto')
  })

  it('defines gold-forward token and utility CSS invariants', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8')

    // Semantic gold tokens
    expect(css).toContain('--owl-color-gold:')
    expect(css).toContain('--owl-color-gold-bright:')
    expect(css).toContain('--owl-color-gold-vivid:')
    // Amber tokens
    expect(css).toContain('--owl-color-amber:')
    expect(css).toContain('--owl-color-amber-muted:')
    // Risk bright
    expect(css).toContain('--owl-color-risk-bright:')
    // Utility classes
    expect(css).toContain('.owl-figure-gold')
    expect(css).toContain('.owl-figure-emerald')
    expect(css).toContain('.owl-figure-risk')
    expect(css).toContain('.owl-figure-amber')
    // New component classes
    expect(css).toContain('.owl-ring-gauge')
    expect(css).toContain('.owl-kpi-stat')
    expect(css).toContain('.owl-valuation-chip')
    expect(css).toContain('.owl-gauge-bar')
  })

  it('renders OwlRingGauge with correct aria-label and percentage text', () => {
    const html75 = renderToStaticMarkup(createElement(OwlRingGauge, { value: 0.75, label: 'Health', tone: 'gold' }))
    expect(html75).toContain('75%')
    expect(html75).toContain('aria-label="Health: 75%"')
    expect(html75).toContain('owl-ring-gauge')
    expect(html75).toContain('role="img"')

    // 0..100 form
    const html50 = renderToStaticMarkup(createElement(OwlRingGauge, { value: 50, tone: 'emerald' }))
    expect(html50).toContain('50%')

    // Tones are reflected in stroke colour
    const htmlRisk = renderToStaticMarkup(createElement(OwlRingGauge, { value: 0.2, tone: 'risk' }))
    expect(htmlRisk).toContain('#f87171')

    const htmlAmber = renderToStaticMarkup(createElement(OwlRingGauge, { value: 0.6, tone: 'amber' }))
    expect(htmlAmber).toContain('#f0b429')
  })

  it('renders OwlKpiStat with label, gold value, and optional delta', () => {
    const html = renderToStaticMarkup(createElement(OwlKpiStat, {
      label: 'Portfolio NAV',
      value: '$124,500',
      delta: '+2.4%',
      deltaTone: 'up',
      tone: 'gold',
    }))
    expect(html).toContain('Portfolio NAV')
    expect(html).toContain('$124,500')
    expect(html).toContain('+2.4%')
    expect(html).toContain('owl-kpi-stat-value-gold')
    expect(html).toContain('owl-kpi-stat-delta-up')
    expect(html).toContain('▲')

    // Down delta
    const htmlDown = renderToStaticMarkup(createElement(OwlKpiStat, {
      label: 'Loss',
      value: '-$300',
      delta: '-1.2%',
      deltaTone: 'down',
      tone: 'risk',
    }))
    expect(htmlDown).toContain('owl-kpi-stat-value-risk')
    expect(htmlDown).toContain('owl-kpi-stat-delta-down')
    expect(htmlDown).toContain('▼')

    // No delta renders cleanly
    const htmlNoDelta = renderToStaticMarkup(createElement(OwlKpiStat, { label: 'Cash', value: '$10,000' }))
    expect(htmlNoDelta).toContain('Cash')
    expect(htmlNoDelta).not.toContain('owl-kpi-stat-delta')
  })

  it('renders OwlValuationChip with correct class and aria-label for every kind', () => {
    const kinds = ['undervalued', 'overvalued', 'fair', 'approved', 'watch'] as const

    for (const kind of kinds) {
      const html = renderToStaticMarkup(createElement(OwlValuationChip, { kind }))
      expect(html, kind).toContain(`owl-valuation-chip-${kind}`)
      expect(html, kind).toContain('role="status"')
      expect(html, kind).toContain('owl-valuation-chip-dot')
    }

    // Custom label
    const htmlCustom = renderToStaticMarkup(createElement(OwlValuationChip, { kind: 'overvalued', label: 'OVERVALUED 38%' }))
    expect(htmlCustom).toContain('OVERVALUED 38%')
    expect(htmlCustom).toContain('aria-label="OVERVALUED 38%"')

    // Default labels
    const htmlApproved = renderToStaticMarkup(createElement(OwlValuationChip, { kind: 'approved' }))
    expect(htmlApproved).toContain('WAHED-APPROVED')

    const htmlFair = renderToStaticMarkup(createElement(OwlValuationChip, { kind: 'fair' }))
    expect(htmlFair).toContain('FAIR VALUE')
  })

  it('renders OwlGaugeBar with label, value text, and marker', () => {
    const html = renderToStaticMarkup(createElement(OwlGaugeBar, { value: 0.35, label: 'Risk' }))
    expect(html).toContain('Risk')
    expect(html).toContain('35%')
    expect(html).toContain('owl-gauge-bar-track')
    expect(html).toContain('owl-gauge-bar-marker')
    // Low value → emerald marker
    expect(html).toContain('#34d399')

    // High value → red marker
    const htmlHigh = renderToStaticMarkup(createElement(OwlGaugeBar, { value: 0.8 }))
    expect(htmlHigh).toContain('#f87171')
    expect(htmlHigh).toContain('80%')
  })

  it('keeps workflow route pages inside the phase-3 dark shell instead of legacy full-page light/green surfaces', () => {
    const pagePaths = [
      'apps/web/src/app/accounting/monthly/page.tsx',
      'apps/web/src/app/audit/page.tsx',
      'apps/web/src/app/portfolio/page.tsx',
      'apps/web/src/app/providers/page.tsx',
      'apps/web/src/app/purification/page.tsx',
      'apps/web/src/app/research/[caseId]/page.tsx',
      'apps/web/src/app/settings/data-safety/page.tsx',
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
