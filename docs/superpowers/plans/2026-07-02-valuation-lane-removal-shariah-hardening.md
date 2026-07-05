# Valuation-Lane Removal + Shariah-Grounding Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate valuation into ONE authoritative surface (the focused `valuationReasoningPass` + the main Valuation panel) by removing the redundant deep-dive *valuation specialist lane*, add a schema guard so no lane can silently emit placeholder (`"..."`) prose, harden the Shariah lane so a skipped/ungrounded deep re-screen fails closed with a visible "compliance not deep-verified" flag instead of a silently-clean COMPLIANT verdict, and propagate the 7→6-lane change to every user-facing surface that names or counts the lanes (strategy page, learn page, pipeline, and the live research loading screen).

**Architecture:** The 7-lane Buffett-Munger deep-dive swarm becomes 6 lanes (drop `valuation`). Valuation reasoning already lives in the dedicated, cite-checked `valuationReasoningPass` whose output drives the decision's `valuation_rationale` + `proposed_buy_below`; the specialist lane duplicated it and — because its prompt told it "the harness owns the discount" — the model deferred with `"..."`. Before removing the lane we PORT its F.2 discount-ownership guard (no self-chosen WACC / discount rate) into the focused pass so F.2 is never left unguarded. A `finding_summary` refinement rejects placeholder prose across all remaining lanes. Shariah gains a deterministic fail-closed flag on skip.

**Tech Stack:** TypeScript, Zod schemas, Vitest, pnpm workspace (`@owlfolio/workflow`, `@owlfolio/strategies`, `@owlfolio/web`). Run tests with `node_modules/.bin/vitest` directly (the pnpm wrapper's build-approval gate is orthogonal).

---

## File Structure

- `packages/workflow/src/researchSwarmSchemas.ts` — `LaneAgentSchema` (32-37) + `LaneAgentBaseShape` (39-44) hold `finding_summary: z.string().min(1)`. Add a shared placeholder-rejecting refinement. Also holds `VALUATION_LANE_DISCOUNT_NOTE` (397) and `PRIMARY_FILING_LANES` (462) — both lose their `valuation` reference.
- `packages/workflow/src/valuationReasoningPass.ts` — `buildValuationReasoningPrompt`. Gains the ported F.2 discount-ownership sentence.
- `packages/workflow/src/strategyResearchPipeline.ts` — `buffettMungerDeepDiveLanes` (14-22): drop `'valuation'`.
- `packages/workflow/src/researchSwarm.ts` — generic-lane prompt branch (1393) drops the `VALUATION_LANE_DISCOUNT_NOTE` append; shariah skip path (≈1459-1463) gains the deep-screen-incomplete flag emission.
- `packages/ledger/src/projections/researchCaseProjection.ts` — project the shariah deep-screen-incomplete flag onto the case (tolerate legacy absence).
- `apps/web/src/components/ResearchCasePanel.tsx` — `orderedLanes` (2261): drop `'valuation'`; Shariah panel surfaces the incomplete flag.
- `apps/web/src/lib/researchRunProgress.ts:45` — `DEEP_DIVE_LANE_TOTAL = 7` drives the live loading-screen "N/7 specialists" counter; 7→6 + comment sync.
- `apps/web/src/components/ResearchRunProgress.tsx:124` — loading-screen prose "seven specialist lanes".
- `apps/web/src/components/StrategyOverview.tsx` — `LANE_CARDS` iterates `buffettMungerDeepDiveLanes` (auto-adapts to 6); only the dead `LANE_DETAILS.valuation` entry needs deleting.
- `apps/web/src/components/LearnTabs.tsx` — a `valuation:` copy entry (~257): KEEP if it is a general method/dimension glossary (valuation is still a real concept via the focused pass); REMOVE only if it is part of a specialist-lane enumeration.
- `apps/web/src/components/PipelineObservatory.tsx` — renders `drillDown.lanes` dynamically from recorded findings (auto-adapts; verify no "7 lanes" copy).
- Test files: `researchSwarmSchemas.test.ts`, `researchSwarm.test.ts`, `valuationReasoningPass.test.ts` (create if absent), `ResearchCaseAuditableDossier.test.tsx`, `specialistLaneFinding.test.ts`, `researchRunProgress.test.ts`, `StrategyOverview.test.tsx`, `LearnTabs.test.tsx`, `PipelineObservatory.test.tsx`.

---

### Task 1: Placeholder-finding schema guard (no lane may emit `"..."`)

**Files:**
- Modify: `packages/workflow/src/researchSwarmSchemas.ts:32-44`
- Test: `packages/workflow/src/__tests__/researchSwarmSchemas.test.ts`

- [ ] **Step 1: Write the failing test** — append to `researchSwarmSchemas.test.ts`:

```typescript
import { LaneAgentSchema } from '../researchSwarmSchemas'

describe('LaneAgentSchema rejects placeholder finding_summary', () => {
  const valid = { confidence: 'high' as const, caveats: ['ok'], proposed_sources: [] }
  it('rejects a "..." finding_summary (model deferred, no written analysis)', () => {
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: '...' }).success).toBe(false)
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: '   ' }).success).toBe(false)
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: '. -' }).success).toBe(false)
  })
  it('accepts real prose', () => {
    expect(LaneAgentSchema.safeParse({ ...valid, finding_summary: 'Wide, durable moat.' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/researchSwarmSchemas.test.ts -t "placeholder finding_summary"` — Expected: FAIL (`"..."` currently parses because `min(1)` accepts it).

- [ ] **Step 3: Implement** — in `researchSwarmSchemas.ts`, add above `LaneAgentSchema` (line 32) and reuse in both the schema and the base shape:

```typescript
// A lane MUST produce written analysis, not a bare placeholder. `min(1)` accepted "..." (the model
// deferring the valuation lane), which then rendered as an empty lane card. Require at least one
// alphanumeric character so "...", "…", ".", "-", and whitespace fail validation → the agent loop
// retries, and on exhaustion the lane is recorded incomplete rather than emitting empty prose.
const laneFindingSummarySchema = z
  .string()
  .min(1)
  .refine((value) => /[a-z0-9]/i.test(value), {
    message: 'finding_summary must contain written analysis, not a placeholder',
  })
```

Then replace `finding_summary: z.string().min(1),` at BOTH line 33 (`LaneAgentSchema`) and line 40 (`LaneAgentBaseShape`) with `finding_summary: laneFindingSummarySchema,`.

- [ ] **Step 4: Run test to verify it passes** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/researchSwarmSchemas.test.ts` — Expected: PASS (all, including existing).

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/researchSwarmSchemas.ts packages/workflow/src/__tests__/researchSwarmSchemas.test.ts
git commit -m "feat(workflow): reject placeholder lane finding_summary so no lane emits '...'"
```

---

### Task 2: Port the F.2 discount-ownership guard into the focused valuation pass (BEFORE removing the lane)

**Why first:** the valuation *lane's* `VALUATION_LANE_DISCOUNT_NOTE` is currently the only place that tells the model "the harness owns the discount — do NOT specify a WACC / cost of capital / required return." The focused `buildValuationReasoningPrompt` does NOT carry this. Removing the lane without porting the guard would let the focused pass free-lance a discount → F.2 regression. Port it first so F.2 is continuously guarded.

**Files:**
- Modify: `packages/workflow/src/valuationReasoningPass.ts` (`buildValuationReasoningPrompt`)
- Test: `packages/workflow/src/__tests__/valuationReasoningPass.test.ts` (create if absent)

- [ ] **Step 1: Read** `buildValuationReasoningPrompt` in `valuationReasoningPass.ts` to find the returned prompt string and confirm it has no discount-ownership prohibition (grep already confirmed: only citation/grounding language).

- [ ] **Step 2: Write the failing test** — create/append `valuationReasoningPass.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildValuationReasoningPrompt } from '../valuationReasoningPass'

describe('buildValuationReasoningPrompt carries the F.2 discount-ownership guard', () => {
  it('instructs the model NOT to choose its own discount rate / WACC (harness owns the discount)', () => {
    const prompt = buildValuationReasoningPrompt({ ticker: 'MSFT', company_id: 'company_msft' } as never)
    expect(prompt).toMatch(/harness owns the discount/i)
    expect(prompt).toMatch(/do NOT .*(discount rate|WACC|cost of capital|required return)/i)
  })
})
```

Adjust the `buildValuationReasoningPrompt(args)` argument shape to match the real signature discovered in Step 1 (pass the minimum fields it reads; cast `as never` only if the type is broad).

- [ ] **Step 3: Run test to verify it fails** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/valuationReasoningPass.test.ts` — Expected: FAIL (no discount-ownership text).

- [ ] **Step 4: Implement** — in `buildValuationReasoningPrompt`, append this sentence to the prompt string it returns (place it after the existing GROUNDING sentence):

```typescript
  + ` DISCOUNT OWNERSHIP (the harness owns the discount, not you): the harness discounts owner earnings `
  + `deterministically at a single config-driven uniform rate (the compliant savings rate plus a fixed `
  + `equity premium) — the SAME for every business. Do NOT specify, assume, or assert your own discount `
  + `rate, cost of capital, WACC, or required return, and do NOT present a textbook DCF or an intrinsic-value `
  + `range computed off a self-chosen rate; that math is the harness's job. Reason about VALUE only: the `
  + `owner-earnings basis, the durability of growth, and a qualitative cheap / fair / expensive read versus `
  + `today's price.`
```

- [ ] **Step 5: Run test to verify it passes** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/valuationReasoningPass.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow/src/valuationReasoningPass.ts packages/workflow/src/__tests__/valuationReasoningPass.test.ts
git commit -m "feat(workflow): port F.2 discount-ownership guard into the focused valuation pass"
```

---

### Task 3: Remove the valuation deep-dive lane (7 → 6)

**Files:**
- Modify: `packages/workflow/src/strategyResearchPipeline.ts:14-22`
- Modify: `packages/workflow/src/researchSwarm.ts:1393`
- Modify: `packages/workflow/src/researchSwarmSchemas.ts` (`PRIMARY_FILING_LANES` line 462; delete now-unused `VALUATION_LANE_DISCOUNT_NOTE` export ~397)
- Test: `packages/workflow/src/__tests__/strategyResearchPipeline.test.ts`, `researchSwarmSchemas.test.ts`

- [ ] **Step 1: Write the failing test** — append to `strategyResearchPipeline.test.ts`:

```typescript
import { buffettMungerDeepDiveLanes } from '../strategyResearchPipeline'

describe('deep-dive lanes exclude the redundant valuation lane', () => {
  it('runs 6 lanes and does NOT include valuation (owned by the focused valuation pass)', () => {
    expect(buffettMungerDeepDiveLanes).not.toContain('valuation')
    expect(buffettMungerDeepDiveLanes.length).toBe(6)
    expect([...buffettMungerDeepDiveLanes]).toEqual([
      'business_quality', 'moat', 'management', 'financial_quality', 'shariah', 'risks',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/strategyResearchPipeline.test.ts -t "exclude the redundant valuation"` — Expected: FAIL (`valuation` still present, length 7).

- [ ] **Step 3: Implement**
  - `strategyResearchPipeline.ts:14-22` — delete the `'valuation',` line from `buffettMungerDeepDiveLanes`.
  - `researchSwarm.ts:1393` — replace `prompt: basePrompt + (lane === 'valuation' ? VALUATION_LANE_DISCOUNT_NOTE : ''),` with `prompt: basePrompt,` and delete the now-dead F.2 comment block at 1389-1392.
  - `researchSwarm.ts` import list (≈54, 94) — remove `VALUATION_LANE_DISCOUNT_NOTE` from the `researchSwarmSchemas` import.
  - `researchSwarmSchemas.ts:462` — change `PRIMARY_FILING_LANES` to `new Set(['financial_quality', 'shariah', 'moat'])` (drop `'valuation'`).
  - `researchSwarmSchemas.ts` ~390-411 — delete the `VALUATION_LANE_DISCOUNT_NOTE` constant + its comment block.
  - `researchSwarmSchemas.test.ts:2` — remove `VALUATION_LANE_DISCOUNT_NOTE` from the import (it no longer exists).

- [ ] **Step 4: Run tests** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/strategyResearchPipeline.test.ts packages/workflow/src/__tests__/researchSwarmSchemas.test.ts packages/workflow/src/__tests__/researchSwarm.test.ts` — Expected: PASS. `researchSwarm.test.ts` asserts `findingEvents.length === buffettMungerDeepDiveLanes.length - 1` (constant-driven) so it adapts to 6 lanes → 5 findings automatically.

- [ ] **Step 5: Typecheck the package** — Run: `cd packages/workflow && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json` — Expected: no errors (confirms no other consumer references `VALUATION_LANE_DISCOUNT_NOTE`). If tsc flags a reference, delete/redirect it.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow/src/strategyResearchPipeline.ts packages/workflow/src/researchSwarm.ts packages/workflow/src/researchSwarmSchemas.ts packages/workflow/src/__tests__/strategyResearchPipeline.test.ts packages/workflow/src/__tests__/researchSwarmSchemas.test.ts
git commit -m "feat(workflow): remove redundant valuation deep-dive lane (7->6); valuation owned by the focused pass"
```

---

### Task 4: UI — drop valuation from the specialist-lanes grid

**Files:**
- Modify: `apps/web/src/components/ResearchCasePanel.tsx:2261` (`orderedLanes`)
- Test: `apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx`

- [ ] **Step 1: Update the failing tests** — in `ResearchCaseAuditableDossier.test.tsx`:
  - `ALL_LANES` (≈652) → `['business_quality', 'moat', 'management', 'financial_quality', 'shariah', 'risks']`.
  - The "4 of 7 grounded" test (≈654): its 4 findings currently include `valuation`. Change the header assertion to `'Deep-dive specialist lanes (4 of 6 grounded)'` and drop the `valuation` fixture finding (keep moat/shariah/risks + one more real lane, e.g. `financial_quality`), adjusting the incomplete-lane assertions to the remaining ungrounded lanes.
  - The "renders all 7 as normal cards" test (≈685): rename to 6, assert `'Deep-dive specialist lanes (6 of 6 grounded)'`, iterate the 6-lane `ALL_LANES`.
  - The placeholder test I added earlier ("renders a placeholder-prose lane…") uses `valuation` as the empty lane — change that finding's `specialist_lane` to `'financial_quality'` (a lane still in `orderedLanes`) and update the testid assertions to `specialist-lane-incomplete-financial_quality` and the header to `(5 of 6 grounded)`.

- [ ] **Step 2: Run tests to verify they fail** — Run: `node_modules/.bin/vitest run apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx` — Expected: FAIL (grid still lists 7 incl. valuation → "of 7").

- [ ] **Step 3: Implement** — `ResearchCasePanel.tsx:2261`: change `orderedLanes` to `['business_quality', 'moat', 'management', 'financial_quality', 'shariah', 'risks']` (drop `'valuation'`). Leave `deepDiveLaneShortLabel`'s `'valuation'` case in place (harmless — a legacy valuation finding still lands in `remainder` and renders with a correct label).

- [ ] **Step 4: Run tests to verify they pass** — Run: `node_modules/.bin/vitest run apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx apps/web/src/components/__tests__/specialistLaneFinding.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ResearchCasePanel.tsx apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx
git commit -m "feat(web): drop valuation from the specialist-lanes grid (6-lane deep dive)"
```

---

### Task 5: Shariah hardening — fail-closed "deep-screen incomplete" flag on skip

**Context:** the Shariah lane is a `PRIMARY_FILING_LANES` member. On the MSFT run it finished `incomplete` with zero content-hash-verified sources → skipped (no finding), and the dossier still showed **COMPLIANT** (from the quick-screen gate) with no visible "the deep re-screen did not run" caveat. Compliance is a first-class domain; a skipped deep re-screen must be surfaced.

**Files:**
- Modify: `packages/workflow/src/researchSwarm.ts` (shariah skip path ≈1459-1463 / the synthesis flag block ≈2528-2605)
- Modify: `packages/ledger/src/projections/researchCaseProjection.ts` (project the flag, tolerate legacy)
- Modify: `apps/web/src/components/ResearchCasePanel.tsx` (Shariah panel `createHarnessShariahRatios` ≈2151)
- Test: `packages/workflow/src/__tests__/researchSwarm.test.ts`, `apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx`

- [ ] **Step 1: Investigate (read-only, no code)** — Confirm the current behavior with a focused read:
  - In `researchSwarm.ts`, trace whether the shariah **skip** (verified_ids===0 at ≈1460) reaches the `shariah_ratios_unverified` emission block (≈2528-2605). Determine whether the COMPLIANT verdict is currently emitted WITHOUT any unverified flag when the lane skipped (the MSFT synthesis had NO `shariah_ratios_unverified` string — strong signal the skip path is NOT flagged).
  - Note the exact field/flag name the dossier already reads for Shariah caveats (e.g. `shariah_ratios_unverified`), and whether it lives on the synthesis, the decision, or a harness-ratios projection.
  - Record findings in the task's commit message. If the skip path already fails closed and flags, REDUCE this task to only the dossier copy that surfaces it (Steps 5-6) and note that in the commit.

- [ ] **Step 2: Write the failing test** — in `researchSwarm.test.ts`, add a test that drives a deep dive where the shariah lane grounds zero verified sources (reuse the existing `swarmFakeProviderWithLaneIds` harness; make the shariah lane return no verifiable source id, mirroring how the moat-skip test at ≈472 forces one lane out). Assert the recorded synthesis/decision carries a shariah-deep-screen-incomplete flag:

```typescript
it('fails closed with a deep-screen-incomplete flag when the shariah lane grounds nothing', async () => {
  // ...arrange a swarm run where the shariah lane yields zero verified_ids (skipped)...
  // Assert the emitted synthesis (or decision) payload contains the flag string.
  expect(JSON.stringify(recordedSynthesis)).toMatch(/shariah_deep_screen_incomplete|shariah_ratios_unverified/i)
})
```

Match the assertion string to the flag name chosen in Step 3.

- [ ] **Step 3: Run test to verify it fails** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/researchSwarm.test.ts -t "deep-screen-incomplete"` — Expected: FAIL (no flag on the skip path).

- [ ] **Step 4: Implement** — where the shariah lane is detected as skipped/incomplete (the `laneNotes.push(\`${lane.lane}: skipped ...\`)` branch at ≈1462, guarded by `lane.lane === 'shariah'`), set a boolean the synthesis/decision assembler already threads (reuse the `shariah_ratios_unverified` mechanism at ≈2528 if it accepts an external "overlay missing" reason; otherwise add a `shariah_deep_screen_incomplete: true` field to the synthesis payload). Ensure the COMPLIANT/compliance verdict is NOT presented as deep-verified when this flag is set — the flag rides alongside the quick-screen verdict, it does not fabricate a new verdict.

- [ ] **Step 5: Project + display** — in `researchCaseProjection.ts` project the flag onto the case (default `false`/absent for legacy events — tolerate). In `ResearchCasePanel.tsx` `createHarnessShariahRatios`, when the flag is set, render a calm caveat line: `Compliance not deep-verified this run — the Shariah deep re-screen (segment-revenue + impermissible-income) did not ground; the verdict rests on the quick-screen gate. Re-run before relying on it.` Add a render test in `ResearchCaseAuditableDossier.test.tsx` asserting that copy appears when the flag is set and is absent otherwise.

- [ ] **Step 6: Run tests** — Run: `node_modules/.bin/vitest run packages/workflow/src/__tests__/researchSwarm.test.ts packages/ledger/src apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx` — Expected: PASS.

- [ ] **Step 7: (Optional, low-risk) raise the shariah read budget** — if Step 1 showed the lane ran out of tool calls (not a schema-retry), give the shariah lane a modest per-lane `maxToolCalls` bump where lanes receive their budget (≈612/906). Keep it env-overridable; do NOT hardcode a large number. Only do this if Step 1 evidence supports it; otherwise skip and note "budget bump deferred — cause was schema-retry, not budget."

- [ ] **Step 8: Commit**

```bash
git add packages/workflow/src/researchSwarm.ts packages/ledger/src/projections/researchCaseProjection.ts apps/web/src/components/ResearchCasePanel.tsx packages/workflow/src/__tests__/researchSwarm.test.ts apps/web/src/components/__tests__/ResearchCaseAuditableDossier.test.tsx
git commit -m "feat: fail-closed shariah deep-screen-incomplete flag surfaced in the dossier"
```

---

### Task 6: Propagate the 6-lane change to strategy / learn / pipeline / loading surfaces

**Files:**
- Modify: `apps/web/src/lib/researchRunProgress.ts:45` (+ comments at 6, 34, 42, 118)
- Modify: `apps/web/src/components/ResearchRunProgress.tsx:124`
- Modify: `apps/web/src/components/StrategyOverview.tsx` (`LANE_DETAILS`)
- Modify (conditional): `apps/web/src/components/LearnTabs.tsx` (~257)
- Test: `apps/web/src/lib/__tests__/researchRunProgress.test.ts`, `StrategyOverview.test.tsx`, `LearnTabs.test.tsx`, `PipelineObservatory.test.tsx`

- [ ] **Step 1: Write the failing test** — in `researchRunProgress.test.ts`:

```typescript
import { DEEP_DIVE_LANE_TOTAL } from '../researchRunProgress'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'

describe('loading-screen lane total tracks the 6-lane deep dive', () => {
  it('is 6 and stays in sync with buffettMungerDeepDiveLanes', () => {
    expect(DEEP_DIVE_LANE_TOTAL).toBe(6)
    expect(DEEP_DIVE_LANE_TOTAL).toBe(buffettMungerDeepDiveLanes.length)
  })
})
```

(Confirm the exact import path for `buffettMungerDeepDiveLanes` from the web package — mirror how other web tests import `@owlfolio/workflow` subpaths; if the subpath is not exported to web, assert `DEEP_DIVE_LANE_TOTAL === 6` alone.)

- [ ] **Step 2: Run test to verify it fails** — Run: `node_modules/.bin/vitest run apps/web/src/lib/__tests__/researchRunProgress.test.ts -t "6-lane deep dive"` — Expected: FAIL (`DEEP_DIVE_LANE_TOTAL` is 7).

- [ ] **Step 3: Implement**
  - `researchRunProgress.ts:45` — `export const DEEP_DIVE_LANE_TOTAL = 6`. Update the enumerating comments: line 6 `→ 7 lanes →` → `→ 6 lanes →`; line 34 `"N/7"` → `"N/6"`; lines 41-42 drop `valuation` from the listed lanes and say "six … lanes (business_quality, moat, management, financial_quality, shariah, risks)"; line 118 `all seven lanes` → `all six lanes`. KEEP the `'Synthesis & valuation'` stage label at line 67 — valuation still runs (in the focused pass) during the synthesis stage.
  - `ResearchRunProgress.tsx:124` — `seven specialist lanes` → `six specialist lanes`.
  - `StrategyOverview.tsx` — delete the now-dead `valuation:` entry from `LANE_DETAILS` (the `LANE_CARDS = buffettMungerDeepDiveLanes.map(...)` iteration already drops the card; the count at line 143 auto-updates to 6).
  - `LearnTabs.tsx` ~257 — READ the surrounding block first: if the `valuation:` entry is part of a specialist-lane enumeration that iterates `buffettMungerDeepDiveLanes`, delete the dead entry; if it is a general method/dimension glossary (valuation as a concept, not a swarm lane), LEAVE IT — valuation is still first-class via the focused pass. Do not delete legitimate valuation copy.

- [ ] **Step 4: Run tests** — Run: `node_modules/.bin/vitest run apps/web/src/lib/__tests__/researchRunProgress.test.ts apps/web/src/components/__tests__/StrategyOverview.test.tsx apps/web/src/components/__tests__/LearnTabs.test.tsx apps/web/src/components/__tests__/PipelineObservatory.test.tsx` — Expected: PASS. Update any copy test asserting "seven"/"7 lanes" to "six"/"6 lanes".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/researchRunProgress.ts apps/web/src/components/ResearchRunProgress.tsx apps/web/src/components/StrategyOverview.tsx apps/web/src/lib/__tests__/researchRunProgress.test.ts
# add LearnTabs.tsx + any updated copy tests only if changed
git commit -m "feat(web): propagate 6-lane deep dive to strategy/learn/pipeline/loading copy"
```

---

### Task 7: Full verification gates + live re-run validation

- [ ] **Step 1: Offline gates on the whole tree** — Run each; all must pass:

```bash
git diff --check
node_modules/.bin/tsc --noEmit -p tsconfig.json && corepack pnpm -r --config.verify-deps-before-run=false typecheck
node_modules/.bin/vitest run
cd apps/web && ../../node_modules/.bin/eslint . --max-warnings=0
```

Expected: typecheck clean, full vitest suite green, lint clean. Fix any lane-count or `VALUATION_LANE_DISCOUNT_NOTE`-reference fallout the broad run surfaces (StrategyOverview/LearnTabs/PipelineObservatory copy tests may mention "7 lanes" — update copy to "6 lanes" where asserted).

- [ ] **Step 2: Live re-run validation (spends OpenRouter credits — get owner go-ahead first)** — start a fresh MSFT (and one clean-data name, e.g. KO) research run via the 3005 UI with `z-ai/glm-5.2`. Confirm on the dossier: (a) NO valuation specialist lane appears; the Valuation panel still shows full owner-earnings/growth/buy-below reasoning; (b) the specialist-lanes header reads "of 6"; (c) if the shariah lane still skips, the "compliance not deep-verified" caveat is visible; (d) no lane shows a literal `"..."`.

- [ ] **Step 3: Report** — summarize what the re-run showed (did shariah ground this time? does valuation read cleanly from the single surface?) and whether the shariah budget bump (Task 5 Step 7) is warranted.

---

## Self-Review

**Spec coverage:** ✅ Remove valuation lane (Task 3 + 4). ✅ Placeholder guard (Task 1). ✅ Shariah hardening (Task 5). ✅ F.2 protection (Task 2, done BEFORE removal). ✅ Propagate 6-lane change to strategy/learn/pipeline/loading surfaces (Task 6 — the user-requested end step). ✅ Verification incl. paid re-run (Task 7).

**Placeholder scan:** Task 5 intentionally begins with an investigation step because the exact flag wiring depends on whether the skip path already reaches the `shariah_ratios_unverified` block — the step names the precise files/line ranges to read and the decision it drives, and Steps 4-5 give concrete code/copy. No "TBD" remains.

**Type/name consistency:** `buffettMungerDeepDiveLanes` (6 lanes), `laneFindingSummarySchema`, `orderedLanes` (6), `VALUATION_LANE_DISCOUNT_NOTE` (deleted everywhere: schema + researchSwarm import + test import), `PRIMARY_FILING_LANES` (no `valuation`) are used consistently across Tasks 1-5. Ordering guard: Task 2 (port F.2) precedes Task 3 (remove lane) so the discount guard is never absent.
