import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { main } from '../index'

async function tmpProject(): Promise<{ dir: string; env: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-cli-status-'))
  await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n')
  // A clean env WITHOUT the VITEST/test-demo flags, so the CLI sees a production-shaped
  // "unconfigured" install rather than the test-only demo default.
  const env = {
    OWLFOLIO_PROJECT_DIR: dir,
    OWLFOLIO_APP_CONFIG_PATH: join(dir, 'app-config.json'),
    OWLFOLIO_ENV_FILE: join(dir, '.env'),
    OWLFOLIO_DISABLE_TEST_DEFAULTS: '1',
  }
  return { dir, env }
}

describe('owlfolio status', () => {
  it('reports an unconfigured fresh install and exits 0', async () => {
    const { dir, env } = await tmpProject()
    const lines: string[] = []
    const code = await main(['status'], { out: (line) => lines.push(line), cwd: dir, env })
    const text = lines.join('\n')

    expect(code).toBe(0)
    expect(text).toContain('Mode:')
    expect(text.toLowerCase()).toContain('unconfigured')
    // Steers an unconfigured user toward launching the app (onboarding is in the browser).
    expect(text).toContain('owlfolio start')
  })

  it('--help returns 0 and prints the trimmed command surface (start/status/doctor)', async () => {
    const lines: string[] = []
    const code = await main(['--help'], { out: (line) => lines.push(line) })
    const text = lines.join('\n')
    expect(code).toBe(0)
    expect(text).toContain('start')
    expect(text).toContain('status')
    expect(text).toContain('doctor')
    // The redundant onboarding commands were removed (they duplicated the browser onboarding).
    expect(text).not.toContain('Interactive onboarding wizard')
    expect(text).not.toContain('Connect or switch the LLM provider')
    expect(text).not.toContain('Re-pick the model')
  })

  it('unknown command returns non-zero', async () => {
    const lines: string[] = []
    const code = await main(['frobnicate'], { out: (line) => lines.push(line) })
    expect(code).toBe(1)
  })
})
