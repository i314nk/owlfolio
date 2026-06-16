import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { WatchlistPanel } from '../../components/WatchlistPanel'
import { getDemoEvents, getDemoMonitorAlerts, getDemoWatchlistItems } from '../../lib/demo'
import { isUnconfigured } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { enrichWatchlistItemsWithVerdict, getAppMonitorAlertsFromStore, getAppWatchlistItemsFromStore, type AppWatchlistItem, type MonitorAlert } from '../../lib/workflow'

export default async function WatchlistPage() {
  const state = await getOnboardingState()
  if (isUnconfigured(state.config)) {
    return <UnconfiguredNotice feature="Watchlist" />
  }
  const { items: watchlistItems, alerts } = state.config.mode === 'demo'
    ? {
        items: enrichWatchlistItemsWithVerdict(await getDemoWatchlistItems(), projectResearchCases(await getDemoEvents())),
        alerts: await getDemoMonitorAlerts(),
      }
    : await loadPersonalWatchlist(state.config.ledger_path)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <WatchlistPanel items={watchlistItems} mode={state.config.mode} alerts={alerts} />
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
    return {
      items: enrichWatchlistItemsWithVerdict(items, projectResearchCases(events)),
      alerts: await getAppMonitorAlertsFromStore(store),
    }
  } finally {
    store.close()
  }
}
