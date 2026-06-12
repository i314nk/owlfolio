// The web run-path adapter that turns CONNECTED + QUALIFIED providers into the AUTO model-role override
// layer (the deterministic default beneath user pins). This is the injectable hook the run paths thread
// the same way `model_role_env` (pins) are threaded — except auto is `model_overrides` (the registry's
// overrides map), which the resolver ranks BELOW the env pins, so pins always win and auto only fills
// unpinned roles.
//
// Mock-provider is excluded from real-tier suggestions (its curated entry is demo-only), so an env with
// only the built-in demo connected derives an empty override map (single real provider → inherit).

import { curatedRealTierModelsForProvider, getProviderCatalog } from '@owlfolio/providers'
import {
  autoTierAssignmentToRoleOverrides,
  deriveAutoTierAssignment,
  type AutoTierConnectedProvider,
  type AutoTierCuratedModel,
} from '@owlfolio/strategies/autoTierAssignment'
import type { ModelRoleId, ModelRoleOverride } from '@owlfolio/strategies/modelRegistry'
import { isModelQualified } from '@owlfolio/workflow/modelQualification'

import { getProviderReadiness, type ProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'

export type BuildAutoModelRoleOverridesArgs = {
  processEnv: ProviderReadinessEnv & Record<string, string | undefined>
  /** The provider-qualification report dir (defaults from env/project root inside isModelQualified). */
  qualificationDir?: string
  /** Injectable readiness fn (defaults to the real getProviderReadiness) — lets tests control connectivity. */
  getReadiness?: (providerId: string, env: ProviderReadinessEnv) => Promise<Pick<ProviderReadiness, 'is_ready'>>
}

export type AutoModelRoleOverridesResult = {
  overrides: Partial<Record<ModelRoleId, ModelRoleOverride>>
  warnings: string[]
}

/** True when we must NOT spawn readiness probes: playwright e2e mode and vitest unit runs. */
function isOfflineTierMode(env: Record<string, string | undefined>): boolean {
  return env['OWLFOLIO_TEST_MODE'] === 'playwright' || env['VITEST'] !== undefined || process.env['VITEST'] !== undefined
}

/** The catalog lookup injected into the deriver — only the curated REAL-tier reasoning models. */
function modelCatalogLookup(providerId: string): AutoTierCuratedModel[] {
  return curatedRealTierModelsForProvider(providerId).map((model) => ({
    model_id: model.model_id,
    reasoning: model.reasoning,
    tier_suitability: model.tier_suitability,
  }))
}

/**
 * Compute the auto model-role overrides for the current environment. A provider is a candidate when it
 * (a) has curated real-tier reasoning models AND (b) is locally connected (credentials present). Its
 * golden-set qualification is read fail-closed (no report → not qualified → never auto-T1).
 */
export async function buildAutoModelRoleOverrides(
  args: BuildAutoModelRoleOverridesArgs,
): Promise<AutoModelRoleOverridesResult> {
  // In offline/test mode (playwright e2e, vitest), skip the readiness probes (which may spawn CLI
  // checks) and return NO auto overrides — every role inherits the run default, preserving the
  // deterministic single-provider behavior the tests assert. Real runs still derive auto defaults.
  // A caller may force the derivation by injecting `getReadiness` (tests that exercise auto explicitly).
  if (args.getReadiness === undefined && isOfflineTierMode(args.processEnv)) {
    return { overrides: {}, warnings: [] }
  }

  const candidates = getProviderCatalog().filter((provider) => modelCatalogLookup(provider.provider_id).length > 0)
  const readinessFn = args.getReadiness ?? getProviderReadiness

  const connectedProviders: AutoTierConnectedProvider[] = []
  for (const provider of candidates) {
    const readiness = await readinessFn(provider.provider_id, args.processEnv)
    if (!readiness.is_ready) continue
    const qualified = await isModelQualified(provider.provider_id, {
      ...(args.qualificationDir === undefined ? {} : { dir: args.qualificationDir }),
      env: args.processEnv,
    })
    connectedProviders.push({ provider_id: provider.provider_id, qualified: qualified.has_report && qualified.qualified })
  }

  const derived = deriveAutoTierAssignment({ connectedProviders, modelCatalogLookup })
  return { overrides: autoTierAssignmentToRoleOverrides(derived.assignments), warnings: derived.warnings }
}
