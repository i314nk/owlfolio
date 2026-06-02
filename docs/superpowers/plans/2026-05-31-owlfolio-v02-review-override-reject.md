# Holding Review Override/Reject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user explicitly override or reject an agent-drafted Buffett-Munger holding review before it becomes durable portfolio state.

**Architecture:** Keep provider review drafts immutable and separate from user decisions. Add user-authored `holding_review_overridden` and `holding_review_rejected` events against the existing `holding` aggregate, update projections so overrides become confirmed portfolio state and rejections clear pending review state without changing latest confirmed thesis health.

**Tech Stack:** TypeScript, pnpm workspace, `@owlfolio/workflow`, `@owlfolio/ledger`, Next.js route handlers, React server-rendered component tests, Playwright e2e.

---

### Task 1: RED workflow behavior

**Files:**
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts`

- [x] **Step 1: Add override/reject imports and assertions**

Extend the holding review flow test to import `overrideHoldingReviewDraft` and `rejectHoldingReviewDraft` from `../holdingReviewWorkflow`.

Add a second review draft after the confirmed review and assert override behavior:

```ts
const secondDraft = await draftHoldingReview(store, provider, {
  review_id: 'review_holding_cost_001_2026_12_31',
  holding_id: holding.holding_id,
  model_id: 'mock-buffett-munger-demo',
  causation_id: `evt_holding_review_confirmed_${confirmedReview.review_id}`,
})

const override = await overrideHoldingReviewDraft(store, {
  review_id: secondDraft.review_id,
  holding_id: holding.holding_id,
  causation_id: `evt_holding_review_drafted_${secondDraft.review_id}`,
  actor_id: 'user_local',
  thesis_health: 'WATCH',
  action_stance: 'RESEARCH_MORE',
  rationale: 'User override: moat remains attractive but valuation/concentration require more evidence.',
  evidence_summary: 'Reviewed latest valuation snapshot and original watchlist thesis.',
  uncertainty: 'Need updated debt and Shariah ratio review before increasing exposure.',
  next_review_at: '2026-10-31',
})

expect(override).toMatchObject({
  event_type: 'holding_review_overridden',
  actor_type: 'user',
  user_approved: true,
  user_overrode_provider: true,
  thesis_health: 'WATCH',
  action_stance: 'RESEARCH_MORE',
})
```

Add a third draft and reject it:

```ts
const rejectedDraft = await draftHoldingReview(store, provider, {
  review_id: 'review_holding_cost_001_2027_01_31',
  holding_id: holding.holding_id,
  model_id: 'mock-buffett-munger-demo',
  causation_id: `evt_holding_review_overridden_${secondDraft.review_id}`,
})

const rejection = await rejectHoldingReviewDraft(store, {
  review_id: rejectedDraft.review_id,
  holding_id: holding.holding_id,
  causation_id: `evt_holding_review_drafted_${rejectedDraft.review_id}`,
  actor_id: 'user_local',
  rejection_reason: 'Rejecting stale draft after manual override; wait for fresh evidence.',
})

expect(rejection).toMatchObject({
  event_type: 'holding_review_rejected',
  actor_type: 'user',
  user_approved: false,
  rejection_reason: 'Rejecting stale draft after manual override; wait for fresh evidence.',
})
```

Assert `projectHoldings()` after override/reject:

```ts
expect(projectHoldings(eventsAfterReject)[0]).toMatchObject({
  latest_review_id: secondDraft.review_id,
  thesis_health: 'WATCH',
  action_stance: 'RESEARCH_MORE',
  latest_review_rationale: 'User override: moat remains attractive but valuation/concentration require more evidence.',
  next_review_at: '2026-10-31',
})
expect(projectHoldings(eventsAfterReject)[0]?.pending_review_id).toBeUndefined()
```

- [x] **Step 2: Run focused workflow test and verify RED**

Run:

```bash
corepack pnpm test -- packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: fail because override/reject workflow functions are not implemented yet.

---

### Task 2: GREEN workflow and projection

**Files:**
- Modify: `packages/workflow/src/holdingReviewWorkflow.ts`
- Modify: `packages/ledger/src/projections/holdingProjection.ts`

- [x] **Step 1: Add workflow commands/events**

In `holdingReviewWorkflow.ts`, add:
- `OverrideHoldingReviewDraftCommand`
- `RejectHoldingReviewDraftCommand`
- `HoldingReviewOverriddenPayload`
- `HoldingReviewRejectedPayload`
- `overrideHoldingReviewDraft()`
- `rejectHoldingReviewDraft()`

Override must find the pending draft, append `holding_review_overridden` with `actor_type: 'user'`, preserve source ids, set `user_approved: true`, and set `user_overrode_provider: true`.

Reject must find the pending draft, append `holding_review_rejected` with `actor_type: 'user'`, preserve source ids, set `user_approved: false`, and store `rejection_reason`.

- [x] **Step 2: Update holding projection**

In `holdingProjection.ts`:
- Treat `holding_review_overridden` like confirmed state: clear pending fields and set latest review fields from the override event.
- Treat `holding_review_rejected` as clearing the matching pending review fields without changing latest confirmed review fields.
- Avoid assigning `undefined` to optional fields under `exactOptionalPropertyTypes`.

- [x] **Step 3: Run focused workflow test and verify GREEN**

Run:

```bash
corepack pnpm test -- packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: pass.

---

### Task 3: RED/GREEN web helpers and component UI

**Files:**
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts`
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
- Modify: `apps/web/src/components/PortfolioPanel.tsx`

- [x] **Step 1: Add web helper tests**

In `workflow.test.ts`, import `overridePersonalHoldingReviewDraft` and `rejectPersonalHoldingReviewDraft`.

After creating a review draft, assert override returns `holding_review_overridden` and projected holding shows user override fields. Then create another draft, reject it, and assert latest confirmed override remains while pending fields are cleared.

- [x] **Step 2: Run web helper test and verify RED**

Run:

```bash
corepack pnpm test -- apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: fail because helpers are not implemented.

- [x] **Step 3: Implement helpers**

In `workflow.ts`, import workflow functions and add:
- `overridePersonalHoldingReviewDraft(state, holdingId, reviewId, input)`
- `rejectPersonalHoldingReviewDraft(state, holdingId, reviewId, input)`

Parse form fields for thesis health, action stance, rationale, evidence summary, uncertainty, next review date, and rejection reason.

- [x] **Step 4: Extend Portfolio UI test**

In component tests, assert pending review cards include:
- editable override fields with labels `Override thesis health`, `Override action stance`, `Override rationale`, `Override evidence summary`, `Override uncertainty`, `Override next review date`
- buttons `Save override` and `Reject strategy review`

- [x] **Step 5: Implement Portfolio UI**

When pending review exists, render three user decisions:
- Confirm strategy review (accept as drafted)
- Save override (form fields prefilled from the draft)
- Reject strategy review (requires rejection reason)

- [x] **Step 6: Run component test and verify GREEN**

Run:

```bash
corepack pnpm test -- apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: pass.

---

### Task 4: API routes and e2e

**Files:**
- Create: `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/override/route.ts`
- Create: `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/reject/route.ts`
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [x] **Step 1: Add API routes**

Create route handlers that read `FormData`, call the corresponding personal-local helper, and redirect to `/portfolio`.

- [x] **Step 2: Extend e2e**

After the existing confirmed review, run another review draft, override it to `WATCH` / `RESEARCH_MORE`, assert the portfolio reflects the override, run a third draft, reject it, assert the latest override remains and pending user actions return to 0.

- [x] **Step 3: Run targeted e2e and full verification**

Run:

```bash
corepack pnpm e2e --grep "personal-local mode can create the first research case"
git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e && NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

Expected: all pass. Revert `apps/web/next-env.d.ts` if it is regenerated by build.
