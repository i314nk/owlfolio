# Owlfolio v2 — Buffett-Munger strategy (Design B — Buffett-literal)

Single source of truth for parameters: `packages/strategies/src/buffettMunger.ts` and `packages/strategies/src/strategyContract.ts`. Values quoted in this document are read from those files. If a value here disagrees with the TypeScript source, the source wins.

"Experimental until certified" boundaries still apply — any automated output is a draft or observation until the user explicitly confirms the watchlist or holding transition. See `docs/STRATEGY_GUIDE.md` for strategy workflow boundaries.

---

## 1. Overview

Buffett-Munger is the default strategy for the Owlfolio v2 local-use candidate. It is a **concentrated quality-value** approach, Shariah-aware first-class throughout:

- **Concentrated** — up to 20 positions, maximum 15 % per position, 3 % minimum cash buffer.
- **Quality** — investable only when the business has a durable wide economic moat and positive normalized owner earnings.
- **Value** — buy price derived from a two-stage owner-earnings DCF at a flat savings-anchored discount rate (the user's compliant savings anchor + the uniform 5.5 % equity premium — 9.5 % at a 4 % anchor; F.2), then discounted by a **uniform 25 % required margin of safety** (F.13, T0-graded). All conservatism beyond honest inputs lives in that single MoS knob, which **widens** with documented uncertainty (high terminal-value share, low maintenance-capex confidence, weak moat durability, sensitivity dispersion). The certainty difference between moat classes is captured by the human-weighted moat-durability input (and that widening rule), **not** by tiering the discount rate or the margin of safety.
- **Shariah-first** — Shariah screening is the first hard gate; a non-compliant result stops the deep-dive before provider cost is incurred.

### Pipeline

```
Discovery
  → Shariah gate (grounded sector judgment on the primary filing + deterministic AAOIFI ratios, pre-spend)
       ↓ closed: sector non-compliant or ratio FAIL → coherent set-aside dossier, zero lane spend
  → Circle-of-competence gate (cite-verified predictability judgment; k-sample agreement)
       ↓ outside circle (or ungroundable) → set aside
       ↓ both gates open: [Automatic | Review-before-deep-dive]
  → Swarm deep dive (moat / financials / risk / management / risks specialists — parallel, grounded)
  → Valuation judgment (dedicated grounded stage: judged OE bridge + assumed growth + buy-below, cite-checked;
     the harness computes the T0 margin-of-safety GRADE against a uniform required margin, and converts
     foreign-filer per-share values into the price currency deterministically)
  → Synthesis & decision (reconciliation; moat ≥ wide gate enforced here)
  → User-confirmed watchlist entry
  → Holding open (separate explicit ledger transition)
```

**Research-case versioning.** The company is the aggregate; each user-initiated re-run supersedes the previous research case and records a new versioned investment-case ledger event. Earlier versions are retained in the ledger for audit.

Research runs as a **strategy-driven multi-agent swarm** (`runStrategyResearchSwarm`): the front Shariah-gate reasoning pass, the circle-of-competence judgment, concurrent per-lane specialist agents, a dedicated valuation-judgment stage (`valuation_judgment_drafted` — it owns the owner-earnings bridge, assumed growth, buy-below, and valuation status; the monolithic synthesis no longer carries them), and a synthesis/decision agent — each a separate provider call. Every cited source is subject to the harness-side grounding invariant (fetched and content-hashed by the harness, not by the model). See `docs/architecture/owlfolio-v2-provider-model-support.md` for the grounding contract.

### Deep-dive approval gate (`deep_dive_approval`)

After BOTH front gates pass (Shariah + circle of competence) there are two modes:

| Mode | Behaviour | When used |
|---|---|---|
| **Automatic** | Gates pass → the 5-lane deep-dive swarm runs immediately in the same job | Scheduled / automated runs |
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

## 3. Flat discount rate + uniform margin of safety

**All investable moat classes use the same flat savings-anchored discount rate (F.2: anchor + uniform equity premium) AND the same uniform required margin of safety** (F.13). Neither lever is moat-tiered — business quality is not a per-name valuation-loosening knob.

| Discount rate | Base margin of safety |
|---|---|
| 10 % (uniform) | 25 % (uniform base) |

The base 25 % MoS **widens** toward a ~50 % cap as documented uncertainties fire: a high terminal-value share, low maintenance-capex confidence, weak moat durability (above-GDP growth IS a moat-durability claim), and sensitivity dispersion. This is where all conservatism beyond honest inputs lives — one visible, config-driven number.

The certainty difference between a monopoly and a merely wide moat is **not** captured by a lower margin of safety. A stronger moat is a durability signal: it earns higher terminal value through the surfaced, **human-weighted moat-durability input** (terminal-value share), and a *weaker* durability *widens* the MoS — it never licenses a smaller one. (Moat class also informs position **sizing** — see §6 — but that is a separate knob from valuation.)

The harness derives the base margin of safety via `marginOfSafetyForMoat(strategy, moatClass)` (which returns the uniform `base_margin_of_safety`; the `moatClass` argument only validates the investability gate) and widens it via `widenedMarginOfSafety(...)`. The model does not choose the rate or the margin; it supplies the moat class and the documented-uncertainty inputs.

---

## 4. Valuation — equity-bond capitalization with owner-earnings bridge

### 4.1 Owner-earnings bridge (per share)

```
OE = NI + D&A − maintenance_capex − SBC − ΔWC
```

- `NI` — normalized net income per share.
- `D&A` — depreciation and amortization per share.
- `maintenance_capex` — capex required to maintain existing earnings power; proxy tier (20th/50th/80th percentile of D&A) is supplied to indicate judgment level.
- `SBC` — stock-based compensation per share (real economic cost).
- `ΔWC` — normalized working capital change per share, **signed**:
  - Positive (use of cash) → WC is a cash drain; subtracting a positive value **reduces** OE.
  - Negative (structural WC release) → WC is a natural source of cash (e.g. negative working capital model); subtracting a negative value **adds** to OE.

The model judges each bridge component. The harness computes OE deterministically.

### 4.2 Growth rate — one demonstrated path + one named cap

```
g = clamp_to_cap( max(0, demonstrated_OE_per_share_CAGR), single_growth_cap )
```

- The growth input is the **demonstrated historical owner-earnings-per-share CAGR** from the EDGAR series (the honest, falsifiable, near-recent-history rate) — floored at 0 (no negative-compounding credit; non-finite → 0, fail-closed).
- A lane may argue the rate **lower**, never higher.
- It is then clamped by the named **`single_growth_cap = 0.15`** — a forecasting-humility ceiling behind the durable-source requirement, never a license.
- Any rate materially above the **`gdp_growth_threshold = 0.03`** (GDP-like) is treated as a **moat-durability claim**: it is flagged lowest-confidence and surfaced WITH the moat-durability input, and it **widens** the end-stage margin of safety (it is not silently accepted, and it is not haircut here — the single MoS carries the conservatism).

This replaces the retired stacked reinvestment×ROIC + growth-band-ceilings + ROIC-eligibility-gate stack: "one knob plus one named backstop, not five." ROIC is still assessed as business-quality evidence, but it is no longer a growth-eligibility gate or a growth multiplier.

### 4.3 Fair value — two-stage owner-earnings DCF with a linear growth fade

```
OE_t  = OE × Π_{i=1..t}(1 + g_i),  g_i fades LINEARLY from g → terminal over the trailing fade_years
FV    = Σ_{t=1..H} OE_t/(1+r)^t  +  [ OE_H × (1 + terminal_g) / (r − terminal_g) ] / (1+r)^H
```

- `discount r = 0.10` (flat, from contract).
- `stage1_horizon H = 10` years; `terminal_growth = 1.5 %` (uniform — F.13).
- `growth_fade_years = 5`: the near-term `g` compounds flat over the plateau years (t ≤ H−F) then glides down to the terminal rate over years 6–10, so by year H the per-year rate equals terminal. The fade only bites **downward** (a low/no-growth name is never glided up).
- **`fv_cap_multiple = 18`** is a **surfaced sanity FLAG, not a hard truncation** (Phase 1.6): when the raw FV exceeds 18× OE the harness sets a `cap_exceeded` flag (which **widens the MoS**) and KEEPS the value. Only at/above `fv_absurd_multiple = 100×` OE is the value discarded as a units/scale-error guard. (The old 18× hard cap is gone.)

### 4.4 Buy price — uniform margin of safety

```
buy_price = round( fair_value × (1 − MoS), 2 )
```

where `MoS` is the **uniform 25 % base** from `marginOfSafetyForMoat(strategy, moatClass)`, widened by any documented uncertainty via `widenedMarginOfSafety(...)`. The numbers below use the base 25 % (no widening inputs fired); a fired widening input would raise the MoS and lower the buy price.

> The figures below are computed with the actual two-stage faded DCF (`twoStageValuation` / `twoStageFairValuePerShare`) at the current params (r = 10 %, H = 10, terminal 1.5 %, fade over years 6–10). They are not the old single-stage `OE/(r−g)` perpetuity.

#### Example (monopoly): OE = 14, demonstrated OE/sh CAGR illustrated at 8 %

| Step | Calculation | Result |
|---|---|---|
| Owner earnings | 14 + 4 − 3 − 2 − (−1) | OE = 14 |
| Growth (one path) | max(0, 0.08) ≤ `single_growth_cap` 0.15 → uncapped; 0.08 > GDP 0.03 → above-GDP moat-durability flag (widens MoS) | g = 0.08 |
| Fair value (2-stage faded) | Σ + Gordon terminal at H = 10, terminal 1.5 %, fade yrs 6–10 → ≈ 121.96 + 115.69 | fair ≈ **237.64** |
| 18× FV flag | 237.64 < 18 × 14 = 252 → `cap_exceeded = false` | not flagged |
| Margin of safety | uniform base (no widening inputs fired here) | MoS = 0.25 |
| Buy price | round(237.64 × 0.75, 2) | buy ≈ **178.23** |

Implied multiple ≈ 17.0× OE. (If the above-GDP flag's widening increment fires, MoS rises above 0.25 and the buy price falls below 178.23.)

#### Example (no demonstrated growth): OE = 14, g floored to 0

When the demonstrated OE/share CAGR is unavailable or non-positive, growth floors to the honest no-growth `g = 0`:

fair value (2-stage faded, g = 0) ≈ 86.02 + 64.45 = **150.48** (≈ 10.75× OE, well under the 18× flag of 252); uniform MoS = 25 % → buy = round(150.48 × 0.75, 2) ≈ **112.86**.

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

Market price polling sole purpose: is current price ≤ stored `buy_price_per_share`? The equity-bond buy price is not recomputed on every price tick — only on a full swarm deep dive.

---

## 9. F.2 discount-anchor swap (SHIPPED)

The discount/hurdle anchor is the one Shariah-compliant Mudarabah **savings rate** — this is the F.2 swap, now implemented:

- **Today:** `discount = savings_rate + equity_premium` (§3 / §4.3). The single compliant savings rate does triple duty — idle-capital return, the deployment-hurdle floor, AND the risk-free valuation anchor. It is a flat, uniform, human-set global config, never an agent input. This is the same anchor the /strategy "Cash is a first-class position" copy describes.
- **Retired:** the interest-bearing `10y Treasury + equity_premium` anchor. A non-interest-bearing investor cannot actually hold the Treasury yield, so it was never the right risk-free; it has been removed.

**One-grep manifest:** every discount-anchor touchpoint is marked with the greppable token `ANCHOR-SWAP-F2:`. Run `grep -rn ANCHOR-SWAP-F2` to enumerate the sites (the param config, `discountRate()`, the live swarm discount computation, and the /strategy reference comment).

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
