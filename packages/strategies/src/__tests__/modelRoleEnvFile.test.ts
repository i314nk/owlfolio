import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MODEL_ROLE_ENV_PREFIX,
  isKnownModelRoleEnvKey,
  isModelRoleEnvKey,
  modelRoleEnvKeyForRole,
  readModelRoleOverridesFromEnvFile,
  resolveModelRoleEnv,
  resolveModelRoleEnvFilePath,
} from '../modelRoleEnvFile'

async function withTempEnvFile(assertion: (envPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-modelroleenvfile-'))
  try {
    await assertion(join(dir, '.env'))
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('modelRoleEnvKeyForRole / isModelRoleEnvKey / isKnownModelRoleEnvKey', () => {
  it('maps a role id to its OWLFOLIO_MODEL_ROLE_<ROLE> env key', () => {
    expect(modelRoleEnvKeyForRole('synthesis')).toBe('OWLFOLIO_MODEL_ROLE_SYNTHESIS')
    expect(modelRoleEnvKeyForRole('lane_moat')).toBe('OWLFOLIO_MODEL_ROLE_LANE_MOAT')
    expect(MODEL_ROLE_ENV_PREFIX).toBe('OWLFOLIO_MODEL_ROLE_')
  })

  it('recognizes a model-role env key by prefix and by known-role membership', () => {
    expect(isModelRoleEnvKey('OWLFOLIO_MODEL_ROLE_RED_TEAM')).toBe(true)
    expect(isModelRoleEnvKey('OPENAI_API_KEY')).toBe(false)
    expect(isModelRoleEnvKey('OWLFOLIO_MODEL_ROLE_')).toBe(false)
    expect(isKnownModelRoleEnvKey('OWLFOLIO_MODEL_ROLE_RED_TEAM')).toBe(true)
    expect(isKnownModelRoleEnvKey('OWLFOLIO_MODEL_ROLE_NOT_A_ROLE')).toBe(false)
  })
})

describe('resolveModelRoleEnvFilePath', () => {
  it('honors an explicit envPath, then OWLFOLIO_ENV_FILE, then ~/.owlfolio/.env', () => {
    expect(resolveModelRoleEnvFilePath({ envPath: '/explicit/.env' })).toBe('/explicit/.env')
    expect(resolveModelRoleEnvFilePath({ env: { OWLFOLIO_ENV_FILE: '/custom/keys.env' }, homedir: '/home/test' }))
      .toBe('/custom/keys.env')
    expect(resolveModelRoleEnvFilePath({ env: {}, homedir: '/home/test' })).toBe('/home/test/.owlfolio/.env')
  })
})

describe('readModelRoleOverridesFromEnvFile', () => {
  it('returns only OWLFOLIO_MODEL_ROLE_* entries (never other secrets)', async () => {
    await withTempEnvFile(async (envPath) => {
      await writeFile(
        envPath,
        [
          'OPENAI_API_KEY=sk-supersecret-DO-NOT-LEAK',
          'OWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:gpt-x@0.1',
          'OWLFOLIO_MODEL_ROLE_RED_TEAM=gemini:flash',
          '# a comment',
          '',
        ].join('\n'),
        'utf8',
      )
      const overrides = await readModelRoleOverridesFromEnvFile({ envPath })
      expect(overrides).toEqual({
        OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:gpt-x@0.1',
        OWLFOLIO_MODEL_ROLE_RED_TEAM: 'gemini:flash',
      })
      expect(JSON.stringify(overrides)).not.toContain('supersecret')
      expect(Object.keys(overrides)).not.toContain('OPENAI_API_KEY')
    })
  })

  it('returns an empty map (fail-closed) when the file is unreadable/absent', async () => {
    expect(await readModelRoleOverridesFromEnvFile({ envPath: '/no/such/owlfolio/.env' })).toEqual({})
  })
})

describe('resolveModelRoleEnv', () => {
  it('lets the FILE override win over process.env for MODEL_ROLE keys', async () => {
    await withTempEnvFile(async (envPath) => {
      await writeFile(envPath, 'OWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:file-model@0.0\n', 'utf8')
      const env = await resolveModelRoleEnv({
        envPath,
        processEnv: { OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:process-model@0.3', OPENAI_API_KEY: 'sk-keep' },
      })
      expect(env.OWLFOLIO_MODEL_ROLE_SYNTHESIS).toBe('openai:file-model@0.0')
      expect(env.OPENAI_API_KEY).toBe('sk-keep')
    })
  })

  it('falls back to process.env for role keys absent from the file', async () => {
    await withTempEnvFile(async (envPath) => {
      await writeFile(envPath, 'OWLFOLIO_MODEL_ROLE_RED_TEAM=gemini:flash\n', 'utf8')
      const env = await resolveModelRoleEnv({
        envPath,
        processEnv: { OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:from-process@0.1' },
      })
      expect(env.OWLFOLIO_MODEL_ROLE_SYNTHESIS).toBe('openai:from-process@0.1')
      expect(env.OWLFOLIO_MODEL_ROLE_RED_TEAM).toBe('gemini:flash')
    })
  })

  it('fails closed to process.env only when the file is unreadable', async () => {
    const env = await resolveModelRoleEnv({
      envPath: '/no/such/owlfolio/.env',
      processEnv: { OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:from-process@0.1', OPENAI_API_KEY: 'sk-keep' },
    })
    expect(env.OWLFOLIO_MODEL_ROLE_SYNTHESIS).toBe('openai:from-process@0.1')
    expect(env.OPENAI_API_KEY).toBe('sk-keep')
  })
})
