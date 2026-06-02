import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createNotConfiguredCertificationReport,
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
  let report = providerEntry.provider_id === 'mock-provider' || readiness.is_ready
    ? await runProviderCertification(resolveProvider({ provider_id: providerEntry.provider_id, env }), {
        generated_at: generatedAt,
        model_id: modelForProvider(providerEntry.provider_id),
        timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : 30_000,
      })
    : createNotConfiguredCertificationReport({
        provider_id: providerEntry.provider_id,
        generated_at: generatedAt,
        capabilities: providerEntry.capabilities,
        reason: readiness.status_label,
      })

  report = normalizeUnavailableProviderReport(report, providerEntry.capabilities)

  await persistReport(report)
  reports.push(report)
}

for (const report of reports) {
  console.log(`${report.provider_id}\t${report.run_status}\t${report.support_level}\t${report.summary}`)
}
console.log(`Provider certification reports written to ${reportDir}`)

async function persistReport(report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  await Promise.all([
    writeFile(join(reportDir, `${report.provider_id}.latest.json`), serialized, 'utf8'),
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

  return createNotConfiguredCertificationReport({
    provider_id: report.provider_id,
    generated_at: report.generated_at,
    capabilities,
    reason: `Provider readiness/authentication heartbeat failed: ${authCase.details}`,
  })
}

function modelForProvider(providerId) {
  if (providerId === 'mock-provider') {
    return env.OWLFOLIO_CERTIFY_MODEL_MOCK_PROVIDER ?? 'mock-research-v2'
  }

  if (providerId === 'claude') {
    return env.OWLFOLIO_CERTIFY_MODEL_CLAUDE ?? 'claude-sonnet-4-6'
  }

  return env.OWLFOLIO_CERTIFY_MODEL_OPENAI ?? 'gpt-5.5'
}
