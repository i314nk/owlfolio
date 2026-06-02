import { z } from 'zod'

import {
  getCertificationScenarios,
  type CertificationCaseResult,
  type CertificationLedgerPayload,
  type CertificationReport,
  type CertificationScenario,
  type CertificationScenarioId,
} from './certificationContract'
import type {
  Provider,
  ProviderCapabilities,
  ProviderCapabilityId,
  ProviderRunRequest,
} from './providerContract'

export type CertificationRunnerOptions = {
  generated_at?: string
  model_id: string
  timeout_ms?: number
}

const ResearchSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  decision_reason: z.string().min(1).optional(),
  source_ids: z.array(z.string().min(1)).min(1),
  source_records: z.array(z.object({
    source_id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url(),
    excerpt: z.string().min(1),
  })).min(1).optional(),
})

const scenarioCapabilityGates: Record<CertificationScenarioId, ProviderCapabilityId[]> = {
  'auth-setup-and-status-detection': [],
  'simple-completion': ['text-generation'],
  'structured-json-output': ['structured-output'],
  'tool-call-round-trip': ['tool-function-calling'],
  'multi-step-tool-loop': ['multi-step-tool-loop'],
  'source-grounded-research-task': ['structured-output'],
  'specialist-parallel-run': ['structured-output'],
  'synthesis-output': ['structured-output'],
  'buffett-munger-strategy-compliance-audit': ['structured-output'],
  'shariah-review': ['structured-output'],
  'ledger-update-proposal': ['structured-output'],
  'scheduled-task-dry-run': ['text-generation'],
  'end-to-end-demo-workflow': ['multi-step-tool-loop'],
}

export async function runProviderCertification(
  provider: Provider,
  options: CertificationRunnerOptions,
): Promise<CertificationReport> {
  const generatedAt = options.generated_at ?? new Date().toISOString()
  const scenarios = getCertificationScenarios()
  const cases: CertificationCaseResult[] = []

  for (const scenario of scenarios) {
    cases.push(await runCertificationScenario(provider, scenario, {
      generated_at: generatedAt,
      model_id: options.model_id,
      timeout_ms: options.timeout_ms ?? 30_000,
    }))
  }

  const passed = cases.filter((caseResult) => caseResult.passed).length
  const supportLevel = supportLevelFromCases(cases)

  return {
    certification_report_id: certificationReportId(provider.provider_id, generatedAt),
    provider_id: provider.provider_id,
    run_status: 'completed',
    support_level: supportLevel,
    generated_at: generatedAt,
    capabilities: { ...provider.capabilities },
    cases,
    summary: `${passed}/${cases.length} scenarios passed; provider support level is ${supportLevel}.`,
  }
}

export function toCertificationLedgerPayload(report: CertificationReport): CertificationLedgerPayload {
  return {
    certification_report_id: report.certification_report_id,
    provider_id: report.provider_id,
    run_status: report.run_status,
    support_level: report.support_level,
    generated_at: report.generated_at,
    cases: report.cases.map((caseResult) => ({
      scenario_id: caseResult.scenario_id,
      status: caseResult.status,
      passed: caseResult.passed,
      details: caseResult.details,
    })),
  }
}

export function createNotConfiguredCertificationReport({
  provider_id,
  generated_at,
  capabilities,
  reason,
}: {
  provider_id: string
  generated_at: string
  capabilities: ProviderCapabilities
  reason: string
}): CertificationReport {
  const cases = getCertificationScenarios().map((scenario) => caseResult(scenario, {
    passed: false,
    status: 'not-run',
    details: `Certification not run because provider is not configured: ${reason}`,
    capability_gates: scenarioCapabilityGates[scenario.scenario_id],
    observed_provider_behavior: 'not configured',
  }))

  return {
    certification_report_id: `${certificationReportId(provider_id, generated_at)}_not-configured`,
    provider_id,
    run_status: 'not-configured',
    not_run_reason: reason,
    support_level: 'unsupported',
    generated_at,
    capabilities: { ...capabilities },
    cases,
    summary: `Certification not run: ${reason}. Provider support level is unsupported.`,
  }
}

function certificationReportId(providerId: string, generatedAt: string): string {
  return `cert_${safeIdentifier(providerId)}_${safeIdentifier(generatedAt)}`
}

function safeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/[-_]+$/g, '')
}

async function runCertificationScenario(
  provider: Provider,
  scenario: CertificationScenario,
  options: Required<CertificationRunnerOptions> & { generated_at: string },
): Promise<CertificationCaseResult> {
  const capabilityGates = scenarioCapabilityGates[scenario.scenario_id]
  const unsupportedCapability = capabilityGates.find((capability) => provider.capabilities[capability] === 'unsupported')

  if (unsupportedCapability !== undefined) {
    return caseResult(scenario, {
      passed: false,
      status: 'skipped',
      details: `Scenario requires ${unsupportedCapability}, but provider declares it unsupported.`,
      observed_provider_behavior: `capability unsupported: ${unsupportedCapability}`,
      capability_gates: capabilityGates,
    })
  }

  try {
    switch (scenario.scenario_id) {
      case 'auth-setup-and-status-detection': {
        const completion = await provider.complete(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'text-generation',
          prompt: 'Run a provider readiness/authentication heartbeat for certification.',
          budget: { max_tool_calls: 0, max_tokens: 200 },
          response_format: { kind: 'text' },
        }))
        if (completion.text.trim().length === 0) {
          throw new Error('Provider readiness check returned empty completion text')
        }
        return caseResult(scenario, {
          passed: true,
          status: 'passed',
          details: 'Provider readiness/authentication heartbeat completed.',
          observed_provider_behavior: `capabilities: ${JSON.stringify(provider.capabilities)}`,
          capability_gates: capabilityGates,
        })
      }
      case 'simple-completion': {
        const completion = await provider.complete(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'text-generation',
          prompt: 'Return a one-sentence provider certification heartbeat.',
          response_format: { kind: 'text' },
        }))
        if (completion.text.trim().length === 0) {
          throw new Error('Provider returned empty completion text')
        }
        return passedCase(scenario, `Text completion returned ${completion.text.trim().length} characters.`, capabilityGates)
      }
      case 'structured-json-output': {
        const result = await provider.structured(
          baseRequest(provider, scenario.scenario_id, options, {
            task_kind: 'structured-output',
            prompt: 'Analyze COST with Buffett-Munger policy and return structured JSON.',
            response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
          }),
          ResearchSchema,
        )
        return passedCase(scenario, `Structured JSON validated with verdict ${result.investment_verdict}.`, capabilityGates)
      }
      case 'tool-call-round-trip': {
        const run = await provider.runWithTools(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'tool-loop',
          prompt: 'Use source.fetch once while reviewing ticker COST.',
          budget: { max_tool_calls: 1, max_tokens: 1_000 },
          tool_allowlist: ['source.fetch'],
          response_format: { kind: 'text' },
        }))
        if (!run.tool_calls.some((toolCall) => toolCall.tool_name === 'source.fetch')) {
          throw new Error('Provider did not perform the required source.fetch tool call')
        }
        return passedCase(scenario, `Observed ${run.tool_calls.length} tool call(s).`, capabilityGates)
      }
      case 'multi-step-tool-loop':
      case 'end-to-end-demo-workflow': {
        const run = await provider.runWithTools(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'tool-loop',
          prompt: 'Run the certified demo workflow for ticker COST with source.fetch available.',
          budget: { max_tool_calls: 2, max_tokens: 2_000 },
          tool_allowlist: ['source.fetch'],
          response_format: { kind: 'text' },
        }))
        if (run.tool_calls.length < 2) {
          throw new Error(`Provider returned ${run.tool_calls.length} tool call(s), but multi-step certification requires at least 2`)
        }
        return passedCase(scenario, `Observed ${run.tool_calls.length} tool call(s) with finish reason ${run.finish_reason}.`, capabilityGates)
      }
      case 'specialist-parallel-run': {
        const [cost, msft] = await Promise.all([
          structuredResearch(provider, 'COST', scenario.scenario_id, options),
          structuredResearch(provider, 'MSFT', scenario.scenario_id, options),
        ])
        if (cost.source_ids.join(',') === msft.source_ids.join(',')) {
          throw new Error('Parallel specialist outputs did not remain ticker-specific')
        }
        return passedCase(scenario, 'Parallel structured research kept source ids ticker-specific.', capabilityGates)
      }
      case 'source-grounded-research-task': {
        const result = await structuredResearch(provider, 'COST', scenario.scenario_id, options)
        if ((result.source_records?.length ?? 0) === 0) {
          throw new Error('Structured result did not include source records')
        }
        return passedCase(scenario, `Validated ${result.source_records?.length ?? 0} source record(s).`, capabilityGates)
      }
      case 'synthesis-output': {
        const result = await structuredResearch(provider, 'COST', scenario.scenario_id, options)
        if (result.next_required_action.trim().length === 0) {
          throw new Error('Synthesis omitted next_required_action')
        }
        return passedCase(scenario, `Synthesis verdict ${result.investment_verdict} with next action.`, capabilityGates)
      }
      case 'buffett-munger-strategy-compliance-audit': {
        const result = await structuredResearch(provider, 'COST', scenario.scenario_id, options)
        return passedCase(scenario, `Strategy compliance was ${result.strategy_compliance}.`, capabilityGates)
      }
      case 'shariah-review': {
        const result = await structuredResearch(provider, 'COST', scenario.scenario_id, options)
        return passedCase(scenario, `Shariah status was ${result.shariah_status}.`, capabilityGates)
      }
      case 'ledger-update-proposal': {
        const result = await structuredResearch(provider, 'COST', scenario.scenario_id, options)
        if (result.source_ids.length === 0) {
          throw new Error('Ledger proposal lacks source ids')
        }
        return passedCase(scenario, `Ledger proposal can cite ${result.source_ids.length} source id(s).`, capabilityGates)
      }
      case 'scheduled-task-dry-run': {
        const completion = await provider.complete(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'text-generation',
          prompt: 'Dry-run a scheduled provider health check without external side effects.',
          response_format: { kind: 'text' },
        }))
        if (completion.observations.length === 0) {
          throw new Error('Scheduled dry-run returned no observations')
        }
        return passedCase(scenario, `Dry-run returned ${completion.observations.length} observation(s).`, capabilityGates)
      }
      default: {
        const exhaustive: never = scenario.scenario_id
        throw new Error(`Unhandled certification scenario ${exhaustive}`)
      }
    }
  } catch (error) {
    return caseResult(scenario, {
      passed: false,
      status: 'failed',
      details: error instanceof Error ? error.message : String(error),
      capability_gates: capabilityGates,
    })
  }
}

async function structuredResearch(
  provider: Provider,
  ticker: string,
  scenarioId: CertificationScenarioId,
  options: Required<CertificationRunnerOptions> & { generated_at: string },
): Promise<z.infer<typeof ResearchSchema>> {
  return provider.structured(
    baseRequest(provider, scenarioId, options, {
      task_kind: 'structured-output',
      prompt: `Analyze ${ticker} with Buffett-Munger policy and return structured JSON.`,
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
    }),
    ResearchSchema,
  )
}

function baseRequest(
  provider: Provider,
  scenarioId: CertificationScenarioId,
  options: Required<CertificationRunnerOptions> & { generated_at: string },
  overrides: Partial<ProviderRunRequest>,
): ProviderRunRequest {
  return {
    run_id: `cert_${scenarioId}`,
    provider_id: provider.provider_id,
    model_id: options.model_id,
    task_kind: 'structured-output',
    prompt: `Run certification scenario ${scenarioId}.`,
    timeout_ms: options.timeout_ms,
    budget: { max_tool_calls: 0, max_tokens: 2_000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
    ...overrides,
  }
}

function supportLevelFromCases(cases: CertificationCaseResult[]): CertificationReport['support_level'] {
  const experimentalCases = cases.filter((caseResult) => caseResult.required_for_support_level === 'experimental')
  const certifiedCases = cases.filter((caseResult) => caseResult.required_for_support_level === 'certified')

  if (certifiedCases.length > 0 && certifiedCases.every((caseResult) => caseResult.passed)) {
    return 'certified'
  }

  if (experimentalCases.every((caseResult) => caseResult.passed)) {
    return 'experimental'
  }

  return 'unsupported'
}

function passedCase(
  scenario: CertificationScenario,
  details: string,
  capabilityGates: ProviderCapabilityId[],
): CertificationCaseResult {
  return caseResult(scenario, {
    passed: true,
    status: 'passed',
    details,
    capability_gates: capabilityGates,
  })
}

function caseResult(
  scenario: CertificationScenario,
  values: Pick<CertificationCaseResult, 'passed' | 'status' | 'details' | 'capability_gates'> & Partial<CertificationCaseResult>,
): CertificationCaseResult {
  return {
    scenario_id: scenario.scenario_id,
    title: scenario.title,
    required_for_support_level: scenario.required_for_support_level,
    ...values,
  }
}
