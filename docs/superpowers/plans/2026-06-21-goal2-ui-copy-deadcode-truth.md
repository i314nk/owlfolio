# Goal 2 — UI/dossier/copy reflect the real system + remove dead old-architecture code

> Manifest-first cleanup + truth-telling UI/copy. Verified against actual behavior (5-agent read-only investigation, 2026-06-21). Each slice: TDD where behavior changes; implementer → spec review → quality review → push. Append-only legacy events must still project.

**Goal:** UI, dossier, and all copy tell the truth about what the system does NOW (model-judges-grounded; reverse-DCF primary; circle/moat/runway = grounded cite-verified theses; MoS from price AND/OR moat; circle config = owner-policy exclusions). Dead old-architecture machinery removed verified-dead-first.

## Load-bearing distinctions (DO NOT violate)
- KEEP: `computeMoatAnchor`/`computeRunwayAnchor` (corroboration), `JUDGMENT_RUBRICS.version` (→ ledger `rubric_version`), `ResolveRubricTierResult` type, `RubricTier` type, `RubricAnchor` type, projection legacy-MoS tolerance (researchCaseProjection.ts:1420-1422), the live two-stage lib (`twoStageValuation`/`creditedGrowth`) as the reference.
- REMOVE: `resolveRubricTier` + dead arg/helper types + `hasSufficientEvidence`/`clampItemScore` (judgmentAnchor.ts); `MOAT_RUBRIC`/`RUNWAY_RUBRIC`/`MANAGEMENT_RUBRIC`/`PREDICTABILITY_RUBRIC` + `tierForScore`/`orderedTiers`/`tierIndex`/`computableItemIds`/`maxTotalScore`/`maxComputableScore` + dead rubric types (judgmentRubrics.ts, collapse JUDGMENT_RUBRICS to {version}); `widenedMarginOfSafety`+`marginOfSafetyForMoat` (buffettMunger.ts).

## Slices (dependency-ordered)

### S1 — Dead rubric removal (safest, independent)
Remove resolveRubricTier + dead supporting types/helpers from judgmentAnchor.ts (prune judgmentRubrics import to `RubricTier`); remove the 4 *_RUBRIC consts + helper fns + dead types from judgmentRubrics.ts, collapse JUDGMENT_RUBRICS to retain `.version`; delete judgmentRubrics.test.ts; SPLIT judgmentAnchor.test.ts (strip resolveRubricTier describe blocks + import, KEEP computeMoatAnchor/computeRunwayAnchor blocks). Verify: anchors live, `.version`→rubric_version projects, ResolveRubricTierResult type intact. Gates.

### S2 — Dead MoS functions
Remove `widenedMarginOfSafety` + `marginOfSafetyForMoat` from buffettMunger.ts + their test references; update strategies/partDConformance.test.ts (drop the dead-symbol import + its F.13 assertion block; keep the live MoS-engine assertions). Gates. (base_margin_of_safety/widening config NOT touched here.)

### S3 — MoS config removal (higher risk; verify consumers first)
Grep every consumer of `base_margin_of_safety` + `margin_of_safety_widening` (zod strategyContract.ts, valuationParams.ts, buffettMunger assembly, valuationConfigEvent path + projection + any config-edit UI, calibration tests). If a config-edit UI surfaces them, decide migrate-or-keep. Remove from contract/zod/params/assembly; keep legacy config events projecting. Bump VALUATION_PARAMS.version. Gates. If consumer surface is larger than expected, STOP and report rather than force.

### S4 — Copy rewrite: StrategyOverview + LearnTabs + WatchlistPanel + PerformancePanel + route metadata
Reverse-DCF primary (forward/two-stage = labeled reference); drop credited-g/"credited rate"/growth-band-as-engine; rubric→grounded cite-verified thesis; circle = model judgment + config=owner-policy exclusions; required-gap/band_low−gap → model-proposed buy-below w/ cited reasoning; MoS-levels caption fix. Re-source StrategyOverview worked example off reverse-DCF (not creditedGrowth/twoStageFairValuePerShare as the engine — may keep forward FV as labeled ref). Preserve all live-rendered config values (Shariah thresholds, valuation/sizing/sell params, lane list, checklist prompts). Gates + visual sanity.

### S6 — Dossier UI rework (biggest)
Retire `createVerdictFormatBlock` (ResearchCasePanel.tsx:711). RE-HOME its 3 unique payloads into the real decision surface: MoS joint judgment (price AND/OR moat, side-by-side: price margin + moat durability thesis), key_wrong_assumption, thesis_break_triggers. Lead order: model thesis + cited reasoning → reverse-DCF read (market-implied vs judged sustainable g) → two hidden assumptions (implied growth + implied exit multiple) → independent bear case → key-wrong + thesis-break → synthesis MoS judgment (sources + adequacy) → model buy-below. Forward-DCF only as labeled reference (already correct in valuation panel — keep). Fix stale ResearchCasePanel labels ("Credited g"→judged growth, "rubric"→grounded thesis, MoS-haircut/band_low−gap comments). Native owl-* (mirror StrategyOverview/designSystem). Update ResearchCaseAuditableDossier.test.tsx (re-home assertions) + ResearchWorkflowPages.test.tsx.

### S7 — Tripwire extend + widen (lock the cleaned surfaces)
Extend supersededTermConsistency.test.ts SUPERSEDED_PATTERNS with: credited-g/credited-rate/credited-growth (as-current), two-stage/forward-DCF-as-headline-engine, per-row rubric/M1-M6/R1-R3 (as-current scoring), MoS-haircut/margin-of-safety-haircut, required-growth-gap/band_low−gap/conservatism-knob, circle-as-config. Widen SCAN_SET to include ResearchCasePanel.tsx, WatchlistPanel.tsx, PipelineObservatory.tsx, PerformancePanel.tsx. MUST run AFTER S4+S6 (else fails on still-stale copy). Tune allow-list for legit retirement-describing snippets.

### S8 — Onboarding e2e migration (BEFORE wizard removal — mandatory order)
Create a test-mode-gated programmatic-init helper (e.g. POST /api/testing/init → initializeSelectedMode, allowing mock-provider+personal-local under OWLFOLIO_TEST_MODE=playwright). Migrate personal-workflow-intake.spec.ts, accounting-monthly.spec.ts, audit-trail-search.spec.ts off the wizard UI onto the helper; rewrite onboarding.spec.ts against /settings/providers (or retire). Update nav assertions for the new SetupCard target. (e2e not run while port 3000 occupied — coordinate.)

### S9 — Wizard removal (after S8 green)
Repoint GuidedConnectionSelect re-exports (OnboardingWizard.test.tsx → import from GuidedConnectionSelect, or delete the test). Delete OnboardingWizard.tsx; convert onboarding/page.tsx to `redirect('/settings/providers')` (mirror app/providers/page.tsx). Repoint 5 prod referrers (AppNavigation:208, UnconfiguredNotice:35, research/new:81, demo.ts:248/278) + fix unit-test referrers (UnconfiguredNotice/DesignSystem:70,166,328/CommandCenter:77,87). Gates + e2e.

## Verification (every slice)
git diff --check; typecheck; test; lint; web slices → next build. Legacy events still project. Final: the four-determinism architecture intact; UI/copy match real behavior; no dead rubric/MoS-fn machinery; tripwire guards the retired terms.
