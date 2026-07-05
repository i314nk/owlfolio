// Slice A read contract: let a tool-loop provider READ an already-grounded filing by Item, content-
// verified and lane-gated. Resolves a verified source-id → its content (A2 in-run / A1 re-fetch+verify,
// fail-closed on hash mismatch) → the requested 10-K Item (Item parser) → bounded text. Offset paging is
// the fallback for filings that don't parse into Items.
//
// The lane tag is preserved: a source the lane's source-discipline whitelist would reject for CITATION
// is also refused for READING — reading never becomes a way around `sourcePolicy.ts`.

import { classifySourceCategory, isCategoryAllowedForLane } from '@owlfolio/strategies/sourcePolicy'
import { extractFilingItems, extractFilingSection, htmlToText } from './filingSections'
import { readGroundedSourceContent, type CapturedSource, type GroundingDeps } from './sourceGrounding'

export type ReadSourceOptions = {
  /** A 10-K Item to read (e.g. "1A", "Item 7"). Omit to get the readable-section index. */
  section?: string
  /** Offset-paging fallback for documents that don't parse into Items. */
  offset?: number
  /** Max characters returned per read. */
  limit?: number
  /** Mechanism-6 lane id; an out-of-lane source is refused (same gate as citation). */
  lane?: string
}

export type ReadSourceResult =
  | {
      ok: true
      source_id: string
      /** The Item read, or `offset:<n>` for a paged read. Absent for the index. */
      section?: string
      text: string
      /** True when more text remains beyond `text` (continue via `next_offset`). */
      truncated?: boolean
      next_offset?: number
      /** Items the parser found in this document (so the model can pick a valid section). */
      available_items?: string[]
    }
  | { ok: false; source_id: string; reason: string; available_items?: string[] }

const DEFAULT_READ_CHARS = 8_000

/**
 * Read an already-grounded source by Item (or by offset). Fail-closed: unknown id, out-of-lane source,
 * or content that can't be hash-verified all return `{ ok: false }`. The model may only read what the
 * harness already verified — never the 600-char excerpt, never an unverified copy.
 */
export async function readGroundedSource(
  sourceId: string,
  corpus: ReadonlyMap<string, CapturedSource>,
  opts: ReadSourceOptions = {},
  deps?: GroundingDeps,
): Promise<ReadSourceResult> {
  const source = corpus.get(sourceId)
  if (source === undefined) {
    return { ok: false, source_id: sourceId, reason: 'source_id not found in the verified corpus' }
  }

  // Lane gate (Mechanism 6): refuse to read a source this lane could not cite.
  if (opts.lane !== undefined) {
    const category = source.source_category ?? classifySourceCategory(source.url)
    if (!isCategoryAllowedForLane(opts.lane, category)) {
      return { ok: false, source_id: sourceId, reason: `excluded_by_lane_policy:${category}` }
    }
  }

  // Hash-verified read (A2 fast path / A1 verification path). Fail-closed on mismatch/unavailable.
  const content = await readGroundedSourceContent(source, deps)
  if (content === undefined) {
    return {
      ok: false,
      source_id: sourceId,
      reason: 'source could not be content-verified for reading (hash mismatch or unavailable)',
    }
  }

  const items = extractFilingItems(content)
  const available_items = items.length > 0 ? items.map((i) => i.item) : undefined
  const limit = opts.limit !== undefined && opts.limit > 0 ? opts.limit : DEFAULT_READ_CHARS
  const sectionRequested = opts.section !== undefined && opts.section.trim().length > 0

  // High-value path: read a specific Item.
  if (sectionRequested) {
    const sec = extractFilingSection(content, opts.section!)
    if (sec !== undefined) {
      const text = sec.slice(0, limit)
      const truncated = sec.length > limit
      return {
        ok: true,
        source_id: sourceId,
        section: opts.section!.trim(),
        text,
        ...(truncated ? { truncated: true, next_offset: limit } : {}),
        ...(available_items ? { available_items } : {}),
      }
    }
    // Requested Item not found, but the doc DID parse — tell the model what's available.
    if (items.length > 0) {
      return {
        ok: false,
        source_id: sourceId,
        reason: `section "${opts.section!.trim()}" not found`,
        ...(available_items ? { available_items } : {}),
      }
    }
    // Unparseable doc + a section request → fall through to offset paging.
  }

  // No section + parseable doc + no explicit paging → return the readable-section index.
  if (items.length > 0 && !sectionRequested && opts.offset === undefined) {
    return {
      ok: true,
      source_id: sourceId,
      text: `Readable sections (call read again with section=<Item>): ${items.map((i) => i.item).join(', ')}`,
      ...(available_items ? { available_items } : {}),
    }
  }

  // Offset-paging fallback (unparseable doc, or explicit offset).
  const plain = htmlToText(content)
  const offset = Math.max(0, opts.offset ?? 0)
  const end = offset + limit
  const next = end < plain.length ? end : undefined
  return {
    ok: true,
    source_id: sourceId,
    ...(offset > 0 ? { section: `offset:${offset}` } : {}),
    text: plain.slice(offset, end),
    ...(next !== undefined ? { truncated: true, next_offset: next } : {}),
    ...(available_items ? { available_items } : {}),
  }
}
