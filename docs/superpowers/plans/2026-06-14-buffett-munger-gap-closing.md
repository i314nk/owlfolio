# Buffett-Munger Method Gap-Closing + Unified Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Phases are ordered by dependency; each is independently shippable.

**Goal:** Bring the Owlfolio harness into faithful alignment with the documented Buffett-Munger method (`~/Downloads/Buffett_Munger_Method.docx`) and express the owner's unifying lifecycle structure — one name-list with states, one cadence engine — collapsing the stacked over-conservatism that currently makes the harness structurally unable to buy quality.

**Architecture:** Preserve every existing seam — `agents propose · deterministic harness computes · humans decide`, the grounding invariant, params-as-versioned-config. Valuation math stays pure in `@owlfolio/strategies`; lifecycle/sizing/sell logic in `@owlfolio/workflow`; config in `@owlfolio/shared`; UI is projection-driven. Reframe the separate research-case/watchlist/holding projections behind one state machine + one cadence engine **without changing the underlying event contracts.**

**Tech Stack:** TypeScript, pnpm workspaces, vitest (TDD), Zod, Next.js, SEC EDGAR + Yahoo adapters, node:sqlite event store.

---

## Context

Two drivers:

1. **Method-doc gaps.** Assessed against the harness, the method is ~55–65% fulfilled. Strong on the deterministic chassis (grounding, owner-earnings from primary filings, wide-moat gate, red-team inversion, Shariah-as-orthogonal-veto, human-at-irreversible-action, default-inaction). The dominant gap is the doc's **#1 fix — "one conservatism knob, not five"** — confirmed live this session: GOOGL valued at ~13× owner earnings while it trades at ~41× (fair $116 vs market $360), so quality is never buyable. Secondary gaps: no reverse DCF / sensitivity range, no circle-of-competence gate, no explicit Munger bias checklist, moat *direction* and management metrics not harness-computed, valuation blind to distribution-driven (buyback/pricing-power) compounding.

2. **The unifying lifecycle structure** (owner directive) — make the whole system one list of names moving through states, driven by one cadence engine, instead of separate discovery/watchlist/holding/monitor pieces.

These are complementary: the valuation fix produces the honest *locked buy-below* that the lifecycle runs on.

## The unifying structure (overarching frame)

**One list of names, each in a state:**
- `candidate` — surfaced by screening, not yet admitted
- `watched` — admitted, has a locked buy-below, price-monitored, not yet owned
- `held` — owned, thesis-monitored
- `exited` — pruned (if it was watched) or sold (if it was held)

**One cadence engine over the whole list:** falsifier-check (quarterly / on 10-Q) + full re-underwrite (annual / on 10-K). **Detection is identical across states; only the downstream action branches on the name's state.**

**Constitutional cross-cuts:** agent makes the judgment · harness enforces structure · human makes the final call on irreversibles · **every recommendation (admit, size, sell) reaches the human with its inversion (bear case) attached.**

Today this lives as separate pieces — `researchCaseProjection` (stages), `watchlistProjection`, `holdingProjection`, per-type monitors in `lifecycleMonitors.ts`. The plan unifies them behind one state machine + one cadence engine, reusing the existing event contracts and projections underneath.

---

## File-structure map (extend ▸ vs create ✚)

- **Valuation:** ▸ `strategies/src/{valuationParams,buffettMunger}.ts`; ✚ `strategies/src/{ownerEarningsGrowth,reverseDcf,valuationSensitivity}.ts`; ▸ `workflow/src/{secEdgar,researchSwarm,backtest}.ts`
- **Lifecycle frame:** ✚ `ledger/src/projections/nameLifecycleProjection.ts`; ▸ `workflow/src/lifecycleMonitors.ts` → one cadence engine; ▸ `apps/worker/src/runtime.ts` (consolidate monitor tasks → `falsifier_check` + `re_underwrite`)
- **Discovery=admission:** ✚ `workflow/src/cheapnessScreen.ts`, `strategies/src/circleOfCompetence.ts`; ▸ `shared/src/appConfig.ts` (circle config), `apps/web/src/app/api/research/start/route.ts`; complements ▸ `workflow/src/discovery13f.ts`
- **Sizing:** ✚ `strategies/src/{kellySizing,aggregateExposure}.ts`; ▸ `strategies/src/{positionSizing,sizingParams}.ts`, `workflow/src/positionSizingEngine.ts`
- **Sell engine:** ▸ `workflow/src/{holdingReviewWorkflow,lifecycleMonitors}.ts`; ✚ sell-trigger + guards module
- **Quality/bias:** ▸ `workflow/src/{researchSwarmSchemas,judgmentAnchor}.ts`, `strategies/src/judgmentRubrics.ts`; ✚ `strategies/src/managementMetrics.ts`, `workflow/src/{biasChecklist,sourceIndependence}.ts`
- **UI:** ▸ `apps/web/src/components/ResearchCasePanel.tsx` + portfolio/watchlist panels (range-first valuation, inversion-attached, lifecycle state)

---

## Phase 1 — One conservatism knob + honest, distribution-aware growth  *(method-doc #1; unblocks the honest buy-below)*

Today `creditedGrowth = min(reinvestment_rate × incremental_roic, band_ceiling, max_growth)` gated on `incremental_roic > 0.10` (three growth haircuts), then terminal fade + horizon cap + 18× `fv_cap_multiple` + moat-tiered `margin_of_safety` — 5+ stacked conservatism layers — and growth credited **only** from reinvestment (blind to buybacks/pricing power).

**Authoritative method:** implement Part D Steps 1–4 + 6 of `~/Downloads/Owlfolio_Gap_Closing_Plan.md` (the tightly-specified valuation algorithm). Summary: honest owner earnings (Step 1: dual maintenance-capex proxy, normalised/median) → **one growth path** = durability-justified historical owner-earnings growth with a **named ~20% forecasting-humility cap** (F.3); **above-GDP growth is treated as a moat-durability claim** (lowest-confidence, human-weighted) — "one knob + one named backstop", honestly not pure one-knob; linearly faded to ~2.5% over years 6–10 (Step 2) → discount = **10y Treasury + fixed equity premium (~4.5–5.5%)**, uniform, **no quality knob**, **global config — human-set once, NOT an agent input** (Step 3) → terminal Gordon with **TV-share surfaced + flagged >65%** (Step 4) → **ONE end-stage margin of safety** that widens with TV share, sensitivity dispersion, low maint-capex confidence, weak moat durability; 18× cap → sanity flag (Step 6). **THREE agent-proposed inputs** (maint-capex, growth path, moat-durability — growth + moat-durability **converge above GDP**, not three independent inputs) within harness rails, each carrying its **specific filing citation** the human checks; the **discount anchor is config, not agent-chosen** (corrects the earlier "four inputs" framing — it contradicted Step 3). Agent latitude follows a **falsifiability gradient** (Downloads doc Part G): more checkable → more latitude; least-checkable (moat durability) → flagged lowest-confidence, human-weighted. All arithmetic deterministic.

### Tasks
- [ ] **1.1 Per-year OE/share series** — `secEdgar.ts` `ownerEarningsPerShareSeries(fundamentals)` → `[{fiscal_year, oe_ps}]`. **D-SBC RESOLVED (review F.1): keep `−SBC` AND hold share count flat (current diluted shares, no forward dilution)** — subtracting SBC while projecting diluted-forward shares double-counts the same dilution. A test asserts flat share count whenever SBC is subtracted — **on the projection** (forbid a forward model that *grows* shares while subtracting SBC; the **current** diluted count is fine — review F.1). TDD.
- [ ] **1.2 Dual maintenance-capex proxy** — ✚ `ownerEarningsGrowth.ts`/`maintenanceCapex.ts`: **Greenwald** (`avg(grossPP&E/sales) × Δsales$`, subtracted from total capex) **and** **D&A floor**; default = the more conservative; agent must argue to use less. TDD.
- [ ] **1.3 Single growth path — durable-source justification + named ~20% humility cap + moat-durability coupling (review F.3, FINAL)** — honest historical owner-earnings growth (from 1.1), faded to ~2.5% over yrs 6–10; replaces `creditedGrowth`'s reinvestment×ROIC + 5 band ceilings. **(a) Primary test = durable-source argument:** the agent must state *why the growth source persists*, not just cite past growth — a citation grounds "grew 22% last year" but not "grows 20% for a decade." **(b) Named ~20% forecasting-humility cap** (config) sits *behind* (a), set above in-circle compounders' sustained rates so it bites only over-optimism, surfaced when it binds; it is NOT a license ("under 20%?" never replaces "durable source?"). **The 20% is a PLACEHOLDER — set the level against the circle's actual 5–10yr OE CAGRs at the 1.9 calibration before freezing (else it bites a real compounder); not a derived number.** **(c) NEW behavioral coupling:** when the proposed near-term rate exceeds GDP by a margin, the harness routes the growth justification through the **same lowest-confidence / human-weighted path as moat-durability (Phase 7.1)** and surfaces them together — growth gets loose latitude only where it's falsifiable (near recent history). Agent may argue lower, never higher. TDD: a buyback-heavy compounder earns its real growth; an above-GDP rate triggers the moat-durability treatment; calibration checks GOOGL is buyable at a *defensible* price (not a runaway). **Honest: this is "one knob + one named backstop," not pure one-knob.**
- [ ] **1.4 Treasury-anchored discount (+ backtest attribution)** — `discount = tenYearTreasury + equity_premium` (**global config, human-set once; NOT a per-name agent input — review G**; Treasury via `marketData.ts`, fail-closed to a documented default); **no quality-adjustment knob**. **Review F.2:** run calibration with the **flat rate** to measure price dislocation cleanly, evaluate Treasury+premium separately for live, and have the backtest **attribute each must-signal firing to price vs rate** (the 2022 date can fire on rates, not price). D-discount (live) decided on that evidence. TDD.
- [ ] **1.5 Terminal-value share flag** — surface `terminal_value_pct_of_iv`; flag `> 0.65`; feed it into the MoS-widening (1.6). TDD.
- [ ] **1.6 Collapse to ONE MoS knob** — single end-stage `margin_of_safety` (floor 25–35%, widened toward 50% by TV share / sensitivity dispersion / low maint-capex confidence / weak moat). 18× `fv_cap_multiple` → sanity *flag* (`cap_exceeded`), not silent truncation. Collapse the 5 stacked conservatism fields in `valuationParams.ts`. TDD.
- [ ] **1.7 Wire through swarm** — `researchSwarm.ts` records `growth_basis`, `discount_inputs`, `terminal_value_pct_of_iv`, `margin_of_safety_applied`; **lock the buy-below** (no agent re-solve upward). TDD.
- [ ] **1.8 Version bump + ledger event** — `valuationParams.version → valuation-2026-06-one-knob-1`; `valuationConfigEvent` records the diff.
- [ ] **1.9 Calibration re-run (OWNER gate)** — run `backtest.ts`; expect buys for quality names at historically-fair prices, must-signal 2020-03/2022-09 fire (with price-vs-rate attribution, F.2), buys/yr ∈ [1,3] (sanity, not quota, F.7); owner reviews + **freezes the MoS floor + widening + equity premium AND the ~20% growth-cap LEVEL set against the circle's actual 5–10yr OE CAGRs** (the 20% is a placeholder, not a derived number — measure before freezing, or it bites a real compounder; valuation-recalibration-spec §3). **Asymmetric stress (review F.3): a %-MoS *scales* an inflated IV rather than removing it, so the durability requirement + reverse-DCF flag + named cap together must catch over-optimism. Test the downside: a plausibly over-optimistic growth input on a compounder must NOT produce a buy-below the method should have refused.** **Broaden the date set (review F.11): this single gate now freezes 5 decisions (MoS, the F.3 named-cap-and-durability test, D5, D6, F.2) — add non-dislocation reference points (a frothy peak e.g. late-2021 → "buy nothing"; a flat/boring period → "do nothing") so the freeze is tested against correctly-declines + correctly-does-nothing, not only fires-in-a-crash. Overfitting two crash dates is the risk.**

---

## Phase 2 — Reverse DCF + sensitivity range as the primary output  *(overconfidence defense)*

- [ ] **2.1** ✚ `reverseDcf.ts` `marketImpliedGrowth({price, oe_ps, terminal_g, discount, horizon})` via bisection over `twoStageFairValuePerShare`; `undefined` outside a sane band. TDD.
- [ ] **2.2** ✚ `valuationSensitivity.ts` `fairValueRange(...)` over a g × discount grid → `{low, base, high}` (`low ≤ base ≤ high`). TDD.
- [ ] **2.3** Attach `market_implied_growth` + `fair_value_range` to `buffett_munger_analysis_drafted`; project (`fair_value_range` field already exists; add `market_implied_growth`); dossier leads with the **range + market-implied-g vs ours**, demotes the point estimate.

---

## Phase 3 — Unified name-list state machine + one cadence engine  *(the lifecycle frame)*

- [ ] **3.1** ✚ `nameLifecycleProjection.ts` — compose research-case/watchlist/holding projections into one list with state `candidate|watched|held|exited` (derived from existing events; no new event types). TDD against fixture event streams.
- [ ] **3.2** Refactor `lifecycleMonitors.ts` into **one cadence engine**: a single `falsifier-check` (quarterly/10-Q) + `re-underwrite` (annual/10-K) pass whose **detection is state-independent**, reusing `evaluateCaseFreshness`, `evaluateWatchlistBuyWindow`, the Shariah re-screen. The resulting action **branches on state**: candidate→admit-review, watched→reprice/prune, held→sell-review.
- [ ] **3.3** Consolidate worker tasks (`runtime.ts`) → `falsifier_check` + `re_underwrite` over the whole list (keeping the existing per-type tasks as thin wrappers for back-compat). Dry-run, no auto-trade.

---

## Phase 4 — Discovery = the admission operation

- [ ] **4.1 Screen** — ✚ `cheapnessScreen.ts`: over EDGAR, among names already passing the quality gate, surface cheap-on-EV/owner-earnings. *Cheapness alone is never the signal — cheapness on an already-wonderful business is.* Incorporate the **circle-of-competence** gate: ✚ `circleOfCompetence.ts` + `circle_of_competence` config in `appConfig.ts`; reject out-of-circle names pre-spend at `/api/research/start` (sector via EDGAR SIC). **D4 RESOLVED (F.12): human-set config, NOT agent-inferred** (an agent rationalizes any name into the circle — same class as the discount anchor); post-EDGAR-US-only it narrows on **sector/archetype/size** (geography axis collapsed — the harness *checks* against config, never *infers* the boundary). Complements `discovery13f.ts` (a second admission source).
- [ ] **4.2 Admit (heaviest human weight, most agent reasoning — least automatable)** — agents argue the one question: *is the cheapness a fixable temporary problem on a durable franchise, or permanent impairment?* (Coke '88, AmEx salad-oil, Japanese trading houses = temporarily marked down, not declining.) Agent makes the call **with its bear case attached**; human admits/rejects. On admit: `candidate → watched` + locked buy-below (from the Phase-1 valuation) + a signed plain-language thesis (doc Gate 0 `[Hu]`).

---

## Phase 5 — Position sizing = the watched → held transition

Fires when a `watched` name's price crosses its currently-valid buy-below. Extend existing sizing (already does moat-weight + tranches + 15% per-name cap + re-anchoring).

- [ ] **5.1 Base size from edge × conviction** — margin-of-safety available × conviction score from the quality/moat/management gates.
- [ ] **5.2 Fractional Kelly ceiling** — ✚ `kellySizing.ts`: `edge ÷ odds` from upside/downside/probability, take half/quarter (haircut for *estimation error*, not volatility). TDD.
- [ ] **5.3 Aggregate, not isolated** — ✚ `aggregateExposure.ts`: net correlated downside across the whole book before recommending (three names breaking in one scenario = one bet). TDD.
- [ ] **5.4 Two deterministic hard caps** — max single-position weight (existing 15% per-name) **and a new permanent-loss rule**: refuse any size whose realistic downside causes unrecoverable portfolio impairment, regardless of upside. TDD that a failing size is rejected.
- [ ] **5.5 Portfolio-level allocation on clustered pitches (review F.5)** — the per-position caps don't answer "several `watched` names cross buy-below in the same dislocation (2020-03) and capital can't fund all at target size." **By design a human call:** the harness ✚ ranks the cluster by edge × conviction and surfaces the capital-constrained trade-off (each name's target size + worst case); it never auto-picks. **Connect ranking to the correlation guard:** edge×conviction is also the 5.1 sizing base, so ranking + sizing on one scalar can double-concentrate; and cluster names are correlated (same dislocation), so each can pass its individual permanent-loss check while the **basket** fails it. **The 5.3 correlation-aggregation + 5.4 permanent-loss cap MUST bind across the cluster being allocated, not just the existing book.** TDD: a correlated cluster that individually passes but aggregates to unrecoverable downside is rejected.
- [ ] **5.6 Output** — recommended size + conviction/MoS inputs + fractional-Kelly suggestion + **explicit worst case**; human takes/trims/vetoes. Advisory only. **D5 sizing constants are dry-run/backtest-gated before live (review F.6).**

---

## Phase 6 — Sell decisions = the held exit operation

Sell because the business changed, not the price. Extend `holdingReviewWorkflow.ts` + complete the deferred thesis-break detection. **Four triggers, never fired by price alone:**

- [ ] **6.1 Thesis broke** (primary) — a pre-written falsifier trips → human decides sell or **amend**; amend is a deliberate, logged, **human-signed** act (sell-side mirror of "don't move the number").
- [ ] **6.2 Valuation inverted** — price exceeds intrinsic by a large multiple of the MoS; set high, used rarely, biased toward holding.
- [ ] **6.3 Better opportunity under capital constraint** — superior pitch + genuinely out of cash → weakest holding funds it; fires only on a wide edge margin (rarest, most churn-prone).
- [ ] **6.4 Original mistake** — analysis wrong from the start (Munger thumb-sucking → correct promptly; bias flips toward selling; anti-anchoring).
- [ ] **6.5 Two guards** — disposition-effect flag (sell driven by the gain? hold driven by the loss?) + purchase-price-anchoring guard (entry price irrelevant; the harness must not surface entry price prominently in a sell review).
- [ ] **6.6 Watched-name pruning** — same detection, softer exit: a `watched` name whose thesis breaks on re-underwrite is repriced (buy-below lowered) or pruned (`watched → exited`).
- [ ] **6.7 Backtest-gate the sell thresholds (review F.6)** — D6 thresholds (valuation-inverted multiple, better-opportunity edge margin) churn the book if mis-set; **dry-run the sell triggers over the historical set and freeze against the same backtest** before they go live.
- [ ] **6.8 Symmetric "don't move the SELL number" guard (review F.9)** — the buy-below is guarded against upward re-solve; the symmetric hole is the **annual re-underwrite** routinely producing a new IV on a `held` name (no discrete trigger), which silently moves the valuation-inverted sell threshold. **A re-underwrite that changes a held position's IV is a flagged event requiring the same logged, human-signed sign-off as a thesis amendment** (it changes a number governing an irreversible decision). TDD: an IV change on a held name without sign-off does not move the sell threshold. **F.10 (F.9×F.2 interaction): the valuation-inverted trigger keys off the sign-off-frozen IV from the last re-underwrite — live Treasury-rate-driven IV is informational and must NOT silently drift the sell threshold** (else the rate moves the number F.9 protects). Decide + wire before sell triggers go live.

---

## Phase 7 — Quality + bias hygiene  *(method-doc Layers 2–3 + Munger; inversion-attached everywhere)*

- [ ] **7.1 Moat direction** — add `moat_direction` (widening/stable/eroding) to the moat lane schema; `judgmentAnchor` flags contradiction vs the computed multi-year ROIC/margin trend.
- [ ] **7.2 Management metrics** — ✚ `managementMetrics.ts` (buyback-timing-vs-value, dilution trend, debt-through-cycles from the EDGAR series); make rubric MG1/MG6 computable.
- [ ] **7.3 Munger anti-bias checklist** — ✚ `biasChecklist.ts` (availability/social-proof/authority/contrast/overconfidence — advisory flags) run pre-decision.
- [ ] **7.4 Source-independence** — ✚ `sourceIndependence.ts` flags correlated lanes citing one source ("social proof in a wig").
- [ ] **7.5 Inversion attached to every recommendation** — extend the red-team/bear-case attach pattern from research to **admit, size, and sell** recommendations.
- [ ] **7.6 Valuation-input citation guard + falsifiability gradient (review G)** — each agent-proposed valuation input (maint-capex departure, growth path, moat-durability) carries the **specific filing line it's grounded in**; the human signs a citation, not a vibe. Latitude follows falsifiability: maint-capex = narrow (departures must cite the PP&E rollforward), growth = bounded-by-rails, moat-durability = least-falsifiable → flagged **lowest-confidence** + human-weighted most. (The discount anchor is config, never agent-proposed — Phase 1.4.) TDD: an ungrounded departure is rejected.

---

## Phase 8 — Closeout

- [ ] Re-dogfood GOOGL/AAPL/COST/MSFT **plus a permissible no-growth/declining name** on Codex (xhigh): compounders become buyable at sane prices AND the decliner is still correctly **declined** (review F.8 — all four are compounders; confirm the method doesn't only newly-accept, it still refuses to overpay). NB: BAT short-circuits on the tobacco sector screen, so pick a permissible mature/declining business for the valuation test. Range renders; full candidate→watched→held→exited lifecycle visible.
- [ ] Re-run calibration; owner freezes the MoS value (and equity premium / discount choice per F.2).
- [ ] Confirm golden-set qualification unaffected (moat/OE/Shariah scorer untouched — the two qualified gpt-5.5 paths stay qualified).
- [ ] **Docs/UI cohesion pass** — update **`/strategy`** (renders the method + live valuation params: durable-source growth + named cap, Treasury+premium discount, reverse-DCF + sensitivity range, the unified candidate→watched→held→exited lifecycle, Kelly/permanent-loss sizing, four-trigger sell engine, circle of competence), **`/learn`** (teaches the same), and the dossier/portfolio/watchlist/pipeline surfaces — so nothing overclaims past the implemented method and no stale v1 text remains. (Per-phase UI ships with each phase; this is the final cohesion sweep.)
- [ ] Full gate; then address the land-held ~100-commit branch merge.

---

## Owner decision points (sign-off before the dependent phase freezes)
- **D-SBC** *(resolved F.1)* keep `−SBC` **and** hold share count flat (no forward dilution) — avoids the double-count — Phase 1
- **D-discount** *(resolved G + F.2)* **global config, human-set once — NOT a per-name agent input** (it carries no quality knob; an agent choice would nudge the premium for liked names); live flat-vs-`Treasury+premium` decided on the F.2 backtest attribution — Phase 1
- **D-growthcap** *(resolved F.3, FINAL)* **durable-source justification (primary) + a named ~20% forecasting-humility cap (backstop) + above-GDP growth coupled to the moat-durability treatment**; honestly "one knob + one named backstop", not pure one-knob — Phase 1
- **D2** terminal/horizon = modeling; FV cap → sanity flag, **not** a hard cap *(F.4)* — Phase 1
- **D3** single MoS value (floor + widening factors) — calibration-frozen, owner-reviewed — Phase 1/8
- **D4** *(resolved F.12)* circle-of-competence: **human-set config, NOT agent-inferred** (an agent rationalizes any name into the circle — same class as the discount anchor, Part G item 5); post-EDGAR-US-only it narrows on **sector/archetype/size** (geography axis collapsed) — Phase 4
- **D5** sizing constants (max weight, Kelly fraction, permanent-loss threshold) — **backtest-gated (F.6)** — Phase 5
- **D6** sell-trigger thresholds (valuation-inverted multiple, better-opportunity edge) — **backtest-gated (F.6)** — Phase 6
- **D-capital-allocation** *(resolved F.5)* clustered fat pitches = human ranks/allocates from the edge×conviction-ranked set; harness never auto-picks — Phase 5

## Invariants preserved (must not regress)
Grounding invariant · human-at-the-irreversible-action · worker dry-run / no-auto-trade · fail-closed external data · no secrets · no overclaiming · golden-set qualification scorer untouched · **UI is a projection — each phase ships its user-visible surface *with* it (dossier/portfolio/watchlist/pipeline), and `/strategy` (method + live params) + `/learn` (teaches it) are kept current so docs never drift past the implemented method**.

## Verification
Each phase, on the final tree: `git diff --check` · `corepack pnpm typecheck` · `corepack pnpm test` · `corepack pnpm lint`; web phases also `next build` + `corepack pnpm e2e`. Phase 1 additionally gated on the **calibration backtest** signal review with the owner (must-signal 2020-03/2022-09 fire with **price-vs-rate attribution** per F.2; **buys/yr ∈ [1,3] is a sanity check, NOT a quota** — zero buyable names in a frothy year is correct, not a failure, per F.7). The GOOGL fair-$116-vs-$360 case is kept as a **regression test**, not just the motivating anecdote. Phase 8 re-dogfood confirms compounders are buyable at historically-fair prices **and a fairly-valued/declining name is still declined**, with the full lifecycle visible.

## Self-review
- Coverage: all 6 method-doc gaps (Phases 1,2,4,7) + the full unifying lifecycle — states/cadence (3), discovery-admission (4), Kelly/permanent-loss sizing (5), four-trigger sell + guards + pruning (6) — are covered; closeout (8) validates empirically.
- Reuse: extends `positionSizing`/`positionSizingEngine`/`sizingParams`, `holdingReviewWorkflow`, `lifecycleMonitors`, `discovery13f`, and the existing projections rather than rebuilding.
- Param *values* in 1.7/D3/D5/D6 are calibration/owner outputs (not placeholders) — the code makes structure one-knob/typed-config; the numbers are owner-frozen.
- Type consistency: `creditedGrowth` gains `demonstrated_oe_growth?`; `growth_basis`, `fair_value_range`, `market_implied_growth`, `moat_direction`, lifecycle `state` used consistently across phases.
