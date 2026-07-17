/**
 * EDGAR registrant names arrive ALL CAPS ("VISA INC.") — title-case them for row/card display so
 * the name reads like a name. Display-only; the payload keeps the registrant's exact string.
 */
export function titleCaseEntityName(name: string): string {
  // Legacy 13F payloads carry raw XML entities ('S&amp;P GLOBAL INC') — decode before casing so the
  // caser never produces 'S&Amp;p'. Newly harvested events are decoded at the parser.
  return decodeXmlEntities(name).toLowerCase().replace(/(^|[\s\-("'./&])([a-z])/g, (_m, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`)
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
}

/** 'HIMALAYA CAPITAL MANAGEMENT LLC (LI LU)' → 'Himalaya Capital Management (Li Lu)' — display only. */
export function shortManagerName(name: string): string {
  return titleCaseEntityName(name.replace(/,?\s+(LLC|LP|L\.P\.|INC\.?|LTD\.?)\s*(?=\(|$)/i, ' ').replace(/\s{2,}/g, ' ').trim())
}
