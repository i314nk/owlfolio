import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------------------------------
// ANTI-REGRESSION TRIPWIRE — the band/gap DECISION MACHINERY must not return.
//
// The reframe relit the decision (R1): the model proposes the verdict / valuation / buy-below with cited
// reasoning; the deterministic side only sanity-checks and applies cheap gates. This slice DELETED the
// now-obsolete band/gap decision machinery: the sustainableGrowthBand + requiredGrowthGap engines, their
// package subpath exports, and the `required_growth_gap` valuation config block. Conservatism is no longer
// a deterministic engine.
//
// This grep over the COMMITTED non-test source asserts the machinery does NOT come back: no source file
// DEFINES/EXPORTS a `sustainableGrowthBand` / `requiredGrowthGap` symbol, and no source file declares a
// `required_growth_gap` CONFIG block. Mirrors the existing source-grep tripwires (sizingWiringConformance's
// no-Kelly guard / supersededTermConsistency): comments are stripped so prose that NAMES the retired
// machinery to explain it was removed (this file, backtest.ts header, projection legacy-tolerance notes)
// does not trip — only live CODE that reintroduces it does.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/** Package source roots scanned for reintroduced band/gap machinery (non-test code only). */
const SCAN_ROOTS = [
  join(repoRoot, 'packages', 'strategies', 'src'),
  join(repoRoot, 'packages', 'workflow', 'src'),
  join(repoRoot, 'apps', 'web', 'src'),
]

const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next', 'dist'])

function collectSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs)
      } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
        out.push(abs)
      }
    }
  }
  walk(root)
  return out
}

/** Strip block + line comments so the grep targets CODE only (prose may NAME the retired machinery). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const SOURCE_FILES = SCAN_ROOTS.flatMap(collectSourceFiles)

describe('anti-regression: the band/gap decision machinery does not return', () => {
  it('scans a non-trivial set of source files (the walk is wired)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20)
  })

  it('no source file DEFINES/EXPORTS a sustainableGrowthBand or requiredGrowthGap symbol', () => {
    // A function/const/type/class declaration or a re-export of the retired engine symbols.
    const forbidden = /(?:function|const|let|var|type|interface|class)\s+(?:sustainableGrowthBand|requiredGrowthGap|SustainableGrowthBand|RequiredGrowthGap)\b|export\s*\{[^}]*\b(?:sustainableGrowthBand|requiredGrowthGap)\b/
    for (const abs of SOURCE_FILES) {
      const code = stripComments(readFileSync(abs, 'utf8'))
      expect(
        forbidden.test(code),
        `${relative(repoRoot, abs)} reintroduces a band/gap engine symbol — the decision machinery was deleted; the model proposes the verdict, determinism only sanity-checks.`,
      ).toBe(false)
    }
  })

  it('no source file imports the retired @owlfolio/strategies band/gap engine subpaths', () => {
    const forbidden = /@owlfolio\/strategies\/(?:sustainableGrowthBand|requiredGrowthGap)\b/
    for (const abs of SOURCE_FILES) {
      const code = stripComments(readFileSync(abs, 'utf8'))
      expect(
        forbidden.test(code),
        `${relative(repoRoot, abs)} imports a deleted band/gap engine subpath.`,
      ).toBe(false)
    }
  })

  it('no source file declares a required_growth_gap CONFIG block (the conservatism engine knob is gone)', () => {
    // A `required_growth_gap:` object/zod property declaration, or a `.required_growth_gap` config READ.
    const forbidden = /required_growth_gap\s*:|\.required_growth_gap\b/
    for (const abs of SOURCE_FILES) {
      const code = stripComments(readFileSync(abs, 'utf8'))
      expect(
        forbidden.test(code),
        `${relative(repoRoot, abs)} reintroduces the required_growth_gap config knob — conservatism is no longer a deterministic engine.`,
      ).toBe(false)
    }
  })
})
