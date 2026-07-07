import { describe, expect, it, vi } from 'vitest'
import { spawn as nodeSpawn } from 'node:child_process'
import { enqueueDiscoveryRun } from '../workflow'
import { defaultUnconfiguredAppConfig, defaultPersonalLocalAppConfig } from '@owlfolio/shared'

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: () => {} })) }))

const initState = { is_initialized: true, config: { ...defaultPersonalLocalAppConfig(), ledger_path: '/tmp/x.sqlite', source_ledger_path: '/tmp/src' } } as never

describe('enqueueDiscoveryRun', () => {
  it('the real spawn command defines defaults and targets discovery_13f', async () => {
    // No injected spawn → exercises defaultSpawnDiscoveryWorker's actual argv (mocked node spawn).
    vi.mocked(nodeSpawn).mockClear()
    await enqueueDiscoveryRun(initState)
    expect(nodeSpawn).toHaveBeenCalledTimes(1)
    const args = vi.mocked(nodeSpawn).mock.calls[0]![1] as string[]
    expect(args).toContain('--once')
    expect(args).toContain('--define-defaults')
    expect(args).toContain('discovery_13f')
  })
  it('spawns the discovery worker and returns started', async () => {
    const spawn = vi.fn()
    const res = await enqueueDiscoveryRun(initState, { spawn })
    expect(res).toEqual({ started: true })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toMatchObject({ ledgerPath: '/tmp/x.sqlite', sourceLedgerPath: '/tmp/src' })
  })
  it('throws when not personal-local initialized', async () => {
    const state = { is_initialized: false, config: defaultUnconfiguredAppConfig() } as never
    await expect(enqueueDiscoveryRun(state, { spawn: vi.fn() })).rejects.toThrow('Personal-local workflow is not initialized')
  })
})
