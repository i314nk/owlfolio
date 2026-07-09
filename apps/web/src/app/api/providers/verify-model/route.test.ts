import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { MockProvider, runProviderCertification } from '@owlfolio/providers'

import { CAPABILITY_PROBE_SCENARIOS, POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR: process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR,
}

describe('/api/providers/verify-model', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-verify-model-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR = join(tempDir, 'certs')
    await writeFile(process.env.OWLFOLIO_APP_CONFIG_PATH, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      ledger_path: join(tempDir, 'personal.sqlite'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key as keyof typeof originalEnv]
      else process.env[key as keyof typeof originalEnv] = value
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('runs the capability-core subset against the configured model and persists a target-specific report', async () => {
    const res = await POST(new Request('http://localhost/api/providers/verify-model', { method: 'POST' }), undefined, {
      certify: async (_pid, mid) => runProviderCertification(new MockProvider(), { model_id: mid, workflow_role: 'research_draft', scenarios: CAPABILITY_PROBE_SCENARIOS }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.model_id).toBe('mock-buffett-munger-demo')
    expect(body.scenarios.map((s: { scenario_id: string }) => s.scenario_id).sort()).toEqual([...CAPABILITY_PROBE_SCENARIOS].sort())
    // Persisted through the standard store the providers page reads.
    const files = await readdir(join(tempDir, 'certs'))
    expect(files.some((f) => f.endsWith('.latest.json'))).toBe(true)
    const report = JSON.parse(await readFile(join(tempDir, 'certs', files.find((f) => f.endsWith('.latest.json'))!), 'utf8'))
    expect(report.target.model_id).toBe('mock-buffett-munger-demo')
  })

  it('browser form posts get a 303 back to the providers page', async () => {
    const res = await POST(new Request('http://localhost/api/providers/verify-model', { method: 'POST', headers: { accept: 'text/html' } }), undefined, {
      certify: async (_pid, mid) => runProviderCertification(new MockProvider(), { model_id: mid, workflow_role: 'research_draft', scenarios: CAPABILITY_PROBE_SCENARIOS }),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/settings/providers')
  })
})
