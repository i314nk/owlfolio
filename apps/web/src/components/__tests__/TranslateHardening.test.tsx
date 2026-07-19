import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SourceChip } from '../designSystem'

// TRANSLATE-HARDENING (owner, 2026-07-19): the app is English-only; users translate on demand with
// the browser. Machine vocabulary the user must type/run/copy/search VERBATIM — ids, tickers, model
// ids, env var names, commands — carries translate="no" so page translators cannot corrupt it.
// Conceptual vocabulary (verdicts, statuses, headings) deliberately stays translatable.

describe('translate="no" hardening on verbatim primitives', () => {
  it('SourceChip protects the id, not the label', () => {
    const html = renderToStaticMarkup(createElement(SourceChip, { id: 'evt_decision_drafted_x1', label: 'Source' }))
    expect(html).toContain('translate="no"')
    expect(html).toMatch(/translate="no"[^>]*>evt_decision_drafted_x1</)
    // The label span stays translatable.
    expect(html).not.toMatch(/translate="no"[^>]*>Source</)
  })

  it('the shared code/id surfaces declare the attribute in source (convention lock)', () => {
    // Cheap source-level pins: primitives that render commands/env names/model ids/case ids.
    for (const [file, needle] of [
      ['apps/web/src/components/DataSafetyPanel.tsx', "translate: 'no'"],
      ['apps/web/src/components/ProviderKeysPanel.tsx', "translate: 'no'"],
      ['apps/web/src/components/GuidedConnectionSelect.tsx', "translate: 'no'"],
      ['apps/web/src/components/ActiveModelSwitcher.tsx', "translate: 'no'"],
      ['apps/web/src/components/AuditActivityPanel.tsx', "translate: 'no'"],
      ['apps/web/src/components/ResearchCasePending.tsx', 'translate="no"'],
    ] as const) {
      expect(readFileSync(file, 'utf8'), file).toContain(needle)
    }
  })
})
