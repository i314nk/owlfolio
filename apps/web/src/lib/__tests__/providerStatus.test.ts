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

  it('renders provider claims as surface auth quota privacy and role-specific instead of family-wide', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-surfaces-'))
    const rows = await buildProviderStatusRows({
      env: {
        OPENAI_API_KEY: 'secret-openai-key',
        GEMINI_HOME: '/secret/gemini/home',
        OWLFOLIO_CODEX_AUTH_PATH: '/definitely/missing/codex-auth.json',
        OWLFOLIO_PROJECT_DIR: projectDir,
      } as any,
    })

    const openAiCodex = rows.find((row) => row.provider_id === 'openai') as any
    const openAiApi = rows.find((row) => row.provider_id === 'openai-api') as any
    const geminiDeveloperApi = rows.find((row) => row.provider_id === 'gemini-developer-api') as any
    const geminiCli = rows.find((row) => row.provider_id === 'gemini-cli') as any

    expect(openAiCodex).toMatchObject({
      provider_surface_id: 'openai-codex-cli',
      runtime_kind: 'cli',
      auth_mode: 'api_key',
      billing_mode: 'subscription_entitlement',
      quota_source: 'subscription_tier',
      quota_status: 'unknown',
      data_policy_source: 'subscription_workspace_policy',
      retention_or_zdr_status: 'not_verified',
      workflow_role: 'research_draft',
    })
    expect(openAiApi).toMatchObject({
      provider_surface_id: 'openai-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      billing_mode: 'platform_api_billing',
      quota_source: 'api_project',
      data_policy_source: 'api_paid_no_training',
      workflow_role: 'research_draft',
      is_ready: false,
      effective_support_level: 'unsupported',
      model_role: 'Direct API candidate',
      limitations: expect.arrayContaining([
        'Direct OpenAI API adapter supports structured research drafts and tool-call requests through the API surface, but remains certification-gated.',
        'Must remain hidden from normal onboarding until direct API certification evidence exists.',
      ]),
    })
    expect(geminiDeveloperApi).toMatchObject({
      provider_surface_id: 'gemini-developer-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      billing_mode: 'platform_api_billing',
      quota_source: 'api_project',
      data_policy_source: 'api_free_training_possible',
      retention_or_zdr_status: 'not_verified',
      workflow_role: 'research_draft',
      is_ready: false,
      model_role: 'Direct API candidate',
      limitations: expect.arrayContaining([
        'Gemini Developer API adapter supports structured research drafts, tool-call requests, and source-grounded citations through the direct API surface.',
        'Free-tier/privacy posture remains not verified, so certified/production claims stay blocked until policy accepts the posture or a paid/ZDR posture is proven.',
      ]),
    })
    expect(geminiCli).toMatchObject({
      provider_surface_id: 'gemini-cli',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      billing_mode: 'subscription_entitlement',
      quota_source: 'subscription_tier',
      workflow_role: 'research_draft',
      is_ready: false,
    })

    expect(openAiCodex.provider_surface_id).not.toBe(openAiApi.provider_surface_id)
    expect(geminiDeveloperApi.provider_surface_id).not.toBe(geminiCli.provider_surface_id)
    for (const row of [openAiCodex, openAiApi, geminiDeveloperApi, geminiCli]) {
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

  it('keeps latest certification reports distinct and selects the readiness-matched auth target', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-targets-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    const codexCached = unsupportedCompletedReport('openai')
    const codexApiKey: CertificationReport = {
      ...unsupportedCompletedReport('openai'),
      certification_report_id: 'cert_openai-codex-cli_api_key_research_draft_gpt-5-5_2026-06-03T00-00-00-000Z',
      target: {
        ...unsupportedCompletedReport('openai').target,
        auth_mode: 'api_key',
      },
      generated_at: '2026-06-03T00:00:00.000Z',
      summary: 'API-key certification is newer and should only gate API-key readiness.',
    }
    await writeFile(join(reportDir, 'openai-cached.latest.json'), JSON.stringify(codexCached, null, 2), 'utf8')
    await writeFile(join(reportDir, 'openai-api-key.latest.json'), JSON.stringify(codexApiKey, null, 2), 'utf8')

    const reports = await getLatestProviderCertificationReports({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
    const rows = await buildProviderStatusRows({
      env: {
        OPENAI_API_KEY: 'credential-present-but-certification-blocks-workflow',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })

    expect(reports.filter((report) => report.provider_id === 'openai')).toHaveLength(2)
    expect(rows.find((row) => row.provider_id === 'openai')?.last_certification_report).toMatchObject({
      certification_report_id: codexApiKey.certification_report_id,
      generated_at: codexApiKey.generated_at,
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('does not apply a certification report for a different auth target to current readiness', async () => {
    const cachedSessionReport: CertificationReport = {
      ...unsupportedCompletedReport('openai'),
      certification_report_id: 'cert_openai_cli_cached_certified',
      support_level: 'certified',
      summary: 'CLI cached session is certified but must not gate API-key readiness.',
    }
    const projectDir = await writeReportFixture(cachedSessionReport)

    const rows = await buildProviderStatusRows({
      env: {
        OPENAI_API_KEY: 'credential-present-without-api-key-certification',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const openai = rows.find((row) => row.provider_id === 'openai')

    expect(openai).toMatchObject({
      provider_id: 'openai',
      readiness_state: 'experimental',
      effective_support_level: 'experimental',
      is_ready: true,
      auth_source: 'OPENAI_API_KEY',
      last_certification_report: undefined,
    })

    await rm(projectDir, { recursive: true, force: true })
  })

  it('keeps reports distinct when target vendor/runtime/schema differs even with the same surface auth model and role', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-exact-targets-'))
    const reportDir = join(projectDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    const cliTarget = unsupportedCompletedReport('openai')
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

    expect(reports.filter((report) => report.provider_id === 'openai')).toHaveLength(2)
    expect(reports.map((report) => report.certification_report_id)).toEqual(expect.arrayContaining([
      cliTarget.certification_report_id,
      runtimeVariant.certification_report_id,
    ]))

    await rm(projectDir, { recursive: true, force: true })
  })

  it('fails closed when a completed certification report marks a credential-present provider unsupported', async () => {
    const projectDir = await writeReportFixture({
      ...unsupportedCompletedReport('claude'),
      target: {
        ...unsupportedCompletedReport('claude').target,
        auth_mode: 'api_key',
      },
    })

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

  it('fails closed when latest certification requires reauth or is quota-limited even if support is otherwise certified', async () => {
    const reauthReport: CertificationReport = {
      ...unsupportedCompletedReport('claude'),
      certification_report_id: 'cert_claude_reauth_required',
      target: {
        ...unsupportedCompletedReport('claude').target,
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
        ANTHROPIC_API_KEY: 'credential-present-but-reauth-required',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const claude = rows.find((row) => row.provider_id === 'claude')

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
      ...unsupportedCompletedReport('openai'),
      certification_report_id: 'cert_openai_quota_limited',
      target: {
        ...unsupportedCompletedReport('openai').target,
        auth_mode: 'api_key',
      },
      run_status: 'quota-limited',
      support_level: 'experimental',
      not_run_reason: 'Codex quota limited.',
      summary: 'Certification is quota limited.',
    })
    const quotaRows = await buildProviderStatusRows({
      env: { OPENAI_API_KEY: 'credential-present-but-quota-limited', OWLFOLIO_PROJECT_DIR: quotaProjectDir },
    })
    const openai = quotaRows.find((row) => row.provider_id === 'openai')
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

  it('blocks certified Gemini Developer API reports when free-tier privacy posture is not accepted', async () => {
    const projectDir = await writeReportFixture(certifiedGeminiDeveloperApiReport())

    const rows = await buildProviderStatusRows({
      env: {
        GEMINI_API_KEY: 'credential-present-but-privacy-policy-blocks-certified-claim',
        OWLFOLIO_PROJECT_DIR: projectDir,
      },
    })
    const geminiDeveloperApi = rows.find((row) => row.provider_id === 'gemini-developer-api')

    expect(geminiDeveloperApi).toMatchObject({
      provider_id: 'gemini-developer-api',
      readiness_state: 'unready',
      is_ready: false,
      auth_source: 'certification report',
      effective_support_level: 'unsupported',
      status_label: 'Certified/production support is blocked until the Gemini Developer API privacy posture is policy-accepted or paid/ZDR verified.',
      last_certification_report: {
        run_status: 'completed',
        support_level: 'certified',
      },
    })
    expect(geminiDeveloperApi?.status_rows.find((statusRow) => statusRow.label === 'Allowed use')).toEqual({
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
      auth_mode: 'api_key',
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
    expect((claude as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual(expect.arrayContaining([
      ['Surface', 'claude-cli'],
      ['Auth mode', 'api_key'],
      ['Billing/quota', 'subscription_entitlement; quota unknown'],
      ['Privacy posture', 'subscription_workspace_policy; not_verified'],
      ['Role certification', 'research_draft: unsupported'],
      ['Local availability', 'Locally runnable'],
      ['Credential status', 'Credentials blocked by latest certification report'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ]))
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
      auth_mode: 'api_key',
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
    expect((openai as any)?.status_rows.map((statusRow: { label: string; value: string }) => [statusRow.label, statusRow.value])).toEqual(expect.arrayContaining([
      ['Surface', 'openai-codex-cli'],
      ['Auth mode', 'api_key'],
      ['Billing/quota', 'subscription_entitlement; quota unknown'],
      ['Privacy posture', 'subscription_workspace_policy; not_verified'],
      ['Role certification', 'research_draft: unsupported'],
      ['Local availability', 'Locally runnable'],
      ['Credential status', 'Credentials blocked by latest certification report'],
      ['Catalog support', 'experimental'],
      ['Effective support', 'unsupported'],
      ['Workflow certification', 'Report not configured'],
      ['Allowed use', 'Blocked for provider-backed workflow starts'],
    ]))

    await rm(projectDir, { recursive: true, force: true })
  })
})

function unsupportedCompletedReport(providerId: 'mock-provider' | 'claude' | 'openai'): CertificationReport {
  return {
    certification_report_id: `cert_${providerId}_unsupported_completed`,
    provider_id: providerId,
    target: {
      provider_surface_id: providerId === 'claude' ? 'claude-cli' : providerId === 'openai' ? 'openai-codex-cli' : 'mock-provider',
      vendor_id: providerId === 'claude' ? 'anthropic' : providerId === 'openai' ? 'openai' : 'mock',
      runtime_kind: providerId === 'mock-provider' ? 'built_in' : 'cli',
      auth_mode: providerId === 'mock-provider' ? 'built_in_demo' : 'cli_cached_session',
      model_id: providerId === 'claude' ? 'claude-sonnet-4-6' : providerId === 'openai' ? 'gpt-5.5' : 'mock-research-v2',
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

function certifiedGeminiDeveloperApiReport(): CertificationReport {
  return {
    certification_report_id: 'cert_gemini-developer-api_api_key_research_draft_gemini-2-5-pro_2026-06-02T00-00-00-000Z',
    provider_id: 'gemini-developer-api',
    target: {
      provider_surface_id: 'gemini-developer-api',
      vendor_id: 'google-gemini',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      model_id: 'gemini-2.5-pro',
      workflow_role: 'research_draft',
      schema_version: 1,
    },
    run_status: 'completed',
    support_level: 'certified',
    generated_at: '2026-06-02T00:00:00.000Z',
    capabilities: {
      'text-generation': 'native',
      'structured-output': 'native',
      'tool-function-calling': 'native',
      'streaming-observability': 'adapter',
      'multi-step-tool-loop': 'unsupported',
      'source-grounding': 'native',
      'citation-metadata': 'native',
      'url-context': 'native',
      'file-context': 'unsupported',
      'source-bundle-production': 'adapter',
      'code-execution': 'unsupported',
      'computer-use': 'unsupported',
      'browser-use': 'unsupported',
    },
    cases: [],
    summary: '13/13 scenarios passed; provider support level is certified.',
  }
}

async function writeReportFixture(report: CertificationReport): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-status-'))
  const reportDir = join(projectDir, 'data', 'provider-certifications')
  await mkdir(reportDir, { recursive: true })
  await writeFile(join(reportDir, `${report.provider_id}.latest.json`), JSON.stringify(report, null, 2), 'utf8')
  return projectDir
}
