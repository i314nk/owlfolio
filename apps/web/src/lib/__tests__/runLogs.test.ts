import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { latestRunLogTail, resolveRunLogDir } from '../runLogs'

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

  it('bounds the tail to the requested byte budget (tail, not the whole file)', async () => {
    const dir = await tempLogDir()
    const big = `${'x'.repeat(10_000)}\nTHE-END\n`
    await writeFile(join(dir, 'process_research_queue-big.log'), big)

    const tail = await latestRunLogTail(2_000)
    expect(tail?.tail.length).toBeLessThanOrEqual(2_100)
    expect(tail?.tail).toContain('THE-END')
  })
})
