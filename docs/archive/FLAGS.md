# Flags & Observations

> **STATUS: ARCHIVED — historical artifact.**
> This document describes architecture or behavior that has since been
> replaced. It's kept as a record of what shipped in this phase, not as
> a guide to current behavior. For current state, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../STRATEGY_GUIDE.md`](../STRATEGY_GUIDE.md).


*Created: Apr 25, 2026*
*Last updated: 2026-04-25 (strategy audit)*
*Source: External strategy YAML audit — all 7 strategies reviewed*

Observations and recommendations from a full audit of the strategy YAMLs and specialist configurations. None are blocking bugs.

**Status legend:** ✅ resolved · 🟡 open · ⏳ planned

---

## Flag 1: Deep-Value — Criteria Tier Names Reuse Moat Terminology

**Severity:** Low (semantic confusion)
**File:** `strategies/deep-value.yaml`

The criteria framework was labeled `"Safety Assessment"` but reused the moat-based tier names from other strategies (`inevitable`, `monopoly`, `wide`, `narrow`). In deep-value those tiers represent balance-sheet safety, not competitive moat strength.

**Resolution (2026-04-25):** Renamed tiers + hurdle_rates keys to `fortress / safe / risky / dangerous`, framework to `"safety-tiered"`. Comment header rewritten.

**Status:** ✅ Resolved

---

## Flag 2: Growth Strategy — Missing Tier Definitions

**Severity:** Low (incomplete documentation)
**File:** `strategies/growth.yaml`

The `criteria_anchor` had scoring thresholds but no `tier_definitions` block. All other strategies include detailed tier definitions; growth's synthesis prompt was therefore less guided.

**Resolution (2026-04-25):** Added growth-specific tier definitions with strategy-appropriate names: `hypergrower / leader / contender / fading`. Framework renamed to `"growth-tiered"`. No `hurdle_rates` added — PEG-based strategies don't use tier-keyed hurdle rates (they use `peg_target` from `llm_overridable`).

**Status:** ✅ Resolved

---

## Flag 3 (added 2026-04-25): Strategy-Specific Tier Names Across Other Strategies

**Severity:** Low
**Files:** `strategies/100-bagger.yaml`, `strategies/quality-compounder.yaml`, `strategies/garp.yaml`

The same problem Flag 1 identified for deep-value applied (less egregiously) to 100-bagger, quality-compounder, and garp. All three had a strategy-specific `criteria_anchor.label` (Compounding / Quality / Growth Quality) but reused the moat tier names underneath.

**Resolution (2026-04-25):** Renamed tiers throughout:
- `100-bagger`: `generational / exceptional / proven / unproven` (framework: `compounder-tiered`)
- `quality-compounder`: `generational / exceptional / high / inconsistent` (framework: `quality-tiered`)
- `garp`: `exceptional_grower / high_quality_grower / steady_grower / fragile_grower` (framework: `growth-quality-tiered`)

`buffett-munger` keeps the moat tier names (`inevitable / monopoly / wide / narrow`) because it actually scores competitive moats. `dividend-income` was already using domain-correct names (`aristocrat / achiever / contender`).

The tier-naming convention is now documented in `docs/STRATEGY_GUIDE.md` → "Tier names are free-form".

**Status:** ✅ Resolved

---

## Summary

| # | Flag | Severity | Status |
|---|------|----------|--------|
| 1 | Deep-value tier names reuse moat terminology | Low | ✅ |
| 2 | Growth strategy missing tier definitions | Low | ✅ |
| 3 | Other strategies reuse moat tier names | Low | ✅ |
