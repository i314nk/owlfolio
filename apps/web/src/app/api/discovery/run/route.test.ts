import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { POST } from './route'

let tempDir: string
const originalEnv = { ...process.env }
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-discovery-run-'))
  const appConfigPath = join(tempDir, 'app-config.json')
  process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
  process.env.OWLFOLIO_PROJECT_DIR = tempDir
  await writeFile(appConfigPath, JSON.stringify({ ...defaultPersonalLocalAppConfig(), ledger_path: join(tempDir, 'personal.sqlite'), source_ledger_path: join(tempDir, 'src'), initialized_at: '2026-01-01T00:00:00.000Z' }), 'utf8')
})
afterEach(async () => { process.env = { ...originalEnv }; await rm(tempDir, { force: true, recursive: true }) })

describe('POST /api/discovery/run', () => {
  it('spawns discovery and returns 202', async () => {
    const spawn = vi.fn()
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), { spawn } as never)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ started: true })
    expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('returns 409 when unconfigured', async () => {
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'missing.json')
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), { spawn: vi.fn() } as never)
    expect(res.status).toBe(409)
  })
})
