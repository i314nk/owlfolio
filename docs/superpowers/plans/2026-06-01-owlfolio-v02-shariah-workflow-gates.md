# Owlfolio v0.2 Shariah Workflow Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the T5 Shariah policy core into research-to-watchlist and watchlist-to-holding gates so compliant, conditional, and blocked paths are explicit, user-facing, and ledger-auditable.

**Architecture:** Add a workflow-owned gate module that reads research/holding context from T1 ledger events, evaluates configured Shariah policy via `@owlfolio/shariah`, appends `shariah_evaluation_recorded` and `shariah_gate_decision_recorded` audit events, and throws actionable errors only after recording the gate decision. Extend ledger projections and web helper/component types to surface gate status, reasons, missing evidence, and required sources.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, React server-render component tests, Playwright e2e.

---

### Task 1: Freeze Shariah gate event contract

**Files:**
- Modify: `packages/ledger/src/domainEventContracts.ts`
- Test: `packages/ledger/src/__tests__/domainEventContracts.test.ts`

- [ ] **Step 1: Write the failing test**

Add `shariah_gate_decision_recorded` to the expected event family and assert it belongs to the `shariah_status` projection with payload fields: `gate_decision_id`, `target_transition`, `target_id`, `research_case_id`, `status`, `allowed`, `reasons`, `required_source_ids`, `missing_evidence`, `conditional_allowed`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test -- --run packages/ledger/src/__tests__/domainEventContracts.test.ts`
Expected: FAIL because `shariah_gate_decision_recorded` is not in the frozen contract.

- [ ] **Step 3: Implement minimal contract update**

Add the new event type and contract entry. Use `aggregate_type: 'decision'`, `actor_type: 'system'`, `projection_owner: 'shariah_status'` so the event audits a decision rather than mutating the target entity silently.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test -- --run packages/ledger/src/__tests__/domainEventContracts.test.ts`
Expected: PASS.

### Task 2: Add Shariah gate workflow behavior

**Files:**
- Create: `packages/workflow/src/shariahGateWorkflow.ts`
- Modify: `packages/workflow/src/index.ts`
- Test: `packages/workflow/src/__tests__/shariahGateWorkflow.test.ts`

- [ ] **Step 1: Write failing tests for compliant, conditional, and blocked gates**

Create tests that seed research events, call `evaluateResearchCaseShariahGate`, and assert:
- compliant path returns `allowed: true`, appends evaluation + gate decision, and preserves source ids;
- conditional path with `allow_conditional: true` returns `allowed: true` and `requires_user_confirmation: true`;
- conditional path with `allow_conditional: false`, non-compliant path, and missing evidence path return or throw a blocked decision only after appending a gate decision with reasons and evidence requirements.

- [ ] **Step 2: Run test to verify RED**

Run: `corepack pnpm test -- --run packages/workflow/src/__tests__/shariahGateWorkflow.test.ts`
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement gate workflow**

Implement helpers to collect evidence from analysis payload/source ids, call `policyFromAppConfig` + `evaluateShariahPolicy`, append `shariah_evaluation_recorded`, append `shariah_gate_decision_recorded`, and expose assertion helpers for `watchlist_promotion`, `watchlist_confirmation`, and `holding_open` transitions.

- [ ] **Step 4: Run targeted test to verify GREEN**

Run: `corepack pnpm test -- --run packages/workflow/src/__tests__/shariahGateWorkflow.test.ts`
Expected: PASS.

### Task 3: Gate existing watchlist/holding workflows and projections

**Files:**
- Modify: `packages/workflow/src/watchlistWorkflow.ts`
- Modify: `packages/workflow/src/holdingWorkflow.ts`
- Modify: `packages/ledger/src/projections/watchlistProjection.ts`
- Modify: `packages/ledger/src/projections/holdingProjection.ts`
- Test: `packages/workflow/src/__tests__/verticalSlice.test.ts`
- Test: `packages/ledger/src/__tests__/holdingProjection.test.ts`

- [ ] **Step 1: Write failing integration/projection expectations**

Assert gate decision ids, statuses, reasons, and required source ids are projected onto watchlist items and holdings, and that blocked transitions do not append `watchlist_draft_created`, `watchlist_draft_confirmed`, or `holding_opened` without a prior blocked gate decision.

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/holdingProjection.test.ts`
Expected: FAIL because gate projections and command fields are absent.

- [ ] **Step 3: Implement minimal workflow wiring**

Add optional `shariah_gate` metadata to command payloads for watchlist and holding events, require the app workflow helpers to evaluate/assert the gate before invoking those transitions, and project the latest gate decision by target id.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/holdingProjection.test.ts`
Expected: PASS.

### Task 4: Surface gate reasons in web helpers and components

**Files:**
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/components/ResearchCasePanel.tsx`
- Modify: `apps/web/src/components/WatchlistPanel.tsx`
- Modify: `apps/web/src/components/PortfolioPanel.tsx`
- Test: `apps/web/src/lib/__tests__/workflow.test.ts`
- Test: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`

- [ ] **Step 1: Write failing helper/component tests**

Assert personal-local helpers record gate decisions before promotion/confirmation/opening, blocked errors include reason/source requirements, and Watchlist/Portfolio panels render Shariah gate status plus reasons instead of hiding blocked/conditional state.

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
Expected: FAIL on missing gate fields/copy.

- [ ] **Step 3: Implement web wiring**

Thread `state.config.shariah` into gate evaluation calls, attach projected gate fields to app DTOs, render badges/details for compliant/conditional/blocked/pending gate status, and disable CTA paths only after an audit event exists.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
Expected: PASS.

### Task 5: Browser and final verification

**Files:**
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [ ] **Step 1: Add failing e2e assertions**

Extend personal workflow e2e to verify compliant promotion/opening succeeds, conditional mode shows user-facing confirmation requirements, and blocked/missing-evidence path leaves an audit activity/gate message rather than silently doing nothing.

- [ ] **Step 2: Run targeted e2e RED/GREEN loop**

Run: `NODE_OPTIONS=--disable-warning=ExperimentalWarning npx playwright test apps/web/e2e/personal-workflow-intake.spec.ts`
Expected: RED before implementation, GREEN after component/helper wiring.

- [ ] **Step 3: Run final verification**

Run:
`git diff --check`
`corepack pnpm typecheck`
`corepack pnpm test`
`corepack pnpm lint`
`NODE_OPTIONS=--disable-warning=ExperimentalWarning npx playwright test apps/web/e2e/personal-workflow-intake.spec.ts`
`NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`

- [ ] **Step 4: Request independent review and block for human review**

Use the code-review workflow, leave a `review-required` kanban comment with changed files and tests, then block the card for human review.
