import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { openHoldingFromWatchlist } from '../holdingWorkflow'
import { createResearchCase } from '../researchWorkflow'
import {
  discoverCandidate,
  promoteDiscoveryCandidateToResearchCase,
  queueDiscoveryCandidateForQuickScreen,
  rejectDiscoveryCandidate,
  runMockStrategyDiscovery,
} from '../discoveryCandidateWorkflow'
import { confirmWatchlistDraft } from '../watchlistWorkflow'
import { CHECKLIST_PARAMS, listBusinessItems } from '@owlfolio/strategies/checklistParams'

// Phase 7 S2: admit requires every hygiene/bias checklist item to be addressed (affirmed + note).
const COMPLETE_AUDIT: import('@owlfolio/strategies/checklistParams').ChecklistAudit = {
  version: CHECKLIST_PARAMS.version,
  business_findings: Object.fromEntries(
    listBusinessItems().map((item) => [item.id, `Marshaled finding for ${item.id}.`]),
  ),
  cognitive_acknowledged: true,
}

describe('discovery candidate queue', () => {
  it('records selected-strategy candidates before quick screening without creating portfolio state', async () => {
    const store = new InMemoryEventStore()

    const discovered = await discoverCandidate(store, {
      candidate_id: 'candidate_msft_quality_001',
      ticker: 'msft',
      company_name: 'Microsoft Corporation',
      market: 'NASDAQ',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_mock_quality_screen_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })

    expect(discovered).toMatchObject({
      event_type: 'discovery_candidate_discovered',
      aggregate_type: 'discovery_candidate',
      candidate_id: 'candidate_msft_quality_001',
      ticker: 'MSFT',
      company_name: 'Microsoft Corporation',
      market: 'NASDAQ',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_mock_quality_screen_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      status: 'discovered',
      dedupe_key: 'quality-growth@2026.06:NASDAQ:MSFT',
    })

    const events = await store.list()
    expect(projectDiscoveryCandidates(events)).toEqual([
      expect.objectContaining({
        candidate_id: 'candidate_msft_quality_001',
        ticker: 'MSFT',
        company_name: 'Microsoft Corporation',
        market: 'NASDAQ',
        strategy_id: 'quality-growth',
        strategy_version: '2026.06',
        discovery_source: 'mock_strategy_universe',
        source_ids: ['src_mock_quality_screen_001'],
        discovered_at: '2026-06-06T00:00:00.000Z',
        status: 'discovered',
        dedupe_key: 'quality-growth@2026.06:NASDAQ:MSFT',
      }),
    ])
    expect(projectResearchCases(events)).toEqual([])
    expect(projectWatchlist(events)).toEqual([])
    expect(projectHoldings(events)).toEqual([])
  })

  it('dedupes discovered candidates against research cases, watchlist items, and holdings without mutating them', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_cost_existing_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })

    await createResearchCase(store, {
      research_case_id: 'rc_msft_existing_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    await confirmWatchlistDraft(store, {
      watchlist_item_id: 'watch_msft_existing_001',
      research_case_id: 'rc_msft_existing_001',
      decision_id: 'decision_msft_watch_001',
      company_id: 'company_msft',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Already approved for watchlist monitoring.',
      locked_buy_below: 300,
      buy_below_valuation_version: 'valuation-2026-06-cap-1',
      signed_thesis: 'I am admitting MSFT for monitoring at the frozen buy-below.',
      signed_thesis_draft: 'I am admitting MSFT for monitoring at the frozen buy-below.',
      checklist_audit: COMPLETE_AUDIT,
      actor_id: 'user_local',
    })

    await createResearchCase(store, {
      research_case_id: 'rc_aapl_existing_001',
      company_id: 'company_aapl',
      ticker: 'AAPL',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    const aaplDraft = await confirmWatchlistDraft(store, {
      watchlist_item_id: 'watch_aapl_existing_001',
      research_case_id: 'rc_aapl_existing_001',
      decision_id: 'decision_aapl_watch_001',
      company_id: 'company_aapl',
      ticker: 'AAPL',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Already approved before opening a holding.',
      locked_buy_below: 150,
      buy_below_valuation_version: 'valuation-2026-06-cap-1',
      signed_thesis: 'I am admitting AAPL ahead of opening a tracked holding.',
      signed_thesis_draft: 'I am admitting AAPL ahead of opening a tracked holding.',
      checklist_audit: COMPLETE_AUDIT,
      actor_id: 'user_local',
    })
    await openHoldingFromWatchlist(store, {
      holding_id: 'holding_aapl_existing_001',
      watchlist_item_id: aaplDraft.watchlist_item_id,
      research_case_id: 'rc_aapl_existing_001',
      company_id: 'company_aapl',
      ticker: 'AAPL',
      strategy_id: 'buffett-munger',
      thesis_summary: 'User opened this holding earlier.',
      shares: 1,
      cost_basis_per_share: 100,
      opened_at: '2026-06-01',
      currency: 'USD',
      causation_id: aaplDraft.event_id,
      actor_id: 'user_local',
    })

    const beforeDiscovery = await store.list()
    const researchCaseCount = projectResearchCases(beforeDiscovery).length
    const watchlistCount = projectWatchlist(beforeDiscovery).length
    const holdingCount = projectHoldings(beforeDiscovery).length

    const duplicateResearchCase = await discoverCandidate(store, {
      candidate_id: 'candidate_cost_duplicate_001',
      ticker: 'COST',
      company_name: 'Costco Wholesale Corporation',
      market: 'NASDAQ',
      strategy_id: 'buffett-munger',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_duplicate_cost_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    const duplicateWatchlist = await discoverCandidate(store, {
      candidate_id: 'candidate_msft_duplicate_001',
      ticker: 'MSFT',
      company_name: 'Microsoft Corporation',
      market: 'NASDAQ',
      strategy_id: 'buffett-munger',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_duplicate_msft_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    const duplicateHolding = await discoverCandidate(store, {
      candidate_id: 'candidate_aapl_duplicate_001',
      ticker: 'AAPL',
      company_name: 'Apple Inc.',
      market: 'NASDAQ',
      strategy_id: 'buffett-munger',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_duplicate_aapl_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })

    expect(duplicateResearchCase).toMatchObject({ status: 'duplicate', duplicate_target_type: 'research_case', duplicate_target_id: 'rc_cost_existing_001' })
    expect(duplicateWatchlist).toMatchObject({ status: 'duplicate', duplicate_target_type: 'watchlist_item', duplicate_target_id: 'watch_msft_existing_001' })
    expect(duplicateHolding).toMatchObject({ status: 'duplicate', duplicate_target_type: 'holding', duplicate_target_id: 'holding_aapl_existing_001' })

    const afterDiscovery = await store.list()
    expect(projectResearchCases(afterDiscovery)).toHaveLength(researchCaseCount)
    expect(projectWatchlist(afterDiscovery)).toHaveLength(watchlistCount)
    expect(projectHoldings(afterDiscovery)).toHaveLength(holdingCount)
    expect(projectDiscoveryCandidates(afterDiscovery).map((candidate) => candidate.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ])
  })

  it('supports mock discovery, queueing, rejection, and explicit promotion to a research case', async () => {
    const store = new InMemoryEventStore()

    const discoveredCandidates = await runMockStrategyDiscovery(store, {
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_mock_quality_batch_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
      candidates: [
        { candidate_id: 'candidate_adbe_quality_001', ticker: 'ADBE', company_name: 'Adobe Inc.', market: 'NASDAQ' },
        { candidate_id: 'candidate_zoom_quality_001', ticker: 'ZM', company_name: 'Zoom Video Communications', market: 'NASDAQ' },
      ],
    })
    expect(discoveredCandidates).toHaveLength(2)
    const queueCandidate = discoveredCandidates[0]!
    const rejectCandidate = discoveredCandidates[1]!

    const queued = await queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: queueCandidate.candidate_id,
      queue_id: 'quick_queue_adbe_001',
      causation_id: queueCandidate.event_id,
      actor_id: 'system',
    })
    const rejected = await rejectDiscoveryCandidate(store, {
      candidate_id: rejectCandidate.candidate_id,
      reason: 'Insufficient moat evidence for the selected strategy universe.',
      causation_id: rejectCandidate.event_id,
      actor_id: 'user_local',
    })
    const promoted = await promoteDiscoveryCandidateToResearchCase(store, {
      candidate_id: queueCandidate.candidate_id,
      research_case_id: 'rc_adbe_from_discovery_001',
      company_id: 'company_adbe',
      causation_id: queued.event_id,
      actor_id: 'user_local',
    })

    expect(queued).toMatchObject({ status: 'queued_for_quick_screen', queue_id: 'quick_queue_adbe_001' })
    expect(rejected).toMatchObject({ status: 'rejected', reason: 'Insufficient moat evidence for the selected strategy universe.' })
    expect(promoted).toMatchObject({
      status: 'promoted_to_research_case',
      research_case_id: 'rc_adbe_from_discovery_001',
      research_case_event_id: 'evt_research_case_created_rc_adbe_from_discovery_001',
    })

    const events = await store.list()
    expect(events.map((event) => event.event_type)).toEqual([
      'discovery_candidate_discovered',
      'discovery_candidate_discovered',
      'discovery_candidate_queued_for_quick_screen',
      'discovery_candidate_rejected',
      'research_case_created',
      'discovery_candidate_promoted_to_research_case',
    ])
    expect(projectDiscoveryCandidates(events)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate_id: 'candidate_adbe_quality_001',
        status: 'promoted_to_research_case',
        queue_id: 'quick_queue_adbe_001',
        research_case_id: 'rc_adbe_from_discovery_001',
      }),
      expect.objectContaining({
        candidate_id: 'candidate_zoom_quality_001',
        status: 'rejected',
        reason: 'Insufficient moat evidence for the selected strategy universe.',
      }),
    ]))
    expect(projectResearchCases(events)).toEqual([
      expect.objectContaining({
        research_case_id: 'rc_adbe_from_discovery_001',
        company_id: 'company_adbe',
        ticker: 'ADBE',
        strategy_id: 'quality-growth',
        strategy_version: '2026.06',
        stage: 'discovered',
      }),
    ])
    expect(projectWatchlist(events)).toEqual([])
    expect(projectHoldings(events)).toEqual([])
  })

  it('prevents rejected or promoted candidates from re-entering the quick-screen queue', async () => {
    const store = new InMemoryEventStore()

    const rejectedCandidate = await discoverCandidate(store, {
      candidate_id: 'candidate_rejected_terminal_001',
      ticker: 'TEAM',
      company_name: 'Atlassian Corporation',
      market: 'NASDAQ',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_terminal_candidate_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    await rejectDiscoveryCandidate(store, {
      candidate_id: rejectedCandidate.candidate_id,
      reason: 'Rejected by user before quick screening.',
      causation_id: rejectedCandidate.event_id,
      actor_id: 'user_local',
    })

    const promotedCandidate = await discoverCandidate(store, {
      candidate_id: 'candidate_promoted_terminal_001',
      ticker: 'CRM',
      company_name: 'Salesforce, Inc.',
      market: 'NYSE',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_terminal_candidate_002'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    const queued = await queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: promotedCandidate.candidate_id,
      queue_id: 'quick_queue_crm_001',
      causation_id: promotedCandidate.event_id,
      actor_id: 'system',
    })
    await promoteDiscoveryCandidateToResearchCase(store, {
      candidate_id: promotedCandidate.candidate_id,
      research_case_id: 'rc_crm_from_discovery_001',
      company_id: 'company_crm',
      causation_id: queued.event_id,
      actor_id: 'user_local',
    })

    await expect(queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: rejectedCandidate.candidate_id,
      queue_id: 'quick_queue_team_after_reject_001',
      causation_id: rejectedCandidate.event_id,
      actor_id: 'system',
    })).rejects.toThrow('must be newly discovered')
    await expect(queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: promotedCandidate.candidate_id,
      queue_id: 'quick_queue_crm_after_promote_001',
      causation_id: queued.event_id,
      actor_id: 'system',
    })).rejects.toThrow('must be newly discovered')
  })

  it('prevents terminal candidates from being rejected after duplicate, rejection, or promotion', async () => {
    const store = new InMemoryEventStore()

    await createResearchCase(store, {
      research_case_id: 'rc_team_existing_duplicate_001',
      company_id: 'company_team',
      ticker: 'TEAM',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      actor_id: 'user_local',
    })
    const duplicateCandidate = await discoverCandidate(store, {
      candidate_id: 'candidate_duplicate_terminal_001',
      ticker: 'TEAM',
      company_name: 'Atlassian Corporation',
      market: 'NASDAQ',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_terminal_candidate_duplicate_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })

    const rejectedCandidate = await discoverCandidate(store, {
      candidate_id: 'candidate_rejected_terminal_002',
      ticker: 'ZM',
      company_name: 'Zoom Communications, Inc.',
      market: 'NASDAQ',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_terminal_candidate_rejected_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    await rejectDiscoveryCandidate(store, {
      candidate_id: rejectedCandidate.candidate_id,
      reason: 'Rejected before quick screening.',
      causation_id: rejectedCandidate.event_id,
      actor_id: 'user_local',
    })

    const promotedCandidate = await discoverCandidate(store, {
      candidate_id: 'candidate_promoted_terminal_002',
      ticker: 'CRM',
      company_name: 'Salesforce, Inc.',
      market: 'NYSE',
      strategy_id: 'quality-growth',
      strategy_version: '2026.06',
      discovery_source: 'mock_strategy_universe',
      source_ids: ['src_terminal_candidate_promoted_001'],
      discovered_at: '2026-06-06T00:00:00.000Z',
      actor_id: 'mock-provider',
    })
    const queued = await queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: promotedCandidate.candidate_id,
      queue_id: 'quick_queue_crm_terminal_001',
      causation_id: promotedCandidate.event_id,
      actor_id: 'system',
    })
    await promoteDiscoveryCandidateToResearchCase(store, {
      candidate_id: promotedCandidate.candidate_id,
      research_case_id: 'rc_crm_from_discovery_terminal_001',
      company_id: 'company_crm_terminal',
      causation_id: queued.event_id,
      actor_id: 'user_local',
    })

    for (const candidate of [duplicateCandidate, rejectedCandidate, promotedCandidate]) {
      await expect(rejectDiscoveryCandidate(store, {
        candidate_id: candidate.candidate_id,
        reason: 'Do not overwrite terminal discovery state.',
        causation_id: candidate.event_id,
        actor_id: 'user_local',
      })).rejects.toThrow('can only be rejected before terminal state')
    }
  })
})
