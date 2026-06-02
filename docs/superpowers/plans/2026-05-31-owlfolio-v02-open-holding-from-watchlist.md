# Owlfolio v0.2 Open Holding From Watchlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a personal-local user turn a confirmed watchlist item into an auditable initial holding/open-position event and see that state in Command Center and the watchlist UI.

**Architecture:** Add a narrow user-owned `holding_opened` ledger event instead of broker integration or order placement. A new workflow command appends the event only from user intent, ledger projections fold it into a holding current-state view and research-case stage, and the web app exposes a personal-local-only POST action from confirmed watchlist items. This is a tracking/audit checkpoint, not trading automation.

**Tech Stack:** TypeScript, Next.js App Router, React server components via `createElement`, SQLite event store, Vitest, Playwright.

---

## File structure

- Create: `packages/workflow/src/holdingWorkflow.ts` — append `holding_opened` events with user actor, linked watchlist/research ids, shares, cost basis, and idempotency.
- Modify: `packages/workflow/src/index.ts` — export holding workflow.
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts` — extend the vertical slice through confirmed watchlist -> opened holding.
- Create: `packages/ledger/src/projections/holdingProjection.ts` — project current holdings from `holding_opened` events.
- Modify: `packages/ledger/src/projections/researchCaseProjection.ts` — add `holding_opened` stage.
- Modify: `packages/ledger/src/projections/commandCenterProjection.ts` — count opened holdings and recommend holding review after watchlist monitoring.
- Modify: `packages/ledger/src/__tests__/commandCenterProjection.test.ts` — cover confirmed watchlist vs opened holding summaries.
- Modify: `apps/web/src/lib/workflow.ts` — expose `openPersonalHoldingFromWatchlist()` and read holding state for display.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — cover personal-local holding opening from a confirmed watchlist item.
- Create: `apps/web/src/app/api/watchlist/[watchlistItemId]/open-holding/route.ts` — POST route for the form action.
- Modify: `apps/web/src/components/WatchlistPanel.tsx` — render a personal-local-only `Record initial holding` form for confirmed non-held watchlist items.
- Modify: `apps/web/src/components/CommandCenter.tsx` and tests — show holding count.
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` — component coverage for the open-holding form and held status.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — browser flow through create -> promote -> confirm -> record holding -> Command Center holding count.

## Task 1: Add holding event, projection, and command-center state

- [x] Step 1: Write failing tests in `packages/workflow/src/__tests__/verticalSlice.test.ts` and `packages/ledger/src/__tests__/commandCenterProjection.test.ts` for `openHoldingFromWatchlist()`, `projectHoldings()`, `research_case.stage === 'holding_opened'`, `pipeline_counts.open_holdings === 1`, and no provider-authored holding events.

- [x] Step 2: Run RED:

```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts
```

Expected: FAIL because holding workflow/projection/counts do not exist.

- [x] Step 3: Implement minimal workflow/projection support:
  - `openHoldingFromWatchlist(store, command)` appends `holding_opened` with `actor_type: 'user'`.
  - payload fields: `holding_id`, `watchlist_item_id`, `research_case_id`, `company_id`, `ticker`, `strategy_id`, `shares`, `cost_basis_per_share`, `currency`, `opened_by_actor_type`, `opened_by_actor_id`, `thesis_summary`.
  - `projectHoldings(events)` folds `holding_opened` events into a current-state list.
  - research cases reach `holding_opened` stage.
  - Command Center counts `open_holdings` and recommends `Review opened holdings for thesis health and sizing` only when no pending watchlist drafts and no confirmed non-held watchlist items remain.

- [x] Step 4: Run GREEN for the focused tests.

## Task 2: Add personal-local helper, route, and UI action

- [x] Step 1: Write failing tests in `apps/web/src/lib/__tests__/workflow.test.ts` and `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` for `openPersonalHoldingFromWatchlist()`, the personal-local-only form action `/api/watchlist/<id>/open-holding`, and hidden action for demo/unconfirmed/already-held items.

- [x] Step 2: Run RED:

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: FAIL because the helper, route, and form do not exist.

- [x] Step 3: Implement minimal web support:
  - `openPersonalHoldingFromWatchlist(state, watchlistItemId)` validates personal-local mode, finds a confirmed watchlist item, and appends `holding_opened` with a tiny default tracking position (`shares: 1`, `cost_basis_per_share: 0`, `currency: 'USD'`) until accounting gets a real lot-entry UI.
  - route redirects back to `/watchlist` after append.
  - `AppWatchlistItem` includes `holding_id` when projected from holdings.
  - `WatchlistPanel` shows `Record initial holding` for confirmed non-held personal-local items and `Holding recorded` after event projection.

- [x] Step 4: Run GREEN for web focused tests.

## Task 3: Extend e2e and run verification

- [x] Step 1: Extend `apps/web/e2e/personal-workflow-intake.spec.ts` to click `Record initial holding`, verify watchlist held status, and verify Command Center open holding count/action.

- [x] Step 2: Run focused e2e:

```bash
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

- [x] Step 3: Run final verification:

```bash
git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e
```

- [x] Step 4: If the full suite is clean, optionally run production build:

```bash
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

## Scope notes

- This slice records a user-owned holding state transition only; it does not place broker trades.
- The default quantity/cost values are intentionally explicit placeholders in the event payload until the next accounting/lot-entry slice adds a real form.
- Shariah, monthly accounting, purification, scheduled monitoring, and buy-zone automation remain follow-up v0.2 slices.
