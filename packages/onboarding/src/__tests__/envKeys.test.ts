import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  hydrateProcessEnvFromEnvKeys,
  isEnvKeyPathGitIgnored,
  listEnvKeyStatuses,
  maskSecretTail,
  readEnvKeyValue,
  removeEnvKey,
  resolveEnvKeyFilePath,
  setEnvKey,
} from '../envKeys'

const SECRET = 'sk-ant-supersecret-value-K3jQAA'

async function withTempEnvFile(assertion: (envPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-envkeys-'))
  try {
    await assertion(join(dir, '.env'))
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('hydrateProcessEnvFromEnvKeys', () => {
  it('loads an env-file key into the target env when it is not already set', async () => {
    await withTempEnvFile(async (envPath) => {
      await setEnvKey('OPENROUTER_API_KEY', SECRET, { envPath })
      const target: Record<string, string | undefined> = {}
      const hydrated = await hydrateProcessEnvFromEnvKeys({ envPath }, target)
      expect(target.OPENROUTER_API_KEY).toBe(SECRET)
      expect(hydrated).toContain('OPENROUTER_API_KEY')
    })
  })

  it('never overwrites an already-set shell/exported value (exports win)', async () => {
    await withTempEnvFile(async (envPath) => {
      await setEnvKey('OPENROUTER_API_KEY', 'file-value', { envPath })
      const target: Record<string, string | undefined> = { OPENROUTER_API_KEY: 'shell-value' }
      const hydrated = await hydrateProcessEnvFromEnvKeys({ envPath }, target)
      expect(target.OPENROUTER_API_KEY).toBe('shell-value')
      expect(hydrated).not.toContain('OPENROUTER_API_KEY')
    })
  })

  it('treats an empty existing value as unset and hydrates over it', async () => {
    await withTempEnvFile(async (envPath) => {
      await setEnvKey('OPENROUTER_API_KEY', SECRET, { envPath })
      const target: Record<string, string | undefined> = { OPENROUTER_API_KEY: '' }
      await hydrateProcessEnvFromEnvKeys({ envPath }, target)
      expect(target.OPENROUTER_API_KEY).toBe(SECRET)
    })
  })

  it('returns an empty list and mutates nothing when the env file is missing', async () => {
    await withTempEnvFile(async (envPath) => {
      const target: Record<string, string | undefined> = {}
      const hydrated = await hydrateProcessEnvFromEnvKeys({ envPath }, target)
      expect(hydrated).toEqual([])
      expect(Object.keys(target)).toEqual([])
    })
  })
})

describe('maskSecretTail', () => {
  it('returns only a short tail and never the full secret', () => {
    const tail = maskSecretTail(SECRET)
    expect(SECRET.endsWith(tail.replace(/^…/, ''))).toBe(true)
    expect(tail.length).toBeLessThan(SECRET.length)
    expect(tail).not.toContain('supersecret')
  })

  it('fully masks very short secrets', () => {
    expect(maskSecretTail('abc')).not.toContain('abc')
  })
})

describe('resolveEnvKeyFilePath', () => {
  it('defaults to ~/.owlfolio/.env outside the repo', () => {
    const path = resolveEnvKeyFilePath({ env: {}, homedir: '/home/test' })
    expect(path).toBe('/home/test/.owlfolio/.env')
  })

  it('honors an OWLFOLIO_ENV_FILE override', () => {
    const path = resolveEnvKeyFilePath({ env: { OWLFOLIO_ENV_FILE: '/custom/keys.env' }, homedir: '/home/test' })
    expect(path).toBe('/custom/keys.env')
  })
})

describe('setEnvKey + listEnvKeyStatuses', () => {
  it('writes the secret to the env file and reports it as set with only a masked tail', async () => {
    await withTempEnvFile(async (envPath) => {
      await setEnvKey('ANTHROPIC_API_KEY', SECRET, { envPath })

      const statuses = await listEnvKeyStatuses(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], { envPath })
      const anthropic = statuses.find((status) => status.name === 'ANTHROPIC_API_KEY')
      const openai = statuses.find((status) => status.name === 'OPENAI_API_KEY')

      expect(anthropic?.is_set).toBe(true)
      expect(openai?.is_set).toBe(false)

      // The status object must NEVER carry the raw value — only a masked tail.
      const serialized = JSON.stringify(statuses)
      expect(serialized).not.toContain(SECRET)
      expect(serialized).not.toContain('supersecret')
      expect(anthropic?.tail).toBeDefined()
    })
  })

  it('updates an existing key in place rather than duplicating it', async () => {
    await withTempEnvFile(async (envPath) => {
      await setEnvKey('OPENAI_API_KEY', 'first-value-AAAA', { envPath })
      await setEnvKey('OPENAI_API_KEY', 'second-value-BBBB', { envPath })

      const raw = await readFile(envPath, 'utf8')
      const occurrences = raw.split('\n').filter((line) => line.startsWith('OPENAI_API_KEY=')).length
      expect(occurrences).toBe(1)
      expect(await readEnvKeyValue('OPENAI_API_KEY', { envPath })).toBe('second-value-BBBB')
    })
  })

  it('rejects unsafe key names', async () => {
    await withTempEnvFile(async (envPath) => {
      await expect(setEnvKey('BAD NAME', 'x', { envPath })).rejects.toThrow()
      await expect(setEnvKey('lower_case_bad', 'x', { envPath })).rejects.toThrow()
    })
  })

  it('preserves other keys and never logs the value through the file format', async () => {
    await withTempEnvFile(async (envPath) => {
      await writeFile(envPath, 'EXISTING_KEY=keepme\n', 'utf8')
      await setEnvKey('GEMINI_API_KEY', SECRET, { envPath })
      const raw = await readFile(envPath, 'utf8')
      expect(raw).toContain('EXISTING_KEY=keepme')
      expect(raw).toContain('GEMINI_API_KEY=')
    })
  })
})

describe('removeEnvKey', () => {
  it('removes the named key and preserves the others', async () => {
    await withTempEnvFile(async (envPath) => {
      await writeFile(envPath, 'KEEP_ME=stay\nOWLFOLIO_MODEL_ROLE_SYNTHESIS=openai:m@0.1\n', 'utf8')
      await removeEnvKey('OWLFOLIO_MODEL_ROLE_SYNTHESIS', { envPath })
      const raw = await readFile(envPath, 'utf8')
      expect(raw).toContain('KEEP_ME=stay')
      expect(raw).not.toContain('OWLFOLIO_MODEL_ROLE_SYNTHESIS')
      expect(await readEnvKeyValue('OWLFOLIO_MODEL_ROLE_SYNTHESIS', { envPath })).toBeUndefined()
    })
  })

  it('is a no-op when the key or file is absent, and rejects unsafe names', async () => {
    await withTempEnvFile(async (envPath) => {
      await expect(removeEnvKey('OWLFOLIO_MODEL_ROLE_SYNTHESIS', { envPath })).resolves.toBeUndefined()
      await expect(removeEnvKey('bad name', { envPath })).rejects.toThrow()
    })
  })
})

describe('isEnvKeyPathGitIgnored', () => {
  it('treats a path outside the repo as not committable', () => {
    expect(isEnvKeyPathGitIgnored('/home/test/.owlfolio/.env', '/repo')).toBe(true)
  })

  it('treats a .env inside the repo as git-ignored (matched by .gitignore)', () => {
    expect(isEnvKeyPathGitIgnored('/repo/.env', '/repo')).toBe(true)
  })

  it('flags a non-ignored in-repo path', () => {
    expect(isEnvKeyPathGitIgnored('/repo/config/keys.txt', '/repo')).toBe(false)
  })

  it('treats any path safe when the project dir is not a git working tree (e.g. a local sandbox)', () => {
    // The same in-repo-looking path that is flagged when repoIsGitWorkTree=true is safe when the project
    // dir is not a git repo — nothing under it can ever be committed.
    expect(isEnvKeyPathGitIgnored('/sandbox/owlfolio.env', '/sandbox', false)).toBe(true)
    expect(isEnvKeyPathGitIgnored('/repo/config/keys.txt', '/repo', false)).toBe(true)
  })
})
