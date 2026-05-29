import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getProviderOptions, getProviderReadiness } from '../providerReadiness'

describe('providerReadiness', () => {
  async function withTempDir(assertion: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-readiness-'))
    try {
      await assertion(dir)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  }

  it('reports the mock provider as ready and certified in demo mode', async () => {
    const readiness = await getProviderReadiness('mock-provider', {})

    expect(readiness).toMatchObject({
      provider_id: 'mock-provider',
      is_ready: true,
      support_level: 'certified',
      auth_source: 'built-in demo mode',
    })
    expect(readiness.status_label).toMatch(/ready/i)
  })

  it('reports claude as ready when an api key is configured', async () => {
    const readiness = await getProviderReadiness('claude', { ANTHROPIC_API_KEY: 'test-key' })

    expect(readiness).toMatchObject({
      provider_id: 'claude',
      is_ready: true,
      support_level: 'certified',
      auth_source: 'ANTHROPIC_API_KEY',
    })
  })

  it('reports claude as ready when subscription credentials exist', async () => {
    await withTempDir(async (dir) => {
      const credentialsPath = join(dir, '.claude', '.credentials.json')
      await mkdir(join(dir, '.claude'), { recursive: true })
      await writeFile(credentialsPath, '{"subscription":true}', 'utf8')

      const readiness = await getProviderReadiness('claude', { OWLFOLIO_CLAUDE_CREDENTIALS_PATH: credentialsPath })

      expect(readiness).toMatchObject({
        provider_id: 'claude',
        is_ready: true,
        auth_source: 'Claude subscription credentials',
      })
    })
  })

  it('reports openai as ready when an api key is configured', async () => {
    const readiness = await getProviderReadiness('openai', { OPENAI_API_KEY: 'test-key' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'OPENAI_API_KEY',
    })
    expect(readiness.status_label).toMatch(/api key/i)
  })

  it('reports openai as ready when a Codex access token is configured', async () => {
    const readiness = await getProviderReadiness('openai', { CODEX_ACCESS_TOKEN: 'test-access-token' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'CODEX_ACCESS_TOKEN',
    })
    expect(readiness.status_label).toMatch(/access token/i)
  })

  it('reports openai as ready when Codex OAuth credentials exist', async () => {
    await withTempDir(async (dir) => {
      const authPath = join(dir, '.codex', 'auth.json')
      await mkdir(join(dir, '.codex'), { recursive: true })
      await writeFile(authPath, '{"access_token":"oauth-token"}', 'utf8')

      const readiness = await getProviderReadiness('openai', { OWLFOLIO_CODEX_AUTH_PATH: authPath })

      expect(readiness).toMatchObject({
        provider_id: 'openai',
        is_ready: true,
        support_level: 'experimental',
        auth_source: 'Codex OAuth credentials',
      })
      expect(readiness.status_label).toMatch(/oauth/i)
    })
  })

  it('reports openai as experimental and not ready without api key, access token, or oauth credentials', async () => {
    const readiness = await getProviderReadiness('openai', { OWLFOLIO_CODEX_AUTH_PATH: '/definitely/missing/auth.json' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: false,
      support_level: 'experimental',
      auth_source: 'missing',
    })
    expect(readiness.status_label).toMatch(/missing/i)
  })

  it('lists provider options in onboarding order with frozen support semantics', () => {
    const options = getProviderOptions()

    expect(options.map((provider) => provider.provider_id)).toEqual(['mock-provider', 'claude', 'openai'])
    expect(options.map((provider) => provider.support_level)).toEqual(['certified', 'certified', 'experimental'])
  })
})
