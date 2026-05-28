import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { CommandCenter } from '../CommandCenter'
import { ResearchCasePanel } from '../ResearchCasePanel'
import { WatchlistPanel } from '../WatchlistPanel'
import {
  getDemoCommandCenterFromStore,
  getDemoResearchCaseFromStore,
  getDemoWatchlistItemsFromStore,
  seedDemoLedger,
} from '../../lib/demo'

async function withSeededStore<T>(fn: (store: SQLiteEventStore) => Promise<T>): Promise<T> {
  const store = new SQLiteEventStore()
  try {
    await seedDemoLedger(store)
    return await fn(store)
  } finally {
    store.close()
  }
}

describe('research and watchlist workflow pages', () => {
  it('renders a complete demo research case with gates, sources, and next action', async () => {
    await withSeededStore(async (store) => {
      const researchCase = await getDemoResearchCaseFromStore(store, 'rc_cost_001')

      const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase }))

      expect(html).toContain('COST')
      expect(html).toContain('Workflow stage')
      expect(html).toContain('watchlist_draft')
      expect(html).toContain('Investment verdict')
      expect(html).toContain('WATCH')
      expect(html).toContain('Strategy compliance')
      expect(html).toContain('CONDITIONAL')
      expect(html).toContain('Shariah status')
      expect(html).toContain('COMPLIANT')
      expect(html).toContain('Valuation status')
      expect(html).toContain('FAIR')
      expect(html).toContain('Gate checklist')
      expect(html).toContain('Quality business')
      expect(html).toContain('Source IDs')
      expect(html).toContain('src_cost_10k_2025')
      expect(html).toContain('Ledger Timeline')
      expect(html).toContain('Review COST research case and confirm the watchlist draft')
    })
  })

  it('renders draft watchlist state before user confirmation', async () => {
    await withSeededStore(async (store) => {
      const watchlistItems = await getDemoWatchlistItemsFromStore(store)

      const html = renderToStaticMarkup(createElement(WatchlistPanel, { items: watchlistItems }))

      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('COST')
      expect(html).toContain('buffett-munger')
      expect(html).toContain('Durable quality compounder; wait for better margin of safety.')
      expect(html).toContain('Buy-zone status')
      expect(html).toContain('Not set')
      expect(html).toContain('Draft — awaiting user confirmation')
    })
  })

  it('links the command center to the demo research case and watchlist', async () => {
    await withSeededStore(async (store) => {
      const dashboard = await getDemoCommandCenterFromStore(store)
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('href="/research/rc_cost_001"')
      expect(html).toContain('View demo research case')
      expect(html).toContain('href="/watchlist"')
      expect(html).toContain('Open watchlist drafts')
    })
  })
})
