# Owlfolio v0.2 Remaining Milestones Checklist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement milestone plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a strict, dependency-aware checklist for the remaining Owlfolio v0.2 work needed to reach a genuinely working local app, while treating multi-model support as a real product requirement rather than a post-hoc add-on.

**Architecture:** Keep the current TypeScript/Next.js/SQLite rewrite direction, but force the remaining work through explicit milestone gates: provider-neutral workflow engine first, then certified real-provider execution, then workflow UI/domain completion, then automation/accounting/Shariah, then multi-provider parity and release hardening. Parallel execution is allowed only after contract boundaries are frozen and each lane owns different files/packages.

**Tech Stack:** TypeScript, pnpm workspace, Next.js App Router, React, SQLite, Vitest, Playwright, workspace packages under `packages/`, local worker under `apps/worker`.

---

## Current baseline (already done or in progress)

- [x] Workspace rewrite exists (`apps/web`, `apps/worker`, `packages/ledger`, `packages/shared`, `packages/providers`, `packages/strategies`, `packages/workflow`)
- [x] Durable SQLite ledger exists with migrations, validation, replay, and projections
- [x] Demo vertical slice exists with seeded deterministic workflow
- [x] Browser onboarding and local config flow exist
- [~] Personal-local first research-case intake is implemented on `feat/v02-personal-workflow-intake` but not landed yet
- [ ] Real provider-backed research workflow does not exist yet
- [ ] Worker runtime is still a stub
- [ ] Shariah, purification, accounting, holdings, and provider parity are not complete

---

## Release definition for a "working app"

For Owlfolio v0.2 to count as a working app, all of the following must be true:

- [ ] A normal user can complete onboarding without manual `.env` editing
- [ ] A personal-local user can create, run, review, and advance a real research case
- [ ] Buffett-Munger workflow is executed through Owlfolio-owned orchestration, not a demo-only shortcut
- [ ] Research outputs are source-grounded and written into the durable ledger
- [ ] Strategy compliance, valuation, and Shariah status visibly affect workflow state
- [ ] A user can move from research case -> decision -> watchlist -> holding/review state
- [ ] Monitoring/background tasks run through a real local worker
- [ ] Monthly accounting and purification state are auditable in the app
- [ ] The app supports multiple models/providers with honest status labeling
- [ ] At least one provider is certified end-to-end; any additional provider is either certified or clearly labeled experimental

---

## Strict remaining milestones

### Milestone 1: Land personal-local intake slice

**Depends on:** current feature branch only

- [ ] Review and commit `feat/v02-personal-workflow-intake`
- [ ] Merge the slice into `main`
- [ ] Re-run branch verification on the final merged tree:
  - [ ] `corepack pnpm typecheck`
  - [ ] `corepack pnpm test`
  - [ ] `corepack pnpm e2e`
- [ ] Confirm personal-local mode can do all of the following in-browser:
  - [ ] initialize personal ledger
  - [ ] open command center
  - [ ] create first research case
  - [ ] open that created case
  - [ ] open an empty watchlist state

**Exit criterion:** personal-local mode is no longer a dead end.

**Parallelization:** none worth forcing; finish this first because later work assumes it exists.

---

### Milestone 2: Freeze provider-neutral workflow/runtime contracts

**Depends on:** Milestone 1

- [ ] Define the stable provider capability contract in `packages/providers`
  - [ ] text generation
  - [ ] structured output
  - [ ] tool/function calling
  - [ ] streaming/observability
  - [ ] multi-step tool loop
- [ ] Define the workflow execution contract in `packages/workflow`
  - [ ] specialist run request/response shape
  - [ ] synthesis request/response shape
  - [ ] error/retry/idempotency behavior
  - [ ] ledger update proposal shape
- [ ] Create missing package boundaries if needed:
  - [ ] `packages/research`
  - [ ] `packages/shariah`
  - [ ] `packages/accounting`
  - [ ] `packages/core` (only if shared domain orchestration cannot stay inside existing packages)
- [ ] Define source-ledger record shape and storage path
- [ ] Define certification-test harness shape before adding more provider code
- [ ] Lock provider status semantics in the app:
  - [ ] certified
  - [ ] experimental
  - [ ] unsupported

**Exit criterion:** adapters, workflow engine, and UI can build against the same stable contracts.

**Parallelization:** this milestone should be short and centralized. Do not parallelize coding heavily until these contracts are merged.

---

### Milestone 3: Real Claude-backed default Buffett-Munger workflow

**Depends on:** Milestone 2

- [ ] Implement real Claude adapter behind the provider-neutral contract
- [ ] Add auth/readiness path for Claude that matches onboarding claims
- [ ] Implement real research-case execution APIs/actions
- [ ] Run specialist workflow through Owlfolio orchestration
- [ ] Add synthesis step owned by Owlfolio workflow state transitions
- [ ] Persist source-grounded outputs into the source ledger
- [ ] Implement Buffett-Munger gate evaluation on real workflow outputs
- [ ] Implement valuation policy output and ledger persistence
- [ ] Implement strategy compliance report generation
- [ ] Persist decision draft events from real workflow runs
- [ ] Add UI state for:
  - [ ] running research
  - [ ] failed research
  - [ ] completed draft
  - [ ] compliance/valuation/Shariah statuses
- [ ] Produce Claude certification report covering the spec test set

**Exit criterion:** a personal-local user can run a real Buffett-Munger research case with Claude from start to drafted decision.

**Parallelization:** yes, after Milestone 2:
- Lane A: provider adapter + certification harness
- Lane B: source ledger + workflow events/projections
- Lane C: UI states for research execution/results

---

### Milestone 4: Multi-model support baseline (mandatory)

**Depends on:** Milestone 2 for scaffolding, Milestone 3 for reference implementation

- [ ] Implement OpenAI adapter behind the same provider-neutral contract
- [ ] Reuse the same workflow engine with no provider-specific branching in page/API code
- [ ] Add provider selection UX that stays honest about support level
- [ ] Ensure provider readiness checks work for both Claude and OpenAI
- [ ] Add provider parity tests for:
  - [ ] simple completion
  - [ ] structured output
  - [ ] tool round-trip
  - [ ] multi-step tool loop
  - [ ] specialist run
  - [ ] synthesis
  - [ ] source-grounded research task
- [ ] Decide and implement release rule:
  - [ ] Claude certified + OpenAI experimental minimum, or
  - [ ] Claude certified + OpenAI certified release target
- [ ] Document any model/provider exclusions explicitly in onboarding and docs

**Exit criterion:** Owlfolio can genuinely run the same workflow through multiple providers/models, with truthful capability/status reporting.

**Parallelization:** yes, but only after Milestone 2 contracts are merged. Best split:
- Lane A: OpenAI adapter
- Lane B: parity/certification tests
- Lane C: onboarding/provider-status UI

---

### Milestone 5: Decision, watchlist, and holding lifecycle

**Depends on:** Milestone 3

- [ ] Implement decision review UI/actions
- [ ] Support user approve/reject/edit on drafted decisions
- [ ] Promote approved research cases into watchlist items through real personal-local flow
- [ ] Add buy-zone, thesis health, stale-review, and priority fields where required by the spec
- [ ] Implement holding-opened / holding-reviewed ledger events
- [ ] Add holdings/portfolio projections
- [ ] Add portfolio page with:
  - [ ] holdings
  - [ ] cost basis
  - [ ] current value
  - [ ] concentration
  - [ ] thesis health
  - [ ] review triggers

**Exit criterion:** a user can move from research case -> user decision -> watchlist -> holding state inside the app.

**Parallelization:** yes
- Lane A: decision/watchlist ledger events + projections
- Lane B: watchlist/portfolio UI
- Lane C: promote/open/review actions and tests

---

### Milestone 6: Workflow-centered UI completion

**Depends on:** Milestones 3 and 5 for real data

- [ ] Expand command center to include:
  - [ ] portfolio status
  - [ ] pipeline counts
  - [ ] upcoming reviews
  - [ ] Shariah/purification alerts
  - [ ] provider/setup health
  - [ ] next recommended actions
- [ ] Add research pipeline screen with explicit stages:
  - [ ] discovered
  - [ ] screened
  - [ ] queued for deep dive
  - [ ] in research
  - [ ] draft complete
  - [ ] Shariah review
  - [ ] valuation review
  - [ ] decision pending
  - [ ] watchlist
  - [ ] holding
  - [ ] pass/rejected
  - [ ] stale/due for review
- [ ] Expand research case page to include:
  - [ ] company summary
  - [ ] strategy checklist
  - [ ] specialist findings
  - [ ] source coverage
  - [ ] hard gate status
  - [ ] synthesis verdict
- [ ] Add activity/audit log page
- [ ] Add provider/setup status page

**Exit criterion:** the product feels like a workflow dashboard, not a small demo around isolated pages.

**Parallelization:** yes, once projections exist. UI lanes should avoid editing the same component files at the same time.

---

### Milestone 7: Worker + monitoring automation

**Depends on:** Milestones 3 and 5; benefits from Milestone 6 UI hooks

- [ ] Replace `apps/worker` stub with a real runnable worker process
- [ ] Define scheduled task model and ledger events
- [ ] Implement safe local scheduling for:
  - [ ] review reminders
  - [ ] watchlist monitoring
  - [ ] holding reviews
  - [ ] provider dry runs
- [ ] Log task runs/failures into the activity/audit feed
- [ ] Expose task status in the UI
- [ ] Add end-to-end tests proving worker actions are observable and idempotent

**Exit criterion:** background monitoring exists as a real product capability, not just a planned architecture box.

**Parallelization:** yes
- Lane A: worker runtime + scheduling core
- Lane B: task ledger/events/projections
- Lane C: UI and observability

---

### Milestone 8: Shariah domain completion

**Depends on:** Milestones 3, 5, and 6

- [ ] Implement Shariah policy contract as executable domain logic
- [ ] Add compliance history by company
- [ ] Add ratio/source history and filing linkage
- [ ] Add conditional/pending workflow states
- [ ] Make Shariah status block or warn on watchlist/holding transitions per policy
- [ ] Add Shariah compliance screen in the app
- [ ] Add tests proving Shariah state changes affect downstream workflow correctly

**Exit criterion:** Shariah is a first-class workflow domain, not just a badge/config toggle.

**Parallelization:** yes
- Lane A: domain logic + ledger model
- Lane B: UI/history pages
- Lane C: workflow-gate integration tests

---

### Milestone 9: Purification ledger + monthly accounting

**Depends on:** Milestones 5 and 8; uses worker support from Milestone 7 when available

- [ ] Implement purification obligation/payment events
- [ ] Add purification projections:
  - [ ] owed
  - [ ] paid
  - [ ] remaining balance
  - [ ] source filing/event linkage
- [ ] Implement monthly accounting snapshot events
- [ ] Add monthly accounting projections:
  - [ ] NAV snapshot
  - [ ] cash/invested split
  - [ ] deposits/withdrawals
  - [ ] realized/unrealized P&L
  - [ ] benchmark comparison
- [ ] Generate readable monthly report draft
- [ ] Add UI pages for purification and monthly accounting

**Exit criterion:** Owlfolio covers the post-decision operating workflow, not just research intake.

**Parallelization:** yes
- Lane A: purification domain
- Lane B: accounting domain
- Lane C: UI/reporting surfaces

---

### Milestone 10: Release hardening and parity gate

**Depends on:** Milestones 4 through 9

- [ ] Run full end-to-end regression on demo and personal-local modes
- [ ] Ensure multi-provider behavior matches claimed support levels
- [ ] Ensure onboarding copy, README, and UI claims match reality
- [ ] Add/finish release-quality docs for:
  - [ ] local setup
  - [ ] provider setup
  - [ ] workflow explanation
  - [ ] limitations/support levels
- [ ] Confirm no major spec screen/domain is still placeholder-only
- [ ] Produce release checklist and known-limitations list

**Exit criterion:** v0.2 is honest, demoable, locally operable, and auditable.

**Parallelization:** mostly cleanup parallelization is possible, but keep one owner for the final release gate.

---

## Parallel execution rules

### Safe parallelization points

- [ ] After Milestone 2 contracts are merged, provider, UI, and domain lanes can run in parallel
- [ ] After Milestone 3 lands, lifecycle, worker, and Shariah/accounting lanes can split further
- [ ] Use separate owners/branches per package or page cluster to reduce conflicts
- [ ] Merge contract PRs before downstream feature PRs start rebasing on assumptions

### Unsafe parallelization points

- [ ] Do not parallelize changes that redefine the same provider/workflow interfaces at once
- [ ] Do not let multiple lanes edit the same core projection files without one designated owner
- [ ] Do not build provider-specific shortcuts into pages/APIs while multi-model support is in progress
- [ ] Do not start UI polish for screens whose domain projections do not exist yet

### Recommended parallel lanes

#### Lane P1: Provider platform
- `packages/providers`
- certification harness
- provider readiness and auth integration

#### Lane P2: Research/workflow engine
- `packages/workflow`
- `packages/research`
- source ledger
- research execution APIs

#### Lane P3: Portfolio operating ledger
- holdings
- watchlist/decision transitions
- accounting/purification events and projections

#### Lane P4: UI surfaces
- command center
- research pipeline
- research case page
- watchlist
- portfolio
- audit/provider pages

#### Lane P5: Worker/automation
- `apps/worker`
- scheduled task runtime
- task observability

---

## Recommended implementation order

1. [ ] Milestone 1
2. [ ] Milestone 2
3. [ ] Milestone 3
4. [ ] Milestone 4 in parallel with late Milestone 3 stabilization when safe
5. [ ] Milestone 5 and Milestone 6 in parallel
6. [ ] Milestone 7 in parallel with Milestones 8 and 9 once lifecycle events exist
7. [ ] Milestone 10 last

---

## Hard product guardrails

- [ ] Multi-model support is mandatory; do not regress into a Claude-only v0.1-style architecture
- [ ] Officially supported providers must pass full workflow parity for their claimed status
- [ ] Demo-only shortcuts must not leak into personal-local mode
- [ ] Shariah, purification, and accounting must remain first-class workflow domains
- [ ] Keep the app workflow-first; chat is secondary
- [ ] Keep setup easy and honest; do not require hidden manual environment surgery for the normal path
