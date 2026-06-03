import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
        captured_at: capturedAt,
        records,
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
    captured_at: capturedAt,
    records,
  }
}
