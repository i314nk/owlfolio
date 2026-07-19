/**
 * In-app page translation via the BROWSER'S built-in Translator API (owner, 2026-07-19).
 *
 * The app is English-only; translation is on-demand and view-only. Where the browser exposes the
 * on-device Translator API (Chromium), the shell offers a "Translate" picker that walks the page's
 * text nodes and translates them locally — no server, no cloud, nothing leaves the machine. Where
 * it doesn't (Firefox/Safari), the shell shows the browser-translate hint instead; Firefox's own
 * address-bar translation is also fully on-device.
 *
 * This module is the DOM-AGNOSTIC core (testable without jsdom): the decision of which text a
 * translator may touch. It honors the same `translate="no"` hardening contract the external
 * browser translators honor — ids, tickers, commands, env names, and model ids stay verbatim.
 */

/** Structural element view — what the walker needs from a DOM Element. */
export type ElementLike = {
  tagName: string
  getAttribute(name: string): string | null
  parentElement: ElementLike | null
}

/** Subtrees whose text is never prose: code-bearing, style-bearing, or form-control internals. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'KBD', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'])

/**
 * May an in-app translator rewrite this text node? Standard HTML `translate` semantics: the nearest
 * ancestor carrying an explicit translate attribute wins ("no" protects, "yes" re-enables under a
 * protected ancestor); code/style/form subtrees never translate; whitespace is left alone.
 */
export function shouldTranslateText(value: string | null, parent: ElementLike | null): boolean {
  if (value === null || value.trim().length === 0) return false
  if (parent === null) return false

  let verdictFromTranslateAttr: boolean | undefined
  for (let node: ElementLike | null = parent; node !== null; node = node.parentElement) {
    if (SKIP_TAGS.has(node.tagName.toUpperCase())) return false
    if (verdictFromTranslateAttr === undefined) {
      const attr = node.getAttribute('translate')
      if (attr === 'no') verdictFromTranslateAttr = false
      else if (attr === 'yes') verdictFromTranslateAttr = true
    }
  }
  return verdictFromTranslateAttr ?? true
}

/**
 * The offered target languages (BCP-47). A curated common set — the Translator API downloads a
 * language pack per pair on first use, so the menu stays modest; Arabic leads (the first requested
 * language in this product's history).
 */
export const TRANSLATE_TARGETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'ar', label: 'العربية' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'ur', label: 'اردو' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
]

/** Fixed-size batching for the translate loop (bounded concurrency per batch). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
