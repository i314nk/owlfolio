import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { WatchlistPanel } from '../../components/WatchlistPanel'
import { getDemoWatchlistItems } from '../../lib/demo'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppWatchlistItemsFromStore } from '../../lib/workflow'

export default async function WatchlistPage() {
  const state = await getOnboardingState()
  const watchlistItems = state.config.mode === 'demo'
    ? await getDemoWatchlistItems()
    : await loadPersonalWatchlist(state.config.ledger_path)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <WatchlistPanel items={watchlistItems} mode={state.config.mode} />
    </main>
  )
}

async function loadPersonalWatchlist(ledgerPath: string | undefined) {
  if (ledgerPath === undefined) {
    return []
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    return await getAppWatchlistItemsFromStore(store, 'personal-local')
  } finally {
    store.close()
  }
}
