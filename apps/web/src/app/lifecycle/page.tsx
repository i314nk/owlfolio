import { projectNameLifecycle, type NameLifecycleProjection } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { LifecyclePanel } from '../../components/LifecyclePanel'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState } from '../../lib/onboarding'

export default async function LifecyclePage() {
  const state = await getOnboardingState()
  const names = state.config.mode === 'demo'
    ? projectNameLifecycle(await getDemoEvents())
    : await loadPersonalLifecycle(state.config.ledger_path)

  return (
    <main className="owl-route-frame">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <LifecyclePanel names={names} />
    </main>
  )
}

async function loadPersonalLifecycle(ledgerPath: string | undefined): Promise<NameLifecycleProjection[]> {
  if (ledgerPath === undefined) {
    return []
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    const events = await store.list()
    return projectNameLifecycle(events)
  } finally {
    store.close()
  }
}
