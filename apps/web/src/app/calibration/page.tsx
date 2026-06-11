import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { loadCalibrationUniverse, suggestCalibrationUniverseAdditions } from '@owlfolio/workflow/calibrationUniverse'

import { CalibrationPanel } from '../../components/CalibrationPanel'
import { projectCalibrationView } from '../../lib/calibration'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'

export const metadata = {
  title: 'Calibration · Owlfolio',
  description: 'Backtest signal log, deployment-ratio metric, and parameter version history for the valuation/sizing calibration.',
}

export default async function CalibrationPage() {
  const state = await getOnboardingState()
  const events = await loadCalibrationEvents(state)
  const universe = loadCalibrationUniverse()
  const view = projectCalibrationView(events, {
    ...(universe === undefined ? {} : { universe, suggestions: suggestCalibrationUniverseAdditions(universe, events) }),
  })

  return (
    <main className="owl-route-frame owl-route-frame-wide">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <CalibrationPanel view={view} />
    </main>
  )
}

async function loadCalibrationEvents(state: OnboardingState) {
  if (state.config.mode === 'demo') {
    return getDemoEvents()
  }

  if (state.config.ledger_path === undefined) {
    return []
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await store.list()
  } finally {
    store.close()
  }
}
