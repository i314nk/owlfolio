import { fetchOpenRouterModels, isHarnessSelectableModel, type OpenRouterCatalogModel } from '@owlfolio/providers'

/**
 * Server-side cached loader for OpenRouter's live model catalog, used to populate the searchable model
 * picker. The list is large and changes slowly, so it is cached in-process with a TTL. FAIL-CLOSED: if the
 * fetch fails (offline, rate-limited, no network), it returns the last good list or an empty list, and the
 * picker falls back to the curated shortlist. The live models are NOT certified/qualified — the picker marks
 * them experimental.
 *
 * The returned set is filtered to models the harness can actually drive: REASONING models that also support
 * function tools + structured JSON output (see {@link isHarnessSelectableModel}). Non-reasoning models and
 * ones that cannot run the grounded loop are excluded so the picker never offers a model that would only fail.
 */

const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

let cache: { at: number; models: OpenRouterCatalogModel[] } | undefined

export type OpenRouterModelOptionsEnv = { OPENROUTER_API_KEY?: string; [key: string]: string | undefined }

export async function getOpenRouterModelOptions(
  env: OpenRouterModelOptionsEnv = process.env,
): Promise<OpenRouterCatalogModel[]> {
  const now = Date.now()
  if (cache !== undefined && now - cache.at < TTL_MS) {
    return cache.models
  }
  try {
    const models = (await fetchOpenRouterModels(
      env.OPENROUTER_API_KEY === undefined ? {} : { apiKey: env.OPENROUTER_API_KEY },
    )).filter(isHarnessSelectableModel)
    cache = { at: now, models }
    return models
  } catch {
    // Fail-closed: keep serving the last good list if we have one; otherwise empty → curated fallback.
    return cache?.models ?? []
  }
}

/** Test-only: reset the in-process cache. */
export function resetOpenRouterModelOptionsCache(): void {
  cache = undefined
}
