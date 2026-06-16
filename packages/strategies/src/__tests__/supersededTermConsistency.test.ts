import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------------------------------
// Phase 8 S6 — SUPERSEDED-TERM CONSISTENCY TRIPWIRE (the durable value of the consistency cohesion sweep).
//
// Encodes the Phase-8 superseded-term grep as an executable repo TEST so the consistency guarantee
// survives future phases. Models itself on the structural grep tripwires (sizingWiringConformance's
// no-Kelly guard / sellWiringConformance): a grep over the COMMITTED copy/doc surfaces that asserts the
// SUPERSEDED-as-current valuation terms do NOT appear — the next time someone writes stale moat-tiered-MoS
// or growth-band copy AS CURRENT in a user-facing surface, this fails.
//
// The superseded terms (from the S1 manifest), all retired by the F.13 / Phase-1.6 recalibration:
//   - moat-TIERED margin of safety (per-moat MoS) — collapsed to ONE uniform base MoS.
//   - per-moat MoS VALUES stated as current (monopoly 0.20/0.15, wide 0.30 in an MoS context; "MoS 20%" /
//     monopoly-20% framing) — there is no per-moat MoS table any more.
//   - growth-BAND / band-CEILING — the stacked growth-band-ceilings trio was replaced by ONE named
//     single_growth_cap.
//   - the valuation multiple stated as a HARD CAP / TRUNCATION — the 18× multiple is now a surfaced
//     `cap_exceeded` FLAG (value kept), never a silent truncation.
//
// SCAN SET (narrow, on purpose): the LIVING "current copy" surfaces that describe the system as it is
// TODAY — the architecture docs under docs/architecture/ and the two user-facing strategy components
// (StrategyOverview / LearnTabs). The provider narrative lives in docs/architecture/
// owlfolio-v2-provider-model-support.md (already in the set). Dated point-in-time records (the
// docs/superpowers/dogfood postmortems, plans, specs) are deliberately OUT of scope: they are historical
// snapshots, not living copy, and reframing a dated record would falsify it.
//
// ALLOW-LIST: a few of these surfaces legitimately MENTION a superseded term to say it is RETIRED / is
// NOT what the harness does (the same reason the no-Kelly grep strips comments: the prose names the thing
// to explain what it refuses to be). Each such retirement-describing reference is allow-listed below by
// its EXACT snippet, so the term is permitted there but a NEW stale-as-current usage anywhere else in the
// SAME file still trips. Adding a new legitimate retirement-describing reference is a one-line edit:
// append a `{ file, snippet, reason }` to ALLOW under the right pattern. Keep snippets verbatim.
// ---------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

const ARCH_DIR = join(repoRoot, 'docs', 'architecture')
const COMPONENTS_DIR = join(repoRoot, 'apps', 'web', 'src', 'components')

/** The living copy/doc surfaces the consistency guarantee covers, by repo-relative path. */
const SCAN_SET: string[] = [
  'docs/architecture/owlfolio-v2-buffett-munger-strategy.md',
  'docs/architecture/owlfolio-v2-research-harness-internals.md',
  'docs/architecture/owlfolio-v2-domain-boundaries.md',
  'docs/architecture/owlfolio-v2-provider-model-support.md',
  'apps/web/src/components/StrategyOverview.tsx',
  'apps/web/src/components/LearnTabs.tsx',
]

/** A SUPERSEDED term + the (file → verbatim-snippet) references that legitimately describe it as RETIRED. */
type SupersededPattern = {
  /** Human label for the failure message. */
  label: string
  /** Case-insensitive matcher for the superseded-as-current term. */
  pattern: RegExp
  /**
   * Retirement-describing references to permit. Each removes its exact `snippet` from the file's content
   * before the absence check, so the term is allowed in that one phrasing but a NEW stale usage still trips.
   * ADD HERE when a new legitimate "this is RETIRED / is NOT what we do" reference is introduced.
   */
  allow: Array<{ file: string; snippet: string; reason: string }>
}

const SUPERSEDED_PATTERNS: SupersededPattern[] = [
  {
    label: 'moat-tiered margin of safety (per-moat MoS) — collapsed to one uniform base MoS (F.13)',
    pattern: /moat-tiered/i,
    allow: [
      {
        file: 'docs/architecture/owlfolio-v2-buffett-munger-strategy.md',
        snippet: 'Neither lever is moat-tiered — business quality is not a per-name valuation-loosening knob.',
        reason: '§3 states the discount + MoS are NOT moat-tiered (negation; describes the retired design).',
      },
    ],
  },
  {
    label: 'per-moat MoS values stated as current (monopoly 20%/15%, wide 30% in an MoS context)',
    // monopoly-/wide- followed by a 15/20/30 % MoS figure, or an "MoS 20%/15%/30%" / "monopoly 20%" framing.
    pattern: /\bMoS\s*(?:of\s*)?(?:15|20|30)\s*%|monopoly[\s-]*(?:20|15)\s*%|wide[\s-]*30\s*%(?=[^]{0,40}(?:MoS|margin of safety))/i,
    allow: [],
  },
  {
    label: 'growth-band / band-ceiling — replaced by one named single_growth_cap (Phase 1.3)',
    pattern: /growth[\s-]band|band[\s-]ceiling/i,
    allow: [
      {
        file: 'docs/architecture/owlfolio-v2-buffett-munger-strategy.md',
        snippet:
          'This replaces the retired stacked reinvestment×ROIC + growth-band-ceilings + ROIC-eligibility-gate stack',
        reason: '§4.2 names the RETIRED growth-band-ceilings stack to say it was replaced by one named cap.',
      },
    ],
  },
  {
    label: 'valuation multiple as a HARD cap / truncation — now a surfaced cap_exceeded FLAG (Phase 1.6)',
    // A multiple framed as a hard cap or a (silent) truncation. The current copy says it is NOT one of these.
    pattern: /hard\s*cap|hard\s*truncation|silent(?:ly)?\s*truncat|\btruncat\w*/i,
    allow: [
      {
        file: 'docs/architecture/owlfolio-v2-buffett-munger-strategy.md',
        snippet:
          '**`fv_cap_multiple = 18`** is a **surfaced sanity FLAG, not a hard truncation** (Phase 1.6): when the raw FV exceeds 18× OE the harness sets a `cap_exceeded` flag (which **widens the MoS**) and KEEPS the value. Only at/above `fv_absurd_multiple = 100×` OE is the value discarded as a units/scale-error guard. (The old 18× hard cap is gone.)',
        reason: '§4.3 explicitly says the 18× multiple is a surfaced flag, NOT a hard truncation/hard cap.',
      },
      {
        file: 'apps/web/src/components/StrategyOverview.tsx',
        snippet: '`fair > ${MULTIPLE_CEILING}× OE → surfaced cap_exceeded sanity flag (not a silent truncation)`',
        reason: 'StrategyOverview surfaced-flag worked example states it is NOT a silent truncation.',
      },
      {
        file: 'apps/web/src/components/StrategyOverview.tsx',
        snippet: 'cap_exceeded sanity flag, not be truncated',
        reason: 'StrategyOverview prose: a value above the multiple raises a flag, is NOT truncated.',
      },
      {
        file: 'apps/web/src/components/LearnTabs.tsx',
        snippet: '`fair > ${MULTIPLE_CEILING}× OE → surfaced cap_exceeded sanity flag (not a silent truncation)`',
        reason: 'LearnTabs surfaced-flag worked example states it is NOT a silent truncation.',
      },
      {
        file: 'apps/web/src/components/LearnTabs.tsx',
        snippet: 'owner earnings raises a cap_exceeded flag — surfaced, never silently truncated.',
        reason: 'LearnTabs prose: the multiple raises a surfaced flag, is NEVER silently truncated.',
      },
    ],
  },
]

function readScanned(file: string): string {
  const abs = file.startsWith('docs/architecture/')
    ? join(ARCH_DIR, file.slice('docs/architecture/'.length))
    : join(COMPONENTS_DIR, file.slice('apps/web/src/components/'.length))
  return readFileSync(abs, 'utf8')
}

describe('Phase 8 S6 superseded-term consistency tripwire: no stale recalibration copy as current', () => {
  it('every allow-listed snippet is still PRESENT verbatim (allow-list does not silently rot)', () => {
    for (const { label, allow } of SUPERSEDED_PATTERNS) {
      for (const { file, snippet, reason } of allow) {
        expect(
          readScanned(file),
          `[${label}] allow-listed snippet missing from ${file} (${reason}) — update or remove the allow entry`,
        ).toContain(snippet)
      }
    }
  })

  it('no SUPERSEDED-as-current term appears in the copy/doc scan set outside the allow-list', () => {
    for (const file of SCAN_SET) {
      const original = readScanned(file)
      for (const { label, pattern, allow } of SUPERSEDED_PATTERNS) {
        // Strip the allow-listed retirement-describing snippets for THIS file, then assert absence.
        let remainder = original
        for (const entry of allow) {
          if (entry.file === file) remainder = remainder.split(entry.snippet).join('')
        }
        expect(
          remainder,
          `${file} contains a SUPERSEDED-as-current term [${label}]. If this is a NEW legitimate `
            + `retirement-describing reference, allow-list its exact snippet under that pattern.`,
        ).not.toMatch(pattern)
      }
    }
  })
})
