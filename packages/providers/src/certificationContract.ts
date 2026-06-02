import type { ProviderCapabilities, ProviderCapabilityId } from './providerContract'

export const certificationScenarioIds = [
  'auth-setup-and-status-detection',
  'simple-completion',
  'structured-json-output',
  'tool-call-round-trip',
  'multi-step-tool-loop',
  'source-grounded-research-task',
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
export type CertificationReportRunStatus = 'completed' | 'not-configured'

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
  run_status: CertificationReportRunStatus
  not_run_reason?: string
  support_level: CertificationSupportLevel
  generated_at: string
  capabilities: ProviderCapabilities
  cases: CertificationCaseResult[]
  summary: string
}

export type CertificationLedgerPayload = Pick<CertificationReport,
  'certification_report_id' | 'provider_id' | 'run_status' | 'support_level' | 'generated_at'
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
