import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { AuditActivityPanel } from '../../components/AuditActivityPanel'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'
import { getAuditActivityEventsFromStore, projectAuditActivityEvents } from '../../lib/audit'

export default async function AuditPage() {
  const state = await getOnboardingState()
  const events = await loadAuditActivity(state)

  return (
    <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <AuditActivityPanel events={events} mode={state.config.mode} />
      </div>
    </main>
  )
}

async function loadAuditActivity(state: OnboardingState) {
  if (state.config.mode === 'demo') {
    return projectAuditActivityEvents(await getDemoEvents())
  }

  if (state.config.ledger_path === undefined) {
    return []
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await getAuditActivityEventsFromStore(store)
  } finally {
    store.close()
  }
}
