import type { ShariahDefaults } from '@owlfolio/shared/appConfig'

// 'DISABLED' (2026-07-15): screening was OFF by setting when the gate fired — an explicit,
// recorded non-verdict (allowed, but never presented as compliant).
export type ShariahStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'PENDING' | 'DISABLED'
export type BusinessActivityAssessment = 'permissible' | 'prohibited' | 'uncertain'
export type ShariahRequirementId = 'business_activity' | 'non_compliant_income_ratio'

export type ShariahPolicy = {
  enabled: boolean
  policy_basis: 'AAOIFI'
  allow_conditional: boolean
  non_compliant_income_threshold: number
  required_requirements: ShariahRequirementId[]
}

export type ShariahSubject = {
  ticker?: string
  company_name?: string
}

export type ShariahEvidence = {
  requirement_id: ShariahRequirementId
  source_id: string
  summary: string
  value?: number
}

export type ShariahAssessment = {
  business_activity?: BusinessActivityAssessment
  non_compliant_income_ratio?: number
  evidence: ShariahEvidence[]
}

export type EvaluateShariahPolicyInput = {
  policy: ShariahPolicy
  subject: ShariahSubject
  assessment: ShariahAssessment
}

export type ShariahPolicyResult = {
  status: ShariahStatus
  policy_basis: 'AAOIFI'
  subject: ShariahSubject
  reasons: string[]
  failed_requirements: ShariahRequirementId[]
  conditional_requirements: ShariahRequirementId[]
  missing_evidence: ShariahRequirementId[]
  requires_user_confirmation: boolean
  evidence: ShariahEvidence[]
}

export function policyFromAppConfig(defaults: ShariahDefaults): ShariahPolicy {
  return {
    enabled: defaults.enabled,
    policy_basis: defaults.policy_basis,
    allow_conditional: defaults.allow_conditional,
    non_compliant_income_threshold: defaults.non_compliant_income_threshold,
    required_requirements: ['business_activity', 'non_compliant_income_ratio'],
  }
}

function evidenceForRequirement(assessment: ShariahAssessment, requirementId: ShariahRequirementId): ShariahEvidence[] {
  return assessment.evidence.filter(
    (entry) => entry.requirement_id === requirementId && entry.source_id.trim().length > 0 && entry.summary.trim().length > 0,
  )
}

function isValidRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function hasUsableEvidence(assessment: ShariahAssessment, requirementId: ShariahRequirementId): boolean {
  const evidence = evidenceForRequirement(assessment, requirementId)
  if (evidence.length === 0) {
    return false
  }

  if (requirementId === 'non_compliant_income_ratio') {
    return isValidRatio(assessment.non_compliant_income_ratio)
  }

  return assessment.business_activity !== undefined
}

export function evaluateShariahPolicy(input: EvaluateShariahPolicyInput): ShariahPolicyResult {
  const { policy, assessment, subject } = input
  const missing_evidence = policy.required_requirements.filter(
    (requirementId) => !hasUsableEvidence(assessment, requirementId),
  )
  const failed_requirements: ShariahRequirementId[] = []
  const conditional_requirements: ShariahRequirementId[] = []
  const reasons: string[] = []

  if (!policy.enabled) {
    return {
      status: 'PENDING',
      policy_basis: policy.policy_basis,
      subject,
      reasons: ['Shariah screening is disabled in app configuration.'],
      failed_requirements,
      conditional_requirements,
      missing_evidence,
      requires_user_confirmation: true,
      evidence: [...assessment.evidence],
    }
  }

  reasons.push(...missing_evidence.map((requirementId) => `Missing sourced evidence for ${requirementId}.`))

  if (assessment.business_activity === 'prohibited') {
    failed_requirements.push('business_activity')
    reasons.push('Business activity is prohibited under the AAOIFI policy boundary.')
  } else if (assessment.business_activity === 'uncertain') {
    conditional_requirements.push('business_activity')
    reasons.push('Business activity requires conditional Shariah review with sourced evidence.')
  }

  const incomeRatio = assessment.non_compliant_income_ratio
  if (!isValidRatio(incomeRatio)) {
    if (!missing_evidence.includes('non_compliant_income_ratio')) {
      missing_evidence.push('non_compliant_income_ratio')
      reasons.push('Missing sourced evidence for non_compliant_income_ratio.')
    }
  } else if (incomeRatio > policy.non_compliant_income_threshold) {
    failed_requirements.push('non_compliant_income_ratio')
    reasons.push(`Non-compliant income ratio ${incomeRatio} exceeds AAOIFI default threshold ${policy.non_compliant_income_threshold}.`)
  } else if (incomeRatio === policy.non_compliant_income_threshold) {
    conditional_requirements.push('non_compliant_income_ratio')
    reasons.push('Non-compliant income ratio is exactly at the AAOIFI threshold and requires confirmation.')
  }

  let status: ShariahStatus = 'COMPLIANT'
  if (failed_requirements.length > 0) {
    status = 'NON_COMPLIANT'
  } else if (missing_evidence.length > 0) {
    status = 'PENDING'
  } else if (conditional_requirements.length > 0) {
    if (policy.allow_conditional) {
      status = 'CONDITIONAL'
    } else {
      status = 'PENDING'
      reasons.push('Conditional findings require policy support before they can pass review.')
    }
  }

  return {
    status,
    policy_basis: policy.policy_basis,
    subject,
    reasons,
    failed_requirements,
    conditional_requirements,
    missing_evidence,
    requires_user_confirmation: status !== 'COMPLIANT',
    evidence: [...assessment.evidence],
  }
}
