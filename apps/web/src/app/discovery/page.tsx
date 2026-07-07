import { createElement } from 'react'

import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { DiscoveryPanel } from '../../components/DiscoveryPanel'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'

export default async function DiscoveryPage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return createElement(UnconfiguredNotice, { feature: 'Discovery' })
  }

  const store = new SQLiteEventStore(state.config.ledger_path)

  try {
    const events = await store.list()
    const candidates = projectDiscoveryCandidates(events)
    const runStatus = projectScheduledTasks(events).find((t) => t.task_kind === 'discovery_13f')

    return createElement(
      'main',
      { className: 'owl-route-frame' },
      createElement(
        'p',
        { className: 'owl-route-back-row' },
        createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
      ),
      createElement(DiscoveryPanel, {
        candidates,
        ...(runStatus !== undefined ? { runStatus } : {}),
      }),
    )
  } finally {
    store.close()
  }
}
