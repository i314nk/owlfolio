import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

type AppConfig = {
  version: 1
  mode: 'demo' | 'personal-local'
  provider: {
    provider_id: 'mock-provider' | 'claude' | 'openai' | 'openai-api' | 'gemini-developer-api' | 'gemini-cli'
    support_level: 'certified' | 'experimental' | 'unsupported'
    model_id?: string
  }
  strategy_id: 'buffett-munger'
  shariah: {
    enabled: boolean
    policy_basis: 'AAOIFI'
    allow_conditional: boolean
    non_compliant_income_threshold: number
  }
  market_universe: {
    scope_id: 'public-equities'
    label: string
    broker_required: false
  }
  ledger_path?: string
  source_ledger_path?: string
  initialized_at?: string
}

function defaultDemoAppConfig(): AppConfig {
  return {
    version: 1,
    mode: 'demo',
    provider: {
      provider_id: 'mock-provider',
      support_level: 'certified',
      model_id: 'mock-buffett-munger-demo',
    },
    strategy_id: 'buffett-munger',
    shariah: {
      enabled: true,
      policy_basis: 'AAOIFI',
      allow_conditional: true,
      non_compliant_income_threshold: 0.05,
    },
    market_universe: {
      scope_id: 'public-equities',
      label: 'Public equities discovery universe',
      broker_required: false,
    },
  }
}

export type RuntimeBackupEnv = {
  OWLFOLIO_PROJECT_DIR?: string
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PERSONAL_LEDGER_PATH?: string
  OWLFOLIO_LEDGER_PATH?: string
  OWLFOLIO_SOURCE_LEDGER_PATH?: string
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR?: string
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH?: string
  OWLFOLIO_CODEX_AUTH_PATH?: string
  OWLFOLIO_GEMINI_CLI_AUTH_PATH?: string
  CODEX_HOME?: string
  GEMINI_HOME?: string
}

export type RuntimeBackupEntryRole =
  | 'app_config'
  | 'demo_ledger'
  | 'personal_ledger'
  | 'worker_ledger'
  | 'source_ledger'
  | 'provider_certifications'
  | 'sqlite_sidecar'

export type RuntimeBackupEntry = {
  role: RuntimeBackupEntryRole
  absolute_path: string
  relative_path: string
  source: 'env' | 'app_config' | 'default' | 'sqlite_runtime'
  include: true
  reason: string
}

export type ExcludedRuntimePath = {
  pattern: string
  reason: string
}

export type RuntimeBackupInventory = {
  project_dir: string
  app_config_path: string
  app_config: AppConfig
  included_entries: RuntimeBackupEntry[]
  excluded_paths: ExcludedRuntimePath[]
}

export type RuntimeBackupManifestFile = {
  role: RuntimeBackupEntryRole
  relative_path: string
  size_bytes: number
  sha256: string
}

export type RuntimeBackupManifest = {
  schema_version: 1
  created_at_utc: string
  project_dir: string
  git_commit: string
  files: RuntimeBackupManifestFile[]
  included_entries: RuntimeBackupEntry[]
  excluded_paths: ExcludedRuntimePath[]
  app_config: AppConfig
}

export type RuntimeBackupOptions = {
  cwd?: string
  env?: RuntimeBackupEnv
}

export type RuntimeBackupManifestOptions = RuntimeBackupOptions & {
  now?: () => string
  gitCommit?: () => Promise<string>
}

export type RestoreDryRunPlan = {
  mode: AppConfig['mode']
  provider: AppConfig['provider']
  counts: {
    files: number
    ledgers: number
    source_bundles: number
    provider_reports: number
  }
  path_rewrites: Array<{
    field: 'ledger_path' | 'source_ledger_path'
    from: string
    to: string
  }>
  verification_env: {
    OWLFOLIO_APP_CONFIG_PATH: string
    OWLFOLIO_DEMO_LEDGER_PATH: string
    OWLFOLIO_PERSONAL_LEDGER_PATH: string
    OWLFOLIO_LEDGER_PATH: string
    OWLFOLIO_SOURCE_LEDGER_PATH: string
    OWLFOLIO_PROVIDER_CERTIFICATION_DIR: string
  }
  verification_commands: string[]
}

const secretExclusions: ExcludedRuntimePath[] = [
  { pattern: '.env*', reason: 'secret-bearing environment files are never copied into backup archives' },
  { pattern: 'secrets/', reason: 'local secret stores are excluded; providers must be re-authenticated after restore' },
  { pattern: '~/.claude', reason: 'provider auth homes are excluded from investment-state backups' },
  { pattern: 'CODEX_HOME', reason: 'provider auth homes are excluded from investment-state backups' },
  { pattern: 'GEMINI_HOME', reason: 'provider auth homes are excluded from investment-state backups' },
  { pattern: 'OWLFOLIO_*_AUTH_PATH targets', reason: 'provider CLI auth files are credentials, not runtime investment state' },
]

const runtimeExclusions: ExcludedRuntimePath[] = [
  { pattern: 'data/*.pid', reason: 'PID files are ephemeral runtime state and may be misleading after restore' },
  { pattern: '*.pid', reason: 'PID files are ephemeral runtime state and may be misleading after restore' },
  { pattern: 'logs/', reason: 'logs can contain sensitive diagnostics and are not required for restore' },
  { pattern: '.next/', reason: 'generated build output is reproducible and must not be backed up' },
  { pattern: '.playwright-runtime/', reason: 'generated test runtime state is excluded from personal backups' },
  { pattern: '.live-openai-runtime/', reason: 'generated live-provider test runtime state is excluded from personal backups' },
  { pattern: 'test-results/', reason: 'generated test reports are excluded from personal backups' },
  { pattern: 'playwright-report/', reason: 'generated test reports are excluded from personal backups' },
  { pattern: '*.tsbuildinfo', reason: 'generated TypeScript build metadata is reproducible' },
  { pattern: '.worktrees/', reason: 'generated git worktrees are source-control state, not runtime investment data' },
]

export const defaultExcludedRuntimePaths: ExcludedRuntimePath[] = [
  ...secretExclusions,
  ...runtimeExclusions,
]

function resolveProjectRootFromCwd(cwd: string): string {
  const normalized = resolve(cwd)
  let current = normalized
  const { root } = parse(normalized)

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (current === root) {
      return normalized
    }

    const parent = dirname(current)
    if (parent === current) {
      return normalized
    }

    current = parent
  }
}

function resolvePath(projectDir: string, pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : join(projectDir, pathValue)
}

function relativeToProject(projectDir: string, absolutePath: string): string {
  const rel = relative(projectDir, absolutePath)
  return rel.length === 0 ? '.' : rel.split('\\').join('/')
}

function entry({
  role,
  absolutePath,
  source,
  projectDir,
  reason,
}: {
  role: RuntimeBackupEntryRole
  absolutePath: string
  source: RuntimeBackupEntry['source']
  projectDir: string
  reason: string
}): RuntimeBackupEntry {
  return {
    role,
    absolute_path: absolutePath,
    relative_path: relativeToProject(projectDir, absolutePath),
    source,
    include: true,
    reason,
  }
}

async function loadAppConfig(configPath: string): Promise<AppConfig> {
  if (!existsSync(configPath)) {
    return defaultDemoAppConfig()
  }

  const raw = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig
  return {
    version: raw.version,
    mode: raw.mode,
    provider: raw.provider,
    strategy_id: raw.strategy_id,
    shariah: raw.shariah,
    market_universe: raw.market_universe,
    ...(raw.ledger_path === undefined ? {} : { ledger_path: raw.ledger_path }),
    ...(raw.source_ledger_path === undefined ? {} : { source_ledger_path: raw.source_ledger_path }),
    ...(raw.initialized_at === undefined ? {} : { initialized_at: raw.initialized_at }),
  }
}

export async function resolveRuntimeBackupInventory({
  cwd = process.cwd(),
  env = process.env as RuntimeBackupEnv,
}: RuntimeBackupOptions = {}): Promise<RuntimeBackupInventory> {
  const projectDir = resolve(env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd))
  const appConfigPath = resolvePath(projectDir, env.OWLFOLIO_APP_CONFIG_PATH ?? join('data', 'app-config.json'))
  const appConfig = await loadAppConfig(appConfigPath)
  const personalLedgerSource = env.OWLFOLIO_PERSONAL_LEDGER_PATH !== undefined
    ? 'env'
    : appConfig.ledger_path !== undefined
      ? 'app_config'
      : 'default'
  const sourceLedgerSource = env.OWLFOLIO_SOURCE_LEDGER_PATH !== undefined
    ? 'env'
    : appConfig.source_ledger_path !== undefined
      ? 'app_config'
      : 'default'

  const includedEntries: RuntimeBackupEntry[] = [
    entry({
      role: 'app_config',
      absolutePath: appConfigPath,
      source: env.OWLFOLIO_APP_CONFIG_PATH === undefined ? 'default' : 'env',
      projectDir,
      reason: 'allowlisted app configuration with provider IDs and local runtime path fields only',
    }),
    entry({
      role: 'demo_ledger',
      absolutePath: resolvePath(projectDir, env.OWLFOLIO_DEMO_LEDGER_PATH ?? join('data', 'demo-ledger.sqlite')),
      source: env.OWLFOLIO_DEMO_LEDGER_PATH === undefined ? 'default' : 'env',
      projectDir,
      reason: 'optional deterministic demo ledger when present',
    }),
    entry({
      role: 'personal_ledger',
      absolutePath: resolvePath(projectDir, env.OWLFOLIO_PERSONAL_LEDGER_PATH ?? appConfig.ledger_path ?? join('data', 'personal-ledger.sqlite')),
      source: personalLedgerSource,
      projectDir,
      reason: 'personal/local append-only investment workflow ledger',
    }),
    entry({
      role: 'worker_ledger',
      absolutePath: resolvePath(projectDir, env.OWLFOLIO_LEDGER_PATH ?? join('data', 'owlfolio-ledger.sqlite')),
      source: env.OWLFOLIO_LEDGER_PATH === undefined ? 'default' : 'env',
      projectDir,
      reason: 'worker/default ledger used by CLI/admin flows when present',
    }),
    entry({
      role: 'source_ledger',
      absolutePath: resolvePath(projectDir, env.OWLFOLIO_SOURCE_LEDGER_PATH ?? appConfig.source_ledger_path ?? join('data', 'source-ledger')),
      source: sourceLedgerSource,
      projectDir,
      reason: 'private research source bundles referenced by ledger source_ids',
    }),
    entry({
      role: 'provider_certifications',
      absolutePath: resolvePath(projectDir, env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR ?? join('data', 'provider-certifications')),
      source: env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR === undefined ? 'default' : 'env',
      projectDir,
      reason: 'provider certification metadata and latest reports with credentials excluded',
    }),
  ]

  return {
    project_dir: projectDir,
    app_config_path: appConfigPath,
    app_config: appConfig,
    included_entries: includedEntries,
    excluded_paths: defaultExcludedRuntimePaths,
  }
}

function isSqliteLedgerRole(role: RuntimeBackupEntryRole): boolean {
  return role === 'demo_ledger' || role === 'personal_ledger' || role === 'worker_ledger'
}

function sidecarPaths(pathValue: string): string[] {
  if (pathValue.endsWith('.sqlite') || pathValue.endsWith('.db')) {
    return [`${pathValue}-wal`, `${pathValue}-shm`]
  }

  return []
}

async function walkFiles(pathValue: string): Promise<string[]> {
  const pathStat = await stat(pathValue)
  if (pathStat.isFile()) {
    return [pathValue]
  }

  if (!pathStat.isDirectory()) {
    return []
  }

  const children = await readdir(pathValue, { withFileTypes: true })
  const nested = await Promise.all(children.map((child) => walkFiles(join(pathValue, child.name))))
  return nested.flat()
}

async function manifestFileFor(role: RuntimeBackupEntryRole, absolutePath: string, projectDir: string): Promise<RuntimeBackupManifestFile> {
  const contents = await readFile(absolutePath)
  const fileStat = await stat(absolutePath)
  return {
    role,
    relative_path: relativeToProject(projectDir, absolutePath),
    size_bytes: fileStat.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

async function defaultGitCommit(): Promise<string> {
  return 'unknown'
}

export async function buildRuntimeBackupManifest({
  cwd = process.cwd(),
  env = process.env as RuntimeBackupEnv,
  now = () => new Date().toISOString(),
  gitCommit = defaultGitCommit,
}: RuntimeBackupManifestOptions = {}): Promise<RuntimeBackupManifest> {
  const inventory = await resolveRuntimeBackupInventory({ cwd, env })
  const files: RuntimeBackupManifestFile[] = []
  const seen = new Set<string>()

  async function addFile(role: RuntimeBackupEntryRole, pathValue: string) {
    if (!existsSync(pathValue) || seen.has(pathValue)) {
      return
    }

    seen.add(pathValue)
    files.push(await manifestFileFor(role, pathValue, inventory.project_dir))
  }

  for (const inventoryEntry of inventory.included_entries) {
    if (!existsSync(inventoryEntry.absolute_path)) {
      continue
    }

    const paths = await walkFiles(inventoryEntry.absolute_path)
    for (const pathValue of paths) {
      await addFile(inventoryEntry.role, pathValue)
    }

    if (isSqliteLedgerRole(inventoryEntry.role)) {
      for (const sidecarPath of sidecarPaths(inventoryEntry.absolute_path)) {
        await addFile('sqlite_sidecar', sidecarPath)
      }
    }
  }

  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path))

  return {
    schema_version: 1,
    created_at_utc: now(),
    project_dir: inventory.project_dir,
    git_commit: await gitCommit(),
    files,
    included_entries: inventory.included_entries,
    excluded_paths: inventory.excluded_paths,
    app_config: inventory.app_config,
  }
}

function firstManifestPath(manifest: RuntimeBackupManifest, role: RuntimeBackupEntryRole): string | undefined {
  return manifest.files.find((file) => file.role === role)?.relative_path
}

export function buildRestoreDryRunPlan({
  manifest,
  restoreRoot,
}: {
  manifest: RuntimeBackupManifest
  restoreRoot: string
}): RestoreDryRunPlan {
  const runtimeRoot = join(restoreRoot, 'runtime')
  const appConfigPath = join(runtimeRoot, firstManifestPath(manifest, 'app_config') ?? 'data/app-config.json')
  const personalLedgerPath = join(runtimeRoot, firstManifestPath(manifest, 'personal_ledger') ?? 'data/personal-ledger.sqlite')
  const demoLedgerPath = join(runtimeRoot, firstManifestPath(manifest, 'demo_ledger') ?? 'data/demo-ledger.sqlite')
  const workerLedgerPath = join(runtimeRoot, firstManifestPath(manifest, 'worker_ledger') ?? firstManifestPath(manifest, 'personal_ledger') ?? 'data/owlfolio-ledger.sqlite')
  const sourceLedgerPath = join(runtimeRoot, 'data', 'source-ledger')
  const providerCertificationDir = join(runtimeRoot, 'data', 'provider-certifications')
  const pathRewrites: RestoreDryRunPlan['path_rewrites'] = []

  if (manifest.app_config.ledger_path !== undefined) {
    pathRewrites.push({ field: 'ledger_path', from: manifest.app_config.ledger_path, to: personalLedgerPath })
  }

  if (manifest.app_config.source_ledger_path !== undefined) {
    pathRewrites.push({ field: 'source_ledger_path', from: manifest.app_config.source_ledger_path, to: sourceLedgerPath })
  }

  return {
    mode: manifest.app_config.mode,
    provider: manifest.app_config.provider,
    counts: {
      files: manifest.files.length,
      ledgers: manifest.files.filter((file) => file.role === 'demo_ledger' || file.role === 'personal_ledger' || file.role === 'worker_ledger').length,
      source_bundles: manifest.files.filter((file) => file.role === 'source_ledger').length,
      provider_reports: manifest.files.filter((file) => file.role === 'provider_certifications').length,
    },
    path_rewrites: pathRewrites,
    verification_env: {
      OWLFOLIO_APP_CONFIG_PATH: appConfigPath,
      OWLFOLIO_DEMO_LEDGER_PATH: demoLedgerPath,
      OWLFOLIO_PERSONAL_LEDGER_PATH: personalLedgerPath,
      OWLFOLIO_LEDGER_PATH: workerLedgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROVIDER_CERTIFICATION_DIR: providerCertificationDir,
    },
    verification_commands: [
      'ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= corepack pnpm test packages/ledger/src/__tests__/commandCenterProjection.test.ts packages/ledger/src/__tests__/holdingProjection.test.ts packages/ledger/src/__tests__/watchlistProjection.test.ts packages/ledger/src/__tests__/accountingProjection.test.ts packages/ledger/src/__tests__/purificationProjection.test.ts packages/ledger/src/__tests__/scheduledTaskProjection.test.ts apps/worker/src/__tests__/runtime.test.ts',
      'ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= corepack pnpm worker -- --once --dry-run --define-defaults',
    ],
  }
}
