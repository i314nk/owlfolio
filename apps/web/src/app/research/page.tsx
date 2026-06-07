import Link from 'next/link'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { ResearchPipelineCockpit } from '../../components/ResearchPipelineCockpit'
import { resolveDemoLedgerPath, seedDemoLedger } from '../../lib/demo'
import { getOnboardingState } from '../../lib/onboarding'
import { getAppResearchPipelineFromStore } from '../../lib/workflow'

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

    const pipeline = await getAppResearchPipelineFromStore(store, state.config.mode, selectedStrategyId)
    const selectedStrategyLabel = pipeline.selectedStrategyLabel

    return (
      <main className="owl-route-frame owl-route-frame-wide">
        <p className="owl-route-back-row">
          <Link className="owl-back-link owl-focusable" href="/">
            ← Back to command center
          </Link>
        </p>
        <ResearchPipelineCockpit
          mode={state.config.mode}
          sections={pipeline.sections}
          selectedStrategyLabel={selectedStrategyLabel}
        />
      </main>
    )
  } finally {
    store.close()
  }
}
