// Live OpenRouter model catalog. OpenRouter's value is "one API key routes to many models", so the model
// picker offers its full live list (https://openrouter.ai/api/v1/models — a public endpoint) in addition to
// the short curated/qualified shortlist. Live models are NOT certified/qualified; callers must surface them
// as experimental/fail-closed. This module only FETCHES + normalizes the list; it never decides trust.

export type OpenRouterCatalogModel = {
  id: string
  name: string
  context_length?: number
  /** Exposes a reasoning/thinking parameter (the owner quality bar for research). */
  reasoning: boolean
  /** Supports function/tool calling — REQUIRED for the harness's grounded gather loop (read_source etc.). */
  tools: boolean
  /** Supports strict structured JSON output (`response_format`/`structured_outputs`) — REQUIRED for synthesis. */
  structured_output: boolean
}

/**
 * A model the Owlfolio harness can actually drive: it reasons AND supports the two hard runtime requirements
 * (function tools for the grounded loop + structured JSON for synthesis). The OpenRouter picker is filtered
 * to this set — a reasoning model that cannot call tools or emit structured JSON would only ever fail a run.
 */
export function isHarnessSelectableModel(model: OpenRouterCatalogModel): boolean {
  return model.reasoning && model.tools && model.structured_output
}

export type FetchOpenRouterModelsOptions = {
  /** Optional OpenRouter key. The /models endpoint is public, but a key is sent when present. Never logged. */
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

type RawOpenRouterModel = { id?: unknown; name?: unknown; context_length?: unknown; supported_parameters?: unknown }

function supportsAny(params: Set<string>, keys: string[]): boolean {
  return keys.some((key) => params.has(key))
}

/**
 * Fetch OpenRouter's live model catalog. Returns a de-duplicated, id-sorted list. THROWS on
 * network/HTTP/parse failure so callers can fail-closed to the curated list. Never logs or echoes the key.
 */
export async function fetchOpenRouterModels(options: FetchOpenRouterModelsOptions = {}): Promise<OpenRouterCatalogModel[]> {
  const baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (options.apiKey !== undefined && options.apiKey.length > 0) {
      headers.Authorization = `Bearer ${options.apiKey}`
    }

    const response = await fetchImpl(`${baseUrl}/models`, { headers, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`OpenRouter model list request failed: HTTP ${response.status}`)
    }

    const body = await response.json() as { data?: RawOpenRouterModel[] }
    const seen = new Set<string>()
    const models: OpenRouterCatalogModel[] = []
    for (const entry of body.data ?? []) {
      if (typeof entry.id !== 'string' || entry.id.length === 0 || seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
      const params = new Set((Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []).filter((value): value is string => typeof value === 'string'))
      models.push({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
        ...(typeof entry.context_length === 'number' ? { context_length: entry.context_length } : {}),
        reasoning: params.has('reasoning'),
        tools: supportsAny(params, ['tools', 'tool_choice']),
        structured_output: supportsAny(params, ['structured_outputs', 'response_format']),
      })
    }
    models.sort((left, right) => left.id.localeCompare(right.id))
    return models
  } finally {
    clearTimeout(timeout)
  }
}
