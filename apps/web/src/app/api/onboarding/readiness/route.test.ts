import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GET } from './route'

const originalAppConfigPath = process.env.OWLFOLIO_APP_CONFIG_PATH

describe('/api/onboarding/readiness', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-readiness-route-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
  })

  afterEach(async () => {
    if (originalAppConfigPath === undefined) {
      delete process.env.OWLFOLIO_APP_CONFIG_PATH
    } else {
      process.env.OWLFOLIO_APP_CONFIG_PATH = originalAppConfigPath
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('returns a clean 400 JSON error for unknown provider ids instead of throwing', async () => {
    const response = await GET(new Request('http://localhost/api/onboarding/readiness?provider=unknown-provider'))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'unknown_provider',
        message: 'Unknown provider: unknown-provider',
      },
    })
  })
})
