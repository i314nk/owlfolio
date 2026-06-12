// HYBRID tiering — the AUTO-DEFAULT layer beneath user pins.
//
// model-tiering-spec: tier assignment is hybrid. A user PIN (an `OWLFOLIO_MODEL_ROLE_<ROLE>` env-file
// override) always wins in the resolver. BENEATH that pin sits a deterministic AUTO default derived from
// the providers a user has actually CONNECTED + QUALIFIED. This module computes that auto layer.
//
// `deriveAutoTierAssignment` is PURE and DETERMINISTIC: given the connected providers, their golden-set
// qualification, and a curated reasoning-model catalog lookup, it maps each swarm role to a concrete
// provider/model:
//   - best QUALIFIED frontier reasoning model  -> T1 roles
//   - a mid reasoning model                    -> T2 roles
//   - the cheapest connected reasoning model   -> T3 roles
//   - exactly ONE connected provider           -> emit NOTHING (every role inherits the run default —
//                                                 today's single-provider behavior, unchanged)
//
// HARD RULE: NEVER auto-assign an UNQUALIFIED provider to a T1 role. If no qualified frontier provider is
// connected, T1 roles are LEFT UNASSIGNED (they fall back to inherit) and a warning is emitted
// ("connect/qualify a frontier provider").
//
// The catalog is INJECTED (a lookup fn) so `strategies` keeps no dependency on `providers`. The selection
// is intentionally simple and ordering-stable so the same connections always derive the same assignment.

import { modelRoleIds, MODEL_ROLE_TIER, type ModelRoleId, type ModelRoleOverride, type ModelRoleTier } from './modelRegistry'

/** A provider the user has connected, with its golden-set qualification verdict. */
export type AutoTierConnectedProvider = {
  provider_id: string
  /** true when the provider passed golden-set qualification (verified, never assumed). */
  qualified: boolean
}

/** A curated reasoning model (the subset of the providers `CuratedModel` shape this module needs). */
export type AutoTierCuratedModel = {
  model_id: string
  reasoning: true
  tier_suitability: ModelRoleTier[]
}

/** One auto-derived role default: a concrete provider/model the run path uses when no pin overrides it. */
export type AutoTierRoleAssignment = {
  provider_id: string
  model: string
  /** Which tier this assignment was drawn for (for honest UI display). */
  tier: ModelRoleTier
}

export type DeriveAutoTierArgs = {
  connectedProviders: AutoTierConnectedProvider[]
  /** Returns the curated reasoning models for a provider (empty if none). Injected — no providers dep. */
  modelCatalogLookup: (providerId: string) => AutoTierCuratedModel[]
}

export type AutoTierAssignmentResult = {
  /** Per-role auto defaults. ABSENT roles inherit the run's provider/model (the default layer below). */
  assignments: Partial<Record<ModelRoleId, AutoTierRoleAssignment>>
  /** Honest, deterministic warnings (e.g. no qualified frontier provider → T1 left to inherit). */
  warnings: string[]
}

/** A connected provider's curated model that suits a given tier (with the provider id attached). */
type TierCandidate = {
  provider_id: string
  model_id: string
  qualified: boolean
}

/** Tier rank for "cheapest" ordering — T3 is the cheap tier, T1 the most capable/expensive. */
const TIER_RANK: Record<ModelRoleTier, number> = { T1: 3, T2: 2, T3: 1 }

/**
 * Candidates that suit `tier`, sorted deterministically: qualified first, then by capability (a model
 * whose HIGHEST suitable tier is more capable ranks higher for T1; for T3 we sort the opposite way to
 * prefer the genuinely cheap model). Ordering within equal keys falls back to the connected-provider
 * order then the model id for stability.
 */
function candidatesForTier(
  tier: ModelRoleTier,
  connectedProviders: AutoTierConnectedProvider[],
  modelCatalogLookup: (providerId: string) => AutoTierCuratedModel[],
): TierCandidate[] {
  const candidates: Array<TierCandidate & { topTier: number; order: number }> = []
  connectedProviders.forEach((provider, order) => {
    for (const model of modelCatalogLookup(provider.provider_id)) {
      if (!model.tier_suitability.includes(tier)) continue
      const topTier = Math.max(...model.tier_suitability.map((t) => TIER_RANK[t]))
      candidates.push({ provider_id: provider.provider_id, model_id: model.model_id, qualified: provider.qualified, topTier, order })
    }
  })

  const preferCheap = tier === 'T3'
  candidates.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1
    if (a.topTier !== b.topTier) return preferCheap ? a.topTier - b.topTier : b.topTier - a.topTier
    if (a.order !== b.order) return a.order - b.order
    return a.model_id.localeCompare(b.model_id)
  })

  return candidates.map(({ provider_id, model_id, qualified }) => ({ provider_id, model_id, qualified }))
}

/**
 * Derive the deterministic auto-default tier assignment. See the module header for the rule. Pins are NOT
 * an input here — they win in the resolver above this layer; auto only ever FILLS roles, never overrides.
 */
export function deriveAutoTierAssignment(args: DeriveAutoTierArgs): AutoTierAssignmentResult {
  const { connectedProviders, modelCatalogLookup } = args
  const warnings: string[] = []
  const assignments: Partial<Record<ModelRoleId, AutoTierRoleAssignment>> = {}

  if (connectedProviders.length === 0) {
    warnings.push('No connected provider — every role inherits the run default. Connect a reasoning provider to enable auto-tiering.')
    return { assignments, warnings }
  }

  // Best QUALIFIED frontier (T1) candidate. NEVER an unqualified provider for T1.
  const t1Candidates = candidatesForTier('T1', connectedProviders, modelCatalogLookup)
  const t1Best = t1Candidates.find((candidate) => candidate.qualified)
  if (t1Best === undefined) {
    warnings.push('No connected, golden-set-qualified frontier provider — T1 roles inherit the run default. Connect/qualify a frontier provider to auto-assign T1.')
  }

  // ONE connected provider → inherit everything (today's single-provider behavior). Emit no per-role pins
  // (the qualified-frontier warning above still stands so an unqualified sole provider is flagged honestly).
  if (connectedProviders.length === 1) {
    return { assignments, warnings }
  }

  // Mid (T2) — prefer qualified, but a qualified-frontier gate does NOT apply here.
  const t2Candidates = candidatesForTier('T2', connectedProviders, modelCatalogLookup)
  const t2Best = t2Candidates[0]

  // Cheapest connected reasoning model for T3.
  const t3Candidates = candidatesForTier('T3', connectedProviders, modelCatalogLookup)
  const t3Best = t3Candidates[0]

  const pick: Record<ModelRoleTier, TierCandidate | undefined> = {
    T1: t1Best,
    T2: t2Best ?? t1Best,
    T3: t3Best ?? t2Best ?? t1Best,
  }

  for (const role of modelRoleIds) {
    const tier = MODEL_ROLE_TIER[role]
    const candidate = pick[tier]
    if (candidate === undefined) continue
    assignments[role] = { provider_id: candidate.provider_id, model: candidate.model_id, tier }
  }

  return { assignments, warnings }
}

/**
 * Adapt an auto-tier assignment into the registry's per-role `overrides` map — the DEFAULT layer the run
 * paths feed to `resolveModelForRole`. Precedence in the resolver is `env(pin) > overrides(auto) > registry
 * default > run fallback`, so a user PIN (an `OWLFOLIO_MODEL_ROLE_*` env entry) ALWAYS wins over the auto
 * default, and auto only FILLS roles that have no pin. Temperature is intentionally omitted — the registry
 * owns the low-temperature discipline.
 */
export function autoTierAssignmentToRoleOverrides(
  assignments: Partial<Record<ModelRoleId, AutoTierRoleAssignment>>,
): Partial<Record<ModelRoleId, ModelRoleOverride>> {
  const overrides: Partial<Record<ModelRoleId, ModelRoleOverride>> = {}
  for (const role of modelRoleIds) {
    const assignment = assignments[role]
    if (assignment === undefined) continue
    overrides[role] = { provider_id: assignment.provider_id, model: assignment.model }
  }
  return overrides
}
