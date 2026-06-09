import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

const mockedNavigation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => mockedNavigation.pathname,
}))

import { AppNavigation, isAuditSearchShortcut } from '../AppNavigation'
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
    strategy_status: 'Strategy: Buffett-Munger default',
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
    approval_queue: [],
    holding_review_prompts: [],
    recent_activity: [],
    primary_action: { href: '/research/rc_cost_001', label: 'Open latest research case' },
    ...overrides,
  }
}

describe('AppNavigation', () => {
  it('renders desktop sidebar navigation for first-class app areas without permanent onboarding', () => {
    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('aria-label="Primary Owlfolio navigation"')
    expect(html).toContain('class="owl-nav-section-title"')
    expect(html).toContain('href="/"')
    expect(html).toContain('Command Center')
    expect(html).toContain('href="/research"')
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
    expect(html).toContain('href="/audit?focus=1"')
    expect(html).toContain('Audit trail search')
    expect(html).toContain('href="/providers"')
    expect(html).toContain('Providers')
    expect(html).toContain('href="/learn"')
    expect(html).toContain('Learn')
    expect(html).toContain('href="/settings/data-safety"')
    expect(html).toContain('Settings')
    expect(html).not.toContain('class="owl-nav-link owl-focusable" href="/onboarding"')
    expect(html).not.toContain('>Onboarding</a>')
  })

  it('surfaces setup as a sidebar CTA when onboarding is incomplete', () => {
    const html = renderToStaticMarkup(createElement(AppNavigation, { isSetupComplete: false }))

    expect(html).toContain('class="owl-setup-card"')
    expect(html).toContain('Setup needed')
    expect(html).toContain('Start setup')
    expect(html).toContain('href="/onboarding"')
  })


  it('marks the current route as the active navigation destination', () => {
    mockedNavigation.pathname = '/portfolio'

    const html = renderToStaticMarkup(createElement(AppNavigation))

    expect(html).toContain('href="/portfolio" aria-current="page"')
    expect(html).toContain('class="owl-nav-link owl-nav-link-active owl-focusable"')
    expect(html).not.toContain('href="/" aria-current="page"')
  })

  it('matches the audit search keyboard shortcut for ctrl or cmd with K', () => {
    expect(
      isAuditSearchShortcut({
        key: 'k',
        ctrlKey: true,
      }),
    ).toBe(true)

    expect(
      isAuditSearchShortcut({
        key: 'k',
        metaKey: true,
      }),
    ).toBe(true)
  })

  it('ignores non-shortcut key combinations for the audit search trigger', () => {
    expect(isAuditSearchShortcut({ key: 'k' })).toBe(false)
    expect(isAuditSearchShortcut({ key: 's', ctrlKey: true })).toBe(false)
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
      expect(html).toContain('Buffett-Munger default')
      expect(html).toContain('SQLite durable event source')
      expect(html).toContain('Research cases')
      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('Confirmed watchlist')
      expect(html).toContain('Open holdings')
      expect(html).toContain('class="owl-financial-number"')
      expect(html).toContain('Owlfolio prepares evidence-backed recommendations and automation reminders; you confirm the decisions that change portfolio state.')
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
    expect(html).toContain('Strategy: Buffett-Munger default')
    expect(html).toContain('Ledger: not initialized yet')
    expect(html).toContain('Complete onboarding and initialize the personal local ledger')
    expect(html).toContain('Continue setup')
  })

  it('frames the landing page as an automation-first local candidate with obvious workflow routes and trust signals', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        pipeline_counts: {
          research_cases: 3,
          watchlist_drafts: 2,
          confirmed_watchlist_items: 1,
          open_holdings: 1,
          pending_user_actions: 2,
        },
        next_recommended_action: 'Review COST watchlist draft and confirm it',
        primary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
        secondary_action: { href: '/research', label: 'Open research cockpit' },
      }),
    }))

    expect(html).toContain('Automation-first local candidate')
    expect(html).toContain('Local-first investment workflow OS for strategy research, watchlist, and portfolio decisions.')
    expect(html).toContain('aria-label="Command cockpit overview"')
    expect(html).toContain('Main operating priority')
    expect(html).toContain('Decision gate')
    expect(html).toContain('Approval required before state changes')
    expect(html).toContain('Workflow launchpad')
    expect(html).toContain('Research lab')
    expect(html).toContain('Watchlist desk')
    expect(html).toContain('Portfolio cockpit')
    expect(html).toContain('Audit trail')
    expect(html).toContain('href="/research"')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('href="/portfolio"')
    expect(html).toContain('href="/audit"')
    expect(html).toContain('Shariah-aware')
    expect(html).toContain('Fiduciary confirmation')
    expect(html).toContain('Evidence-backed automation')
  })

  it('keeps backup and restore positioned as a Learn-linked operator runbook rather than a dashboard workflow', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard: makeDashboard() }))

    expect(html).toContain('Operator fallback')
    expect(html).toContain('Runbook-only backup/restore')
    expect(html).toContain('Operator-managed backups stay outside the main decision queue.')
    expect(html).toContain('href="/learn#fallback"')
    expect(html).toContain('Learn fallback runbook')
    expect(html).not.toContain('Restore portfolio data')
    expect(html).not.toContain('Start restore')
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
      expect(html).toContain('Local assistant setup needed')
      expect(html).toContain('Research cases')
      expect(html).toContain('0')
      expect(html).toContain('Review discovery, quick screen, and manual intake options before seeding the durable workflow ledger.')
      expect(html).toContain('No confirmed monitoring yet — confirm a watchlist draft before automation treats a company as actively monitored.')
      expect(html).toContain('No open holdings yet — open a holding from a confirmed watchlist item before portfolio accounting starts.')
      expect(html).toContain('No pending approvals; automation is waiting for new provider drafts or due reviews.')
      expect(html).toContain('Open the selected-strategy research cockpit')
      expect(html).toContain('href="/research"')
      expect(html).toContain('Open research cockpit')
      expect(html).toContain('href="/watchlist"')
      expect(html).toContain('Open watchlist drafts')
      expect(html).toContain('Operational awareness')
      expect(html).toContain('Local assistant setup needed')
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
      expect(html).not.toContain('Real-provider readiness incomplete')
      expect(html).not.toContain('Resolve provider readiness')
      expect(html).not.toContain('Resolve real-provider readiness')
      expect(html).toContain('Open latest research case')
    }
  })

  it('surfaces real-provider readiness in initialized personal local mode', async () => {
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
            provider_surface_id: 'claude-cli',
            vendor_id: 'anthropic',
            runtime_kind: 'cli',
            auth_mode: 'cli_cached_session',
            workflow_role: 'research_draft',
            billing_mode: 'subscription_entitlement',
            quota_source: 'subscription_tier',
            quota_status: 'unknown',
            data_policy_source: 'subscription_workspace_policy',
            retention_or_zdr_status: 'not_verified',
            headless_supported: false,
            scheduled_workflow_supported: false,
            automation_suitability: 'personal_local_interactive',
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
              'source-grounding': 'adapter',
              'citation-metadata': 'adapter',
              'url-context': 'unsupported',
              'file-context': 'adapter',
              'source-bundle-production': 'adapter',
              'code-execution': 'unsupported',
              'computer-use': 'unsupported',
              'browser-use': 'unsupported',
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
      expect(html).toContain('Local assistant setup needed')
      expect(html).toContain('Finish local assistant setup')
      expect(html).toContain('Open setup details')
      expect(html).toContain('Owlfolio cannot use the selected local assistant yet. Open provider details for the technical checks, or keep using demo mode while setup is incomplete.')
      expect(html).toContain('href="/providers"')
      expect(html).not.toContain('Review credentials, support level, and certification evidence')
      expect(html).not.toContain('support level, and certification evidence')
      expect(html).not.toContain('Resolve real-provider readiness')
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
    const providerIndex = html.indexOf('Finish local assistant setup')
    const reviewIndex = html.indexOf('Run due holding review')
    const accountingIndex = html.indexOf('Review monthly accounting')
    const purificationIndex = html.indexOf('Check purification obligations')

    expect(html).toContain('Next action queue')
    expect(html).toContain('Priority 1')
    expect(html).toContain('2 drafts need explicit user confirmation before monitoring or portfolio actions.')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('Local assistant setup needed')
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
    expect(html).toContain('class="owl-command-reference-module owl-command-reference-module-accent owl-command-reference-wide-module"')
    expect(html).toContain('class="owl-command-reference-module owl-command-review-schedule-module owl-command-reference-wide-module"')
    expect(html).toContain('class="owl-command-reference-module owl-command-recent-activity-module"')
    expect(html).toContain('Automated monitoring')
    expect(html).toContain('Dry-run worker observations stay local and require user confirmation before portfolio-impacting state changes.')
    expect(html.indexOf('aria-label="Secondary reference modules"')).toBeGreaterThan(html.indexOf('aria-label="Operating action surface"'))
    expect(html.indexOf('aria-label="Review schedule reference module"')).toBeGreaterThan(html.indexOf('aria-label="Accounting reference module"'))
    expect(html.indexOf('aria-label="Operator fallback module"')).toBeGreaterThan(html.indexOf('aria-label="Review schedule reference module"'))
    expect(html.indexOf('aria-label="Operational awareness module"')).toBeGreaterThan(html.indexOf('aria-label="Operator fallback module"'))
    expect(html.indexOf('aria-label="Ledger activity reference module"')).toBeGreaterThan(html.indexOf('aria-label="Operational awareness module"'))
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('href="/accounting/monthly"')
    expect(html).toContain('href="/portfolio#holding_msft_001"')
  })

  it('uses a calm workflow status summary instead of a terminal ticker strip', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard: makeDashboard() }))

    expect(html).toContain('aria-label="Workflow status summary"')
    expect(html).toContain('class="owl-command-status-summary"')
    expect(html).toContain('class="owl-command-status-summary-item"')
    expect(html).not.toContain('Workflow ticker strip')
  })

  it('keeps Command Center accent markup in the Wahed x Hermes palette', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, {
      dashboard: makeDashboard({
        accounting_alert: {
          href: '/accounting/monthly',
          label: 'Monthly accounting report',
          message: 'June 2026 NAV: $2,925.00; 0 holdings missing valuations.',
        },
        recent_activity: [],
      }),
    }))

    expect(html).toContain('Operator fallback')
    expect(html).toContain('rgba(214, 178, 94, 0.08)')
    expect(html).toContain('var(--owl-color-accent-bright)')
    expect(html).not.toContain('#7c8cff')
    expect(html).not.toContain('#0a84ff')
    expect(html).not.toContain('#60a5fa')
    expect(html).not.toContain('#7dd3fc')
    expect(html).not.toContain('rgba(124,140,255')
    expect(html).not.toContain('rgba(124, 140, 255')
    expect(html).not.toContain('rgba(59,130,246')
    expect(html).not.toContain('rgba(59, 130, 246')
    expect(html).not.toContain('rgba(96,165,250')
    expect(html).not.toContain('rgba(96, 165, 250')
  })

  it('documents the Wahed x Hermes command cockpit visual tokens and lower-module alignment CSS', () => {
    const css = readFileSync('apps/web/src/app/globals.css', 'utf8')

    expect(css).toContain('--owl-color-accent: #16a34a;')
    expect(css).toContain('--owl-color-accent-bright: #34d399;')
    expect(css).toContain('--owl-color-fiduciary: #d6b25e;')
    expect(css).toContain('--owl-color-sand: #f3dfb1;')
    expect(css).toContain('radial-gradient(circle at 14% 0%, rgba(22, 163, 74, 0.14), transparent 26rem)')
    expect(css).toContain('.owl-command-reference-grid')
    expect(css).toContain('align-items: stretch;')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));')
    expect(css).toContain('grid-auto-rows: 1fr;')
    expect(css).toContain('.owl-command-reference-module {')
    expect(css).toContain('height: 100%;')
    expect(css).toContain('.owl-command-reference-wide-module,')
    expect(css).toContain('.owl-command-recent-activity-module')
    expect(css).toContain('grid-column: 1 / -1;')
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

  it('renders a grouped approval queue with diffs, actors, evidence, and supported decisions', () => {
    const dashboard: AppCommandCenter = {
      ...makeDashboard({
        pipeline_counts: {
          research_cases: 2,
          watchlist_drafts: 1,
          confirmed_watchlist_items: 0,
          open_holdings: 1,
          pending_user_actions: 3,
        },
        next_recommended_action: 'Review pending proposals',
        primary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
      }),
      approval_queue: [
        {
          id: 'watchlist:wl_msft_001',
          decision_type: 'watchlist_confirmation',
          group_label: 'Watchlist confirmations',
          title: 'MSFT watchlist draft',
          actor_label: 'provider:mock-provider',
          target_label: 'MSFT',
          provider_report_id: 'report_mock_msft_2026_05',
          href: '/watchlist#wl_msft_001',
          audit_event_id: 'evt_watchlist_msft',
          source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025'],
          before_summary: 'MSFT is not user-confirmed for monitoring yet.',
          after_summary: 'Confirm MSFT as a user-approved watchlist item before worker monitoring or portfolio actions.',
          shariah_impact: 'COMPLIANT — allowed.',
          accounting_impact: 'No accounting or holding state changes until a user opens a holding.',
          approve_action_label: 'Review and confirm watchlist draft',
        },
        {
          id: 'holding-review:holding_msft_001:review_msft_001',
          decision_type: 'holding_review',
          group_label: 'Holding review decisions',
          title: 'MSFT strategy review draft',
          actor_label: 'provider:mock-provider',
          target_label: 'MSFT',
          href: '/portfolio#holding_msft_001',
          audit_event_id: 'evt_holding_review_msft',
          source_ids: ['src_msft_10k_2025'],
          before_summary: 'Current thesis health: WATCH; current action stance: RESEARCH_MORE.',
          after_summary: 'Provider proposes thesis health HEALTHY, action stance HOLD, next review 2026-09-30.',
          shariah_impact: 'COMPLIANT — allowed.',
          accounting_impact: 'No accounting values change; only confirmed thesis/review schedule can change after user approval.',
          approve_action_label: 'Apply provider draft',
          reject_action_label: 'Reject provider draft',
          override_action_label: 'Apply user override',
        },
        {
          id: 'worker:task_watchlist_monitor:run_watchlist_monitor_001',
          decision_type: 'worker_proposal',
          group_label: 'Worker proposals',
          title: 'watchlist_monitor worker proposal',
          actor_label: 'worker:watchlist-monitor',
          target_label: 'task_watchlist_monitor',
          href: '/audit?event_id=evt_worker_run_completed#evt_worker_run_completed',
          audit_event_id: 'evt_worker_run_completed',
          source_ids: ['evt_watchlist_msft'],
          provider_run_ids: ['provider_run_watchlist_001'],
          before_summary: 'Worker dry-run did not change portfolio, watchlist, accounting, or trading state.',
          after_summary: 'watchlist_monitor dry-run: 1 confirmed watchlist item monitored; no buy/sell/portfolio action taken',
          shariah_impact: 'Approval gates: open_holding_requires_user_confirmation.',
          accounting_impact: 'Auto-approved actions recorded by the worker: 0.',
        },
      ],
    }

    const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

    expect(html).toContain('Approval queue')
    expect(html).toContain('3 pending proposals grouped by decision type')
    expect(html).toContain('Watchlist confirmations')
    expect(html).toContain('Holding review decisions')
    expect(html).toContain('Worker proposals')
    expect(html).toContain('Actor')
    expect(html).toContain('provider:mock-provider')
    expect(html).toContain('Provider report')
    expect(html).toContain('report_mock_msft_2026_05')
    expect(html).toContain('Before')
    expect(html).toContain('After')
    expect(html).toContain('Shariah impact')
    expect(html).toContain('Accounting impact')
    expect(html).toContain('href="/audit?event_id=evt_watchlist_msft#evt_watchlist_msft"')
    expect(html).toContain('src_msft_10k_2025')
    expect(html).toContain('provider_run_watchlist_001')
    expect(html).toContain('Review and confirm watchlist draft')
    expect(html).toContain('Apply provider draft')
    expect(html).toContain('Reject provider draft')
    expect(html).toContain('Apply user override')
    expect(html).not.toContain('<form')
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
        strategy_status: 'Strategy: Buffett-Munger default',
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
        approval_queue: [],
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
        strategy_status: 'Strategy: Buffett-Munger default',
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
        approval_queue: [],
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

  it('documents Learn page source copy and fallback anchors', () => {
    const learnPageSource = readFileSync('apps/web/src/app/learn/page.tsx', 'utf8')

    expect(learnPageSource).toContain('Learn')
    expect(learnPageSource).toContain('Operator documentation')
    expect(learnPageSource).toContain('Automation boundaries')
    expect(learnPageSource).toContain('automation-first local-use candidate')
    expect(learnPageSource).toContain('default Buffett-Munger strategy')
    expect(learnPageSource).toContain('future selectable strategies')
    expect(learnPageSource).toContain('discovery to quick screen, deep dive, decision, watchlist, and holding state')
    expect(learnPageSource).toContain('automatic portfolio, accounting, and purification projections')
    expect(learnPageSource).toContain('Data Safety boundaries')
    expect(learnPageSource).toContain('What changes and what you confirm')
    expect(learnPageSource).toContain('Provider readiness in one place')
    expect(learnPageSource).toContain('Auditability and traceability')
    expect(learnPageSource).toContain('Shariah screening')
    expect(learnPageSource).toContain('credentials and provider auth homes stay out of backups')
    expect(learnPageSource).toContain('href="/onboarding"')
    expect(learnPageSource).toContain('href="/providers"')
    expect(learnPageSource).toContain('id="fallback"')
  })

  it('documents the /research landing route as a research library entrypoint', () => {
    const researchPageSource = readFileSync('apps/web/src/app/research/page.tsx', 'utf8')

    expect(researchPageSource).toContain('ResearchLibrary')
    expect(researchPageSource).toContain('projectResearchCases')
    expect(researchPageSource).toContain('selectedStrategyLabel')
    // The live stage board now lives on /pipeline; /research must not duplicate it.
    expect(researchPageSource).not.toContain('ResearchPipelineCockpit')
    expect(researchPageSource).not.toContain('Start research intake')
    expect(researchPageSource).not.toContain('Buffett-Munger default')
  })
})
