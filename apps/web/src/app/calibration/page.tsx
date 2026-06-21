import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import {
  loadCalibrationUniverse,
  projectCalibrationUniverse,
  suggestCalibrationUniverseAdditions,
} from '@owlfolio/workflow/calibrationUniverse'

import { CalibrationPanel } from '../../components/CalibrationPanel'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { projectCalibrationView } from '../../lib/calibration'
import { getDemoEvents } from '../../lib/demo'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'

export const metadata = {
  title: 'Calibration · Owlfolio',
  description: 'A confidence signal for the valuation/sizing parameters: reverse-DCF backtest signal log, deployment-ratio metric, owner-curated universe, and parameter version history. It reports how the live config behaves; it does not tune or freeze it.',
}

export default async function CalibrationPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Calibration" />
  }
  const events = await loadCalibrationEvents(state)
  // The current universe is a PROJECTION: the seed config + user-authored member add/remove events (Rule 1).
  const seedUniverse = loadCalibrationUniverse()
  const universe = seedUniverse === undefined ? undefined : projectCalibrationUniverse(seedUniverse, events)
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
