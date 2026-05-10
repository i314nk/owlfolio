# Bugs & Validation Checklist

> **STATUS: ARCHIVED — historical artifact.**
> This document describes architecture or behavior that has since been
> replaced. It's kept as a record of what shipped in this phase, not as
> a guide to current behavior. For current state, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../STRATEGY_GUIDE.md`](../STRATEGY_GUIDE.md).


*Created: Apr 23, 2026*
*Last updated: Apr 25, 2026*

**Status: All known bugs fixed. Architecture has changed significantly -- see below.**

---

## Architecture Change Note

The original bugs (Phase 1/1.5) affected the plugin-based pipeline with EDGAR data, formula evaluation, and mechanical decisions. That entire pipeline was replaced by the specialist subagent architecture in Phase 3a. The old modules (valuation.py, decision.py, edgar.py, fundamentals.py, xbrl_tags.py) have been removed.

The bugs documented below are historical -- they were fixed before the architecture change, and the code they affected no longer exists.

---

## Bug 1: Hardcoded Formula Evaluation Order -- FIXED (Historical)

**Severity:** Critical
**Status:** FIXED (code later removed in Phase 3a)

Strategies with different intermediate formulas crashed because formula evaluation order was hardcoded to Buffett-style. Fixed by using YAML dict insertion order.

---

## Bug 2: Display Formatting -- Per-Share Values Shown as "$0.00B" -- FIXED (Historical)

**Severity:** Medium
**Status:** FIXED (code later removed in Phase 3a)

Per-share strategies showed "$0.00B" for EPS/DPS values. Fixed with `DisplayConfig` and `format_primary_value`.

---

## Validation Results (Apr 2026)

All 7 strategies passed both mechanical and full LLM validation before the Phase 3a architecture change:

| Strategy | Ticker | Mechanical | Full LLM |
|----------|--------|-----------|----------|
| buffett-munger | AAPL | PASS | PASS |
| growth | NVDA | PASS | PASS |
| garp | MSFT | PASS | PASS |
| 100-bagger | DXCM | PASS | PASS |
| quality-compounder | V | PASS | PASS |
| dividend-income | KO | PASS | PASS |
| deep-value | HPQ | PASS | PASS |

---

## Previously Known Rough Edges -- Resolved

- **`complexity_check` mental model verdict** -- Fixed in Phase 1.5 (code later removed with plugin system).
- **`revenue_growth_3yr` sometimes missing** -- Fixed in Phase 1.5.
- **ADR currency conversion** -- Implemented in Phase 2. Auto-detects reporting currency, fetches exchange rates, converts to USD.

---

## Current Test Suite

131 tests across 7 test files, all passing. Run with:

```bash
pytest tests/ -v
```
