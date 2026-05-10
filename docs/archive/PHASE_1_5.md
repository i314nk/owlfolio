# Phase 1.5 -- Hardening & Observability

> **STATUS: ARCHIVED — historical artifact.**
> This document describes architecture or behavior that has since been
> replaced. It's kept as a record of what shipped in this phase, not as
> a guide to current behavior. For current state, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../STRATEGY_GUIDE.md`](../STRATEGY_GUIDE.md).


**Status: COMPLETE.**

*Goal: Close Phase 1 gaps and add production-readiness before Phase 2 automation.*

---

## What Phase 1.5 Delivered

All critical tasks implemented and validated. Two items were deferred as non-essential:

- **Deferred: LLM call tracking (SQLite + costs)** -- User is on flat-rate Claude Max subscription. No per-token cost to track.
- **Deferred: Multi-provider groundwork** -- Sticking with Claude Agent SDK. Full multi-provider support is a future concern.

All 7 strategies passed mechanical and LLM validation. Logging, structured outputs, web search, error isolation, and all bug fixes shipped.

*Note: The plugin-based architecture that Phase 1.5 hardened has since been replaced by specialist subagents in Phase 3a. The hardening patterns (structured outputs, error isolation, logging) carry forward in the new architecture.*

---

## Completed Tasks

### Bug Fixes
- [x] Hardcoded formula evaluation order -- FIXED (used YAML dict insertion order)
- [x] Display formatting for per-share values -- FIXED (added `DisplayConfig`)
- [x] Decision criteria context: raw financials missing -- FIXED
- [x] Mental model verdict integration -- FIXED
- [x] Growth rate source mismatch -- FIXED
- [x] All 7 strategies validated (mechanical + full LLM)

### Logging -- DONE
- [x] RotatingFileHandler to `logs/agent.log`, 5MB rotation
- [x] INFO default, DEBUG with `--verbose`
- [x] Bare `print()` calls replaced with `logger`

### Structured LLM Outputs -- DONE
- [x] Pydantic `AnalysisResponse` validation with retry on parse failure
- [x] Mental models: guaranteed PASS/CONCERN/FAIL verdicts
- [x] Variable overrides: guaranteed numeric values within ranges
- [x] Moat assessment: guaranteed criterion scores (1-5)

### Error Isolation -- DONE
- [x] EDGAR filing type detection logging
- [x] EDGAR filing fetch timeout (120s)
- [x] Agent SDK retry (2 attempts)

### Web Search Integration -- DONE
- [x] Agent SDK WebSearch tool integration
- [x] Per-strategy config (`web_search: true/false` in YAML)
- [x] Plugin outputs displayed in CLI

---

## Deferred Items

| Item | Reason | Future Phase |
|------|--------|-------------|
| LLM call tracking (SQLite + costs) | Flat-rate subscription, no cost to track | When API key path matters |
| Multi-provider groundwork | Sticking with Claude Agent SDK | Phase 3+ |
