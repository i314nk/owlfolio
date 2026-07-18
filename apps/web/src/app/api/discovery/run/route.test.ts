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
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), undefined, { spawn } as never)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ started: true })
    expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('returns 409 when unconfigured', async () => {
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'missing.json')
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), undefined, { spawn: vi.fn() } as never)
    expect(res.status).toBe(409)
  })

  it('does not spawn a second worker while a discovery run is already RUNNING (recent start)', async () => {
    const { SQLiteEventStore } = await import('@owlfolio/ledger/sqliteEventStore')
    const store = new SQLiteEventStore(join(tempDir, 'personal.sqlite'))
    try {
      await store.append({
        event_id: 'evt_disc_started_1',
        event_type: 'scheduled_task_run_started',
        aggregate_type: 'scheduled_task',
        aggregate_id: 'task_discovery_13f',
        actor_type: 'worker',
        actor_id: 'worker_local',
        payload: { task_id: 'task_discovery_13f', task_kind: 'discovery_13f', run_id: 'run_live', started_at: new Date().toISOString() },
        source_ids: [],
        created_at: new Date().toISOString(),
        schema_version: 1,
      } as never)
    } finally {
      store.close()
    }

    const spawn = vi.fn()
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), undefined, { spawn } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ started: false, already_running: true })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('still spawns when the last RUNNING mark is stale (a dead worker must not wedge discovery)', async () => {
    const { SQLiteEventStore } = await import('@owlfolio/ledger/sqliteEventStore')
    const store = new SQLiteEventStore(join(tempDir, 'personal.sqlite'))
    try {
      await store.append({
        event_id: 'evt_disc_started_stale',
        event_type: 'scheduled_task_run_started',
        aggregate_type: 'scheduled_task',
        aggregate_id: 'task_discovery_13f',
        actor_type: 'worker',
        actor_id: 'worker_local',
        payload: { task_id: 'task_discovery_13f', task_kind: 'discovery_13f', run_id: 'run_stale', started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        source_ids: [],
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        schema_version: 1,
      } as never)
    } finally {
      store.close()
    }

    const spawn = vi.fn()
    const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), undefined, { spawn } as never)
    expect(res.status).toBe(202)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
