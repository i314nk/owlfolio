# Strategy-Driven Holding Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, auditable v0.2 slice where the Owlfolio provider/agent drafts a Buffett-Munger holding review and the user explicitly confirms it before it becomes portfolio state.

**Architecture:** Reuse the existing provider -> user confirmation ledger pattern. A provider-authored `holding_review_drafted` event records strategy-driven thesis health, action stance, rationale, uncertainty, source ids, and next review date. A user-authored `holding_review_confirmed` event confirms the draft, and the holding projection exposes only confirmed thesis health as portfolio state while still surfacing a pending review draft for user action.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Playwright, Next.js App Router, SQLite event store, `@owlfolio/providers` structured output, `@owlfolio/ledger` projections.

---

### Task 1: Workflow and ledger projection RED tests

**Files:**
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts`
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [x] **Step 1: Add failing workflow expectations**

Add imports for `draftHoldingReview` and `confirmHoldingReviewDraft` from `../holdingReviewWorkflow`, call them after valuation, and assert:

```ts
const reviewDraft = await draftHoldingReview(store, provider, {
  review_id: 'review_holding_cost_001_2026_06_30',
  holding_id: holding.holding_id,
  model_id: 'mock-buffett-munger-demo',
  causation_id: valuation.event_id,
  idempotency_key: 'holding:holding_cost_001:review:2026-06-30:v1',
})
const reviewConfirmation = await confirmHoldingReviewDraft(store, {
  review_id: reviewDraft.review_id,
  holding_id: holding.holding_id,
  causation_id: reviewDraft.event_id,
  actor_id: 'user_local',
  idempotency_key: 'holding:holding_cost_001:review:2026-06-30:confirm:v1',
})
expect(reviewDraft).toMatchObject({
  holding_id: 'holding_cost_001',
  strategy_id: 'buffett-munger',
  thesis_health: 'HEALTHY',
  action_stance: 'HOLD',
  user_approved: false,
  reviewed_by_actor_type: 'provider',
  reviewed_by_actor_id: 'mock-provider',
})
expect(reviewConfirmation).toMatchObject({
  review_id: reviewDraft.review_id,
  holding_id: 'holding_cost_001',
  thesis_health: 'HEALTHY',
  user_approved: true,
  confirmed_by_actor_type: 'user',
  confirmed_by_actor_id: 'user_local',
})
expect(projectedHoldings[0]).toMatchObject({
  pending_review_id: undefined,
  latest_review_id: reviewDraft.review_id,
  thesis_health: 'HEALTHY',
  action_stance: 'HOLD',
  next_review_at: '2026-09-30',
})
```

- [x] **Step 2: Run focused workflow test and verify RED**

Run:

```bash
corepack pnpm test -- packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: FAIL because `../holdingReviewWorkflow` does not exist.

### Task 2: Minimal workflow implementation

**Files:**
- Create: `packages/workflow/src/holdingReviewWorkflow.ts`
- Modify: `packages/workflow/src/index.ts`
- Modify: `packages/providers/src/mockProvider.ts`

- [x] **Step 1: Implement provider-authored review draft**

Create `draftHoldingReview(store, provider, command)` that:
- finds the holding in `projectHoldings(await store.list())`
- calls `provider.structured()` with schema name `BuffettMungerHoldingReview`
- appends `holding_review_drafted` with `actor_type: 'provider'`
- stores structured fields: `review_id`, `holding_id`, `ticker`, `strategy_id`, `thesis_health`, `action_stance`, `rationale`, `evidence_summary`, `uncertainty`, `next_review_at`, `user_approved: false`, `reviewed_by_actor_type`, `reviewed_by_actor_id`

- [x] **Step 2: Implement user confirmation**

Add `confirmHoldingReviewDraft(store, command)` that:
- finds an unapproved `holding_review_drafted` by review id
- appends `holding_review_confirmed` with `actor_type: 'user'`
- copies the draft fields into the confirmed event and sets `user_approved: true`

- [x] **Step 3: Export the workflow**

Add `export * from './holdingReviewWorkflow'` to `packages/workflow/src/index.ts`.

- [x] **Step 4: Extend MockProvider**

Return a canned `BuffettMungerHoldingReview` payload when `request.response_format.schema_name === 'BuffettMungerHoldingReview'`:

```ts
{
  thesis_health: 'HEALTHY',
  action_stance: 'HOLD',
  rationale: 'The original Buffett-Munger thesis remains intact: durable moat, aligned management, Shariah-compliant operations, and no evidence of thesis drift.',
  evidence_summary: 'Reviewed the existing research case, source ledger references, holding cost basis, and latest valuation snapshot.',
  uncertainty: 'Needs a refreshed primary-source review after the next quarterly filing.',
  next_review_at: '2026-09-30',
  source_ids: ['src_cost_10k_2025', 'src_cost_proxy_2025', 'src_cost_q1_2026']
}
```

- [x] **Step 5: Run focused workflow test and verify GREEN**

Run:

```bash
corepack pnpm test -- packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: PASS.

### Task 3: Holding projection and app helper integration

**Files:**
- Modify: `packages/ledger/src/projections/holdingProjection.ts`
- Modify: `apps/web/src/lib/workflow.ts`

- [x] **Step 1: Project pending and confirmed review state**

Extend `HoldingProjection` with optional review fields:

```ts
pending_review_id?: string
pending_review_thesis_health?: string
pending_review_action_stance?: string
pending_review_rationale?: string
pending_review_next_review_at?: string
latest_review_id?: string
thesis_health?: string
action_stance?: string
latest_review_rationale?: string
latest_review_evidence_summary?: string
latest_review_uncertainty?: string
next_review_at?: string
latest_reviewed_at?: string
```

On `holding_review_drafted`, set pending fields. On `holding_review_confirmed`, clear pending fields and set latest confirmed fields.

- [x] **Step 2: Add web helpers**

Add:

```ts
createPersonalHoldingReviewDraft(state, holdingId)
confirmPersonalHoldingReviewDraft(state, holdingId, reviewId)
```

Both require initialized personal-local mode. The draft helper resolves the provider and model id, then calls `draftHoldingReview`. The confirm helper calls `confirmHoldingReviewDraft`.

- [x] **Step 3: Run web helper focused tests and verify GREEN**

Run:

```bash
corepack pnpm test -- apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: PASS.

### Task 4: Portfolio UI and routes

**Files:**
- Modify: `apps/web/src/components/PortfolioPanel.tsx`
- Create: `apps/web/src/app/api/portfolio/[holdingId]/review/route.ts`
- Create: `apps/web/src/app/api/portfolio/[holdingId]/review/[reviewId]/confirm/route.ts`

- [x] **Step 1: Render pending/confirmed review state**

In `PortfolioPanel`, replace the static “Thesis health pending” badge with:
- confirmed thesis health if `holding.thesis_health` exists
- pending review badge if `holding.pending_review_id` exists
- otherwise “Thesis review pending”

Render a personal-local “Run Buffett-Munger review” form when there is no pending review. Render a “Confirm strategy review” form when `pending_review_id` exists.

- [x] **Step 2: Add POST route for review draft**

`POST /api/portfolio/[holdingId]/review` calls `createPersonalHoldingReviewDraft()` and redirects to `/portfolio`.

- [x] **Step 3: Add POST route for confirmation**

`POST /api/portfolio/[holdingId]/review/[reviewId]/confirm` calls `confirmPersonalHoldingReviewDraft()` and redirects to `/portfolio`.

- [x] **Step 4: Run component test and verify GREEN**

Run:

```bash
corepack pnpm test -- apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: PASS.

### Task 5: E2E and command center polish

**Files:**
- Modify: `packages/ledger/src/projections/commandCenterProjection.ts`
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [x] **Step 1: Make command center recognize pending holding review drafts**

If any holding has `pending_review_id`, include it in `pending_user_actions` and set `next_recommended_action` to `Confirm the drafted strategy review for <ticker>`.

- [x] **Step 2: Extend e2e**

After valuation, click “Run Buffett-Munger review”, assert pending review copy, click “Confirm strategy review”, then assert:
- `Thesis health: HEALTHY`
- `Action stance: HOLD`
- `Next review: 2026-09-30`
- Command Center no longer has pending review action.

- [x] **Step 3: Run targeted e2e and full verification**

Run:

```bash
corepack pnpm e2e --grep "personal-local mode can create the first research case"
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm e2e
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

Expected: all pass. If `apps/web/next-env.d.ts` changes from build generation, revert it unless intentional.
