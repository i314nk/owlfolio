import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { AppNavigation } from '../AppNavigation'
import { CommandCenter } from '../CommandCenter'
import { getDemoCommandCenterFromStore, getSetupAwareCommandCenter, seedDemoLedger } from '../../lib/demo'

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
      expect(html).toContain('Review COST watchlist draft and confirm it')
      expect(html).toContain('watchlist_draft_created by user:user_local')
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
      expect(html).toContain('Provider: Claude personal local mode')
      expect(html).toContain('Research cases')
      expect(html).toContain('0')
      expect(html).toContain('Create or import your first research case')
      expect(html).toContain('href="/research/new"')
      expect(html).toContain('Start first research case')
      expect(html).toContain('href="/watchlist"')
      expect(html).toContain('Open watchlist drafts')
    } finally {
      store.close()
    }
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
