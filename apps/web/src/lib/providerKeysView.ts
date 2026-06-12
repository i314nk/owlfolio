import { getProviderCatalog, curatedRealTierModelsForProvider } from '@owlfolio/providers'
import { modelRoleIds, resolveModelForRole, type ModelRoleId } from '@owlfolio/strategies/modelRegistry'
import { isModelQualified } from '@owlfolio/workflow/modelQualification'

import {
  isEnvKeyPathGitIgnored,
  listEnvKeyStatuses,
  resolveEnvKeyFilePath,
  type EnvKeyOptions,
} from './envKeys'
import { modelRoleEnvKeyForRole, readModelRoleOverridesFromEnvFile } from './modelRoleEnv'
import { MODEL_REGISTRY } from '@owlfolio/strategies/modelRegistry'
import { evaluateOnboardingGate } from './onboardingGate'
import {
  LLM_API_KEY_GROUPS,
  TOOL_DATA_KEY_GROUPS,
  llmRegistrySelectability,
  oauthLoginExpiryView,
  type LlmKeyGroup,
} from './providerKeys'
import { buildProviderStatusRows, resolveProviderCertificationReportDir } from './providerStatus'
import { getProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import type {
  ProviderKeyGroupView,
  ProviderKeyView,
  ProviderKeysPanelProps,
  ProviderLoginRow,
  ProviderRoleConfigView,
  RoleConfigProviderOption,
  RoleConfigRow,
} from '../components/ProviderKeysPanel'

// Each registry role's tier + a one-line "what this role does" (the spec's tier table, condensed). Kept
// here (next to the role-config builder that consumes it) so the panel renders honest per-role guidance.
const MODEL_ROLE_TIER_INFO: Record<ModelRoleId, { tier: 'T1' | 'T2' | 'T3'; description: string }> = {
  synthesis: { tier: 'T1', description: 'Frontier synthesis — long-context reasoning + disciplined citation; errors here poison verdicts.' },
  lane_moat: { tier: 'T1', description: 'Frontier — moat classification is the highest-stakes call.' },
  lane_shariah: { tier: 'T1', description: 'Frontier — Shariah sector status is a hard-stop classification.' },
  lanes_default: { tier: 'T1', description: 'Deep-dive lanes — source-backed specialist findings.' },
  quick_screen: { tier: 'T2', description: 'Mid — kill/continue over one report; a wrong continue dies in deep dive.' },
  red_team: { tier: 'T2', description: 'Mid — adversarial cross-check; a different model catches shared-narrative error.' },
  monitors: { tier: 'T3', description: 'Cheap/local — high-volume daily scanning, low judgment.' },
  entity_resolve: { tier: 'T3', description: 'Cheap/local — near-deterministic entity/ticker resolution (temp 0).' },
  lane_moat_crosscheck: { tier: 'T1', description: 'Frontier cross-check (off by default) — a second model re-classifies the moat.' },
  lane_shariah_crosscheck: { tier: 'T1', description: 'Frontier cross-check (off by default) — a second model re-classifies the Shariah sector.' },
}

const ROLE_CONFIG_GUIDANCE: string[] = [
  'Tier philosophy: T1 (frontier) runs synthesis and the moat/Shariah lanes; T2 (mid) runs the quick screen and red team; T3 (cheap/local) runs the monitors and entity resolution. T0 work (valuation math, ratio checks, accounting) is deterministic code — never a model.',
  'Defaults inherit the run’s provider/model. Override any role here to pin it onto a different provider/model. Overrides live in the local env file (~/.owlfolio/.env) as OWLFOLIO_MODEL_ROLE_<ROLE> entries — models are config, swap them anytime; Clear restores the default-inherit.',
  'Qualification note: a provider should pass the golden-set qualification before you rely on it for production research. A role pointed at a provider with no connected credentials runs fail-closed.',
]

export type BuildProviderKeysPanelArgs = {
  ledgerPath: string | undefined
  envKeyOptions?: EnvKeyOptions
  repoRoot: string
  processEnv?: ProviderReadinessEnv & Record<string, string | undefined>
  activeProviderId: string
  activeModel: string
  /** cwd used to locate the provider-qualification report dir (defaults to process.cwd()). */
  cwd?: string
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

  // Section B: per-tier model configuration (replaces the old read-only summary).
  const roleConfig = await buildProviderRoleConfigView({
    activeProviderId: args.activeProviderId,
    activeModel: args.activeModel,
    envKeyOptions,
    processEnv,
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
  })

  // Section A: provider login rows (OAuth / CLI / subscription).
  const loginRows = await buildLoginRows(processEnv)

  // The onboarding gate (composes ledger + env-key signals).
  const onboardingGate = await evaluateOnboardingGate({
    ledgerPath: args.ledgerPath,
    envKeyOptions,
    processEnv,
  })

  // Trust & certification rows (folded in from the retired /providers page) — fail-closed honest.
  const trustRows = await buildProviderStatusRows({
    env: processEnv,
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
  })

  return { envFile, onboardingGate, loginRows, llmGroups, toolGroups, roleConfig, trustRows }
}

/**
 * Build the per-tier model-configuration view (Section B): for each registry role, its tier + what it
 * does, its CURRENT resolution (provider/model/temp) and the SOURCE of that resolution (file override /
 * process env / default-inherit), plus an honest connected/qualified marker for the role's target
 * provider. Defaults inherit the run's provider/model; a file override (the selector writes one) wins.
 */
export async function buildProviderRoleConfigView(args: {
  activeProviderId: string
  activeModel: string
  envKeyOptions: EnvKeyOptions
  processEnv: ProviderReadinessEnv & Record<string, string | undefined>
  cwd?: string
}): Promise<ProviderRoleConfigView> {
  // The env the run paths actually resolve against: the env FILE's role overrides merged over process.env.
  const fileOverrides = await readModelRoleOverridesFromEnvFile(args.envKeyOptions)
  const mergedEnv: Record<string, string | undefined> = { ...args.processEnv, ...fileOverrides }

  // The catalog providers a role can target — honestly marked connected (credentials present) and
  // qualified (golden-set). Reuses the same readiness/qualification data the rest of the page trusts.
  const qualificationDir = resolveProviderCertificationReportDir({
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    env: args.processEnv,
  })
  const providers: RoleConfigProviderOption[] = await Promise.all(
    getProviderCatalog()
      .filter((provider) => provider.workflow_roles.includes('research_draft'))
      .map(async (provider) => {
        const readiness = await getProviderReadiness(provider.provider_id, args.processEnv)
        const qualified = await isModelQualified(provider.provider_id, { dir: qualificationDir })
        return {
          provider_id: provider.provider_id,
          label: provider.label,
          is_connected: readiness.is_ready,
          is_qualified: qualified.has_report && qualified.qualified,
          // Curated REASONING models only (reasoning-only by construction) feed the role selectors.
          curated_models: curatedRealTierModelsForProvider(provider.provider_id).map((model) => ({
            model_id: model.model_id,
            tier_suitability: model.tier_suitability,
            note: model.note,
          })),
        }
      }),
  )
  const connectedById = new Map(providers.map((p) => [p.provider_id, p.is_connected]))
  const qualifiedById = new Map(providers.map((p) => [p.provider_id, p.is_qualified]))

  const roles: RoleConfigRow[] = modelRoleIds.map((role) => {
    const resolved = resolveModelForRole(role, {
      fallbackProviderId: args.activeProviderId,
      fallbackModel: args.activeModel,
      env: mergedEnv,
    })
    const envKeyName = modelRoleEnvKeyForRole(role)
    // SOURCE: a key present in the env FILE wins (the selector wrote it); else a process-env value; else
    // the registry default (which inherits the run's provider/model).
    const source: RoleConfigRow['source'] = fileOverrides[envKeyName] !== undefined
      ? 'file'
      : args.processEnv[envKeyName] !== undefined
        ? 'env'
        : 'default'
    const info = MODEL_ROLE_TIER_INFO[role]
    return {
      role,
      tier: info.tier,
      description: info.description,
      resolved_provider_id: resolved.provider_id,
      resolved_model: resolved.model,
      resolved_temperature: resolved.temperature,
      overridden: resolved.overridden,
      source,
      target_provider_connected: connectedById.get(resolved.provider_id) ?? false,
      target_provider_qualified: qualifiedById.get(resolved.provider_id) ?? false,
      // The current value (so the selector can prefill); never a secret — it's a provider:model@temp string.
      ...(mergedEnv[envKeyName] === undefined ? {} : { current_value: mergedEnv[envKeyName] }),
    }
  })

  return {
    registry_version: MODEL_REGISTRY.version,
    guidance: ROLE_CONFIG_GUIDANCE,
    no_model_note:
      'T0 — No model, ever: valuation math, Shariah ratio verification, purification arithmetic, accounting, '
      + 'scheduling, 13F/EDGAR parsing, and Magic Formula ranking are deterministic by constitution (pure code).',
    providers,
    roles,
  }
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
