import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { POST } from '../init/route'
import { getOnboardingState } from '../../../../lib/onboarding'

/**
 * Unit coverage for the programmatic-init route — the primary verification for this slice since e2e
 * cannot run here (port 3000 is the owner's live dev server). Proves:
 *  (a) outside test mode the route refuses (404, no init);
 *  (b) in test mode it initializes mock-provider + personal-local DIRECTLY, with NO demo-rewrite
 *      (mode stays personal-local, the ledger is the personal ledger and is empty — not the seeded
 *      demo ledger).
 */
describe('POST /api/testing/init — test-mode-gated programmatic onboarding init', () => {
  let projectDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-init-route-'))
    process.env.OWLFOLIO_PROJECT_DIR = projectDir
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    await rm(projectDir, { force: true, recursive: true })
  })

  function initRequest(body: unknown): Request {
    return new Request('http://127.0.0.1:3000/api/testing/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('refuses (404) and performs no init when OWLFOLIO_TEST_MODE is not playwright', async () => {
    delete process.env.OWLFOLIO_TEST_MODE

    const response = await POST(
      initRequest({
        mode: 'personal-local',
        provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      }),
    )

    expect(response.status).toBe(404)

    // No config was written — the app is still uninitialized.
    const state = await getOnboardingState()
    expect(state.is_initialized).toBe(false)
  })

  it('initializes mock-provider + personal-local DIRECTLY in test mode (no silent demo-rewrite)', async () => {
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    const response = await POST(
      initRequest({
        mode: 'personal-local',
        provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      }),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { config: { mode: string; ledger_path?: string; provider: { provider_id: string } }; initialized: boolean }

    // The "silent demo trap" rewrite (mock + personal-local → demo) is bypassed: mode stays personal-local.
    expect(payload.initialized).toBe(true)
    expect(payload.config.mode).toBe('personal-local')
    expect(payload.config.provider.provider_id).toBe('mock-provider')
    expect(payload.config.ledger_path).toContain('personal-ledger.sqlite')

    // The personal ledger is empty (NOT the seeded demo ledger) — proof we initialized personal-local,
    // not demo.
    const store = new SQLiteEventStore(payload.config.ledger_path!)
    try {
      expect(await store.list()).toEqual([])
    } finally {
      store.close()
    }

    const state = await getOnboardingState()
    expect(state.is_initialized).toBe(true)
    expect(state.config.mode).toBe('personal-local')
  })
})
