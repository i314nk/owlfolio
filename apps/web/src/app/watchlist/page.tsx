import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { WatchlistPanel } from '../../components/WatchlistPanel'
import { getDemoMonitorAlerts, getDemoWatchlistItems } from '../../lib/demo'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppMonitorAlertsFromStore, getAppWatchlistItemsFromStore, type AppWatchlistItem, type MonitorAlert } from '../../lib/workflow'

export default async function WatchlistPage() {
  const state = await getOnboardingState()
  const { items: watchlistItems, alerts } = state.config.mode === 'demo'
    ? { items: await getDemoWatchlistItems(), alerts: await getDemoMonitorAlerts() }
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
    return {
      items: await getAppWatchlistItemsFromStore(store, 'personal-local'),
      alerts: await getAppMonitorAlertsFromStore(store),
    }
  } finally {
    store.close()
  }
}
