// Pure, no-network parser that addresses an SEC filing by ITEM. Lets the qualitative lanes READ
// Item 1 (Business) / Item 1A (Risk Factors) / Item 7 (MD&A) of an already-grounded primary filing
// instead of a 600-char excerpt. Heuristic + fail-closed: a filing that does not parse into Items
// cleanly yields undefined, and callers fall back to offset paging.
//
// TOC disambiguation: a 10-K lists every Item twice — once in the table of contents (a heading
// followed by a page number) and once as the real section (a heading followed by substantial text).
// We take the LONGEST segment per Item, so the body section always beats the TOC line.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Strip HTML to a single whitespace-collapsed text stream with entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

export type FilingItem = { item: string; title?: string; text: string }

// A real Item heading is "Item <n>[<letter>]." followed by whitespace. Requiring the period + space
// avoids matching mid-prose phrases like "line item 5 of the schedule". The period may be separated
// from the number by whitespace ("Item 7 . Management's…") — filers whose HTML splits the number and
// the period into separate tags render exactly that after tag-stripping (the SPGI budget-exhaustion
// bug: Items 6/7/7A were invisible, and the model burned its tool budget retrying them).
const ITEM_HEADING = /\bItem\s+(\d{1,2})([A-C])?\s{0,2}\.\s/gi

// Below this, a segment is a TOC line / stub, not a real section — fail closed.
const MIN_SECTION_CHARS = 60

/**
 * Normalize a loose section key to a canonical Item code ("1A"). Accepts the bare code ("1a", " 1A "),
 * the Item prefix ("Item 1A"), AND a trailing section TITLE ("Item 1A Risk Factors", "Item 7 MD&A") —
 * the form models naturally write when calling read_source. The title is ignored, and a title starting
 * with a bare A-C letter cannot corrupt the code (the letter must not be followed by another letter, so
 * "1 Business" is Item 1, never 1B). Unparseable input → '' (fail-closed, section not found).
 */
function normalizeItemKey(raw: string): string {
  const m = raw.match(/(\d{1,2})\s*([A-Ca-c])?(?![A-Za-z])/)
  if (m === null) return ''
  return `${m[1]}${(m[2] ?? '').toUpperCase()}`
}

type Heading = { key: string; index: number }

function findHeadings(text: string): Heading[] {
  const out: Heading[] = []
  ITEM_HEADING.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ITEM_HEADING.exec(text)) !== null) {
    out.push({ key: `${m[1]}${m[2] ?? ''}`.toUpperCase(), index: m.index })
  }
  return out
}

/**
 * All parsed Items (TOC entries disambiguated — the longest segment per Item wins), in document
 * order. Returns [] when nothing parses.
 */
export function extractFilingItems(input: string): FilingItem[] {
  const text = htmlToText(input)
  const headings = findHeadings(text)
  if (headings.length === 0) return []

  type Seg = { key: string; index: number; text: string }
  const segs: Seg[] = headings.map((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1]!.index : text.length
    return { key: h.key, index: h.index, text: text.slice(h.index, end).trim() }
  })

  // Longest segment per Item (body beats the TOC line), then drop sub-threshold stubs.
  const bestByKey = new Map<string, Seg>()
  for (const s of segs) {
    const prior = bestByKey.get(s.key)
    if (prior === undefined || s.text.length > prior.text.length) bestByKey.set(s.key, s)
  }
  return [...bestByKey.values()]
    .filter((s) => s.text.length >= MIN_SECTION_CHARS)
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ item: s.key, text: s.text }))
}

/** Return one Item's section text, or undefined (fail-closed) when absent/unparseable/too short. */
export function extractFilingSection(input: string, section: string): string | undefined {
  const key = normalizeItemKey(section)
  if (key.length === 0) return undefined
  return extractFilingItems(input).find((i) => i.item === key)?.text
}
