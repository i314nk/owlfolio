import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { PurificationReport } from '../../components/PurificationReport'
import { buildPurificationReport, getPurificationReportFromStore } from '../../lib/purification'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'

export default async function PurificationPage() {
  const state = await getOnboardingState()
  const report = await loadPurificationReport(state)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <PurificationReport report={report} />
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
