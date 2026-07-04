import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

export type SourceLedgerActorType = 'provider' | 'system' | 'user'
export type SourceLedgerSourceType = 'provider-output' | 'local-file' | 'url'
export type SourceLedgerAvailability = 'available' | 'unavailable'

export type SourceLedgerRecord = {
  source_record_id: string
  research_case_id: string
  source_id: string
  provider_id: string
  captured_at: string
  title?: string
  url?: string
  excerpt?: string
  citation_locator?: string
  content_hash?: string
  source_type?: SourceLedgerSourceType
  availability?: SourceLedgerAvailability
  ingested_by_actor_type?: Exclude<SourceLedgerActorType, 'provider'>
  ingested_by_actor_id?: string
  proposed_by_actor_type?: SourceLedgerActorType
  proposed_by_actor_id?: string
  // ---- Cross-run enrichment (Axis B): TOP-LEVEL typed fields, deliberately NOT in the metadata map —
  // sanitizeMetadata silently drops any string containing '/' (looksSensitiveValue), which would eat
  // form values like '8-K/A'; and the cross-run resolver reads these back without guessing at a
  // Record<string, unknown>. All optional + additive.
  /** Lane-discipline category stamped at grounding time ('proxy', 'filing', …). */
  source_category?: string
  /** EDGAR form type ('DEF 14A', '8-K/A', …). */
  filing_form?: string
  /** ISO filing date of the underlying document. */
  filed?: string
  /** Per-source grounding timestamp (the bundle-level captured_at is write-time and resets on overwrite). */
  fetched_at?: string
  metadata: Record<string, unknown>
}

export type SourceLedgerBundle = {
  bundle_path: string
  research_case_id: string
  provider_id: string
  captured_at: string
  records: SourceLedgerRecord[]
}

export type SourceLedgerSourceInput = {
  source_id: string
  title?: string
  url?: string
  excerpt?: string
  citation_locator?: string
  content_hash?: string
  metadata?: Record<string, unknown>
}

type ManualSourceBaseInput = {
  source_id: string
  title?: string
  citation_locator?: string
  content_hash?: string
  /** Cross-run enrichment (Axis B) — persisted top-level on the record; see SourceLedgerRecord. */
  source_category?: string
  filing_form?: string
  filed?: string
  fetched_at?: string
  metadata?: Record<string, unknown>
}

export type ManualLocalEvidenceSourceInput = ManualSourceBaseInput & {
  kind: 'local-file'
  path: string
}

export type ManualUrlEvidenceSourceInput = ManualSourceBaseInput & {
  kind: 'url'
  url: string
  excerpt?: string
  availability?: SourceLedgerAvailability
}

export type ManualEvidenceSourceInput = ManualLocalEvidenceSourceInput | ManualUrlEvidenceSourceInput

export type IngestManualSourceBundleInput = {
  source_ledger_path: string
  research_case_id: string
  ticker: string
  strategy_id: string
  sources: ManualEvidenceSourceInput[]
  provider_id?: string
  captured_at?: string
  ingested_by_actor_type: Exclude<SourceLedgerActorType, 'provider'> | 'provider'
  ingested_by_actor_id: string
  proposed_by_actor_type?: SourceLedgerActorType
  proposed_by_actor_id?: string
  allowlisted_file_roots?: string[]
}

export const defaultSourceLedgerStorage = {
  relative_dir: 'data/source-ledger',
  file_prefix: 'research-source-bundle',
} as const

export async function writeSourceLedgerBundle(input: {
  source_ledger_path: string
  research_case_id: string
  provider_id: string
  records: SourceLedgerSourceInput[]
  captured_at?: string
}): Promise<SourceLedgerBundle> {
  const capturedAt = input.captured_at ?? new Date().toISOString()
  const records: SourceLedgerRecord[] = input.records.map((record, index) => ({
    source_record_id: `source_record_${input.research_case_id}_${index + 1}`,
    research_case_id: input.research_case_id,
    source_id: record.source_id,
    provider_id: input.provider_id,
    captured_at: capturedAt,
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.url === undefined ? {} : { url: record.url }),
    ...(record.excerpt === undefined ? {} : { excerpt: record.excerpt }),
    ...(record.citation_locator === undefined ? {} : { citation_locator: record.citation_locator }),
    ...(record.content_hash === undefined ? {} : { content_hash: record.content_hash }),
    metadata: { ...(record.metadata ?? {}) },
  }))

  return await persistSourceLedgerBundle({
    source_ledger_path: input.source_ledger_path,
    research_case_id: input.research_case_id,
    provider_id: input.provider_id,
    captured_at: capturedAt,
    records,
  })
}

export async function ingestManualSourceBundle(input: IngestManualSourceBundleInput): Promise<SourceLedgerBundle> {
  const ingestedByActorType = requireIngestionActorType(input.ingested_by_actor_type)
  assertSafeSourceLedgerSlug(input.research_case_id, 'Research case id')

  const capturedAt = input.captured_at ?? new Date().toISOString()
  const providerId = input.provider_id ?? 'manual-local'
  const proposedByActorType = input.proposed_by_actor_type ?? ingestedByActorType
  const proposedByActorId = input.proposed_by_actor_id ?? input.ingested_by_actor_id
  const allowlistedRoots = input.allowlisted_file_roots?.map((root) => resolve(root)) ?? []

  const records: SourceLedgerRecord[] = []
  for (const [index, source] of input.sources.entries()) {
    assertSafeSourceLedgerSlug(source.source_id, 'Source id')
    records.push(await buildManualSourceRecord({
      source,
      index,
      input,
      providerId,
      capturedAt,
      proposedByActorType,
      proposedByActorId,
      ingestedByActorType,
      allowlistedRoots,
    }))
  }

  return await persistSourceLedgerBundle({
    source_ledger_path: input.source_ledger_path,
    research_case_id: input.research_case_id,
    provider_id: providerId,
    captured_at: capturedAt,
    records,
  })
}

async function buildManualSourceRecord(input: {
  source: ManualEvidenceSourceInput
  index: number
  input: IngestManualSourceBundleInput
  providerId: string
  capturedAt: string
  proposedByActorType: SourceLedgerActorType
  proposedByActorId: string
  ingestedByActorType: Exclude<SourceLedgerActorType, 'provider'>
  allowlistedRoots: string[]
}): Promise<SourceLedgerRecord> {
  const shared = {
    source_record_id: `source_record_${input.input.research_case_id}_${input.index + 1}`,
    research_case_id: input.input.research_case_id,
    source_id: input.source.source_id,
    provider_id: input.providerId,
    captured_at: input.capturedAt,
    ...(input.source.title === undefined ? {} : { title: input.source.title }),
    ...(input.source.citation_locator === undefined ? {} : { citation_locator: input.source.citation_locator }),
    ...(input.source.source_category === undefined ? {} : { source_category: input.source.source_category }),
    ...(input.source.filing_form === undefined ? {} : { filing_form: input.source.filing_form }),
    ...(input.source.filed === undefined ? {} : { filed: input.source.filed }),
    ...(input.source.fetched_at === undefined ? {} : { fetched_at: input.source.fetched_at }),
    ingested_by_actor_type: input.ingestedByActorType,
    ingested_by_actor_id: input.input.ingested_by_actor_id,
    proposed_by_actor_type: input.proposedByActorType,
    proposed_by_actor_id: input.proposedByActorId,
  } satisfies Omit<SourceLedgerRecord, 'metadata' | 'source_type'>

  if (input.source.kind === 'url') {
    const url = normalizeEvidenceUrl(input.source.url)
    const metadata = buildManualMetadata(input.input, input.source, {
      source_kind: 'url',
      privacy: { local_path_redacted: false, local_file_name_redacted: false },
    })

    return {
      ...shared,
      source_type: 'url',
      availability: input.source.availability ?? 'available',
      url,
      ...(input.source.excerpt === undefined ? {} : { excerpt: input.source.excerpt }),
      ...(input.source.content_hash === undefined ? {} : { content_hash: input.source.content_hash }),
      metadata,
    }
  }

  await assertAllowlistedLocalPath(sourcePath(input.source), input.allowlistedRoots)
  const localEvidence = await readAllowlistedLocalEvidence(sourcePath(input.source))
  const metadata = buildManualMetadata(input.input, input.source, {
    source_kind: 'local-file',
    privacy: { local_path_redacted: true, local_file_name_redacted: true },
    ...(localEvidence.availability === 'unavailable' ? { unavailable_reason: 'local_file_not_found' } : {}),
  })

  return {
    ...shared,
    source_type: 'local-file',
    availability: localEvidence.availability,
    ...(localEvidence.content_hash === undefined ? {} : { content_hash: localEvidence.content_hash }),
    metadata,
  }
}

function sourcePath(source: ManualLocalEvidenceSourceInput): string {
  return source.path
}

function requireIngestionActorType(actorType: SourceLedgerActorType): Exclude<SourceLedgerActorType, 'provider'> {
  if (actorType === 'provider') {
    throw new Error('Source bundle ingestion must be performed by a user or system actor')
  }

  return actorType
}

async function readAllowlistedLocalEvidence(path: string): Promise<{
  availability: SourceLedgerAvailability
  content_hash?: string
}> {
  try {
    const content = await readFile(path)
    return {
      availability: 'available',
      content_hash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { availability: 'unavailable' }
    }

    throw new Error('Unable to read allowlisted local evidence')
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

/** Path-traversal guard on ids that become bundle filenames — shared with the read side (sourceLedgerRead). */
export function assertSafeSourceLedgerSlug(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a safe source-ledger slug`)
  }
}

async function pathForAllowlistCheck(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (isMissingFileError(error)) {
      return resolve(path)
    }

    throw new Error('Unable to resolve local evidence path')
  }
}

async function rootForAllowlistCheck(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (isMissingFileError(error)) {
      return resolve(path)
    }

    throw new Error('Unable to resolve allowlisted evidence root')
  }
}

async function assertAllowlistedLocalPath(path: string, allowlistedRoots: string[]): Promise<void> {
  if (allowlistedRoots.length === 0) {
    throw new Error('Local evidence ingestion requires at least one allowlisted file root')
  }

  const resolvedPath = await pathForAllowlistCheck(path)
  const resolvedRoots = await Promise.all(allowlistedRoots.map(rootForAllowlistCheck))
  const isAllowed = resolvedRoots.some((root) => {
    const relativePath = relative(root, resolvedPath)
    return relativePath.length === 0 || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  })

  if (!isAllowed) {
    throw new Error('Local source file is outside allowlisted evidence roots')
  }
}

function normalizeEvidenceUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Evidence URL must be a valid http(s) URL')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Evidence URL must be a valid http(s) URL')
  }

  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''

  return parsed.toString()
}

function buildManualMetadata(
  input: IngestManualSourceBundleInput,
  source: ManualEvidenceSourceInput,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...sanitizeMetadata(source.metadata ?? {}),
    ...metadata,
    ...(source.kind === 'url' && source.content_hash !== undefined ? { content_hash_verification: 'provider_claimed' } : {}),
    ...(source.kind === 'url' && source.availability !== undefined ? { availability_verification: 'provider_claimed' } : {}),
    ticker: input.ticker,
    strategy_id: input.strategy_id,
  }
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) {
      continue
    }
    const sanitizedValue = sanitizeMetadataValue(value)
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue
    }
  }
  return sanitized
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (isPlainObject(value)) {
    const nested = sanitizeMetadata(value)
    return Object.keys(nested).length === 0 ? undefined : nested
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeMetadataValue(entry))
      .filter((entry) => entry !== undefined)
    return sanitized.length === 0 ? undefined : sanitized
  }

  if (typeof value === 'string' && looksSensitiveValue(value)) {
    return undefined
  }

  return value
}

function isSensitiveMetadataKey(key: string): boolean {
  return /(?:path|token|secret|credential|api[_-]?key|private|password)/i.test(key)
}

function looksSensitiveValue(value: string): boolean {
  return /(?:sk_live|sk-|token|secret|\/|\\)/i.test(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * OVERWRITE semantics (load-bearing for cross-run consumers): each write REPLACES the per-case bundle
 * file wholesale with exactly the records passed. Within one run this is monotone (every ingest site
 * maps the full accumulated corpus), but a FUTURE run for the same research_case_id that starts a fresh
 * corpus and ingests at its end would CLOBBER the prior run's records. Any cross-run writer (re-review)
 * MUST read-before-write — seed its corpus from `loadPersistedReadCorpus` (sourceLedgerRead) or union the
 * records — before ingesting. Merge-on-write is a deliberate later slice, not implicit behavior.
 */
async function persistSourceLedgerBundle(input: {
  source_ledger_path: string
  research_case_id: string
  provider_id: string
  captured_at: string
  records: SourceLedgerRecord[]
}): Promise<SourceLedgerBundle> {
  await mkdir(input.source_ledger_path, { recursive: true })
  const bundlePath = join(
    input.source_ledger_path,
    `${defaultSourceLedgerStorage.file_prefix}-${input.research_case_id}.json`,
  )

  await writeFile(
    bundlePath,
    JSON.stringify(
      {
        research_case_id: input.research_case_id,
        provider_id: input.provider_id,
        captured_at: input.captured_at,
        records: input.records,
      },
      null,
      2,
    ),
    'utf8',
  )

  return {
    bundle_path: bundlePath,
    research_case_id: input.research_case_id,
    provider_id: input.provider_id,
    captured_at: input.captured_at,
    records: input.records,
  }
}
