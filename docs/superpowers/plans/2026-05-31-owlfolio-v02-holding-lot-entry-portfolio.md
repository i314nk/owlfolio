# Owlfolio v0.2 Holding Lot Entry and Portfolio View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder initial holding values with user-entered lot economics and expose a minimal Portfolio page that projects holdings from the durable ledger.

**Architecture:** Keep broker/trade execution out of scope. The user-authored `holding_opened` event remains the durable transition, but the web form now records explicit shares, cost basis, currency, and opened date. A portfolio projection/view reads from the ledger and summarizes total cost basis so downstream accounting, purification, concentration, and review slices have honest portfolio state to build on.

**Tech Stack:** TypeScript, Next.js App Router, React server components via `createElement`, SQLite event store, Vitest, Playwright.

---

## File structure

- Modify: `packages/workflow/src/holdingWorkflow.ts` — accept optional `opened_at`, validate positive shares/non-negative cost basis, and persist lot economics.
- Modify: `packages/ledger/src/projections/holdingProjection.ts` — project `opened_at` and `total_cost_basis`.
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts` — cover user-entered lot economics in the holding event and projection.
- Modify: `apps/web/src/lib/workflow.ts` — add `OpenPersonalHoldingInput`, parse user-entered lot values, expose `getAppHoldingsFromStore()`.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — cover opening a holding with real shares/cost/date and portfolio projection output.
- Modify: `apps/web/src/app/api/watchlist/[watchlistItemId]/open-holding/route.ts` — parse `FormData` from the POST route and return validation errors for invalid lot inputs.
- Modify: `apps/web/src/components/WatchlistPanel.tsx` — replace one-click placeholder action with a compact initial-lot form.
- Create: `apps/web/src/components/PortfolioPanel.tsx` — render holdings, per-share basis, total cost basis, opened date, and thesis health placeholder.
- Create: `apps/web/src/app/portfolio/page.tsx` — load demo/personal-local holdings and render portfolio page.
- Modify: `apps/web/src/components/CommandCenter.tsx` or command-center actions as needed — link users with open holdings to Portfolio.
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` — component tests for lot-entry form and Portfolio panel.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — fill the initial lot form and verify Portfolio state.

## Task 1: Ledger/workflow lot economics

- [x] Step 1: Write failing tests for `opened_at`, `total_cost_basis`, positive shares, and non-negative cost basis in workflow/projection.
- [x] Step 2: Run RED focused tests.
- [x] Step 3: Implement minimal validation and projection fields.
- [x] Step 4: Run GREEN focused tests.

## Task 2: Web helper, route, and watchlist lot-entry form

- [x] Step 1: Write failing tests for `openPersonalHoldingFromWatchlist(state, id, input)` and rendered shares/cost/date/currency fields.
- [x] Step 2: Run RED focused web tests.
- [x] Step 3: Implement helper parsing, route `FormData`, and compact form UI.
- [x] Step 4: Run GREEN focused web tests.

## Task 3: Portfolio page and e2e

- [x] Step 1: Write failing component/e2e assertions for `/portfolio` showing the recorded holding and total cost basis.
- [x] Step 2: Implement minimal `PortfolioPanel` and `/portfolio` page.
- [x] Step 3: Run focused e2e.
- [x] Step 4: Run final verification:

```bash
git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

## Scope notes

- This slice records user-entered portfolio tracking data only; it does not place broker orders or sync broker accounts.
- Current value, realized/unrealized P&L, cash ledger, concentration, holding reviews, Shariah purification, and monthly accounting remain follow-up slices.
- The Portfolio page may use cost basis as the only monetary value until a market-data/current-price slice exists.
