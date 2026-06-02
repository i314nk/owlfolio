import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createNotConfiguredCertificationReport,
  MockProvider,
  runProviderCertification,
  type CertificationReport,
} from '@owlfolio/providers'
import { describe, expect, it } from 'vitest'

import { buildProviderStatusRows, getLatestProviderCertificationReports } from '../providerStatus'

describe('provider status model', () => {
  it('shows the mock provider as certified only because its latest persisted certification report is certified', async () => {
    const projectDir = await writeReportFixture(await runProviderCertification(new MockProvider(), {
      generated_at: '2026-06-01T00:00:00.000Z',
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
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
    expect((mockProvider as any)?.status_rows).toEqual([
      { label: 'Local availability', value: 'Locally runnable', tone: 'success', description: 'Locally runnable through built-in deterministic demo mode' },
      { label: 'Credential status', value: 'Built-in demo provider', tone: 'success', description: 'No external credentials required.' },
      { label: 'Catalog support', value: 'certified', tone: 'success', description: 'Static provider matrix claim.' },
      { label: 'Effective support', value: 'certified', tone: 'success', description: 'Gating source of truth from latest certification evidence.' },
      { label: 'Workflow certification', value: 'Report completed', tone: 'success', description: '13/13 scenarios passed; provider support level is certified.' },
      { label: 'Allowed use', value: 'Demo/e2e deterministic fixture only', tone: 'neutral', description: 'Certified deterministic demo coverage does not imply live investment readiness.' },
    ])

    await rm(projectDir, { recursive: true, force: true })
  })

  it('keeps CLI-backed providers experimental even when local credentials make them ready', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-empty-'))
    const rows = await buildProviderStatusRows({
      env: {
        ANTHROPIC_API_KEY: 'test-key',
        OPENAI_API_KEY: 'test-key',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })

    expect(rows.find((row) => row.provider_id === 'claude')).toMatchObject({
      provider_id: 'claude',
      readiness_state: 'experimental',
      effective_support_level: 'experimental',
      is_ready: true,
      last_certification_report: undefined,
    })
    expect(rows.find((row) => row.provider_id === 'openai')).toMatchObject({
      provider_id: 'openai',
      readiness_state: 'experimental',
      effective_support_level: 'experimental',
      is_ready: true,
      last_certification_report: undefined,
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('separates unready credentials from experimental support level', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-empty-'))
    const rows = await buildProviderStatusRows({
      env: {
        OWLFOLIO_PROJECT_DIR: projectDir,
        OWLFOLIO_CLAUDE_CREDENTIALS_PATH: '/definitely/missing/claude-credentials.json',
        OWLFOLIO_CODEX_AUTH_PATH: '/definitely/missing/codex-auth.json',
      },
    })

    expect(rows.find((row) => row.provider_id === 'claude')).toMatchObject({
      readiness_state: 'unready',
      effective_support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
    })
    expect(rows.find((row) => row.provider_id === 'openai')).toMatchObject({
      readiness_state: 'unready',
      effective_support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('uses certification report format for the latest report data', async () => {
    const projectDir = await writeReportFixture(await runProviderCertification(new MockProvider(), {
      generated_at: '2026-06-01T00:00:00.000Z',
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
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

  it('fails closed when a completed certification report marks a credential-present provider unsupported', async () => {
    const projectDir = await writeReportFixture(unsupportedCompletedReport('claude'))

    const rows = await buildProviderStatusRows({
      env: {
        ANTHROPIC_API_KEY: 'credential-file-exists-but-live-certification-failed',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const claude = rows.find((row) => row.provider_id === 'claude')

    expect(claude).toMatchObject({
      provider_id: 'claude',
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
      provider_id: 'claude',
      generated_at: '2026-06-01T00:00:00.000Z',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'native',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'Claude subscription access disabled',
    }))

    const rows = await buildProviderStatusRows({
      env: {
        ANTHROPIC_API_KEY: 'credential-file-exists-but-live-certification-failed',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const claude = rows.find((row) => row.provider_id === 'claude')

    expect(claude).toMatchObject({
      provider_id: 'claude',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      status_label: 'Claude subscription access disabled',
      effective_support_level: 'unsupported',
      last_certification_report: {
        run_status: 'not-configured',
        not_run_reason: 'Claude subscription access disabled',
        support_level: 'unsupported',
      },
    })
    expect((claude as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual([
      ['Local availability', 'Locally runnable'],
      ['Credential status', 'Credentials blocked by latest certification report'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ])
    expect(claude?.last_certification_report?.summary).toContain('Certification not run')

    await rm(projectDir, { recursive: true, force: true })
  })

  it('shows an OpenAI not-configured report as the effective support gate even with credentials present', async () => {
    const projectDir = await writeReportFixture(createNotConfiguredCertificationReport({
      provider_id: 'openai',
      generated_at: '2026-06-01T00:00:00.000Z',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'adapter',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'Codex CLI structured-output schema rejected',
    }))

    const rows = await buildProviderStatusRows({
      env: {
        OPENAI_API_KEY: 'credential-present-but-certification-blocks-workflow',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const openai = rows.find((row) => row.provider_id === 'openai')

    expect(openai).toMatchObject({
      provider_id: 'openai',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      status_label: 'Codex CLI structured-output schema rejected',
      effective_support_level: 'unsupported',
      last_certification_report: {
        run_status: 'not-configured',
        not_run_reason: 'Codex CLI structured-output schema rejected',
        support_level: 'unsupported',
      },
    })
    expect((openai as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual([
      ['Local availability', 'Locally runnable'],
      ['Credential status', 'Credentials blocked by latest certification report'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ])

    await rm(projectDir, { recursive: true, force: true })
  })
})

function unsupportedCompletedReport(providerId: 'mock-provider' | 'claude' | 'openai'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    run_status: 'completed',
    support_level: 'unsupported',
    generated_at: '2026-06-02T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'unsupported',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
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
