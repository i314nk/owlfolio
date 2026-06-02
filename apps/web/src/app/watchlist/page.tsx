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
    <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <WatchlistPanel items={watchlistItems} mode={state.config.mode} />
      </div>
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
