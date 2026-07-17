import { createElement } from 'react'

import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectLatestPriceSnapshots } from '@owlfolio/ledger/projections/priceSnapshotProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { CommandCenter, type ZoneStripEntry } from '../components/CommandCenter'
import { getSetupAwareCommandCenter } from '../lib/commandCenter'
import { getOnboardingState } from '../lib/onboarding'

/**
 * The zone strip (owner, 2026-07-17): where every held/watched name stands right now, computed
 * from the LATEST recorded price snapshot vs the entry (held) or the frozen buy-below (watched).
 * No snapshot yet → an honest 'no price snapshot yet' line, never a fabricated figure.
 */
async function buildZoneStrip(ledgerPath: string | undefined): Promise<ZoneStripEntry[]> {
  if (ledgerPath === undefined) return []
  const store = new SQLiteEventStore(ledgerPath)
  try {
    const events = await store.list()
    const prices = projectLatestPriceSnapshots(events)
    const latestBuyByTicker = new Map<string, number>()
    for (const c of projectResearchCases(events)) {
      if (c.superseded === true || c.ticker === undefined) continue
      const buy = c.valuation?.buy_price_per_share
      if (buy !== undefined) latestBuyByTicker.set(c.ticker.toUpperCase(), buy)
    }

    const held: ZoneStripEntry[] = projectHoldings(events).flatMap((h): ZoneStripEntry[] => {
      if (h.ticker === undefined) return []
      const price = prices.get(h.ticker.toUpperCase())?.price_per_share
      const entry = h.cost_basis_per_share
      if (price === undefined || entry <= 0) {
        return [{ ticker: h.ticker, kind: 'held' as const, line: `entry $${entry.toFixed(2)} · no price snapshot yet`, href: '/portfolio', tone: 'muted' as const }]
      }
      const ret = ((price - entry) / entry) * 100
      return [{
        ticker: h.ticker,
        kind: 'held' as const,
        line: `entry $${entry.toFixed(2)} · now $${price.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%)`,
        href: '/portfolio',
        tone: ret >= 0 ? 'pass' as const : 'caution' as const,
      }]
    })

    const heldTickers = new Set(held.map((e) => e.ticker.toUpperCase()))
    const watched: ZoneStripEntry[] = projectWatchlist(events).flatMap((w): ZoneStripEntry[] => {
      if (w.ticker === undefined || heldTickers.has(w.ticker.toUpperCase())) return []
      const buy = latestBuyByTicker.get(w.ticker.toUpperCase())
      const price = prices.get(w.ticker.toUpperCase())?.price_per_share
      if (buy === undefined || price === undefined) {
        return [{ ticker: w.ticker, kind: 'watched' as const, line: buy === undefined ? 'no computed buy price yet' : `buy ≤ $${buy.toFixed(2)} · no price snapshot yet`, href: '/watchlist', tone: 'muted' as const }]
      }
      const above = ((price - buy) / buy) * 100
      return [{
        ticker: w.ticker,
        kind: 'watched' as const,
        line: above <= 0
          ? `buy ≤ $${buy.toFixed(2)} · now $${price.toFixed(2)} — IN THE BUY ZONE`
          : `buy ≤ $${buy.toFixed(2)} · now $${price.toFixed(2)} (${above.toFixed(0)}% above)`,
        href: '/watchlist',
        tone: above <= 0 ? 'pass' as const : 'muted' as const,
      }]
    })

    return [...held, ...watched]
  } finally {
    store.close()
  }
}

export default async function HomePage() {
  const state = await getOnboardingState()
  const dashboard = await getSetupAwareCommandCenter(state)
  const zoneStrip = state.is_initialized && state.config.mode === 'personal-local'
    ? await buildZoneStrip(state.config.ledger_path)
    : []

  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(CommandCenter, { dashboard, zoneStrip }),
  )
}
