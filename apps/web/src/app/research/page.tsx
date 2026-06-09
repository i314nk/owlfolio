import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { ResearchLibrary } from '../../components/ResearchLibrary'
import { resolveDemoLedgerPath, seedDemoLedger } from '../../lib/demo'
import { getOnboardingState } from '../../lib/onboarding'

export default async function ResearchLandingPage() {
  const state = await getOnboardingState()
  const selectedStrategyId = state.config.strategy_id
  const store = state.config.mode === 'demo'
    ? new SQLiteEventStore(resolveDemoLedgerPath())
    : new SQLiteEventStore(state.config.ledger_path)

  try {
    if (state.config.mode === 'demo') {
      await seedDemoLedger(store)
    }

    const events = await store.list()
    const cases = projectResearchCases(events)

    return (
      <main className="owl-route-frame owl-route-frame-wide">
        <p className="owl-route-back-row">
          <a className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </a>
        </p>
        <ResearchLibrary
          mode={state.config.mode}
          selectedStrategyLabel={`Selected strategy: ${selectedStrategyId}`}
          cases={cases}
        />
      </main>
    )
  } finally {
    store.close()
  }
}
