import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { curatedRealTierModelsForProvider } from '@owlfolio/providers'
import { qualificationReportFileStem } from '@owlfolio/workflow/modelQualification'

import { buildAutoModelRoleOverrides } from '../autoTierConfig'

// A qualification report fixture written next to the certification reports the helper reads. The gate is
// now PER-TARGET (provider+model), so we write a passing report for each of the provider's curated
// reasoning models at the target-specific stem (mirroring what the live qualify runner writes).
async function writeQualified(dir: string, providerId: string): Promise<void> {
  for (const model of curatedRealTierModelsForProvider(providerId)) {
    await writeFile(
      join(dir, `${qualificationReportFileStem({ provider_id: providerId, model_id: model.model_id })}.latest.json`),
      JSON.stringify({
        qualification_report_id: `qual_${providerId}_${model.model_id}_x`,
        provider_id: providerId,
        model_id: model.model_id,
        golden_set_version: 'gs-test',
        run_status: 'completed',
        generated_at: '2026-06-01T00:00:00.000Z',
        qualified: true,
        result: {},
        summary: 'qualified for test',
      }),
      'utf8',
    )
  }
}

describe('buildAutoModelRoleOverrides', () => {
  it('returns empty overrides when only ONE real reasoning provider is connected (single provider -> inherit)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'owl-autotier-'))
    await writeQualified(dir, 'openrouter')
    // Injected readiness: only claude is connected.
    const result = await buildAutoModelRoleOverrides({
      processEnv: {},
      qualificationDir: dir,
      getReadiness: async (providerId) => ({ is_ready: providerId === 'openrouter' }),
    })
    expect(result.overrides).toEqual({})
  })

  it('derives T1/T2/T3 overrides when two qualified reasoning providers are connected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'owl-autotier-'))
    await writeQualified(dir, 'openrouter')
    await writeQualified(dir, 'openai-api')

    const result = await buildAutoModelRoleOverrides({
      processEnv: {},
      qualificationDir: dir,
      getReadiness: async (providerId) => ({ is_ready: providerId === 'openrouter' || providerId === 'openai-api' }),
    })

    // A reasoning provider got pinned for synthesis (T1).
    expect(result.overrides.synthesis).toBeDefined()
    expect((result.overrides.synthesis?.provider_id ?? '').length).toBeGreaterThan(0)
    // T3 monitors got a (possibly cheaper) reasoning model too.
    expect(result.overrides.monitors).toBeDefined()
  })
})
