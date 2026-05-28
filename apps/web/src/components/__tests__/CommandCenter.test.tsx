import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { CommandCenter } from '../CommandCenter'
import { getDemoCommandCenterFromStore, seedDemoLedger } from '../../lib/demo'

describe('CommandCenter', () => {
  it('renders demo workflow status and the next recommended action', async () => {
    const store = new SQLiteEventStore()
    try {
      await seedDemoLedger(store)
      const dashboard = await getDemoCommandCenterFromStore(store)
      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))

      expect(html).toContain('Owlfolio')
      expect(html).toContain('Setup ready')
      expect(html).toContain('Mock provider / demo mode')
      expect(html).toContain('Buffett-Munger certified')
      expect(html).toContain('SQLite durable event source')
      expect(html).toContain('Research cases')
      expect(html).toContain('Watchlist drafts')
      expect(html).toContain('Review COST research case and confirm the watchlist draft')
      expect(html).toContain('watchlist_draft_created by user:user_local')
    } finally {
      store.close()
    }
  })
})