import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel } from '../../components/PortfolioPanel'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppHoldingsFromStore } from '../../lib/workflow'

export default async function PortfolioPage() {
  const state = await getOnboardingState()
  const holdings = await loadHoldings(state.config.ledger_path, state.config.mode)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <PortfolioPanel holdings={holdings} mode={state.config.mode} />
    </main>
  )
}

async function loadHoldings(ledgerPath: string | undefined, mode: 'demo' | 'personal-local') {
  if (ledgerPath === undefined && mode === 'personal-local') {
    return []
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    return await getAppHoldingsFromStore(store, mode)
  } finally {
    store.close()
  }
}
