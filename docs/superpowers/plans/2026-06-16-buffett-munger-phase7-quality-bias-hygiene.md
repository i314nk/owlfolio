# Phase 7 — Quality & Bias Hygiene Checklists (admission + re-underwrite)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` — fresh implementer per slice + two-stage (spec then quality) review, like Phases 3–6. Companion to the owner's Phase-7 design spec (§0–§7) and the gap-closing plan. Phases 1–6 complete + on origin/main (HEAD `e1e35cb`).

**Goal:** Ship two **hygiene surfaces (not gates)** — a business failure-mode checklist (agent-assisted, grounded) and a cognitive-bias checklist (human-only, no agent pre-fill) — that **force every known failure mode to be explicitly addressed** before an admission or re-underwrite can be signed off, **without scoring, tallying, or auto-rejecting anything**. The checklist forces the question; the human and the existing gates still decide.

**Architecture:** A data-defined, extensible checklist (adding an item is config, not engine code) + a pure, **decision-neutral** completion evaluator (returns only `complete`/`unaddressed`, never a score). The answers become a **required input on the human sign-off** (the same completion-block shape as the required non-prefilled `signed_thesis`): unaddressed item → sign-off cannot complete. Answers ride on the signed artifact (append-only) and project for audit. A 4th wiring-conformance tripwire enforces: reachable-in-live-flow, **no-scoring**, and **cognitive-checklist-is-human-only**.

**Tech stack:** TypeScript/pnpm monorepo; `@owlfolio/strategies` (the data + pure evaluator), `@owlfolio/workflow` (the sign-off hosts), `@owlfolio/ledger` (events + projections), `apps/web` (the required-non-prefilled forms + copy). TDD throughout.

---

## §0 — The invariants (from the spec — these are the acceptance bar)
- **Hygiene surface, never a gate:** completion-blocking (unaddressed item blocks sign-off) but **decision-neutral** — no score/tally/rank, a "risk present" answer never auto-rejects. The value is *forcing the question*, never answering it.
- **No-scoring extends to the UI surface, not just the evaluator (owner caveat).** The de-facto-score erosion happens *downstream*: a "8 of 11 addressed" progress badge, a "3 items need attention" count, or sorting/filtering names by how many items are flagged — none of those make `evaluateChecklistCompletion` return a number, but each reintroduces a score the human reads as one ("a count wearing a score's clothes"). **The UI shows *WHICH* items are unaddressed, never *HOW MANY*; no consumer derives a count/ratio/score from the answers that influences display-ordering or a verdict.** The no-scoring principle must hold at the surface the human actually sees.
- **Two checklists, never merged:** business (guards the investment; groundable; agent MAY marshal filing evidence, human affirms) vs cognitive (guards the human's reasoning; introspective; **human-only, agent must NOT pre-fill or suggest** — same discipline as `original_mistake`).
- **Append-only, human-signed;** answers are part of the signed artifact, projected for audit.
- **Extensible:** adding a failure-mode item is data, not an engine code change.
- **Nothing auto-rejects or auto-sizes** off a checklist answer.

---

## The central plumbing decision (resolve FIRST — the re-underwrite host)

Grounding confirmed two different attach points with very different readiness:
- **Admission — host EXISTS.** `confirmWatchlistDraft` (`packages/workflow/src/watchlistWorkflow.ts:117-178`) already throws if `signed_thesis.trim().length === 0` (the completion-block precedent); `promoteResearchCaseToWatchlist` (`apps/web/src/lib/workflow.ts:644-729`) enforces it again; route `apps/web/src/app/api/research/[caseId]/watchlist/route.ts`; UI `WatchlistPromotionForm.tsx` (required, non-prefilled, submit-disabled-until-filled). Phase 7 ADDS the checklist as a second required input on this exact path.
- **Re-underwrite — host does NOT exist.** Re-underwrite today is only (a) a cadence NUDGE (`reunderwrite_due → re_underwrite` → `holding_monitor_alert_recorded`, an observation), and (b) an **ungated** user transition `confirmHoldingReviewDraft → holding_review_confirmed` (`holdingReviewWorkflow.ts`) which has NO required-field gate. There is no `*reunderwrite_signed_off` event.

**Recommendation (owner to confirm — Open decision #1):** make the existing user-authored `confirmHoldingReviewDraft` the re-underwrite sign-off host by ADDING the checklist completion-block + a required human re-confirmation to it (reuse), rather than minting a new `holding_reunderwrite_signed_off` event/workflow. It is already the human-authored "the human accepts this re-underwrite" transition; it only lacks the gate. Reuse = fewer surfaces, one completion-block shape to get right. (Alternative: a dedicated new event — more surface, re-derives the same safety properties.)

---

## What exists to read / reuse (grounding map)

| Need | Where | Slice |
| --- | --- | --- |
| Completion-block precedent (required `signed_thesis` throw) | `watchlistWorkflow.ts:128-131`, `workflow.ts:657-660` | S2 |
| Admission route + UI | `api/research/[caseId]/watchlist/route.ts`, `WatchlistPromotionForm.tsx:51-121` | S2 |
| Re-underwrite user transition (ungated) | `holdingReviewWorkflow.ts` `confirmHoldingReviewDraft`/`holding_review_confirmed` | S3 |
| Extensible versioned frozen data list | `sellParams.ts` / `sizingParams.ts` / `sourcePolicy.ts` (`lanes`) | S1 |
| Wiring tripwire + `stripComments` + forbidden-regex | `admit/sizing/sellWiringConformance.test.ts` | S5 |
| **Business-item READ fields (9/11 persisted):** terminal_value_pct_of_iv `researchCaseProjection.ts:193`; moat_class `:164`; downside_floor_* `:304-306`; shariah_status `:451` + shariah_financial ratios `:245-262`; OE confidence/caveats `:31-32`; owner_earnings_bridge `:186`; market_implied_growth `:218`; growth_basis `:175`; aggregate_cluster_downside `:318` | `researchCaseProjection.ts` | S4 |
| **Two computed-but-UNPERSISTED evidence fields:** per-name cluster key/basis (only the aggregate is persisted); data-completeness detail (`demonstratedOwnerEarningsGrowth` `window_years`/`points_used`/`method` are ephemeral) | `correlatedClusters.ts`, `secEdgar.ts:160` | S4 (additive persist — read, don't recompute) |
| Persist+project on the signed artifact (mirror `signed_thesis`) | `watchlist_draft_created/confirmed` payload → `watchlistProjection.signed_thesis` / `researchCaseProjection` | S2/S3 |

---

## Slices (S1 pure/data → S2 admission → S3 re-underwrite host → S4 evidence → S5 tripwire+copy)

### S1 — checklist definitions (data) + decision-neutral completion evaluator (pure)
- New `packages/strategies/src/checklistParams.ts` — `CHECKLIST_PARAMS` (frozen, versioned like `SELL_PARAMS`), the **single source** the engine iterates: the **11 business items** (§1: overpaying-for-quality, moat-erosion, terminal-value-optimism, cyclical-peak, capital-allocation, quality-of-earnings, secular-disruption, concentration/correlation, thesis-drift, shariah-drift, data-completeness) + the **6 cognitive items** (§2: anchoring, rationalization/commitment, pattern-match, social-proof, disposition, recency). Each item: `{ id, category: 'business' | 'cognitive', prompt, ...(business only) reads?: <persisted-field-path for evidence marshaling> }`. NO score/weight field on any item.
- Pure `evaluateChecklistCompletion(answers: Record<string,ChecklistAnswer>, params?) → { complete: boolean; unaddressed: string[] }` where an item is *addressed* iff it has a non-empty reasoned answer (`{ addressed: true, note: <non-empty> }`). **DECISION-NEUTRAL: returns ONLY complete + the unaddressed ids — never a count, score, tally, ratio, pass/fail, or verdict.** Iterates `CHECKLIST_PARAMS.items` (extensible: a new item is automatically required).
- Tests: complete iff every item addressed; one unaddressed → `complete:false` + names it; **structural: the module exports no scoring/tally/ratio/verdict — `evaluateChecklistCompletion` has no numeric return**; adding an item to `CHECKLIST_PARAMS` flips a previously-complete answer-set to incomplete (extensibility, data-only).

### S2 — admission checklist completion-block + persist + project + UI
- Add `checklist_answers` (the 17-item answer map, append-only) to the `WatchlistDraftCreatedPayload` + project onto `watchlistProjection` / `researchCaseProjection` (mirror `signed_thesis`).
- Extend `confirmWatchlistDraft` (+ `promoteResearchCaseToWatchlist` + the watchlist route): the sign-off THROWS / 400s if `evaluateChecklistCompletion(checklist_answers).complete === false` — the exact completion-block shape as the empty-`signed_thesis` guard. **The cognitive answers must be human-authored** (actor `user`); no agent default.
- UI: extend `WatchlistPromotionForm.tsx` — render the checklist (business items show their marshaled evidence value from the projection, see S4; cognitive items are non-prefilled human inputs); submit disabled until `evaluateChecklistCompletion` is complete. Cognitive section carries NO agent suggestion/prefill. **Show *which* items are unaddressed, never a count/progress badge (no "{n} of {m}") — §0 no-scoring-at-the-surface.**
- Tests: **completion-block** — admission with an unaddressed item is rejected (structural, like the required-thesis test); answers persisted + projected (auditable); cognitive items are not pre-filled (the form seeds them empty).

### S3 — re-underwrite sign-off host + completion-block + persist + project + UI
- **This is ALSO an integrity fix, not just plumbing (owner).** Grounding found `confirmHoldingReviewDraft → holding_review_confirmed` currently *validates nothing* — a human-authored confirmation transition that doesn't require the human to have done anything. That is the same class as the Phase-4 signed-thesis fiction (a confirmation that confirms nothing). Gating it makes `holding_review_confirmed` go from validating-nothing to validating-the-checklist-is-addressed — closing a latent gap where a re-underwrite could be confirmed without substance. Frame + commit S3 as the integrity fix it is.
- Per Open decision #1 (reuse): add the checklist completion-block + the `checklist_answers` payload to `confirmHoldingReviewDraft` / `holding_review_confirmed`, making it the re-underwrite sign-off host. Throw/400 if not `complete`. Project the answers onto the holding/lifecycle projection.
- **Behavior change to an existing transition → Phase-3-monitor-refactor caution:** `confirmHoldingReviewDraft` goes from ungated to gated. Before changing it, grep ALL callers (worker, routes, tests) and confirm none depend on the old ungated behavior (a caller that confirms a review without checklist answers will now correctly throw — migrate it or confirm it's the intended sign-off path). Treat exactly like the Phase-3 superseded→buy flip / Phase-5 concentration-split: a behavior change with a silent-failure mode, verified at review that no other caller was left on the old contract.
- **Shariah-drift (item 10) + data-completeness (item 11) are GENUINELY FORCED here (completion-blocking at re-underwrite specifically).** Shariah-drift is *almost only* meaningful at re-underwrite — it catches a holding that *became* non-compliant after admission, which by definition can only be caught on re-examination; a name admitted compliant and never re-checked for drift is exactly the failure item 10 exists to prevent. The re-underwrite checklist is the SAME 17 items (one source, S1), but the test must prove 10 + 11 are completion-blocking at the re-underwrite host (the business checklist surfaces the *current* shariah_status + ratios and the coverage flags).
- UI: the holding-review confirm surface gets the checklist (same required-non-prefilled shape; show *which* items are unaddressed, never *how many* — see S5).
- Tests: re-underwrite sign-off **cannot complete with an unaddressed item** (the integrity test — the re-underwrite twin of the required-thesis test); items 10 + 11 specifically block at re-underwrite; answers persisted + projected; cognitive human-only; **no other caller of `confirmHoldingReviewDraft` relied on the old ungated behavior** (regression check).

### S4 — business-checklist evidence marshaling (read layer) + 2 additive evidence persists
- For each business item with a `reads` field, the UI/orchestrator **READS the persisted value** (terminal_value_pct_of_iv, moat_class, downside_floor_*, shariah_status + ratios, OE confidence/caveats, owner_earnings_bridge, market_implied_growth, aggregate_cluster_downside) and surfaces it beside the item as marshaled evidence the human affirms. **No recompute** (mirrors the cheapness screen reading Phase-1 OE).
- Additively PERSIST the two computed-but-unpersisted evidence values so items 8 + 11 can also marshal: per-name `cluster_key`/`cluster_basis` (onto the sizing/lifecycle projection) and data-completeness `growth_window_years`/`growth_points_used`/`growth_method` (onto the valuation projection).
- **PERSIST-ONLY, NOT RECOMPUTE — and a STOP gate (owner caveat).** These must be *additive persists of values the system ALREADY computes* — `correlatedClusters` already derives the per-name `cluster_key`/`cluster_basis` (only the aggregate is persisted today); `demonstratedOwnerEarningsGrowth` already returns `window_years`/`points_used`/`method` (ephemeral). The slice carries them from the existing computation onto the event payload + projection — it adds NO new derivation. **FIRST verify this is literally true** (the cluster key and the coverage detail genuinely already exist at the point of the existing computation and just aren't persisted). If either turns out to require *new* computation, **STOP** — that is a different, larger change that must NOT ride in on a "persist what we already have" slice; flag it back instead of building it here. The owner's reason: if 2 of the 11 business items can't marshal evidence, they silently degrade to human-affirmed-only — behaving like cognitive items when they're supposed to be grounded-in-fact business items. That inconsistency is worse than the cheap persist; but only when it's genuinely a persist.
- Tests: each business item's evidence is read from the persisted field (assert it equals the projected value, not a fresh computation); the two new fields persist + project; **structural: the checklist evidence layer calls NO valuation/cluster/shariah engine** (reads projections only); **the two new persists carry an existing-computation value through, with no new derivation introduced** (the persist site is the same place the value was already computed).
- **Open decision #2 (owner — RESOLVED: ship):** ship the two additive persists so all 11 business items marshal evidence uniformly — *provided* they are genuine persist-only (the STOP gate above). They complete the "agent marshals evidence" promise and prevent the silent-degrade-to-cognitive inconsistency.

### S5 — wiring-conformance tripwire (4th application) + structural tripwires + copy
- `packages/workflow/src/__tests__/checklistWiringConformance.test.ts` (grep committed source, mirror the existing three):
  1. **Reachable in the live sign-off flow:** the admission path (`confirmWatchlistDraft`/route) AND the re-underwrite path (`confirmHoldingReviewDraft`) call `evaluateChecklistCompletion` and block on it.
  2. **Decision-neutral (no-scoring) tripwire — engine AND UI:** no checklist source computes a score/tally — forbidden identifiers (`checklist_score`, `tally`, `pass_count`, `n_of_m`, weighted-sum) absent from the checklist engine + the sign-off hosts (structural, like no-Kelly). **Extend to the consumer surface:** assert no checklist consumer derives a count/ratio that influences display-ordering or a verdict, and the checklist UI does NOT render a count/progress badge (`{n} of {m}`, `{n} addressed`, `{n} need attention`, `{n}/{m}`) — the panel lists *which* items are unaddressed, never *how many* (grep the checklist UI for count-of-answers display patterns). A count badge is a score wearing a count's clothes.
  3. **Cognitive-human-only tripwire:** no orchestrator/route/agent path pre-fills or suggests cognitive answers — forbidden (`suggestChecklist`, `prefill`, agent-draft feeding the cognitive section); the cognitive answers' actor is `user`.
  4. **Extensibility:** the engine iterates `CHECKLIST_PARAMS.items` (no hardcoded per-item list in the evaluator/hosts).
- `/strategy`·`/learn` copy: the two checklists, **hygiene-not-gate** (forces the question, never scores), business=agent-marshaled+human-affirmed vs cognitive=human-only, completion-blocks-sign-off, extensible. No overclaim (the checklist informs; the human + existing gates decide).
- Tests: the tripwire; the copy renders the item lists from `CHECKLIST_PARAMS` (not hardcoded).

---

## §5 acceptance gates → tests
- **completion-block:** unaddressed item blocks admission (S2) AND re-underwrite (S3).
- **decision-neutral (engine + UI):** no scoring/tally path; "risk present" doesn't change the verdict mechanically; the UI shows *which* unaddressed, never a count/progress badge (S1 + S5 no-scoring tripwire, engine + consumer surface).
- **cognitive human-only:** no agent pre-fill/suggest path (S5 tripwire + S2/S3 actor=user).
- **business reads, doesn't recompute:** evidence read from persisted fields, no engine calls (S4 structural).
- **persisted + projected:** answers travel on the signed artifact + appear on the projection (S2/S3).
- **extensible:** adding an item is data, flips completeness (S1) + copy renders from data (S5).
- **wiring-conformance:** reachable in both live sign-off flows (S5).

## Critical files
- New: `packages/strategies/src/checklistParams.ts` (+ the pure evaluator there or a sibling); `packages/workflow/src/__tests__/checklistWiringConformance.test.ts`; checklist UI (extend `WatchlistPromotionForm.tsx` + the holding-review-confirm surface).
- Modify: `packages/workflow/src/watchlistWorkflow.ts` (`confirmWatchlistDraft` completion-block + payload), `apps/web/src/lib/workflow.ts` (`promoteResearchCaseToWatchlist`), `apps/web/src/app/api/research/[caseId]/watchlist/route.ts`, `packages/workflow/src/holdingReviewWorkflow.ts` (`confirmHoldingReviewDraft` host), the watchlist/holding-review event contracts (`domainEventContracts.ts` — additive `checklist_answers`), `researchCaseProjection.ts`/`watchlistProjection.ts`/holding projection (project answers + the 2 evidence fields), `/strategy`·`/learn` copy.
- Reuse unchanged: the persisted valuation/cluster/shariah/floor projection fields (read-only), the cadence `reunderwrite_due` nudge (untouched — it surfaces the due-ness; the sign-off is the human host).

## Resolved decisions (owner-confirmed 2026-06-16)
1. **Re-underwrite host:** gate the existing `confirmHoldingReviewDraft` (reuse) — AND treat it as the integrity fix it is (an ungated confirmation that confirms nothing → the re-underwrite twin of the Phase-4 signed-thesis fiction). Watch other callers; prove re-underwrite can't complete unaddressed; items 10 + 11 genuinely forced there. (S3.)
2. **The two additive evidence persists:** SHIP (uniform grounding for all 11 business items) — *provided* they are genuine persist-only of already-computed values; if either needs new computation, STOP and flag. (S4.)
3. **Answer storage:** ride `checklist_answers` on the existing sign-off payloads — the answers ARE part of the human sign-off (one atomic attestation, like `signed_thesis`); a separate event would decouple sign-off from substance, the exact thing we're fixing. (S2/S3.)
4. **CHECKLIST_PARAMS home:** `@owlfolio/strategies` (sibling of sellParams/sizingParams). Confirmed.

## §6 — what this is NOT (guardrails)
Not a gate, not a score/rubric/tally, not an auto-reject, not an agent assessment of the human's cognition, not a wholesale import of Pabrai's special-situation 80 questions (those → Lane 2, §7), not a recompute of values other phases produce.

## §7 — owed / forward
Pabrai's 80-question special-situation list → Lane 2 (not here). Phase 8 closeout does the /strategy·/learn cohesion sweep incl. these checklists. #124 MoS-freeze + F.2 anchor-swap remain owed (separate coordinated session, blocked on the curated cheap-in-crash cohort).

## Verification
Each slice on the final tree: `git diff --check` · `typecheck` · `test` · `lint`; web slices also `next build`. Phase acceptance = the §5 gates pass (esp. completion-block on BOTH hosts + the no-scoring + cognitive-human-only tripwires) and `checklistWiringConformance` is green. Run `e2e` at phase close (admission + re-underwrite sign-off paths now carry a required checklist — the e2e intake spec touches the admission path). Push per slice-group; subagent-driven with spec/quality review between slices.
