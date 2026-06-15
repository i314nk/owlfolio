# Owlfolio v2 — Buffett-Munger strategy (Design B — Buffett-literal)

Single source of truth for parameters: `packages/strategies/src/buffettMunger.ts` and `packages/strategies/src/strategyContract.ts`. Values quoted in this document are read from those files. If a value here disagrees with the TypeScript source, the source wins.

"Experimental until certified" boundaries still apply — any automated output is a draft or observation until the user explicitly confirms the watchlist or holding transition. See `docs/STRATEGY_GUIDE.md` for strategy workflow boundaries.

---

## 1. Overview

Buffett-Munger is the default strategy for the Owlfolio v2 local-use candidate. It is a **concentrated quality-value** approach, Shariah-aware first-class throughout:

- **Concentrated** — up to 20 positions, maximum 15 % per position, 3 % minimum cash buffer.
- **Quality** — investable only when the business has a durable wide economic moat and positive normalized owner earnings.
- **Value** — buy price derived from an equity-bond capitalization formula at a flat 10 % discount rate. The certainty difference between moat classes is captured by a **moat-tiered margin of safety** (monopoly 10 %, wide 30 %), not by embedding conservatism in different hurdle rates.
- **Shariah-first** — Shariah screening is the first hard gate; a non-compliant result stops the deep-dive before provider cost is incurred.

### Pipeline

```
Discovery
  → Quick screen (focused gate: Shariah permissibility + rough business-quality read)
       ↓ rejected: Shariah non-compliant or clearly not worth investigating
       ↓ passed: [Automatic | Review-before-deep-dive]
  → Swarm deep dive (moat / financials / risk / management / valuation / synthesis specialists — parallel)
  → Synthesis & decision (moat ≥ wide gate enforced here)
  → User-confirmed watchlist entry
  → Holding open (separate explicit ledger transition)
```

**Research-case versioning.** The company is the aggregate; each user-initiated re-run supersedes the previous research case and records a new versioned investment-case ledger event. Earlier versions are retained in the ledger for audit.

Research runs as a **strategy-driven multi-agent swarm** (`runStrategyResearchSwarm`): a quick-screen agent, concurrent per-lane specialist agents, and a synthesis/decision agent — each a separate provider call. Every cited source is subject to the harness-side grounding invariant (fetched and content-hashed by the harness, not by the model). See `docs/architecture/owlfolio-v2-provider-model-support.md` for the grounding contract.

### Quick-screen approval gate (`quick_screen_approval`)

After the quick screen passes there are two modes:

| Mode | Behaviour | When used |
|---|---|---|
| **Automatic** | Quick screen passes → deep-dive swarm runs immediately in the same job | Scheduled / automated runs |
| **Review** | Quick screen passes → research case pauses in an "awaiting deep-dive approval" state; user triggers the swarm when ready | Default for user-initiated runs |

The mode is configured in the `automation` settings (app config / Settings page).

### Why deep dive is swarm-only

A single-agent deep dive was evaluated and **rejected**. Holding the full Buffett-Munger multi-lane context (moat taxonomy, financials, risk, management quality, valuation, Shariah synthesis) in one model call degrades output quality. Reliability lives entirely in the parallel specialist swarm, where each agent operates with a narrow, focused context. The quick screen is kept intentionally lightweight: it is a focused gate (not the full framework), so it can be a single agent call without quality loss.

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

## 3. Flat discount rate + moat-tiered margin of safety

**All investable moat classes use the same flat 10 % discount rate.** The certainty difference is captured by the margin of safety:

| Moat class | Discount rate | Margin of safety |
|---|---|---|
| `wide` | 10 % | 30 % |
| `monopoly` | 10 % | 10 % |

A monopoly-quality business (highest certainty) needs only a 10 % margin of safety before buying; a wide-moat business (investable but less certain) requires a 30 % margin of safety buffer. This is Buffett-literal: the required return on capital (discount rate) is the same; what changes is how much price discount the investor demands relative to intrinsic value as a function of certainty.

The harness derives the margin of safety deterministically from the model-supplied moat class via `marginOfSafetyForMoat(strategy, moatClass)`. The model does not choose the rate or the margin; it chooses the moat class.

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

### 4.2 Growth rate — ROIC-gated

```
g = (ROIC > discount) ? min(reinvestment_rate × ROIC, terminal_growth_cap) : 0
```

- Growth credit is only awarded when the business can reinvest **above** the cost of capital (ROIC > 10 %).
- Capped at `terminal_growth_cap = 3 %` (Buffett-literal — long-run real GDP + inflation bound).
- If ROIC ≤ 10 %, growth destroys value; `g = 0` and the business is capitalized on current earnings alone.

### 4.3 Fair value — equity-bond capitalization

```
fair_value = min( OE / (discount − g),  valuation_multiple_ceiling × OE )
```

- `discount = 0.10` (flat, from contract).
- `valuation_multiple_ceiling = 20` — no business, however wide its moat, is worth more than 20× owner earnings at purchase (prevents infinite fair value from over-generous g estimates).

### 4.4 Buy price — moat-tiered margin of safety

```
buy_price = round( fair_value × (1 − MoS), 2 )
```

where `MoS = marginOfSafetyForMoat(strategy, moatClass)`.

#### Example (monopoly): OE=14, ROIC=0.25, reinv=0.40

| Step | Calculation | Result |
|---|---|---|
| Owner earnings | 14+4−3−2−(−1) | OE = 14 |
| Growth (ROIC gate) | 0.25 > 0.10 → min(0.40×0.25, 0.03) | g = 0.03 |
| Fair value | min(14/(0.10−0.03), 20×14) = min(200, 280) | fair = 200 |
| Margin of safety | monopoly → 10 % | MoS = 0.10 |
| Buy price | round(200 × 0.90, 2) | buy = **180** |

#### Example (wide, ROIC ≤ disc):

If ROIC = 8 % (≤ 10 %): g = 0; OE = 10; fair = min(10/0.10, 20×10) = 100; MoS = 30 %; buy = 70.

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
