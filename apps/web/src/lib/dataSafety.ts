import { relative, sep } from 'node:path'

import {
  buildRestoreDryRunPlan,
  buildRuntimeBackupManifest,
  type RestoreDryRunPlan,
  type RuntimeBackupEntry,
  type RuntimeBackupEntryRole,
  type RuntimeBackupManifest,
  type RuntimeBackupOptions,
} from '@owlfolio/shared/runtimeBackup'

export type DataSafetyCategory = {
  label: string
  path_label: string
  source: RuntimeBackupEntry['source']
  reason: string
}

export type DataSafetyExcludedCategory = {
  pattern: string
  reason: string
}

export type DataSafetyRestoreProposal = {
  status: 'proposal-only'
  restore_root_label: string
  counts: RestoreDryRunPlan['counts']
  path_rewrites: Array<{
    field: RestoreDryRunPlan['path_rewrites'][number]['field']
    from_label: string
    to_label: string
  }>
  verification_status: string
}

export type DataSafetyViewModel = {
  generated_at_utc: string
  mode: RuntimeBackupManifest['app_config']['mode']
  provider_id: RuntimeBackupManifest['app_config']['provider']['provider_id']
  project_dir_label: string
  manifest_available: boolean
  manifest_file_count: number
  included_categories: DataSafetyCategory[]
  excluded_categories: DataSafetyExcludedCategory[]
  restore: DataSafetyRestoreProposal
}

const sensitivePathTerms = [
  '.claude',
  '.codex',
  '.gemini',
  '.env',
  'anthropic_api_key',
  'api_key',
  'auth',
  'bearer',
  'codex_access_token',
  'credential',
  'oauth',
  'secret',
  'session',
  'token',
]

const roleLabels: Record<RuntimeBackupEntryRole, string> = {
  app_config: 'App configuration',
  demo_ledger: 'Demo ledger',
  personal_ledger: 'Personal ledger',
  provider_certifications: 'Provider certification metadata',
  source_ledger: 'Source ledger',
  sqlite_sidecar: 'SQLite sidecar',
  worker_ledger: 'Worker/default ledger',
}

const roleFallbackPathLabels: Record<RuntimeBackupEntryRole, string> = {
  app_config: 'allowlisted app configuration path',
  demo_ledger: 'allowlisted demo ledger path',
  personal_ledger: 'allowlisted personal ledger path',
  provider_certifications: 'allowlisted provider certification metadata directory',
  source_ledger: 'allowlisted source ledger directory',
  sqlite_sidecar: 'allowlisted SQLite runtime sidecar',
  worker_ledger: 'allowlisted worker/default ledger path',
}

function normalizedPath(pathValue: string): string {
  return pathValue.split('\\').join('/')
}

function containsSensitiveTerm(value: string): boolean {
  const lower = value.toLowerCase()
  return sensitivePathTerms.some((term) => lower.includes(term))
}

function isProjectRelativePathSafe(pathValue: string): boolean {
  return pathValue.length > 0
    && pathValue !== '.'
    && !pathValue.startsWith('..')
    && !pathValue.startsWith('/')
    && !containsSensitiveTerm(pathValue)
}

function safePathLabel({
  pathValue,
  projectDir,
  fallback,
}: {
  pathValue: string
  projectDir: string
  fallback: string
}): string {
  const normalized = normalizedPath(pathValue)
  if (isProjectRelativePathSafe(normalized)) {
    return normalized
  }

  const relativePath = normalizedPath(relative(projectDir, pathValue))
  if (isProjectRelativePathSafe(relativePath)) {
    return relativePath
  }

  return fallback
}

function safeRestoreTargetLabel({
  pathValue,
  restoreRoot,
}: {
  pathValue: string
  restoreRoot: string
}): string {
  const relativePath = normalizedPath(relative(restoreRoot, pathValue))
  if (isProjectRelativePathSafe(relativePath)) {
    return `restore-root/${relativePath}`
  }

  return 'operator-selected restore root runtime path'
}

function excludedPatternLabel(pattern: string): string {
  const lower = pattern.toLowerCase()
  if (lower.includes('auth') || lower.includes('claude') || lower.includes('codex') || lower.includes('gemini')) {
    return 'Provider auth homes and CLI credential files'
  }

  if (lower.includes('.env') || lower.includes('secret')) {
    return 'Environment secret files (.env*)'
  }

  return pattern
}

function dedupeExcludedCategories(categories: DataSafetyExcludedCategory[]): DataSafetyExcludedCategory[] {
  const seen = new Set<string>()
  const deduped: DataSafetyExcludedCategory[] = []

  for (const category of categories) {
    if (seen.has(category.pattern)) {
      continue
    }

    seen.add(category.pattern)
    deduped.push(category)
  }

  return deduped
}

export function buildDataSafetyViewModelFromManifest({
  manifest,
  restoreRootLabel = 'operator-selected restore root',
}: {
  manifest: RuntimeBackupManifest
  restoreRootLabel?: string
}): DataSafetyViewModel {
  const restoreRoot = `${manifest.project_dir}${sep}.owlfolio-restore-dry-run`
  const restorePlan = buildRestoreDryRunPlan({ manifest, restoreRoot })

  return {
    generated_at_utc: manifest.created_at_utc,
    mode: manifest.app_config.mode,
    provider_id: manifest.app_config.provider.provider_id,
    project_dir_label: 'Owlfolio project workspace',
    manifest_available: true,
    manifest_file_count: manifest.files.length,
    included_categories: manifest.included_entries.map((entry) => ({
      label: roleLabels[entry.role],
      path_label: safePathLabel({
        pathValue: entry.relative_path,
        projectDir: manifest.project_dir,
        fallback: roleFallbackPathLabels[entry.role],
      }),
      source: entry.source,
      reason: entry.reason,
    })),
    excluded_categories: dedupeExcludedCategories(manifest.excluded_paths.map((entry) => ({
      pattern: excludedPatternLabel(entry.pattern),
      reason: entry.reason,
    }))),
    restore: {
      status: 'proposal-only',
      restore_root_label: restoreRootLabel,
      counts: restorePlan.counts,
      path_rewrites: restorePlan.path_rewrites.map((rewrite) => ({
        field: rewrite.field,
        from_label: safePathLabel({
          pathValue: rewrite.from,
          projectDir: manifest.project_dir,
          fallback: `configured ${rewrite.field}`,
        }),
        to_label: safeRestoreTargetLabel({ pathValue: rewrite.to, restoreRoot }),
      })),
      verification_status: 'Dry-run verification proposal only; an operator must run the restore archive and verification commands from the runbook.',
    },
  }
}

export async function getDataSafetyViewModel(options: RuntimeBackupOptions = {}): Promise<DataSafetyViewModel> {
  const manifest = await buildRuntimeBackupManifest(options)
  return buildDataSafetyViewModelFromManifest({ manifest })
}
