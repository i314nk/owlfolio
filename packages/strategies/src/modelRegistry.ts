// Versioned MODEL REGISTRY — the SINGLE place that maps swarm ROLES → { provider, model, temperature }.
//
// model-tiering-spec "Model Registry (config, one place)": the harness must invest well regardless of
// which model is plugged in — models are CONFIG, not code. Quality is verified by the harness defenses
// (schema validation + retry, citation verification, range/sanity checks), not assumed from a provider.
//
// "Swapping a model = one line. Never hardcode a model name in pipeline logic." The pipeline
// (researchSwarm) NEVER names a model — it asks {@link resolveModelForRole} for the role's provider/
// model/temperature. The DURABLE part of this file is the role set + the resolver; the specific model
// NAMES in the spec table (claude-opus-4-8, claude-sonnet-4-6, …) WILL go stale — so the defaults here
// pin NOTHING. Every role inherits the run's active provider/model (so today's single-provider
// Codex/mock runs are unchanged), and a per-role override (config or env) can swap any role onto a
// DIFFERENT provider/model — e.g. red_team or lane_moat on a second model to catch shared-narrative
// error (the dual-model cross-check the spec reserves for the highest-stakes classifications).
//
// Mirrors the versioned-config pattern of valuationParams.ts / judgmentRubrics.ts (a frozen typed
// object + a version field). Changing the registry is a deliberate, logged act — bump `version`.

/**
 * The swarm roles that resolve a model. Mapped to the spec's four tiers:
 *   T1 (frontier): synthesis, lane_moat, lane_shariah   — synthesis + the highest-stakes lanes
 *   T1/T2 (lanes): lanes_default                         — the remaining deep-dive lanes
 *   T2 (mid):      quick_screen, red_team                — kill/continue + adversarial cross-check
 *   T3 (cheap):    monitors, entity_resolve              — high-volume, low-judgment
 */
export const modelRoleIds = [
  'synthesis',
  'lanes_default',
  'lane_moat',
  'lane_shariah',
  'quick_screen',
  'red_team',
  'monitors',
  'entity_resolve',
  // model-tiering-spec "Dual-Model Cross-Check" (high-stakes classifications ONLY): an OPTIONAL second
  // model for the moat-class + Shariah-sector-status calls. OFF by default — both pin NOTHING, so they
  // INHERIT the run's active provider/model, which the cross-check treats as "no distinct second model
  // configured" → single run, unchanged. Configure (override/env) a DISTINCT provider/model on one of
  // these to trigger the cross-check for that classification. "Don't extend everywhere — it doubles cost."
  'lane_moat_crosscheck',
  'lane_shariah_crosscheck',
] as const
export type ModelRoleId = (typeof modelRoleIds)[number]

/**
 * A role's registry entry. `provider_id`/`model` are OPTIONAL by default: omitted = inherit the run's
 * active provider/model (the single-provider default path). Set them to PIN a role onto a specific
 * provider/model (e.g. run red_team on a different model than the lanes). `temperature` is always
 * defined and low (0–0.3 per the spec — re-run consistency, not creativity).
 */
export type ModelRoleEntry = {
  /** undefined = inherit the run's active provider (single-provider default). Set to override. */
  provider_id?: string
  /** undefined = inherit the run's active model. Set to override. */
  model?: string
  /** Sampling temperature — low (0–0.3) everywhere per the spec table. */
  temperature: number
}

export type ModelRegistry = {
  /** Monotonic version string. Bump on every change. */
  version: string
  roles: Record<ModelRoleId, ModelRoleEntry>
}

/**
 * The frozen DEFAULT registry. Defaults pin NO provider/model (every role inherits the run's active
 * provider/model — single-provider Codex/mock runs are unchanged). Only the low temperatures are set,
 * from the spec table:
 *   synthesis 0.1, lane_moat 0.1, lane_shariah 0.1 (highest-stakes classification — most deterministic)
 *   lanes_default 0.2, quick_screen 0.2, red_team 0.2
 *   monitors 0.1, entity_resolve 0.0 (entity/ticker resolution is near-deterministic)
 */
export const MODEL_REGISTRY: ModelRegistry = Object.freeze({
  version: 'model-registry-2026-06-1',
  roles: {
    synthesis: { temperature: 0.1 },
    lanes_default: { temperature: 0.2 },
    lane_moat: { temperature: 0.1 },
    lane_shariah: { temperature: 0.1 },
    quick_screen: { temperature: 0.2 },
    red_team: { temperature: 0.2 },
    monitors: { temperature: 0.1 },
    entity_resolve: { temperature: 0.0 },
    // Cross-check roles default to the SAME low temperature as their primary lanes and pin no
    // provider/model — so by default they resolve to the run's active model (i.e. NOT distinct) and the
    // cross-check stays OFF. An override that pins a DIFFERENT provider/model turns it on for that role.
    lane_moat_crosscheck: { temperature: 0.1 },
    lane_shariah_crosscheck: { temperature: 0.1 },
  },
}) as ModelRegistry

/** A resolved role: a concrete provider/model/temperature the pipeline can act on. */
export type ResolvedModelRole = {
  role: ModelRoleId
  provider_id: string
  model: string
  temperature: number
  /** true when a config/env override pinned a provider OR model away from the run defaults. */
  overridden: boolean
}

/** A per-role override supplied programmatically (config). Any field omitted falls through. */
export type ModelRoleOverride = {
  provider_id?: string
  model?: string
  temperature?: number
}

export type ResolveModelForRoleArgs = {
  /** The run's active provider — every role inherits this unless overridden. */
  fallbackProviderId: string
  /** The run's active model — every role inherits this unless overridden. */
  fallbackModel: string
  /** The registry to resolve against (defaults to {@link MODEL_REGISTRY}). */
  registry?: ModelRegistry
  /** Programmatic per-role overrides (config). Takes precedence over the registry defaults. */
  overrides?: Partial<Record<ModelRoleId, ModelRoleOverride>>
  /** Process env (injectable for tests). Reads OWLFOLIO_MODEL_ROLE_<ROLE>. */
  env?: Record<string, string | undefined>
}

/**
 * Parse an env override value of the form `provider:model@temp`, where provider/`:` and `@temp` are
 * optional, e.g. `openai:codex-pro@0.1`, `openai:codex-pro`, `codex-mini`, `@0.0`. Returns only the
 * fields that were specified (so unspecified fields inherit the fallback / registry).
 */
function parseEnvOverride(raw: string): ModelRoleOverride {
  const out: ModelRoleOverride = {}
  let rest = raw.trim()
  const atIndex = rest.lastIndexOf('@')
  if (atIndex >= 0) {
    const tempStr = rest.slice(atIndex + 1).trim()
    const t = Number(tempStr)
    if (Number.isFinite(t)) out.temperature = t
    rest = rest.slice(0, atIndex).trim()
  }
  if (rest.length > 0) {
    const colonIndex = rest.indexOf(':')
    if (colonIndex >= 0) {
      const provider = rest.slice(0, colonIndex).trim()
      const model = rest.slice(colonIndex + 1).trim()
      if (provider.length > 0) out.provider_id = provider
      if (model.length > 0) out.model = model
    } else {
      // No colon: the whole token is the model name (inherit the provider).
      out.model = rest
    }
  }
  return out
}

/**
 * Resolve the concrete provider/model/temperature for a swarm role.
 *
 * Precedence (highest first):
 *   1. env  OWLFOLIO_MODEL_ROLE_<ROLE> (e.g. OWLFOLIO_MODEL_ROLE_RED_TEAM=openai:codex@0.0)
 *   2. programmatic `overrides[role]`
 *   3. registry role entry (provider/model only if the registry pins them — defaults pin none)
 *   4. the run's active fallbackProviderId / fallbackModel (the single-provider default path)
 * Temperature always comes from the override → registry (never the fallback): the registry owns the
 * low-temperature discipline.
 *
 * No hardcoded model string in pipeline logic — the pipeline calls THIS.
 */
export function resolveModelForRole(role: ModelRoleId, args: ResolveModelForRoleArgs): ResolvedModelRole {
  const registry = args.registry ?? MODEL_REGISTRY
  const entry = registry.roles[role]
  const programmatic = args.overrides?.[role]
  const envRaw = args.env?.[`OWLFOLIO_MODEL_ROLE_${role.toUpperCase()}`]
  const envOverride = envRaw !== undefined && envRaw.trim().length > 0 ? parseEnvOverride(envRaw) : undefined

  const provider_id =
    envOverride?.provider_id ?? programmatic?.provider_id ?? entry.provider_id ?? args.fallbackProviderId
  const model = envOverride?.model ?? programmatic?.model ?? entry.model ?? args.fallbackModel
  const temperature = envOverride?.temperature ?? programmatic?.temperature ?? entry.temperature

  // "overridden" means a provider OR model was pinned away from the run defaults (a different model/
  // provider than the active run). A temperature-only override does not count — it stays in-band.
  const overridden = provider_id !== args.fallbackProviderId || model !== args.fallbackModel

  return { role, provider_id, model, temperature, overridden }
}
