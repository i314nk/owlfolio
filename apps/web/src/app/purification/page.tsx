import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PurificationReport } from '../../components/PurificationReport'
import { buildPurificationReport, getPurificationReportFromStore } from '../../lib/purification'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'

export default async function PurificationPage() {
  const state = await getOnboardingState()
  const report = await loadPurificationReport(state)

  return (
    <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <PurificationReport report={report} />
      </div>
    </main>
  )
}

async function loadPurificationReport(state: OnboardingState) {
  if (state.config.mode === 'demo') {
    return buildPurificationReport(await getDemoEvents())
  }

  if (state.config.ledger_path === undefined) {
    return buildPurificationReport([])
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await getPurificationReportFromStore(store)
  } finally {
    store.close()
  }
}
