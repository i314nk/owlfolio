import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MODEL_ROLE_ENV_PREFIX,
  modelRoleEnvKeyForRole,
  readModelRoleOverridesFromEnvFile,
  resolveModelRoleEnv,
} from '../modelRoleEnv'

// The implementation is tested exhaustively in packages/strategies/src/__tests__/modelRoleEnvFile.test.ts.
// This is a thin smoke test that the web re-export surface stays wired (file wins for role keys; secrets
// are never pulled out).
describe('apps/web modelRoleEnv re-export', () => {
  it('re-exports the role-key helpers', () => {
    expect(MODEL_ROLE_ENV_PREFIX).toBe('OWLFOLIO_MODEL_ROLE_')
    expect(modelRoleEnvKeyForRole('red_team')).toBe('OWLFOLIO_MODEL_ROLE_RED_TEAM')
  })

  it('reads only role overrides from the env file and lets the file win over process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'owlfolio-web-modelroleenv-'))
    try {
      const envPath = join(dir, '.env')
      await writeFile(envPath, 'OPENAI_API_KEY=sk-secret\nOWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:file@0.0\n', 'utf8')
      const overrides = await readModelRoleOverridesFromEnvFile({ envPath })
      expect(overrides).toEqual({ OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:file@0.0' })

      const env = await resolveModelRoleEnv({
        envPath,
        processEnv: { OWLFOLIO_MODEL_ROLE_SYNTHESIS: 'openai:process@0.3', OPENAI_API_KEY: 'sk-keep' },
      })
      expect(env.OWLFOLIO_MODEL_ROLE_SYNTHESIS).toBe('openai:file@0.0')
      expect(env.OPENAI_API_KEY).toBe('sk-keep')
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
