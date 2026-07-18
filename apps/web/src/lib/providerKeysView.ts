import { getProviderCatalog } from '@owlfolio/providers'
import type { ProviderId } from '@owlfolio/shared'

import { assessEnvKeyRuntimeState } from '@owlfolio/onboarding'
import {
  isEnvKeyPathGitIgnored,
  listEnvKeyStatuses,
  readAllEnvKeys,
  resolveEnvKeyFilePath,
  type EnvKeyOptions,
} from './envKeys'
import { evaluateOnboardingGate } from './onboardingGate'
import {
  LLM_API_KEY_GROUPS,
  llmRegistrySelectability,
  oauthLoginExpiryView,
  type LlmKeyGroup,
} from './providerKeys'
import { getProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import type {
  ProviderKeyGroupView,
  ProviderKeyView,
  ProviderKeysPanelProps,
  ProviderLoginRow,
} from '../components/ProviderKeysPanel'

export type BuildProviderKeysPanelArgs = {
  ledgerPath: string | undefined
  envKeyOptions?: EnvKeyOptions
  repoRoot: string
  /**
   * Whether `repoRoot` is actually inside a git working tree (the page resolves this from the filesystem).
   * Defaults to `true`. When `false` (e.g. a local sandbox project dir that is not a git repo), an env file
   * under it is reported safe — no false "NOT git-ignored" warning.
   */
  repoIsGitWorkTree?: boolean
  processEnv?: ProviderReadinessEnv & Record<string, string | undefined>
  activeProviderId: string
}

/** The auth-method label shown on a Section A login row. */
function authMethodLabel(authMode: string | undefined): string {
  if (authMode === 'oauth_browser_login') return 'Browser login (PKCE)'
  if (authMode === 'cli_cached_session' || authMode === 'cli_access_token') return 'External CLI'
  if (authMode === 'api_key') return 'API key'
  return authMode ?? 'Unknown'
}

// No CLI/OAuth login providers remain (Codex/Claude/Gemini CLI retired); surviving providers are API-key
// surfaces. Kept as a map for any future login lane; empty today.
const CONNECT_COMMAND: Record<string, string> = {}

export async function buildProviderKeysPanelProps(args: BuildProviderKeysPanelArgs): Promise<ProviderKeysPanelProps> {
  const envKeyOptions = args.envKeyOptions ?? {}
  const processEnv = args.processEnv ?? {}

  // Env-file header.
  const envPath = envKeyOptions.envPath ?? resolveEnvKeyFilePath({ env: processEnv })
  const envFile = { path: envPath, is_git_ignored: isEnvKeyPathGitIgnored(envPath, args.repoRoot, args.repoIsGitWorkTree ?? true) }

  // Readiness/status MUST see keys stored in the local env file (OWLFOLIO_ENV_FILE), not just the
  // process env — otherwise a key set via this page reads as "set" (Section B keys) yet "not connected"
  // (readiness/trust/login rows), contradicting itself. Overlay the file keys for every readiness and
  // certification computation below. (Section B key statuses read the file directly already.)
  const effectiveEnv = { ...processEnv, ...(await readAllEnvKeys(envKeyOptions)) }

  // Section B: masked LLM key statuses + registry selectability. (Non-LLM tool/data keys are no
  // longer surfaced as onboarding — they are pipeline concerns with env defaults, still settable via env.)
  const llmGroups = await buildKeyGroupViews(LLM_API_KEY_GROUPS, envKeyOptions, true, processEnv)

  // Section A: provider login rows (OAuth / CLI / subscription).
  const loginRows = await buildLoginRows(effectiveEnv)

  // The active provider's readiness over the SAME effective env the readiness sections use, so the gate's
  // "frontier LLM connected" item agrees with the readiness badges (no "ready here, missing there").
  let configuredProviderReady = false
  try {
    configuredProviderReady = (await getProviderReadiness(args.activeProviderId as ProviderId, effectiveEnv)).is_ready
  } catch {
    // Active provider not in the catalog — leave as not-ready.
  }

  // The onboarding gate (composes ledger + env-key signals).
  const onboardingGate = await evaluateOnboardingGate({
    ledgerPath: args.ledgerPath,
    envKeyOptions,
    processEnv: effectiveEnv,
    configuredProviderReady,
  })

  return { envFile, onboardingGate, loginRows, llmGroups }
}

async function buildKeyGroupViews(
  groups: LlmKeyGroup[],
  envKeyOptions: EnvKeyOptions,
  isLlm: boolean,
  processEnv: Record<string, string | undefined> = {},
): Promise<ProviderKeyGroupView[]> {
  const allNames = groups.flatMap((group) => group.keys.map((key) => key.name))
  const statuses = await listEnvKeyStatuses(allNames, envKeyOptions)
  const statusByName = new Map(statuses.map((status) => [status.name, status]))
  // Runtime divergence: the file is read fresh here, but the RUNNING server (and the worker it
  // spawns) only sees what hydrated into process.env at boot — surface the mismatch per key.
  const fileEnv = await readAllEnvKeys(envKeyOptions)
  const setKeys: Record<string, boolean> = {}
  for (const status of statuses) {
    setKeys[status.name] = status.is_set
  }
  const selectability = isLlm ? llmRegistrySelectability(setKeys) : {}

  return groups.map((group) => {
    const keys: ProviderKeyView[] = group.keys.map((key) => {
      const status = statusByName.get(key.name)
      return {
        name: key.name,
        description: key.description,
        is_set: status?.is_set ?? false,
        ...(status?.tail === undefined ? {} : { tail: status.tail }),
        ...(key.advanced === undefined ? {} : { advanced: key.advanced }),
        runtime_state: assessEnvKeyRuntimeState(key.name, processEnv, fileEnv),
      }
    })
    return {
      id: group.id,
      label: group.label,
      get_key_url: group.get_key_url,
      selectable_in_registry: selectability[group.id] ?? false,
      keys,
    }
  })
}

async function buildLoginRows(env: ProviderReadinessEnv): Promise<ProviderLoginRow[]> {
  const loginProviders = getProviderCatalog().filter(
    (provider) => provider.visible_in_onboarding && (provider.runtime_kind === 'cli' || provider.auth_mode === 'oauth_browser_login'),
  )

  const rows = await Promise.all(
    loginProviders.map(async (provider) => {
      const readiness = await getProviderReadiness(provider.provider_id, env)
      const connectCommand = CONNECT_COMMAND[provider.provider_surface_id] ?? `owlfolio auth add ${provider.provider_id}`
      const reauthCommand = readiness.reauth_action ?? connectCommand
      const expiryView = oauthLoginExpiryView({ reauth_command: reauthCommand }, new Date())

      // CLI subscription logins that depend on a default CLI config are "managed externally".
      const managedExternally = readiness.credential_source_category === 'default_cli_config'

      const row: ProviderLoginRow = {
        provider_id: provider.provider_id,
        label: provider.label,
        auth_method_label: authMethodLabel(readiness.auth_mode ?? provider.auth_mode),
        is_connected: readiness.is_ready,
        connect_command: connectCommand,
        reauth_command: reauthCommand,
        is_expired: readiness.readiness_state === 'reauth_required',
        countdown_label: readiness.readiness_state === 'reauth_required' ? 'Expired (0h)' : expiryView.countdown_label,
        managed_externally: managedExternally,
      }
      return row
    }),
  )

  return rows
}
