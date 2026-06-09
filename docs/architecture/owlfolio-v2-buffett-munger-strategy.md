# Owlfolio v2 — Buffett-Munger strategy (as implemented)

Single source of truth for parameters: `packages/strategies/src/buffettMunger.ts` and `packages/strategies/src/strategyContract.ts`. Values quoted in this document are read from those files. If a value here disagrees with the TypeScript source, the source wins.

"Experimental until certified" boundaries still apply — any automated output is a draft or observation until the user explicitly confirms the watchlist or holding transition. See `docs/STRATEGY_GUIDE.md` for strategy workflow boundaries.

---

## 1. Overview

Buffett-Munger is the default strategy for the Owlfolio v2 local-use candidate. It is a **concentrated quality-value** approach, Shariah-aware first-class throughout:

- **Concentrated** — up to 20 positions, maximum 15 % per position, 3 % minimum cash buffer.
- **Quality** — investable only when the business has a durable wide economic moat and positive normalized owner earnings.
- **Value** — buy price derived from a Gordon-capitalization formula at the moat-class hurdle rate; margin of safety is embedded in the hurdle rather than applied as a separate haircut.
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

The mode is configured in the `automation` settings (app config / Settings page). This is consistent with the "experimental until certified" boundary: automated output is a draft or observation until the user explicitly confirms the watchlist or holding transition.

### Why deep dive is swarm-only

A single-agent deep dive was evaluated and **rejected**. Holding the full Buffett-Munger multi-lane context (moat taxonomy, financials, risk, management quality, valuation, Shariah synthesis) in one model call degrades output quality — the model cannot hold that much focused, grounded context reliably. Reliability therefore lives entirely in the parallel specialist swarm, where each agent operates with a narrow, focused context. This is also why the quick screen is kept intentionally lightweight: it is a focused gate (not the full framework), so it can be a single agent call without quality loss.

---

## 2. Moat taxonomy and gate

The moat class is assessed by the deep-dive moat specialist. The gate is enforced at the decision step.

| Moat class | Meaning | Investable? |
|---|---|---|
| `narrow` | Weak or short-duration competitive advantage | No — rejected; verdict PASS not possible |
| `moderate` | Meaningful advantage but not durable enough | No — rejected; verdict PASS not possible |
| `wide` | Durable multi-year advantage, clear pricing power | Yes — minimum investable moat |
| `monopoly` | Near-exclusive market position or platform lock-in | Yes |
| `inevitable` | Category-defining franchise with enduring reinvestment runway | Yes |

`min_investable_moat: 'wide'` in the contract. A moat class of `narrow` or `moderate` causes `moatPassesGate()` to return `false` and the candidate is rejected before position sizing is considered.

---

## 3. Hurdle rates with margin of safety embedded

| Moat class | Hurdle rate |
|---|---|
| `wide` | 15 % |
| `monopoly` | 12 % |
| `inevitable` | 10 % |

A **narrower moat demands a higher required return**. Conservatism (margin of safety) lives in the hurdle rate itself rather than as a separate percentage haircut applied after valuation. A wide-moat business must therefore earn 15 % at the modeled owner-earnings growth rate before the buy price is triggered — this is both the required return and the embedded margin of safety.

The harness derives the hurdle rate deterministically from the model-supplied moat class via `hurdleRateForMoatClass(strategy, moatClass)`. The model does not choose the rate; it chooses the moat class.

---

## 4. Valuation — buy price

```
buy_price = normalized_owner_earnings_per_share × (1 + g) / (hurdle − g)
```

This is a **Gordon capitalization** at the moat-class hurdle rate.

- `normalized_owner_earnings_per_share` — supplied by the financials specialist; must be positive (hard gate).
- `g` — long-run sustainable growth rate; supplied by the moat/valuation specialist with explicit rationale; must satisfy `g < hurdle` (clamped to `hurdle − 0.001` if violated, with a caveat recorded).
- `hurdle` — fetched deterministically from the contract by moat class (see above).

The model judges moat class, sustainable growth, and normalized owner earnings. The harness computes the buy price deterministically from those inputs. No separate margin-of-safety haircut is applied; the conservative hurdle rate provides it.

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

Shariah is intentionally the **first** check at the quick-screen stage so a non-compliant result stops the pipeline before the expensive swarm is launched. The quick-screen agent assesses Shariah permissibility first; then makes a rough "worth investigating?" business-quality read. It is a focused gate, not the full Buffett-Munger framework — full rigorous analysis is deferred to the swarm specialists.

---

## 6. Position sizing — conviction-tiered × price-laddered

Position sizing is **config only** at this stage. The parameters are encoded in the strategy contract for documentation and future enforcement; the workflow does not yet enforce sizing in the execution path.

### Conviction-tiered target full position weight

| Moat class | Target full weight |
|---|---|
| `wide` | 6 % |
| `monopoly` | 9 % |
| `inevitable` | 12 % |

All values are at or below the `max_position_weight` of 15 %. `narrow` and `moderate` are not present because they are rejected before sizing is considered.

### Price-laddered entry tranches

Within the target weight, entry is scaled across three price levels:

| Tranche | Fraction of target weight | Trigger |
|---|---|---|
| T1 | 40 % | At the buy price |
| T2 | 30 % | ~10 % below the buy price |
| T3 | 30 % | ~20 % below the buy price |

Fractions sum to 100 % of the target weight. A full position is reached only if the price reaches T3 level; otherwise the deployed weight is proportionally less than the target. This is a tunable default — the parameters live in the contract and can be adjusted per strategy version.

The helper `targetWeightForMoatClass(strategy, moatClass)` returns the target weight for an investable moat class and throws for `narrow`/`moderate`.

### Combined sizing example (illustrative)

A wide-moat candidate with a target weight of 6 % would be deployed as:
- T1: 2.4 % at the buy price
- T2: +1.8 % if price falls ~10 % below buy price
- T3: +1.8 % if price falls ~20 % below buy price

An inevitable-moat candidate with a target weight of 12 % would follow the same tranche fractions (4.8 % / 3.6 % / 3.6 %).

In all cases the deployed weight is bounded by `target_weight_by_moat[moatClass]` ≤ `max_position_weight` (15 %).

---

## 7. Shariah and purification

- Shariah screening is required (`shariah.required: true`).
- Conditional investments are allowed by policy (`allow_conditional: true`) with the `CONDITIONAL` status triggering a purification obligation.
- Accepted statuses: `COMPLIANT`, `CONDITIONAL`. Prohibited: `NON_COMPLIANT`.
- Purification obligations and payments are separate auditable ledger events. See `docs/architecture/owlfolio-v2-domain-boundaries.md` for the event family.
- These screens are local-ledger/accounting aids, not professional legal, tax, or Shariah rulings.

---

## 8. Reanalysis cadence and data tiers

Not all data ages at the same rate. The pipeline distinguishes three concerns:

### Market price — frequent poll (buy-zone monitoring)

Market price is polled frequently (daily or weekly, depending on the automation settings). Its **sole purpose** is buy-zone monitoring: is the current price ≤ the stored `buy_below` threshold? It does **not** trigger a revaluation — intrinsic value is not recomputed on every price tick.

### Intrinsic valuation — annual full reanalysis or on demand

The Gordon-capitalization buy price (Section 4) depends on `normalized_owner_earnings_per_share` and the sustainable growth rate `g`, both of which come from company filings. These inputs are only refreshed during:

- **Annual full reanalysis** — a complete swarm deep dive run on cadence (or triggered on demand); this is the only event that produces a fresh intrinsic-valuation and updated `buy_below`.
- **On-demand re-run** — a user-initiated re-run at any time supersedes the current research case and records a new versioned investment-case ledger event.

Intrinsic valuation is **not** recomputed on every price tick or on every thesis-intact check.

### Thesis-intact review — periodic lightweight check (escalates to full swarm if thesis breaks)

A periodic (e.g. quarterly) lightweight review checks whether the investment thesis still holds — moat durability, business quality, no material adverse developments — without running a full swarm. If the check reveals a thesis breach (moat erosion, material negative event, Shariah status change), it **escalates to a full swarm reanalysis**. Escalation logic is a planned follow-up; the current worker supports dry-run thesis-intact check scaffolding.

### Summary

| Data tier | Frequency | Trigger | Effect |
|---|---|---|---|
| Market price | Daily / weekly | Automated poll | Buy-zone alert only; no revaluation |
| Thesis-intact review | Quarterly (configurable) | Scheduled worker task | Lightweight check; escalates to full swarm if thesis breaks |
| Intrinsic valuation + full reanalysis | Annual (or on demand) | Annual schedule or user-initiated re-run | Full swarm deep dive; new versioned investment-case ledger event; refreshed `buy_below` |

Cadence settings are configured in the `automation` block of app config (Settings page). Automated tasks are observations and drafts; watchlist and holding transitions require explicit user confirmation.

---

## Implementation references

| Concern | Location |
|---|---|
| Strategy contract schema (zod) | `packages/strategies/src/strategyContract.ts` |
| Buffett-Munger contract object + helpers | `packages/strategies/src/buffettMunger.ts` |
| Gate evaluation | `packages/strategies/src/evaluateGates.ts` |
| Contract tests | `packages/strategies/src/__tests__/buffettMunger.test.ts` |
| Research swarm entry point | `packages/workflow/src/researchSwarm.ts` (or nearest equivalent) |
| Strategy workflow boundaries | `docs/STRATEGY_GUIDE.md` |
| Provider/model support + grounding contract | `docs/architecture/owlfolio-v2-provider-model-support.md` |
| Domain and event families | `docs/architecture/owlfolio-v2-domain-boundaries.md` |
| Automation settings (cadence, approval mode) | App config / Settings page (`automation` block) |
