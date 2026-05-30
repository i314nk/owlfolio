import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import * as commandCenterProjection from '@owlfolio/ledger/projections/commandCenterProjection'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { CommandCenter } from '../CommandCenter'
import { ResearchCasePanel } from '../ResearchCasePanel'
import {
  getDemoCommandCenterFromStore,
  getDemoResearchCaseFromStore,
  resolveDemoLedgerPath,
  seedDemoLedger,
} from '../../lib/demo'

async function withSeededStore<T>(fn: (store: SQLiteEventStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-demo-ledger-'))
  let store: SQLiteEventStore | undefined
  try {
    store = new SQLiteEventStore(join(dir, 'demo.sqlite'))
    await seedDemoLedger(store)
    await seedDemoLedger(store)
    return await fn(store)
  } finally {
    store?.close()
    await rm(dir, { recursive: true, force: true })
  }
}

describe('durable demo ledger read models', () => {
  it('defaults the demo SQLite ledger to the workspace data directory even when cwd is apps/web', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owlfolio-workspace-'))
    try {
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')

      expect(resolveDemoLedgerPath({ cwd: join(root, 'apps', 'web'), env: {} })).toBe(join(root, 'data', 'demo-ledger.sqlite'))
      expect(resolveDemoLedgerPath({ cwd: join(root, 'apps', 'web'), env: { OWLFOLIO_DEMO_LEDGER_PATH: '/tmp/custom.sqlite' } })).toBe('/tmp/custom.sqlite')
      expect(resolveDemoLedgerPath({ cwd: '/tmp/elsewhere', env: { OWLFOLIO_PROJECT_DIR: root } })).toBe(join(root, 'data', 'demo-ledger.sqlite'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('seeds demo events into a durable idempotent ledger and reads command-center projection summaries', async () => {
    const summarySpy = vi.spyOn(commandCenterProjection, 'projectCommandCenterSummary')

    await withSeededStore(async (store) => {
      const events = await store.list()
      const dashboard = await getDemoCommandCenterFromStore(store)

      expect(events).toHaveLength(4)
      expect(events.every((event) => event.idempotency_key !== undefined)).toBe(true)
      expect(dashboard.ledger_status).toBe('Ledger: SQLite durable event source')
      expect(dashboard.pipeline_counts).toMatchObject({
        research_cases: 1,
        watchlist_drafts: 1,
        pending_user_actions: 1,
      })
      expect(dashboard.recent_activity).toEqual([
        { event_id: 'evt_demo_watchlist_001', label: 'watchlist_draft_created by user:user_local' },
        { event_id: 'evt_demo_decision_001', label: 'decision_drafted by system' },
        { event_id: 'evt_demo_analysis_001', label: 'buffett_munger_analysis_drafted by provider:mock-provider' },
      ])
      expect(dashboard.primary_action).toEqual({
        href: '/research/rc_cost_001',
        label: 'View demo research case',
      })
      expect(summarySpy).toHaveBeenCalledTimes(1)

      const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard }))
      expect(html).toContain('Ledger: SQLite durable event source')
      expect(html).toContain('watchlist_draft_created by user:user_local')
    })
  })

  it('renders an inline research-case ledger timeline from the same durable event stream', async () => {
    await withSeededStore(async (store) => {
      const researchCase = await getDemoResearchCaseFromStore(store, 'rc_cost_001')

      expect(researchCase.ledger_timeline.map((entry) => entry.event_type)).toEqual([
        'research_case_created',
        'buffett_munger_analysis_drafted',
        'decision_drafted',
        'watchlist_draft_created',
      ])
      expect(researchCase.ledger_timeline[1]).toMatchObject({
        actor_label: 'provider:mock-provider',
        summary: 'WATCH / CONDITIONAL / Shariah COMPLIANT',
      })

      const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase }))
      expect(html).toContain('Ledger Timeline')
      expect(html).toContain('How did this state come to exist?')
      expect(html).toContain('provider:mock-provider')
      expect(html).toContain('WATCH / CONDITIONAL / Shariah COMPLIANT')
      expect(html).toContain('user:user_local')
    })
  })
})
