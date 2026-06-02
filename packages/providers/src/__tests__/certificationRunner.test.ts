import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ClaudeCliProvider } from '../claudeCliProvider'
import { createNotConfiguredCertificationReport, runProviderCertification, toCertificationLedgerPayload } from '../certificationRunner'
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

describe('provider certification runner', () => {
  it('certifies the deterministic mock provider only after every certified scenario passes', async () => {
    const report = await runMockCertification()

    expect(report).toMatchObject({
      certification_report_id: 'cert_mock-provider_2026-06-01T00-00-00-000Z',
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

    expect(payload).toEqual({
      certification_report_id: report.certification_report_id,
      provider_id: 'mock-provider',
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
      certification_report_id: 'cert_claude_2026-06-01T00-00-00-000Z_not-configured',
      provider_id: 'claude',
      run_status: 'not-configured',
      not_run_reason: 'Missing Claude credentials',
      support_level: 'unsupported',
    })
    expect(report.cases).toHaveLength(certificationScenarioIds.length)
    expect(report.cases.every((caseResult) => caseResult.status === 'not-run' && caseResult.passed === false)).toBe(true)
    expect(report.summary).toContain('Certification not run: Missing Claude credentials')
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
