// Axis B: the source-ledger READ side — the durable cross-run memory the re-review layer consumes.
//
// The write side (sourceLedger.ts) persists one JSON bundle per research case: POINTERS + HASHES only
// (url, content_hash, filed/form/category provenance) — never document content. This module resolves a
// persisted bundle back into a read corpus (Map<source_id, CapturedSource>) whose entries carry no
// `content`, so every read_source goes through the A1 verification path (re-fetch the immutable EDGAR
// Archives URL, re-hash, fail-closed to uncitable on mismatch). Known documents resolve by source_id;
// `selectFilingsNotInCorpus` computes the freshness delta — discovery catches what the ledger doesn't
// hold. The ledger is the memory; discovery is the delta.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SourceCategory } from '@owlfolio/strategies/sourcePolicy'
import type { FilingRef } from './secEdgar'
import { assertPublicHttpUrl, type CapturedSource } from './sourceGrounding'
import { assertSafeSourceLedgerSlug, defaultSourceLedgerStorage, type SourceLedgerBundle, type SourceLedgerRecord } from './sourceLedger'

/** Runtime mirror of the SourceCategory union — junk persisted values are never laundered into the type. */
const SOURCE_CATEGORIES = new Set<string>([
  'filing', 'transcript', 'regulatory_statistical', 'company_disclosure', 'proxy',
  'insider_data', 'screening_provider', 'sell_side', 'financial_media', 'investor_writeup', 'unknown',
])

/**
 * Read a persisted source-ledger bundle for a research case. Fail-closed `undefined` on a missing file,
 * unparseable JSON, or a top-level shape mismatch. The case id is slug-guarded (path-traversal on the
 * read side too) — an UNSAFE id throws (caller bug), it does not fail closed.
 */
export async function readSourceLedgerBundle(input: {
  source_ledger_path: string
  research_case_id: string
}): Promise<SourceLedgerBundle | undefined> {
  assertSafeSourceLedgerSlug(input.research_case_id, 'Research case id')
  const bundlePath = join(
    input.source_ledger_path,
    `${defaultSourceLedgerStorage.file_prefix}-${input.research_case_id}.json`,
  )

  let raw: string
  try {
    raw = await readFile(bundlePath, 'utf8')
  } catch {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (parsed === null || typeof parsed !== 'object') return undefined
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate['research_case_id'] !== 'string'
    || typeof candidate['provider_id'] !== 'string'
    || typeof candidate['captured_at'] !== 'string'
    || !Array.isArray(candidate['records'])
  ) {
    return undefined
  }

  return {
    bundle_path: bundlePath,
    research_case_id: candidate['research_case_id'],
    provider_id: candidate['provider_id'],
    captured_at: candidate['captured_at'],
    records: candidate['records'] as SourceLedgerRecord[],
  }
}

/**
 * Resolve a persisted bundle into a read corpus. Skip rules (per record, never throw — fail-closed to
 * "not readable", the run proceeds on what survives):
 *   - non-url / url-less records (a local-file record has no A1 re-fetch target),
 *   - availability !== 'available' (records with NO availability are skipped too — only sources
 *     explicitly verified available are honestly readable),
 *   - missing or non-`sha256:` content_hash (readGroundedSourceContent would fail anyway),
 *   - URLs failing the SSRF guard (re-checked at RESOLVE time, not just capture time).
 * Survivors map to CapturedSource WITHOUT `content` ⇒ every read takes the A1 re-fetch + hash-verify
 * path. Persisted `source_category` is validated against the SourceCategory union before stamping.
 */
export function bundleToReadCorpus(bundle: SourceLedgerBundle): Map<string, CapturedSource> {
  const corpus = new Map<string, CapturedSource>()
  for (const record of bundle.records) {
    if (record === null || typeof record !== 'object') continue
    if (typeof record.source_id !== 'string' || record.source_id.length === 0) continue
    if (record.source_type !== 'url' || typeof record.url !== 'string') continue
    if (record.availability !== 'available') continue
    if (typeof record.content_hash !== 'string' || !record.content_hash.startsWith('sha256:')) continue
    try {
      assertPublicHttpUrl(record.url)
    } catch {
      continue
    }

    const category = typeof record.source_category === 'string' && SOURCE_CATEGORIES.has(record.source_category)
      ? record.source_category as SourceCategory
      : undefined
    corpus.set(record.source_id, {
      source_id: record.source_id,
      title: record.title ?? '',
      url: record.url,
      excerpt: record.excerpt ?? '',
      content_hash: record.content_hash,
      availability: 'available',
      fetched_at: record.fetched_at ?? record.captured_at,
      ...(record.citation_locator === undefined ? {} : { citation_locator: record.citation_locator }),
      ...(category === undefined ? {} : { source_category: category }),
      ...(typeof record.filed === 'string' ? { filed: record.filed } : {}),
      ...(typeof record.filing_form === 'string' ? { form: record.filing_form } : {}),
    })
  }
  return corpus
}

/**
 * Convenience: read + resolve. An empty Map when no/invalid bundle exists — no persisted memory means
 * everything discovery finds is "new".
 */
export async function loadPersistedReadCorpus(input: {
  source_ledger_path: string
  research_case_id: string
}): Promise<Map<string, CapturedSource>> {
  const bundle = await readSourceLedgerBundle(input)
  return bundle === undefined ? new Map() : bundleToReadCorpus(bundle)
}

/** Normalize a URL for corpus-membership comparison: drop credentials/query/hash. undefined if invalid. */
function normalizeUrlForMatch(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

/**
 * The re-review delta primitive: which freshly-discovered filings are NOT yet in the persisted corpus.
 * Dedupe key = normalized URL — an EDGAR Archives URL encodes CIK + accession + primaryDocument, unique
 * and immutable per document (filed+form collides on multi-same-day filings; source_ids embed run-local
 * indexes and are not stable across runs). Preserves input order; pure.
 */
export function selectFilingsNotInCorpus(
  filings: readonly FilingRef[],
  corpus: ReadonlyMap<string, CapturedSource>,
): FilingRef[] {
  const known = new Set<string>()
  for (const captured of corpus.values()) {
    const normalized = normalizeUrlForMatch(captured.url)
    if (normalized !== undefined) known.add(normalized)
  }
  return filings.filter((filing) => {
    const normalized = normalizeUrlForMatch(filing.url)
    return normalized === undefined || !known.has(normalized)
  })
}
