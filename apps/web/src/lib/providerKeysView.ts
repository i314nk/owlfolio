import { getProviderCatalog } from '@owlfolio/providers'

import {
  isEnvKeyPathGitIgnored,
  listEnvKeyStatuses,
  resolveEnvKeyFilePath,
  type EnvKeyOptions,
} from './envKeys'
import { evaluateOnboardingGate } from './onboardingGate'
import {
  LLM_API_KEY_GROUPS,
  TOOL_DATA_KEY_GROUPS,
  buildTierAssignmentSummary,
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
  processEnv?: ProviderReadinessEnv & Record<string, string | undefined>
  activeProviderId: string
  activeModel: string
}

/** The auth-method label shown on a Section A login row. */
function authMethodLabel(authMode: string | undefined): string {
  if (authMode === 'oauth_browser_login') return 'Browser login (PKCE)'
  if (authMode === 'cli_cached_session' || authMode === 'cli_access_token') return 'External CLI'
  if (authMode === 'api_key') return 'API key'
  return authMode ?? 'Unknown'
}

const CONNECT_COMMAND: Record<string, string> = {
  'openai-codex-cli': 'codex login',
  'claude-cli': 'claude login',
  'gemini-cli': 'gemini login',
}

export async function buildProviderKeysPanelProps(args: BuildProviderKeysPanelArgs): Promise<ProviderKeysPanelProps> {
  const envKeyOptions = args.envKeyOptions ?? {}
  const processEnv = args.processEnv ?? {}

  // Env-file header.
  const envPath = envKeyOptions.envPath ?? resolveEnvKeyFilePath({ env: processEnv })
  const envFile = { path: envPath, is_git_ignored: isEnvKeyPathGitIgnored(envPath, args.repoRoot) }

  // Sections B + C: masked key statuses + registry selectability.
  const llmGroups = await buildKeyGroupViews(LLM_API_KEY_GROUPS, envKeyOptions, true)
  const toolGroups = await buildKeyGroupViews(TOOL_DATA_KEY_GROUPS, envKeyOptions, false)

  const tierSummary = buildTierAssignmentSummary({ activeProviderId: args.activeProviderId, activeModel: args.activeModel })

  // Section A: provider login rows (OAuth / CLI / subscription).
  const loginRows = await buildLoginRows(processEnv)

  // The onboarding gate (composes ledger + env-key signals).
  const onboardingGate = await evaluateOnboardingGate({
    ledgerPath: args.ledgerPath,
    envKeyOptions,
    processEnv,
  })

  return { envFile, onboardingGate, loginRows, llmGroups, toolGroups, tierSummary }
}

async function buildKeyGroupViews(
  groups: LlmKeyGroup[],
  envKeyOptions: EnvKeyOptions,
  isLlm: boolean,
): Promise<ProviderKeyGroupView[]> {
  const allNames = groups.flatMap((group) => group.keys.map((key) => key.name))
  const statuses = await listEnvKeyStatuses(allNames, envKeyOptions)
  const statusByName = new Map(statuses.map((status) => [status.name, status]))
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
    (provider) => provider.runtime_kind === 'cli' || provider.auth_mode === 'oauth_browser_login',
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
