# Phase 6 — Sell Decisions (held → exited)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` — fresh implementer per slice + two-stage (spec then quality) review between, like Phases 3–5. Detailed slice plan; companion to the gap-closing plan (`docs/superpowers/plans/2026-06-14-buffett-munger-gap-closing.md`, Part F) and the owner's Phase-6 design carry-forward (memory: `owlfolio-v2-direction-autonomous-research-harness`). Phases 1–5 are complete + on origin/main (HEAD `45b2f73`).

**Goal:** Give a held position a disciplined, advisory-only sell-decision operation — four triggers that can *never* fire on price alone, a 2–3 year minimum-hold guard reconciled with the thesis-broke trigger by **consuming the 4.2a fixable-vs-permanent judgment** rather than inventing a parallel clock, plus disposition/anchoring bias guards — while the irreversible close stays human-authored.

**Architecture:** Pure islands first (the reconciliation core, then each trigger, then the bias guards), then a pure assembler, then the live on-demand wiring that emits an OBSERVATION (never an auto-sell), enforced by a wiring-conformance tripwire — the exact 4.2c/Phase-5 shape. The close itself (`holding_closed`) is a human-signed transition, the mirror of `openHoldingFromWatchlist`.

**Tech stack:** TypeScript/pnpm monorepo; `@owlfolio/strategies` (pure rules), `@owlfolio/workflow` (orchestration + monitors), `@owlfolio/ledger` (events + projections), `apps/web` (on-demand routes + panels). TDD throughout.

---

## The crux (design this FIRST — it's what gets pressure-tested first)

**The 2–3yr minimum-hold guard collides with the thesis-broke trigger, and the collision is the central design problem.** Both failure modes are opposite and both catastrophic:
- Guard neuters thesis-broke → you hold a *genuinely broken* thesis for two years because the clock says so.
- Thesis-broke neuters guard → every wobble gets relabeled "thesis broke" to sell into pessimism (the disposition effect the guard exists to prevent).

**The reconciliation (owner-decided):** a genuinely broken thesis *is* the high-certainty-IV-below-price exception — it must fire *through* the guard, not be suppressed by it. The discriminator is the **same one the 4.2a admit layer already produces**: is this a *fixable temporary* problem (guard holds you) or *permanent impairment* (guard releases you)? So the minimum-hold guard **consumes `impairment_call`** — it does not invent a new clock-based test.

The map confirms the substrate is already there:
- `classifyAdmit({ uncertainty, permanent_loss_risk, quality_verdict_passes }) → { impairment_call: 'fixable_temporary' | 'permanent_impairment' | 'unresolved', admittable, reason }` (`packages/workflow/src/admitJudgment.ts:46-93`).
- `RiskLevel = 'low' | 'medium' | 'high'`; `GroundedRiskField = { level, argument, citations }`.
- The admit recommendation persists `impairment_call`, `permanent_loss_risk`, `uncertainty`, `downside_floor_*`, `buy_below` on `admit_judgment_recorded` and projects them (`researchCaseProjection.admit_recommendation`, `nameLifecycleProjection`).

So the held-name sell judgment is **the same function, re-run fresh on current facts** — `impairment_call` is the shared discriminator that *both* the thesis-broke trigger and the minimum-hold guard read. That reuse is the thing the owner will pressure-test, so S1 (producer) and S2 (consumer) are first and carry a structural tripwire proving no parallel clock-test exists.

---

## What already exists (reuse, don't reinvent)

| Asset | Location | Phase-6 use |
| --- | --- | --- |
| `classifyAdmit` → `impairment_call` | `packages/workflow/src/admitJudgment.ts:46-93` | The shared fixable-vs-permanent discriminator, re-run fresh for held names (S1) |
| Persisted/projected admit judgment | `researchCaseProjection.admit_recommendation`, `nameLifecycleProjection` | What the held-name re-judgment is compared against; provenance |
| `buildSellReviewScaffold` + `SellReviewReasonCode` | `packages/workflow/src/lifecycleMonitors.ts:519-580` | The sell-review draft; expand reason codes (S6) |
| `holding_sell_review_drafted` event | `packages/ledger/src/domainEventContracts.ts:581-606` (`is_execution:false`, `requires_user_authoring:true`) | The OBSERVATION the sell recommendation emits (S8) — extend, don't replace |
| `detectSignals` (state-independent) + `selectAction` (signal×state) total table | `packages/workflow/src/lifecycleCadence.ts:105-297` | Add new sell *signals* + held action rows, table stays total (S8) |
| `falsifier_tripped:held → sell_review` | `lifecycleCadence.ts:235` | Existing thesis-broke seam to route through the new evaluator |
| `evaluateShariahGrace` → divest draft | `lifecycleMonitors.ts:611-680` | The unresolvable-Shariah-breach exit path already exists; leave intact |
| `recordAdmitJudgment` / `recordSizingRecommendation` on-demand pattern | `apps/web/src/lib/workflow.ts:747-1132` + routes | Template for `recordSellDecision` (S8) |
| Admit/sizing panels + request controls | `ResearchCasePanel.tsx:2343-2670`, `*RecommendationRequest.tsx` | Template for the sell panel (worst-case-first; "correct posture" styling) |
| `admit/sizingWiringConformance.test.ts` | `packages/workflow/src/__tests__/` | Template for `sellWiringConformance` incl. structural negative-greps (S8) |
| `locked_buy_below` + `buy_below_valuation_version` (frozen at admit) | `watchlistProjection.ts:16-19`, frozen in `workflow.ts:685-706` | The freeze pattern to extend to a **frozen IV** for valuation-inverted (S3) |

**Three gaps the plan closes:** (1) `holding_closed` has no formal event contract (tests-only) — formalize as the human-signed close (S7); (2) `opened_at` is not on `nameLifecycleProjection` — add it so the hold-clock is computable (S1); (3) the *undiscounted* IV is not frozen-for-sell (only the MoS-discounted `locked_buy_below` is) — freeze it at sign-off (S3).

---

## Slices (dependency order S1 → S9; S1–S7 land as pure/contract islands, S8 is the integration the tripwire enforces, S9 is the watched-prune)

### S1 — held-name fresh impairment re-judgment + hold-clock (the shared discriminator) — pure + projection
The producer of `impairment_call` for a *held* name, on *current* facts, via the **existing** `classifyAdmit` — not a new classifier.
- New `packages/workflow/src/heldImpairment.ts`: `reassessHeldImpairment({ uncertainty, permanent_loss_risk, quality_verdict_passes }) → ReturnType<classifyAdmit>` — a thin held-name entry point that **imports and calls `classifyAdmit`** (the reuse must be literal, so the tripwire in S8 can grep it). Returns the same `{ impairment_call, admittable, reason }`. No new judgment math.
- Add `opened_at?: string` to `NameLifecycleProjection` (from the `holding_opened` event) + a pure `computeHoldingAgeMonths(opened_at, now)` and `isWithinMinimumHold(age_months, params)` in a new `packages/strategies/src/minimumHold.ts`. Config in a new/extended sizing-or-strategy params: `minimum_hold_months` (default **30** ≈ 2.5yr, calibration-gated).
- Tests: held re-judgment delegates to `classifyAdmit` (same inputs → identical output, asserted against the admit fixture); `opened_at` projected from `holding_opened`; age + within-window arithmetic; missing `opened_at` → fail-closed (treated as within-window/`cannot_assess`, never "window passed by default").

### S2 — minimum-hold guard consuming `impairment_call`, per-trigger release matrix (THE reconciliation) — pure
- New `packages/strategies/src/minimumHoldGuard.ts`: `applyMinimumHoldGuard({ trigger, holding_age_months, impairment_call, at_loss, params }) → { decision: 'release_through_guard' | 'hold_blocks_sell' | 'escalate_human_review' | 'inactive', reason }`.
- **The guard governs ONLY loss sales inside the window.** Two pre-gates first, both → `inactive` (the trigger proceeds on its own terms): outside the window (`holding_age_months ≥ minimum_hold_months`), OR `!at_loss`. The second pre-gate is what makes `valuation_inverted` coherent in-window — a valuation-inverted sale is a *gain* (price ≥ frozen IV), so it is never `at_loss`, so the guard never brakes it.
- **Inside the window AND at a loss, the decision is an EXPLICIT per-trigger × `impairment_call` matrix — not a single "is it impairment" gate:**

  | trigger | decision (in-window, at-loss) | why |
  | --- | --- | --- |
  | `thesis_broke` + `permanent_impairment` | `release_through_guard` | a genuinely broken thesis IS the high-certainty exception — fires *through* the guard |
  | `thesis_broke` + `fixable_temporary` | `hold_blocks_sell` | the disposition brake: loss-driven impatience on a fixable stumble |
  | `thesis_broke` + `unresolved` | `escalate_human_review` | the system **cannot tell** fixable-vs-permanent — surfacing it is correct; defaulting to hold would be the agent making a consequential call by inaction (the Horsehead trap: real impairment not yet legible as `permanent_impairment`) |
  | `original_mistake` (human-flagged) | `release_through_guard` | a never-valid thesis is a guard-*override*, not a fixable stumble — releases like `permanent_impairment`, independent of `impairment_call` |
  | `better_opportunity` | `hold_blocks_sell` | selling a holding at a loss inside 2–3yr to chase "better" is precisely the churn the guard exists to prevent (Buffett/Pabrai set this bar very high) |

- **Design invariants (S8 tripwire enforces):** the function takes `impairment_call` + `trigger` as inputs, never recomputes the judgment, and has **no age-only or clock-only release path**. The ONLY in-window release decisions are `permanent_impairment` (via `thesis_broke`) and `original_mistake`; `unresolved` never silently routes to hold.
- Tests: drive the full matrix above (each row asserted); `!at_loss` → `inactive` for every trigger (the valuation-inverted gain case); outside window → `inactive`; **`unresolved` in-window-at-loss → `escalate_human_review` (never `hold_blocks_sell`)**; **structural test: exhaustively enumerate (trigger × impairment_call × in/out-window × at-loss) and assert no `release_through_guard` arises from age/clock alone** (the no-parallel-clock guarantee). Config-mutation test on `minimum_hold_months`.

### S3 — valuation-inverted off a SIGN-OFF-FROZEN IV (don't-move-the-number) — pure + freeze
- **Freeze the undiscounted IV at sign-off.** Extend the existing admit-freeze (`workflow.ts:685-706`, which freezes `locked_buy_below`) to also freeze `frozen_iv` (= `valuation.fair_value_per_share`, the **undiscounted** number) + `frozen_iv_valuation_version` on `watchlist_draft_created`/confirmed and project them on `watchlistProjection` + `nameLifecycleProjection`. The buy-below is MoS-discounted and inherits the provisional MoS (#124) — inverting a sell against it would make every sell threshold move when the MoS freezes. The sell trigger needs an *independent* undiscounted IV.
- **Don't-move-the-number provenance (owner-confirmed):** the frozen IV freezes at **sign-off (admission)** with its valuation-version provenance, and **re-underwrite is the ONLY thing that may move it** — the same discipline as the buy-below. The agent must not be able to nudge `frozen_iv` to manufacture or suppress a sell. The S8 tripwire asserts the valuation-inverted path reads the *frozen* projection field, never a live/recomputed fair value.
- New `packages/strategies/src/valuationInverted.ts`: `evaluateValuationInverted({ current_price, frozen_iv, params }) → { inverted: boolean, fraction_of_iv, reason }`. Fires only when `current_price ≥ frozen_iv × sell_iv_fraction` with `sell_iv_fraction` **default 1.0, biased to hold** (Pabrai's documented biggest mistake was selling winners at 90–95% of IV — the trigger must lean toward *not* selling). Price is an **input**; the *cause* is "price reached the frozen IV," never a raw price move.
- **"Don't move the number" (F.9/F.10):** the function reads the **frozen** IV passed in; it must not accept a live/recomputed fair value. The S8 tripwire greps that the route feeds `frozen_iv` from the projection, not a fresh valuation call.
- Tests: price below frozen IV → not inverted; price at/above frozen IV → inverted (and only at `sell_iv_fraction`, default 1.0); `sell_iv_fraction` config-mutation; missing `frozen_iv` → `cannot_assess` (fail-closed); structural: the input field is named/sourced `frozen_*`, never a live valuation.

### S4 — better-opportunity-under-capital-constraint (high hurdle + mandatory human sign-off) — pure
- New `packages/strategies/src/betterOpportunity.ts`: `evaluateBetterOpportunity({ held_oe_yield, candidate_oe_yield, switching_friction, params }) → { switch_warranted: boolean, margin, requires_human_signoff: true, reason }`. The candidate must beat the held name's owner-earnings yield by a **large** margin net of `switching_friction` (taxes/spreads), config `better_opportunity_min_margin` (default high, e.g. 0.05 absolute yield). **`requires_human_signoff` is structurally always `true`** — this trigger is never mechanical (patient holding dies by a thousand switches; the comparative judgment is easy to get wrong).
- **Interaction with the guard (S2 matrix):** inside the window at a loss, `better_opportunity` is **blocked** by the guard regardless of `impairment_call` (the matrix row) — you do not sell a holding at a loss inside 2–3yr to chase "better." This trigger therefore only reaches its high-hurdle + sign-off logic *outside* the window, or on a non-loss switch.
- Tests: marginal improvement → `switch_warranted:false`; large net margin → `switch_warranted:true` **with** `requires_human_signoff:true`; **structural test: `requires_human_signoff` is `true` on every return shape** (no mechanical-switch path); friction reduces the effective margin; config-mutation.

### S5 — disposition-effect + purchase-price-anchoring guards (Munger bias-hygiene seeds) — pure
- New `packages/strategies/src/sellBiasGuards.ts`: `evaluateDispositionGuard({ at_loss, impairment_call, trigger })` and `evaluateAnchoringGuard({ proposed_basis, cost_basis_per_share, frozen_iv })` → caveat objects. These **attach caveats, never block** (the guard that *blocks* loss-driven impatience is S2; these are advisory hygiene flags surfaced to the human): e.g. "this sell is at a loss on a `fixable_temporary` call — possible disposition effect"; "this sell reasons from cost basis, not intrinsic value — possible anchoring." Preview of the Phase-7 checklist.
- Tests: loss + fixable → disposition caveat; reasoning anchored to cost basis vs IV → anchoring caveat; clean permanent-impairment sell → no caveats; caveats are additive (never change the decision).

### S6 — the sell-decision assembler — pure orchestrator core
- New `packages/workflow/src/sellAssessment.ts` (pure analogue of `admitAssessment`/`sizingAssessment`): `computeSellDecision(args) → { status: 'sell_review' | 'hold' | 'escalate_review' | 'cannot_assess', recommendation?: { trigger, impairment_call, minimum_hold_decision, frozen_iv?, worst_case, bias_caveats, requires_human_signoff, reason_code, is_observation: true } }`.
- Order (gate-first): identify the fired trigger(s) **from non-price inputs** → S1 fresh `impairment_call` → **S2 minimum-hold guard** mapping its four decisions to status: `hold_blocks_sell` → `status:'hold'` ("guard held" — the *correct posture*); `escalate_human_review` → `status:'escalate_review'` ("cannot resolve fixable-vs-permanent on a held loss inside the window — your call", the `unresolved` path, surfaced never defaulted); `release_through_guard`/`inactive` → continue → trigger-specific logic (S3 valuation-inverted / S4 better-opportunity / Shariah via existing `evaluateShariahGrace` / `original_mistake` as a human-flag input) → S5 bias caveats → reuse `buildSellReviewScaffold` for the draft. **Worst case always attached** (downside floor + basis from the persisted admit judgment, the Phase-5 reliability signal). **Price is never a sole input to any path** (structural).
- Expand `SellReviewReasonCode` with `valuation_inverted`, `better_opportunity_under_constraint`, `original_mistake`, `minimum_hold_released` (keep the existing `thesis_broken`, `unresolvable_shariah_breach`; retire/redoc `overvaluation_alone` in favour of `valuation_inverted`-off-frozen-IV).
- Tests: thesis-broke + permanent → `sell_review` releasing through the guard; thesis-broke + fixable inside window → `hold` (guard held, correct posture); valuation-inverted at frozen IV → `sell_review`; better-opportunity → `sell_review` with `requires_human_signoff`; **no path produces `sell_review` from price alone** (drive every trigger with price varied and a non-price cause absent → never fires); every `sell_review` carries non-empty `worst_case` + `reason_code`.

### S7 — formalize `holding_closed` as the human-signed close — event contract + workflow
- Add the `holding_closed` event contract to `domainEventContracts.ts` (currently tests-only): payload `{ holding_id, closed_at, exit_price_per_share, reason_code, exit_provenance: 'sold', actor_type: 'user' }`, `is_execution: true`, `requires_user_authoring: true`. New `closeHolding(store, command)` in `holdingWorkflow.ts` — the mirror of `openHoldingFromWatchlist`, **human-authored only** (actor must be user; never worker/provider). Confirm `nameLifecycleProjection` folds it to `exited` with `exit_provenance:'sold'` (already wired at `nameLifecycleProjection.ts:383`).
- Tests: `closeHolding` emits `holding_closed`; projection → `exited`/`sold`; a worker/provider actor is **rejected** (the irreversible close stays human-authored); contract round-trips.

### S8 — live wiring + observation event + tripwire + UI + copy — integration (the slice the tripwire enforces)
- **Cadence:** add the new sell *signals* to `LifecycleSignal` + `LIFECYCLE_SIGNALS`, each detected in `detectSignals` from **non-price** inputs (thesis-break seam, frozen-IV comparison input, original-mistake human flag); add the `held` action rows (→ `sell_review`) to the total `selectAction` table; keep all cells explicit (table stays total, detection stays state-independent).
- **On-demand route + workflow:** `recordSellDecision` in `apps/web/src/lib/workflow.ts` + `apps/web/src/app/api/research/[caseId]/sell-decision/route.ts` (mirror `recordSizingRecommendation`): fresh reads of the held name + persisted admit judgment (`impairment_call`, floor) + frozen IV + fresh price + cost basis + opened_at → `computeSellDecision` → emit ONE `holding_sell_review_drafted` OBSERVATION (content-hash idempotency, `is_execution:false`, `requires_user_authoring:true`). **Does NOT close the holding** (`closeHolding` stays human-authored/signed).
- **Wiring-conformance tripwire** `packages/workflow/src/__tests__/sellWiringConformance.test.ts` (grep committed non-test source): the assembler calls the trigger/guard fns; the route calls `recordSellDecision`; the web workflow calls `computeSellDecision` + emits `holding_sell_review_drafted`. Plus three **structural** tripwires: (a) **no price-alone sell** — every sell path requires a non-price cause (assert price identifiers never solely gate a `sell_review` return); (b) **the guard consumes `impairment_call`** — `minimumHoldGuard` imports/reads `impairment_call` and has no clock-only release identifier; (c) **frozen-IV-not-live** — the valuation-inverted path reads `frozen_iv` from the projection, not a fresh valuation call.
- **UI:** a sell-recommendation panel beside the admit/sizing panels (held context), worst-case-first (downside floor + basis), showing the `trigger`, the `impairment_call`, and the `minimum_hold_decision`. Render `hold` / "guard held: fixable inside window" as the **correct posture** (emerald, like Phase-5 `hold_in_savings`) — review must verify it is NOT a warning state. Surface `requires_human_signoff` for better-opportunity and the S5 bias caveats. `SellDecisionRequest.tsx` request control (template: `SizingRecommendationRequest`).
- **Copy:** `/strategy`·`/learn` sell-discipline section — the four triggers, **no-stop-loss (price is an input, never a cause)**, the minimum-hold guard **consuming fixable-vs-permanent** (not a clock), the Pabrai recant (don't sell winners at 90–95% of IV), better-opportunity needs sign-off, disposition/anchoring guards. No overclaim (advisory; the close is human-authored).
- Tests: route test; the tripwire; web-workflow test (observation emitted, **no auto-close**).

### S9 — watched-name prune (6.6) — event contract + human-authored prune
- New `watchlist_item_pruned` event contract; human-authored `pruneWatchlistItem` for `falsifier_tripped` watched names; toggle `prune_action_available:true` in `nameLifecycleProjection` (currently always `false` at `nameLifecycleProjection.ts:408`). **Same detection (the falsifier honesty bit), softer exit** — a watched name leaves the list; no holding is involved. Human-authored (mirror of the close).
- Tests: prune emits the event; projection toggles `prune_action_available` then folds to `exited`/`screened_out`; worker/provider actor rejected.

---

## §Acceptance gates → tests
- **reconciliation (per-trigger matrix):** in-window-at-loss releases iff (`thesis_broke`+`permanent_impairment`) OR `original_mistake`; `fixable_temporary`→hold; `better_opportunity`→block; **`unresolved`→escalate_human_review (never silent hold)**; not-at-loss / out-of-window → inactive (S2 structural table) · thesis-broke + fixable inside window → `hold` correct-posture (S6).
- **never price-alone:** no sell path fires from price alone (S6 + S8 structural tripwire).
- **frozen-IV / don't-move-the-number:** valuation-inverted reads frozen IV, biased-to-hold at `sell_iv_fraction` default 1.0 (S3 + S8 tripwire).
- **better-opportunity needs sign-off:** `requires_human_signoff` structurally always true (S4).
- **guard consumes the 4.2a judgment, no parallel clock:** `minimumHoldGuard` takes `impairment_call`, no age-only release (S2 + S8 tripwire).
- **human-authored close:** `closeHolding`/`pruneWatchlistItem` reject non-user actors (S7/S9).
- **wiring-conformance:** sell decision wired into the held flow, not islands (S8).
- **disposition/anchoring caveats surfaced** (S5).

## Critical files
- New: `packages/strategies/src/{minimumHold,minimumHoldGuard,valuationInverted,betterOpportunity,sellBiasGuards}.ts`; `packages/workflow/src/{heldImpairment,sellAssessment}.ts`; `apps/web/src/app/api/research/[caseId]/sell-decision/route.ts` + sell panel + `SellDecisionRequest.tsx`; `packages/workflow/src/__tests__/sellWiringConformance.test.ts`.
- Modify: `packages/workflow/src/lifecycleCadence.ts` (new sell signals + held rows, table stays total), `packages/workflow/src/lifecycleMonitors.ts` (`SellReviewReasonCode` expansion; scaffold reuse), `packages/workflow/src/holdingWorkflow.ts` (`closeHolding`), `packages/ledger/src/domainEventContracts.ts` (`holding_closed`, `watchlist_item_pruned`, expanded reason codes), `packages/ledger/src/projections/{nameLifecycleProjection,watchlistProjection}.ts` (`opened_at`, `frozen_iv*`, `prune_action_available`), `apps/web/src/lib/workflow.ts` (`recordSellDecision` + freeze `frozen_iv` at admit), `apps/web/src/components/ResearchCasePanel.tsx` (sell panel), `LearnTabs.tsx`/`/strategy` copy.
- Reuse unchanged: `classifyAdmit` (`admitJudgment.ts`), `buildSellReviewScaffold`/`evaluateShariahGrace` (`lifecycleMonitors.ts`), `recordSizingRecommendation` pattern (`workflow.ts`).

## Resolved decisions (owner-confirmed 2026-06-15)
1. **Frozen IV source.** Freeze the undiscounted `valuation.fair_value_per_share` (+ version) at sign-off — a dedicated independent number, NOT backed out of the provisional-MoS buy-below. Re-underwrite is the only thing that moves it (S3).
2. **`sell_iv_fraction`.** Hard **1.0**, **not a band** — a band reintroduces the 90–95%-of-IV early-sell Pabrai repudiated. Valuation-inverted fires only at/above full frozen IV, and even then it is a sell-*review* biased to hold; holding *past* IV on an improving compounder is the human's call at review (S3).
3. **`minimum_hold_months`.** **30** as the starting default, **calibration-gated (F.6)** against how long theses actually take to play out — do not freeze on intuition, do not agonize over 24/30/36. The window's only job is braking loss-driven impatience; the `unresolved`→escalate + `permanent_impairment`→release paths are what actually prevent the trap, not the exact month count (S1/S2).
4. **Sell event.** Reuse/extend `holding_sell_review_drafted` — it already encodes `is_execution:false` + `requires_user_authoring:true`, so the human-signs-the-irreversible invariant is enforced by the existing contract. Extend reason codes; never mint a new type that could re-derive those safety properties wrong (S6/S8).
5. **`original_mistake`.** **Human-flag only**, never agent-inferred (it's a judgment about the human's own prior judgment, like circle-of-competence) — **and it routes as a guard-release** (a never-valid thesis isn't a fixable stumble; releases through the minimum-hold guard like `permanent_impairment`) (S2/S6).

## Verification
Each slice on the final tree: `git diff --check` · `corepack pnpm typecheck` · `corepack pnpm test` · `corepack pnpm lint`; web slices also `next build`. S7/S9 also exercised by the worker dry-run smoke (no auto-close/prune). Phase acceptance = the §gates pass (esp. the paired reconciliation + never-price-alone + guard-consumes-impairment_call tests) and `sellWiringConformance` is green. Push per slice-group; subagent-driven with spec/quality review between slices.
