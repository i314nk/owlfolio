import { createElement } from 'react'

import { projectDiscovery13f } from '@owlfolio/ledger/projections/discovery13fProjection'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectScheduledTasks } from '@owlfolio/ledger/projections/scheduledTaskProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
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
    const { quarters, sells } = projectDiscovery13f(events)
    const heldOrWatchedTickers = [
      ...projectHoldings(events).flatMap((h) => (h.ticker === undefined ? [] : [h.ticker])),
      ...projectWatchlist(events).flatMap((w) => (w.ticker === undefined ? [] : [w.ticker])),
    ]

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
        quarters,
        sells,
        heldOrWatchedTickers,
      }),
    )
  } finally {
    store.close()
  }
}
