
/**
 * Catalogs + pure logic for the `/settings/providers` keys page (Sections B/C),
 * the model-registry tier summary, the OAuth expiry view (Section A), and the
 * onboarding gate. No secrets ever appear here — only key NAMES, descriptions,
 * and presence booleans.
 */

// ── Section B — LLM API key groups (collapsible, one per provider) ────────────

export type EnvKeyEntry = {
  name: string
  description: string
  /** Hidden behind a "Show Advanced" toggle when true. */
  advanced?: boolean
}

export type LlmKeyGroup = {
  /** Stable id used to map a key presence → registry selectability. */
  id: string
  label: string
  /** Deep link to the provider's key page (Get key ↗). */
  get_key_url: string
  keys: EnvKeyEntry[]
}

// PROVIDER CONSOLIDATION (owner, 2026-07-18): OpenRouter is the one real provider; 'local'
// (Ollama / vLLM) is the experimental UNTESTED surface. The direct Anthropic/OpenAI/Gemini API-key
// groups were removed with their providers. Each group's id is recorded as the provider_connected
// `provider_id` (via llmGroupIdForEnvKey) and is part of the frontier-LLM gate set.
export const LLM_API_KEY_GROUPS: LlmKeyGroup[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    get_key_url: 'https://openrouter.ai/keys',
    keys: [{ name: 'OPENROUTER_API_KEY', description: 'OpenRouter meta-aggregator key — the single API key that routes to every curated model (per-routed-model certification still required).' }],
  },
  {
    id: 'local',
    label: 'Local (Ollama / vLLM) — experimental, untested',
    get_key_url: 'https://ollama.com/download',
    keys: [
      { name: 'OWLFOLIO_LOCAL_API_BASE_URL', description: 'UNSTABLE / EXPERIMENTAL / UNTESTED: base URL of the local OpenAI-compatible endpoint you run yourself (defaults to Ollama http://127.0.0.1:11434/v1).', advanced: true },
      { name: 'OWLFOLIO_LOCAL_API_KEY', description: 'Optional API key for the local endpoint (most local servers need none).', advanced: true },
    ],
  },
]

// ── Section C — Tool & data key groups ────────────────────────────────────────

export const TOOL_DATA_KEY_GROUPS: LlmKeyGroup[] = [
  {
    id: 'market-data',
    label: 'Market data',
    get_key_url: 'https://www.alphavantage.co/support/#api-key',
    keys: [{ name: 'OWLFOLIO_MARKET_DATA_API_KEY', description: 'Market-data provider API key for quotes and price history.' }],
  },
  {
    id: 'edgar',
    label: 'SEC EDGAR',
    get_key_url: 'https://www.sec.gov/os/webmaster-faq#developers',
    keys: [{ name: 'OWLFOLIO_EDGAR_USER_AGENT', description: 'Required SEC EDGAR User-Agent string (e.g. "Owlfolio you@example.com").' }],
  },
  {
    id: 'corporate-actions',
    label: 'Corporate actions',
    get_key_url: 'https://owlfolio.local/docs/corporate-actions',
    keys: [{ name: 'OWLFOLIO_CORPORATE_ACTIONS_API_KEY', description: 'Corporate-actions feed key (splits, dividends, symbol changes).', advanced: true }],
  },
  {
    id: 'search-scrape',
    label: 'Search / scrape',
    get_key_url: 'https://owlfolio.local/docs/search',
    keys: [
      { name: 'OWLFOLIO_SEARCH_API_KEY', description: 'Web-search API key for grounding research lanes.', advanced: true },
      { name: 'OWLFOLIO_SCRAPE_API_KEY', description: 'Page-fetch/scrape API key for source capture.', advanced: true },
    ],
  },
]

/** Every env var name the page manages — the set passed to {@link listEnvKeyStatuses}. */
export function allManagedEnvKeyNames(): string[] {
  return [...LLM_API_KEY_GROUPS, ...TOOL_DATA_KEY_GROUPS].flatMap((group) => group.keys.map((key) => key.name))
}

/** The env var that, when set, satisfies the onboarding "market-data key" item. */
export const MARKET_DATA_ENV_KEY = 'OWLFOLIO_MARKET_DATA_API_KEY'

/**
 * Map an env key NAME to its LLM provider group id, when it belongs to one. Used
 * by the credentials route to record a `provider_connected` event for LLM keys
 * (never for tool/data keys). Returns undefined for non-LLM keys.
 */
export function llmGroupIdForEnvKey(name: string): string | undefined {
  for (const group of LLM_API_KEY_GROUPS) {
    if (group.keys.some((key) => key.name === name)) {
      return group.id
    }
  }
  return undefined
}

/**
 * Map "is this group's primary key set?" → registry selectability per provider id.
 * Acceptance test 2: once a provider has a valid key it becomes selectable in the registry.
 */
export function llmRegistrySelectability(setKeys: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const group of LLM_API_KEY_GROUPS) {
    out[group.id] = group.keys.some((key) => setKeys[key.name] === true)
  }
  return out
}

// ── Section B header — the model-registry tier-assignment summary ─────────────

// (The tier-assignment summary was removed with model tiering — owner, 2026-07-18.)

// ── Section A — OAuth login expiry view (acceptance test 5) ────────────────────

export type OauthLoginExpiryInput = {
  expires_at?: string
  reauth_command: string
}

export type OauthLoginExpiryView = {
  is_expired: boolean
  countdown_label: string
  reauth_command: string
}

/** Compute the expiry countdown + re-auth command for a Section A login row. */
export function oauthLoginExpiryView(input: OauthLoginExpiryInput, now: Date = new Date()): OauthLoginExpiryView {
  if (input.expires_at === undefined || input.expires_at.length === 0) {
    return { is_expired: false, countdown_label: 'No expiry reported', reauth_command: input.reauth_command }
  }

  const expiresMs = new Date(input.expires_at).getTime()
  const remainingMs = expiresMs - now.getTime()
  if (!Number.isFinite(expiresMs)) {
    return { is_expired: false, countdown_label: 'No expiry reported', reauth_command: input.reauth_command }
  }

  if (remainingMs <= 0) {
    return { is_expired: true, countdown_label: 'Expired (0h)', reauth_command: input.reauth_command }
  }

  const hours = Math.floor(remainingMs / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  const countdown_label = days >= 1 ? `Expires in ${days}d ${hours % 24}h` : `Expires in ${hours}h`
  return { is_expired: false, countdown_label, reauth_command: input.reauth_command }
}

// ── Onboarding gate (acceptance test 1) ───────────────────────────────────────

export type OnboardingGateInputs = {
  has_frontier_llm_connected: boolean
}

export type OnboardingGateItem = {
  id: 'frontier_llm' | 'investable_capital'
  label: string
  done: boolean
}

export type OnboardingGate = {
  items: OnboardingGateItem[]
  missing_items: OnboardingGateItem[]
  is_complete: boolean
  /** A clear "cannot start: missing <item>" reason naming the first missing item, or undefined when complete. */
  blocked_reason?: string
}

/**
 * Build the minimal-viable onboarding checklist + the deep-dive blocking reason.
 * The pipeline refuses to start a deep dive until complete, naming the missing item.
 *
 * SCALE-DOWN S5 (owner-locked 2026-07-13): the gate is frontier-LLM-connected ONLY — investable
 * capital was the money layer and is retired (research needs a grounded provider, not your bank
 * balance). A market-data API key is NOT a prerequisite either: the owner uses SEC EDGAR directly.
 */
export function buildOnboardingGate(inputs: OnboardingGateInputs): OnboardingGate {
  const items: OnboardingGateItem[] = [
    { id: 'frontier_llm', label: 'At least one frontier LLM provider connected', done: inputs.has_frontier_llm_connected },
  ]
  const missing_items = items.filter((item) => !item.done)
  const is_complete = missing_items.length === 0
  if (is_complete) {
    return { items, missing_items, is_complete }
  }
  const first = missing_items[0]!
  return {
    items,
    missing_items,
    is_complete,
    blocked_reason: `Cannot start a deep dive: missing ${first.label}.`,
  }
}
