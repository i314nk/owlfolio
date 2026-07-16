import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectLatestPriceSnapshots } from '@owlfolio/ledger/projections/priceSnapshotProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { RefreshPricesButton } from '../../components/RefreshPricesButton'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { WatchlistPanel } from '../../components/WatchlistPanel'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { enrichWatchlistItemsWithVerdict, getAppMonitorAlertsFromStore, getAppWatchlistItemsFromStore, type AppWatchlistItem, type MonitorAlert } from '../../lib/workflow'
import { resolveDisplayNamesForTickers } from '../../lib/displayNames'

export default async function WatchlistPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Watchlist" />
  }
  const { items: watchlistItems, alerts } = await loadPersonalWatchlist(state.config.ledger_path)

  return (
    <main className="owl-route-frame">
      {/* div, not p: RefreshPricesButton renders a <div>, and <p> cannot contain block elements —
          the invalid nesting caused a hydration failure that tripped the intake e2e spec. */}
      <div className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
        <RefreshPricesButton />
      </div>
      <WatchlistPanel items={watchlistItems} mode={state.config.mode} alerts={alerts} shariahEnabled={state.config.shariah.enabled} />
    </main>
  )
}

async function loadPersonalWatchlist(ledgerPath: string | undefined): Promise<{ items: AppWatchlistItem[]; alerts: MonitorAlert[] }> {
  if (ledgerPath === undefined) {
    return { items: [], alerts: [] }
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    const items = await getAppWatchlistItemsFromStore(store, 'personal-local')
    const events = await store.list()
    const enriched = enrichWatchlistItemsWithVerdict(items, projectResearchCases(events), new Date(), projectLatestPriceSnapshots(events))
    // Display-name backfill: legacy cases predate the entity_name stamp — fill from the SEC ticker
    // map (cached, display-only; the stamped name always wins).
    const names = await resolveDisplayNamesForTickers(enriched.map((item) => item.ticker))
    for (const item of enriched) {
      if (item.verdict !== undefined && item.verdict.entity_name === undefined && item.ticker !== undefined) {
        const name = names.get(item.ticker.toUpperCase())
        if (name !== undefined) item.verdict.entity_name = name
      }
    }
    return {
      items: enriched,
      alerts: await getAppMonitorAlertsFromStore(store),
    }
  } finally {
    store.close()
  }
}
