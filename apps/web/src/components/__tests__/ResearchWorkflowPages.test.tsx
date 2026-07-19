import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { PortfolioPanel } from '../PortfolioPanel'
import { ResearchCasePanel } from '../ResearchCasePanel'
import { WatchlistPanel } from '../WatchlistPanel'
import { getAppWatchlistItemsFromStore, type AppResearchCase, type AppWatchlistItem, type MonitorAlert } from '../../lib/workflow'

describe('exit purification guidance (close form)', () => {
  const baseHolding = {
    holding_id: 'holding_cond_001',
    watchlist_item_id: 'watch_cond_001',
    research_case_id: 'rc_cond_001',
    ticker: 'COND',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Held thesis.',
    shares: 1,
    cost_basis_per_share: 100,
    total_cost_basis: 100,
    currency: 'USD',
    opened_at: '2026-06-01',
    updated_at: '2026-06-01T00:00:00.000Z',
  }

  it('renders the guidance (rate + entry anchor, no account) for a CONDITIONAL holding', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        ...baseHolding,
        shariah_gate_decision_id: 'gate_1',
        shariah_gate_status: 'CONDITIONAL',
        shariah_gate_allowed: true,
        purificationPct: 0.002,
      } as never],
      mode: 'personal-local',
    }))
    expect(html).toContain('data-testid="exit-purification-guidance"')
    expect(html).toContain('EXIT PURIFICATION — GUIDANCE, NOT AN ACCOUNT')
    expect(html).toContain('~0.2% impermissible income')
    expect(html).toContain('your exit price minus your entry ($100.00)')
    // The CONDITIONAL row line also renders in the expansion.
    expect(html).toContain('purify ~0.2% of any dividends')
  })

  it('renders NO guidance for a cleanly approved holding', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        ...baseHolding,
        shariah_gate_decision_id: 'gate_1',
        shariah_gate_status: 'COMPLIANT',
        shariah_gate_allowed: true,
      } as never],
      mode: 'personal-local',
    }))
    expect(html).not.toContain('exit-purification-guidance')
    expect(html).not.toContain('Shariah-permissible to hold, with an obligation')
  })
})

describe('the Shariah screening toggle (owner-approved 2026-07-15)', () => {
  it('OFF hides the CONDITIONAL line + the exit-purification guidance (portfolio)', () => {
    const holding = {
      holding_id: 'holding_cond_002',
      watchlist_item_id: 'watch_cond_002',
      research_case_id: 'rc_cond_002',
      ticker: 'COND',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Held thesis.',
      shares: 1,
      cost_basis_per_share: 100,
      total_cost_basis: 100,
      currency: 'USD',
      opened_at: '2026-06-01',
      updated_at: '2026-06-01T00:00:00.000Z',
      shariah_gate_decision_id: 'gate_2',
      shariah_gate_status: 'CONDITIONAL',
      shariah_gate_allowed: true,
      purificationPct: 0.002,
    } as never
    const off = renderToStaticMarkup(createElement(PortfolioPanel, { holdings: [holding], mode: 'personal-local', shariahEnabled: false }))
    expect(off).not.toContain('exit-purification-guidance')
    expect(off).not.toContain('Shariah-permissible to hold, with an obligation')
    const on = renderToStaticMarkup(createElement(PortfolioPanel, { holdings: [holding], mode: 'personal-local', shariahEnabled: true }))
    expect(on).toContain('exit-purification-guidance')
  })

  it('OFF hides the CONDITIONAL line on the watchlist; a DISABLED gate renders the neutral GATE OFF chip (never APPROVED)', () => {
    const base = {
      watchlist_item_id: 'w_off_1',
      research_case_id: 'rc_off_1',
      ticker: 'OFF',
      strategy_id: 'buffett-munger',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
      user_approved: true,
    }
    const conditionalItem = { ...base, shariah_gate_decision_id: 'g1', shariah_gate_status: 'CONDITIONAL', shariah_gate_allowed: true, verdict: { proposed_buy_below: 10 }, purification_pct: 0.01 } as never
    const off = renderToStaticMarkup(createElement(WatchlistPanel, { items: [conditionalItem], mode: 'personal-local', shariahEnabled: false }))
    expect(off).not.toContain('Shariah-permissible to hold, with an obligation')

    const disabledGateItem = { ...base, shariah_gate_decision_id: 'g2', shariah_gate_status: 'DISABLED', shariah_gate_allowed: true, verdict: { proposed_buy_below: 10 } } as never
    const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: [disabledGateItem], mode: 'personal-local', shariahEnabled: false }))
    expect(html).toContain('GATE OFF')
    expect(html).not.toContain('APPROVED')
  })
})

describe('research and watchlist workflow pages', () => {
  it('no longer renders a separate watchlist confirmation action (Phase 8 S4: admission is one gated step)', () => {
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
    const personalConfirmedHtml = renderToStaticMarkup(createElement(WatchlistPanel, {
      items: [{
        ...draftItem,
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
      }],
      mode: 'personal-local',
    }))

    // The separate "confirm watchlist draft" affordance + its API route are GONE in every mode/state:
    // admission lands the item user-confirmed in one gated step (signed thesis + checklist + Shariah).
    expect(personalDraftHtml).not.toContain('/api/watchlist/watch_msft_001/confirm')
    expect(personalDraftHtml).not.toContain('Confirm watchlist draft')
    expect(personalConfirmedHtml).toContain('Confirmed')
    expect(personalConfirmedHtml).not.toContain('Confirm watchlist draft')
    expect(personalConfirmedHtml).not.toContain('/api/watchlist/watch_msft_001/confirm')
  })

  it('renders per-item watchlist monitor alerts as observations', () => {
    const item: AppWatchlistItem = {
      watchlist_item_id: 'watch_msft_001',
      research_case_id: 'rc_msft_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Watch MSFT.',
      user_approved: true,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
      updated_at: '2026-05-31T12:00:00.000Z',
    }
    const alerts: MonitorAlert[] = [
      {
        id: 'wmon_msft',
        kind: 'buy_window',
        subject: { ticker: 'MSFT', watchlist_item_id: 'watch_msft_001' },
        severity: 'attention',
        headline: 'MSFT: buy-window open',
        detail: 'Price is 12% below the case buy price on a fresh, gate-clean case. Observation only — opening a holding is your decision.',
        recorded_at: '2026-06-08T00:00:00Z',
        is_observation: true,
        is_draft: false,
        human_action: { label: 'Review buy-window', href: '/watchlist' },
      },
    ]

    const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: [item], mode: 'personal-local', alerts }))
    expect(html).toContain('Agent observations — you decide')
    expect(html).toContain('MSFT: buy-window open')
    expect(html).toContain('12% below the case buy price')
  })

  it('renders per-holding monitor alerts and drafts on the portfolio panel', () => {
    const alerts: MonitorAlert[] = [
      {
        id: 'hmon_msft:concentration',
        kind: 'concentration',
        subject: { ticker: 'MSFT', holding_id: 'holding_msft_001' },
        severity: 'attention',
        headline: 'MSFT: concentration over cap',
        detail: 'Position is 22% of NAV, over the 15% cap. Winners run; this is a trim-review alert, never an auto-trim. You decide.',
        recorded_at: '2026-06-08T00:00:00Z',
        is_observation: true,
        is_draft: false,
        human_action: { label: 'Review concentration', href: '/portfolio#holding_msft_001' },
      },
      {
        id: 'sr_msft',
        kind: 'sell_review',
        subject: { ticker: 'MSFT', holding_id: 'holding_msft_001' },
        severity: 'urgent',
        headline: 'MSFT: sell-review draft',
        detail: 'Thesis broke. This is a DRAFT exit proposal — never an execution. You author the exit.',
        recorded_at: '2026-06-08T00:00:00Z',
        is_observation: false,
        is_draft: true,
        human_action: { label: 'Author sell-review', href: '/portfolio#holding_msft_001' },
      },
    ]
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        shares: 10,
        cost_basis_per_share: 100,
        total_cost_basis: 1000,
        currency: 'USD',
        opened_at: '2026-05-01',
        updated_at: '2026-05-31T12:00:00.000Z',
      }],
      mode: 'personal-local',
      alerts,
    }))
    expect(html).toContain('Agent observations &amp; drafts — you decide')
    expect(html).toContain('MSFT: concentration over cap')
    expect(html).toContain('never an auto-trim')
    expect(html).toContain('MSFT: sell-review draft')
    expect(html).toContain('Draft — you author')
  })

  it('renders the on-demand re-review launch per holding with a research case', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        shares: 10,
        cost_basis_per_share: 100,
        total_cost_basis: 1000,
        currency: 'USD',
        opened_at: '2026-05-01',
        updated_at: '2026-05-31T12:00:00.000Z',
      }],
      mode: 'personal-local',
    }))
    expect(html).toContain('data-testid="rereview-button"')
    expect(html).toContain('Check-in vs new filings')
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
    // SCALE-DOWN S5: share counts retired — the entry price is the anchor.
    expect(personalConfirmedHtml).not.toContain('name="shares"')
    expect(personalConfirmedHtml).toContain('name="cost_basis_per_share"')
    expect(personalConfirmedHtml).toContain('name="cost_basis_per_share"')
    expect(personalConfirmedHtml).toContain('name="currency"')
    expect(personalConfirmedHtml).toContain('name="opened_at"')
    expect(personalConfirmedHtml).toContain('background:var(--owl-color-panel-elevated)')
    expect(personalConfirmedHtml).toContain('color:var(--owl-color-bright)')
    expect(personalDraftHtml).not.toContain('Record initial holding')
    expect(personalDraftHtml).not.toContain('/api/watchlist/watch_msft_001/open-holding')
    // ONE HOME PER NAME (2026-07-14): a held name leaves the watchlist BOARD entirely — no row,
    // no open-holding form; the ledger line points at the portfolio.
    expect(personalHeldHtml).not.toContain('data-watchlist-row=')
    expect(personalHeldHtml).toContain('Held — see portfolio')
    expect(personalHeldHtml).not.toContain('Record initial holding')
    expect(personalHeldHtml).not.toContain('/api/watchlist/watch_msft_001/open-holding')
  })

  it('renders an empty personal-local watchlist state', async () => {
    const store = new SQLiteEventStore()
    try {
      const watchlistItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
      const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: watchlistItems }))

      expect(html).toContain('Watchlist')
      expect(html).toContain('Provider-proposed candidates — nothing enters your portfolio without your explicit confirmation.')
      expect(html).toContain('No watchlist items yet. Create a research case first.')
    } finally {
      store.close()
    }
  })

  it('renders selected-strategy quick screen evidence as a first-class company screen before watchlist mutation', () => {
    const quickScreenedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_quick_001',
      version: 1,
      superseded: false,
      archived: false,
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

  it('renders a first-class investment brief and safe source evidence for drafted decisions', () => {
    const fullThesis = 'Microsoft remains a high-quality Buffett 4-Pillar business: durable ecosystem moats across Microsoft 365, Azure, Windows, GitHub/LinkedIn/Gaming, very high profitability, strong balance sheet, and resilient cash generation, but the current valuation leaves too little margin of safety and Shariah evidence still needs a documented ratio review.'
    const decisionDraftedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_001',
      version: 1,
      superseded: false,
      archived: false,
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
    // The verdict summary is now the thesis prose followed by scannable bullet points (Verdict, Valuation, …).
    expect(html).toContain('Verdict:')
    expect(html).toContain('Valuation:')
    expect(html.toLowerCase()).toContain('expensive')
    expect(html).not.toContain('Verdict is a drafted strategy decision')
    expect(html).not.toContain('WATCH based on valuation EXPENSIVE')
    expect(html).toContain('Next action')
    // The standalone Thesis box was removed; the FULL thesis now leads the hero verdict summary as prose, and
    // the duplicated per-dimension valuation/shariah/risks cards remain gone.
    expect(html).not.toContain('data-testid="research-dossier-card-thesis"')
    expect(html).not.toContain('data-testid="research-dossier-card-valuation"')
    expect(html).not.toContain('data-testid="research-dossier-card-shariah-compliance"')
    expect(html).not.toContain('data-testid="research-dossier-card-risks-open-questions"')
    expect(html).not.toContain('Full thesis')
    expect(html).toContain(fullThesis)
    // The masonry multi-column packing is gone.
    expect(html).not.toContain('data-owl-flow="masonry"')
    // Valuation status + Shariah status surface on the verdict-hero chips.
    expect(html).toContain('Valuation')
    expect(html).toContain('EXPENSIVE')
    expect(html).not.toContain('Current valuation gate')
    expect(html).toContain('CONDITIONAL')
    // The risks lane (collapsed) carries the honest no-structured-risks fallback.
    expect(html).toContain('No separately structured risks are recorded yet')
    expect(html).toContain('Single-agent business-quality gate')
    expect(html).toContain('Legacy decision has no standalone Quick Screen event; use this as a business-quality digest of the existing dossier before spending more analysis budget.')
    expect(html).toContain('Deep-dive recommendation')
    expect(html).toContain('Review existing decision draft')
    expect(html).toContain('Valuation belongs in deep dive')
    // The "Deep dive lane findings" / owner-earnings valuation card inside Evidence was removed (the swarm
    // lanes are already shown in the top-level Deep-dive specialist lanes box).
    expect(html).not.toContain('Swarm lane findings')
    expect(html).toContain('Evidence &amp; sources')
    expect(html).toContain('<details')
    expect(html).toContain('Microsoft Form 10-K for Fiscal Year 2025')
    expect(html).toContain('FY2025 revenue was $281.724B')
    expect(html).toContain('Audit source id')
    expect(html).toContain('msft_fy2025_10k')
    expect(html).toContain('local_private_note')
    expect(html).not.toContain('Raw stage token')
    expect(html).not.toContain('/home/hermes_agent')
    expect(html).not.toContain('private/local/path')
    // The thesis appears once on a decision_drafted case: in the dossier full-thesis readout. Review-and-
    // promote removed the admission thesis textarea, so there is no second (pre-filled) copy.
    expect([...html.matchAll(/Microsoft remains a high-quality Buffett 4-Pillar business/g)]).toHaveLength(1)
  })

  it('renders harness-computed AAOIFI Shariah ratios + EDGAR OE-bridge provenance when present', () => {
    const researchCase: AppResearchCase = {
      research_case_id: 'rc_cost_001',
      version: 1,
      superseded: false,
      archived: false,
      stage: 'decision_drafted',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_cost_001',
      decision: 'WATCH',
      reason: 'Quality compounder; price rich.',
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'CONDITIONAL',
      shariah_sector_status: 'conditional',
      valuation_status: 'EXPENSIVE',
      next_required_action: 'Await a margin of safety.',
      updated_at: '2026-06-09T12:00:00.000Z',
      shariah_financial: {
        debt_ratio: 0.0134,
        cash_securities_ratio: 0.0355,
        impermissible_income_pct: 0.004,
        verdict: 'CONDITIONAL',
        purification_pct: 0.004,
        market_cap: 430646,
        market_cap_basis: 'current_price_x_diluted_shares',
        bridge_source_fiscal_year: 2025,
      },
      valuation: {
        moat_class: 'wide',
        moat_passes_gate: true,
        runway: 'proven',
        discount_rate: 0.1,
        growth_rate: 0.03,
        terminal_growth_rate: 0.01,
        roic: 0.3,
        incremental_roic: 0.2,
        reinvestment_rate: 0.43,
        normalized_owner_earnings_per_share: 16.27,
        fair_value_per_share: 210.0,
        // Valuation-core revision: the dossier leads with the growth-axis band; the range basis is the
        // honest "why is the band wide" note. Market-implied growth + band live on verdict_state.
        fair_value_range: '$160–$240 (base $210)',
        fair_value_range_basis: 'Range is wide (±19%) because only 6 years of usable owner-earnings history anchor the growth estimate — treat it as honestly uncertain, not precise.',
        market_implied_growth: 0.18,
        implied_multiple: 12.9,
        buy_price_per_share: 147.0,
        verdict_state: {
          state: 'WATCH',
          market_implied_growth: 0.18,
          band_low: 0.04,
          band_high: 0.07,
          band_center: 0.055,
          band_grounding_status: 'grounded',
          band_basis_citations: ['sec_edgar_10k_0000909832_fy2025'],
          required_gap: 0.03,
          gap_to_band: -0.17,
          implied_above_band: true,
        },
        value_basis: 'two_stage_dcf',
        bridge_basis: 'sec_edgar',
        bridge_fiscal_year: 2025,
        bridge_source_id: 'sec_edgar_10k_0000909832_fy2025',
        owner_earnings_bridge: {
          net_income: 8099,
          depreciation_amortization: 2426,
          maintenance_capex: 2426,
          maintenance_capex_proxy_tier: '80',
          stock_based_comp: 860,
          normalized_working_capital_change: 0,
          shares_outstanding: 444.8,
        },
      },
      gate_checklist: [],
      source_ids: ['sec_edgar_10k_0000909832_fy2025'],
      source_evidence: [],
      ledger_timeline: [],
    }

    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase,
      mode: 'personal-local',
    }))

    // AAOIFI ratio mini-ledger in the relocated Shariah / compliance block.
    expect(html).toContain('data-testid="compliance-ratios"')
    expect(html).toContain('AAOIFI financial ratios (harness-computed)')
    expect(html).toContain('Debt / market cap')
    expect(html).toContain('Cash + securities / market cap')
    expect(html).toContain('Impermissible income / revenue')
    expect(html).toContain('&lt; 30%')
    expect(html).toContain('&lt; 5%')
    expect(html).toContain('Purification: 0.4%')
    // E2: the OE-bridge provenance display is retired (the FCF-basis block renders on new events).
    expect(html).not.toContain('Owner earnings computed from SEC 10-K FY2025')
    // RELIGHTENED DECISION (R1): the dossier LEADS with the model decision panel — the model-proposed
    // buy-below (here falling back to buy_price_per_share) and the market-implied growth read. The retired
    // growth-axis band viz + band/gap labels are gone.
    expect(html).toContain('data-testid="decision-summary"')
    expect(html).toContain('Buy below (computed)')
    expect(html).toContain('$147.00')
    expect(html.toLowerCase()).not.toContain('the market implies')
    expect(html).not.toContain('Market-implied growth') // F: the implied read is retired
    // forward-DCF removal: the dollar reference fair value (fair_value_per_share) is no longer surfaced — no
    // $210.00 figure, no "cross-check" label.
    expect(html).not.toContain('$210.00')
    expect(html.toLowerCase()).not.toContain('cross-check (not the decision)')
    // The retired growth-axis band viz + band/gap labels are gone.
    expect(html).not.toContain('data-testid="growth-band-axis"')
    expect(html).not.toContain('Sustainable band')
    expect(html).not.toContain('Required growth gap')
  })

  it('renders the personal-local watchlist promotion action only for drafted decisions', () => {
    const decisionDraftedResearchCase: AppResearchCase = {
      research_case_id: 'rc_msft_001',
      version: 1,
      superseded: false,
      archived: false,
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
      thesis_summary: 'Agent draft: Microsoft screens as a durable quality compounder awaiting a margin of safety.',
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

    expect(personalHtml).toContain('action="/api/research/rc_msft_001/watchlist"')
    expect(personalHtml).toContain('method="post"')
    expect(personalHtml).toContain('Promote to watchlist')
    expect(personalHtml).toContain('color:var(--owl-color-gold-bright)')
    expect(personalHtml).not.toContain('color:#3730a3')

    // Review-and-promote control: the dossier above is the analysis; the control is a single explicit
    // "Promote to watchlist" button. There is NO thesis textarea, NO checklist fieldsets, NO cognitive ack.
    expect(personalHtml).not.toContain('name="signed_thesis"')
    expect(personalHtml).not.toContain('<textarea')
    expect(personalHtml).not.toContain('name="cognitive_reflection_acknowledged"')
    expect(personalHtml).not.toContain('checklist_note[')
    expect(personalHtml).not.toContain('checklist_addressed[')
    // ...and the promote button is always enabled (the human's click IS the commitment, no gating).
    expect(personalHtml).toMatch(/<button[^>]*type="submit"[^>]*>Promote to watchlist/)
    expect(personalHtml).not.toMatch(/<button[^>]*\bdisabled\b[^>]*>Promote to watchlist/)
  })

  it('renders an empty personal-local portfolio state with honest workflow guidance', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [],
      mode: 'personal-local',
    }))

    expect(html).toContain('Portfolio')
    expect(html).toContain('No holdings are open yet')
    expect(html).toContain('Follow the audit path: research decision → watchlist confirmation → open holding (your entry price is the anchor).')
    expect(html).toContain('href="/watchlist"')
    expect(html).toContain('Go to watchlist')
    expect(html).toContain('Open a holding after confirming a watchlist item')
    // SCALE-DOWN truth: no lot/money-layer vocabulary, no fabricated system-status lines — broker
    // sync does not exist, and the empty page needs no "Last updated" provenance.
    expect(html).not.toContain('holding lot entry')
    expect(html).not.toContain('Record first lot')
    expect(html).not.toContain('Provider sync')
    expect(html).not.toContain('No portfolio events recorded')
    expect(html).not.toContain('Last updated')
    expect(html).not.toContain('Empty holdings table')
    expect(html).not.toContain('Portfolio cockpit')
  })

  it('replaces a model-placeholder thesis on a holding card with the honest fallback', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_goog_001',
        research_case_id: 'rc_goog_001',
        ticker: 'GOOG',
        thesis_summary: 'Will formulate after reading source material',
        cost_basis_per_share: 150,
        currency: 'USD',
        opened_at: '2026-06-01',
      } as never],
      mode: 'personal-local',
    }))
    expect(html).not.toContain('Will formulate')
    expect(html).toContain('No thesis recorded')
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
        latest_valuation_missing_data: [],
        unrealized_gain_loss: 284.7,
        unrealized_gain_loss_percent: 10.78,
        portfolio_weight: 100,
        latest_review_id: 'review_holding_msft_001',
        thesis_health: 'HEALTHY',
        action_stance: 'HOLD',
        latest_review_rationale: 'The original Buffett 4-Pillar thesis remains intact.',
        latest_review_evidence_summary: 'Reviewed current valuation and source ledger references.',
        latest_review_uncertainty: 'Needs a refreshed primary-source review after the next quarterly filing.',
        next_review_at: '2026-09-30',
        latest_reviewed_at: '2026-06-30T12:00:00.000Z',
        updated_at: '2026-06-30T12:00:00.000Z',
      }],
      mode: 'personal-local',
    }))

    expect(html).toContain('Portfolio')
    // SCALE-DOWN S5: the ops cockpit + money totals are retired — the THESIS VIEW renders.
    expect(html).toContain('held thesis')
    expect(html).toContain('Your entry price')
    expect(html).toContain('$812.40')
    expect(html).not.toContain('Portfolio operations cockpit')
    expect(html).not.toContain('current value')
    expect(html).toContain('id="holding_msft_001"')
    expect(html).toContain('MSFT')
    // COMPACT REWORK (2026-07-14): the row is a small decision card — entry + latest ±% in the
    // summary, thesis + review record + actions in the expansion. Provenance rows (opened-by actor,
    // price-checked, audit ids) moved to the dossier; the money labels stay retired.
    expect(html).toContain('Opened')
    expect(html).toContain('2026-05-31')
    expect(html).toContain('now $900.00')
    expect(html).toContain('+10.8%')
    expect(html).not.toContain('Unrealized P&amp;L')
    expect(html).not.toContain('Confirmed portfolio state')
    expect(html).not.toContain('Opened by actor')
    expect(html).toContain('Open the full analysis')
    expect(html).toContain('href="/research/rc_msft_001"')
    expect(html).toContain('<summary')
    // REVIEW RETIRED (owner, 2026-07-14): no review forms, no schedule rows — a legacy recorded
    // thesis-health still shows as the row badge (readable forever); the drafted-review ceremony is gone.
    expect(html).toContain('HEALTHY')
    expect(html).not.toContain('Manual fallback actions')
    expect(html).not.toContain('Run Buffett 4-Pillar review')
    expect(html).not.toContain('action="/api/portfolio/holding_msft_001/review"')
    expect(html).not.toContain('Next review')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#047857')
  })

  it('renders a TRUE research buy-below valuation chip + reference line', () => {
    const baseHolding = {
      holding_id: 'holding_msft_001',
      watchlist_item_id: 'watch_msft_001',
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      shares: 1,
      total_cost_basis: 800,
      cost_basis_per_share: 800,
      currency: 'USD',
      opened_at: '2026-05-31',
      updated_at: '2026-06-30T12:00:00.000Z',
    }

    // Current price well above buy-below → OVERVALUED verdict.
    const overvaluedHtml = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        ...baseHolding,
        latest_price_per_share: 900,
        latest_market_value: 900,
        buyBelowPricePerShare: 600,
        moatClass: 'Wide',
        hurdleRate: 0.12,
      }],
      mode: 'personal-local',
    }))
    expect(overvaluedHtml).toContain('OVERVALUED 50%')
    expect(overvaluedHtml).toContain('Buy below $600.00 · Wide · 12% hurdle')
    expect(overvaluedHtml).not.toContain('entry-vs-market')

    // Current price at/under buy-below → IN BUY ZONE (undervalued).
    const buyZoneHtml = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        ...baseHolding,
        latest_price_per_share: 500,
        latest_market_value: 500,
        buyBelowPricePerShare: 600,
        moatClass: 'Wide',
        hurdleRate: 0.12,
      }],
      mode: 'personal-local',
    }))
    expect(buyZoneHtml).toContain('owl-valuation-chip-undervalued')
    expect(buyZoneHtml).toMatch(/UNDERVALUED 17%|IN BUY ZONE/)
    expect(buyZoneHtml).toContain('Buy below $600.00')

    // Current price within ±3% of buy-below → fair / IN BUY ZONE.
    const fairHtml = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        ...baseHolding,
        latest_price_per_share: 605,
        latest_market_value: 605,
        buyBelowPricePerShare: 600,
      }],
      mode: 'personal-local',
    }))
    expect(fairHtml).toContain('owl-valuation-chip-fair')
    expect(fairHtml).toContain('IN BUY ZONE')
    expect(fairHtml).toContain('Buy below $600.00')
  })

  it('falls back to a clearly-labeled entry-vs-market chip when there is no research buy-below', () => {
    const html = renderToStaticMarkup(createElement(PortfolioPanel, {
      holdings: [{
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        shares: 1,
        total_cost_basis: 800,
        cost_basis_per_share: 800,
        currency: 'USD',
        opened_at: '2026-05-31',
        latest_price_per_share: 900,
        latest_market_value: 900,
        updated_at: '2026-06-30T12:00:00.000Z',
      }],
      mode: 'personal-local',
    }))

    expect(html).toContain('UP 13% VS ENTRY')
    expect(html).toContain('Entry-vs-market move (no research buy-below recorded) — not a valuation verdict.')
    expect(html).not.toContain('Buy below $')
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

    // COMPACT REWORK (2026-07-14): the boards carry the gate as a CHIP on the row summary; the
    // reasons, required sources, and missing-evidence detail live in the dossier (the "specifics"
    // the owner routed to the full analysis). The chip itself must stay truthful per state.
    expect(conditionalWatchlistHtml).toContain('CONDITIONAL')
    expect(conditionalWatchlistHtml).not.toContain('Required Shariah sources')
    expect(unknownWatchlistHtml).toContain('GATE PENDING')
    expect(unknownWatchlistHtml).not.toContain('PENDING — allowed')
    // A BLOCKED holding row must not silently render clean: the gate detail moved to the dossier,
    // and the board keeps no false-positive chip (no APPROVED/derived verdict without the gate).
    expect(blockedHoldingHtml).not.toContain('APPROVED')
    expect(blockedHoldingHtml).toContain('BLCK')
  })




  function admissionCandidateCase(): AppResearchCase {
    return {
      research_case_id: 'rc_admit_001',
      version: 1,
      superseded: false,
      archived: false,
      stage: 'decision_drafted',
      company_id: 'company_admit',
      ticker: 'ADMT',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_admit_001',
      decision: 'WATCH',
      investment_verdict: 'WATCH',
      valuation_status: 'FAIR',
      valuation: {
        moat_class: 'wide',
        moat_passes_gate: true,
        buy_price_per_share: 120,
        // POLISH (owner-agreed, 2026-07-12): the admit-request control is ZONE-GATED — admission is
        // on the table only when the price sits in a book zone (rule 7/8) or a recommendation exists.
        in_buy_zone: true,
      },
      next_required_action: 'Consider the admit judgment.',
      updated_at: '2026-06-08T12:00:00.000Z',
      gate_checklist: [],
      source_ids: [],
      ledger_timeline: [],
    }
  }

  it('renders the persisted admit recommendation with uncertainty and permanent-loss-risk as SEPARATE fields', () => {
    const researchCase: AppResearchCase = {
      ...admissionCandidateCase(),
      admit_recommendation: {
        admit_judgment_id: 'admit_admit_001_abc',
        uncertainty: {
          level: 'high',
          argument: 'Outcome range is wide because the turnaround timing is genuinely unknowable.',
          citations: ['src_admit_10k'],
        },
        permanent_loss_risk: {
          level: 'low',
          argument: 'Net cash, no covenant risk; the balance sheet survives a long downturn.',
          citations: ['src_admit_balance_sheet'],
        },
        impairment_bear_case: 'If the new product line fails, owner earnings stay flat for five years.',
        impairment_call: 'fixable_temporary',
        admittable: true,
        reason: 'High uncertainty with low permanent-loss risk is the opportunity; admittable.',
        buy_below: 120,
        cheapness: { fcf_yield: 0.085, ev: 4200, cheap: true, reason: 'Cheap on Phase-1 owner-earnings yield.' },
        uncited_refs: ['some-blog-post'],
        recorded_at: '2026-06-08T12:30:00.000Z',
      },
    }

    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))

    // Uncertainty and permanent-loss risk are SEPARATE, distinct fields (never merged into one line).
    expect(html).toContain('data-testid="admit-uncertainty"')
    expect(html).toContain('data-testid="admit-permanent-loss-risk"')
    expect(html).toContain('Uncertainty')
    expect(html).toContain('Permanent-loss risk')
    // Their distinct levels both appear.
    expect(html).toContain('HIGH')
    expect(html).toContain('LOW')
    // Each carries its own argument + citation.
    expect(html).toContain('turnaround timing is genuinely unknowable')
    expect(html).toContain('the balance sheet survives a long downturn')
    expect(html).toContain('src_admit_10k')
    expect(html).toContain('src_admit_balance_sheet')
    // They must NOT be blurred into a single "value trap" line.
    expect(html.toLowerCase()).not.toContain('value trap')

    // Independent impairment bear case (labelled).
    expect(html).toContain('Impairment bear case')
    expect(html).toContain('the new product line fails')

    // Advisory impairment call + admittable (clearly advisory — the human decides).
    expect(html).toContain('Impairment call: fixable_temporary')
    expect(html).toContain('Advisory: admittable')
    expect(html).toContain('High uncertainty with low permanent-loss risk is the opportunity')

    // Cheapness summary (FCF yield / EV).
    expect(html).toContain('FCF yield 8.5%')
    expect(html).toContain('EV ≈ $4,200M')

    // Uncited refs surfaced as a caveat (not hidden).
    expect(html).toContain('Uncited references caveat')
    expect(html).toContain('some-blog-post')

    // The promote control stays present (admit stays a real human decision — the explicit promote click).
    expect(html).toContain('Promote to watchlist')
  })

  it('shows the on-demand request control and no fabricated recommendation when none is persisted', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: admissionCandidateCase(),
      mode: 'personal-local',
    }))

    // The request control is shown for a deep-dive-complete, gate-passing candidate.
    expect(html).toContain('Admit judgment')
    expect(html).toContain('Request admit judgment')
    // No fabricated recommendation — none of the recommendation render hooks appear.
    expect(html).not.toContain('data-testid="admit-recommendation"')
    expect(html).not.toContain('Impairment bear case')
    expect(html).not.toContain('Advisory: admittable')
  })





})

// ---------------------------------------------------------------------------
// Defense-in-depth UI honesty: warn when a personal-local dossier was authored by the
// built-in mock provider instead of the user's configured provider. When the configured
// provider IS mock-provider (the internal test/cert provider) the banner never shows.
// ---------------------------------------------------------------------------

describe('ResearchCasePanel — mock-provider warning banner', () => {
  function mockAuthoredCase(): AppResearchCase {
    return {
      research_case_id: 'rc_mock_warning_001',
      version: 1,
      superseded: false,
      archived: false,
      stage: 'decision_drafted',
      company_id: 'company_tst',
      ticker: 'TST',
      strategy_id: 'buffett-munger',
      decision_id: 'decision_tst_001',
      decision: 'WATCH',
      reason: 'Placeholder reason recorded by the mock provider.',
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'CONDITIONAL',
      valuation_status: 'FAIR',
      next_required_action: 'Review the dossier.',
      authored_by_provider_id: 'mock-provider',
      updated_at: '2026-06-08T12:00:00.000Z',
      gate_checklist: [],
      source_ids: [],
      ledger_timeline: [],
    } as AppResearchCase
  }

  it('shows the warning when a personal-local mock-authored case has a non-mock configured provider', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: mockAuthoredCase(),
      mode: 'personal-local',
      configuredProviderId: 'openai',
    }))
    expect(html).toContain('data-testid="mock-provider-warning"')
    expect(html).toContain('Placeholder run')
    expect(html).toContain('openai')
  })

  it('hides the warning when the configured provider IS mock-provider', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: mockAuthoredCase(),
      mode: 'personal-local',
      configuredProviderId: 'mock-provider',
    }))
    expect(html).not.toContain('data-testid="mock-provider-warning"')
  })

  it('hides the warning when the authoring provider is not mock-provider', () => {
    const realAuthored = { ...mockAuthoredCase(), authored_by_provider_id: 'openai' }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: realAuthored,
      mode: 'personal-local',
      configuredProviderId: 'openai',
    }))
    expect(html).not.toContain('data-testid="mock-provider-warning"')
  })

  it('hides the warning when authored_by_provider_id is undefined', () => {
    const unknownAuthor = { ...mockAuthoredCase() }
    delete (unknownAuthor as { authored_by_provider_id?: string }).authored_by_provider_id
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: unknownAuthor,
      mode: 'personal-local',
      configuredProviderId: 'openai',
    }))
    expect(html).not.toContain('data-testid="mock-provider-warning"')
  })
})

describe('ResearchCasePanel — circle-of-competence judgment', () => {
  function baseCircleCase(): AppResearchCase {
    return {
      research_case_id: 'rc_circle_ui',
      version: 1,
      superseded: false,
      archived: false,
      stage: 'analysis_drafted',
      company_id: 'company_circ',
      ticker: 'CIRC',
      strategy_id: 'buffett-munger',
      investment_verdict: 'WATCH',
      updated_at: '2026-06-19T12:00:00.000Z',
      gate_checklist: [],
      source_ids: ['src_circle_driver', 'src_circle_breaker'],
      ledger_timeline: [],
    }
  }

  it('G/P1: renders the cited money-making mechanisms + key moving parts and the in-competence outcome', () => {
    const researchCase: AppResearchCase = {
      ...baseCircleCase(),
      circle_competence: {
        in_competence: true,
        judgment: 'understood',
        model_claimed_judgment: 'understood',
        competence_reasoning: 'Understandable cashflow engine demonstrated from filings.',
        drivers: [{ driver: 'Recurring insurance float invested at scale', citation: 'src_circle_driver', grounded: true }],
        breakers: [{ breaker: 'Catastrophe-loss tail volatility', citation: 'src_circle_breaker', grounded: true }],
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
    expect(html).toContain('data-testid="circle-competence"')
    expect(html).toContain('Business understood')
    expect(html).toContain('Recurring insurance float invested at scale')
    expect(html).toContain('Catastrophe-loss tail volatility')
    expect(html).toContain('Key moving parts — what determines success or failure (cited)')
    expect(html).toContain('Understandable cashflow engine demonstrated from filings.')
  })

  it('C1: renders set-aside with the not-understood message (durability is the moat pillar\u2019s job now)', () => {
    const researchCase: AppResearchCase = {
      ...baseCircleCase(),
      investment_verdict: 'PASS',
      valuation: { circle_competence_unmet: true, outside_circle: true },
      circle_competence: {
        in_competence: false,
        judgment: 'not_understood',
        model_claimed_judgment: 'not_understood',
        competence_reasoning: 'The core economic engine could not be explained from the filings.',
        circle_competence_unmet: true,
        reason: 'circle_competence_unmet: the model judged this business NOT understood — set aside.',
        drivers: [{ driver: 'DRAM/NAND pricing cycle', citation: 'src_circle_driver', grounded: true }],
        breakers: [{ breaker: 'Commodity memory price collapses', citation: 'src_circle_breaker', grounded: true }],
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
    expect(html).toContain('Outside competence — set aside (the business could not be explained from the filings)')
    expect(html).toContain('the model judged this business NOT understood')
  })

  it('renders the legacy boolean event (in_competence:false, no enum) as set-aside', () => {
    const researchCase: AppResearchCase = {
      ...baseCircleCase(),
      investment_verdict: 'PASS',
      valuation: { circle_competence_unmet: true, outside_circle: true },
      circle_competence: {
        in_competence: false,
        model_claimed_in_competence: true,
        competence_reasoning: 'Legacy boolean case.',
        circle_competence_unmet: true,
        reason: 'circle_competence_unmet: the predictability_breakers citations did NOT verify — set aside.',
        drivers: [{ driver: 'Driver claim', citation: 'src_circle_driver', grounded: true }],
        breakers: [{ breaker: 'Breaker claim', citation: 'src_unverified', grounded: false }],
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
    expect(html).toContain('Outside competence — set aside')
    // Compact citation marker (Priority 5): the verbose inline id is gone from the reading line; an
    // unverified cite is surfaced via the marker's title (full id preserved) — traceability is kept.
    expect(html).toContain('data-testid="citation-marker"')
    expect(html).toContain('Citation did not verify: src_unverified')
    expect(html).toContain('the predictability_breakers citations did NOT verify')
  })

  it('renders nothing for the circle panel on a legacy case without the judgment', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase: baseCircleCase(), mode: 'personal-local' }))
    expect(html).not.toContain('data-testid="circle-competence"')
  })
})
