import { createHash } from 'node:crypto'
import type { SourceLedgerAvailability } from './sourceLedger'
import { classifySourceCategory, isCategoryAllowedForLane, type SourceCategory } from '@owlfolio/strategies/sourcePolicy'

const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^0\./,
]

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid source URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Source URL protocol not allowed: ${url.protocol}`)
  }
  // Node.js URL keeps brackets around IPv6 hostnames (e.g. "[::1]"), strip them for matching
  const rawHost = url.hostname.toLowerCase()
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`Source URL host not allowed (loopback): ${host}`)
  }
  if (PRIVATE_V4.some((re) => re.test(host))) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  // IPv6: loopback (::1) and unspecified (::)
  if (host === '::1' || host === '::') {
    throw new Error(`Source URL host not allowed (loopback): ${host}`)
  }
  // IPv6: link-local (fe80::/10)
  if (host.startsWith('fe80:')) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  // IPv6: ULA (fc00::/7 — fc and fd prefixes)
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  // IPv6: IPv4-mapped (::ffff:...) — Node normalises dotted-decimal to hex so we always see hex.
  // Block all ::ffff: prefixed addresses conservatively (they map to IPv4 space).
  if (/^::ffff:/i.test(host)) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  return url
}

/**
 * Cite-check a (possibly compound) citation string against the verified corpus. Models routinely emit
 * COMPOUND citations — multiple source_ids in one string, e.g. "ko_2025_10k; ko_2026_q1_10q" — which an
 * exact `verified.has(citation)` lookup NEVER matches even when both components are individually verified
 * (the real KO bug: the cited compound never matched, the row scored 0, the moat resolved narrow). Split
 * the citation on `;` or `,`, trim, drop empties, and return true when AT LEAST ONE component is in the
 * verified set (a claim is grounded if any one of its cited sources is content-hash-verified). This does
 * NOT loosen what counts as verified — the caller's `verified` set is still the content_hash-confirmed
 * set; this only fixes the LOOKUP to handle compound strings.
 */
export function isCitationGrounded(citation: string, verified: ReadonlySet<string>): boolean {
  return citation
    .split(/[;,]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .some((c) => verified.has(c))
}

export type ProposedSource = {
  source_id: string
  title: string
  url: string
  excerpt: string
  citation_locator?: string
}

export type CapturedSource = {
  source_id: string
  title: string
  url: string
  excerpt: string
  content_hash?: string
  availability: SourceLedgerAvailability
  http_status?: number
  fetched_at: string
  citation_locator?: string
  /** Mechanism 6: the classifier's source category (for dossier visibility). Set by the lane-aware path,
   * OR harness-stamped at grounding time when the true category is KNOWN from the submissions index and
   * the URL carries no signal (a real DEF 14A filename like `cost-20251204.htm` classifies as 'filing' —
   * the harness stamps 'proxy'). The read gate prefers this field over the URL heuristic. */
  source_category?: SourceCategory
  /** ISO filing date of the underlying EDGAR document (harness-stamped at grounding; feeds the ledger). */
  filed?: string
  /** EDGAR form type ('10-K', 'DEF 14A', '8-K/A', …) (harness-stamped at grounding; feeds the ledger). */
  form?: string
  /**
   * A2 (Slice A): the RAW fetched body, retained in-memory for the run so a tool-loop provider can READ
   * the grounded document (by Item) without a second fetch. Hashed identically to `content_hash`. NEVER
   * persisted to the source-ledger (the hash + immutable URL make it reproducible — see
   * {@link readGroundedSourceContent}'s A1 verification path). Absent on cross-session reads.
   */
  content?: string
}

export type GroundingDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  maxExcerptChars?: number
  concurrency?: number
  /**
   * User-Agent sent on every source fetch. SEC's fair-access policy (and many company IR sites) 403 a
   * UA-less request; without one the source silently drops out of `verified_ids` and the agent falls
   * back to ungrounded reasoning. Resolution: this field, then `OWLFOLIO_SOURCE_USER_AGENT`, then
   * `OWLFOLIO_SEC_USER_AGENT` (so a single env satisfies both EDGAR and grounding), then the default.
   */
  userAgent?: string
  /** Max total fetch attempts (incl. the first) before failing closed on a transient error. Default 3. */
  maxAttempts?: number
  /** Base backoff (ms); attempt N (1-indexed) sleeps base × 2^(N-1) before the next try. Default 250. */
  retryBaseMs?: number
  /** Injectable sleep so tests assert the backoff schedule without real delay. Default: setTimeout-based. */
  sleepImpl?: (ms: number) => Promise<void>
}

const DEFAULT_SOURCE_USER_AGENT = 'Owlfolio research (local)'

function resolveSourceUserAgent(deps: GroundingDeps): string {
  return deps.userAgent
    ?? process.env['OWLFOLIO_SOURCE_USER_AGENT']
    ?? process.env['OWLFOLIO_SEC_USER_AGENT']
    ?? DEFAULT_SOURCE_USER_AGENT
}

/** A transient HTTP status worth retrying: 429 (rate limit) or any 5xx. 4xx (403/404/...) are deterministic. */
function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchAndCaptureSource(
  source: ProposedSource,
  deps: GroundingDeps = {},
): Promise<CapturedSource> {
  const now = deps.now ?? (() => new Date())
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 20_000
  const maxExcerpt = deps.maxExcerptChars ?? 600
  const ua = resolveSourceUserAgent(deps)
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3)
  const retryBaseMs = deps.retryBaseMs ?? 250
  const sleep = deps.sleepImpl ?? defaultSleep
  const base: CapturedSource = {
    source_id: source.source_id,
    title: source.title,
    url: source.url,
    excerpt: source.excerpt,
    availability: 'unavailable',
    fetched_at: now().toISOString(),
    ...(source.citation_locator === undefined ? {} : { citation_locator: source.citation_locator }),
  }
  try {
    assertPublicHttpUrl(source.url)
  } catch {
    return base
  }
  const MAX_REDIRECTS = 3
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }

  // One full attempt: follow up to MAX_REDIRECTS redirects under a FRESH AbortController/timer (so a
  // retry never reuses an already-aborted controller). SSRF re-validation, redirect handling, and the
  // timeout abort are unchanged from before. Outcome distinguishes the transient cases (worth a retry)
  // from the deterministic/fail-closed ones (returned immediately).
  type Attempt =
    | { kind: 'done'; captured: CapturedSource } // 2xx success or deterministic non-2xx (return base as-is)
    | { kind: 'failClosed' } // deterministic fail-closed (SSRF / redirects exhausted) — do NOT retry
    | { kind: 'retryError' } // network/timeout error — transient, retry within the bound
    | { kind: 'retryStatus'; status: number } // transient HTTP (429/5xx) — retry, preserving last status
  async function attempt(): Promise<Attempt> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let currentUrl = source.url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Re-validate on every hop (initial URL already validated above, but re-checking is safe and covers
        // redirect targets). An SSRF rejection here is DETERMINISTIC (a redirect to a private/blocked host),
        // not transient — fail closed immediately rather than retrying.
        try {
          assertPublicHttpUrl(currentUrl)
        } catch {
          return { kind: 'failClosed' }
        }
        const response = await fetchImpl(currentUrl, { signal: controller.signal, redirect: 'manual', headers })
        const isRedirect = response.status === 301 || response.status === 302 || response.status === 303
          || response.status === 307 || response.status === 308
        const location = response.headers.get('location')
        if (isRedirect && location !== null) {
          if (hop === MAX_REDIRECTS) {
            // Too many redirects — fail closed (not a transient condition)
            return { kind: 'failClosed' }
          }
          currentUrl = new URL(location, currentUrl).toString()
          continue
        }
        if (!response.ok) {
          // Transient (429/5xx) → retry; deterministic (403/404/...) → return immediately as today.
          if (isTransientStatus(response.status)) return { kind: 'retryStatus', status: response.status }
          return { kind: 'done', captured: { ...base, http_status: response.status } }
        }
        const body = await response.text()
        const hash = createHash('sha256').update(body).digest('hex')
        return {
          kind: 'done',
          captured: {
            ...base,
            availability: 'available',
            http_status: response.status,
            content_hash: `sha256:${hash}`,
            excerpt: body.replace(/\s+/g, ' ').trim().slice(0, maxExcerpt) || source.excerpt,
            // A2: retain the raw body in-memory (same bytes we just hashed) so a tool-loop provider can
            // read the grounded document by Item this run without re-fetching. Not persisted to the ledger.
            content: body,
          },
        }
      }
      // Exhausted hops without a final response — fail closed
      return { kind: 'failClosed' }
    } catch {
      // Network/timeout error — transient, retry within the bound.
      return { kind: 'retryError' }
    } finally {
      clearTimeout(timer)
    }
  }

  let lastTransientStatus: number | undefined
  for (let n = 1; n <= maxAttempts; n++) {
    const result = await attempt()
    if (result.kind === 'done') return result.captured
    // Deterministic fail-closed (SSRF / redirects exhausted) is NOT transient — return immediately.
    if (result.kind === 'failClosed') return base
    if (result.kind === 'retryStatus') lastTransientStatus = result.status
    // retryStatus (429/5xx) and retryError (network/timeout) are transient: retry until the bound.
    if (n < maxAttempts) {
      await sleep(retryBaseMs * 2 ** (n - 1))
      continue
    }
  }
  // Retries exhausted — fail closed, preserving the last HTTP status when there was a response.
  return lastTransientStatus === undefined ? base : { ...base, http_status: lastTransientStatus }
}

export type GroundingResult = {
  captured: CapturedSource[]
  verified_ids: string[]
}

export async function groundProposedSourcesDeterministic(
  sources: ProposedSource[],
  deps: GroundingDeps = {},
): Promise<GroundingResult> {
  const now = deps.now ?? (() => new Date())
  const captured: CapturedSource[] = sources.map((s): CapturedSource => ({
    source_id: s.source_id,
    title: s.title,
    url: s.url,
    excerpt: s.excerpt,
    availability: 'available' as const,
    fetched_at: now().toISOString(),
    content_hash: `sha256:mock-${s.source_id}`,
    ...(s.citation_locator === undefined ? {} : { citation_locator: s.citation_locator }),
  }))
  return { captured, verified_ids: captured.map((c) => c.source_id) }
}

export async function groundProposedSources(
  sources: ProposedSource[],
  deps: GroundingDeps = {},
): Promise<GroundingResult> {
  const concurrency = Math.max(1, deps.concurrency ?? 4)
  const captured: CapturedSource[] = new Array(sources.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < sources.length) {
      const index = cursor++
      const source = sources[index]
      if (source === undefined) continue
      captured[index] = await fetchAndCaptureSource(source, deps)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker))
  return {
    captured,
    verified_ids: captured.filter((c) => c.availability === 'available').map((c) => c.source_id),
  }
}

// ---------------------------------------------------------------------------
// Mechanism 6 — per-lane source discipline (the whitelist gate, ADDITIONAL to grounding)
// ---------------------------------------------------------------------------

/** A source rejected by the per-lane whitelist BEFORE it reached the fetcher (recorded, not dropped). */
export type SourcePolicyRejection = {
  source_id: string
  url: string
  category: SourceCategory
  /** `excluded_by_lane_policy:<category>` for an excluded category, or `excluded_unknown_source`. */
  reason: string
}

export type LaneGroundingResult = GroundingResult & {
  /** Sources rejected by the lane's source-discipline whitelist (visible, never silently dropped). */
  policy_rejections: SourcePolicyRejection[]
}

/** The grounding function signature (the fetcher). Lets callers inject a deterministic stub in tests. */
export type GroundFn = (
  sources: ProposedSource[],
  deps?: GroundingDeps,
) => Promise<GroundingResult>

/**
 * Ground a lane's proposed sources under the per-lane source whitelist (judgment-objectivity-layer-spec
 * Mechanism 6). Each proposed source is classified (classifySourceCategory) and gated by the lane's
 * policy (isCategoryAllowedForLane) BEFORE it reaches the fetcher:
 *   - classification lanes (moat/financial_quality/valuation/business_quality) admit only primary docs
 *     and REJECT sell-side/media/investor-writeups; `unknown` is rejected conservatively.
 *   - management adds proxies/insider data; risks admits everything; shariah adds screening providers.
 * A rejected source is RECORDED in `policy_rejections` (reason: `excluded_by_lane_policy:<category>` or
 * `excluded_unknown_source`) — never silently dropped. The admitted sources flow through the SAME
 * grounding path (sha256 + SSRF + verified_ids), so the whitelist is an ADDITIONAL gate, not a bypass.
 * Captured sources carry their `source_category` for dossier visibility.
 */
export async function groundProposedSourcesForLane(
  lane: string,
  sources: ProposedSource[],
  deps: GroundingDeps & { ground?: GroundFn } = {},
): Promise<LaneGroundingResult> {
  const ground = deps.ground ?? groundProposedSources
  const admitted: ProposedSource[] = []
  const admittedCategory = new Map<string, SourceCategory>()
  const policy_rejections: SourcePolicyRejection[] = []

  for (const source of sources) {
    const category = classifySourceCategory(source.url)
    if (isCategoryAllowedForLane(lane, category)) {
      admitted.push(source)
      admittedCategory.set(source.source_id, category)
    } else {
      policy_rejections.push({
        source_id: source.source_id,
        url: source.url,
        category,
        reason: category === 'unknown'
          ? 'excluded_unknown_source'
          : `excluded_by_lane_policy:${category}`,
      })
    }
  }

  const { ground: _omit, ...groundingDeps } = deps
  void _omit
  const grounded = admitted.length > 0
    ? await ground(admitted, groundingDeps)
    : { captured: [] as CapturedSource[], verified_ids: [] as string[] }

  const captured = grounded.captured.map((c) => {
    const category = admittedCategory.get(c.source_id)
    return category === undefined ? c : { ...c, source_category: category }
  })

  return { captured, verified_ids: grounded.verified_ids, policy_rejections }
}

// ---------------------------------------------------------------------------
// Slice A — verified read of an already-grounded document (A2 fast path + A1 verification path)
// ---------------------------------------------------------------------------

/**
 * Re-fetch a URL for verification only: SSRF-guarded, manual redirects, NO retries (a verification read
 * fails closed rather than retrying). Returns the raw body or undefined. Used by the A1 path below.
 */
async function refetchBodyForVerification(rawUrl: string, deps: GroundingDeps): Promise<string | undefined> {
  const fetchFn = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 20_000
  const headers = {
    'User-Agent': resolveSourceUserAgent(deps),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let currentUrl = rawUrl
    for (let hop = 0; hop <= 3; hop++) {
      try {
        assertPublicHttpUrl(currentUrl)
      } catch {
        return undefined
      }
      const response = await fetchFn(currentUrl, { signal: controller.signal, redirect: 'manual', headers })
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status)
      const location = response.headers.get('location')
      if (isRedirect && location !== null) {
        if (hop === 3) return undefined
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      if (!response.ok) return undefined
      return await response.text()
    }
    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read the full body of an already-grounded source, content-verified against its ledgered hash.
 *
 *   A2 (fast path): use the raw body retained in-memory this run (`source.content`).
 *   A1 (verification path): when no retained content (cross-session read), re-fetch the URL. EDGAR
 *     Archives URLs are immutable, so the re-fetched bytes hash-match the ledgered value — a genuine
 *     integrity check, not best-effort.
 *
 * EITHER way the returned body MUST hash to `source.content_hash`. On any mismatch this FAILS CLOSED to
 * `undefined` (uncitable/unreadable) — it never returns the in-memory copy or an excerpt that does not
 * match the hash, so the read path can never launder content that disagrees with what was verified.
 */
export async function readGroundedSourceContent(
  source: CapturedSource,
  deps: GroundingDeps = {},
): Promise<string | undefined> {
  const expected = source.content_hash
  if (expected === undefined || !expected.startsWith('sha256:')) return undefined
  const body = typeof source.content === 'string' && source.content.length > 0
    ? source.content
    : await refetchBodyForVerification(source.url, deps)
  if (body === undefined) return undefined
  const actual = `sha256:${createHash('sha256').update(body).digest('hex')}`
  if (actual !== expected) return undefined // FAIL CLOSED: never return content that disagrees with its hash
  return body
}
