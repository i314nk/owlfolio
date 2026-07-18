import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { closeRunLog, openRunLog, resolveRunLogDir } from '../runLogs'

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

describe('runLogs (capture layer — the in-app view was removed by owner decision 2026-07-18)', () => {
  it('resolves the env-overridden log dir', async () => {
    const dir = await tempLogDir()
    expect(resolveRunLogDir()).toBe(dir)
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
})
