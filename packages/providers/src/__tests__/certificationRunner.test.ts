import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ClaudeCliProvider } from '../claudeCliProvider'
import {
  createNotConfiguredCertificationReport,
  createQuotaLimitedCertificationReport,
  createReauthRequiredCertificationReport,
  runProviderCertification,
  toCertificationLedgerPayload,
} from '../certificationRunner'
import { certificationScenarioIds } from '../certificationContract'
import { MockProvider } from '../mockProvider'
import { OpenAICodexCliProvider } from '../openaiCodexCliProvider'
import type { Provider, ProviderCapabilities, ProviderCompletion, ProviderRunRequest, ProviderToolRun } from '../providerContract'

const fixedGeneratedAt = '2026-06-01T00:00:00.000Z'

async function runMockCertification() {
  return runProviderCertification(new MockProvider(), {
    generated_at: fixedGeneratedAt,
    model_id: 'mock-research-v2',
    timeout_ms: 1_000,
  })
}

class UnsupportedToolLoopProvider implements Provider {
  readonly provider_id = 'unsupported-tool-loop-provider'
  readonly capabilities: ProviderCapabilities = {
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
  } as const

  private readonly delegate = new MockProvider()

  complete(request: ProviderRunRequest) {
    return this.delegate.complete(request)
  }

  structured<T>(request: ProviderRunRequest, schema: z.ZodType<T>) {
    return this.delegate.structured(request, schema)
  }

  async runWithTools(_request: ProviderRunRequest): Promise<ProviderToolRun> {
    throw new Error('runWithTools should not be called for unsupported tool-loop capabilities')
  }
}

class AuthFailingProvider implements Provider {
  readonly provider_id = 'auth-failing-provider'
  readonly capabilities = new UnsupportedToolLoopProvider().capabilities
  private readonly delegate = new UnsupportedToolLoopProvider()

  complete(_request: ProviderRunRequest): Promise<ProviderCompletion> {
    throw new Error('authentication required')
  }

  structured<T>(request: ProviderRunRequest, schema: z.ZodType<T>) {
    return this.delegate.structured(request, schema)
  }

  runWithTools(request: ProviderRunRequest) {
    return this.delegate.runWithTools(request)
  }
}

class SecretLeakingAuthFailingProvider implements Provider {
  readonly provider_id = 'openai'
  readonly capabilities = new OpenAICodexCliProvider().capabilities

  complete(_request: ProviderRunRequest): Promise<ProviderCompletion> {
    throw new Error('auth failed OPENAI_API_KEY=*** at /tmp/secret/codex/auth.json using Bearer bearer-secret-token Cookie: owl_session=fake-cookie-value')
  }

  structured<T>(_request: ProviderRunRequest, _schema: z.ZodType<T>): Promise<T> {
    throw new Error('not used')
  }

  runWithTools(_request: ProviderRunRequest): Promise<ProviderToolRun> {
    throw new Error('not used')
  }
}

class UnmatchedCitationProvider implements Provider {
  readonly provider_id = 'mock-provider'
  readonly capabilities = new MockProvider().capabilities
  private readonly delegate = new MockProvider()

  complete(request: ProviderRunRequest) {
    return this.delegate.complete(request)
  }

  async structured<T>(request: ProviderRunRequest, schema: z.ZodType<T>): Promise<T> {
    const result = await this.delegate.structured(request, schema) as any
    if (request.run_id === 'cert_source-grounded-research-task') {
      return {
        ...result,
        source_ids: ['src_cost_10k_2025', 'src_cost_proxy_2025'],
        source_records: [{
          source_id: 'src_cost_10k_2025',
          title: 'Costco FY2025 10-K',
          url: 'https://example.test/cost-10k-2025',
          excerpt: 'Annual report excerpt.',
        }],
      }
    }
    return result
  }

  runWithTools(request: ProviderRunRequest) {
    return this.delegate.runWithTools(request)
  }
}

class LedgerWritingToolProvider implements Provider {
  readonly provider_id = 'mock-provider'
  readonly capabilities = new MockProvider().capabilities
  private readonly delegate = new MockProvider()

  complete(request: ProviderRunRequest) {
    return this.delegate.complete(request)
  }

  structured<T>(request: ProviderRunRequest, schema: z.ZodType<T>) {
    return this.delegate.structured(request, schema)
  }

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    const run = await this.delegate.runWithTools(request)
    return { ...run, ledger_events_written: 1 } as unknown as ProviderToolRun
  }
}

describe('provider certification runner', () => {
  it('certifies the deterministic mock provider only after every certified scenario passes', async () => {
    const report = await runMockCertification()

    expect(report).toMatchObject({
      certification_report_id: 'cert_mock-provider_built_in_demo_research_draft_mock-research-v2_2026-06-01T00-00-00-000Z',
      provider_id: 'mock-provider',
      run_status: 'completed',
      support_level: 'certified',
      generated_at: fixedGeneratedAt,
    })
    expect(report.cases).toHaveLength(certificationScenarioIds.length)
    expect(report.cases.every((caseResult) => caseResult.passed)).toBe(true)
    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'multi-step-tool-loop')?.details).toContain('2 tool call')
    expect(report.summary).toContain(`${certificationScenarioIds.length}/${certificationScenarioIds.length} scenarios passed`)
  })

  it('returns report cases suitable for provider status UI and certification ledger events', async () => {
    const report = await runMockCertification()
    const payload = toCertificationLedgerPayload(report)

    expect(report).toMatchObject({
      target: {
        provider_surface_id: 'mock-provider',
        vendor_id: 'mock',
        runtime_kind: 'built_in',
        auth_mode: 'built_in_demo',
        model_id: 'mock-research-v2',
        workflow_role: 'research_draft',
        schema_version: 1,
      },
    })
    expect(payload).toEqual({
      certification_report_id: report.certification_report_id,
      provider_id: 'mock-provider',
      target: report.target,
      run_status: 'completed',
      support_level: 'certified',
      generated_at: fixedGeneratedAt,
      cases: report.cases.map((caseResult) => ({
        scenario_id: caseResult.scenario_id,
        status: caseResult.status,
        passed: caseResult.passed,
        details: caseResult.details,
      })),
    })
    expect(report.cases[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      required_for_support_level: expect.stringMatching(/certified|experimental/),
      status: expect.stringMatching(/passed|failed|skipped/),
      capability_gates: expect.any(Array),
    }))
  })

  it('checks structured JSON against the certification schema instead of accepting loose text', async () => {
    const report = await runProviderCertification(new MockProvider({ mode: 'invalid-json' }), {
      generated_at: fixedGeneratedAt,
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
    })

    const structuredCase = report.cases.find((caseResult) => caseResult.scenario_id === 'structured-json-output')
    expect(structuredCase).toMatchObject({
      passed: false,
      status: 'failed',
    })
    expect(structuredCase?.details).toMatch(/structured output validation failed/i)
    expect(report.support_level).not.toBe('certified')
  })

  it('gates unsupported tool-loop scenarios without calling adapters that declare no tool-loop support', async () => {
    const report = await runProviderCertification(new UnsupportedToolLoopProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'stub-model',
      timeout_ms: 1_000,
    })

    expect(report.support_level).toBe('experimental')
    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'tool-call-round-trip')).toMatchObject({
      passed: false,
      status: 'skipped',
      observed_provider_behavior: 'capability unsupported: tool-function-calling',
    })
    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'multi-step-tool-loop')).toMatchObject({
      passed: false,
      status: 'skipped',
      observed_provider_behavior: 'capability unsupported: multi-step-tool-loop',
    })
  })

  it('does not grant experimental status when readiness/auth detection fails', async () => {
    const report = await runProviderCertification(new AuthFailingProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'stub-model',
      timeout_ms: 1_000,
    })

    expect(report.support_level).toBe('unsupported')
    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'auth-setup-and-status-detection')).toMatchObject({
      passed: false,
      status: 'failed',
      details: 'authentication required',
    })
  })

  it('creates explicit not-configured reports when a provider cannot be run', () => {
    const report = createNotConfiguredCertificationReport({
      provider_id: 'claude',
      generated_at: fixedGeneratedAt,
      capabilities: new ClaudeCliProvider().capabilities,
      reason: 'Missing Claude credentials',
    })

    expect(report).toMatchObject({
      certification_report_id: 'cert_claude-cli_cli_cached_session_research_draft_claude-sonnet-4-6_2026-06-01T00-00-00-000Z_not-configured',
      provider_id: 'claude',
      target: {
        provider_surface_id: 'claude-cli',
        vendor_id: 'anthropic',
        runtime_kind: 'cli',
        auth_mode: 'cli_cached_session',
        model_id: 'claude-sonnet-4-6',
        workflow_role: 'research_draft',
        schema_version: 1,
      },
      run_status: 'not-configured',
      not_run_reason: 'Missing Claude credentials',
      support_level: 'unsupported',
    })
    expect(report.cases).toHaveLength(certificationScenarioIds.length)
    expect(report.cases.every((caseResult) => caseResult.status === 'not-run' && caseResult.passed === false)).toBe(true)
    expect(report.summary).toContain('Certification not run: Missing Claude credentials')
  })

  it('redacts raw credential paths and secret-like values from not-configured certification reports', () => {
    const report = createNotConfiguredCertificationReport({
      provider_id: 'openai',
      generated_at: fixedGeneratedAt,
      capabilities: new OpenAICodexCliProvider().capabilities,
      reason: 'Codex auth failed at /tmp/secret/codex/auth.json with OPENAI_API_KEY=*** token *** and service_account private_key abc123 Set-Cookie: sid=fake-cookie-value',
    })
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      provider_id: 'openai',
      target: {
        provider_surface_id: 'openai-codex-cli',
        auth_mode: 'cli_cached_session',
        runtime_kind: 'cli',
        model_id: 'gpt-5.5',
        workflow_role: 'research_draft',
      },
      run_status: 'not-configured',
      support_level: 'unsupported',
    })
    expect(report.not_run_reason).toContain('[redacted-path]')
    expect(serialized).not.toContain('/tmp/secret/codex/auth.json')
    expect(serialized).not.toContain('***')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('fake-cookie-value')
  })

  it('redacts provider error details before persisting failed certification cases', async () => {
    const report = await runProviderCertification(new SecretLeakingAuthFailingProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'gpt-5.5',
      timeout_ms: 1_000,
    })
    const serialized = JSON.stringify(report)

    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'auth-setup-and-status-detection')).toMatchObject({
      passed: false,
      status: 'failed',
      details: expect.stringContaining('[redacted-secret]'),
    })
    expect(serialized).not.toContain('/tmp/secret/codex/auth.json')
    expect(serialized).not.toContain('***')
    expect(serialized).not.toContain('bearer-secret-token')
    expect(serialized).not.toContain('fake-cookie-value')
  })

  it('keys certification reports by explicit auth target when the same surface has multiple auth modes', async () => {
    const report = await runProviderCertification(new SecretLeakingAuthFailingProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'gpt-5.5',
      timeout_ms: 1_000,
      auth_mode: 'cli_access_token',
    })

    expect(report.target).toMatchObject({
      provider_surface_id: 'openai-codex-cli',
      auth_mode: 'cli_access_token',
      model_id: 'gpt-5.5',
      workflow_role: 'research_draft',
    })
    expect(report.certification_report_id).toContain('openai-codex-cli_cli_access_token_research_draft_gpt-5-5')
  })

  it('includes explicit safety/readiness scenarios in the certification contract', () => {
    expect(certificationScenarioIds).toEqual(expect.arrayContaining([
      'redaction-no-secret-leak',
      'no-direct-ledger-writes',
      'scheduled-headless-suitability',
      'quota-rate-limit-classification',
      'reauth-classification',
    ]))
  })

  it('creates explicit reauth-required and quota-limited reports with redacted details', () => {
    const reauthReport = createReauthRequiredCertificationReport({
      provider_id: 'openai',
      generated_at: fixedGeneratedAt,
      capabilities: new OpenAICodexCliProvider().capabilities,
      reason: 'Codex cached login expired at /tmp/secret/codex/auth.json with CODEX_ACCESS_TOKEN=***',
    })
    const quotaReport = createQuotaLimitedCertificationReport({
      provider_id: 'openai',
      generated_at: fixedGeneratedAt,
      capabilities: new OpenAICodexCliProvider().capabilities,
      reason: 'Codex quota exhausted for Bearer bearer-secret-token',
    })
    const serialized = JSON.stringify([reauthReport, quotaReport])

    expect(reauthReport).toMatchObject({
      run_status: 'reauth-required',
      support_level: 'unsupported',
      not_run_reason: expect.stringContaining('[redacted-path]'),
    })
    expect(quotaReport).toMatchObject({
      run_status: 'quota-limited',
      support_level: 'unsupported',
      not_run_reason: expect.stringContaining('[redacted-secret]'),
    })
    expect(reauthReport.cases.every((caseResult) => caseResult.status === 'not-run')).toBe(true)
    expect(quotaReport.cases.every((caseResult) => caseResult.status === 'not-run')).toBe(true)
    expect(serialized).not.toContain('/tmp/secret/codex/auth.json')
    expect(serialized).not.toContain('***')
    expect(serialized).not.toContain('bearer-secret-token')
  })

  it('fails source-grounding certification when cited source ids do not have source records', async () => {
    const report = await runProviderCertification(new UnmatchedCitationProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
    })

    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'source-grounded-research-task')).toMatchObject({
      passed: false,
      status: 'failed',
      details: expect.stringMatching(/source record/i),
    })
    expect(report.support_level).not.toBe('certified')
  })

  it('fails certification when a provider tool scenario directly writes ledger events', async () => {
    const report = await runProviderCertification(new LedgerWritingToolProvider(), {
      generated_at: fixedGeneratedAt,
      model_id: 'mock-research-v2',
      timeout_ms: 1_000,
    })

    expect(report.cases.find((caseResult) => caseResult.scenario_id === 'no-direct-ledger-writes')).toMatchObject({
      passed: false,
      status: 'failed',
      details: expect.stringMatching(/ledger events/i),
    })
    expect(report.support_level).not.toBe('certified')
  })

  it('keeps Claude and OpenAI catalog claims below unsupported native tool-loop certification', () => {
    expect(new ClaudeCliProvider().capabilities).toMatchObject({
      'tool-function-calling': 'unsupported',
      'multi-step-tool-loop': 'unsupported',
    })
    expect(new OpenAICodexCliProvider().capabilities).toMatchObject({
      'tool-function-calling': 'unsupported',
      'multi-step-tool-loop': 'unsupported',
    })
  })
})

// Compile-time schema fidelity guard for the structured-output certification case.
const CertificationResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  source_ids: z.array(z.string()).min(1),
})

describe('certification schema fixture', () => {
  it('keeps the structured-output certification fixture faithful to the runtime schema', () => {
    expect(CertificationResearchSchema.parse({
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'EXPENSIVE',
      next_required_action: 'Wait for a wider margin of safety.',
      source_ids: ['src_cost_10k_2025'],
    }).investment_verdict).toBe('WATCH')
  })
})
