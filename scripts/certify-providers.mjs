import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  certificationReportTargetFileStem,
  createNotConfiguredCertificationReport,
  createQuotaLimitedCertificationReport,
  createReauthRequiredCertificationReport,
  getProviderCatalog,
  resolveProvider,
  runProviderCertification,
} from '../packages/providers/src/index.ts'

import { getProviderReadiness } from '../apps/web/src/lib/providerReadiness.ts'

const env = process.env
const generatedAt = env.OWLFOLIO_CERTIFICATION_GENERATED_AT ?? new Date().toISOString()
const timeoutMs = Number.parseInt(env.OWLFOLIO_CERTIFICATION_TIMEOUT_MS ?? '30000', 10)
const reportDir = env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
  ?? join(env.OWLFOLIO_PROJECT_DIR ?? process.cwd(), 'data', 'provider-certifications')

await mkdir(reportDir, { recursive: true })

const reports = []

for (const providerEntry of getProviderCatalog()) {
  const readiness = await getProviderReadiness(providerEntry.provider_id, env)
  for (const workflowRole of certificationWorkflowRolesFor(providerEntry)) {
    const targetOptions = targetOptionsFor(providerEntry, readiness, workflowRole)
    let report = providerEntry.provider_id === 'mock-provider' || readiness.is_ready
      ? await runProviderCertification(resolveProvider({ provider_id: providerEntry.provider_id, env }), {
          generated_at: generatedAt,
          timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : 30_000,
          ...targetOptions,
        })
      : unavailableReportFor({
          provider_id: providerEntry.provider_id,
          generated_at: generatedAt,
          capabilities: providerEntry.capabilities,
          reason: readiness.status_label,
          ...targetOptions,
        })

    report = normalizeUnavailableProviderReport(report, providerEntry.capabilities)

    await persistReport(report)
    reports.push(report)
  }
}

for (const report of reports) {
  console.log(`${report.provider_id}\t${report.run_status}\t${report.support_level}\t${report.target.workflow_role}\t${report.summary}`)
}
console.log(`Provider certification reports written to ${reportDir}`)

async function persistReport(report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  await Promise.all([
    writeFile(join(reportDir, `${report.provider_id}.latest.json`), serialized, 'utf8'),
    writeFile(join(reportDir, `${certificationReportTargetFileStem(report)}.latest.json`), serialized, 'utf8'),
    writeFile(join(reportDir, `${report.certification_report_id}.json`), serialized, 'utf8'),
  ])
}

function normalizeUnavailableProviderReport(report, capabilities) {
  if (report.provider_id === 'mock-provider' || report.run_status !== 'completed') {
    return report
  }

  const authCase = report.cases.find((caseResult) => caseResult.scenario_id === 'auth-setup-and-status-detection')
  if (authCase === undefined || authCase.passed) {
    return report
  }

  return unavailableReportFor({
    provider_id: report.provider_id,
    generated_at: report.generated_at,
    capabilities,
    reason: `Provider readiness/authentication heartbeat failed: ${authCase.details}`,
    model_id: report.target.model_id,
    provider_surface_id: report.target.provider_surface_id,
    vendor_id: report.target.vendor_id,
    runtime_kind: report.target.runtime_kind,
    auth_mode: report.target.auth_mode,
    workflow_role: report.target.workflow_role,
  })
}

function unavailableReportFor({
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
}) {
  const reportOptions = {
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
  }

  if (/\b(reauth|re-auth|login|expired|invalid session|auth expired)\b/i.test(reason)) {
    return createReauthRequiredCertificationReport(reportOptions)
  }

  if (/\b(quota|rate[-\s]?limit|exhausted|too many requests)\b/i.test(reason)) {
    return createQuotaLimitedCertificationReport(reportOptions)
  }

  return createNotConfiguredCertificationReport(reportOptions)
}

function certificationWorkflowRolesFor(providerEntry) {
  return providerEntry.workflow_roles.includes('scheduled_monitoring_dry_run')
    ? ['research_draft', 'scheduled_monitoring_dry_run']
    : ['research_draft']
}

function targetOptionsFor(providerEntry, readiness, workflowRole) {
  return {
    model_id: modelForProvider(providerEntry, workflowRole),
    provider_surface_id: readiness.provider_surface_id ?? providerEntry.provider_surface_id,
    vendor_id: readiness.vendor_id ?? providerEntry.vendor_id,
    runtime_kind: readiness.runtime_kind ?? providerEntry.runtime_kind,
    auth_mode: readiness.auth_mode ?? providerEntry.auth_mode,
    workflow_role: workflowRole,
  }
}

function modelForProvider(providerEntry, workflowRole) {
  if (providerEntry.provider_id === 'mock-provider') {
    if (workflowRole === 'scheduled_monitoring_dry_run') {
      return env.OWLFOLIO_CERTIFY_MODEL_MOCK_PROVIDER ?? 'mock-buffett-munger-demo'
    }
    return env.OWLFOLIO_CERTIFY_MODEL_MOCK_PROVIDER ?? providerEntry.default_model_id
  }

  if (providerEntry.provider_id === 'claude') {
    return env.OWLFOLIO_CERTIFY_MODEL_CLAUDE ?? providerEntry.default_model_id
  }

  if (providerEntry.provider_family_id === 'openai') {
    return env.OWLFOLIO_CERTIFY_MODEL_OPENAI ?? providerEntry.default_model_id
  }

  if (providerEntry.provider_family_id === 'google-gemini') {
    return env.OWLFOLIO_CERTIFY_MODEL_GEMINI ?? providerEntry.default_model_id
  }

  return providerEntry.default_model_id
}
