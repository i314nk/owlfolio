# Phase 4 — Discovery = the Admission Operation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make discovery *the operation that admits a name into `watched`*: a mechanical **Screen** (circle-of-competence config check + cheapness on a gate-passing business) followed by the **Admit** judgment (is the cheapness a fixable temporary problem or permanent impairment?) — agent-reasoned with an independent bear case, human-decided, producing `candidate → watched` + a locked buy-below + a signed thesis.

**Architecture:** `agents propose · deterministic harness computes · humans decide`, grounding + append-only contracts preserved. The circle is **human-set config the harness only CHECKS, never infers** (F.12 / Part-G item 5 — same discipline as the discount anchor). The cheapness screen is a **reader of the Phase-1 valuation core**, never a parallel OE computation. The admit step is a **thin forcing-layer** over the existing swarm verdict + an independent red-team bear case (the swarm reasons about quality-in-the-abstract; no existing lane makes the impairment call — verified).

**Tech Stack:** `@owlfolio/shared` (config), `@owlfolio/workflow` (screen + admit), `@owlfolio/strategies` (gate + Phase-1 OE), `apps/web` (`/api/research/start` gate + admit UI), vitest.

## Carry-forward refinements (owner, must be honored)
1. **Circle = pure config check, never agent-inferred.** No LLM in the boundary decision.
2. **Size bound is the deferred Pabrai-Principle-5 axis** — ship permissive (no min cap) and ANNOTATE it in config as the strategically-distinct decision (small-investor edge down-cap vs data-coverage/moat-availability/Shariah-reliability), NOT a buried "min $2B for liquidity" default.
3. **Cheapness screen READS Phase-1 normalized owner earnings** (maint-capex-adjusted, SBC-handled) — it does not recompute OE (else two drifting definitions of "cheap").
4. **Admit carries uncertainty AND permanent-loss-risk as SEPARATE grounded fields** (Pabrai P7), with the bear case generated INDEPENDENTLY (argue permanent-impairment from the filings, not handed the bull case to poke holes) and attacking the permanent-loss-risk claim specifically.

---

## File Structure
- **Modify** `packages/workflow/src/secEdgar.ts` — parse `sic` (+ `sicDescription`) from the submissions JSON already fetched; surface on `Fundamentals`.
- **Modify** `packages/shared/src/appConfig.ts` — `circle_of_competence` config (permissive default; size bound annotated as the deferred P5 axis), with merge/clamp following the existing pattern.
- **Create** `packages/workflow/src/circleOfCompetence.ts` — pure `inCircle(candidate, config)` check (sector/SIC, archetype, size); deterministic, no agent.
- **Create** `packages/workflow/src/cheapnessScreen.ts` — over EDGAR + market cap, among gate-passing names, owner-earnings yield (Phase-1 OE ÷ EV); cheap-on-wonderful.
- **Create** `packages/workflow/src/admitJudgment.ts` — the thin forcing-layer: consumes the swarm verdict + an independent red-team bear case → emits `uncertainty` + `permanent_loss_risk` (separate, grounded) + the impairment call.
- **Modify** the watchlist admit path (`packages/workflow/src/watchlistWorkflow.ts`) — carry the locked buy-below + signed thesis on `candidate → watched`.
- **Modify** `apps/web/.../api/research/start` — reject out-of-circle names pre-spend; surface the admit recommendation in the research/admit UI.

---

## Task 4.1a — SIC / sector from EDGAR
**Files:** `packages/workflow/src/secEdgar.ts`; test `packages/workflow/src/__tests__/secEdgar.test.ts`.
- [ ] Failing test: a fixture submissions JSON carrying `sic: '7372'` + `sicDescription` → `fetchCompanyFundamentals` surfaces `sic`/`sic_description` on `Fundamentals` (and undefined when absent — fail-open, no fabrication). RED.
- [ ] Implement: extend the `Submissions` type + parse `sic`/`sicDescription` in the existing submissions fetch; add the fields to `Fundamentals`. GREEN.
- [ ] Commit: `feat(workflow): parse EDGAR SIC/sector from submissions`.

## Task 4.1b — circle_of_competence config (permissive default; size = deferred P5 axis)
**Files:** `packages/shared/src/appConfig.ts`; test `packages/shared/src/__tests__/appConfig.test.ts`.
- [ ] Failing test: `circle_of_competence` defaults to PERMISSIVE (no allowed-list ⇒ admit everything; no min/max cap), merges a partial config, clamps invalid values fail-closed-to-permissive. RED.
- [ ] Implement following the `mergeAutomationSettings`/clamp pattern. Config shape: `{ enabled: boolean (default false=permissive), allowed_sic_prefixes?: string[], excluded_sic_prefixes?: string[], allowed_archetypes?: string[], min_market_cap_musd?: number, max_market_cap_musd?: number }`. **Annotate `min/max_market_cap_musd` in a doc comment as the deferred Pabrai-Principle-5 decision** (the small-investor edge lives down-cap; a high min-cap forecloses it, a low one strains data coverage/moat-availability/Shariah-screen reliability — set deliberately, not reflexively). GREEN.
- [ ] Commit: `feat(shared): circle_of_competence config (permissive default; size as deferred P5 axis)`.

## Task 4.1c — circleOfCompetence.ts (pure check) + pre-spend gate
**Files:** Create `packages/workflow/src/circleOfCompetence.ts`; test sibling; modify the `/api/research/start` route.
- [ ] Failing test: `inCircle(candidate, config)` — permissive config admits all; an `excluded_sic_prefixes`/`allowed_sic_prefixes` config rejects/admits by SIC prefix; archetype + min/max market-cap bounds enforced; returns `{ in_circle: boolean, reason? }`. **No LLM / no inference** — pure config match. A candidate with unknown SIC under a restrictive allowed-list → rejected with a clear reason (fail-closed only when the owner has restricted; permissive default never rejects). RED → implement → GREEN.
- [ ] Wire into `/api/research/start`: before spending on research, run `inCircle`; if out-of-circle, reject pre-spend with the reason (no research case created). Test the route rejects out-of-circle + admits in-circle. Per-phase UI: surface the rejection reason.
- [ ] Commit: `feat(workflow): circle-of-competence check + pre-spend gate at /api/research/start`.

## Task 4.1d — cheapnessScreen.ts (reads Phase-1 OE)
**Files:** Create `packages/workflow/src/cheapnessScreen.ts`; test sibling.
- [ ] Failing test: `screenCheapness({ fundamentals, market_cap, gate_passing })` computes EV = market_cap + total_debt − cash, owner-earnings yield = (Phase-1 normalized OE) ÷ EV, and flags `cheap` when yield ≥ a config threshold (default tunable) — but ONLY surfaces a name when `gate_passing` (cheapness alone is never the signal). RED.
- [ ] Implement: **import the Phase-1 OE from the valuation core / `secEdgar` `ownerEarningsPerShareSeries` (the normalized, maint-capex-adjusted, SBC-handled series) — do NOT recompute a shortcut OE here.** Use the latest normalized OE × shares for total OE. Fail-closed when inputs absent. GREEN.
- [ ] Test: a gate-passing cheap name is surfaced; a cheap-but-gate-failing name is NOT; a gate-passing-but-expensive name is NOT. Confirm the OE used equals the Phase-1 series value (no drift).
- [ ] Commit: `feat(workflow): cheapness screen (owner-earnings yield on gate-passing names, reads Phase-1 OE)`.

## Task 4.2a — admitJudgment.ts (the thin forcing-layer)
**Files:** Create `packages/workflow/src/admitJudgment.ts`; test sibling; reuse `redTeamPass`.
- [ ] Failing test: `buildAdmitRecommendation({ swarmVerdict, bearCase, valuation })` emits a recommendation REQUIRED to carry, as SEPARATE grounded fields: `uncertainty` (level + argument + citations) and `permanent_loss_risk` (level + argument + citations), plus the impairment call (`fixable_temporary | permanent_impairment | unresolved`) answering "the verdict says it's a good business; given it's cheap, what broke, and does it threaten permanent capital loss or just create uncertainty?". The two fields must be DISTINCT (a high-uncertainty/low-permanent-loss case is admittable; a low-uncertainty/high-permanent-loss case is a trap). RED → implement → GREEN.
- [ ] The bear case is generated INDEPENDENTLY (argue permanent-impairment from the filings — reuse `runRedTeamPass`; if it is critique-the-thesis style, add an independent impairment-bear framing so it doesn't merely poke holes in the bull case) and the recommendation routes the bear case at the `permanent_loss_risk` claim specifically (that's where a value trap hides — low stated permanent-loss risk that's actually high).
- [ ] **PAIRED forcing-function test (the acceptance gate — both poles required, from the SAME layer):** (a) a name that passes the quality verdict but whose cheapness cause is terminal (eroder-like, ADBE/CRM/WDAY shape) → `permanent_impairment` / high permanent-loss-risk, NOT a clean admit; AND (b) a quality name cheap for a temporary, recoverable reason (Frontline / AmEx-salad-oil shape: high uncertainty, low permanent-loss risk) → `fixable_temporary` / low permanent-loss-risk. **Both poles from one judgment path = proof of DISCRIMINATION. An eroder-only test can be passed by a layer that just says "permanent" a lot — it is only half a test.** This paired test is the phase's load-bearing acceptance gate.
- [ ] **Review check (verify in the CODE PATH, not just the prose):** the bear case feeding the judgment is genuinely generated INDEPENDENTLY (argues permanent-impairment from the filings cold), NOT a `redTeamPass` handed the admit/bull thesis to poke holes in — the latter produces a systematically weaker bear case and the value-trap hides precisely in that gap. If the existing red-team is critique-the-thesis style, the implementation must add an independent impairment-bear framing.
- [ ] Commit: `feat(workflow): admit judgment forcing-layer (uncertainty vs permanent-loss-risk, independent bear case)`.

## Task 4.2b — admit transition (candidate → watched, human-authored)
**Files:** `packages/workflow/src/watchlistWorkflow.ts`; tests.
- [ ] Failing test: on admit (human), the `watchlist_draft_created`/`confirmed` carry the **locked buy-below** (from the Phase-1 valuation `buy_price_per_share`, frozen at admit) and a **signed plain-language thesis** field; the transition is human-authored (actor=user), append-only, no auto-admit. RED → implement → GREEN.
- [ ] **Record the MoS provenance on the locked buy-below.** The Phase-1 MoS is still PROVISIONAL (#124 owed), so every Phase-4 buy-below is provisional-MoS-derived. The locked buy-below MUST record which valuation/MoS version (`VALUATION_PARAMS.version`) it was frozen under, and be SHOWN as provisional-MoS-derived — so when the MoS freeze finally lands it is a VISIBLE, logged RE-PRICE of the watched name (F.9/F.10 "don't move the number" discipline: a buy-below changed by the eventual freeze is a legitimate re-price, but a logged/visible one, never a silent invalidation of a locked thesis). Test: the admit payload carries the frozen MoS/valuation version.
- [ ] Confirm the admitted name now appears as `watched` in `nameLifecycleProjection` with its locked buy-below (the Phase-3 engine then runs on it). No new event types if avoidable; extend the existing payloads.
- [ ] Commit: `feat(workflow): admit candidate→watched with locked buy-below (+ MoS provenance) + signed thesis`.

## Task 4.3 — UI + /strategy·/learn copy
- [ ] Surface the admit recommendation (cheapness + uncertainty/permanent-loss-risk + bear case) for human admit/reject; show the circle pre-spend rejection reason. Component tests.
- [ ] Update `/strategy` + `/learn`: discovery=admission, circle-of-competence (config-checked not agent-inferred; size as the deferred P5 axis), cheapness-on-wonderful, the uncertainty-vs-permanent-loss admit judgment. No overclaim (size bound is permissive/deferred; admit is human-decided).
- [ ] Commit: `feat(web): admission UI + discovery/circle/admit method copy`.

---

## Invariants (must not regress)
Circle is config-checked, never agent-inferred · cheapness reads Phase-1 OE (no parallel OE) · admit is agent-reasoned, human-decided, append-only, no auto-admit · the impairment layer forces uncertainty + permanent-loss-risk as separate grounded fields (no hollow quality-verdict re-frame) · grounding preserved · circle rejects PRE-spend (cost discipline) · size bound shipped permissive + flagged as the deferred P5 decision.

## Verification (each task, final tree)
`git diff --check` · `corepack pnpm typecheck` · `corepack pnpm test` · `corepack pnpm lint`; web tasks also `next build`. Each behavior TDD'd. The forcing-function test (4.2a: eroder-like name → permanent_impairment, not a clean admit) is the phase's key acceptance gate.
