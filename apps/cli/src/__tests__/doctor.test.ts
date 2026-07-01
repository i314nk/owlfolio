import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initializeSelectedMode } from '@owlfolio/onboarding/onboarding'

import { main } from '../index'

async function tmpProject(): Promise<{ dir: string; env: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-cli-doctor-'))
  await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n')
  const env: Record<string, string> = {
    OWLFOLIO_PROJECT_DIR: dir,
    OWLFOLIO_APP_CONFIG_PATH: join(dir, 'app-config.json'),
    OWLFOLIO_ENV_FILE: join(dir, 'owlfolio.env'),
    OWLFOLIO_PERSONAL_LEDGER_PATH: join(dir, 'personal-ledger.sqlite'),
    OWLFOLIO_SOURCE_LEDGER_PATH: join(dir, 'source-ledger'),
    OWLFOLIO_DISABLE_TEST_DEFAULTS: '1',
  }
  return { dir, env }
}

describe('owlfolio doctor', () => {
  it('FAILs (exit 1) on an unconfigured install', async () => {
    const { dir, env } = await tmpProject()
    const out: string[] = []
    const code = await main(['doctor'], { out: (l) => out.push(l), cwd: dir, env })
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('[FAIL]')
  })

  it('passes (exit 0, no FAIL) once personal-local mode is initialized', async () => {
    const { dir, env } = await tmpProject()
    // Establish a configured, initialized install directly (onboarding now lives in the browser, not the
    // CLI): a personal-local ledger + a selected provider is enough for doctor to have no FAIL.
    await initializeSelectedMode(
      { mode: 'personal-local', provider: { provider_id: 'openrouter', support_level: 'experimental' } },
      { cwd: dir, env },
    )

    const out: string[] = []
    const code = await main(['doctor'], { out: (l) => out.push(l), cwd: dir, env })
    const text = out.join('\n')
    expect(code).toBe(0)
    expect(text).toContain('[PASS]')
    expect(text).not.toContain('[FAIL]')
  })
})
