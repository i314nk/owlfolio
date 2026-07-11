# Phase 3 — Unified Name-Lifecycle State Machine + One Cadence Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express the owner's unifying lifecycle structure — one list of names, each in a state (`candidate → watched → held → exited`), driven by one cadence engine whose **detection is state-independent and whose action branches on state** — by composing the three existing projections behind one read model and refactoring `lifecycleMonitors.ts` into one engine, **without new event types and without changing existing event contracts**.

**Architecture:** Preserve every seam — `agents propose · deterministic harness computes · humans decide`, grounding, params-as-versioned-config. The read model (`nameLifecycleProjection`) and engine (`lifecycleCadence`) are *derived/refactored* layers over the unchanged research-case/watchlist/holding projections + events. The worker migrates **adapter-first**: the new engine goes in behind the existing four task kinds (which become thin pass-throughs), proven equivalent on existing fixtures, before any cadence consolidation.

**Tech Stack:** TypeScript, `@owlfolio/ledger` (projections), `@owlfolio/workflow` (engine + monitors), `apps/worker` (cadence), `apps/web` (UI), vitest.

**The load-bearing discipline (owner, do not regress):** detection is STATE-INDEPENDENT — `detectSignals` takes no `state` argument and yields the same signal set for the same name-data regardless of state. The ONLY place state appears is `selectAction`, written as a `(signal × state)` **lookup table** (total function: every cell is an explicit action or an explicit no-op; a missing pairing throws). Per-state special-casing must not leak into detection — enforced by tests, not convention.

---

## File Structure

- **Create** `packages/ledger/src/projections/nameLifecycleProjection.ts` — read model: one row per name (ticker), derived `state`, `exit_provenance`, aggregated `research_case_id`/`watchlist_item_id`/`holding_id`, locked buy-below, freshness, gate status, and surfaced signals (e.g. `falsifier_tripped`). Composes the three existing projections; adds no events.
- **Create** `packages/workflow/src/lifecycleCadence.ts` — the engine: `detectSignals(name, asOfData)` (state-independent), `selectAction(signal, state)` (the `(signal × state)` table), and the `falsifier_check` / `re_underwrite` pass orchestrators.
- **Modify** `packages/workflow/src/lifecycleMonitors.ts` — keep the pure monitors; `detectSignals` composes them. No monitor gains a state parameter.
- **Modify** `apps/worker/src/runtime.ts` — the four existing task kinds (`watchlist_monitor`, `holdings_monitor`, `shariah_rescreen`, `holding_review_draft`) become thin adapters delegating to the engine; add `falsifier_check` + `re_underwrite` task kinds (scheduled, but the old kinds keep running until a later deprecation).
- **Create** `apps/web/src/app/lifecycle/page.tsx` (+ a `LifecyclePanel` component) — the unified list view (names grouped by state). Final, deferrable slice.
- **Tests** alongside each: `nameLifecycleProjection.test.ts`, `lifecycleCadence.test.ts`, adapter-equivalence tests in/near `runtime.test.ts`, component test for the list.

---

## Task 3.1 — `nameLifecycleProjection` (the read model)

**Files:** Create `packages/ledger/src/projections/nameLifecycleProjection.ts`; Test `packages/ledger/src/__tests__/nameLifecycleProjection.test.ts`.

State derivation (one row per ticker, from existing events only):

| State | Derived from |
|---|---|
| `candidate` | research case in a pre-watchlist stage (or a 13F discovery candidate); not confirmed, not rejected/pass |
| `watched` | `watchlist_draft_confirmed`, no open holding |
| `held` | `holding_opened` with no later `holding_closed` |
| `exited` | `holding_closed` (provenance `sold`) **or** research case `rejected`/`pass` (provenance `screened_out`) |

- [ ] **Step 1 — failing test: state derivation.** Fixture event streams producing one name in each state; assert the derived `state`. Include: a name with a research case only → `candidate`; confirmed watchlist, no holding → `watched`; opened holding → `held`; `holding_closed` → `exited` with `exit_provenance: 'sold'`; research case `rejected` → `exited` with `exit_provenance: 'screened_out'`.
- [ ] **Step 2 — run RED**, confirm fail.
- [ ] **Step 3 — implement** the projection: fold the ledger once, group by ticker, compose the three projections' state, set `state` + `exit_provenance` + aggregated ids + locked buy-below + freshness + gate status.
- [ ] **Step 4 — run GREEN.**
- [ ] **Step 5 — failing test: deteriorating-watched is honest.** A `watched` name whose falsifier has tripped (e.g. Shariah re-screen FAIL, or stale-on-newer-10-K) must project as `state: 'watched'` with a surfaced `falsifier_tripped: true` (+ reason) and `prune_action_available: false` — NOT healthy, NOT a synthetic `exited`/half-state. Assert it does not silently look clean.
- [ ] **Step 6 — implement + GREEN.**
- [ ] **Step 7 — failing test: exit-provenance retained.** A sold former holding and a screened-out reject both `exited` but carry distinct `exit_provenance`; assert both present and distinguishable.
- [ ] **Step 8 — implement + GREEN.**
- [ ] **Step 9 — register the projection** in the projection index/exports following the existing pattern (check how `researchCaseProjection` is exported in `packages/ledger/package.json` + any projection registry). Re-entry note: keep one row per ticker showing CURRENT state; a re-discovered exited name moves back to `candidate` while retaining prior `exit_provenance` as history.
- [ ] **Step 10 — commit:** `feat(ledger): nameLifecycleProjection — one name-list with derived candidate/watched/held/exited state`.

## Task 3.2 — one cadence engine: detect (state-independent) + select (signal × state table)

**Files:** Create `packages/workflow/src/lifecycleCadence.ts`; Test `packages/workflow/src/__tests__/lifecycleCadence.test.ts`; reuse `lifecycleMonitors.ts` (no state param added).

**Signals** (atomic, grounded, computed for every name from whatever data it has — data-absence ≠ state-branching): `stale`, `gated`, `price_crossed_buybelow`, `shariah_breach`, `reunderwrite_due`, `falsifier_tripped`, `over_concentrated`. Each comes from an existing pure monitor (`evaluateCaseFreshness`, `isGateClean`, `evaluateWatchlistBuyWindow`'s price test, `evaluateShariahRescreen`/`evaluateShariahGrace`, `evaluateAnnualRerun`, `evaluateConcentration`).

- [ ] **Step 1 — failing test: `detectSignals` has NO state parameter and is state-invariant.** Assert (a) the function signature accepts name-data + as-of data only (no `state`); (b) for identical name-data, the produced signal set is identical when the name is labeled `candidate`, `watched`, `held`, or `exited` (drive it by passing the same data four times — there is no state input to vary, which is the point; assert the call site cannot pass state). This is the discipline tripwire.
- [ ] **Step 2 — run RED; implement `detectSignals`** by composing the existing monitors; **GREEN.**
- [ ] **Step 3 — failing test: `selectAction` is a total `(signal × state)` table.** Assert every `(signal, state)` pair resolves to an explicit `Action` OR an explicit `{ kind: 'no_op', reason }`; assert an unknown/missing pair THROWS (total-function guard). Key cells to pin: `(price_crossed_buybelow, watched) → buy_eval`; `(price_crossed_buybelow, candidate) → no_op`; `(price_crossed_buybelow, held) → no_op` (add-tranche is Phase 5); `(falsifier_tripped, held) → sell_review`; `(falsifier_tripped, watched) → reprice_or_prune_review` with `prune_action_available: false` (Phase 6.6); `(shariah_breach, held) → shariah_grace_or_divest`; `(shariah_breach, watched) → removal_review`; `(reunderwrite_due, watched|held) → re_underwrite`; `(over_concentrated, held) → trim_review`; `(stale, *) → suppress` (+ rerun-needed).
- [ ] **Step 4 — run RED; implement `selectAction` as a lookup table** over `(signal, state)` (not a `switch (state)` with signal handled inside); **GREEN.**
- [ ] **Step 5 — implement the two pass orchestrators** `runFalsifierCheck(list, asOfData)` (quarterly/10-Q) and `runReUnderwrite(list, asOfData)` (annual/10-K): for each name → `detectSignals` → for each signal `selectAction(signal, state)` → collect actions. Pure; emits the same observation/draft shapes the current monitors do.
- [ ] **Step 6 — commit:** `feat(workflow): lifecycle cadence engine — state-independent detect + (signal×state) action table`.

### Task 3.2b — adapter equivalence (THE acceptance criterion)

**Files:** Modify `apps/worker/src/runtime.ts`; Test near `apps/worker/src/__tests__/runtime.test.ts`.

- [ ] **Step 1 — characterization tests (lock current behavior).** For each existing task kind (`watchlist_monitor`, `holdings_monitor`, `shariah_rescreen`, `holding_review_draft`), capture its current emitted events/alerts on the existing fixtures as the "before" baseline (add assertions if not already pinned).
- [ ] **Step 2 — route each task kind through the engine as a thin adapter** (the task handler calls `detectSignals`/`selectAction` via the engine and maps results to the same events it emitted before). Do NOT change scheduling configs or event contracts.
- [ ] **Step 3 — equivalence assertion:** each adapted task kind produces **identical** outputs to its "before" baseline on the same fixtures. This proves the refactor behavior-preserving by construction. If any output differs, the engine — not the scheduling/contracts — is the single cause to localize.
- [ ] **Step 4 — add `falsifier_check` + `re_underwrite` task kinds** that run the engine's two passes over the `nameLifecycleProjection` list (scheduled per cfg; old kinds keep running — deprecation is a later, trivial follow-up now that equivalence is proven).
- [ ] **Step 5 — full worker dry-run smoke** (isolated state, per CLAUDE.md) — no auto-trade/auto-approve regressions.
- [ ] **Step 6 — commit:** `feat(worker): route monitor tasks through the lifecycle engine (adapter-equivalent) + add falsifier_check/re_underwrite`.

## Task 3.3 — lifecycle list UI (final, deferrable slice)

**Files:** Create `apps/web/src/app/lifecycle/page.tsx` + `apps/web/src/components/LifecyclePanel.tsx`; Test `apps/web/src/components/__tests__/LifecyclePanel.test.tsx`.

- [ ] **Step 1 — failing component test:** renders the name list grouped by `candidate/watched/held/exited`; a deteriorating `watched` name shows its tripped-falsifier flag (honest, not healthy); an `exited` row shows its provenance (sold vs screened-out).
- [ ] **Step 2 — implement** the panel + route reading `nameLifecycleProjection`; **GREEN.**
- [ ] **Step 3 — `/strategy` + `/learn` copy** updated to the `candidate→watched→held→exited` + one-cadence-engine frame (final cohesion is Phase 8; this keeps it current).
- [ ] **Step 4 — commit:** `feat(web): unified lifecycle list view (candidate/watched/held/exited)`.

---

## Invariants preserved (must not regress)
No new event types; existing event contracts + stable `event_id`/causation/correlation untouched · user-authored transitions stay explicit & distinct from worker observations · worker dry-run / no-auto-trade · grounding · UI is a projection. The detect/select split is enforced by the state-invariance test (3.2 Step 1) + the total-table test (3.2 Step 3); the refactor's safety is enforced by the adapter-equivalence assertion (3.2b Step 3).

## Verification (each task, final tree)
`git diff --check` · `corepack pnpm typecheck` · `corepack pnpm test` · `corepack pnpm lint`; web slice also `next build`. Worker slice: the isolated dry-run smoke. Phase acceptance = adapter equivalence holds (engine subsumes the four task kinds with identical outputs) + the two discipline tests pass.

## Self-review notes
- Spec coverage: 3.1 (read model) + 3.2 (engine) + 3.2b (adapter migration) + 3.3 (UI) cover the gap-closing plan's Phase 3 (3.1 projection, 3.2 cadence engine) plus the owner's four refinements.
- No placeholders: each task has concrete files, the state table, the signal list, and the specific `(signal,state)` cells to pin.
- The `exited` enum collapse is handled by retaining `exit_provenance` (not lost in the merge).
- The missing prune event is represented honestly (deteriorating-watched test), not synthesized.
