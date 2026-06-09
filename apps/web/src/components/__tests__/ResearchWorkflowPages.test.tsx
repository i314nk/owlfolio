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
      expect(html).toContain('Research dossier')
      expect(html).toContain('Verdict summary')
      expect(html).toContain('WATCH')
      expect(html).toContain('Workflow audit status')
      expect(html).toContain('Watchlist draft · User action required')
      expect(html).toContain('Audit stage')
      expect(html).toContain('watchlist_draft')
      expect(html).toContain('Thesis')
      expect(html).toContain('Valuation')
      expect(html).toContain('FAIR')
      expect(html).toContain('Shariah / compliance')
      expect(html).toContain('COMPLIANT')
      expect(html).toContain('Risks / open questions')
      expect(html).toContain('Gate checklist')
      expect(html).toContain('Quality business')
      expect(html).toContain('Evidence source context')
      expect(html).toContain('class="owl-source-chip')
      expect(html).toContain('Source IDs')
      expect(html).toContain('src_cost_10k_2025')
      expect(html).toContain('Ledger Timeline')
      expect(html).toContain('Provider draft state')
      expect(html).toContain('Source-backed Shariah gate')
      expect(html).toContain('User transition checkpoint')
      expect(html).toContain('Review COST research case and confirm the watchlist draft')
      expect(html).not.toContain('#ecfdf5')
      expect(html).not.toContain('#f0fdf4')
      expect(html).not.toContain('#047857')
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
      expect(html).toContain('Provider draft state')
      expect(html).toContain('Created by actor')
      expect(html).toContain('user:user_local')
      expect(html).toContain('Last updated')
      expect(html).toContain('2026-05-27T00:03:00.000Z')
      expect(html).toContain('User decision checkpoint')
      expect(html).toContain('Research case link')
      expect(html).toContain('href="/research/rc_cost_001"')
      expect(html).toContain('View research dossier')
      expect(html).toContain('Draft — awaiting user confirmation')
      expect(html).not.toContain('#ecfdf5')
      expect(html).not.toContain('#047857')
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
    expect(personalDraftHtml).toContain('Review Shariah gate evidence, then confirm this watchlist draft as user-authored state.')
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
    expect(personalConfirmedHtml).toContain('Open holding from confirmed watchlist state')
    expect(personalConfirmedHtml).toContain('Record initial holding')
    expect(personalConfirmedHtml).toContain('name="shares"')
    expect(personalConfirmedHtml).toContain('name="cost_basis_per_share"')
    expect(personalConfirmedHtml).toContain('name="currency"')
    expect(personalConfirmedHtml).toContain('name="opened_at"')
    expect(personalConfirmedHtml).toContain('background:rgba(148, 163, 184, 0.08)')
    expect(personalConfirmedHtml).toContain('color:#f7f8ff')
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

  it('renders selected-strategy quick screen evidence as a first-class company screen before watchlist mutation', () => {
    const quickScreenedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_quick_001',
      version: 1,
      superseded: false,
      stage: 'quick_screened',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      quick_screen_id: 'quick_msft_001',
      screening_result: 'deep_dive_candidate',
      business_quality: 'Recurring cloud revenue and enterprise retention support a quality screen.',
      moat: 'Switching costs and ecosystem depth are relevant moat evidence.',
      management_capital_allocation: 'Capital allocation appears disciplined but needs a deeper buyback review.',
      financial_quality: 'Margins and free cash flow pass the selected strategy quick screen.',
      valuation_sanity: 'Valuation needs margin-of-safety review before watchlist promotion.',
      shariah_status: 'PENDING',
      red_flags: ['Valuation may be demanding', 'Needs current Shariah ratio evidence'],
      confidence: 'medium',
      caveats: ['Single-agent quick screen only'],
      next_required_action: 'Recommend deep dive, but do not mutate watchlist without approval.',
      updated_at: '2026-06-06T12:00:00.000Z',
      gate_checklist: [],
      source_ids: ['src_msft_10k_2025', 'src_msft_proxy_2025'],
      ledger_timeline: [],
    }

    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: quickScreenedResearchCase,
      mode: 'personal-local',
    }))

    expect(html).toContain('Quick screen')
    expect(html).toContain('Single-agent business-quality gate')
    expect(html).toContain('Selected strategy')
    expect(html).toContain('quality-growth@2026.06')
    expect(html).toContain('Deep-dive recommendation')
    expect(html).toContain('deep_dive_candidate')
    expect(html).toContain('Business quality')
    expect(html).toContain('Recurring cloud revenue and enterprise retention support a quality screen.')
    expect(html).toContain('Moat')
    expect(html).toContain('Management / capital allocation')
    expect(html).toContain('Financial quality')
    expect(html).toContain('Shariah / data availability')
    expect(html).toContain('PENDING')
    expect(html).toContain('Red flags')
    expect(html).toContain('Valuation may be demanding')
    expect(html).toContain('Uncertainty / caveats')
    expect(html).toContain('medium')
    expect(html).toContain('Valuation belongs in deep dive')
    expect(html).toContain('Valuation needs margin-of-safety review before watchlist promotion.')
    expect(html).toContain('src_msft_10k_2025')
    expect(html).toContain('Recommend deep dive, but do not mutate watchlist without approval.')
    expect(html).not.toContain('Valuation sanity')
    expect(html).not.toContain('Valuation gate')
    expect(html).not.toContain('Promote to watchlist')
    expect(html).not.toContain('/api/research/rc_msft_quick_001/watchlist')
  })

  it('renders deep-dive lanes with an owner-earnings valuation card', () => {
    const deepDiveResearchCase = {
      research_case_id: 'rc_msft_deep_001',
      version: 1,
      superseded: false,
      stage: 'deep_dive_completed',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      strategy_version: '2026.06',
      deep_dive_id: 'deep_msft_001',
      synthesis_id: 'synthesis_msft_001',
      specialist_findings: [
        {
          finding_id: 'finding_business_quality',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'business_quality',
          finding_summary: 'Sticky enterprise software revenue and Azure scale support a durable business-quality case.',
          confidence: 'high',
          caveats: ['Needs updated segment margin evidence'],
          source_ids: ['src_msft_10k_2025'],
        },
        {
          finding_id: 'finding_moat',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'moat',
          finding_summary: 'Switching costs, developer ecosystem, and enterprise distribution support a widening moat.',
          confidence: 'high',
          caveats: [],
          source_ids: ['src_msft_10k_2025'],
        },
        {
          finding_id: 'finding_management',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'management',
          finding_summary: 'Capital allocation appears disciplined; verify buyback valuation discipline separately.',
          confidence: 'medium',
          caveats: ['Proxy refresh pending'],
          source_ids: ['src_msft_proxy_2025'],
        },
        {
          finding_id: 'finding_financial_quality',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'financial_quality',
          finding_summary: 'High operating margins and free-cash-flow conversion support financial quality.',
          confidence: 'high',
          caveats: [],
          source_ids: ['src_msft_10k_2025'],
        },
        {
          finding_id: 'finding_shariah',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'shariah',
          finding_summary: 'Needs refreshed ratio evidence before user transition.',
          confidence: 'medium',
          caveats: ['Latest ratios missing'],
          source_ids: ['src_msft_10k_2025'],
        },
        {
          finding_id: 'finding_risks',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'risks',
          finding_summary: 'AI capex and antitrust scrutiny remain material risk lanes.',
          confidence: 'medium',
          caveats: ['Scenario sizing pending'],
          source_ids: ['src_msft_10k_2025'],
        },
        {
          finding_id: 'finding_owner_earnings_valuation',
          deep_dive_id: 'deep_msft_001',
          specialist_lane: 'valuation',
          finding_summary: 'Owner-earnings valuation points to a buy-price range below the current market quote.',
          confidence: 'medium',
          caveats: ['Owner earnings normalization depends on AI capex treatment'],
          source_ids: ['src_msft_cashflow_2025'],
        },
      ],
      owner_earnings_valuation: {
        normalized_owner_earnings: '$85B normalized owner earnings',
        assumptions: ['5% ten-year growth', '10% discount rate', '25x terminal owner-earnings multiple'],
        fair_value_range: '$360–$420/share',
        buy_price_range: '$260–$300/share',
        margin_of_safety: '25%–35%',
        sources: ['src_msft_cashflow_2025'],
        confidence: 'medium',
        caveats: ['Treat AI capex normalization as the key swing factor'],
      },
      confidence: 'medium',
      caveats: ['Deep dive still needs refreshed Shariah ratio evidence'],
      next_required_action: 'Wait for owner-earnings margin of safety before watchlist promotion.',
      updated_at: '2026-06-06T12:00:00.000Z',
      gate_checklist: [],
      source_ids: ['src_msft_10k_2025', 'src_msft_cashflow_2025'],
      ledger_timeline: [],
    } as AppResearchCase

    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: deepDiveResearchCase,
      mode: 'personal-local',
    }))

    expect(html).toContain('Deep dive dossier')
    expect(html).toContain('Business quality lane')
    expect(html).toContain('Sticky enterprise software revenue')
    expect(html).toContain('Moat lane')
    expect(html).toContain('Management lane')
    expect(html).toContain('Financial quality lane')
    expect(html).toContain('Shariah lane')
    expect(html).toContain('Risk lane')
    expect(html).toContain('Owner-earnings valuation lane')
    expect(html).toContain('Normalized owner earnings')
    expect(html).toContain('$85B normalized owner earnings')
    expect(html).toContain('Fair value range')
    expect(html).toContain('$360–$420/share')
    expect(html).toContain('Buy-price range')
    expect(html).toContain('$260–$300/share')
    expect(html).toContain('Margin of safety')
    expect(html).toContain('25%–35%')
    expect(html).toContain('5% ten-year growth')
    expect(html).toContain('Owner earnings normalization depends on AI capex treatment')
    expect(html).toContain('src_msft_cashflow_2025')
    expect(html).toContain('Wait for owner-earnings margin of safety before watchlist promotion.')
  })

  it('renders a first-class investment brief and safe source evidence for drafted decisions', () => {
    const fullThesis = 'Microsoft remains a high-quality Buffett-Munger business: durable ecosystem moats across Microsoft 365, Azure, Windows, GitHub/LinkedIn/Gaming, very high profitability, strong balance sheet, and resilient cash generation, but the current valuation leaves too little margin of safety and Shariah evidence still needs a documented ratio review.'
    const decisionDraftedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_001',
      version: 1,
      superseded: false,
      stage: 'decision_drafted',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_msft_001',
      decision: 'WATCH',
      reason: fullThesis,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'CONDITIONAL',
      valuation_status: 'EXPENSIVE',
      next_required_action: 'Wait for a better entry point and refresh Shariah ratio evidence after the next filing.',
      updated_at: '2026-05-31T12:00:00.000Z',
      gate_checklist: [],
      source_ids: ['msft_fy2025_10k', 'local_private_note'],
      source_evidence: [
        {
          source_id: 'msft_fy2025_10k',
          title: 'Microsoft Form 10-K for Fiscal Year 2025',
          excerpt: 'FY2025 revenue was $281.724B, operating income $128.528B, net income $101.832B, and diluted EPS $13.64.',
          url: 'https://microsoft.example/10k',
        },
        {
          source_id: 'local_private_note',
          title: 'Local source recorded',
          excerpt: 'Local file evidence was recorded with path metadata redacted.',
        },
      ],
      ledger_timeline: [],
    }

    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decisionDraftedResearchCase,
      mode: 'personal-local',
    }))

    expect(html).toContain('Research dossier')
    expect(html).toContain('Verdict summary')
    expect(html).toContain('WATCH')
    expect(html).toContain('Verdict is a drafted strategy decision')
    expect(html).toContain('Valuation status EXPENSIVE is tracked inside the deep-dive valuation workstream, not treated as a Quick Screen pass/fail gate.')
    expect(html).not.toContain('WATCH based on valuation EXPENSIVE')
    expect(html).toContain('Next action')
    expect(html).toContain('Thesis')
    const thesisCardStart = html.indexOf('data-testid="research-dossier-card-thesis"')
    const valuationCardStart = html.indexOf('data-testid="research-dossier-card-valuation"')
    expect(thesisCardStart).toBeGreaterThan(-1)
    expect(valuationCardStart).toBeGreaterThan(thesisCardStart)
    const thesisCardHtml = html.slice(thesisCardStart, valuationCardStart)
    expect(thesisCardHtml).toContain('High-quality Buffett-Munger business')
    expect(thesisCardHtml).not.toContain('very high')
    expect(thesisCardHtml).toContain('Full thesis')
    expect(thesisCardHtml).not.toContain(fullThesis)
    expect(html).toContain(fullThesis)
    expect(html).toContain('align-items:start')
    expect(html).toContain('Valuation')
    expect(html).toContain('EXPENSIVE')
    expect(html).toContain('Legacy dossier lacks structured owner-earnings assumptions; treat EXPENSIVE as a deep-dive valuation status, not a Quick Screen gate.')
    expect(html).not.toContain('Current valuation gate')
    expect(html).toContain('Shariah / compliance')
    expect(html).toContain('CONDITIONAL')
    expect(html).toContain('Needs structured Shariah detail')
    expect(html).toContain('Risks / open questions')
    expect(html).toContain('No separately structured risks are recorded yet')
    expect(html).toContain('Single-agent business-quality gate')
    expect(html).toContain('Legacy decision has no standalone Quick Screen event; use this as a business-quality digest of the existing dossier before spending more analysis budget.')
    expect(html).toContain('Deep-dive recommendation')
    expect(html).toContain('Review existing decision draft')
    expect(html).toContain('Valuation belongs in deep dive')
    expect(html).toContain('Swarm lane findings')
    expect(html).toContain('Owner-earnings valuation lane')
    expect(html).toContain('Legacy dossier has valuation status EXPENSIVE but no owner-earnings buy-price range recorded.')
    expect(html).toContain('Missing owner-earnings assumptions are a deep-dive gap, not a Quick Screen failure.')
    expect(html).toContain('Evidence and audit details')
    expect(html).toContain('<details')
    expect(html).toContain('Microsoft Form 10-K for Fiscal Year 2025')
    expect(html).toContain('FY2025 revenue was $281.724B')
    expect(html).toContain('Audit source id')
    expect(html).toContain('msft_fy2025_10k')
    expect(html).toContain('local_private_note')
    expect(html).not.toContain('Raw stage token')
    expect(html).not.toContain('/home/hermes_agent')
    expect(html).not.toContain('private/local/path')
    expect([...html.matchAll(/Microsoft remains a high-quality Buffett-Munger business/g)]).toHaveLength(1)
  })

  it('renders the personal-local watchlist promotion action only for drafted decisions', () => {
    const decisionDraftedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_001',
      version: 1,
      superseded: false,
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
    expect(personalHtml).toContain('Workflow audit status')
    expect(personalHtml).toContain('Decision drafted · User action required')
    expect(personalHtml).toContain('method="post"')
    expect(personalHtml).toContain('Promote to watchlist')
    expect(personalHtml).toContain('color:var(--owl-color-gold-bright)')
    expect(personalHtml).not.toContain('color:#3730a3')
    expect(demoHtml).not.toContain('Promote to watchlist')
    expect(demoHtml).not.toContain('/api/research/rc_msft_001/watchlist')
  })

  it('renders an empty personal-local portfolio state with workflow guidance and provenance', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [],
      mode: 'personal-local',
    }))

    expect(html).toContain('Portfolio')
    expect(html).toContain('No holdings are open yet')
    expect(html).toContain('Follow the audit path: research decision → watchlist confirmation → holding lot entry.')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('Go to watchlist')
    expect(html).toContain('Record first lot after confirming a watchlist item')
    expect(html).toContain('No portfolio events recorded')
    expect(html).toContain('Provider sync not connected')
    expect(html).toContain('Last updated: none')
    expect(html).toContain('Empty holdings table')
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
        opened_by_actor_type: 'user',
        opened_by_actor_id: 'user_local',
        latest_price_per_share: 900,
        latest_market_value: 2925,
        latest_valuation_at: '2026-06-01',
        latest_valuation_source: 'mock-local-price-feed',
        latest_price_checked_at: '2026-06-01T07:00:00.000Z',
        latest_valuation_confidence: 'mock',
        latest_valuation_caveat: 'Deterministic local price source for scheduled workflow verification.',
        latest_valuation_source_ids: ['mock-price:MSFT:2026-06-01'],
        latest_valuation_missing_data: [],
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
      valuationRefresh: {
        last_price_check_at: '2026-06-01T07:00:00.000Z',
        next_scheduled_check: '0 7 * * 1-5',
        data_source: 'mock-local-price-feed',
        confidence_caveat: 'Mock/local confidence — deterministic prices for local workflow verification.',
        holdings_missing_data: ['MISSING'],
      },
    }))

    expect(html).toContain('Portfolio')
    expect(html).toContain('Portfolio operations cockpit')
    expect(html).toContain('Current state')
    expect(html).toContain('1 open holding · $2,925.00 current value')
    expect(html).toContain('Last automation check')
    expect(html).toContain('User action required')
    expect(html).toContain('Resolve 1 holding with missing valuation data: MISSING')
    expect(html).toContain('id="holding_msft_001"')
    expect(html).toContain('MSFT')
    expect(html).toContain('Shares')
    expect(html).toContain('3.25')
    expect(html).toContain('Cost basis / share')
    expect(html).toContain('$812.40')
    expect(html).toContain('Total cost basis')
    expect(html).toContain('$2,640.30')
    expect(html).toContain('class="owl-financial-table"')
    expect(html).toContain('Position economics')
    expect(html).toContain('Confirmed portfolio state')
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
    expect(html).toContain('Valuation source')
    expect(html).toContain('mock-local-price-feed')
    expect(html).toContain('Scheduled valuation refresh')
    expect(html).toContain('Last price check')
    expect(html).toContain('2026-06-01T07:00:00.000Z')
    expect(html).toContain('Next scheduled check')
    expect(html).toContain('0 7 * * 1-5')
    expect(html).toContain('Data source')
    expect(html).toContain('Confidence / caveat')
    expect(html).toContain('Mock/local confidence — deterministic prices for local workflow verification.')
    expect(html).toContain('Holdings missing data')
    expect(html).toContain('MISSING')
    expect(html).toContain('Latest price check')
    expect(html).toContain('Valuation confidence')
    expect(html).toContain('mock')
    expect(html).toContain('Valuation caveat')
    expect(html).toContain('Deterministic local price source for scheduled workflow verification.')
    expect(html).toContain('Valuation source IDs')
    expect(html).toContain('mock-price:MSFT:2026-06-01')
    expect(html).toContain('Opened by actor')
    expect(html).toContain('user:user_local')
    expect(html).toContain('Last reviewed')
    expect(html).toContain('2026-06-30T12:00:00.000Z')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/valuation"')
    expect(html).toContain('Manual fallback actions')
    expect(html).toContain('<summary')
    expect(html).toContain('Manual valuation checkpoint')
    expect(html).toContain('name="price_per_share"')
    expect(html).toContain('name="valued_at"')
    expect(html).toContain('background:rgba(148, 163, 184, 0.08)')
    expect(html).toContain('color:#f7f8ff')
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
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#047857')
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
    expect(html).toContain('Provider-authored review draft')
    expect(html).toContain('Pending thesis health')
    expect(html).toContain('HEALTHY')
    expect(html).toContain('Pending action stance')
    expect(html).toContain('HOLD')
    expect(html).toContain('Choose one auditable decision path')
    expect(html).toContain('Pending review decision summary')
    expect(html).toContain('Compare these paths quickly')
    expect(html).toContain('href="#holding-review-path-confirm"')
    expect(html).toContain('id="holding-review-path-confirm"')
    expect(html).toContain('href="#holding-review-path-override"')
    expect(html).toContain('id="holding-review-path-override"')
    expect(html).toContain('id="holding-review-path-reject"')
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
    expect(html).toContain('Date fields use YYYY-MM-DD format')
    expect(html).not.toContain('Save override')
    expect(html).toContain('Reject provider draft')
    expect(html).toContain('Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.')
    expect(html).toContain('action="/api/portfolio/holding_msft_001/review/review_holding_msft_001/reject"')
    expect(html).toContain('Rejection reason (required)')
    expect(html).toContain('Reject strategy review')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#047857')
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
    const unknownWatchlistHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{
        watchlist_item_id: 'watch_unknown_001',
        research_case_id: 'rc_unknown_001',
        ticker: 'UNKN',
        user_approved: false,
        shariah_gate_decision_id: 'gate_watchlist_unknown_001',
        shariah_gate_status: 'PENDING',
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
    expect(conditionalWatchlistHtml).toContain('Gate decision')
    expect(conditionalWatchlistHtml).toContain('CONDITIONAL')
    expect(conditionalWatchlistHtml).toContain('Business activity requires conditional Shariah review with sourced evidence.')
    expect(conditionalWatchlistHtml).toContain('Required Shariah sources')
    expect(conditionalWatchlistHtml).toContain('src_cond_10k_2025')
    expect(unknownWatchlistHtml).toContain('PENDING — gate decision pending')
    expect(unknownWatchlistHtml).not.toContain('PENDING — allowed')
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
