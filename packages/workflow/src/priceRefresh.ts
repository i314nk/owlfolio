/**
 * runPriceRefresh — shared idempotent on-demand price check operation.
 *
 * Resolves the union of tracked tickers (user-approved watchlist items + open holdings),
 * fetches each price via resolveCurrentPrice, and emits:
 *   - price_snapshot_recorded   — per refreshed ticker   (always)
 *   - watchlist_monitor_alert_recorded — when a buy-window signal fires or is suppressed
 *   - holding_valuation_recorded — per holding for each refreshed ticker
 *
 * Returns { refreshed, unavailable, buy_zone_hits }.
 *
 * Built incrementally across sub-tasks 3a → 3b → 3c.
 */
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { resolveCurrentPrice, defaultPriceSource, type PriceSource } from './marketData'
import { evaluateWatchlistBuyWindow, type MonitorResearchCaseInput } from './lifecycleMonitors'

export const PRICE_REFRESH_ACTOR_ID = 'price_refresh'

export type RunPriceRefreshDeps = {
  priceSource?: PriceSource
  now?: () => Date
}

export type PriceRefreshResult = {
  refreshed: string[]
  unavailable: string[]
  buy_zone_hits: string[]
}

export async function runPriceRefresh(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  deps?: RunPriceRefreshDeps,
): Promise<PriceRefreshResult> {
  const events = await store.list()
  const watchlist = projectWatchlist(events)
  const holdings = projectHoldings(events)
  const researchCases = projectResearchCases(events)

  const now = deps?.now?.() ?? new Date()
  const checkedAt = now.toISOString()
  const asOfDate = checkedAt.slice(0, 10)

  // Union of tickers: user-approved watchlist items + all open holdings.
  // Insertion order: watchlist first, then holdings (for deterministic result arrays).
  const tickerSet = new Set<string>()
  for (const item of watchlist) {
    if (item.user_approved && item.ticker) {
      tickerSet.add(item.ticker)
    }
  }
  for (const holding of holdings) {
    if (holding.ticker) {
      tickerSet.add(holding.ticker)
    }
  }

  const refreshed: string[] = []
  const unavailable: string[] = []
  const buy_zone_hits: string[] = []

  for (const ticker of tickerSet) {
    const quote = await resolveCurrentPrice(
      { ticker },
      undefined,
      deps?.priceSource ?? defaultPriceSource,
    )

    if (!quote.available) {
      unavailable.push(ticker)
      continue
    }

    refreshed.push(ticker)

    // ── price_snapshot_recorded ──────────────────────────────────────────────
    const snapId = `psnap_${ticker}_${asOfDate}_${quote.source}`
    await store.append({
      event_id: `evt_price_snapshot_recorded_${snapId}`,
      event_type: 'price_snapshot_recorded',
      aggregate_type: 'portfolio',
      aggregate_id: ticker,
      actor_type: 'worker',
      actor_id: PRICE_REFRESH_ACTOR_ID,
      idempotency_key: `price-snapshot:${ticker}:${asOfDate}:${quote.source}`,
      payload: {
        snapshot_id: snapId,
        ticker,
        price_per_share: quote.price_per_share,
        currency: quote.currency,
        as_of: quote.as_of,
        source: quote.source,
        checked_at: checkedAt,
      },
      source_ids: [`${quote.source}:${ticker}:${quote.as_of}`],
      created_at: checkedAt,
      schema_version: 1,
    } satisfies LedgerEventEnvelope<Record<string, unknown>>)

    // ── watchlist_monitor_alert_recorded (per user-approved item with this ticker) ──
    for (const item of watchlist) {
      if (!item.user_approved || item.ticker !== ticker) continue

      const researchCase = researchCases.find((c) => c.research_case_id === item.research_case_id)
      if (researchCase === undefined) continue

      const buyPrice =
        researchCase.valuation?.buy_price_per_share ??
        researchCase.valuation?.proposed_buy_below

      const monitorInput: MonitorResearchCaseInput = {
        research_case_id: researchCase.research_case_id,
        ...(researchCase.ticker !== undefined ? { ticker: researchCase.ticker } : {}),
        updated_at: researchCase.updated_at,
        ...(buyPrice !== undefined ? { buy_price_per_share: buyPrice } : {}),
        superseded: researchCase.superseded,
      }

      const result = evaluateWatchlistBuyWindow(monitorInput, {
        current_price: quote.price_per_share,
        now,
      })

      if (result.buy_window_alert || result.suppressed || result.rerun_needed) {
        const alertId = `wmon_${item.watchlist_item_id}_${asOfDate.replace(/[^0-9]/g, '')}`
        const alertKind = result.buy_window_alert
          ? 'buy_window'
          : result.suppressed
            ? 'buy_window_suppressed'
            : 'no_signal'

        await store.append({
          event_id: `evt_watchlist_monitor_alert_recorded_${alertId}`,
          event_type: 'watchlist_monitor_alert_recorded',
          aggregate_type: 'watchlist_item',
          aggregate_id: item.watchlist_item_id,
          actor_type: 'worker',
          actor_id: PRICE_REFRESH_ACTOR_ID,
          idempotency_key: `watchlist-monitor-alert:${alertId}:${quote.source}`,
          payload: {
            alert_id: alertId,
            watchlist_item_id: item.watchlist_item_id,
            research_case_id: researchCase.research_case_id,
            ticker,
            alert_kind: alertKind,
            buy_window_alert: result.buy_window_alert,
            suppressed: result.suppressed,
            ...(result.suppression_reason !== undefined
              ? { suppression_reason: result.suppression_reason }
              : {}),
            rerun_needed: result.rerun_needed,
            ...(result.discount_to_buy_pct !== undefined
              ? { discount_to_buy_pct: result.discount_to_buy_pct }
              : {}),
            case_age_months: result.freshness.age_months,
            is_observation: true,
            is_recommendation: false,
            message: result.message,
          },
          source_ids: [`${quote.source}:${ticker}:${quote.as_of}`],
          created_at: checkedAt,
          schema_version: 1,
        } satisfies LedgerEventEnvelope<Record<string, unknown>>)

        if (result.buy_window_alert && !buy_zone_hits.includes(ticker)) {
          buy_zone_hits.push(ticker)
        }
      }
    }

    // ── holding_valuation_recorded (per holding with this ticker) ────────────
    for (const holding of holdings) {
      if (holding.ticker !== ticker) continue

      const snapshotId = `hval_${holding.holding_id}_${asOfDate}`
      const marketValue = Math.round(quote.price_per_share * holding.shares * 100) / 100

      await store.append({
        event_id: `evt_holding_valuation_recorded_${snapshotId}`,
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: holding.holding_id,
        actor_type: 'worker',
        actor_id: PRICE_REFRESH_ACTOR_ID,
        idempotency_key: `holding-valuation:${holding.holding_id}:${asOfDate}:${quote.source}`,
        payload: {
          snapshot_id: snapshotId,
          holding_id: holding.holding_id,
          price_per_share: quote.price_per_share,
          shares: holding.shares,
          market_value: marketValue,
          currency: holding.currency,
          valued_at: asOfDate,
          valuation_source: quote.source,
          price_checked_at: quote.as_of,
          confidence: 'market',
          caveat: 'Live market price',
          missing_data: [],
          valued_by_actor_type: 'worker',
          valued_by_actor_id: PRICE_REFRESH_ACTOR_ID,
        },
        source_ids: [`${quote.source}:${ticker}:${quote.as_of}`],
        created_at: checkedAt,
        schema_version: 1,
      } satisfies LedgerEventEnvelope<Record<string, unknown>>)
    }
  }

  return { refreshed, unavailable, buy_zone_hits }
}
