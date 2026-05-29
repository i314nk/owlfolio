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

export const defaultSourceLedgerStorage = {
  relative_dir: 'data/source-ledger',
  file_prefix: 'research-source-bundle',
} as const
