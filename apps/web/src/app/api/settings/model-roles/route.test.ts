import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST } from './route'

const original = {
  OWLFOLIO_ENV_FILE: process.env.OWLFOLIO_ENV_FILE,
}

describe('/api/settings/model-roles', () => {
  let tempDir: string
  let envPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-model-roles-route-'))
    envPath = join(tempDir, '.env')
    process.env.OWLFOLIO_ENV_FILE = envPath
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key as keyof typeof original]
      else process.env[key as keyof typeof original] = value
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  function form(fields: Record<string, string>): Request {
    return new Request('http://localhost/api/settings/model-roles', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  }

  it('SET writes OWLFOLIO_MODEL_ROLE_<ROLE>=provider:model@temp to the env file', async () => {
    const response = await POST(form({ action: 'set', role: 'red_team', provider: 'openai', model: 'gpt-x', temperature: '0.0' }))
    expect([200, 303]).toContain(response.status)
    const raw = await readFile(envPath, 'utf8')
    // The temperature is written as the canonical numeric form (0.0 → 0); the registry parser reads it
    // as temperature 0 either way.
    expect(raw).toContain('OWLFOLIO_MODEL_ROLE_RED_TEAM=openai:gpt-x@0')
  })

  it('SET omits the @temp suffix when no temperature is supplied', async () => {
    await POST(form({ action: 'set', role: 'synthesis', provider: 'openai', model: 'gpt-x' }))
    const raw = await readFile(envPath, 'utf8')
    expect(raw).toContain('OWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:gpt-x\n')
    expect(raw).not.toContain('@')
  })

  it('CLEAR removes the role entry and preserves other env entries', async () => {
    await writeFile(envPath, 'OPENAI_API_KEY=sk-keep\nOWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:gpt-x@0.1\n', 'utf8')
    await POST(form({ action: 'clear', role: 'synthesis' }))
    const raw = await readFile(envPath, 'utf8')
    expect(raw).toContain('OPENAI_API_KEY=sk-keep')
    expect(raw).not.toContain('OWLFOLIO_MODEL_ROLE_SYNTHESIS')
  })

  it('rejects an unknown role with a 400 and writes nothing', async () => {
    const response = await POST(form({ action: 'set', role: 'not_a_role', provider: 'openai', model: 'gpt-x' }))
    expect(response.status).toBe(400)
    await expect(readFile(envPath, 'utf8')).rejects.toThrow() // file never created
  })

  it('rejects a malformed override (provider with a delimiter) with a 400', async () => {
    const response = await POST(form({ action: 'set', role: 'red_team', provider: 'open:ai', model: 'gpt-x' }))
    expect(response.status).toBe(400)
  })

  it('rejects a missing provider/model on set with a 400', async () => {
    const response = await POST(form({ action: 'set', role: 'red_team', provider: '', model: '' }))
    expect(response.status).toBe(400)
  })
})
