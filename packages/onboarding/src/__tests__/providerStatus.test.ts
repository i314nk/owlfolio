import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  certificationScenarioIds,
  createNotConfiguredCertificationReport,
  MockProvider,
  runProviderCertification,
  type CertificationReport,
} from '@owlfolio/providers'
import { describe, expect, it } from 'vitest'

import { buildProviderStatusRows, getLatestProviderCertificationReports } from '../providerStatus'

// Deterministic stand-in for the harness HTTP-fetch+sha256 grounder, mirroring how the real
// certify script grounds the mock provider's proposed sources for the source-grounded scenario.
const deterministicGrounder = async (
  sources: { source_id: string; title: string; url: string; excerpt: string; citation_locator?: string }[],
) => ({
  verified_ids: sources.map((s) => s.source_id),
  captured: sources.map((s) => ({ source_id: s.source_id, availability: 'available' as const, content_hash: `sha256:mock-${s.source_id}` })),
})

describe('provider status model', () => {
  it('shows the mock provider as certified only because its latest persisted certification report is certified', async () => {
    const projectDir = await writeReportFixture(await runProviderCertification(new MockProvider(), {
      generated_at: '2026-06-01T00:00:00.000Z',
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
      ground_sources: deterministicGrounder,
    }))

    const rows = await buildProviderStatusRows({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
    const mockProvider = rows.find((row) => row.provider_id === 'mock-provider')

    expect(mockProvider).toMatchObject({
      provider_id: 'mock-provider',
      readiness_state: 'supported',
      effective_support_level: 'certified',
      is_ready: true,
      model_role: 'Demo/e2e deterministic fixture',
    })
    expect(mockProvider?.last_certification_report).toMatchObject({
      provider_id: 'mock-provider',
      support_level: 'certified',
      run_status: 'completed',
      certification_report_id: expect.stringContaining('mock-provider'),
    })
    expect((mockProvider as any)?.status_rows).toEqual(expect.arrayContaining([
      { label: 'Surface', value: 'mock-provider', tone: 'neutral', description: 'Mock provider uses vendor mock through the built_in runtime; provider-family claims do not transfer to sibling surfaces.' },
      { label: 'Auth mode', value: 'built_in_demo', tone: 'success', description: 'Credential source category: built_in.' },
      { label: 'Billing/quota', value: 'built_in_demo; quota available', tone: 'success', description: 'Quota source: built_in. Subscription, API billing, and built-in demo quotas are separate readiness claims.' },
      { label: 'Privacy posture', value: 'built_in_demo; not_applicable', tone: 'neutral', description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.' },
      { label: 'Role certification', value: 'research_draft: certified', tone: 'success', description: 'Latest target mock-provider / built_in_demo / mock-research-v2 finished with run status completed.' },
      { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable through built-in deterministic demo mode' },
      { label: 'Credential status', value: 'Built-in demo provider', tone: 'success', description: 'No external credentials required.' },
      { label: 'Catalog support', value: 'certified', tone: 'success', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'certified', tone: 'success', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'Report completed', tone: 'success', description: `${certificationScenarioIds.length}/${certificationScenarioIds.length} scenarios passed; provider support level is certified.` },
      { label: 'Allowed use', value: 'Demo/e2e deterministic fixture only', tone: 'neutral', description: 'Certified deterministic demo coverage does not imply live investment readiness.' },
    ]))

    await rm(projectDir, { recursive: true, force: true })
  })

  it('keeps API-key providers experimental even when keys make them ready', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-empty-'))
    const rows = await buildProviderStatusRows({
      env: {
        OPENROUTER_API_KEY: 'test-key',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })

    // Surviving providers stay experimental — never auto-promoted just because a key makes them ready.
    for (const providerId of ['openrouter', 'local'] as const) {
      expect(rows.find((row) => row.provider_id === providerId)).toMatchObject({
        provider_id: providerId,
        readiness_state: 'experimental',
        effective_support_level: 'experimental',
        is_ready: true,
        last_certification_report: undefined,
      })
    }

    await rm(projectDir, { recursive: true, force: true })
  })

  it('renders provider claims as surface auth quota privacy and role-specific instead of family-wide', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-surfaces-'))
    const rows = await buildProviderStatusRows({
      env: {
        OWLFOLIO_PROJECT_DIR: projectDir,
      } as any,
    })

    const localRow = rows.find((row) => row.provider_id === 'local') as any
    const openRouter = rows.find((row) => row.provider_id === 'openrouter') as any

    expect(localRow).toMatchObject({
      provider_surface_id: 'local',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      workflow_role: 'research_draft',
    })
    expect(openRouter).toMatchObject({
      provider_surface_id: 'openrouter-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      billing_mode: 'platform_api_billing',
      quota_source: 'api_project',
      workflow_role: 'research_draft',
      model_role: 'Meta-aggregator candidate',
    })

    expect(localRow.provider_surface_id).not.toBe(openRouter.provider_surface_id)
    for (const row of [localRow, openRouter]) {
      expect(row.status_rows.map((statusRow: { label: string }) => statusRow.label)).toEqual(expect.arrayContaining([
        'Surface',
        'Auth mode',
        'Billing/quota',
        'Privacy posture',
        'Role certification',
        'Allowed use',
      ]))
      const serialized = JSON.stringify(row)
      expect(serialized).not.toContain('secret-openai-key')
      expect(serialized).not.toContain('/secret/gemini/home')
    }

    await rm(projectDir, { recursive: true, force: true })
  })

  it('separates unready credentials from experimental support level', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-empty-'))
    const rows = await buildProviderStatusRows({
      env: {
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })

    // Missing credentials do NOT bump support level — the keyed provider stays experimental + not-ready.
    for (const providerId of ['openrouter'] as const) {
      expect(rows.find((row) => row.provider_id === providerId)).toMatchObject({
        readiness_state: 'unready',
        effective_support_level: 'experimental',
        is_ready: false,
        auth_source: 'missing',
      })
    }

    await rm(projectDir, { recursive: true, force: true })
  })

  it('uses certification report format for the latest report data', async () => {
    const projectDir = await writeReportFixture(await runProviderCertification(new MockProvider(), {
      generated_at: '2026-06-01T00:00:00.000Z',
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
      ground_sources: deterministicGrounder,
    }))
    const reports = await getLatestProviderCertificationReports({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      certification_report_id: expect.any(String),
      provider_id: 'mock-provider',
      run_status: 'completed',
      support_level: 'certified',
      generated_at: expect.any(String),
      capabilities: expect.any(Object),
      cases: expect.any(Array),
      summary: expect.stringContaining('scenarios passed'),
    })
    expect(reports[0]?.cases.every((caseResult) => caseResult.status === 'passed')).toBe(true)

    await rm(projectDir, { recursive: true, force: true })
  })

  it('keeps reports distinct when target vendor/runtime/schema differs even with the same surface auth model and role', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-exact-targets-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    const cliTarget = unsupportedCompletedReport('openrouter')
    const runtimeVariant: CertificationReport = {
      ...cliTarget,
      certification_report_id: 'cert_openai_codex_same_surface_direct_runtime',
      target: {
        ...cliTarget.target,
        vendor_id: 'unknown',
        runtime_kind: 'direct_api',
      },
      generated_at: '2026-06-04T00:00:00.000Z',
    }
    await writeFile(join(reportDir, 'openai-cli-target.latest.json'), JSON.stringify(cliTarget, null, 2), 'utf8')
    await writeFile(join(reportDir, 'openai-runtime-variant.latest.json'), JSON.stringify(runtimeVariant, null, 2), 'utf8')

    const reports = await getLatestProviderCertificationReports({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

    expect(reports.filter((report) => report.provider_id === 'openrouter')).toHaveLength(2)
    expect(reports.map((report) => report.certification_report_id)).toEqual(expect.arrayContaining([
      cliTarget.certification_report_id,
      runtimeVariant.certification_report_id,
    ]))

    await rm(projectDir, { recursive: true, force: true })
  })

  it('fails closed when a completed certification report marks a credential-present provider unsupported', async () => {
    const projectDir = await writeReportFixture({
      ...unsupportedCompletedReport('openrouter'),
      target: {
        ...unsupportedCompletedReport('openrouter').target,
        auth_mode: 'api_key',
      },
    })

    const rows = await buildProviderStatusRows({
      env: {
        OPENROUTER_API_KEY: 'credential-file-exists-but-live-certification-failed',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const claude = rows.find((row) => row.provider_id === 'openrouter')

    expect(claude).toMatchObject({
      provider_id: 'openrouter',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      status_label: '0/13 scenarios passed; provider support level is unsupported.',
      effective_support_level: 'unsupported',
      last_certification_report: {
        run_status: 'completed',
        support_level: 'unsupported',
      },
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('fails closed when latest certification requires reauth or is quota-limited even if support is otherwise certified', async () => {
    const reauthReport: CertificationReport = {
      ...unsupportedCompletedReport('openrouter'),
      certification_report_id: 'cert_claude_reauth_required',
      target: {
        ...unsupportedCompletedReport('openrouter').target,
        auth_mode: 'api_key',
      },
      run_status: 'reauth-required',
      support_level: 'certified',
      not_run_reason: 'Claude credentials expired; run claude login.',
      summary: 'Certification requires reauthentication.',
    }
    const projectDir = await writeReportFixture(reauthReport)

    const rows = await buildProviderStatusRows({
      env: {
        OPENROUTER_API_KEY: 'credential-present-but-reauth-required',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const claude = rows.find((row) => row.provider_id === 'openrouter')

    expect(claude).toMatchObject({
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      effective_support_level: 'unsupported',
      last_certification_report: { run_status: 'reauth-required', support_level: 'certified' },
    })
    expect(claude?.status_rows.find((statusRow) => statusRow.label === 'Workflow certification')).toMatchObject({
      value: 'Reauthentication required',
      tone: 'danger',
    })

    await rm(projectDir, { recursive: true, force: true })

    const quotaProjectDir = await writeReportFixture({
      ...unsupportedCompletedReport('openrouter'),
      certification_report_id: 'cert_openai_quota_limited',
      target: {
        ...unsupportedCompletedReport('openrouter').target,
        auth_mode: 'api_key',
      },
      run_status: 'quota-limited',
      support_level: 'experimental',
      not_run_reason: 'Codex quota limited.',
      summary: 'Certification is quota limited.',
    })
    const quotaRows = await buildProviderStatusRows({
      env: { OPENROUTER_API_KEY: 'credential-present-but-quota-limited', OWLFOLIO_PROJECT_DIR: quotaProjectDir },
    })
    const openai = quotaRows.find((row) => row.provider_id === 'openrouter')
    expect(openai).toMatchObject({
      readiness_state: 'unready',
      is_ready: false,
      effective_support_level: 'unsupported',
      last_certification_report: { run_status: 'quota-limited' },
    })
    expect(openai?.status_rows.find((statusRow) => statusRow.label === 'Workflow certification')).toMatchObject({
      value: 'Quota limited',
      tone: 'danger',
    })

    await rm(quotaProjectDir, { recursive: true, force: true })
  })

  it('blocks allowed use when even the mock provider has an unsupported latest certification report', async () => {
    const projectDir = await writeReportFixture(unsupportedCompletedReport('mock-provider'))

    const rows = await buildProviderStatusRows({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
    const mockProvider = rows.find((row) => row.provider_id === 'mock-provider')

    expect(mockProvider).toMatchObject({
      provider_id: 'mock-provider',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      effective_support_level: 'unsupported',
    })
    expect(mockProvider?.status_rows.find((statusRow) => statusRow.label === 'Allowed use')).toEqual({
      label: 'Allowed use',
      value: 'Blocked for provider-backed workflow starts',
      tone: 'danger',
      description: 'Fail-closed until local availability and effective workflow support are both present.',
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('displays explicit not-configured certification artifacts for unavailable real providers', async () => {
    const projectDir = await writeReportFixture(createNotConfiguredCertificationReport({
      provider_id: 'openrouter',
      generated_at: '2026-06-01T00:00:00.000Z',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'native',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'Direct API live certification failed',
      auth_mode: 'api_key',
    }))

    const rows = await buildProviderStatusRows({
      env: {
        OPENROUTER_API_KEY: 'credential-file-exists-but-live-certification-failed',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const openaiApi = rows.find((row) => row.provider_id === 'openrouter')

    expect(openaiApi).toMatchObject({
      provider_id: 'openrouter',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      status_label: 'Direct API live certification failed',
      effective_support_level: 'unsupported',
      last_certification_report: {
        run_status: 'not-configured',
        not_run_reason: 'Direct API live certification failed',
        support_level: 'unsupported',
      },
    })
    expect((openaiApi as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual(expect.arrayContaining([
      ['Surface', 'openrouter-api'],
      ['Auth mode', 'api_key'],
      ['Role certification', 'research_draft: unsupported'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ]))
    expect(openaiApi?.last_certification_report?.summary).toContain('Certification not run')

    await rm(projectDir, { recursive: true, force: true })
  })

  it('shows an OpenAI not-configured report as the effective support gate even with credentials present', async () => {
    const projectDir = await writeReportFixture(createNotConfiguredCertificationReport({
      provider_id: 'openrouter',
      generated_at: '2026-06-01T00:00:00.000Z',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'adapter',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'OpenRouter structured-output certification rejected',
      auth_mode: 'api_key',
    }))

    const rows = await buildProviderStatusRows({
      env: {
        OPENROUTER_API_KEY: 'credential-present-but-certification-blocks-workflow',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const openrouter = rows.find((row) => row.provider_id === 'openrouter')

    expect(openrouter).toMatchObject({
      provider_id: 'openrouter',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      status_label: 'OpenRouter structured-output certification rejected',
      effective_support_level: 'unsupported',
      last_certification_report: {
        run_status: 'not-configured',
        not_run_reason: 'OpenRouter structured-output certification rejected',
        support_level: 'unsupported',
      },
    })
    expect((openrouter as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual(expect.arrayContaining([
      ['Surface', 'openrouter-api'],
      ['Auth mode', 'api_key'],
      ['Role certification', 'research_draft: unsupported'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ]))

    await rm(projectDir, { recursive: true, force: true })
  })
})

describe('model-tiering — golden-set qualification on the provider status rows', () => {
  it('marks every provider no-report (fail-closed) when no qualification report exists', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-qual-status-'))
    const rows = await buildProviderStatusRows({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
    const mock = rows.find((r) => r.provider_id === 'mock-provider')
    expect(mock?.qualification?.state).toBe('no-report')
    expect(mock?.qualification?.detail).toContain('No qualification report')
    await rm(projectDir, { recursive: true, force: true })
  })

  it('reflects a passing qualification report as qualified', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-qual-status-ok-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(reportDir, 'mock-provider.qualification.latest.json'), JSON.stringify({
      qualification_report_id: 'qual_mock_x',
      provider_id: 'mock-provider',
      model_id: 'mock-buffett-munger-demo',
      golden_set_version: 'golden-set-2026-06-1',
      run_status: 'completed',
      generated_at: '2026-06-09T00:00:00.000Z',
      qualified: true,
      result: { golden_set_version: 'golden-set-2026-06-1', schema_valid_first_attempt_rate: 1, schema_valid_criterion: { pass: true, detail: 'ok' }, companies: [], qualified: true },
      summary: '3/3 golden-set companies passed.',
    }), 'utf8')
    const rows = await buildProviderStatusRows({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
    const mock = rows.find((r) => r.provider_id === 'mock-provider')
    expect(mock?.qualification?.state).toBe('qualified')
    expect(mock?.qualification?.golden_set_version).toBe('golden-set-2026-06-1')
    await rm(projectDir, { recursive: true, force: true })
  })
})

// (The model-registry/tier suite was removed with model tiering — owner, 2026-07-18.)


function unsupportedCompletedReport(providerId: 'mock-provider' | 'local' | 'openrouter'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    target: {
      provider_surface_id: providerId === 'local' ? 'local' : providerId === 'openrouter' ? 'openrouter-api' : 'mock-provider',
      vendor_id: providerId === 'local' ? 'local' : providerId === 'openrouter' ? 'openrouter' : 'mock',
      runtime_kind: providerId === 'mock-provider' ? 'built_in' : 'direct_api',
      auth_mode: providerId === 'mock-provider' ? 'built_in_demo' : 'api_key',
      model_id: providerId === 'local' ? 'llama3.3:70b' : providerId === 'openrouter' ? 'openrouter/auto' : 'mock-research-v2',
      workflow_role: 'research_draft',
      schema_version: 1,
    },
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-02T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'adapter',
      'citation-metadata': 'adapter',
      'url-context': 'unsupported',
      'file-context': 'adapter',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    cases: [],
    summary: '0/13 scenarios passed; provider support level is unsupported.',
  }
}

async function writeReportFixture(report: CertificationReport): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-'))
  const reportDir = join(projectDir, 'data', 'provider-certifications')
  await mkdir(reportDir, { recursive: true })
  await writeFile(join(reportDir, `${report.provider_id}.latest.json`), JSON.stringify(report, null, 2), 'utf8')
  return projectDir
}
