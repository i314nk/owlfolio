import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  certificationReportTargetKey,
  certificationTargetKey,
  type CertificationReport,
  type CertificationTarget,
} from '@owlfolio/providers'
import { getProviderCatalog, type ProviderCatalogEntry, type ProviderWorkflowRole } from '@owlfolio/providers'
import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { getProviderReadiness, type ProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import { resolveProjectRootFromCwd } from './appConfigStore'

export type ProviderReadinessState = 'supported' | 'experimental' | 'unready' | 'unsupported'

export type ProviderCertificationReportSummary = Pick<CertificationReport,
  'certification_report_id' | 'provider_id' | 'target' | 'run_status' | 'not_run_reason' | 'support_level' | 'generated_at' | 'summary'
>

export type ProviderStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type ProviderStatusDetail = {
  label: string
  value: string
  tone: ProviderStatusTone
  description: string
}

export type ProviderStatusRow = {
  provider_id: ProviderId
  provider_surface_id: ProviderCatalogEntry['provider_surface_id']
  vendor_id: ProviderCatalogEntry['vendor_id']
  runtime_kind: ProviderCatalogEntry['runtime_kind']
  auth_mode: ProviderReadiness['auth_mode']
  workflow_role: ProviderWorkflowRole
  billing_mode: ProviderCatalogEntry['billing']['billing_mode']
  quota_source: ProviderCatalogEntry['billing']['quota_source']
  quota_status: ProviderCatalogEntry['billing']['quota_status']
  data_policy_source: ProviderCatalogEntry['privacy']['data_policy_source']
  retention_or_zdr_status: ProviderCatalogEntry['privacy']['retention_or_zdr_status']
  headless_supported: boolean
  scheduled_workflow_supported: boolean
  automation_suitability: ProviderCatalogEntry['automation']['automation_suitability']
  label: string
  description: string
  catalog_support_level: ProviderSupportLevel
  effective_support_level: ProviderSupportLevel
  readiness_state: ProviderReadinessState
  provider_readiness_state?: ProviderReadiness['readiness_state']
  is_ready: boolean
  auth_source: string
  credential_source_category?: ProviderReadiness['credential_source_category']
  credential_source_label?: ProviderReadiness['credential_source_label']
  status_label: string
  reauth_action?: ProviderReadiness['reauth_action']
  model_role: string
  limitations: string[]
  capabilities: ProviderCatalogEntry['capabilities']
  status_rows: ProviderStatusDetail[]
  last_certification_report: ProviderCertificationReportSummary | undefined
}

type ProviderStatusEnv = ProviderReadinessEnv & {
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
}

type ProviderStatusOptions = {
  env?: ProviderStatusEnv
  cwd?: string
}

const providerCertificationDirName = 'provider-certifications'

const roleMatrix: Record<ProviderId, { model_role: string; limitations: string[] }> = {
  'mock-provider': {
    model_role: 'Demo/e2e deterministic fixture',
    limitations: [
      'Never present as real research intelligence.',
      'Certified only for deterministic demo, tests, and harness sanity checks.',
    ],
  },
  claude: {
    model_role: 'Personal-local research/dev fallback',
    limitations: [
      'CLI-backed personal-local/dev path; not production-equivalent to a direct Anthropic API adapter.',
      'No full workflow certification report recorded, so it must not produce certified final investment decisions or Shariah conclusions.',
    ],
  },
  openai: {
    model_role: 'Personal-local research/dev fallback',
    limitations: [
      'Codex CLI-backed personal-local/dev path; do not equate Codex CLI success with OpenAI API certification.',
      'No full workflow certification report recorded, so it must not produce certified final investment decisions or Shariah conclusions.',
    ],
  },
  'openai-api': {
    model_role: 'Direct API candidate',
    limitations: [
      'Direct OpenAI API adapter supports structured research drafts and tool-call requests through the API surface, but remains certification-gated.',
      'Must remain hidden from normal onboarding until direct API certification evidence exists.',
    ],
  },
  'gemini-developer-api': {
    model_role: 'Direct API candidate',
    limitations: [
      'Gemini Developer API adapter supports structured research drafts, tool-call requests, and source-grounded citations through the direct API surface.',
      'Free-tier/privacy posture remains not verified, so certified/production claims stay blocked until policy accepts the posture or a paid/ZDR posture is proven.',
    ],
  },
  'gemini-cli': {
    model_role: 'Personal-local experimental candidate',
    limitations: [
      'Gemini CLI Google sign-in is modeled as a future personal-local lane; adapter not implemented yet.',
      'Must not be treated as scheduled-workflow certified or production-headless.',
    ],
  },
}

export async function getLatestProviderCertificationReports(options: ProviderStatusOptions = {}): Promise<CertificationReport[]> {
  const reportDir = resolveProviderCertificationReportDir(options)
  let entries: string[]

  try {
    entries = await readdir(reportDir)
  } catch {
    return []
  }

  const reports = await Promise.all(entries
    .filter((entry) => entry.endsWith('.json'))
    .map(async (entry) => JSON.parse(await readFile(join(reportDir, entry), 'utf8')) as CertificationReport))

  const latestByTarget = new Map<string, CertificationReport>()
  for (const report of reports) {
    const key = certificationReportTargetKey(report)
    const previous = latestByTarget.get(key)
    if (previous === undefined || previous.generated_at.localeCompare(report.generated_at) < 0) {
      latestByTarget.set(key, report)
    }
  }

  return [...latestByTarget.values()].sort((left, right) => certificationReportTargetKey(left).localeCompare(certificationReportTargetKey(right)))
}

export function resolveProviderCertificationReportDir({ cwd = process.cwd(), env = process.env as ProviderStatusEnv }: ProviderStatusOptions = {}): string {
  if (env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR !== undefined && env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR.length > 0) {
    return env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', providerCertificationDirName)
}

export async function buildProviderStatusRows(options: ProviderStatusOptions = {}): Promise<ProviderStatusRow[]> {
  const reports = await getLatestProviderCertificationReports(options)
  const reportsByTarget = new Map(reports.map((report) => [certificationReportTargetKey(report), report]))
  const legacyReportsByProvider = new Map(reports
    .filter((report) => (report as Partial<CertificationReport>).target === undefined)
    .map((report) => [report.provider_id, report]))

  return Promise.all(getProviderCatalog().map(async (provider) => {
    const readiness = await getProviderReadiness(provider.provider_id, options.env ?? {})
    const workflowRole = workflowRoleFor(provider)
    const latestReport = reportsByTarget.get(readinessTargetKey(provider, readiness, workflowRole))
      ?? legacyReportsByProvider.get(provider.provider_id)
    const effectiveSupportLevel = effectiveSupportFrom(provider, latestReport)
    const effectiveReadiness = effectiveReadinessFrom(provider, readiness, latestReport)
    const matrix = roleMatrix[provider.provider_id]

    return {
      provider_id: provider.provider_id,
      provider_surface_id: readiness.provider_surface_id ?? provider.provider_surface_id,
      vendor_id: readiness.vendor_id ?? provider.vendor_id,
      runtime_kind: readiness.runtime_kind ?? provider.runtime_kind,
      auth_mode: effectiveReadiness.auth_mode,
      workflow_role: workflowRole,
      billing_mode: effectiveReadiness.billing_mode ?? provider.billing.billing_mode,
      quota_source: effectiveReadiness.quota_source ?? provider.billing.quota_source,
      quota_status: effectiveReadiness.quota_status ?? provider.billing.quota_status,
      data_policy_source: effectiveReadiness.data_policy_source ?? provider.privacy.data_policy_source,
      retention_or_zdr_status: effectiveReadiness.retention_or_zdr_status ?? provider.privacy.retention_or_zdr_status,
      headless_supported: effectiveReadiness.headless_supported ?? provider.automation.headless_supported,
      scheduled_workflow_supported: effectiveReadiness.scheduled_workflow_supported ?? provider.automation.scheduled_workflow_supported,
      automation_suitability: effectiveReadiness.automation_suitability ?? provider.automation.automation_suitability,
      label: provider.label,
      description: provider.description,
      catalog_support_level: provider.support_level,
      effective_support_level: effectiveSupportLevel,
      readiness_state: readinessStateFrom(effectiveReadiness, effectiveSupportLevel),
      provider_readiness_state: effectiveReadiness.readiness_state,
      is_ready: effectiveReadiness.is_ready,
      auth_source: effectiveReadiness.auth_source,
      credential_source_category: effectiveReadiness.credential_source_category,
      credential_source_label: effectiveReadiness.credential_source_label,
      status_label: effectiveReadiness.status_label,
      reauth_action: effectiveReadiness.reauth_action,
      model_role: matrix.model_role,
      limitations: matrix.limitations,
      capabilities: { ...provider.capabilities },
      status_rows: statusRowsFrom({
        provider,
        localReadiness: readiness,
        effectiveReadiness,
        effectiveSupportLevel,
        latestReport,
        workflowRole,
      }),
      last_certification_report: latestReport === undefined
        ? undefined
        : {
            certification_report_id: latestReport.certification_report_id,
            provider_id: latestReport.provider_id,
            target: latestReport.target,
            run_status: latestReport.run_status,
            ...(latestReport.not_run_reason === undefined ? {} : { not_run_reason: latestReport.not_run_reason }),
            support_level: latestReport.support_level,
            generated_at: latestReport.generated_at,
            summary: latestReport.summary,
          },
    }
  }))
}

function readinessTargetKey(provider: ProviderCatalogEntry, readiness: ProviderReadiness, workflowRole: ProviderWorkflowRole): string {
  return certificationTargetKey({
    provider_surface_id: readiness.provider_surface_id ?? provider.provider_surface_id,
    vendor_id: readiness.vendor_id ?? provider.vendor_id,
    runtime_kind: readiness.runtime_kind ?? provider.runtime_kind,
    auth_mode: readiness.auth_mode ?? provider.auth_mode,
    model_id: provider.default_model_id,
    workflow_role: workflowRole,
    schema_version: 1,
  } satisfies CertificationTarget)
}

function statusRowsFrom({
  provider,
  localReadiness,
  effectiveReadiness,
  effectiveSupportLevel,
  latestReport,
  workflowRole,
}: {
  provider: ProviderCatalogEntry
  localReadiness: ProviderReadiness
  effectiveReadiness: ProviderReadiness
  effectiveSupportLevel: ProviderSupportLevel
  latestReport: CertificationReport | undefined
  workflowRole: ProviderWorkflowRole
}): ProviderStatusDetail[] {
  return [
    surfaceStatusFrom(provider, localReadiness),
    authModeStatusFrom(localReadiness),
    billingQuotaStatusFrom(provider, localReadiness),
    privacyPostureStatusFrom(provider, localReadiness),
    roleCertificationStatusFrom(workflowRole, latestReport),
    localAvailabilityStatusFrom(provider.provider_id, localReadiness),
    credentialStatusFrom(provider.provider_id, localReadiness, latestReport),
    {
      label: 'Catalog support',
      value: provider.support_level,
      tone: supportTone(provider.support_level),
      description: 'Static provider matrix claim.',
    },
    {
      label: 'Effective support',
      value: effectiveSupportLevel,
      tone: supportTone(effectiveSupportLevel),
      description: 'Gating source of truth from latest certification evidence.',
    },
    workflowCertificationStatusFrom(latestReport),
    allowedUseStatusFrom(provider.provider_id, effectiveReadiness, effectiveSupportLevel),
  ]
}

function workflowRoleFor(provider: ProviderCatalogEntry): ProviderWorkflowRole {
  return provider.workflow_roles.includes('research_draft') ? 'research_draft' : (provider.workflow_roles[0] ?? 'research_draft')
}

function surfaceStatusFrom(provider: ProviderCatalogEntry, localReadiness: ProviderReadiness): ProviderStatusDetail {
  const surfaceId = localReadiness.provider_surface_id ?? provider.provider_surface_id
  const runtimeKind = localReadiness.runtime_kind ?? provider.runtime_kind
  return {
    label: 'Surface',
    value: surfaceId,
    tone: provider.support_level === 'unsupported' ? 'warning' : 'neutral',
    description: `${provider.label} uses vendor ${localReadiness.vendor_id ?? provider.vendor_id} through the ${runtimeKind} runtime; provider-family claims do not transfer to sibling surfaces.`,
  }
}

function authModeStatusFrom(localReadiness: ProviderReadiness): ProviderStatusDetail {
  return {
    label: 'Auth mode',
    value: localReadiness.auth_mode ?? 'unknown',
    tone: localReadiness.is_ready ? 'success' : 'warning',
    description: `Credential source category: ${localReadiness.credential_source_category ?? 'unknown'}${localReadiness.credential_source_label === undefined ? '' : ` (${localReadiness.credential_source_label})`}.`,
  }
}

function billingQuotaStatusFrom(provider: ProviderCatalogEntry, localReadiness: ProviderReadiness): ProviderStatusDetail {
  const billingMode = localReadiness.billing_mode ?? provider.billing.billing_mode
  const quotaSource = localReadiness.quota_source ?? provider.billing.quota_source
  const quotaStatus = localReadiness.quota_status ?? provider.billing.quota_status
  return {
    label: 'Billing/quota',
    value: `${billingMode}; quota ${quotaStatus}`,
    tone: quotaStatus === 'available' ? 'success' : quotaStatus === 'limited' || quotaStatus === 'exhausted' ? 'danger' : 'warning',
    description: `Quota source: ${quotaSource}. Subscription, API billing, and built-in demo quotas are separate readiness claims.`,
  }
}

function privacyPostureStatusFrom(provider: ProviderCatalogEntry, localReadiness: ProviderReadiness): ProviderStatusDetail {
  const dataPolicySource = localReadiness.data_policy_source ?? provider.privacy.data_policy_source
  const retentionOrZdrStatus = localReadiness.retention_or_zdr_status ?? provider.privacy.retention_or_zdr_status
  return {
    label: 'Privacy posture',
    value: `${dataPolicySource}; ${retentionOrZdrStatus}`,
    tone: retentionOrZdrStatus === 'not_verified' || dataPolicySource === 'unknown' ? 'warning' : 'neutral',
    description: 'Privacy posture is surface-specific and must not include credential values, raw local paths, cookies, or browser sessions.',
  }
}

function roleCertificationStatusFrom(workflowRole: ProviderWorkflowRole, latestReport: CertificationReport | undefined): ProviderStatusDetail {
  if (latestReport === undefined) {
    return {
      label: 'Role certification',
      value: `${workflowRole}: no matching report`,
      tone: 'warning',
      description: 'No latest certification report matches this surface/auth/model/workflow role target.',
    }
  }

  const target = (latestReport as Partial<CertificationReport>).target
  if (target === undefined) {
    return {
      label: 'Role certification',
      value: `${workflowRole}: ${latestReport.support_level}`,
      tone: latestReport.run_status === 'completed' ? supportTone(latestReport.support_level) : 'danger',
      description: `Latest legacy provider-level report finished with run status ${latestReport.run_status}; no surface/auth/role target was recorded.`,
    }
  }

  return {
    label: 'Role certification',
    value: `${target.workflow_role}: ${latestReport.support_level}`,
    tone: latestReport.run_status === 'completed' ? supportTone(latestReport.support_level) : 'danger',
    description: `Latest target ${target.provider_surface_id} / ${target.auth_mode} / ${target.model_id} finished with run status ${latestReport.run_status}.`,
  }
}

function localAvailabilityStatusFrom(providerId: ProviderId, localReadiness: ProviderReadiness): ProviderStatusDetail {
  return {
    label: 'Local availability',
    value: localReadiness.is_ready ? 'Locally runnable' : 'Not locally runnable',
    tone: localReadiness.is_ready ? 'success' : 'warning',
    description: providerId === 'mock-provider'
      ? 'Locally runnable through built-in deterministic demo mode'
      : localReadiness.status_label,
  }
}

function credentialStatusFrom(
  providerId: ProviderId,
  localReadiness: ProviderReadiness,
  latestReport: CertificationReport | undefined,
): ProviderStatusDetail {
  if (providerId === 'mock-provider') {
    return {
      label: 'Credential status',
      value: 'Built-in demo provider',
      tone: 'success',
      description: 'No external credentials required.',
    }
  }

  if (latestReport !== undefined && certificationReportBlocksExecution(latestReport) && localReadiness.is_ready) {
    return {
      label: 'Credential status',
      value: 'Credentials blocked by latest certification report',
      tone: 'danger',
      description: latestReport.not_run_reason ?? latestReport.summary,
    }
  }

  if (localReadiness.is_ready) {
    return {
      label: 'Credential status',
      value: `Credentials detected via ${localReadiness.auth_source}`,
      tone: 'success',
      description: localReadiness.status_label,
    }
  }

  return {
    label: 'Credential status',
    value: 'Credentials missing',
    tone: 'warning',
    description: localReadiness.status_label,
  }
}

function workflowCertificationStatusFrom(latestReport: CertificationReport | undefined): ProviderStatusDetail {
  if (latestReport === undefined) {
    return {
      label: 'Workflow certification',
      value: 'No certification report recorded',
      tone: 'warning',
      description: 'No persisted certification evidence exists for this provider.',
    }
  }

  if (latestReport.run_status !== 'completed') {
    return {
      label: 'Workflow certification',
      value: certificationRunStatusLabel(latestReport.run_status),
      tone: 'danger',
      description: latestReport.not_run_reason ?? latestReport.summary,
    }
  }

  return {
    label: 'Workflow certification',
    value: 'Report completed',
    tone: supportTone(latestReport.support_level),
    description: latestReport.summary,
  }
}

function allowedUseStatusFrom(
  providerId: ProviderId,
  effectiveReadiness: ProviderReadiness,
  effectiveSupportLevel: ProviderSupportLevel,
): ProviderStatusDetail {
  if (!effectiveReadiness.is_ready || effectiveSupportLevel === 'unsupported') {
    return {
      label: 'Allowed use',
      value: 'Blocked for provider-backed workflow starts',
      tone: 'danger',
      description: 'Fail-closed until local availability and effective workflow support are both present.',
    }
  }

  if (providerId === 'mock-provider') {
    return {
      label: 'Allowed use',
      value: 'Demo/e2e deterministic fixture only',
      tone: 'neutral',
      description: 'Certified deterministic demo coverage does not imply live investment readiness.',
    }
  }

  if (effectiveSupportLevel === 'experimental') {
    return {
      label: 'Allowed use',
      value: 'Research drafts only; not certified for final investment or Shariah decisions',
      tone: 'warning',
      description: 'Experimental support may assist drafts but is not certified workflow authority.',
    }
  }

  return {
    label: 'Allowed use',
    value: 'Certified provider-backed workflow support',
    tone: 'success',
    description: 'Latest evidence supports certified workflow use within Owlfolio policy gates.',
  }
}

function certificationRunStatusLabel(runStatus: CertificationReport['run_status']): string {
  if (runStatus === 'not-configured') {
    return 'Report not configured'
  }
  if (runStatus === 'reauth-required') {
    return 'Reauthentication required'
  }
  if (runStatus === 'quota-limited') {
    return 'Quota limited'
  }
  return `Report ${runStatus}`
}

function supportTone(supportLevel: ProviderSupportLevel): ProviderStatusTone {
  if (supportLevel === 'certified') {
    return 'success'
  }

  if (supportLevel === 'unsupported') {
    return 'danger'
  }

  return 'warning'
}

function effectiveSupportFrom(provider: ProviderCatalogEntry, latestReport: CertificationReport | undefined): ProviderSupportLevel {
  if (latestReport !== undefined) {
    return certificationReportBlocksExecution(latestReport) || certificationReportPrivacyBlocksExecution(provider, latestReport) ? 'unsupported' : latestReport.support_level
  }

  if (!provider.visible_in_onboarding) {
    return 'unsupported'
  }

  if (provider.support_level === 'certified') {
    return 'experimental'
  }

  return provider.support_level
}

function certificationReportBlocksExecution(report: CertificationReport): boolean {
  return report.run_status !== 'completed' || report.support_level === 'unsupported'
}

function certificationReportPrivacyBlocksExecution(provider: ProviderCatalogEntry, report: CertificationReport): boolean {
  return report.run_status === 'completed'
    && report.support_level === 'certified'
    && certificationPrivacyBlocker(provider) !== undefined
}

function certificationPrivacyBlocker(provider: ProviderCatalogEntry): string | undefined {
  if (provider.privacy.data_policy_source === 'api_free_training_possible') {
    return `Certified/production support is blocked until the ${provider.label} privacy posture is policy-accepted or paid/ZDR verified.`
  }

  if (provider.privacy.data_policy_source === 'unknown') {
    return `Certified/production support is blocked until the ${provider.label} privacy posture is known and policy-accepted.`
  }

  if (provider.privacy.retention_or_zdr_status === 'not_verified') {
    return `Certified/production support is blocked until the ${provider.label} retention/ZDR posture is verified or policy-accepted.`
  }

  return undefined
}

function effectiveReadinessFrom(provider: ProviderCatalogEntry, readiness: ProviderReadiness, latestReport: CertificationReport | undefined): ProviderReadiness {
  if (latestReport === undefined) {
    if (!provider.visible_in_onboarding) {
      return {
        ...readiness,
        is_ready: false,
        readiness_state: 'certification_blocked',
        auth_source: readiness.auth_source === 'missing' ? readiness.auth_source : 'certification report',
        status_label: 'No certification report recorded for this hidden/advanced provider surface.',
      }
    }

    return readiness
  }

  if (certificationReportPrivacyBlocksExecution(provider, latestReport)) {
    return {
      ...readiness,
      is_ready: false,
      readiness_state: 'certification_blocked',
      auth_source: 'certification report',
      status_label: certificationPrivacyBlocker(provider) ?? latestReport.summary,
    }
  }

  if (!certificationReportBlocksExecution(latestReport)) {
    return readiness
  }

  return {
    ...readiness,
    is_ready: false,
    readiness_state: readinessStateFromCertificationReport(latestReport),
    ...(latestReport.run_status === 'quota-limited'
      ? {
          quota_status: 'limited' as const,
          quota_source: readiness.quota_source ?? 'subscription_tier' as const,
        }
      : {}),
    auth_source: 'certification report',
    status_label: latestReport.not_run_reason ?? latestReport.summary,
  }
}

function readinessStateFromCertificationReport(report: CertificationReport): NonNullable<ProviderReadiness['readiness_state']> {
  if (report.run_status === 'reauth-required') {
    return 'reauth_required'
  }

  if (report.run_status === 'quota-limited') {
    return 'quota_limited'
  }

  if (report.run_status === 'not-configured') {
    return 'not_configured'
  }

  return 'certification_blocked'
}

function readinessStateFrom(readiness: ProviderReadiness, effectiveSupportLevel: ProviderSupportLevel): ProviderReadinessState {
  if (!readiness.is_ready) {
    return 'unready'
  }

  if (effectiveSupportLevel === 'certified') {
    return 'supported'
  }

  return effectiveSupportLevel
}
