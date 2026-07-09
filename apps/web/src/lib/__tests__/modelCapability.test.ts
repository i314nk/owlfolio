import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getModelCapabilityNote } from '../modelCapability'

const ORIGINAL = process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR

function report(over: Record<string, unknown>) {
  return {
    certification_report_id: 'cert_x',
    provider_id: 'openrouter',
    target: { provider_surface_id: 'openrouter', vendor_id: 'openrouter', runtime_kind: 'direct_api', auth_mode: 'api_key', model_id: 'z-ai/glm-5.2', workflow_role: 'research_draft', schema_version: 1 },
    run_status: 'completed',
    support_level: 'experimental',
    generated_at: '2026-07-08T00:00:00.000Z',
    capabilities: {},
    cases: [
      { scenario_id: 'simple-completion', title: 't', status: 'passed', passed: true, details: '' },
      { scenario_id: 'multi-step-tool-loop', title: 't', status: 'passed', passed: true, details: '' },
    ],
    summary: '2/2 scenarios passed',
    ...over,
  }
}

describe('getModelCapabilityNote', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'owlfolio-capnote-'))
    process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR = dir
    await mkdir(dir, { recursive: true })
  })
  afterEach(async () => {
    if (ORIGINAL === undefined) delete process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
    else process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR = ORIGINAL
    await rm(dir, { recursive: true, force: true })
  })

  it('all probe scenarios passed → capable, with the recorded summary + timestamp', async () => {
    await writeFile(join(dir, 'a.latest.json'), JSON.stringify(report({})), 'utf8')
    const note = await getModelCapabilityNote('openrouter', 'z-ai/glm-5.2')
    expect(note).toEqual({ state: 'capable', summary: '2/2 probe scenarios passed', verified_at: '2026-07-08T00:00:00.000Z' })
  })

  it('a failed scenario → failed with the honest count; a DIFFERENT model stays unverified', async () => {
    await writeFile(join(dir, 'a.latest.json'), JSON.stringify(report({
      cases: [
        { scenario_id: 'simple-completion', title: 't', status: 'passed', passed: true, details: '' },
        { scenario_id: 'multi-step-tool-loop', title: 't', status: 'failed', passed: false, details: 'declared unsupported' },
      ],
    })), 'utf8')
    const note = await getModelCapabilityNote('openrouter', 'z-ai/glm-5.2')
    expect(note.state).toBe('failed')
    if (note.state !== 'failed') throw new Error('expected failed')
    expect(note.summary).toBe('1/2 probe scenarios passed')
    expect(note.failure_reasons).toEqual(['multi-step-tool-loop: declared unsupported'])
    expect(await getModelCapabilityNote('openrouter', 'some/other-model')).toEqual({ state: 'unverified' })
  })

  it('no reports / missing model → unverified (fail-closed)', async () => {
    expect(await getModelCapabilityNote('openrouter', 'z-ai/glm-5.2')).toEqual({ state: 'unverified' })
    expect(await getModelCapabilityNote('openrouter', undefined)).toEqual({ state: 'unverified' })
  })
})
