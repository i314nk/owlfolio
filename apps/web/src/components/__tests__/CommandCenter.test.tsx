import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

const mockedNavigation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => mockedNavigation.pathname,
}))

import { AppNavigation } from '../AppNavigation'
import { CommandCenter } from '../CommandCenter'
import { getDemoCommandCenterFromStore, getSetupAwareCommandCenter, seedDemoLedger, type AppCommandCenter } from '../../lib/demo'

beforeEach(() => {
  mockedNavigation.pathname = '/'
})

function makeDashboard(overrides: Partial<AppCommandCenter> = {}): AppCommandCenter {
  return {
    product_name: 'Owlfolio',
    setup_status: 'Personal local mode initialized',
    provider_status: 'Provider: Mock provider personal local mode',
    strategy_status: 'Strategy: Buffett-Munger certified',
    shariah_status: 'Shariah: enabled by default',
    ledger_status: 'Ledger: SQLite durable event source',
    pipeline_counts: {
      research_cases: 1,
      watchlist_drafts: 0,
      confirmed_watchlist_items: 0,
      open_holdings: 0,
      pending_user_actions: 0,
    },
    next_recommended_action: 'Open latest research case',
    holding_review_prompts: [],
    recent_activity: [],
    primary_action: { href: '/research/rc_cost_001', label: 'Open latest research case' },
    ...overrides,
  }
}

describe('AppNavigation', () => {
  it('renders persistent navigation for first-class app areas', () => {
    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('aria-label="Primary Owlfolio navigation"')
    expect(html).toContain('href="/"')
    expect(html).toContain('Command Center')
    expect(html).toContain('href="/research/new"')
    expect(html).toContain('Research')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('Watchlist')
    expect(html).toContain('href="/portfolio"')
    expect(html).toContain('Portfolio')
    expect(html).toContain('href="/accounting/monthly"')
    expect(html).toContain('Accounting')
    expect(html).toContain('href="/purification"')
    expect(html).toContain('Purification')
    expect(html).toContain('href="/audit"')
    expect(html).toContain('Audit')
    expect(html).toContain('href="/providers"')
    expect(html).toContain('Providers')
    expect(html).toContain('href="/onboarding"')
    expect(html).toContain('Onboarding')
  })

  it('marks the current route as the active navigation destination', () => {
    mockedNavigation.pathname = '/portfolio'

    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('href="/portfolio" aria-current="page"')
    expect(html).toContain('class="owl-nav-link owl-nav-link-active owl-focusable"')
    expect(html).not.toContain('href="/" aria-current="page"')
  })
})

describe('CommandCenter', () => {
  it('renders demo workflow status and the next recommended action', async () => {
    const store = new SQLiteEventStore()
    try {
      await seedDemoLedger(store)
      const dashboard = await getDemoCommandCenterFromStore(store)
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('Owlfolio')
      expect(html).toContain('Setup ready')
      expect(html).toContain('Mock provider / demo mode')
      expect(html).toContain('Buffett-Munger certified')
      expect(html).toContain('SQLite durable event source')
      expect(html).toContain('Research cases')
      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('Confirmed watchlist')
      expect(html).toContain('Open holdings')
      expect(html).toContain('class="owl-financial-number"')
      expect(html).toContain('Daily local operating cockpit for autonomous research, user approvals, accounting reminders, purification follow-up, and audit review.')
      expect(html).not.toContain('current Owlfolio v0.2 slice')
      expect(html).toContain('Review COST watchlist draft and confirm it')
      expect(html).toContain('Watchlist draft created')
      expect(html).toContain('class="owl-source-chip-label"')
      expect(html).toContain('Audit event')
      expect(html).toContain('evt_demo_watchlist_001')
      expect(html).not.toContain('watchlist_draft_created by user:user_local')
    } finally {
      store.close()
    }
  })

  it('renders setup-needed status for uninitialized personal local mode', async () => {
    const dashboard = await getSetupAwareCommandCenter({
      config: defaultPersonalLocalAppConfig(),
      is_initialized: false,
    })
    const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

    expect(html).toContain('Setup required')
    expect(html).toContain('Provider: Claude not ready yet')
    expect(html).toContain('Strategy: Buffett-Munger certified')
    expect(html).toContain('Ledger: not initialized yet')
    expect(html).toContain('Complete onboarding and initialize the personal local ledger')
    expect(html).toContain('Continue setup')
  })

  it('renders an empty-state command center for initialized personal local mode', async () => {
    const store = new SQLiteEventStore()
    try {
      const dashboard = await getSetupAwareCommandCenter({
        config: {
          ...defaultPersonalLocalAppConfig(),
          initialized_at: '2026-05-28T12:00:00.000Z',
          ledger_path: ':memory:',
        },
        is_initialized: true,
        store,
      })
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('Personal local mode initialized')
      expect(html).toContain('Provider: Claude unsupported')
      expect(html).toContain('Production/live provider readiness incomplete')
      expect(html).toContain('Research cases')
      expect(html).toContain('0')
      expect(html).toContain('Start a research case to seed the durable workflow ledger.')
      expect(html).toContain('No confirmed monitoring yet — confirm a watchlist draft before automation treats a company as actively monitored.')
      expect(html).toContain('No open holdings yet — open a holding from a confirmed watchlist item before portfolio accounting starts.')
      expect(html).toContain('No pending approvals; automation is waiting for new provider drafts or due reviews.')
      expect(html).toContain('Create or import your first research case')
      expect(html).toContain('href="/research/new"')
      expect(html).toContain('Start first research case')
      expect(html).toContain('href="/watchlist"')
      expect(html).toContain('Open watchlist drafts')
      expect(html).toContain('Operational awareness')
      expect(html).toContain('Provider readiness blocked')
      expect(html).toContain('User approval boundary')
      expect(html).toContain('Operating ledger is empty')
      expect(html).toContain('No research, watchlist, holding, accounting, or purification activity has been recorded yet.')
    } finally {
      store.close()
    }
  })

  it('suppresses production-readiness warnings when the mock provider is sufficient for demo mode', () => {
    const providerStatuses = [
      'Provider: Mock provider experimental — Ready for deterministic demo mode',
      'Provider: Mock provider experimental — Locally runnable through built-in deterministic demo mode',
    ]

    for (const provider_status of providerStatuses) {
      const html = renderToStaticMarkup(createElement(CommandCenter, {
        dashboard: makeDashboard({ provider_status }),
      }))

      expect(html).toContain(provider_status)
      expect(html).not.toContain('Provider readiness warning')
      expect(html).not.toContain('Production/live provider readiness incomplete')
      expect(html).not.toContain('Resolve provider readiness')
      expect(html).not.toContain('Resolve production/live provider readiness')
      expect(html).toContain('Open latest research case')
    }
  })

  it('surfaces production/live provider readiness in initialized personal local mode', async () => {
    const store = new SQLiteEventStore()
    try {
      const dashboard = await getSetupAwareCommandCenter({
        config: {
          ...defaultPersonalLocalAppConfig(),
          initialized_at: '2026-05-28T12:00:00.000Z',
          ledger_path: ':memory:',
        },
        is_initialized: true,
        provider_status_rows: [
          {
            provider_id: 'claude',
            label: 'Claude',
            description: 'Claude CLI personal-local adapter',
            catalog_support_level: 'experimental',
            effective_support_level: 'unsupported',
            readiness_state: 'unready',
            is_ready: false,
            auth_source: 'certification report',
            status_label: 'Claude subscription access disabled',
            model_role: 'Personal-local research/dev fallback',
            limitations: [],
            capabilities: {
              'multi-step-tool-loop': 'unsupported',
              'streaming-observability': 'adapter',
              'structured-output': 'native',
              'text-generation': 'native',
              'tool-function-calling': 'unsupported',
            },
            status_rows: [
              { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable via Claude subscription credentials' },
              { label: 'Credential status', value: 'Credentials blocked by latest certification report', tone: 'danger', description: 'Claude subscription access disabled' },
              { label: 'Catalog support', value: 'experimental', tone: 'warning', description: 'Static provider matrix claim.' },
              { label: 'Effective support', value: 'unsupported', tone: 'danger', description: 'Gating source of truth from latest certification evidence.' },
              { label: 'Workflow certification', value: 'No certification report recorded', tone: 'warning', description: 'No persisted certification evidence exists for this provider.' },
              { label: 'Allowed use', value: 'Blocked for provider-backed workflow starts', tone: 'danger', description: 'Fail-closed until local availability and effective workflow support are both present.' },
            ],
            last_certification_report: undefined,
          },
        ],
        store,
      })
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('Provider: Claude unsupported — Claude subscription access disabled')
      expect(html).toContain('Production/live provider readiness incomplete')
      expect(html).toContain('Resolve production/live provider readiness')
      expect(html).toContain('Open provider setup evidence')
      expect(html).toContain('href="/providers"')
    } finally {
      store.close()
    }
  })

  it('renders direct next-action cards in priority order across workflow warnings and reminders', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        provider_status: 'Provider: Claude not ready yet',
        pipeline_counts: {
          research_cases: 2,
          watchlist_drafts: 2,
          confirmed_watchlist_items: 1,
          open_holdings: 1,
          pending_user_actions: 2,
        },
        next_recommended_action: 'Review COST watchlist draft and confirm it',
        holding_review_prompts: [
          {
            holding_id: 'holding_msft_001',
            label: 'MSFT',
            next_review_at: '2026-05-31',
            status: 'due',
            days_until_review: -2,
          },
        ],
        accounting_alert: {
          label: 'Monthly accounting report',
          message: 'June 2026 NAV: $2,925.00; 0 holdings missing valuations.',
          href: '/accounting/monthly',
        },
        secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
      }),
    }))

    const pendingIndex = html.indexOf('Review pending watchlist drafts')
    const providerIndex = html.indexOf('Resolve production/live provider readiness')
    const reviewIndex = html.indexOf('Run due holding review')
    const accountingIndex = html.indexOf('Review monthly accounting')
    const purificationIndex = html.indexOf('Check purification obligations')

    expect(html).toContain('Next action queue')
    expect(html).toContain('Priority 1')
    expect(html).toContain('2 drafts need explicit user confirmation before monitoring or portfolio actions.')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('Production/live provider readiness incomplete')
    expect(html).toContain('href="/providers"')
    expect(html).toContain('MSFT is 2 days overdue')
    expect(html).toContain('href="/portfolio#holding_msft_001"')
    expect(html).toContain('June 2026 NAV: $2,925.00; 0 holdings missing valuations.')
    expect(html).toContain('href="/purification"')
    expect(pendingIndex).toBeGreaterThan(-1)
    expect(providerIndex).toBeGreaterThan(pendingIndex)
    expect(reviewIndex).toBeGreaterThan(providerIndex)
    expect(accountingIndex).toBeGreaterThan(reviewIndex)
    expect(purificationIndex).toBeGreaterThan(accountingIndex)
  })

  it('separates the operating action surface from lower-priority reference modules', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        pipeline_counts: {
          research_cases: 2,
          watchlist_drafts: 1,
          confirmed_watchlist_items: 1,
          open_holdings: 1,
          pending_user_actions: 1,
        },
        holding_review_prompts: [
          {
            holding_id: 'holding_msft_001',
            label: 'MSFT',
            next_review_at: '2026-10-31',
            status: 'upcoming',
            days_until_review: 153,
          },
        ],
        accounting_alert: {
          label: 'Monthly accounting report',
          message: 'June 2026 NAV: $2,925.00; 0 holdings missing valuations.',
          href: '/accounting/monthly',
        },
        recent_activity: [{ event_id: 'evt_review_override', label: 'holding_review_overridden by user:user_local' }],
        secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
      }),
    }))

    expect(html).toContain('aria-label="Operating action surface"')
    expect(html).toContain('aria-label="Secondary reference modules"')
    expect(html).toContain('aria-label="Accounting reference module"')
    expect(html).toContain('aria-label="Review schedule reference module"')
    expect(html).toContain('aria-label="Operational awareness module"')
    expect(html).toContain('aria-label="Ledger activity reference module"')
    expect(html).toContain('Automated monitoring')
    expect(html).toContain('Dry-run worker observations stay local and require user confirmation before portfolio-impacting state changes.')
    expect(html.indexOf('aria-label="Secondary reference modules"')).toBeGreaterThan(html.indexOf('aria-label="Operating action surface"'))
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('href="/accounting/monthly"')
    expect(html).toContain('href="/portfolio#holding_msft_001"')
  })

  it('renders a direct action card for pending holding review drafts', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        pipeline_counts: {
          research_cases: 2,
          watchlist_drafts: 0,
          confirmed_watchlist_items: 0,
          open_holdings: 1,
          pending_user_actions: 1,
        },
        next_recommended_action: 'Confirm the drafted strategy review for MSFT',
        primary_action: { href: '/portfolio', label: 'Open portfolio' },
      }),
    }))

    expect(html).toContain('Pending holding review draft')
    expect(html).toContain('Review pending strategy review draft')
    expect(html).toContain('Confirm, override, or reject the provider-authored draft before changing confirmed portfolio state.')
    expect(html).toContain('href="/portfolio"')
    expect(html).toContain('Open holding review draft')
  })

  it('humanizes recent ledger activity while preserving audit event traceability', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        recent_activity: [
          { event_id: 'evt_watchlist', label: 'watchlist_draft_created by user:user_local' },
          { event_id: 'evt_review_override', label: 'holding_review_overridden by user:user_local' },
          { event_id: 'evt_unknown', label: 'custom_event_seen by worker:workflow' },
        ],
      }),
    }))

    expect(html).toContain('Watchlist draft created')
    expect(html).toContain('Holding review overridden')
    expect(html).toContain('Custom event seen')
    expect(html).toContain('class="owl-source-chip-label"')
    expect(html).toContain('class="owl-source-chip-id"')
    expect(html).toContain('user:user_local')
    expect(html).toContain('worker:workflow')
    expect(html).toContain('Audit event')
    expect(html).toContain('evt_watchlist')
    expect(html).toContain('evt_review_override')
    expect(html).not.toContain('watchlist_draft_created by user:user_local')
  })

  it('renders a minimal accounting report hook when an accounting alert is present', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: {
        product_name: 'Owlfolio',
        setup_status: 'Personal local mode initialized',
        provider_status: 'Provider: Mock provider personal local mode',
        strategy_status: 'Strategy: Buffett-Munger certified',
        shariah_status: 'Shariah: enabled by default',
        ledger_status: 'Ledger: SQLite durable event source',
        pipeline_counts: {
          research_cases: 1,
          watchlist_drafts: 0,
          confirmed_watchlist_items: 0,
          open_holdings: 1,
          pending_user_actions: 0,
        },
        next_recommended_action: 'Next scheduled strategy review for MSFT is 2026-10-31',
        holding_review_prompts: [],
        accounting_alert: {
          label: 'Monthly accounting report',
          message: 'June 2026 NAV: $2,925.00; 0 holdings missing valuations.',
          href: '/accounting/monthly',
        },
        recent_activity: [{ event_id: 'evt_accounting_snapshot_2026_06', label: 'accounting_snapshot_recorded by worker:monthly-accounting-worker' }],
        primary_action: { href: '/portfolio', label: 'Open portfolio' },
      },
    }))

    expect(html).toContain('Accounting')
    expect(html).toContain('Monthly accounting report')
    expect(html).toContain('June 2026 NAV: $2,925.00; 0 holdings missing valuations.')
    expect(html).toContain('href="/accounting/monthly"')
  })

  it('renders a ledger-backed holding review schedule when next review prompts are available', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: {
        product_name: 'Owlfolio',
        setup_status: 'Personal local mode initialized',
        provider_status: 'Provider: Mock provider personal local mode',
        strategy_status: 'Strategy: Buffett-Munger certified',
        shariah_status: 'Shariah: enabled by default',
        ledger_status: 'Ledger: SQLite durable event source',
        pipeline_counts: {
          research_cases: 1,
          watchlist_drafts: 0,
          confirmed_watchlist_items: 0,
          open_holdings: 1,
          pending_user_actions: 0,
        },
        next_recommended_action: 'Next scheduled strategy review for MSFT is 2026-10-31',
        holding_review_prompts: [
          {
            holding_id: 'holding_msft_001',
            label: 'MSFT',
            next_review_at: '2026-10-31',
            status: 'upcoming',
            days_until_review: 153,
          },
        ],
        recent_activity: [{ event_id: 'evt_review_override', label: 'holding_review_overridden by user:user_local' }],
        primary_action: { href: '/portfolio', label: 'Open portfolio' },
        secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
      },
    }))

    expect(html).toContain('Holding review schedule')
    expect(html).toContain('MSFT')
    expect(html).toContain('Upcoming')
    expect(html).toContain('Next review: 2026-10-31')
    expect(html).toContain('153 days')
    expect(html).toContain('href="/portfolio#holding_msft_001"')
    expect(html).toContain('Review MSFT in portfolio')
  })
})
