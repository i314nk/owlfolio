import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import * as researchCaseTimelineProjection from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { CommandCenter } from '../CommandCenter'
import { PortfolioPanel } from '../PortfolioPanel'
import { ResearchCasePanel } from '../ResearchCasePanel'
import { WatchlistPanel } from '../WatchlistPanel'
import { getAppWatchlistItemsFromStore, type AppResearchCase, type AppWatchlistItem } from '../../lib/workflow'
import {
  getDemoCommandCenterFromStore,
  getDemoResearchCaseFromStore,
  getDemoWatchlistItemsFromStore,
  seedDemoLedger,
} from '../../lib/demo'

async function withSeededStore<T>(fn: (store: SQLiteEventStore) => Promise<T>): Promise<T> {
  const store = new SQLiteEventStore()
  try {
    await seedDemoLedger(store)
    return await fn(store)
  } finally {
    store.close()
  }
}

describe('research and watchlist workflow pages', () => {
  it('renders a complete demo research case with gates, sources, and next action', async () => {
    const timelineSpy = vi.spyOn(researchCaseTimelineProjection, 'projectResearchCaseTimeline')

    await withSeededStore(async (store) => {
      const researchCase = await getDemoResearchCaseFromStore(store, 'rc_cost_001')

      expect(researchCase.ledger_timeline.map((entry) => entry.event_type)).toEqual([
        'research_case_created',
        'buffett_munger_analysis_drafted',
        'decision_drafted',
        'watchlist_draft_created',
      ])
      expect(researchCase.ledger_timeline[1]).toMatchObject({
        actor_label: 'provider:mock-provider',
        summary: 'WATCH / CONDITIONAL / Shariah COMPLIANT',
      })
      expect(researchCase.source_ids).toContain('src_cost_10k_2025')
      expect(timelineSpy).toHaveBeenCalledTimes(1)

      const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase }))

      expect(html).toContain('COST')
      expect(html).toContain('Workflow stage')
      expect(html).toContain('watchlist_draft')
      expect(html).toContain('Investment verdict')
      expect(html).toContain('WATCH')
      expect(html).toContain('Strategy compliance')
      expect(html).toContain('CONDITIONAL')
      expect(html).toContain('Shariah status')
      expect(html).toContain('COMPLIANT')
      expect(html).toContain('Valuation status')
      expect(html).toContain('FAIR')
      expect(html).toContain('Gate checklist')
      expect(html).toContain('Quality business')
      expect(html).toContain('Source IDs')
      expect(html).toContain('src_cost_10k_2025')
      expect(html).toContain('Ledger Timeline')
      expect(html).toContain('Review COST research case and confirm the watchlist draft')
    })
  })

  it('renders draft watchlist state before user confirmation', async () => {
    await withSeededStore(async (store) => {
      const watchlistItems = await getDemoWatchlistItemsFromStore(store)

      const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: watchlistItems }))

      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('COST')
      expect(html).toContain('buffett-munger')
      expect(html).toContain('Durable quality compounder; wait for better margin of safety.')
      expect(html).toContain('Buy-zone status')
      expect(html).toContain('Not set')
      expect(html).toContain('Draft — awaiting user confirmation')
    })
  })

  it('renders a personal-local watchlist confirmation action only for unapproved drafts', () => {
    const draftItem: AppWatchlistItem = {
      watchlist_item_id: 'watch_msft_001',
      research_case_id: 'rc_msft_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Watch MSFT until the margin of safety improves.',
      user_approved: false,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
      updated_at: '2026-05-31T12:00:00.000Z',
    }

    const personalDraftHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [draftItem],
      mode: 'personal-local',
    }))
    const demoDraftHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [draftItem],
      mode: 'demo',
    }))
    const personalConfirmedHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{
        ...draftItem,
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
      }],
      mode: 'personal-local',
    }))

    expect(personalDraftHtml).toContain('action="/api/watchlist/watch_msft_001/confirm"')
    expect(personalDraftHtml).toContain('method="post"')
    expect(personalDraftHtml).toContain('Confirm watchlist draft')
    expect(demoDraftHtml).not.toContain('Confirm watchlist draft')
    expect(demoDraftHtml).not.toContain('/api/watchlist/watch_msft_001/confirm')
    expect(personalConfirmedHtml).toContain('User confirmed')
    expect(personalConfirmedHtml).not.toContain('Confirm watchlist draft')
    expect(personalConfirmedHtml).not.toContain('/api/watchlist/watch_msft_001/confirm')
  })

  it('renders a personal-local open-holding action only for confirmed watchlist items without holdings', () => {
    const confirmedItem: AppWatchlistItem = {
      watchlist_item_id: 'watch_msft_001',
      research_case_id: 'rc_msft_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Watch MSFT until the margin of safety improves.',
      user_approved: true,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
      confirmed_by_actor_type: 'user',
      confirmed_by_actor_id: 'user_local',
      updated_at: '2026-05-31T12:00:00.000Z',
    }

    const personalConfirmedHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [confirmedItem],
      mode: 'personal-local',
    }))
    const demoConfirmedHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [confirmedItem],
      mode: 'demo',
    }))
    const { confirmed_by_actor_type: _confirmedByActorType, confirmed_by_actor_id: _confirmedByActorId, ...draftItem } = confirmedItem
    const personalDraftHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{ ...draftItem, user_approved: false }],
      mode: 'personal-local',
    }))
    const personalHeldHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{ ...confirmedItem, holding_id: 'holding_msft_001' }],
      mode: 'personal-local',
    }))

    expect(personalConfirmedHtml).toContain('action="/api/watchlist/watch_msft_001/open-holding"')
    expect(personalConfirmedHtml).toContain('method="post"')
    expect(personalConfirmedHtml).toContain('Record initial holding')
    expect(personalConfirmedHtml).toContain('name="shares"')
    expect(personalConfirmedHtml).toContain('name="cost_basis_per_share"')
    expect(personalConfirmedHtml).toContain('name="currency"')
    expect(personalConfirmedHtml).toContain('name="opened_at"')
    expect(demoConfirmedHtml).not.toContain('Record initial holding')
    expect(demoConfirmedHtml).not.toContain('/api/watchlist/watch_msft_001/open-holding')
    expect(personalDraftHtml).not.toContain('Record initial holding')
    expect(personalDraftHtml).not.toContain('/api/watchlist/watch_msft_001/open-holding')
    expect(personalHeldHtml).toContain('Holding recorded')
    expect(personalHeldHtml).not.toContain('Record initial holding')
    expect(personalHeldHtml).not.toContain('/api/watchlist/watch_msft_001/open-holding')
  })

  it('renders an empty personal-local watchlist state', async () => {
    const store = new SQLiteEventStore()
    try {
      const watchlistItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
      const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: watchlistItems }))

      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('Personal local ledger watchlist state.')
      expect(html).toContain('No watchlist drafts yet. Create a research case first.')
    } finally {
      store.close()
    }
  })

  it('renders the personal-local watchlist promotion action only for drafted decisions', () => {
    const decisionDraftedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_001',
      stage: 'decision_drafted',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_msft_001',
      decision: 'WATCH',
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'EXPENSIVE',
      next_required_action: 'Promote the drafted decision into a watchlist draft.',
      updated_at: '2026-05-31T12:00:00.000Z',
      gate_checklist: [],
      source_ids: [],
      ledger_timeline: [],
    }

    const personalHtml = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decisionDraftedResearchCase,
      mode: 'personal-local',
    }))
    const demoHtml = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decisionDraftedResearchCase,
      mode: 'demo',
    }))

    expect(personalHtml).toContain('action="/api/research/rc_msft_001/watchlist"')
    expect(personalHtml).toContain('method="post"')
    expect(personalHtml).toContain('Promote to watchlist')
    expect(demoHtml).not.toContain('Promote to watchlist')
    expect(demoHtml).not.toContain('/api/research/rc_msft_001/watchlist')
  })

  it('renders a minimal portfolio view from projected holding lots', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Watch MSFT until the margin of safety improves.',
        shares: 3.25,
        cost_basis_per_share: 812.4,
        total_cost_basis: 2640.3,
        currency: 'USD',
        opened_at: '2026-05-31',
        latest_price_per_share: 900,
        latest_market_value: 2925,
        latest_valuation_at: '2026-06-01',
        unrealized_gain_loss: 284.7,
        unrealized_gain_loss_percent: 10.78,
        portfolio_weight: 100,
        latest_review_id: 'review_holding_msft_001',
        thesis_health: 'HEALTHY',
        action_stance: 'HOLD',
        latest_review_rationale: 'The original Buffett-Munger thesis remains intact.',
        latest_review_evidence_summary: 'Reviewed current valuation and source ledger references.',
        latest_review_uncertainty: 'Needs a refreshed primary-source review after the next quarterly filing.',
        next_review_at: '2026-09-30',
        latest_reviewed_at: '2026-06-30T12:00:00.000Z',
        updated_at: '2026-06-30T12:00:00.000Z',
      }],
      mode: 'personal-local',
    }))

    expect(html).toContain('Portfolio')
    expect(html).toContain('id="holding_msft_001"')
    expect(html).toContain('MSFT')
    expect(html).toContain('Shares')
    expect(html).toContain('3.25')
    expect(html).toContain('Cost basis / share')
    expect(html).toContain('$812.40')
    expect(html).toContain('Total cost basis')
    expect(html).toContain('$2,640.30')
    expect(html).toContain('Opened')
    expect(html).toContain('2026-05-31')
    expect(html).toContain('Current value')
    expect(html).toContain('$2,925.00')
    expect(html).toContain('Current price / share')
    expect(html).toContain('$900.00')
    expect(html).toContain('Unrealized P&amp;L')
    expect(html).toContain('$284.70')
    expect(html).toContain('10.78%')
    expect(html).toContain('Concentration')
    expect(html).toContain('100.00%')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/valuation"')
    expect(html).toContain('name="price_per_share"')
    expect(html).toContain('name="valued_at"')
    expect(html).toContain('Record valuation snapshot')
    expect(html).toContain('Thesis health')
    expect(html).toContain('HEALTHY')
    expect(html).toContain('Action stance')
    expect(html).toContain('HOLD')
    expect(html).toContain('The original Buffett-Munger thesis remains intact.')
    expect(html).toContain('Next review')
    expect(html).toContain('2026-09-30')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/review"')
    expect(html).toContain('Run Buffett-Munger review')
  })

  it('renders a pending strategy review confirmation action', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Watch MSFT until the margin of safety improves.',
        shares: 3.25,
        cost_basis_per_share: 812.4,
        total_cost_basis: 2640.3,
        currency: 'USD',
        opened_at: '2026-05-31',
        pending_review_id: 'review_holding_msft_001',
        pending_review_thesis_health: 'HEALTHY',
        pending_review_action_stance: 'HOLD',
        pending_review_rationale: 'The original Buffett-Munger thesis remains intact.',
        pending_review_next_review_at: '2026-09-30',
        updated_at: '2026-06-30T12:00:00.000Z',
      }],
      mode: 'personal-local',
    }))

    expect(html).toContain('Strategy review drafted')
    expect(html).toContain('Current confirmed thesis')
    expect(html).toContain('No confirmed review yet')
    expect(html).toContain('Provider draft')
    expect(html).toContain('Pending thesis health')
    expect(html).toContain('HEALTHY')
    expect(html).toContain('Pending action stance')
    expect(html).toContain('HOLD')
    expect(html).toContain('Choose one auditable decision path')
    expect(html).toContain('Apply provider draft')
    expect(html).toContain('Applies the provider-authored thesis health, action stance, and next review date to portfolio state.')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/review/review_holding_msft_001/confirm"')
    expect(html).toContain('Apply user override')
    expect(html).toContain('Applies your edited values instead of the provider draft and records a user-authored audit event.')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/review/review_holding_msft_001/override"')
    expect(html).toContain('Override thesis health')
    expect(html).toContain('Override action stance')
    expect(html).toContain('Override rationale (required)')
    expect(html).toContain('Override evidence summary (required)')
    expect(html).toContain('Override uncertainty (required)')
    expect(html).toContain('Override next review date (required)')
    expect(html).not.toContain('Save override')
    expect(html).toContain('Reject provider draft')
    expect(html).toContain('Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/review/review_holding_msft_001/reject"')
    expect(html).toContain('Rejection reason (required)')
    expect(html).toContain('Reject strategy review')
  })

  it('surfaces conditional and blocked Shariah gate details on watchlist and holding cards', () => {
    const conditionalWatchlistHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{
        watchlist_item_id: 'watch_conditional_001',
        research_case_id: 'rc_conditional_001',
        ticker: 'COND',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Conditional Shariah status requires user confirmation before action.',
        user_approved: false,
        shariah_gate_decision_id: 'gate_watchlist_promotion_watch_conditional_001',
        shariah_gate_status: 'CONDITIONAL',
        shariah_gate_allowed: true,
        shariah_gate_reasons: ['Business activity requires conditional Shariah review with sourced evidence.'],
        shariah_required_source_ids: ['src_cond_10k_2025'],
        shariah_missing_evidence: [],
        updated_at: '2026-06-01T00:00:00.000Z',
      }],
      mode: 'personal-local',
    }))
    const blockedHoldingHtml = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_blocked_001',
        watchlist_item_id: 'watch_blocked_001',
        research_case_id: 'rc_blocked_001',
        ticker: 'BLCK',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Blocked by Shariah gate.',
        shares: 1,
        cost_basis_per_share: 10,
        total_cost_basis: 10,
        currency: 'USD',
        opened_at: '2026-06-01',
        shariah_gate_decision_id: 'gate_holding_open_holding_blocked_001',
        shariah_gate_status: 'NON_COMPLIANT',
        shariah_gate_allowed: false,
        shariah_gate_reasons: ['Business activity is prohibited by the configured Shariah policy.'],
        shariah_required_source_ids: ['src_blocked_10k_2025'],
        shariah_missing_evidence: ['non_compliant_income_ratio'],
        updated_at: '2026-06-01T00:00:00.000Z',
      }],
      mode: 'personal-local',
    }))

    expect(conditionalWatchlistHtml).toContain('Shariah gate')
    expect(conditionalWatchlistHtml).toContain('CONDITIONAL')
    expect(conditionalWatchlistHtml).toContain('Business activity requires conditional Shariah review with sourced evidence.')
    expect(conditionalWatchlistHtml).toContain('Required Shariah sources')
    expect(conditionalWatchlistHtml).toContain('src_cond_10k_2025')
    expect(blockedHoldingHtml).toContain('Shariah gate')
    expect(blockedHoldingHtml).toContain('NON_COMPLIANT')
    expect(blockedHoldingHtml).toContain('Business activity is prohibited by the configured Shariah policy.')
    expect(blockedHoldingHtml).toContain('Missing Shariah evidence')
    expect(blockedHoldingHtml).toContain('non_compliant_income_ratio')
  })

  it('links the command center to the demo research case and watchlist', async () => {
    await withSeededStore(async (store) => {
      const dashboard = await getDemoCommandCenterFromStore(store)
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('href="/research/rc_cost_001"')
      expect(html).toContain('View demo research case')
      expect(html).toContain('href="/watchlist"')
      expect(html).toContain('Open watchlist drafts')
    })
  })
})
