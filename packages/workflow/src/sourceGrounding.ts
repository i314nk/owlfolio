import { createHash } from 'node:crypto'
import type { SourceLedgerAvailability } from './sourceLedger'

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
}

export type GroundingDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  maxExcerptChars?: number
  concurrency?: number
}

export async function fetchAndCaptureSource(
  source: ProposedSource,
  deps: GroundingDeps = {},
): Promise<CapturedSource> {
  const now = deps.now ?? (() => new Date())
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 20_000
  const maxExcerpt = deps.maxExcerptChars ?? 600
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let currentUrl = source.url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Re-validate on every hop (initial URL already validated above, but re-checking is safe and covers redirect targets)
      assertPublicHttpUrl(currentUrl)
      const response = await fetchImpl(currentUrl, { signal: controller.signal, redirect: 'manual' })
      const isRedirect = response.status === 301 || response.status === 302 || response.status === 303
        || response.status === 307 || response.status === 308
      const location = response.headers.get('location')
      if (isRedirect && location !== null) {
        if (hop === MAX_REDIRECTS) {
          // Too many redirects — fail closed
          return base
        }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      if (!response.ok) {
        return { ...base, http_status: response.status }
      }
      const body = await response.text()
      const hash = createHash('sha256').update(body).digest('hex')
      return {
        ...base,
        availability: 'available',
        http_status: response.status,
        content_hash: `sha256:${hash}`,
        excerpt: body.replace(/\s+/g, ' ').trim().slice(0, maxExcerpt) || source.excerpt,
      }
    }
    // Exhausted hops without a final response — fail closed
    return base
  } catch {
    return base
  } finally {
    clearTimeout(timer)
  }
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
