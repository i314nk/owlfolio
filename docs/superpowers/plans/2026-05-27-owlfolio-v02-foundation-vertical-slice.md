# Owlfolio v0.2 Foundation + Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest working TypeScript v0.2 vertical slice: local Next.js app, SQLite-backed append-only ledger, deterministic mocked provider, Buffett-Munger demo research case, gate/status display, and user-confirmed watchlist draft promotion.

**Architecture:** Implement the ledger, strategy contract, provider contract, and workflow projection first, then build the UI on top. The vertical slice uses a mocked provider and seeded demo data so the app is useful before real provider certification begins.

**Tech Stack:** TypeScript, pnpm workspace, Next.js, React, Zod, Vitest, Playwright, SQLite via a small ledger adapter.

---

## Scope

This plan implements Milestone 0 and Milestone 1 from the v0.2 design spec.

It does not implement:

- real Claude/OpenAI providers
- full research automation
- full monthly accounting workflow
- full purification workflow
- Python import/migration
- desktop packaging
- broker integration

## File structure

Create or replace the repository root TypeScript workspace on the `v02-typescript-rewrite` branch.

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
playwright.config.ts
apps/
  web/
    package.json
    next.config.mjs
    tsconfig.json
    src/app/layout.tsx
    src/app/page.tsx
    src/app/onboarding/page.tsx
    src/app/research/[caseId]/page.tsx
    src/app/watchlist/page.tsx
    src/components/CommandCenter.tsx
    src/components/ResearchCasePanel.tsx
    src/components/StatusBadge.tsx
    src/lib/demo.ts
  worker/
    package.json
    tsconfig.json
    src/index.ts
packages/
  shared/
    package.json
    src/ids.ts
    src/time.ts
  ledger/
    package.json
    src/eventEnvelope.ts
    src/eventStore.ts
    src/memoryStore.ts
    src/projections/researchCaseProjection.ts
    src/projections/watchlistProjection.ts
    src/demoSeed.ts
    src/__tests__/eventStore.test.ts
    src/__tests__/replay.test.ts
    src/__tests__/idempotency.test.ts
  strategies/
    package.json
    src/strategyContract.ts
    src/buffettMunger.ts
    src/evaluateGates.ts
    src/__tests__/buffettMunger.test.ts
  providers/
    package.json
    src/providerContract.ts
    src/mockProvider.ts
    src/runProviderTask.ts
    src/__tests__/mockProvider.test.ts
  workflow/
    package.json
    src/researchWorkflow.ts
    src/watchlistWorkflow.ts
    src/__tests__/verticalSlice.test.ts
```

## Task 1: Workspace skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/*/package.json`

- [ ] **Step 1: Create workspace manifests**

Create root `package.json` with scripts:

```json
{
  "name": "owlfolio-v02",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @owlfolio/web dev",
    "worker": "pnpm --filter @owlfolio/worker dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@types/node": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile is created and install exits 0.

- [ ] **Step 3: Commit workspace skeleton**

Run:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts apps packages pnpm-lock.yaml
git commit -m "chore: create v0.2 typescript workspace"
```

## Task 2: Ledger event contract and in-memory store

**Files:**
- Create: `packages/ledger/src/eventEnvelope.ts`
- Create: `packages/ledger/src/eventStore.ts`
- Test: `packages/ledger/src/__tests__/eventStore.test.ts`

- [ ] **Step 1: Write failing tests for append-only/idempotent events**

Test cases:

- appending an event stores it with immutable envelope fields
- appending the same idempotency key returns the existing event
- attempts to mutate through store API are impossible because only append/read methods exist

Run:

```bash
pnpm test packages/ledger/src/__tests__/eventStore.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 2: Implement minimal event envelope and store**

Define the envelope exactly as in the design spec:

```ts
export type ActorType = 'user' | 'system' | 'provider' | 'worker'
export type AggregateType =
  | 'strategy'
  | 'company'
  | 'research_case'
  | 'watchlist_item'
  | 'holding'
  | 'decision'
  | 'accounting_snapshot'
  | 'purification_entry'
  | 'provider_run'
  | 'scheduled_task'

export type LedgerEventEnvelope<TPayload> = {
  event_id: string
  event_type: string
  aggregate_type: AggregateType
  aggregate_id: string
  causation_id?: string
  correlation_id?: string
  idempotency_key?: string
  actor_type: ActorType
  actor_id?: string
  payload: TPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}
```

Implement `InMemoryEventStore` with:

- `append(event)`
- `list()`
- `listByAggregate(type, id)`
- idempotency-key dedupe

- [ ] **Step 3: Verify tests pass**

Run:

```bash
pnpm test packages/ledger/src/__tests__/eventStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit ledger contract**

```bash
git add packages/ledger
git commit -m "feat(ledger): define append-only event contract"
```

## Task 3: Research case and watchlist projections

**Files:**
- Create: `packages/ledger/src/projections/researchCaseProjection.ts`
- Create: `packages/ledger/src/projections/watchlistProjection.ts`
- Test: `packages/ledger/src/__tests__/replay.test.ts`
- Test: `packages/ledger/src/__tests__/idempotency.test.ts`

- [ ] **Step 1: Write replay tests**

Test a fixed event stream:

1. `research_case_created`
2. `buffett_munger_analysis_drafted`
3. `decision_drafted`
4. `watchlist_draft_created`

Expected projection:

- research case stage is `watchlist_draft`
- investment verdict is `WATCH`
- strategy compliance is `CONDITIONAL`
- Shariah status is `COMPLIANT`
- watchlist draft exists and is not user-approved

- [ ] **Step 2: Implement projection functions**

Implement pure functions:

- `projectResearchCases(events)`
- `projectWatchlist(events)`

They must accept only event arrays and return derived current state.

- [ ] **Step 3: Verify replay and idempotency tests pass**

Run:

```bash
pnpm test packages/ledger/src/__tests__/replay.test.ts packages/ledger/src/__tests__/idempotency.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit projections**

```bash
git add packages/ledger
git commit -m "feat(ledger): add replayable research projections"
```

## Task 4: Buffett-Munger policy contract

**Files:**
- Create: `packages/strategies/src/strategyContract.ts`
- Create: `packages/strategies/src/buffettMunger.ts`
- Create: `packages/strategies/src/evaluateGates.ts`
- Test: `packages/strategies/src/__tests__/buffettMunger.test.ts`

- [ ] **Step 1: Write failing strategy tests**

Test that Buffett-Munger includes:

- certified status
- required specialists: moat, financials, risk, management, valuation, synthesis
- hurdle rates: 12%, 13%, 15%
- Shariah required by default
- at least one blocking hard gate for Shariah, positive owner earnings, leverage safety, valuation completeness

- [ ] **Step 2: Implement strategy contract and Buffett-Munger policy**

Create Zod schemas for:

- strategy metadata
- specialist definitions
- hard gates
- valuation policy
- Shariah policy
- portfolio policy

Export `buffettMungerStrategy`.

- [ ] **Step 3: Implement gate evaluator**

Implement `evaluateGates(strategy, facts)` returning:

- `COMPLIANT`
- `CONDITIONAL`
- `NON_COMPLIANT`
- `INSUFFICIENT_DATA`

The alpha can use explicit demo facts rather than live financial data.

- [ ] **Step 4: Verify tests pass and commit**

```bash
pnpm test packages/strategies/src/__tests__/buffettMunger.test.ts
git add packages/strategies
git commit -m "feat(strategies): define certified buffett munger policy"
```

## Task 5: Provider contract and mocked provider

**Files:**
- Create: `packages/providers/src/providerContract.ts`
- Create: `packages/providers/src/mockProvider.ts`
- Create: `packages/providers/src/runProviderTask.ts`
- Test: `packages/providers/src/__tests__/mockProvider.test.ts`

- [ ] **Step 1: Write failing provider contract tests**

Test that a mocked provider can:

- return structured JSON matching a Zod schema
- perform a deterministic tool-call-like workflow
- fail safely on invalid output
- record run metadata with provider ID, model ID, timeout, budget, and tool allowlist

- [ ] **Step 2: Implement provider interface**

Define methods:

- `complete(request)`
- `structured(request, schema)`
- `runWithTools(request)`

Provider outputs must not write ledger events directly.

- [ ] **Step 3: Implement mocked Buffett-Munger provider output**

Return a deterministic canned analysis for one demo company with:

- investment verdict: WATCH
- strategy compliance: CONDITIONAL
- Shariah status: COMPLIANT
- valuation status: EXPENSIVE or FAIR
- next required action
- source IDs

- [ ] **Step 4: Verify tests pass and commit**

```bash
pnpm test packages/providers/src/__tests__/mockProvider.test.ts
git add packages/providers
git commit -m "feat(providers): add mocked provider contract"
```

## Task 6: Vertical research workflow

**Files:**
- Create: `packages/workflow/src/researchWorkflow.ts`
- Create: `packages/workflow/src/watchlistWorkflow.ts`
- Test: `packages/workflow/src/__tests__/verticalSlice.test.ts`

- [ ] **Step 1: Write failing vertical slice test**

Test flow:

1. seed demo company
2. create research case
3. run mocked Buffett-Munger analysis
4. append draft analysis event
5. append decision draft event
6. user confirms watchlist draft
7. projection shows watchlist draft with user actor attribution

- [ ] **Step 2: Implement workflow functions**

Functions:

- `createResearchCase(command)`
- `runDemoBuffettMungerAnalysis(command)`
- `draftDecision(command)`
- `confirmWatchlistDraft(command)`

All functions append events. None mutate projections directly.

- [ ] **Step 3: Verify tests pass and commit**

```bash
pnpm test packages/workflow/src/__tests__/verticalSlice.test.ts
git add packages/workflow
git commit -m "feat(workflow): add buffett munger vertical slice"
```

## Task 7: Next.js command center UI

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/CommandCenter.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/lib/demo.ts`

- [ ] **Step 1: Create app shell**

Implement a local dashboard that renders:

- product name
- setup status
- provider status: Mock provider / demo mode
- strategy: Buffett-Munger certified
- pipeline counts
- next recommended action

- [ ] **Step 2: Wire demo projection into the dashboard**

Use deterministic demo data from `apps/web/src/lib/demo.ts` and projections from `packages/ledger`.

- [ ] **Step 3: Run app**

```bash
pnpm dev
```

Expected: app starts and prints a local URL. Opening the URL shows the command center.

- [ ] **Step 4: Commit UI shell**

```bash
git add apps/web
git commit -m "feat(web): add workflow command center"
```

## Task 8: Research case and watchlist pages

**Files:**
- Create: `apps/web/src/app/research/[caseId]/page.tsx`
- Create: `apps/web/src/app/watchlist/page.tsx`
- Create: `apps/web/src/components/ResearchCasePanel.tsx`

- [ ] **Step 1: Add research case page**

Display:

- company/ticker
- workflow stage
- investment verdict
- strategy compliance
- Shariah status
- valuation status
- gate checklist
- source IDs
- next required action

- [ ] **Step 2: Add watchlist page**

Display draft watchlist item with:

- ticker
- strategy
- thesis summary
- buy-zone status if present
- user-confirmed/draft state

- [ ] **Step 3: Verify browser navigation**

Run:

```bash
pnpm dev
```

Expected: command center links to research case and watchlist pages.

- [ ] **Step 4: Commit pages**

```bash
git add apps/web
git commit -m "feat(web): show research case and watchlist workflow"
```

## Task 9: Onboarding/demo mode smoke test

**Files:**
- Create: `apps/web/src/app/onboarding/page.tsx`
- Create: `playwright.config.ts`
- Create: `apps/web/e2e/demo-mode.spec.ts`

- [ ] **Step 1: Add onboarding page**

The page must show:

- Demo mode option
- Personal local mode disabled or marked coming later
- Provider: Mock provider / demo mode
- Strategy: Buffett-Munger
- Shariah: enabled by default

- [ ] **Step 2: Add Playwright smoke test**

Test:

- app loads
- onboarding page renders
- demo mode link reaches command center
- command center shows Buffett-Munger and Shariah enabled
- research case page shows strategy compliance and Shariah status

- [ ] **Step 3: Run E2E test**

```bash
pnpm e2e
```

Expected: PASS.

- [ ] **Step 4: Commit onboarding smoke test**

```bash
git add apps/web playwright.config.ts
git commit -m "test(web): add demo onboarding smoke test"
```

## Task 10: Foundation verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-owlfolio-v02-typescript-design.md` only if implementation exposes necessary spec corrections
- Create: `docs/superpowers/plans/2026-05-27-owlfolio-v02-next-milestone.md` only after this vertical slice passes

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm test
pnpm e2e
```

Expected: all pass.

- [ ] **Step 2: Verify safety invariants manually**

Confirm:

- mocked provider does not write ledger events directly
- watchlist promotion has user actor attribution
- no buy/sell decision can be marked user-approved by provider or worker
- demo mode works without credentials
- events replay into the same projection deterministically

- [ ] **Step 3: Commit verification docs if changed**

```bash
git status --short
git add docs apps packages package.json pnpm-lock.yaml
git commit -m "docs: record v0.2 vertical slice verification"
```

Only commit if verification updates docs or generated fixtures.

## Execution notes

- Use TDD for ledger, strategy, provider, and workflow packages.
- Keep UI thin until projections and workflow functions are stable.
- Do not implement real providers until the mocked provider contract and vertical slice pass.
- Do not create Kanban cards for broad provider/accounting/migration work until Milestone 1 is complete.
- If a task needs a design change, update the spec first, then implement.
