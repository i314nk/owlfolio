import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PageTranslator } from '../PageTranslator'

// The shell Translate control (owner, 2026-07-19): where the browser exposes the on-device
// Translator API the control upgrades to a language picker; everywhere else (SSR included) it IS
// the discoverability hint — the browser's page translation, with Firefox's on-device note.

describe('PageTranslator', () => {
  it('SSR renders the browser-translate HINT (progressive enhancement baseline)', () => {
    const html = renderToStaticMarkup(createElement(PageTranslator))
    expect(html).toContain('data-testid="translate-hint"')
    expect(html).toContain('use your browser’s page translation')
    // The fuller guidance rides the tooltip: per-browser gestures + the on-device Firefox note.
    expect(html).toContain('address bar')
    expect(html).toContain('translators leave them intact')
  })

  it('the control itself is translate="no" — its labels are already native', () => {
    const html = renderToStaticMarkup(createElement(PageTranslator))
    expect(html).toContain('translate="no"')
  })
})
