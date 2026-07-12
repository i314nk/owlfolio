# Owlfolio v2 — Buffett-Munger strategy (Design B — Buffett-literal)

Single source of truth for parameters: `packages/strategies/src/buffettMunger.ts` and `packages/strategies/src/strategyContract.ts`. Values quoted in this document are read from those files. If a value here disagrees with the TypeScript source, the source wins.

"Experimental until certified" boundaries still apply — any automated output is a draft or observation until the user explicitly confirms the watchlist or holding transition. See `docs/STRATEGY_GUIDE.md` for strategy workflow boundaries.

---

## 1. Overview

Buffett-Munger is the default strategy for the Owlfolio v2 local-use candidate. It is a **concentrated quality-value** approach, Shariah-aware first-class throughout:

- **Concentrated** — up to 20 positions, maximum 15 % per position, 3 % minimum cash buffer.
- **Quality** — investable only when the business has a durable wide economic moat and positive normalized owner earnings.
- **Value** — the book intrinsic value (2026-07 book alignment, `valuation-2026-07-book-alignment-1`): ten years of free cash flow (CFO − capex, tagged XBRL facts only) grown at the model's cited durable rate, discounted at the **15 % required return** (a user-changeable Setting; the default is the book's rate, not a market-derived one), plus a cite-checked industry **exit multiple** (harness-clamped 8–20×, conservative 12× fallback) on year-10 FCF, plus net cash − debt. Buy = **IV × 0.70** (rule 7, the 30 % required margin) and load-up = **IV × 0.50** (rule 8, the concentrated-sizing zone). A filer without a tagged CFO goes honestly **unpriced** — there is no proxy fallback. The certainty difference between moat classes is captured by the moat gate and sizing, **not** by tiering the discount rate or the margin.
- **Shariah-first** — Shariah screening is the first hard gate; a non-compliant result stops the deep-dive before provider cost is incurred.

### Pipeline

```
Discovery
  → Shariah gate (grounded sector judgment on the primary filing + deterministic AAOIFI ratios, pre-spend)
       ↓ closed: sector non-compliant or ratio FAIL → coherent set-aside dossier, zero lane spend
  → Circle-of-competence gate (P1 — the book's two questions, cite-verified + k-sample agreement:
     how does this company make money, and what key moving parts determine its success or failure)
       ↓ outside circle (or ungroundable) → set aside
       ↓ both gates open: [Automatic | Review-before-deep-dive]
  → PILLAR lanes, staged (Phase 3): understand + moat run first (parallel, grounded)
       ↓ MOAT GATE (early): a below-gate resolved moat ends the run HERE — grounded-narrow → set-aside
         PASS, ungrounded claim → RESEARCH_MORE; Pillars 3–4 spend nothing. A user-authored override
         ("run remaining pillars anyway", recorded on the request event) runs them — the verdict still gates.
  → Management pillar lane (integrity: communication + DEF 14A comp; talent: reconciled against the
     harness ROIC/payout/debt T0 block + the retained-earnings test). A GROUNDED worst-tier judgment
     (integrity red_flag OR poor talent) vetoes an unattended BUY → RESEARCH_MORE naming the trait.
  → Valuation judgment (dedicated grounded stage: the model judges the durable FCF growth rate and the
     industry exit multiple, cite-checked; the harness computes the book intrinsic value — 10y discounted
     FCF (CFO − capex) + exit-multiple terminal + net cash − debt at the 15% required return — plus the
     rule-7 buy price (IV × 0.70), the rule-8 load-up price (IV × 0.50), and the T0 margin-of-safety
     GRADE, converting foreign-filer per-share values deterministically; CFO-untagged filers go honestly
     UNPRICED)
  → Inversion pass (one adversarial cite-checked call — "invert, always invert": the strongest case
     against, the strongest objection, and the consensus check; rendered on the dossier as the
     case-against card, weighed by the synthesis, no obligation machinery)
  → Synthesis & decision (reconciliation; the late moat gate stays as defense in depth)
  → User-confirmed watchlist entry
  → Holding open (separate explicit ledger transition)
```

### The four pillars (Phase 3)

The deep-dive lanes ARE Buffett's pillars: `understand` (P1 — business model, unit economics,
accounting quality; absorbs the retired business_quality + financial_quality narrative duties),
`moat` (P2), `management` (P3). Pillar 4 (value) is the always-on valuation stage. The retired
`risks` lane's adversarial duty lives in the inversion pass; its web/consensus color is the
inversion's cite-checked `consensus_check` (Munger's social-proof read). Historical 5-lane dossiers
keep rendering forever (persisted lane ids are a stable contract).

**The moat pillar** (owner calibration, 2026-07-12): a moat is **protection, not a strength** — it
is what prevents a competent, well-funded competitor from taking share or replicating the model.
Every driver must pass the **replication test** ("what specifically stops a funded rival from copying
this?"); operational excellence, good products, growth, or buildable scale are strengths and are not
emitted as drivers. The dossier titles the card "Likely moats — model-identified, cite-checked": a
citation proves the mechanism is *real*, not that it *protects* — whether the protection shows up in
the economics is the three tests' job. The pillar carries the owner's three named tests
(harness-computed T0): **capital
efficiency** (median-ROIC bands: ≥15 % excellent / 10–15 % solid / <10 % weak), **two-engine**
(book-STRICT since the 2026-07 alignment: revenue growing AND operating margins **expanding** —
OLS slope > +25 bps/yr, flat fails — with a four-quadrant diagnostic naming which engine is
missing), and **standout** (gross margin vs industry peers — the company side is T0; the peer side
is the moat lane's cited-or-labeled judgment until peer-filing grounding ships; a no-COGS filer —
a payments network has no gross-profit line — falls back to **operating margin**, basis-labeled). Capital efficiency
+ two-engine ARE the mechanical moat anchor (they replaced M1/M2); standout is displayed, not
scored. The lane
also tags each grounded driver with a moat TYPE (brand, switching costs, network effect, intangible
assets, toll bridge, cost advantage, scale advantage, barrier to entry, monopoly position — distinct
from the WIDTH class) and judges the moat DIRECTION: a grounded `narrowing` derates a BUY to WATCH
("a narrowing moat is a sell signal no matter how wide it still looks"); an ungrounded direction
resolves `undetermined` and carries no weight.

**Research-case versioning.** The company is the aggregate; each user-initiated re-run supersedes the previous research case and records a new versioned investment-case ledger event. Earlier versions are retained in the ledger for audit.

Research runs as a **strategy-driven multi-agent swarm** (`runStrategyResearchSwarm`): the front Shariah-gate reasoning pass, the circle-of-competence judgment, concurrent per-lane specialist agents, a dedicated valuation-judgment stage (`valuation_judgment_drafted` — it owns the model's two cited judgments, the durable FCF growth rate and the industry exit multiple; the harness computes IV/buy/load-up and derives the valuation status arithmetically), the inversion pass, and a synthesis/decision agent — each a separate provider call. Every cited source is subject to the harness-side grounding invariant (fetched and content-hashed by the harness, not by the model). See `docs/architecture/owlfolio-v2-provider-model-support.md` for the grounding contract.

### Deep-dive approval gate (`deep_dive_approval`)

After BOTH front gates pass (Shariah + circle of competence) there are two modes:

| Mode | Behaviour | When used |
|---|---|---|
| **Automatic** | Gates pass → the staged pillar-lane swarm runs immediately in the same job | Scheduled / automated runs |
| **Review** | Gates pass → the research case pauses in an "awaiting deep-dive approval" state; the user triggers the lane swarm when ready (the recorded circle judgment is reused on resume — no re-spend) | Default for user-initiated runs |

The mode is configured in the `automation` settings (app config / Settings page). The legacy
`quick_screen_approval` key is migrated automatically.

### Why deep dive is swarm-only

A single-agent deep dive was evaluated and **rejected**. Holding the full Buffett-Munger multi-lane context (moat taxonomy, financials, risk, management quality, valuation, Shariah synthesis) in one model call degrades output quality. Reliability lives entirely in the parallel specialist swarm, where each agent operates with a narrow, focused context. The front gates are kept intentionally lightweight: each is a focused single-question call (sector permissibility; cashflow predictability), so each can be a single grounded agent call without quality loss. (The earlier quick screen — one call carrying both questions plus a business-quality read — was retired in the 2026-07 pipeline restructure.)

---

## 2. Moat taxonomy and gate

The moat class is assessed by the deep-dive moat specialist. The gate is enforced at the decision step.

| Moat class | Meaning | Investable? |
|---|---|---|
| `narrow` | Weak or short-duration competitive advantage | No — rejected; verdict forced to PASS |
| `moderate` | Meaningful advantage but not durable enough | No — rejected; verdict forced to PASS |
| `wide` | Durable multi-year advantage, clear pricing power | Yes — minimum investable moat |
| `monopoly` | Near-exclusive market position or platform lock-in | Yes |

`min_investable_moat: 'wide'` in the contract. A moat class of `narrow` or `moderate` causes `moatPassesGate()` to return `false` and the candidate is rejected before position sizing is considered. The `inevitable` tier has been removed — the model chooses between the four classes above.

---

## 3. Required return + the two book margins

**Every investable business is valued at the same flat required return and judged against the same
two margin thresholds** (`valuation-2026-07-book-alignment-1`). Neither lever is moat-tiered — business quality is not a per-name valuation-loosening knob.

| Required return (discount) | Buy margin (rule 7) | Load-up margin (rule 8) |
|---|---|---|
| 15 % default — user-changeable Setting | 30 % below IV (buy = IV × 0.70) | 50 % below IV (load-up = IV × 0.50) |

The required return is a **Setting, not a market read**: the book's 15 % is the default, and the
payload records the provenance (`required_return_basis: 'book_default' | 'setting'` — 'setting' only
when the user actually changed it). The compliant **savings anchor** (F.2) survives as the
**deployment hurdle only** — cash earning the savings rate is the alternative every deployment must
beat — and no longer feeds the valuation discount.

The margin of safety is **structural, not judged**: the harness computes both thresholds from IV and
grades the current price against them (the T0 `margin_of_safety_grade`). There is no model-judged
margin call and no widening machinery — conservatism lives in the honest FCF basis, the clamped exit
multiple, and the two fixed zones.

---

## 4. Valuation — the book intrinsic value on free cash flow

### 4.1 Free cash flow basis (T0, fail-closed)

```
FCF = CFO − capex          (most recent fiscal year, tagged XBRL facts only)
```

- Both facts come from the grounded EDGAR series (`cfo_musd`, `capex`), never from the model.
- **No proxy fallback**: a filer without a tagged CFO is honestly **UNPRICED** (`valuation_basis`
  says so; the dossier renders the unpriced state instead of a number built on assumptions).
- The owner-earnings bridge (maintenance-capex proxy, judged ΔWC) is fully retired.
- A purely factual `capex_vs_da` note (capex relative to D&A) is surfaced as context — it feeds no
  arithmetic.

### 4.2 The model's two cited judgments

The valuation stage asks the model for exactly two numbers, both cite-checked against the grounded
corpus:

- **Durable FCF growth rate** — the ten-year rate the filings support; the citation gate is the
  single grounding requirement of the stage.
- **Exit multiple — anchored to NAMED COMPARABLES** (owner rule, 2026-07-12): the model must name
  the 2–4 closest comparable companies with the P/FCF each trades at, exclude structurally different
  names with reasons, and set the multiple from the **median of the named set, tilted conservative**
  and priced for the exit-state (year-10) business. An unnamed "industry average" or a bare number is
  an incomplete answer (retry-forced). The basis note (comps + figures + exclusions) renders on the
  dossier. The harness **clamps to [8×, 20×]** and falls back to a conservative **12×** when the
  judgment is absent or unusable (`exit_multiple_source` records which).

### 4.3 Intrinsic value (harness-computed)

```
IV_ps = [ Σ_{t=1..10} FCF₀(1+g)^t / (1+r)^t  +  FCF₁₀ × exit_multiple / (1+r)^10  +  cash − debt ] / shares
```

with `r` the required return (§3), cash/debt/shares from the same tagged fact series. Then:

```
buy_below    = IV_ps × 0.70     (rule 7)
load_up_below = IV_ps × 0.50    (rule 8 — "load up the truck")
```

The **valuation status is derived arithmetically** (no model call): price ≤ buy → ATTRACTIVE;
≤ IV → FAIR; above → EXPENSIVE; unpriced → INSUFFICIENT_DATA.

#### Worked example

FCF₀ = $2,000 M (CFO 2,600 − capex 600), 100 M shares, cited g = 6 %, judged exit 12×,
cash $1,500 M, debt $1,500 M, r = 15 %:

| Step | Calculation | Result |
|---|---|---|
| Stage-1 PV | Σ FCF₀(1.06)^t/(1.15)^t, t = 1..10 | ≈ $13,128 M |
| Year-10 FCF | 2,000 × 1.06¹⁰ | ≈ $3,582 M |
| Terminal PV | 3,582 × 12 / 1.15¹⁰ | ≈ $10,624 M |
| Net cash | 1,500 − 1,500 | $0 M |
| Intrinsic value | (13,128 + 10,624 + 0) / 100 | **≈ $237.52 /sh** |
| Buy below (rule 7) | 237.52 × 0.70 | **≈ $166.27** |
| Load-up below (rule 8) | 237.52 × 0.50 | **≈ $118.76** |

Internal sanity rails (implied growth / implied exit multiple at today's price) still run and can
raise flags, but they are engine rails only — the dossier shows the book figures.

---

## 5. Hard gates

Gates are evaluated by `evaluateGates()` from the facts bundle assembled by the synthesis agent.

| Gate id | Severity | Condition | Effect if failed |
|---|---|---|---|
| `shariah_compliant_or_conditional` | blocking | Shariah status is `COMPLIANT` or (when `allow_conditional: true`) `CONDITIONAL` | Reject before deep dive; no further analysis |
| `positive_owner_earnings` | blocking | Normalized owner earnings are positive | Reject |
| `leverage_safe` | blocking | Debt and fixed obligations do not create balance-sheet fragility | Reject |
| `valuation_complete` | blocking | A complete valuation and margin-of-safety assessment is available | Reject |
| `source_coverage_complete` | warning | Primary-source coverage is sufficient | Does not block; recorded as a warning in the evaluation result |

Shariah is intentionally the **first** check at the quick-screen stage so a non-compliant result stops the pipeline before the expensive swarm is launched.

---

## 6. Position sizing — conviction-tiered × price-laddered

Position sizing is **capital-driven and advisory**, and it is now **wired**: when you set your investable capital on the Portfolio page and a research case clears the wide-moat gate with a buy-below price, the dossier shows a draft position plan (`buildPositionPlan` in `apps/web/src/lib/positionPlan.ts`, whose target weight is the S1 conviction factor × base weight). That display plan is the **conviction target only — not fully risk-checked**: the downside caps (permanent-loss, correlated-cluster, deployment hurdle) and the worst-case-first view are applied at **execution-time sizing** by the S6/S7 sizing assembler (`computeSizingRecommendation` in `@owlfolio/workflow/sizingAssessment`), computed on-demand and recorded as a `sizing_recommendation_recorded` observation. Both are advisory — **you author and sign the actual buys, and the worker never trades.**

### Diversified, conviction-tiered target full position weight

| Moat class | Target full weight |
|---|---|
| `wide` | 6 % |
| `monopoly` | 10 % |

All values are at or below the `max_position_weight` of 15 %, and the portfolio targets ~20 names — the weights are deliberately diversified, not concentrated. `narrow` and `moderate` are not present because they are rejected before sizing is considered.

The target weight is an **entry cap, not a rebalancing target**: it caps how much you deploy on the way in. Once a compounder is owned, **winners run** — the strategy never force-trims a position just because it has grown past its entry weight.

Target dollar value is `target_weight × investable_capital`, so the plan scales with the capital you have actually set.

### Price-laddered entry tranches

| Tranche | Fraction of target weight | Trigger | Gate |
|---|---|---|---|
| T1 | 40 % | At the buy price | Entry |
| T2 | 30 % | ~10 % below the buy price | Thesis re-check |
| T3 | 30 % | ~20 % below the buy price | Thesis re-check |

Fractions sum to 100 % of the target weight. **T2 and T3 are thesis-gated**: a lower price only justifies adding if the thesis still holds, so each lower tranche requires a fresh thesis re-check (tied to the thesis-review escalation) before deploying. This is explicitly **not** mechanical averaging-down — a broken thesis on the way down cancels the lower tranches rather than triggering an automatic add. The helper `targetWeightForMoatClass(strategy, moatClass)` returns the target weight for an investable moat class and throws for `narrow`/`moderate`.

**Book-zone anchoring (D2, 2026-07):** when the case carries the rule-8 threshold, the displayed
position plan anchors the ladder to the BOOK ZONES — T1 arms at the rule-7 buy price (IV × 0.70),
the final tranche at the rule-8 load-up price (IV × 0.50), intermediate tranches spaced evenly
between the two. The contract's percent-below-buy triggers above are the legacy-input fallback. The
plan's checklist also names the four pillars: a case that failed the front gate, the circle, the
moat gate, or the management veto renders the refusal in pillar order instead of a plan.

---

## 7. Shariah and purification

- Shariah screening is required (`shariah.required: true`).
- Conditional investments are allowed by policy (`allow_conditional: true`) with the `CONDITIONAL` status triggering a purification obligation.
- Accepted statuses: `COMPLIANT`, `CONDITIONAL`. Prohibited: `NON_COMPLIANT`.
- Purification obligations and payments are separate auditable ledger events.
- These screens are local-ledger/accounting aids, not professional legal, tax, or Shariah rulings.

---

## 8. Reanalysis cadence and data tiers

| Data tier | Frequency | Trigger | Effect |
|---|---|---|---|
| Market price | Daily / weekly | Automated poll | Buy-zone alert only; no revaluation |
| Thesis-intact review | Quarterly (configurable) | Scheduled worker task | Lightweight check; escalates to full swarm if thesis breaks |
| Intrinsic valuation + full reanalysis | Annual (or on demand) | Annual schedule or user-initiated re-run | Full swarm deep dive; new versioned investment-case ledger event; refreshed buy price |

Market price polling sole purpose: is current price ≤ stored `buy_price_per_share`? The book buy price is not recomputed on every price tick — only on a full swarm deep dive.

---

## 9. F.2 savings anchor — deployment hurdle only (valuation anchor RETIRED)

The one Shariah-compliant Mudarabah **savings rate** remains the deployment-hurdle and idle-capital
anchor (F.2) — cash earning the savings rate is the alternative every deployment must beat, and the
sizing/hurdle engines read it from app config. Since the 2026-07 book alignment it **no longer feeds
the valuation discount**: intrinsic value is computed at the flat 15 % required return (§3), a
Setting with `book_default` provenance until the user changes it. The interest-bearing
`10y Treasury` anchor remains retired (a compliant investor cannot hold it).

**One-grep manifest:** discount-anchor touchpoints are marked with the greppable token
`ANCHOR-SWAP-F2:` — today those sites serve the hurdle/sizing lane, not the DCF.

---

## Implementation references

| Concern | Location |
|---|---|
| Strategy contract schema (zod) | `packages/strategies/src/strategyContract.ts` |
| Buffett-Munger contract object + helpers | `packages/strategies/src/buffettMunger.ts` |
| Gate evaluation | `packages/strategies/src/evaluateGates.ts` |
| Contract tests | `packages/strategies/src/__tests__/buffettMunger.test.ts` |
| Research swarm entry point | `packages/workflow/src/researchSwarm.ts` |
| Strategy workflow boundaries | `docs/STRATEGY_GUIDE.md` |
| Provider/model support + grounding contract | `docs/architecture/owlfolio-v2-provider-model-support.md` |
| Domain and event families | `docs/architecture/owlfolio-v2-domain-boundaries.md` |
| Automation settings (cadence, approval mode) | App config / Settings page (`automation` block) |
