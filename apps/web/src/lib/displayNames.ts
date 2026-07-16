// Display-name BACKFILL for tickers whose ledger events predate the entity_name stamp
// (2026-07-14): SEC's public company_tickers.json maps ticker → registrant title, so legacy cases
// get "TICKER — Company Name" NOW instead of waiting on a re-run. Display-only — nothing is
// persisted; new analyses still stamp entity_name on the payload (the durable source).
//
// Fail-open + cheap: one fetch per server process (24h TTL; a failure caches empty for 5 min so a
// dead SEC never hammers or blocks a page), a hard 4s abort, and the offline-test gate used by
// every live-data resolver (playwright/vitest never touch the network).

const SEC_TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json'
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

type CacheState = { fetched_at: number; ttl_ms: number; map: Map<string, string> }

let cache: CacheState | undefined

function isOfflineTestMode(): boolean {
  return process.env['OWLFOLIO_TEST_MODE'] === 'playwright' || process.env['VITEST'] !== undefined
}

/** Test hook — resets the module cache. */
export function resetDisplayNameCacheForTests(): void {
  cache = undefined
}

async function loadTickerNameMap(fetchImpl: typeof fetch): Promise<Map<string, string>> {
  const now = Date.now()
  if (cache !== undefined && now - cache.fetched_at < cache.ttl_ms) {
    return cache.map
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const response = await fetchImpl(SEC_TICKER_MAP_URL, {
      headers: { 'user-agent': process.env['OWLFOLIO_SEC_USER_AGENT'] ?? 'Owner’s Manual research (local)' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`SEC ticker map: HTTP ${response.status}`)
    const body = await response.json() as Record<string, { ticker?: string; title?: string }>
    const map = new Map<string, string>()
    for (const entry of Object.values(body)) {
      if (typeof entry?.ticker === 'string' && typeof entry?.title === 'string' && entry.title.length > 0) {
        map.set(entry.ticker.toUpperCase(), entry.title)
      }
    }
    cache = { fetched_at: now, ttl_ms: SUCCESS_TTL_MS, map }
    return map
  } catch {
    cache = { fetched_at: now, ttl_ms: FAILURE_TTL_MS, map: cache?.map ?? new Map() }
    return cache.map
  }
}

/**
 * Resolve display names for the given tickers. Returns only the ones the SEC map knows; callers
 * fill gaps where the ledger already carries entity_name (which always wins).
 */
export async function resolveDisplayNamesForTickers(
  tickers: readonly (string | undefined)[],
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<Map<string, string>> {
  const wanted = [...new Set(tickers.filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => t.toUpperCase()))]
  if (wanted.length === 0 || isOfflineTestMode()) return new Map()
  const map = await loadTickerNameMap(deps.fetchImpl ?? fetch)
  const out = new Map<string, string>()
  for (const ticker of wanted) {
    const name = map.get(ticker)
    if (name !== undefined) out.set(ticker, name)
  }
  return out
}
