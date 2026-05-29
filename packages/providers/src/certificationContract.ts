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

export type CertificationCaseResult = {
  scenario_id: CertificationScenarioId
  passed: boolean
  details: string
  observed_provider_behavior?: string
}

export type CertificationReport = {
  provider_id: string
  support_level: 'certified' | 'experimental' | 'unsupported'
  generated_at: string
  cases: CertificationCaseResult[]
  summary: string
}

export function getCertificationScenarios(): CertificationScenario[] {
  return certificationScenarioIds.map((scenarioId) => ({
    scenario_id: scenarioId,
    title: scenarioId,
    description: `Certification scenario for ${scenarioId}`,
    required_for_support_level: scenarioId === 'auth-setup-and-status-detection' ? 'experimental' : 'certified',
  }))
}
