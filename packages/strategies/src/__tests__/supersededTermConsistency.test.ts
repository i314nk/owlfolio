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
  // Phase-8 cohesion sweep widened the guard onto the now-cleaned dossier/desk copy surfaces (S4 copy
  // rewrite + S6 dossier rework). These are app components, not packages/strategies, so they resolve
  // through the same `apps/web/src/components/` branch of readScanned() as StrategyOverview/LearnTabs.
  'apps/web/src/components/ResearchCasePanel.tsx',
  'apps/web/src/components/WatchlistPanel.tsx',
  'apps/web/src/components/PipelineObservatory.tsx',
  'apps/web/src/components/PerformancePanel.tsx',
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
  /**
   * Optional scan-scope override for THIS pattern (repo-relative paths). Used by the valuation-core
   * revision MoS-as-haircut / fair-value-range patterns, which are scoped to the USER-FACING UI COPY
   * surfaces only: the architecture math doc legitimately still names the MoS engine, so banning the
   * term repo-wide would false-positive on that doc reference. When omitted, the pattern scans SCAN_SET.
   */
  scan?: string[]
}

/** UI-copy-only scan scope (the two user-facing strategy components) for the valuation-core MoS patterns. */
const UI_COPY_SCAN_SET: string[] = [
  'apps/web/src/components/StrategyOverview.tsx',
  'apps/web/src/components/LearnTabs.tsx',
]

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
    // The RETIRED term is the stacked growth-band-CEILINGS trio (a growth-band used as a ceiling). The
    // valuation-core revision's "sustainable-growth band" is a DIFFERENT, current concept (the grounded
    // band the implied growth is judged against) and must NOT trip — so the matcher requires "ceiling".
    label: 'growth-band-ceiling — replaced by one named single_growth_cap (Phase 1.3)',
    pattern: /growth[\s-]band[\s-]ceiling|band[\s-]ceiling/i,
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
    // Valuation-core revision: the MoS-as-PRICE-HAIRCUT knob is retired. Conservatism is now the required
    // GROWTH GAP (growth-points). The legitimate survivors are NOT in the UI-copy scan scope: the
    // qualitative `owner_earnings_valuation.margin_of_safety` lane string lives in ResearchCasePanel, and
    // the post-mortem field lives in packages. (The `widenedMarginOfSafety`/`marginOfSafetyForMoat`
    // functions were removed as dead code.)
    label: 'margin of safety as a PRICE haircut — retired; the model proposes a buy-below with cited reasoning (R1)',
    pattern: /margin of safety|\bMoS\b|fair[\s-]value range|provisional[\s-]*MoS/i,
    scan: UI_COPY_SCAN_SET,
    // RELIGHTENED DECISION (R1): the MoS-as-haircut framing is now fully GONE from the UI copy (the
    // StrategyOverview retirement comment that named "price-discount margin of safety" was removed when the
    // band/gap copy was reframed to model-proposes-buy-below). No allow entry is needed — the term must not
    // appear in the UI copy at all.
    allow: [],
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
  // ─── Phase-8 cohesion sweep: the newly-retired DECISION mechanisms (R1 model-decides rework) ──────────
  //
  // The R1 relight retired the DETERMINISTIC valuation-decision mechanisms in favour of "the MODEL proposes
  // the verdict / valuation / buy-below with cited reasoning; determinism only sanity-CHECKS". Each retired
  // mechanism gets a pattern below. Where a surface legitimately NAMES the retired mechanism to say it is
  // RETIRED / is NOT what the harness does, the exact snippet is allow-listed (anti-rot still enforces it).
  {
    // The credited-growth ENGINE / headline (the buy-below once led with a "credited growth/rate" figure).
    // RETIRED: the model proposes the buy-below with cited reasoning. The pattern targets the spaced/hyphenated
    // ENGINE-label noun phrase ONLY — it deliberately does NOT match the SURVIVING live helpers/fields/shorthand:
    //   - `creditedGrowth(...)` (camelCase exported helper, still the growth-CAP fn) — no hyphen/space, never trips,
    //   - `credited_g_vs_actual` (live post-mortem data key) — underscore, never trips,
    //   - "credited g 4-5%" (the CURRENT Mechanism-3 base-rate shorthand, verbatim in the projection source) —
    //     requires "growth"/"rate"/"g-headline", so the bare "credited g <pct>" base-rate phrasing never trips.
    label: 'credited-growth engine / headline — retired; the model proposes the buy-below with cited reasoning (R1)',
    pattern: /credited[-\s]growth|credited[-\s]rate|credited[-\s]g[-\s]headline/i,
    allow: [],
  },
  {
    // The deterministic required-growth-GAP / buy-below BAND engine (band_low / conservatism knob).
    // RETIRED: there is no deterministic gap/band engine; the buy-below is the model's cited judgement.
    // `band_low` / `required_growth_gap` are retired CODE/DATA identifiers (no live render); the prose
    // references that survive all NAME the engine to say it is RETIRED, and are allow-listed verbatim.
    label: 'required-growth-gap / buy-below band engine (band_low, conservatism knob) — retired (R1)',
    pattern: /required[-\s]?growth[-\s]?gap|required_growth_gap|\bband_low\b|conservatism[-\s]?knob/i,
    allow: [
      {
        file: 'apps/web/src/components/StrategyOverview.tsx',
        snippet: 'the deterministic required_growth_gap / band engine is RETIRED',
        reason: 'StrategyOverview R1 comment names the retired required_growth_gap/band engine to mark it RETIRED.',
      },
      {
        file: 'apps/web/src/components/LearnTabs.tsx',
        snippet: 'the deterministic required_growth_gap / band engine is RETIRED',
        reason: 'LearnTabs R1 comment names the retired required_growth_gap/band engine to mark it RETIRED.',
      },
    ],
  },
  {
    // Margin-of-safety AS A HAIRCUT (the MoS once applied as a deterministic price haircut / knob).
    // RETIRED: the buy-below is the model's cited judgement, not a derived haircut. The pattern is PRECISE —
    // it requires "MoS"/"margin of safety" ADJACENT to "haircut" so it does NOT false-positive on the bare
    // verb "haircut" used for the (current, different) stressed-book-value concept, nor on the "not a derived
    // haircut" / "no deterministic haircut" negations (which lack the MoS adjacency).
    label: 'margin of safety AS A HAIRCUT — retired; the buy-below is the model’s cited judgement (R1)',
    pattern: /margin[-\s]?of[-\s]?safety[-\s]?haircut|MoS[-\s]?haircut|MoS[-\s]?as[-\s]?(?:a[-\s]?)?haircut/i,
    allow: [],
  },
  {
    // Per-row RUBRIC scoring / score-to-tier (judgments were once scored from a rubric into a tier).
    // RETIRED: judgments are grounded, cite-verified theses, not rubric scores. The LearnTabs "Claims, not
    // scores" card NAMES the retired rubric to say there is NONE — allow-listed verbatim (one snippet covers
    // both the per-row-rubric and the score-to-tier matchers, each of which strips it for its own scan).
    label: 'per-row rubric / score-to-tier scoring — retired; grounded cite-verified theses, not rubric scores',
    pattern: /scored from a rubric|rubric of cite|per[-\s]row rubric|score[-\s]?to[-\s]?tier/i,
    allow: [
      {
        file: 'apps/web/src/components/LearnTabs.tsx',
        snippet: 'There is no per-row rubric, no M1–M6, no total-score-to-tier map.',
        reason: 'LearnTabs "Claims, not scores" card NAMES the retired per-row-rubric / score-to-tier to say there is none.',
      },
    ],
  },
  // SKIPPED — "forecasting-humility ceiling/cap": this term is NOT retired. It is the CURRENT name for the
  // single named growth cap (`single_growth_cap = 0.15`) — the strategy doc §"credited/single growth" and the
  // live `creditedGrowth()` helper both describe it as "a forecasting-humility ceiling behind the durable-source
  // requirement, never a license". What was retired is the STACKED growth-band-ceilings TRIO (already guarded by
  // the `growth-band-ceiling` pattern above), not the single forecasting-humility ceiling. A blunt
  // /forecasting-humility (ceiling|cap)/ would false-positive on that legitimate CURRENT backstop copy, so it is
  // intentionally not banned; the cap-is-a-backstop-not-a-lever positive-assertion tests guard the engine framing.
  // NOTE — the harder, more ambiguous retired mechanisms are deliberately NOT given a blunt regex here,
  // because a broad pattern would false-positive on the LEGITIMATE current copy:
  //   - the forward two-stage DCF: it survives as the LABELED REFERENCE cross-check (StrategyOverview's
  //     "forward two-stage … LABELED REFERENCE cross-check", LearnTabs' reference-FV worked example). Banning
  //     "two-stage" / "forward DCF" would trip that legitimate current copy. The positive-assertion tests
  //     (reference-FV-is-a-cross-check, decision-is-the-reverse-DCF) guard it instead.
  //   - circle-of-competence as a CONFIG determinant: the current copy correctly frames the circle as a
  //     grounded MODEL judgement (ResearchCasePanel's circle-competence panel, "Outside the circle of
  //     competence — set aside, not failed"). Banning "circle" would trip that legitimate current copy; the
  //     model-judges-the-circle positive-assertion tests guard the retired "model never decides your circle"
  //     framing instead.
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
    for (const { label, pattern, allow, scan } of SUPERSEDED_PATTERNS) {
      // Each pattern scans its own scope override when present (the valuation-core MoS patterns are
      // UI-copy-only); otherwise the shared SCAN_SET.
      for (const file of scan ?? SCAN_SET) {
        const original = readScanned(file)
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
