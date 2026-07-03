# Shariah Focused Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Shariah compliance from a parallel deep-dive lane into a dedicated, always-run focused pass (`shariahReasoningPass`), mirroring `valuationReasoningPass`; the deep dive drops to 5 lanes.

**Architecture:** A new grounded, cite-checked pass produces the compliance overlay (`sector_status` + `impermissible_income` + cited rationale) during synthesis; the harness's deterministic AAOIFI ratio recompute is unchanged and now reads the overlay from the pass instead of the lane. Fail-closed = flag only (`shariah_deep_screen_incomplete`, verdict never flipped). The shariah lane and its four lane-list registrations are removed.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspace (`@owlfolio/workflow`, `@owlfolio/ledger`, `@owlfolio/strategies`, `@owlfolio/web`). Run tests via `node_modules/.bin/vitest` directly. Spec: `docs/superpowers/specs/2026-07-03-shariah-focused-pass-design.md`.

**Template to mirror:** `packages/workflow/src/valuationReasoningPass.ts` (the whole file) and its invocation in `packages/workflow/src/researchSwarm.ts:1685-1760`. Read both before starting.

---

## File Structure

- **Create** `packages/workflow/src/shariahReasoningPass.ts` — the pass: `ShariahReasoningSchema`, `ShariahReasoningAgentSchema`, `buildShariahReasoningPrompt`, `runShariahReasoningPass`, `ShariahReasoningOutcome`. One responsibility: the grounded compliance overlay.
- **Modify** `packages/workflow/src/researchSwarm.ts` — remove the shariah LANE branch (~1337-1378); invoke `runShariahReasoningPass` during synthesis; rewire `shariahLaneJudgment` (~1412) and `shariahDeepScreenIncomplete` (~1421) to read the pass output; drop the `lane_shariah` role special-case (~1227,1233).
- **Modify** `packages/workflow/src/researchSwarmSchemas.ts` — `SHARIAH_OVERLAY_PROMPT` + `ShariahLaneSchema` + `ShariahJudgmentSchema` relocate to / are re-exported for the pass (keep `ShariahLaneJudgment` type available where consumed).
- **Modify** `packages/workflow/src/strategyResearchPipeline.ts` — `buffettMungerDeepDiveLanes` drops `shariah` (→ 5).
- **Modify** `packages/ledger/src/projections/pipelineProjection.ts` — `PIPELINE_SPECIALIST_LANES` drops `shariah`.
- **Modify** `apps/web/src/components/ResearchCasePanel.tsx` (`orderedLanes`), `StrategyOverview.tsx` (`LANE_DETAILS`), `LearnTabs.tsx` (`laneDetails`), `apps/web/src/lib/researchRunProgress.ts` (`DEEP_DIVE_LANE_TOTAL` 6→5).
- **Tests:** `shariahReasoningPass.test.ts` (new), `researchSwarm.test.ts`, `strategyResearchPipeline.test.ts`, `pipelineSpecialistLanesSync.test.ts`, `researchRunProgress.test.ts`, dossier/copy suites.

---

### Task 1: Create the `shariahReasoningPass` module

**Files:**
- Create: `packages/workflow/src/shariahReasoningPass.ts`
- Test: `packages/workflow/src/__tests__/shariahReasoningPass.test.ts`

- [ ] **Step 1 — write the failing test.** Create `packages/workflow/src/__tests__/shariahReasoningPass.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { ShariahReasoningAgentSchema, buildShariahReasoningPrompt } from '../shariahReasoningPass'

describe('ShariahReasoningAgentSchema', () => {
  it('parses a grounded overlay (sector_status + impermissible_income + citation + proposed_sources)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: 128, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
  it('accepts impermissible_income null (undetermined — never guessed 0)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: null, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('buildShariahReasoningPrompt', () => {
  it('instructs the overlay + that the harness owns the AAOIFI ratios (model supplies grounded inputs only)', () => {
    const prompt = buildShariahReasoningPrompt({
      research_case_id: 'rc_x', ticker: 'MSFT', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    })
    expect(prompt).toMatch(/sector_status/)
    expect(prompt).toMatch(/impermissible_income/)
    expect(prompt).toMatch(/do NOT.*(ratio|purification)/i)
    expect(prompt).toMatch(/null/i) // undetermined allowed, never guess 0
  })
})
```

- [ ] **Step 2 — run it, confirm RED.** `node_modules/.bin/vitest run packages/workflow/src/__tests__/shariahReasoningPass.test.ts` — FAIL (module missing).

- [ ] **Step 3 — implement `shariahReasoningPass.ts`.** Mirror `valuationReasoningPass.ts` structure exactly (imports, the `AgentSchema` wrapping the judgment + `proposed_sources`, `RunShariahReasoningPassArgs` identical shape to `RunValuationReasoningPassArgs`, `runShariahReasoningPass` identical to `runValuationReasoningPass` but with the shariah schema + required fields). The judgment schema:

```typescript
export const ShariahReasoningJudgmentSchema = z.object({
  sector_status: z.enum(['compliant', 'conditional', 'non_compliant']),
  // $M of non-permissible income; null = undetermined (NOT separately disclosed). NEVER guess 0.
  impermissible_income: z.number().min(0).nullable(),
  // GROUNDING: source_id of a VERIFIED primary source confirming the sector/segment basis (real id, not prose).
  sector_citation: z.string().min(1),
})
export const ShariahReasoningAgentSchema = z.object({
  shariah_judgment: ShariahReasoningJudgmentSchema,
  proposed_sources: ProposedSourcesSchema,
})
export type ShariahReasoning = z.infer<typeof ShariahReasoningJudgmentSchema>
export type ShariahReasoningOutcome =
  | { status: 'ok'; shariah_judgment: ShariahReasoning; verified_ids: string[]; captured: CapturedSource[] }
  | { status: 'failed'; reason: string; attempts: number }
```

`buildShariahReasoningPrompt` — reuse the intent of `SHARIAH_OVERLAY_PROMPT` (segment-revenue-confirmed `sector_status`; `impermissible_income` in $M or null, never guess 0; **the harness recomputes the AAOIFI debt/cash/impermissible ratios + verdict + purification % — do NOT compute ratios or purification yourself**) + the grounding/steer block copied from `buildValuationReasoningPrompt` (corpus + preVerified steer, "cite-checked, fails closed"). `runShariahReasoningPass`'s `requiredFields` = `sector_status` present AND `impermissible_income !== undefined` (null counts as present) AND `sector_citation` non-empty; `schema_name: 'BuffettMungerShariahReasoning'`, `run_id: run_${research_case_id}_shariah_reasoning`.

- [ ] **Step 4 — run tests, confirm GREEN.** `node_modules/.bin/vitest run packages/workflow/src/__tests__/shariahReasoningPass.test.ts` — PASS. Typecheck: `cd packages/workflow && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5 — commit.**

```bash
git add packages/workflow/src/shariahReasoningPass.ts packages/workflow/src/__tests__/shariahReasoningPass.test.ts
git commit -m "feat(workflow): add shariahReasoningPass (grounded compliance overlay, mirrors valuation pass)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Invoke the pass in synthesis + rewire `shariahJudgment` from lane → pass

**Files:** Modify `packages/workflow/src/researchSwarm.ts`; Test `packages/workflow/src/__tests__/researchSwarm.test.ts`.

- [ ] **Step 1 — write the failing test.** In `researchSwarm.test.ts`, add a test driving a full swarm run (reuse the existing `swarmFakeProviderWithLaneIds` harness) where the fake provider answers the shariah-reasoning call with `{ shariah_judgment: { sector_status: 'compliant', impermissible_income: 0, sector_citation: 's_ok' }, proposed_sources:[{source grounding 's_ok'}] }`. Assert the emitted `buffett_munger_analysis_drafted` payload carries `shariah_financial` (recomputed from the pass overlay) and `shariah_status` is present — i.e., the compliance recompute now sources its overlay from the pass, not a shariah lane. Mirror the existing shariah-flag test's harness setup.

- [ ] **Step 2 — run it, confirm RED** (the pass isn't invoked yet; `shariahJudgment` still reads the — now absent — lane).

- [ ] **Step 3 — implement.** In `researchSwarm.ts`:
  - Import `runShariahReasoningPass` from `./shariahReasoningPass` (next to the `runValuationReasoningPass` import at line 72).
  - After the lanes/synthesis, ALWAYS invoke the pass (model = the synthesis/decision model; `laneDigest` = the same digest passed to the valuation pass; `corpusSourceIds` + `preVerifiedSourceIds` = the same corpus the valuation pass uses at ~1717). Capture its `shariah_judgment` when `status==='ok'`.
  - Replace `const shariahLaneResult = laneResults.find((l) => l.lane === 'shariah')` (line ~1410) and `const shariahLaneJudgment = shariahLaneResult?.shariah_judgment` (~1412) with `const shariahLaneJudgment = shariahPassOutcome.status === 'ok' ? shariahPassOutcome.shariah_judgment : undefined`. Every downstream reader of `shariahLaneJudgment` (the recompute anchor `shariahJudgment` at ~2487, the synthesis digest at ~1624) now transparently uses the pass output.

- [ ] **Step 4 — run tests.** `node_modules/.bin/vitest run packages/workflow/src/__tests__/researchSwarm.test.ts` — PASS (update any lane-count/harness expectation that assumed a shariah lane, lane-count only). Typecheck the package.

- [ ] **Step 5 — commit.** `git add packages/workflow/src/researchSwarm.ts packages/workflow/src/__tests__/researchSwarm.test.ts && git commit -m "feat(workflow): run shariah reasoning as a focused pass; recompute reads the pass overlay" ...`

---

### Task 3: Rewire `shariah_deep_screen_incomplete` to key off the pass

**Files:** Modify `packages/workflow/src/researchSwarm.ts`; Test `researchSwarm.test.ts`.

- [ ] **Step 1 — write the failing test.** Add a swarm test where the fake provider makes the shariah-reasoning call FAIL to ground (returns an overlay whose `sector_citation` is not in the verified corpus, or the pass returns `status:'failed'`). Assert the `buffett_munger_analysis_drafted` payload has `shariah_deep_screen_incomplete: true` AND `shariah_status` is still present (verdict not flipped) AND the `open_questions` string `shariah_ratios_unverified: shariah_deep_screen_incomplete` is present.

- [ ] **Step 2 — run it, confirm RED** (the flag still keys off `shariahLaneResult.verified_ids`, now always undefined → would misfire or not reflect the pass).

- [ ] **Step 3 — implement.** Replace the flag definition (~1421):
```typescript
const shariahDeepScreenIncomplete = shariahPassOutcome.status !== 'ok'
```
Keep the existing degraded-flag push (~1935) and the payload emission (~3113) unchanged — they already consume `shariahDeepScreenIncomplete`. Remove the now-dead `shariahLaneResult?.judgment_retry_degraded` push (~1931) or re-source it from the pass outcome's `reason`.

- [ ] **Step 4 — run tests + typecheck.** PASS.

- [ ] **Step 5 — commit.**

---

### Task 4: Remove the shariah LANE (deep dive → 5 lanes)

**Files:** `researchSwarm.ts`, `researchSwarmSchemas.ts`, `strategyResearchPipeline.ts`, `pipelineProjection.ts`, their tests.

- [ ] **Step 1 — write the failing test.** In `strategyResearchPipeline.test.ts`:
```typescript
it('runs 5 lanes and does NOT include shariah (owned by the focused shariah pass)', () => {
  expect(buffettMungerDeepDiveLanes).not.toContain('shariah')
  expect([...buffettMungerDeepDiveLanes]).toEqual(['business_quality','moat','management','financial_quality','risks'])
})
```
- [ ] **Step 2 — run it, confirm RED.**
- [ ] **Step 3 — implement:**
  - `strategyResearchPipeline.ts`: drop `'shariah'` from `buffettMungerDeepDiveLanes` (→ 5).
  - `pipelineProjection.ts`: drop `'shariah'` from `PIPELINE_SPECIALIST_LANES`.
  - `researchSwarm.ts`: delete the `if (lane === 'shariah') { … }` branch (~1337-1378); delete the `lane_shariah` special-case in the role resolver (~1227,1233 → shariah no longer a lane); drop `shariah` from `PRIMARY_FILING_LANES` (in `researchSwarmSchemas.ts`) and `RECENT_FILINGS_LANES` if present.
  - `researchSwarmSchemas.ts`: `SHARIAH_OVERLAY_PROMPT`, `ShariahLaneSchema`, `ShariahJudgmentSchema` — keep exported (the pass re-uses their intent; `ShariahLaneJudgment` type is still consumed by the recompute). Only remove the lane WIRING, not the shared types.
- [ ] **Step 4 — run tests + full workflow + ledger suites + both typechecks.** Update the `pipelineSpecialistLanesSync.test.ts` literal to the 5-lane array. PASS.
- [ ] **Step 5 — commit.**

---

### Task 5: UI + copy propagation (5 lanes) + "Shariah is a focused pass" clarification

**Files:** `researchRunProgress.ts` (`DEEP_DIVE_LANE_TOTAL` 6→5 + drift test), `ResearchCasePanel.tsx` (`orderedLanes` drop shariah; the "N lanes" strings 6→5), `StrategyOverview.tsx` (delete `LANE_DETAILS.shariah`; add a "Shariah is a dedicated focused pass" line mirroring the valuation-pass clarification), `LearnTabs.tsx` (delete `laneDetails.shariah`; same clarification), `ResearchRunProgress.tsx` ("six"→"five"). Tests: the four web suites + `ResearchCaseAuditableDossier.test.tsx`.

- [ ] **Step 1 — write the failing test.** In `researchRunProgress.test.ts` assert `DEEP_DIVE_LANE_TOTAL === 5` and `=== buffettMungerDeepDiveLanes.length`.
- [ ] **Step 2 — run it, confirm RED.**
- [ ] **Step 3 — implement** the 6→5 changes across the files above (same mechanical pattern as the valuation-lane removal in commit `ec3a24d`; grep `grep -rniE "6 lane|six lane|of 6 grounded|N/6"` in `apps/web/src` and fix each deep-dive-count reference). Drop `shariah` from the dossier `orderedLanes`; KEEP `deepDiveLaneShortLabel`'s `'shariah'` case (legacy findings). The dossier's Shariah panel (`createHarnessShariahRatios` / `createShariahRatioLedger`) is unchanged — it already reads the recomputed ratios + the flag.
- [ ] **Step 4 — run the four web suites + dossier suite + web typecheck.** Update any dossier test that placed shariah in the specialist grid (it now renders only via the Shariah panel). PASS.
- [ ] **Step 5 — commit.**

---

### Task 6: Full verification + live re-run

- [ ] **Step 1 — offline gates on the whole tree:** `git diff --check`; `node_modules/.bin/tsc --noEmit -p tsconfig.json` + `corepack pnpm -r typecheck`; `node_modules/.bin/vitest run`; `cd apps/web && ../../node_modules/.bin/eslint . --max-warnings=0`; `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`. All green.
- [ ] **Step 2 — live re-run (spends credits; get owner go-ahead):** trigger MSFT + KO on 3005. Confirm: the specialist grid shows **5 lanes** (no shariah); the Shariah panel shows a recomputed verdict + ratios sourced from the pass; when the pass can't ground, the "compliance not deep-verified" caveat shows and the verdict is not flipped; loading screen "N/5".
- [ ] **Step 3 — report** what the run showed (did the shariah pass ground reliably where the lane didn't?).

---

## Self-Review

**Spec coverage:** ✅ new pass (Task 1) · ✅ synthesis invocation + judgment rewire (Task 2) · ✅ flag rewire (Task 3) · ✅ lane removal 6→5 (Task 4) · ✅ UI/copy + clarification (Task 5) · ✅ verification + live re-run (Task 6). Always-run (Task 2, unconditional invoke) and flag-only fail-closed (Task 3) are covered.

**Placeholder scan:** Task 2's "invoke during synthesis" step names the concrete anchors (import at 72, digest/corpus reused from the valuation pass at ~1717, rewire at ~1410-1421) rather than exact inlined 3000-line context — the implementer reads `valuationReasoningPass.ts` + the surrounding researchSwarm block as the template (called out explicitly). No TBDs.

**Type consistency:** `ShariahReasoning` / `shariah_judgment` (sector_status, impermissible_income, sector_citation), `runShariahReasoningPass`, `ShariahReasoningOutcome`, `shariahDeepScreenIncomplete`, `buffettMungerDeepDiveLanes` (5), `DEEP_DIVE_LANE_TOTAL` (5) are consistent across tasks. The recompute reads `shariahJudgment` (unchanged variable; only its source changes lane→pass).
