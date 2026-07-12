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
const STRATEGIES_SRC_DIR = join(repoRoot, 'packages', 'strategies', 'src')
const WORKFLOW_SRC_DIR = join(repoRoot, 'packages', 'workflow', 'src')

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

/**
 * F.2 discount-anchor scan scope (the savings-anchored-discount guard, below). The retired stale-discount
 * copy ("flat 8% discount", "constitutional 10%", Treasury-as-the-live-anchor, "falling rates never lower
 * it") slipped through because (a) no discount/flat-rate patterns existed AND (b) the discount-copy
 * surfaces were not all scanned. The corrected copy now lives across the UI components in SCAN_SET PLUS the
 * `packages/strategies/src/` valuation engine/params (buffettMunger.ts, valuationParams.ts) — a root the
 * base SCAN_SET resolver (readScanned) reaches. These paths
 * carry the F.2 discount framing (or its retirement negations) and are scanned ONLY by the discount
 * patterns via their `scan` override, so the engine math doc / other surfaces are not over-scanned.
 */
const DISCOUNT_SCAN_SET: string[] = [
  'apps/web/src/components/StrategyOverview.tsx',
  'apps/web/src/components/LearnTabs.tsx',
  'apps/web/src/components/ResearchCasePanel.tsx',
  'packages/strategies/src/buffettMunger.ts',
  'packages/strategies/src/valuationParams.ts',
  // The valuation specialist-LANE prompt constants live here (VALUATION_LANE_DISCOUNT_NOTE etc.). A
  // Treasury-as-live-anchor or a self-specified required-return/discount in a MODEL-FACING lane prompt is
  // the same discount-lie class as the user-facing copy and must trip going forward — the exact bug F.2
  // fixed in the math/copy but left in the valuation lane prompt. The note's prohibitions are NEGATIONS,
  // phrased so they do NOT match the discount patterns (no allow-list entry needed); a NEW as-current
  // Treasury/required-return line in a prompt still trips.
  'packages/workflow/src/researchSwarmSchemas.ts',
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
    // The strategy doc's book-model rewrite (2026-07) dropped its retirement-describing mention of the
    // stacked growth-band-ceilings trio entirely, so no allow entries remain — any new hit is stale copy.
    allow: [],
  },
  {
    // Valuation-core revision: the MoS-as-PRICE-HAIRCUT knob is retired. Conservatism is now the required
    // GROWTH GAP (growth-points). The legitimate survivors are NOT in the UI-copy scan scope: the
    // qualitative `owner_earnings_valuation.margin_of_safety` lane string lives in ResearchCasePanel, and
    // the post-mortem field lives in packages. (The `widenedMarginOfSafety`/`marginOfSafetyForMoat`
    // functions were removed as dead code.)
    // B2/E2c UPDATE (2026-07-12): "margin of safety" is CURRENT vocabulary again — the BOOK method's
    // rule 7 (buy ≥30% below IV) and rule 8 (load up ≥50% below) are COMPUTED margins off the FCF
    // intrinsic value, owner-locked. What stays retired is the R1-era HAIRCUT/RANGE framing: a
    // "fair-value range" and a "provisional MoS" applied as a price haircut to a forward fair value.
    // The pattern now targets only the retired framings; the book's margin-of-safety copy is current.
    label: 'MoS as a fair-value-range price HAIRCUT — retired framing (R1); the book 30/50 margins are current',
    pattern: /fair[\s-]value range|provisional[\s-]*MoS|MoS[\s-]*haircut|haircut(?:ed)?\s+(?:the\s+)?fair\s+value/i,
    scan: UI_COPY_SCAN_SET,
    allow: [],
  },
  {
    label: 'valuation multiple as a HARD cap / truncation — now a surfaced cap_exceeded FLAG (Phase 1.6)',
    // A multiple framed as a hard cap or a (silent) truncation. The current copy says it is NOT one of these.
    pattern: /hard\s*cap|hard\s*truncation|silent(?:ly)?\s*truncat|\btruncat\w*/i,
    // E2 (2026-07-12): the cap_exceeded machinery is retired with the OE DCF, and the strategy doc's
    // book-model rewrite dropped the 18×-flag passage — no allow entries remain anywhere.
    allow: [],
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
  {
    // CALIBRATION-AS-PARAMETER-FREEZE — DISSOLVED. The owner-curated calibration backtest desk (the
    // /calibration page, run/universe events, queue projection) was removed as dead, closed-loop code. With
    // it goes the "tune-then-FREEZE the params on a calibration cohort" framing (the §9 "blocked on the MoS
    // calibration freeze" copy that staled when F.2 shipped). The PATTERN is scoped to "param"-adjacent
    // FREEZE only, so it deliberately does NOT trip:
    //   - the LIVE forecast/Brier "calibration & integrity" surfacing (a different concept entirely), nor
    //     LearnTabs' learning-loop "calibration file" copy — neither pairs "calibration" with a param freeze;
    //   - the many legitimate "frozen buy-below / frozen IV / frozen golden set" mentions — none pair "frozen"
    //     with "calibration" + "param" within the window.
    // A NEW "calibration freezes the params / parameter-freeze on a calibration cohort" usage anywhere in the
    // living copy surfaces trips this. No allow entries: the concept must not reappear as current.
    label: 'calibration-as-parameter-freeze — dissolved; calibration never tunes-then-freezes the params',
    pattern: /calibration[^.]{0,40}(?:freezes?|frozen)\s+(?:the\s+)?param|param(?:eter)?[-\s]?freeze[^.]{0,40}calibration|calibration[^.]{0,20}param(?:eter)?[-\s]?freeze/i,
    allow: [],
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
  //
  // ─── F.2 cohesion sweep: the RETIRED stale-DISCOUNT-rate framing (the discount-lie class) ──────────────
  //
  // WHY THIS CLASS EXISTS: the stale discount copy ("flat 8% discount", "constitutional 10%",
  // Treasury-as-the-live-anchor, "falling rates never lower it") slipped through because (a) no discount /
  // flat-rate patterns existed here AND (b) the discount-copy surfaces were not all scanned. F.2 swapped the
  // anchor to the COMPLIANT SAVINGS RATE + a uniform equity premium (≈7.5% default,
  // ≈8% rounded in copy), uniform across businesses, tracking the owner's savings rate; Treasury is retired.
  // The copy is now fixed (commits 0073cab / f25c58d) — these patterns LOCK it. Each is scoped to
  // DISCOUNT_SCAN_SET (the UI copy + the strategies engine/params),
  // NOT the math doc, so the live numeric `pct(discountRate(...))` renders and the
  // dotted-path code identifiers are not over-scanned.
  {
    // Flat / constant discount as the framing (a flat N% discount/hurdle, or "falling rates never lower it").
    // Targets "flat <pct?> discount/hurdle" so it CATCHES "all at a flat 8% discount" and the bare "Flat
    // discount" eyebrow, but spares the live numeric renders (which are `pct(discountRate(...))`, no "flat").
    label: 'flat/constant discount — retired; the discount is a savings-anchored rate, not a flat hurdle (F.2)',
    pattern: /flat\s+(?:\d+\s*%\s+)?(?:discount|hurdle)|falling rates never lower it/i,
    scan: DISCOUNT_SCAN_SET,
    allow: [],
  },
  {
    // Constitutional / flat 10% discount: the old "constitutional 10% discount rate" framing. PRECISE — it
    // requires a 10% ADJACENT to discount/hurdle (or the "constitutional N%" phrase), so it does NOT trip on
    // unrelated 10%s: the ResearchCasePanel "incremental ROIC … > 10%" eligibility figure, the LearnTabs
    // "T2 (−10%)" tranche trigger, or the StrategyOverview "−10% \"discount\"" stale-buy-price aside (the
    // quote mark breaks the `10% discount` adjacency).
    label: 'constitutional / flat 10% discount — retired; no constitutional 10% hurdle (F.2)',
    pattern: /constitutional\s+\d+\s*%|\b10\s*%\s+(?:flat\s+)?(?:discount|hurdle)|(?:discount|hurdle)\s+(?:rate\s+)?(?:of\s+)?10\s*%/i,
    scan: DISCOUNT_SCAN_SET,
    allow: [],
  },
  {
    // Treasury AS the live discount anchor (the old "Treasury + equity_premium today" framing). PRECISE — it
    // requires "Treasury/Treasuries" within 40 non-period chars of "+", "plus", "anchor", or "discount", so a
    // blunt /treasury/ flood is avoided. The two CURRENT references that match are the F.2 retirement
    // NEGATIONS ("Treasury anchor is RETIRED" / "Treasury anchor is retired"); they are allow-listed verbatim
    // so the term is permitted in those retirement phrasings but a NEW Treasury-as-live-anchor usage trips.
    // The other Treasury mentions (", which is retired", "(retired)", "Treasury retired.", "treasury_default")
    // do not pair Treasury with +/anchor/discount within the window, so they never match.
    label: 'Treasury as the live discount anchor — retired; the anchor is the compliant savings rate (F.2)',
    pattern: /treasur(?:y|ies)[^.]{0,40}(?:\+|plus|anchor|discount)/i,
    scan: DISCOUNT_SCAN_SET,
    allow: [
      {
        file: 'packages/strategies/src/valuationParams.ts',
        snippet: 'Treasury anchor is RETIRED',
        reason: 'valuationParams ANCHOR-SWAP-F2 comment names the Treasury anchor to say it is RETIRED (negation).',
      },
      {
        file: 'apps/web/src/components/StrategyOverview.tsx',
        snippet: 'Treasury anchor is retired',
        reason: 'StrategyOverview F.2 prose states the interest-bearing Treasury anchor is retired (negation).',
      },
    ],
  },
  {
    // Old equity-bond valuation framing (a different, retired comparison). No current discount surface uses
    // it; banning it locks the framing out of the scanned copy. No allow entries needed.
    label: 'equity-bond valuation framing — retired (F.2)',
    pattern: /equity[-\s]?bond/i,
    scan: DISCOUNT_SCAN_SET,
    allow: [],
  },
]

function readScanned(file: string): string {
  // Resolve the repo-relative path against its root. The base set is arch docs + web components; the F.2
  // discount guard additionally reaches the strategies engine/params.
  let abs: string
  if (file.startsWith('docs/architecture/')) {
    abs = join(ARCH_DIR, file.slice('docs/architecture/'.length))
  } else if (file.startsWith('apps/web/src/components/')) {
    abs = join(COMPONENTS_DIR, file.slice('apps/web/src/components/'.length))
  } else if (file.startsWith('packages/strategies/src/')) {
    abs = join(STRATEGIES_SRC_DIR, file.slice('packages/strategies/src/'.length))
  } else if (file.startsWith('packages/workflow/src/')) {
    abs = join(WORKFLOW_SRC_DIR, file.slice('packages/workflow/src/'.length))
  } else {
    throw new Error(`readScanned: no resolver root for ${file}`)
  }
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

  // F.2 lane-prompt guard: prove the discount patterns WOULD trip on a hypothetical NEW as-current
  // methodology line in a lane prompt (a self-chosen required return / Treasury-as-live-anchor) — the exact
  // bug fixed here (the valuation lane free-lancing a textbook DCF). This is the positive side of the guard:
  // if someone re-introduces that methodology AS CURRENT in researchSwarmSchemas.ts, the absence test above
  // catches it. These synthetic lines stand in for that future regression.
  it('the discount/Treasury patterns CATCH a hypothetical as-current self-required-return / Treasury lane prompt', () => {
    const treasuryPattern = SUPERSEDED_PATTERNS.find((p) =>
      p.label.startsWith('Treasury as the live discount anchor'))?.pattern
    const flat10Pattern = SUPERSEDED_PATTERNS.find((p) =>
      p.label.startsWith('constitutional / flat 10% discount'))?.pattern
    expect(treasuryPattern).toBeDefined()
    expect(flat10Pattern).toBeDefined()
    // A self-chosen Treasury-anchored required return (the model's training prior) trips the Treasury guard.
    expect('discount the cash flows at the 10-year Treasury + a 5.5% equity premium').toMatch(treasuryPattern!)
    expect('anchor the required return to current Treasuries plus a premium').toMatch(treasuryPattern!)
    // A flat-10%-discount methodology trips the flat-10% guard.
    expect('apply a 10% discount rate to the projected owner earnings').toMatch(flat10Pattern!)
    expect('use a discount rate of 10% for the DCF').toMatch(flat10Pattern!)
  })
})
