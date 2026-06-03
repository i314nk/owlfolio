import type {
  ProviderAuthMode,
  ProviderCapabilities,
  ProviderCapabilityId,
  ProviderRuntimeKind,
  ProviderSurfaceId,
  ProviderVendorId,
  ProviderWorkflowRole,
} from './providerContract'

export const certificationScenarioIds = [
  'auth-setup-and-status-detection',
  'simple-completion',
  'structured-json-output',
  'tool-call-round-trip',
  'multi-step-tool-loop',
  'source-grounded-research-task',
  'redaction-no-secret-leak',
  'no-direct-ledger-writes',
  'scheduled-headless-suitability',
  'quota-rate-limit-classification',
  'reauth-classification',
  'specialist-parallel-run',
  'synthesis-output',
  'buffett-munger-strategy-compliance-audit',
  'shariah-review',
  'ledger-update-proposal',
  'scheduled-task-dry-run',
  'end-to-end-demo-workflow',
] as const

export type CertificationScenarioId = (typeof certificationScenarioIds)[number]

export type CertificationScenario = {
  scenario_id: CertificationScenarioId
  title: string
  description: string
  required_for_support_level: 'certified' | 'experimental'
}

export type CertificationCaseStatus = 'passed' | 'failed' | 'skipped' | 'not-run'
export type CertificationSupportLevel = 'certified' | 'experimental' | 'unsupported'
export type CertificationReportRunStatus = 'completed' | 'not-configured' | 'reauth-required' | 'quota-limited'

export type CertificationTarget = {
  provider_surface_id: ProviderSurfaceId
  vendor_id: ProviderVendorId
  runtime_kind: ProviderRuntimeKind
  auth_mode: ProviderAuthMode
  model_id: string
  workflow_role: ProviderWorkflowRole
  schema_version: 1
}

export type CertificationCaseResult = {
  scenario_id: CertificationScenarioId
  title: string
  required_for_support_level: CertificationScenario['required_for_support_level']
  passed: boolean
  status: CertificationCaseStatus
  details: string
  capability_gates: ProviderCapabilityId[]
  observed_provider_behavior?: string
}

export type CertificationReport = {
  certification_report_id: string
  provider_id: string
  target: CertificationTarget
  run_status: CertificationReportRunStatus
  not_run_reason?: string
  support_level: CertificationSupportLevel
  generated_at: string
  capabilities: ProviderCapabilities
  cases: CertificationCaseResult[]
  summary: string
}

export type CertificationLedgerPayload = Pick<CertificationReport,
  'certification_report_id' | 'provider_id' | 'target' | 'run_status' | 'support_level' | 'generated_at'
> & {
  cases: Pick<CertificationCaseResult, 'scenario_id' | 'status' | 'passed' | 'details'>[]
}

export function getCertificationScenarios(): CertificationScenario[] {
  return certificationScenarioIds.map((scenarioId) => ({
    scenario_id: scenarioId,
    title: scenarioId,
    description: `Certification scenario for ${scenarioId}`,
    required_for_support_level: scenarioId === 'auth-setup-and-status-detection' ? 'experimental' : 'certified',
  }))
}

export function certificationTargetKey(target: CertificationTarget): string {
  return [
    `schema-v${target.schema_version}`,
    target.provider_surface_id,
    target.vendor_id,
    target.runtime_kind,
    target.auth_mode,
    target.workflow_role,
    target.model_id,
  ].join(':')
}

export function certificationReportTargetKey(report: CertificationReport): string {
  const target = (report as Partial<CertificationReport>).target
  if (target === undefined) {
    return `legacy:${report.provider_id}`
  }

  return certificationTargetKey(target)
}

export function certificationReportTargetFileStem(report: CertificationReport): string {
  return safeIdentifier(certificationReportTargetKey(report))
}

function safeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/[-_]+$/g, '')
}
