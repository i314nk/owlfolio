import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { ResearchLibrary } from '../../components/ResearchLibrary'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { resolveDisplayNamesForTickers } from '../../lib/displayNames'

export default async function ResearchLandingPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Research library" />
  }
  const selectedStrategyId = state.config.strategy_id
  const store = new SQLiteEventStore(state.config.ledger_path)

  try {
    const events = await store.list()
    const projected = projectResearchCases(events)
    // Display-name backfill for legacy cases (see displayNames.ts) — the stamped name always wins.
    const displayNames = await resolveDisplayNamesForTickers(projected.map((c) => c.ticker))
    const cases = projected.map((c) => {
      if (c.entity_name !== undefined || c.ticker === undefined) return c
      const name = displayNames.get(c.ticker.toUpperCase())
      return name === undefined ? c : { ...c, entity_name: name }
    })

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
