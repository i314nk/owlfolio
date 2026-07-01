import { getProviderCatalog, curatedRealTierModelsForProvider } from '@owlfolio/providers'
import type { ProviderId } from '@owlfolio/shared'
import { modelRoleIds, resolveModelForRole, type ModelRoleId } from '@owlfolio/strategies/modelRegistry'
import { isModelQualified } from '@owlfolio/workflow/modelQualification'

import {
  isEnvKeyPathGitIgnored,
  listEnvKeyStatuses,
  readAllEnvKeys,
  resolveEnvKeyFilePath,
  type EnvKeyOptions,
} from './envKeys'
import { modelRoleEnvKeyForRole, readModelRoleOverridesFromEnvFile } from './modelRoleEnv'
import { MODEL_REGISTRY } from '@owlfolio/strategies/modelRegistry'
import { evaluateOnboardingGate } from './onboardingGate'
import {
  LLM_API_KEY_GROUPS,
  llmRegistrySelectability,
  oauthLoginExpiryView,
  type LlmKeyGroup,
} from './providerKeys'
import { resolveProviderCertificationReportDir } from './providerStatus'
import { getProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import type {
  ProviderKeyGroupView,
  ProviderKeyView,
  ProviderKeysPanelProps,
  ProviderLoginRow,
  ProviderRoleConfigView,
  TierConfigRow,
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
  'Pick one model per tier. Each tier lists the models that fit it for the provider you choose (for OpenRouter, the vendor models that fit the tier). Your choice applies to every swarm role in that tier; Clear restores the default-inherit (the run’s provider/model). Selections live in the local env file (~/.owlfolio/.env) as OWLFOLIO_MODEL_ROLE_<ROLE> entries — swap them anytime.',
  'Qualification note: a provider should pass the golden-set qualification before you rely on it for production research. A tier pointed at a provider with no connected credentials runs fail-closed.',
]

const TIER_DESCRIPTION: Record<'T1' | 'T2' | 'T3', string> = {
  T1: 'Frontier — synthesis and the moat/Shariah classification lanes. The highest-stakes reasoning.',
  T2: 'Mid — the quick screen (kill/continue) and the adversarial red-team cross-check.',
  T3: 'Cheap / local — high-volume monitors and near-deterministic entity/ticker resolution.',
}

const TIER_ORDER: ReadonlyArray<'T1' | 'T2' | 'T3'> = ['T1', 'T2', 'T3']

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
  const llmGroups = await buildKeyGroupViews(LLM_API_KEY_GROUPS, envKeyOptions, true)

  // Section B: per-tier model configuration (replaces the old read-only summary).
  const roleConfig = await buildProviderRoleConfigView({
    activeProviderId: args.activeProviderId,
    activeModel: args.activeModel,
    envKeyOptions,
    processEnv: effectiveEnv,
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
  })

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

  return { envFile, onboardingGate, loginRows, llmGroups, roleConfig }
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
  // Readiness/qualification for each catalog provider that can run a research draft — used only to mark a
  // tier's RESOLVED provider connected/qualified (the badge), never to offer a per-tier provider picker.
  const statusByProvider = new Map<string, { connected: boolean; qualified: boolean }>()
  await Promise.all(
    getProviderCatalog()
      .filter((provider) => provider.workflow_roles.includes('research_draft'))
      .map(async (provider) => {
        const readiness = await getProviderReadiness(provider.provider_id, args.processEnv)
        const qualified = await isModelQualified(provider.provider_id, { dir: qualificationDir })
        statusByProvider.set(provider.provider_id, {
          connected: readiness.is_ready,
          qualified: qualified.has_report && qualified.qualified,
        })
      }),
  )

  // The PRIMARY provider drives the per-tier model menus: each tier offers ONLY that provider's curated
  // models that fit the tier (for OpenRouter, the vendor models that fit). No per-tier provider picker.
  const activeProvider = getProviderCatalog().find((provider) => provider.provider_id === args.activeProviderId)
  const activeProviderLabel = activeProvider?.label ?? args.activeProviderId
  const activeModels = curatedRealTierModelsForProvider(args.activeProviderId)

  // One row per TIER (T1/T2/T3). All roles in a tier are set together, so a representative role (the
  // first mapped to the tier) carries the resolved provider/model/source the row displays + prefills.
  const tiers: TierConfigRow[] = TIER_ORDER.map((tier) => {
    const tierRoles = modelRoleIds.filter((role) => MODEL_ROLE_TIER_INFO[role].tier === tier)
    const representative = tierRoles[0] ?? modelRoleIds[0]!
    const resolved = resolveModelForRole(representative, {
      fallbackProviderId: args.activeProviderId,
      fallbackModel: args.activeModel,
      env: mergedEnv,
    })
    const envKeyName = modelRoleEnvKeyForRole(representative)
    // SOURCE: a key present in the env FILE wins (the selector wrote it); else a process-env value; else
    // the registry default (which inherits the run's provider/model).
    const source: TierConfigRow['source'] = fileOverrides[envKeyName] !== undefined
      ? 'file'
      : args.processEnv[envKeyName] !== undefined
        ? 'env'
        : 'default'
    const resolvedStatus = statusByProvider.get(resolved.provider_id)
    return {
      tier,
      description: TIER_DESCRIPTION[tier],
      roles: tierRoles,
      resolved_provider_id: resolved.provider_id,
      resolved_model: resolved.model,
      resolved_temperature: resolved.temperature,
      source,
      target_provider_connected: resolvedStatus?.connected ?? false,
      target_provider_qualified: resolvedStatus?.qualified ?? false,
      // The PRIMARY provider's curated models that fit this tier — the dropdown options.
      model_options: activeModels
        .filter((model) => model.tier_suitability.includes(tier))
        .map((model) => ({ model_id: model.model_id, note: model.note })),
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
    active_provider_id: args.activeProviderId,
    active_provider_label: activeProviderLabel,
    tiers,
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
