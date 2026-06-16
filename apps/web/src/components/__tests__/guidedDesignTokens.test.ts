import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Structural guard: the guided-setup + shared connection-select surfaces must use ONLY the Owlfolio
 * emerald/gold design system (var(--owl-*) tokens + owl-* classes). They previously carried an
 * indigo/slate palette inherited from the old wizard styling. This test locks the restyle so the
 * foreign-palette literals cannot regress back in.
 */

const FOREIGN_PALETTE_LITERALS = [
  '#6366f1',
  '#a5b4fc',
  '124, 140, 255',
  '124,140,255',
  '#f7f8ff',
  '#cbd5e1',
  '#fca5a5',
  '#bbf7d0',
  'rgba(148, 163, 184',
  'rgba(148,163,184',
]

const TARGET_FILES = ['GuidedSetupPanel.tsx', 'GuidedConnectionSelect.tsx']

describe('guided onboarding surfaces use only the Owlfolio design system palette', () => {
  for (const fileName of TARGET_FILES) {
    it(`${fileName} contains no foreign-palette literals`, () => {
      const filePath = fileURLToPath(new URL(`../${fileName}`, import.meta.url))
      const source = readFileSync(filePath, 'utf8')
      for (const literal of FOREIGN_PALETTE_LITERALS) {
        expect(source, `${fileName} should not contain "${literal}"`).not.toContain(literal)
      }
    })
  }
})
