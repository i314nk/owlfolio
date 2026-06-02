import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PortfolioPanel } from '../../components/PortfolioPanel'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppHoldingsFromStore } from '../../lib/workflow'

export default async function PortfolioPage() {
  const state = await getOnboardingState()
  const holdings = await loadHoldings(state.config.ledger_path, state.config.mode)

  return (
    <main style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)', color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <PortfolioPanel holdings={holdings} mode={state.config.mode} />
      </div>
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
