import { z } from 'zod'

import {
  certificationReportTargetFileStem,
  getCertificationScenarios,
  type CertificationCaseResult,
  type CertificationLedgerPayload,
  type CertificationReport,
  type CertificationReportRunStatus,
  type CertificationScenario,
  type CertificationScenarioId,
  type CertificationTarget,
} from './certificationContract'
import { getProviderCatalog } from './providerCatalog'
import { redactProviderDiagnostic } from './providerSecurity'
import {
  providerCapabilityIds,
  type ProviderAuthMode,
  type Provider,
  type ProviderCapabilities,
  type ProviderCapabilityId,
  type ProviderRunRequest,
  type ProviderRuntimeKind,
  type ProviderSurfaceId,
  type ProviderVendorId,
  type ProviderWorkflowRole,
} from './providerContract'

export type CertificationGroundSourcesFn = (
  sources: { source_id: string; title: string; url: string; excerpt: string; citation_locator?: string }[],
) => Promise<{ verified_ids: string[]; captured: { source_id: string; availability: 'available' | 'unavailable'; content_hash?: string }[] }>

export type CertificationRunnerOptions = {
  generated_at?: string
  model_id: string
  timeout_ms?: number
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
  ground_sources?: CertificationGroundSourcesFn
}

type UnavailableCertificationReportOptions = {
  provider_id: string
  generated_at: string
  capabilities: Partial<ProviderCapabilities>
  reason: string
  model_id?: string
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
}

type ResolvedCertificationRunnerOptions = Required<Pick<CertificationRunnerOptions, 'generated_at' | 'model_id' | 'timeout_ms' | 'workflow_role'>> & {
  target: CertificationTarget
  ground_sources?: CertificationGroundSourcesFn
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
  'redaction-no-secret-leak': [],
  'no-direct-ledger-writes': ['tool-function-calling'],
  'scheduled-headless-suitability': [],
  'quota-rate-limit-classification': [],
  'reauth-classification': [],
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
  const workflowRole = options.workflow_role ?? 'research_draft'
  const target = certificationTargetFor(provider.provider_id, options.model_id, workflowRole, options)
  const resolvedOptions: ResolvedCertificationRunnerOptions = {
    generated_at: generatedAt,
    model_id: options.model_id,
    timeout_ms: options.timeout_ms ?? 30_000,
    workflow_role: workflowRole,
    target,
    ...(options.ground_sources === undefined ? {} : { ground_sources: options.ground_sources }),
  }
  const scenarios = getCertificationScenarios()
  const cases: CertificationCaseResult[] = []

  for (const scenario of scenarios) {
    cases.push(await runCertificationScenario(provider, scenario, resolvedOptions))
  }

  const passed = cases.filter((caseResult) => caseResult.passed).length
  const supportLevel = supportLevelFromCases(cases, target)

  return {
    certification_report_id: certificationReportId(target, generatedAt),
    provider_id: provider.provider_id,
    target,
    run_status: 'completed',
    support_level: supportLevel,
    generated_at: generatedAt,
    capabilities: normalizeCapabilities(provider.capabilities),
    cases,
    summary: certificationSummary({ passed, total: cases.length, supportLevel, target }),
  }
}

export function toCertificationLedgerPayload(report: CertificationReport): CertificationLedgerPayload {
  return {
    certification_report_id: report.certification_report_id,
    provider_id: report.provider_id,
    target: report.target,
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
  ...targetOptions
}: UnavailableCertificationReportOptions): CertificationReport {
  return createUnavailableCertificationReport({
    provider_id,
    generated_at,
    capabilities,
    reason,
    ...targetOptions,
    run_status: 'not-configured',
    observed_provider_behavior: 'not configured',
    details_prefix: 'Certification not run because provider is not configured',
    summary_prefix: 'Certification not run',
  })
}

export function createReauthRequiredCertificationReport({
  provider_id,
  generated_at,
  capabilities,
  reason,
  ...targetOptions
}: UnavailableCertificationReportOptions): CertificationReport {
  return createUnavailableCertificationReport({
    provider_id,
    generated_at,
    capabilities,
    reason,
    ...targetOptions,
    run_status: 'reauth-required',
    observed_provider_behavior: 'reauth required',
    details_prefix: 'Certification not run because provider requires reauthentication',
    summary_prefix: 'Certification requires reauthentication',
  })
}

export function createQuotaLimitedCertificationReport({
  provider_id,
  generated_at,
  capabilities,
  reason,
  ...targetOptions
}: UnavailableCertificationReportOptions): CertificationReport {
  return createUnavailableCertificationReport({
    provider_id,
    generated_at,
    capabilities,
    reason,
    ...targetOptions,
    run_status: 'quota-limited',
    observed_provider_behavior: 'quota limited',
    details_prefix: 'Certification not run because provider quota or rate limit blocked execution',
    summary_prefix: 'Certification quota limited',
  })
}

function createUnavailableCertificationReport({
  provider_id,
  generated_at,
  capabilities,
  reason,
  model_id,
  provider_surface_id,
  vendor_id,
  runtime_kind,
  auth_mode,
  workflow_role,
  run_status,
  observed_provider_behavior,
  details_prefix,
  summary_prefix,
}: {
  provider_id: string
  generated_at: string
  capabilities: Partial<ProviderCapabilities>
  reason: string
  model_id?: string
  provider_surface_id?: ProviderSurfaceId
  vendor_id?: ProviderVendorId
  runtime_kind?: ProviderRuntimeKind
  auth_mode?: ProviderAuthMode
  workflow_role?: ProviderWorkflowRole
  run_status: Exclude<CertificationReportRunStatus, 'completed'>
  observed_provider_behavior: string
  details_prefix: string
  summary_prefix: string
}): CertificationReport {
  const redactedReason = redactProviderDiagnostic(reason)
  const target = certificationTargetFor(provider_id, model_id ?? defaultModelIdFor(provider_id), workflow_role ?? 'research_draft', {
    ...(provider_surface_id === undefined ? {} : { provider_surface_id }),
    ...(vendor_id === undefined ? {} : { vendor_id }),
    ...(runtime_kind === undefined ? {} : { runtime_kind }),
    ...(auth_mode === undefined ? {} : { auth_mode }),
  })
  const cases = getCertificationScenarios().map((scenario) => caseResult(scenario, {
    passed: false,
    status: 'not-run',
    details: `${details_prefix}: ${redactedReason}`,
    capability_gates: scenarioCapabilityGates[scenario.scenario_id],
    observed_provider_behavior,
  }))

  return {
    certification_report_id: `${certificationReportId(target, generated_at)}_${run_status}`,
    provider_id,
    target,
    run_status,
    not_run_reason: redactedReason,
    support_level: 'unsupported',
    generated_at,
    capabilities: normalizeCapabilities(capabilities),
    cases,
    summary: `${summary_prefix}: ${redactedReason}. Provider support level is unsupported.`,
  }
}

export { certificationReportTargetFileStem }

function certificationReportId(target: CertificationTarget, generatedAt: string): string {
  return `cert_${safeIdentifier(target.provider_surface_id)}_${safeIdentifier(target.auth_mode)}_${safeIdentifier(target.workflow_role)}_${safeIdentifier(target.model_id)}_${safeIdentifier(generatedAt)}`
}

function certificationTargetFor(
  providerId: string,
  modelId: string,
  workflowRole: ProviderWorkflowRole,
  overrides: Partial<Pick<CertificationRunnerOptions, 'provider_surface_id' | 'vendor_id' | 'runtime_kind' | 'auth_mode'>> = {},
): CertificationTarget {
  const provider = getProviderCatalog().find((entry) => entry.provider_id === providerId || entry.provider_surface_id === providerId)

  return {
    provider_surface_id: overrides.provider_surface_id ?? provider?.provider_surface_id ?? (providerId as CertificationTarget['provider_surface_id']),
    vendor_id: overrides.vendor_id ?? provider?.vendor_id ?? 'unknown',
    runtime_kind: overrides.runtime_kind ?? provider?.runtime_kind ?? 'built_in',
    auth_mode: overrides.auth_mode ?? provider?.auth_mode ?? 'built_in_demo',
    model_id: modelId,
    workflow_role: workflowRole,
    schema_version: 1,
  }
}

function defaultModelIdFor(providerId: string): string {
  return getProviderCatalog().find((entry) => entry.provider_id === providerId || entry.provider_surface_id === providerId)?.default_model_id ?? 'unknown-model'
}

function normalizeCapabilities(capabilities: Partial<ProviderCapabilities>): ProviderCapabilities {
  return Object.fromEntries(providerCapabilityIds.map((capabilityId) => [capabilityId, capabilities[capabilityId] ?? 'unsupported'])) as ProviderCapabilities
}

function safeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/[-_]+$/g, '')
}

async function runCertificationScenario(
  provider: Provider,
  scenario: CertificationScenario,
  options: ResolvedCertificationRunnerOptions,
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
        assertNoDirectLedgerWrites(run)
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
        assertNoDirectLedgerWrites(run)
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
        assertSourceCitationEvidence(result)
        if (options.ground_sources !== undefined) {
          const records = (result.source_records ?? []).map((r) => ({
            source_id: r.source_id,
            title: r.title,
            url: r.url,
            excerpt: r.excerpt,
          }))
          const grounding = await options.ground_sources(records)
          const verified = new Set(grounding.verified_ids)
          const ungrounded = result.source_ids.filter(
            (id) => !verified.has(id) || grounding.captured.find((c) => c.source_id === id)?.content_hash === undefined,
          )
          if (ungrounded.length > 0) {
            return caseResult(scenario, {
              passed: false,
              status: 'failed',
              details: `${ungrounded.length} cited source(s) could not be harness-verified: ${ungrounded.join(', ')}`,
              observed_provider_behavior: `Grounding failed for ${ungrounded.length} cited source(s).`,
              capability_gates: capabilityGates,
            })
          }
          return caseResult(scenario, {
            passed: true,
            status: 'passed',
            details: `Grounded ${result.source_ids.length} cited source(s) with content hashes.`,
            observed_provider_behavior: `Validated grounding/citation evidence with ${result.source_records?.length ?? 0} source record(s).`,
            capability_gates: capabilityGates,
          })
        }
        return caseResult(scenario, {
          passed: true,
          status: 'passed',
          details: `Validated ${result.source_records?.length ?? 0} source record(s).`,
          observed_provider_behavior: `Validated grounding/citation evidence with ${result.source_records?.length ?? 0} source record(s).`,
          capability_gates: capabilityGates,
        })
      }
      case 'redaction-no-secret-leak': {
        const diagnostic = redactProviderDiagnostic('OPENAI_API_KEY=*** at /tmp/secret/codex/auth.json using Bearer bearer-secret-token Cookie: owl_session=fake-cookie-value')
        if (diagnostic.includes('/tmp/secret') || diagnostic.includes('***') || diagnostic.includes('bearer-secret-token') || diagnostic.includes('fake-cookie-value')) {
          throw new Error('Provider diagnostic redaction left secret material in certification output')
        }
        return passedCase(scenario, 'Provider diagnostic redaction removed secret-looking values and paths.', capabilityGates)
      }
      case 'no-direct-ledger-writes': {
        const run = await provider.runWithTools(baseRequest(provider, scenario.scenario_id, options, {
          task_kind: 'tool-loop',
          prompt: 'Use source.fetch while proving certification does not write Owlfolio ledger events directly.',
          budget: { max_tool_calls: 1, max_tokens: 1_000 },
          tool_allowlist: ['source.fetch'],
          response_format: { kind: 'text' },
        }))
        assertNoDirectLedgerWrites(run)
        return passedCase(scenario, 'Provider tool run reported zero direct ledger events written.', capabilityGates)
      }
      case 'scheduled-headless-suitability': {
        const providerEntry = getProviderCatalog().find((entry) => entry.provider_id === provider.provider_id || entry.provider_surface_id === options.target.provider_surface_id)
        if (options.target.workflow_role === 'scheduled_monitoring_dry_run') {
          if (providerEntry === undefined || !providerEntry.automation.headless_supported || !providerEntry.automation.scheduled_workflow_supported) {
            throw new Error('Scheduled monitoring certification requires a headless-supported scheduled workflow surface')
          }
        }
        return passedCase(scenario, `Target workflow role ${options.target.workflow_role} is compatible with scheduled/headless suitability gates.`, capabilityGates)
      }
      case 'quota-rate-limit-classification': {
        const report = createQuotaLimitedCertificationReport({
          provider_id: provider.provider_id,
          generated_at: options.generated_at,
          capabilities: provider.capabilities,
          reason: 'quota exhausted for Bearer sample-token',
        })
        if (report.run_status !== 'quota-limited' || report.support_level !== 'unsupported') {
          throw new Error('Quota/rate-limit classification did not produce an unsupported quota-limited report')
        }
        return passedCase(scenario, 'Quota and rate-limit failures classify as quota-limited unsupported reports.', capabilityGates)
      }
      case 'reauth-classification': {
        const report = createReauthRequiredCertificationReport({
          provider_id: provider.provider_id,
          generated_at: options.generated_at,
          capabilities: provider.capabilities,
          reason: 'cached session expired at /tmp/provider/auth.json',
        })
        if (report.run_status !== 'reauth-required' || report.support_level !== 'unsupported') {
          throw new Error('Reauthentication classification did not produce an unsupported reauth-required report')
        }
        return passedCase(scenario, 'Expired or invalid sessions classify as reauth-required unsupported reports.', capabilityGates)
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
      details: redactProviderDiagnostic(error),
      capability_gates: capabilityGates,
    })
  }
}

async function structuredResearch(
  provider: Provider,
  ticker: string,
  scenarioId: CertificationScenarioId,
  options: ResolvedCertificationRunnerOptions,
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

function assertSourceCitationEvidence(result: z.infer<typeof ResearchSchema>): void {
  const sourceRecords = result.source_records ?? []
  const recordIds = new Set(sourceRecords.map((sourceRecord) => sourceRecord.source_id))
  const missingRecords = result.source_ids.filter((sourceId) => !recordIds.has(sourceId))
  if (missingRecords.length > 0) {
    throw new Error(`Structured source citation evidence is missing source records for: ${missingRecords.join(', ')}`)
  }
}

function assertNoDirectLedgerWrites(run: { ledger_events_written?: number }): void {
  if ((run.ledger_events_written ?? 0) !== 0) {
    throw new Error(`Provider certification scenario directly wrote ${run.ledger_events_written} ledger events`)
  }
}

function baseRequest(
  provider: Provider,
  scenarioId: CertificationScenarioId,
  options: ResolvedCertificationRunnerOptions,
  overrides: Partial<ProviderRunRequest>,
): ProviderRunRequest {
  const target = options.target

  return {
    run_id: `cert_${scenarioId}`,
    provider_id: provider.provider_id,
    provider_surface_id: target.provider_surface_id,
    vendor_id: target.vendor_id,
    runtime_kind: target.runtime_kind,
    auth_mode: target.auth_mode,
    workflow_role: target.workflow_role,
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

function supportLevelFromCases(cases: CertificationCaseResult[], target: CertificationTarget): CertificationReport['support_level'] {
  const experimentalCases = cases.filter((caseResult) => caseResult.required_for_support_level === 'experimental')
  const certifiedCases = cases.filter((caseResult) => caseResult.required_for_support_level === 'certified')

  if (certifiedCases.length > 0 && certifiedCases.every((caseResult) => caseResult.passed)) {
    if (certificationPrivacyBlocker(target) !== undefined) {
      return 'experimental'
    }
    return 'certified'
  }

  if (experimentalCases.every((caseResult) => caseResult.passed)) {
    return 'experimental'
  }

  return 'unsupported'
}

function certificationSummary({
  passed,
  total,
  supportLevel,
  target,
}: {
  passed: number
  total: number
  supportLevel: CertificationReport['support_level']
  target: CertificationTarget
}): string {
  const privacyBlocker = certificationPrivacyBlocker(target)
  const base = `${passed}/${total} scenarios passed; provider support level is ${supportLevel}.`
  if (privacyBlocker === undefined) {
    return base
  }

  return `${base} Certified/production support remains blocked because ${privacyBlocker}.`
}

function certificationPrivacyBlocker(target: CertificationTarget): string | undefined {
  const provider = getProviderCatalog().find((entry) => entry.provider_surface_id === target.provider_surface_id)
  if (provider === undefined) {
    return undefined
  }

  if (provider.privacy.data_policy_source === 'api_free_training_possible') {
    return 'privacy posture is free-tier training-possible and retention/ZDR status is not verified'
  }

  if (provider.privacy.data_policy_source === 'unknown') {
    return 'privacy posture is unknown and retention/ZDR status is not verified'
  }

  if (provider.privacy.retention_or_zdr_status === 'not_verified') {
    return 'privacy retention/ZDR status is not verified'
  }

  return undefined
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
