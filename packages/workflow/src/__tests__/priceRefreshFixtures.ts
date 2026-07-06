/**
 * Minimal test fixtures for runPriceRefresh tests.
 * Produces a user-approved watchlist item with a research case (and buy_price_per_share)
 * and an open holding, using only the event types that the relevant projections need.
 */
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'

type Store = EventStore<LedgerEventEnvelope<unknown>>

/**
 * Seed a user-approved watchlist item with a research case that has buy_price_per_share.
 * Emits: research_case_created → buffett_munger_analysis_drafted → watchlist_draft_created →
 * watchlist_draft_confirmed.
 * Uses `2026-01-01` as the case's created_at so it is fresh relative to any 2026 test clock.
 */
export async function seedConfirmedWatchlistItem(
  store: Store,
  { ticker, buy_below }: { ticker: string; buy_below: number },
): Promise<{ watchlist_item_id: string; research_case_id: string }> {
  const id = ticker.toLowerCase()
  const research_case_id = `rc_${id}_fixture`
  const watchlist_item_id = `watch_${id}_fixture`

  // 1. research_case_created — establishes the research case aggregate
  await store.append({
    event_id: `evt_research_case_created_${id}_fixture`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: research_case_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker, company_id: `company_${id}`, strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
  })

  // 2. buffett_munger_analysis_drafted — carries valuation.buy_price_per_share used by the buy-window
  await store.append({
    event_id: `evt_analysis_drafted_${id}_fixture`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: research_case_id,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      next_required_action: 'Confirm watchlist draft',
      valuation: { buy_price_per_share: buy_below, moat_class: 'wide' },
    },
    source_ids: [],
    created_at: '2026-01-01T00:01:00.000Z',
    schema_version: 1,
  })

  // 3. watchlist_draft_created — establishes the watchlist item (user_approved: false initially)
  await store.append({
    event_id: `evt_watchlist_draft_created_${id}_fixture`,
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: watchlist_item_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id,
      ticker,
      user_approved: false,
      company_id: `company_${id}`,
      strategy_id: 'buffett-munger',
      thesis_summary: `Fixture watchlist item for ${ticker}`,
    },
    source_ids: [],
    created_at: '2026-01-01T00:02:00.000Z',
    schema_version: 1,
  })

  // 4. watchlist_draft_confirmed — sets user_approved: true, locked_buy_below for display
  await store.append({
    event_id: `evt_watchlist_draft_confirmed_${id}_fixture`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: watchlist_item_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id, ticker, locked_buy_below: buy_below },
    source_ids: [],
    created_at: '2026-01-01T00:03:00.000Z',
    schema_version: 1,
  })

  return { watchlist_item_id, research_case_id }
}

/**
 * Seed an open holding. The watchlist_item_id and research_case_id in the payload use the
 * same naming convention as seedConfirmedWatchlistItem so they can be combined, but the
 * holding fixture does NOT require the watchlist events to be present in the same store
 * (projectHoldings only needs the string values, not correlated events).
 */
export async function seedOpenHolding(
  store: Store,
  { ticker, shares }: { ticker: string; shares: number },
): Promise<{ holding_id: string }> {
  const id = ticker.toLowerCase()
  const holding_id = `holding_${id}_fixture`
  const watchlist_item_id = `watch_${id}_fixture`
  const research_case_id = `rc_${id}_fixture`

  await store.append({
    event_id: `evt_holding_opened_${id}_fixture`,
    event_type: 'holding_opened',
    aggregate_type: 'holding',
    aggregate_id: holding_id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      holding_id,
      watchlist_item_id,
      research_case_id,
      ticker,
      shares,
      cost_basis_per_share: 100,
      total_cost_basis: shares * 100,
      currency: 'USD',
      opened_at: '2026-01-01',
      strategy_id: 'buffett-munger',
    },
    source_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
  })

  return { holding_id }
}
