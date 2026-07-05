import { curatedRealTierModelsForProvider } from '@owlfolio/providers'
import type { AppConfig, ProviderId } from '@owlfolio/shared'

import { getOnboardingProviderOptions } from './onboarding'
import { getProviderReadiness, type ProviderReadinessEnv } from './providerReadiness'
import { resolveModelIdForProvider } from './workflow'

/**
 * Inputs for the app-wide top-left ACTIVE MODEL SWITCHER. When more than one model is reachable across the
 * connected (ready) providers, the persistent workspace indicator becomes a grouped `<select>` — one
 * optgroup per connected provider, listing its curated models — so the user can switch the actively-used
 * model from anywhere without visiting the providers page. Selecting one persists via PUT
 * /api/onboarding/config (same write the guided picker uses).
 *
 * Honesty/discipline:
 *  - Only REAL, ready providers appear (readiness = key/login present). The demo `mock-provider` is never a
 *    research-model choice and is excluded.
 *  - Resolved server-side from the SAME sources as the rest of the app (catalog options + per-provider
 *    readiness + curated models); the client component only writes + refreshes.
 *  - Returns `undefined` (→ the plain indicator is shown instead) unless: mode is personal-local, the
 *    ACTIVE provider is itself connected, and there are ≥2 connected models to choose between. When the
 *    active provider is NOT connected, the indicator stays the clickable "fix" link, not a switcher.
 */

export type ModelSwitcherModel = { model_id: string }

export type ModelSwitcherProvider = {
  provider_id: ProviderId
  label: string
  support_level: AppConfig['provider']['support_level']
  models: ModelSwitcherModel[]
}

export type ModelSwitcher = {
  active_provider_id: ProviderId
  active_model_id: string
  providers: ModelSwitcherProvider[]
}

export async function resolveModelSwitcher(
  config: AppConfig,
  env: ProviderReadinessEnv = process.env as unknown as ProviderReadinessEnv,
): Promise<ModelSwitcher | undefined> {
  // The switcher is a personal-local affordance; demo/unconfigured fall back to the plain indicator.
  if (config.mode !== 'personal-local') {
    return undefined
  }

  const options = await getOnboardingProviderOptions({ env })

  const providers: ModelSwitcherProvider[] = []
  let totalModels = 0
  for (const option of options) {
    // The demo provider is not a research-model choice.
    if (option.provider_id === 'mock-provider') {
      continue
    }
    const readiness = await getProviderReadiness(option.provider_id, env)
    if (!readiness.is_ready) {
      continue
    }
    const models = curatedRealTierModelsForProvider(option.provider_id)
      .filter((model) => model.tier_suitability.length > 0)
      .map((model) => ({ model_id: model.model_id }))
    if (models.length === 0) {
      continue
    }
    providers.push({
      provider_id: option.provider_id,
      label: option.label,
      support_level: option.support_level,
      models,
    })
    totalModels += models.length
  }

  // The active provider must itself be connected — otherwise the indicator stays the "fix" link so the
  // user is sent to reconnect, rather than silently switching them onto a different provider.
  const activeModelId = resolveModelIdForProvider(config)
  const activeProvider = providers.find((provider) => provider.provider_id === config.provider.provider_id)
  if (activeProvider === undefined) {
    return undefined
  }
  // The active model may be a hand-picked id outside the curated list — surface it so the control always
  // shows a valid current value (prepended under its provider group).
  if (!activeProvider.models.some((model) => model.model_id === activeModelId)) {
    activeProvider.models = [{ model_id: activeModelId }, ...activeProvider.models]
    totalModels += 1
  }

  // Only worth showing when there is a real choice.
  if (totalModels < 2) {
    return undefined
  }

  return {
    active_provider_id: config.provider.provider_id,
    active_model_id: activeModelId,
    providers,
  }
}
