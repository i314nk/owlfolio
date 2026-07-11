import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { getOnboardingState } from '../onboarding'
import { getPassiveSleeveView, recordPassiveContribution } from '../workflow'

// ---------------------------------------------------------------------------------------------------
// B7 (book alignment) — the passive-sleeve web workflow. A contribution is a USER-AUTHORED, append-only
// record of an index purchase already made elsewhere (rules 1–2); there is deliberately no delete or
// withdraw counterpart anywhere in the sleeve (rule 3).
// ---------------------------------------------------------------------------------------------------

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

describe('recordPassiveContribution + getPassiveSleeveView (B7)', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-passive-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('appends ONE user-authored passive_contribution_recorded event and the view folds it', async () => {
    const state = await getOnboardingState()
    const { contribution_id } = await recordPassiveContribution(state, {
      amount: 500, contributed_at: '2026-07-01', instrument: 'S&P 500 index fund',
    })
    expect(contribution_id).toMatch(/^pc_/)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = (await store.list()).filter((e) => e.event_type === 'passive_contribution_recorded')
      expect(events).toHaveLength(1)
      expect(events[0]?.actor_type).toBe('user')
      expect(events[0]?.aggregate_type).toBe('passive_sleeve')
    } finally {
      store.close()
    }

    const view = await getPassiveSleeveView(state)
    expect(view.sleeve.total_contributed).toBe(500)
    expect(view.sleeve.months_contributed).toBe(1)
    expect(view.sleeve.last_contribution_at).toBe('2026-07-01')
    expect(view.active_value).toBe(0) // no open holdings seeded
  })

  it('months_contributed dedups within a month; totals accumulate append-only', async () => {
    const state = await getOnboardingState()
    await recordPassiveContribution(state, { amount: 500, contributed_at: '2026-06-01' })
    await recordPassiveContribution(state, { amount: 250, contributed_at: '2026-06-15' })
    await recordPassiveContribution(state, { amount: 500, contributed_at: '2026-07-01' })
    const view = await getPassiveSleeveView(state)
    expect(view.sleeve.total_contributed).toBe(1250)
    expect(view.sleeve.months_contributed).toBe(2)
    expect(view.sleeve.contributions).toHaveLength(3)
  })

  it('rejects a non-positive amount (never a silent zero record)', async () => {
    const state = await getOnboardingState()
    await expect(recordPassiveContribution(state, { amount: 0 })).rejects.toThrow(/positive/)
    await expect(recordPassiveContribution(state, { amount: -100 })).rejects.toThrow(/positive/)
  })
})
