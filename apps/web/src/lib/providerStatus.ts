import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type CertificationReport } from '@owlfolio/providers'
import { getProviderCatalog, type ProviderCatalogEntry } from '@owlfolio/providers'
import type { ProviderId, ProviderSupportLevel } from '@owlfolio/shared'

import { getProviderReadiness, type ProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import { resolveProjectRootFromCwd } from './appConfigStore'

export type ProviderReadinessState = 'supported' | 'experimental' | 'unready' | 'unsupported'

export type ProviderCertificationReportSummary = Pick<CertificationReport,
  'certification_report_id' | 'provider_id' | 'run_status' | 'not_run_reason' | 'support_level' | 'generated_at' | 'summary'
>

export type ProviderStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type ProviderStatusDetail = {
  label: 'Local availability' | 'Credential status' | 'Catalog support' | 'Effective support' | 'Workflow certification' | 'Allowed use'
  value: string
  tone: ProviderStatusTone
  description: string
}

export type ProviderStatusRow = {
  provider_id: ProviderId
  label: string
  description: string
  catalog_support_level: ProviderSupportLevel
  effective_support_level: ProviderSupportLevel
  readiness_state: ProviderReadinessState
  is_ready: boolean
  auth_source: string
  status_label: string
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

  const latestByProvider = new Map<string, CertificationReport>()
  for (const report of reports) {
    const previous = latestByProvider.get(report.provider_id)
    if (previous === undefined || previous.generated_at.localeCompare(report.generated_at) < 0) {
      latestByProvider.set(report.provider_id, report)
    }
  }

  return [...latestByProvider.values()].sort((left, right) => left.provider_id.localeCompare(right.provider_id))
}

export function resolveProviderCertificationReportDir({ cwd = process.cwd(), env = process.env as ProviderStatusEnv }: ProviderStatusOptions = {}): string {
  if (env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR !== undefined && env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR.length > 0) {
    return env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', providerCertificationDirName)
}

export async function buildProviderStatusRows(options: ProviderStatusOptions = {}): Promise<ProviderStatusRow[]> {
  const reportsByProvider = new Map((await getLatestProviderCertificationReports(options)).map((report) => [report.provider_id, report]))

  return Promise.all(getProviderCatalog().map(async (provider) => {
    const readiness = await getProviderReadiness(provider.provider_id, options.env ?? {})
    const latestReport = reportsByProvider.get(provider.provider_id)
    const effectiveSupportLevel = effectiveSupportFrom(provider.support_level, latestReport)
    const effectiveReadiness = effectiveReadinessFrom(readiness, latestReport)
    const matrix = roleMatrix[provider.provider_id]

    return {
      provider_id: provider.provider_id,
      label: provider.label,
      description: provider.description,
      catalog_support_level: provider.support_level,
      effective_support_level: effectiveSupportLevel,
      readiness_state: readinessStateFrom(effectiveReadiness, effectiveSupportLevel),
      is_ready: effectiveReadiness.is_ready,
      auth_source: effectiveReadiness.auth_source,
      status_label: effectiveReadiness.status_label,
      model_role: matrix.model_role,
      limitations: matrix.limitations,
      capabilities: { ...provider.capabilities },
      status_rows: statusRowsFrom({
        provider,
        localReadiness: readiness,
        effectiveReadiness,
        effectiveSupportLevel,
        latestReport,
      }),
      last_certification_report: latestReport === undefined
        ? undefined
        : {
            certification_report_id: latestReport.certification_report_id,
            provider_id: latestReport.provider_id,
            run_status: latestReport.run_status,
            ...(latestReport.not_run_reason === undefined ? {} : { not_run_reason: latestReport.not_run_reason }),
            support_level: latestReport.support_level,
            generated_at: latestReport.generated_at,
            summary: latestReport.summary,
          },
    }
  }))
}

function statusRowsFrom({
  provider,
  localReadiness,
  effectiveReadiness,
  effectiveSupportLevel,
  latestReport,
}: {
  provider: ProviderCatalogEntry
  localReadiness: ProviderReadiness
  effectiveReadiness: ProviderReadiness
  effectiveSupportLevel: ProviderSupportLevel
  latestReport: CertificationReport | undefined
}): ProviderStatusDetail[] {
  return [
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

  if (latestReport?.support_level === 'unsupported' && localReadiness.is_ready) {
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

  if (latestReport.run_status === 'not-configured') {
    return {
      label: 'Workflow certification',
      value: 'Report not configured',
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

function supportTone(supportLevel: ProviderSupportLevel): ProviderStatusTone {
  if (supportLevel === 'certified') {
    return 'success'
  }

  if (supportLevel === 'unsupported') {
    return 'danger'
  }

  return 'warning'
}

function effectiveSupportFrom(catalogSupportLevel: ProviderSupportLevel, latestReport: CertificationReport | undefined): ProviderSupportLevel {
  if (latestReport !== undefined) {
    return latestReport.support_level
  }

  if (catalogSupportLevel === 'certified') {
    return 'experimental'
  }

  return catalogSupportLevel
}

function effectiveReadinessFrom(readiness: ProviderReadiness, latestReport: CertificationReport | undefined): ProviderReadiness {
  if (latestReport === undefined || latestReport.support_level !== 'unsupported') {
    return readiness
  }

  return {
    ...readiness,
    is_ready: false,
    auth_source: 'certification report',
    status_label: latestReport.not_run_reason ?? latestReport.summary,
  }
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
