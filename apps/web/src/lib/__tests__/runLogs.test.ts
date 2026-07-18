import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { readFile } from 'node:fs/promises'

import { closeRunLog, latestRunLogTail, openRunLog, resolveRunLogDir, runLogTailsForWindow } from '../runLogs'

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
  delete process.env['OWLFOLIO_RUN_LOG_DIR']
})

async function tempLogDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-run-logs-'))
  dirs.push(dir)
  process.env['OWLFOLIO_RUN_LOG_DIR'] = dir
  return dir
}

describe('runLogs', () => {
  it('resolves the env-overridden log dir', async () => {
    const dir = await tempLogDir()
    expect(resolveRunLogDir()).toBe(dir)
  })

  it('returns the newest log tail with the file name', async () => {
    const dir = await tempLogDir()
    await writeFile(join(dir, 'process_research_queue-old.log'), 'old worker output\n')
    await utimes(join(dir, 'process_research_queue-old.log'), new Date('2026-07-01'), new Date('2026-07-01'))
    await writeFile(join(dir, 'process_deep_dive_queue-new.log'), 'lane moat started\nlane moat finished\n')

    const tail = await latestRunLogTail()
    expect(tail?.file).toBe('process_deep_dive_queue-new.log')
    expect(tail?.tail).toContain('lane moat finished')
    expect(tail?.tail).not.toContain('old worker output')
  })

  it('redacts secret-shaped values from the tail (no secrets in logs → no secrets in the browser)', async () => {
    const dir = await tempLogDir()
    await writeFile(join(dir, 'process_research_queue-x.log'), 'calling OpenRouter with sk-or-v1-abcdef1234567890abcdef key\nOPENROUTER_API_KEY=sk-or-v1-zzzzyyyyxxxxwwww\nplain line\n')

    const tail = await latestRunLogTail()
    expect(tail?.tail).not.toContain('sk-or-v1-abcdef1234567890abcdef')
    expect(tail?.tail).not.toContain('sk-or-v1-zzzzyyyyxxxxwwww')
    expect(tail?.tail).toContain('[redacted]')
    expect(tail?.tail).toContain('plain line')
  })

  it('returns undefined when no logs exist yet', async () => {
    await tempLogDir()
    expect(await latestRunLogTail()).toBeUndefined()
  })

  it('refuses to write under vitest without an explicit dir override (tests must never pollute the real data/run-logs)', () => {
    delete process.env['OWLFOLIO_RUN_LOG_DIR']
    expect(openRunLog('process_research_queue')).toBeUndefined()
  })

  it('stamps a spawn header the moment the log opens — a spawn attempt can never leave a 0-byte mystery', async () => {
    await tempLogDir()
    const log = openRunLog('process_research_queue')
    expect(log).toBeDefined()
    closeRunLog(log!.fd)
    const content = await readFile(log!.path, 'utf8')
    expect(content).toContain('[owlfolio] process_research_queue spawn requested at ')
  })

  it('matches a log to a run via task-kind + since filters (undefined when nothing matches — caller falls back)', async () => {
    const dir = await tempLogDir()
    await writeFile(join(dir, 'discovery_13f-newest.log'), 'harvest output\n')
    await writeFile(join(dir, 'process_deep_dive_queue-run.log'), 'deep dive lane output\n')
    await utimes(join(dir, 'process_deep_dive_queue-run.log'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))

    // The deep-dive log matches the run's task kinds even though the harvest log is newer overall.
    const matched = await latestRunLogTail(undefined, { taskKinds: ['process_research_queue', 'process_deep_dive_queue'] })
    expect(matched?.file).toBe('process_deep_dive_queue-run.log')

    // A since-filter after the deep-dive log's mtime excludes it.
    const excluded = await latestRunLogTail(undefined, { sinceMs: Date.now() - 30_000, taskKinds: ['process_deep_dive_queue'] })
    expect(excluded).toBeUndefined()
  })

  it('collects every log in a run window, newest first, and excludes files outside it', async () => {
    const dir = await tempLogDir()
    const now = Date.now()
    await writeFile(join(dir, 'process_research_queue-a.log'), 'front gates output\n')
    await utimes(join(dir, 'process_research_queue-a.log'), new Date(now - 120_000), new Date(now - 120_000))
    await writeFile(join(dir, 'process_deep_dive_queue-b.log'), 'deep dive output\n')
    await utimes(join(dir, 'process_deep_dive_queue-b.log'), new Date(now - 60_000), new Date(now - 60_000))
    await writeFile(join(dir, 'process_research_queue-old.log'), 'a prior run\n')
    await utimes(join(dir, 'process_research_queue-old.log'), new Date(now - 3_600_000), new Date(now - 3_600_000))
    await writeFile(join(dir, 'discovery_13f-c.log'), 'harvest — wrong kind\n')

    const logs = await runLogTailsForWindow({
      sinceMs: now - 180_000,
      untilMs: now,
      taskKinds: ['process_research_queue', 'process_deep_dive_queue'],
    })
    expect(logs.map((l) => l.file)).toEqual(['process_deep_dive_queue-b.log', 'process_research_queue-a.log'])
    expect(logs[0]?.tail).toContain('deep dive output')
  })

  it('bounds the tail to the requested byte budget (tail, not the whole file)', async () => {
    const dir = await tempLogDir()
    const big = `${'x'.repeat(10_000)}\nTHE-END\n`
    await writeFile(join(dir, 'process_research_queue-big.log'), big)

    const tail = await latestRunLogTail(2_000)
    expect(tail?.tail.length).toBeLessThanOrEqual(2_100)
    expect(tail?.tail).toContain('THE-END')
  })
})
