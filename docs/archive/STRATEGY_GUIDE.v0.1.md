# Strategy Guide — Writing a Strategy YAML

A strategy file declares how Owlfolio analyzes companies. The runtime consumes
**only** what's documented here; unknown fields are silently dropped at load
time. If a field isn't listed in this guide, the system isn't using it.

> **Don't want to write YAML?** Run `owlfolio setup --create` and the AI walks
> you through it. Output goes to `strategies/<name>.yaml` and is ready to use.

---

## The two zones

Every strategy YAML has two clearly-separated zones:

```yaml
# ─── ZONE 1: structured contract ─────────────────────────────────
# Small, typed, machine-readable. The runtime parses these into typed
# Pydantic objects and enforces shape constraints (weights sum to 1.0,
# ranges valid, etc.).

name: my-strategy
description: "..."
summary: "..."
author: "..."
criteria:           [{name, weight}, ...]    # synthesis fills criteria_scores keyed on these names
tiers:              {tier_name: hurdle_rate or null}
thresholds:         {wide: 3.5, narrow: 2.5}
position_sizing:    {max_positions, max_single_position, tiers/tier_ranges, cash_reserve}
display:            {primary_value_label, target_price_label, ...}
llm_overridable:    {var_name: {default, range, label}}

# ─── ZONE 2: prompt corpus ───────────────────────────────────────
# One prose block per LLM consumer. Free-form text — the runtime
# substitutes {TICKER} / {COMPANY} placeholders and passes the prose
# verbatim into the agent's prompt.

prompts:
  synthesis: |
    The load-bearing analysis prompt — tells synthesis HOW to score
    criteria, classify tier, compute buy price, decide BUY/WATCH/PASS.
  discovery: |
    The agentic-discovery brief — universe, biases, avoid-list.
  specialists:
    moat_analyst: |
      Self-contained specialist prompt with role, scoring rubric, and
      source URLs all inline. Sources are folded inline so each prompt
      is one prose block, not a {role, sources} pair.
    risk_analyst: |
      ...
```

The split exists because the two zones have different consumers:

- **Zone 1** is what the system needs as *data* to produce typed outputs
  (`criteria_scores` keyed on names, `weighted_score`, tier classification,
  buy-price math, position size). It's small and typed.
- **Zone 2** is what the LLM consumes as *prose*. Free-form so each strategy
  can describe its own valuation methodology, tier definitions, decision
  rules, and specialist briefs in plain English.

If you find yourself wanting to put *prose* in Zone 1 or *typed data* in Zone
2, you're fighting the schema. The split is deliberate.

---

## Required vs optional

**Required:** `name`, `criteria`, `prompts.synthesis`.
Everything else has sensible defaults — the loader fills them in.

`prompts.synthesis` must be substantive (>=50 chars). It's the load-bearing
instruction the synthesis agent reads at every analysis. The loader rejects
anything shorter — that's almost always an accidental empty / placeholder.

> **Non-determinism note.** Strategy YAMLs are inputs to an agentic
> pipeline. The same YAML + same ticker will produce two slightly
> different syntheses on different runs (different specialist findings,
> minor score variance, different prose). Author your prompts as
> *guidance to a human analyst*, not as code — the LLM is reading
> them, not parsing them. Fold-in numeric thresholds where you want
> consistency (`payout_ratio < 60`, `peg_target = 1.0`, etc.) and trust
> the synthesis prose for the qualitative judgment.

---

## Zone 1 reference

### `criteria`

Names + weights. The criterion *meaning* (what scores 5/5 vs 1/5) lives in
`prompts.synthesis`.

```yaml
criteria:
  - name: switching_costs
    weight: 0.20
  - name: network_effects
    weight: 0.20
  - name: pricing_power
    weight: 0.20
  - name: cost_advantages
    weight: 0.15
  - name: intangible_assets
    weight: 0.15
  - name: efficient_scale
    weight: 0.10
```

**Constraint:** weights MUST sum to 1.0 (loader-enforced, ±0.01 tolerance).

The `name` is the contract key. Synthesis returns `criteria_scores` as
`{switching_costs: 4.2, network_effects: 5.0, ...}`, keyed on these names.
If you rename a criterion, also update any specialist prose in
`prompts.specialists` that references it by name.

### `tiers`

Dict mapping each tier name → required return rate (or `null` for "don't buy
at any price").

```yaml
tiers:
  inevitable: 0.08    # 8% required return for "inevitable" companies
  monopoly:   0.10
  wide:       0.12
  narrow:     null    # don't buy
```

**Tier names are free-form.** Each strategy SHOULD pick names that describe
what it actually scores, so the synthesis prompt and the CLI output read
naturally. The 7 presets follow this convention:

| Strategy | What it scores | Tier names |
|---|---|---|
| `buffett-munger` | competitive moat | `inevitable / monopoly / wide / narrow` |
| `100-bagger` | compounding durability | `generational / exceptional / proven / unproven` |
| `quality-compounder` | quality consistency | `generational / exceptional / high / inconsistent` |
| `garp` | growth quality | `exceptional_grower / high_quality_grower / steady_grower / fragile_grower` |
| `growth` | growth durability | `hypergrower / leader / contender / fading` |
| `deep-value` | balance-sheet safety | `fortress / safe / risky / dangerous` |
| `dividend-income` | dividend reliability | `aristocrat / achiever / contender` |

Synthesis picks a tier based on `weighted_score` (the dot product of
criterion scores × weights) crossed with the `thresholds` block, then looks
up the hurdle rate for the buy-price formula.

### `thresholds`

Score cutoffs that map `weighted_score` to a tier classification.

```yaml
thresholds:
  wide: 3.5      # score >= 3.5 → top-half tier
  narrow: 2.5    # score >= 2.5 but < 3.5 → bottom-half tier
                 # score < 2.5 → "don't buy" tier
```

The exact tier-mapping logic lives in `prompts.synthesis` — these thresholds
are the numeric inputs synthesis uses to decide.

### `position_sizing`

Two formats. Pick one.

```yaml
# Format A — fixed allocation per tranche (simpler)
position_sizing:
  max_positions: 15
  max_single_position: 0.07
  tiers:
    T1: { allocation: 0.03 }
    T2: { allocation: 0.02 }
  cash_reserve:
    minimum: 0.10
    target:  0.15
```

```yaml
# Format B — tier_ranges + tranches (more expressive)
position_sizing:
  max_positions: 8
  max_single_position: 0.25
  tier_ranges:
    inevitable: [0.20, 0.25]    # [min%, max%] of portfolio for this tier
    monopoly:   [0.15, 0.20]
    wide:       [0.10, 0.15]
    narrow:     null            # don't invest
  tranches:
    T1: { pct_of_target: 0.70 }
    T2: { pct_of_target: 0.20 }
    T3: { pct_of_target: 0.10 }
  cash_reserve:
    minimum: 0.10
    target:  0.20
```

Numeric only — the *prose* about when to enter each tranche lives in
`prompts.synthesis`.

### `display`

Strategy-specific CLI labels (cosmetic only).

```yaml
display:
  primary_value_label: "Owner Earnings"      # vs "Earnings (diluted)" / "Dividend per Share"
  target_price_label:  "Buy Price"           # vs "PEG Fair Value" / "Income Buy Price"
  yield_label:         "Earnings Yield"
  safety_label:        "Margin of Safety"
  zone_label:          "Buy Zone"
```

Different valuation methods produce different headline numbers. This block
lets the CLI render "$402 Owner Earnings" for a Buffett strategy and "$402
PEG Fair Value" for a GARP strategy without code changes.

### `llm_overridable`

Numeric knobs the synthesis agent may adjust within bounds. The *prose* for
when to adjust each knob lives in `prompts.synthesis` — Zone 1 here only
declares the numeric contract.

```yaml
llm_overridable:
  hurdle_rate:
    default: 0.12
    range: [0.06, 0.18]
    label: "Required return rate"
  growth_haircut:
    default: 0.30
    range: [0.10, 0.60]
    label: "Discount on revenue CAGR"
  maintenance_capex_ratio:
    default: 0.50
    range: [0.40, 1.00]
    label: "Maintenance share of total capex"
```

Synthesis sees `OVERRIDABLE: hurdle_rate [0.06-0.18, default 0.12], ...` in
its structured-context block, and is told *when* to deviate from the
default by the prose in `prompts.synthesis`.

---

## Zone 2 reference

### `prompts.synthesis`

The load-bearing analysis prompt. This is the single biggest determinant of
output quality — invest in it.

A complete synthesis prompt covers:

1. **Strategy thesis (1-2 sentences).** What philosophy this strategy
   embodies and why.
2. **Criterion scoring rubric (1 paragraph per criterion).** What scores 5,
   3, 1, with concrete benchmarks where possible.
3. **Tier classification rule.** How to pick a tier from weighted_score +
   thresholds + the strategy's qualitative judgment.
4. **Buy-price formula in plain English.** Synthesis is an LLM, not an
   expression evaluator — write the math as prose.
5. **Decision rules (BUY / WATCH / PASS / SELL).** Explicit threshold
   logic. Use the words BUY/WATCH/PASS so the renderer pills them.
6. **When to adjust the LLM-overridable knobs.** Per-knob prose with
   sector-specific or evidence-specific guidance.
7. **Output expectations.** What to surface in `thesis`, `bull_case`,
   `key_risks`, etc.

Aim for 1500-5000 chars. The 7 presets are calibrated examples — `buffett-munger.yaml`
is the canonical reference.

### `prompts.discovery`

The agentic-discovery brief. Used by `owlfolio find` to compile a candidate
list.

A complete discovery brief covers:

1. **Universe.** "S&P 500 large caps" / "Russell 3000 small + mid caps" /
   "Dividend Aristocrats list" — describe what to search.
2. **Bias toward.** Sector tilts, fundamental filters (ROIC > 15%,
   payout < 60%, etc.), recency biases.
3. **Avoid.** Common traps for this strategy (yield > 6% for income,
   secular decline industries for value, single-product startups for GARP).
4. **Rank by.** Free-form ranking signal — Chowder Number, PEG, P/B
   discount, whatever.
5. **Output.** What fields to return per candidate (note + metrics).

The discovery agent has a scoped MCP tool surface (`validate_ticker`,
`get_ticker_summary`) plus WebSearch and WebFetch — no portfolio access, no
file IO. Each ticker it returns is yfinance-validated to drop hallucinations.

### `prompts.specialists.<name>`

Self-contained prose blocks, one per specialist. Each block is the
strategy-specific operating prompt for one specialist subagent.

```yaml
prompts:
  specialists:
    financial_analyst: |
      Analyze {COMPANY} ({TICKER})'s earnings quality, balance sheet
      strength, cash flow, and capital allocation. Calculate Owner
      Earnings (Net Income + D&A - Maintenance Capex - SBC - Working
      Capital Change). Assess debt levels, interest coverage, and cash
      generation consistency over 5 years. Cross-reference at least 2
      data sources.

      Sources to check first:
        - https://stockanalysis.com/stocks/{TICKER}/financials/
        - https://www.macrotrends.net/stocks/charts/{TICKER}

    moat_analyst: |
      Score competitive advantages on the strategy's criteria
      (switching_costs, network_effects, cost_advantages,
      intangible_assets, efficient_scale). Each scored 1-5. Assess
      moat trajectory: widening, stable, or narrowing.

      Sources to check first:
        - Industry reports and market share data (web search)
        - Competitor filings and annual reports
```

**Source URLs are folded inline.** This is intentional — each specialist
prompt is one prose block, not a `{role, sources}` pair. It keeps the schema
small and lets the strategy author phrase the source list naturally
(numbered list, "check X first then Y", etc.).

**Placeholders.** `{TICKER}` and `{COMPANY}` are substituted at dispatch
time by the runner. Use them — don't hardcode example tickers.

**Length.** Aim for 100-1000 chars per specialist. Shorter than that and
the specialist is under-specified; longer and you're probably re-explaining
the strategy thesis (which belongs in `prompts.synthesis`).

**Specialist roster.** 3-5 specialists per strategy is the sweet spot.
Fewer means thin coverage; more means duplicated research and slower runs.

---

## Two audiences, two artifacts

The synthesis agent and the specialist subagents read different parts of
the strategy. Keep this distinction in mind:

| Block | Read by | Why |
|---|---|---|
| `criteria` (names + weights) | **Both** synthesis (aggregation) and the specialists that score criteria (their prose can reference these names) |
| `tiers`, `thresholds` | **Synthesis** only | Synthesis picks the tier and looks up the hurdle |
| `position_sizing` | **Synthesis** only | Synthesis emits `recommended_position_pct` |
| `display` | CLI display | Cosmetic |
| `llm_overridable` | **Synthesis** only | Synthesis sees the ranges and defaults |
| `prompts.synthesis` | **Synthesis** only | The load-bearing prompt |
| `prompts.discovery` | **Discovery agent** only | Used by `owlfolio find` |
| `prompts.specialists.<name>` | **That specialist** only | Each specialist sees only its own prose |

Specialists do **not** receive the tier definitions or buy-price formula.
Their job is to score what their prose tells them to score and report
findings. Synthesis owns aggregation, classification, and decision.

---

## End-to-end example

A complete minimal strategy:

```yaml
name: my-quality-strategy
description: "Concentrated bets on durable compounders."
summary: |
  Buy small portfolio of high-quality businesses, hold for years,
  rebalance only when the thesis breaks.
author: "Me"

criteria:
  - {name: returns_on_capital, weight: 0.30}
  - {name: durability_of_advantage, weight: 0.25}
  - {name: capital_allocation, weight: 0.25}
  - {name: balance_sheet, weight: 0.20}

tiers:
  exceptional: 0.10
  durable:     0.13
  cyclical:    null

thresholds:
  wide: 3.5
  narrow: 2.5

llm_overridable:
  hurdle_rate:
    default: 0.13
    range: [0.08, 0.20]
    label: "Required return rate"

position_sizing:
  max_positions: 12
  max_single_position: 0.10
  tiers:
    T1: {allocation: 0.04}
    T2: {allocation: 0.03}
  cash_reserve: {minimum: 0.10, target: 0.15}

display:
  primary_value_label: "Owner Earnings"
  target_price_label:  "Buy Price"
  yield_label:         "Earnings Yield"
  safety_label:        "Margin of Safety"
  zone_label:          "Buy Zone"

prompts:
  synthesis: |
    You are scoring this company against the my-quality-strategy framework.
    [...detailed synthesis prompt covering rubric, tier rule, buy-price
    methodology, decision rules, knob-tuning guidance — typically 2000+ chars...]

  discovery: |
    Find 10-15 US-listed candidates for the my-quality-strategy.
    Universe: large + mid cap. Bias toward consumer staples, healthcare,
    software with recurring revenue. Avoid cyclicals, anything with
    declining gross margins for 3+ years. Rank by ROIC × FCF margin.

  specialists:
    financial_analyst: |
      [Self-contained prose with role, scoring guidance, sources inline.]
    moat_analyst: |
      [...]
    risk_analyst: |
      [...]
```

---

## What was removed in earlier cleanups

These fields are no longer recognized. They were Phase 1 leftovers from the
mechanical plugin pipeline (since replaced by specialists) and the Finviz
screener (replaced by agentic discovery + import). The loader silently
drops them, but you should remove them from your YAMLs because they had no
effect on actual behavior.

| Removed | Why |
|---|---|
| `research.plugins`, `research.sections` | Plugin pipeline replaced by `prompts.specialists` |
| `criteria_anchor:` block | Split into `criteria`, `tiers`, `thresholds` (Zone 1) |
| `valuation:` block | Folded into `prompts.synthesis` (the methodology prose) |
| `decisions:` block | Folded into `prompts.synthesis` (the BUY/WATCH/PASS rules) |
| `screening:` block | Finviz screener removed; use `prompts.discovery` for the agentic equivalent |
| `monitoring:`, `reporting:`, `fundamentals:` | No consumers |
| `specialists.<name>.role` + `sources` | Folded into `prompts.specialists.<name>` (one prose block) |

If you have a custom strategy with these fields, just delete them. The
loader accepts the file unchanged in the meantime (`extra='ignore'`), but
any behavior these fields once produced is gone.

---

## Validation

```bash
owlfolio config validate           # Validate the active strategy
owlfolio strategy --info NAME      # Show parsed summary of a preset
owlfolio strategy --list           # List all available strategies
```

The validator catches:

- Criterion weights that don't sum to 1.0
- `prompts.synthesis` missing or under 50 chars (placeholder check)
- Position sizing that exceeds 100% (or 200% for tier_ranges format)
- Strategies with no specialists (the analyze pipeline needs at least one)
- Numeric overridable variables with `range` where min >= max

It does *not* validate prose quality. That's on the author. The 7 presets
are calibrated examples — start from one and customize rather than writing
from scratch.

---

## Where to look for the canonical examples

- `strategies/buffett-munger.yaml` — full reference (5 specialists, both
  format-A position sizing and format-B tier_ranges, comprehensive
  synthesis prompt).
- `strategies/deep-value.yaml` — strongest discovery brief (Russell 3000 +
  catalyst requirement + chronic-cheapness avoid-list).
- `strategies/100-bagger.yaml` — strategy-appropriate tier names
  (`generational / exceptional / proven / unproven`).
- `strategies/dividend-income.yaml` — minimal-criteria example (4
  criteria) with domain-correct tier names.
