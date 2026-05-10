# Phase 1 -- Core Engine (MVP)

> **STATUS: ARCHIVED — historical artifact.**
> This document describes architecture or behavior that has since been
> replaced. It's kept as a record of what shipped in this phase, not as
> a guide to current behavior. For current state, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../STRATEGY_GUIDE.md`](../STRATEGY_GUIDE.md).


**Status: COMPLETE.** 131 tests passing (down from 265+ due to Phase 3a cleanup of old module tests).

*Goal: `owlfolio analyze AAPL` works end-to-end.*

---

## What Phase 1 Delivered

A CLI tool that takes a ticker, applies your investment methodology from `methodology.yaml`, and outputs a structured investment decision (BUY / WATCH / PASS) with full reasoning.

Phase 1 originally used a plugin pipeline with EDGAR data, formula evaluation, and mechanical decisions. This has since been replaced by the specialist subagent architecture in Phase 3a -- see [`../FUTURE_PLAN.md`](../FUTURE_PLAN.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for the current design.

---

## What Was Built

### Core Components
- [x] Project structure, `pyproject.toml` with uv, CLI scaffolding (Typer)
- [x] Strategy loader -- parse YAML into typed Pydantic objects, validate, 7 presets
- [x] Safe formula evaluator (`simpleeval`) for custom formulas from YAML
- [x] SEC EDGAR connector (`edgartools`) -- 10-K/20-F, XBRL financials
- [x] Price connector (`yfinance`) -- current price, market cap, historical
- [x] Fundamentals aggregator -- EDGAR XBRL + yfinance unified
- [x] Valuation module -- formula evaluation, owner earnings, intrinsic value
- [x] Research module -- progressive summarization, moat scoring, thesis generation
- [x] Decision module -- mechanical + LLM judgment layers
- [x] 7 default strategies, all validated mechanically and with full LLM
- [x] ADR support (20-F/6-K filings, auto-detected)

### Research Pipeline (Original -- Now Replaced)
- [x] Plug-and-play research plugins (news, competitors, management, mental models, position sizing)
- [x] Parallel execution via ThreadPoolExecutor
- [x] Standardized ResearchPluginInput/Output contract
- [x] Consolidated pipeline (2+N LLM calls)

*Note: The plugin pipeline was replaced by specialist subagents in Phase 3a. The old modules (edgar.py, fundamentals.py, valuation.py, decision.py, xbrl_tags.py) have been removed.*

### CLI & Auth
- [x] `owlfolio analyze TICKER` -- full analysis
- [x] `owlfolio setup` -- conversational strategy onboarding
- [x] `owlfolio config show / validate`
- [x] `owlfolio strategy --list / --use / --info`
- [x] Dual-backend LLM provider (Agent SDK + raw Anthropic SDK)
- [x] Multi-auth (subscription, API key, OneCLI, OAuth file)

### Strategy-Neutral Architecture
- [x] `criteria_anchor` with strategy-specific label (replaces hardcoded "moat")
- [x] `DisplayConfig` for strategy-specific metric labels
- [x] `buy_criteria` evaluated from YAML expression strings
- [x] `llm_overridable` variables with per-strategy ranges
- [x] Strategy switching via CLI

---

## Definition of Done (Phase 1) -- All Met

- [x] `owlfolio analyze AAPL` produces correct, methodology-driven output
- [x] `owlfolio setup` generates valid methodology.yaml
- [x] Dual-backend LLM (Agent SDK + raw API), multi-auth
- [x] 7 default strategies, all passing mechanical + LLM validation
- [x] ADR support (20-F/6-K)
- [x] All tests pass

---

## Technical Notes

### Formula Evaluation Safety (Historical)

The original Phase 1 used `simpleeval` for safe expression evaluation of strategy formulas. This has been superseded by the synthesis agent in Phase 3a, which handles valuation as part of its LLM-driven analysis.

### Evolution: Plugins to Specialists

Phase 1's plugin system evolved through three stages:
1. **Phase 1**: Plug-and-play research plugins with standardized contracts
2. **Phase 1.5**: Hardening -- structured outputs, web search, error isolation
3. **Phase 3a**: Full replacement with specialist subagents (each specialist independently fetches and analyses data)

See [`../FUTURE_PLAN.md`](../FUTURE_PLAN.md) for the specialist architecture details.
