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
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) {
    throw new Error(`Source URL host not allowed (loopback): ${host}`)
  }
  if (PRIVATE_V4.some((re) => re.test(host))) {
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(source.url, { signal: controller.signal, redirect: 'follow' })
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
  } catch {
    return base
  } finally {
    clearTimeout(timer)
  }
}
