# Owlfolio v0.2 Manual Portfolio Valuation Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a personal-local user record a manual valuation snapshot for an open holding and show current value, unrealized P&L, and concentration on the Portfolio page.

**Architecture:** Keep broker sync, market-data APIs, cash accounting, realized gains, and automated pricing out of scope. This slice adds a user-authored ledger event (`holding_valuation_recorded`) and projects the latest manual valuation over the existing holding-opened state. Portfolio totals are derived from event replay so the next accounting/purification slices can build on auditable local facts.

**Tech Stack:** TypeScript, Next.js App Router, React server components via `createElement`, SQLite event store, Vitest, Playwright.

---

## File structure

- Modify: `packages/ledger/src/projections/holdingProjection.ts` — apply latest `holding_valuation_recorded` events and derive current value, unrealized P&L, and portfolio weight.
- Modify: `packages/workflow/src/holdingWorkflow.ts` — add `recordHoldingValuationSnapshot()` with validation and user-authored event append.
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts` — cover valuation event/projection after opening a holding.
- Modify: `apps/web/src/lib/workflow.ts` — parse manual valuation inputs, expose `recordPersonalHoldingValuation()`.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — cover web helper validation and projected valuation output.
- Create: `apps/web/src/app/api/portfolio/[holdingId]/valuation/route.ts` — POST form endpoint for manual valuation snapshots.
- Modify: `apps/web/src/components/PortfolioPanel.tsx` — render valuation form and current value/P&L/concentration details.
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` — component assertions for manual valuation UI.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — record a manual valuation after the initial lot and verify Portfolio/Command Center state.

## Task 1: Ledger/workflow valuation projection

- [x] Step 1: Write failing tests for `holding_valuation_recorded`, latest price/current value/unrealized P&L, and concentration.
- [x] Step 2: Run RED focused tests.
- [x] Step 3: Implement minimal workflow command and projection support.
- [x] Step 4: Run GREEN focused tests.

## Task 2: Web helper/API/UI

- [x] Step 1: Write failing helper/component tests for manual valuation form and projected Portfolio output.
- [x] Step 2: Run RED focused web tests.
- [x] Step 3: Implement helper parsing, route, and Portfolio form/details.
- [x] Step 4: Run GREEN focused web tests.

## Task 3: Browser workflow and verification

- [x] Step 1: Extend e2e to record current price after opening a holding and verify current value/P&L/concentration.
- [x] Step 2: Run focused e2e.
- [x] Step 3: Run final verification:

```bash
git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

## Scope notes

- This slice records user-entered current valuation data only; it does not fetch live quotes or sync broker balances.
- Concentration uses holdings with a current market value; holdings without valuation snapshots stay visible but do not contribute to current portfolio value until priced.
- Current value and unrealized P&L are tracking metrics, not accounting statements. Monthly accounting, cash ledger, realized gains, purification, and review triggers remain follow-up slices.
