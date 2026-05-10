# Phase 2 -- Portfolio & Screening

> **STATUS: ARCHIVED — historical artifact.**
> This document describes architecture or behavior that has since been
> replaced. It's kept as a record of what shipped in this phase, not as
> a guide to current behavior. For current state, see
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../STRATEGY_GUIDE.md`](../STRATEGY_GUIDE.md).


**Status: COMPLETE** (core features). Some items remain for future phases.

*Goal: Full investment operating system running on schedule.*

---

## What Phase 2 Delivered

- SQLite persistence (holdings, decisions, watchlist, analyses, alerts, snapshots, memory)
- Portfolio management with live P&L (`owlfolio portfolio`, `owlfolio add`, `owlfolio sell`)
- Performance snapshots with SPY benchmark
- Finviz-powered screening (`owlfolio screen`)
- Owlfolio CLI chat agent (Claude Opus 4.7, permission-restricted)
- Scheduled tasks + 24/7 daemon (`owlfolio daemon`)
- Strategy creation tool (sandboxed, conversational + quick wizard)
- Memory system (SQLite-based, injected on chat startup)
- Alert system (daemon writes to alerts table, visible in CLI and web UI)
- Compare command using saved analyses
- ADR currency conversion (DKK/TWD/EUR to USD)
- Decision journal logging every action with reasoning

---

## Completed Tasks

### SQLite Database
- [x] Holdings table (ticker, shares, cost basis, date, account)
- [x] Decisions table (action, reasoning, date, strategy)
- [x] Performance/snapshots table (portfolio value, benchmark, alpha)
- [x] Watchlist table (ticker, buy zone price, last reviewed)
- [x] Analyses table (saved analysis results)
- [x] Alerts table (unread alerts, task results)
- [x] Memory table (chat context persistence)
- [x] Tasks table (scheduled task definitions)

### Portfolio Module
- [x] Add/remove holdings (manual entry)
- [x] Real-time valuation (yfinance prices)
- [x] Performance snapshots with P&L tracking
- [x] Alpha vs SPY benchmark

### Screening Module
- [x] Finviz-powered screening with strategy filters
- [x] Quantitative filter engine (from config)

### Watchlist Module
- [x] Add to watchlist with auto-populated buy price from analysis
- [x] Price alerts (configurable target prices)

### Scheduler
- [x] SQLite-based task storage (add/remove/list tasks)
- [x] Cron-based task definitions
- [x] Background daemon (`owlfolio daemon`)
- [x] Task history logging (last_run, last_result)

### Decision Journal
- [x] Log every decision (buy, sell, pass, watch) with full context
- [x] Strategy name recorded at time of decision

### CLI Commands (all delivered)
- [x] `owlfolio portfolio`, `owlfolio add`, `owlfolio sell`
- [x] `owlfolio screen`, `owlfolio watch`
- [x] `owlfolio history`, `owlfolio performance`
- [x] `owlfolio tasks`, `owlfolio schedule`, `owlfolio daemon`
- [x] `owlfolio compare TICKER1 TICKER2`
- [x] `owlfolio snapshot`, `owlfolio alerts`
- [x] `owlfolio chat` (AI portfolio manager)
- [x] `owlfolio setup` (consolidated first-time setup)

### ADR / Foreign Currency Support
- [x] Auto-detect reporting currency from EDGAR XBRL
- [x] Fetch exchange rates via yfinance
- [x] Convert all financials to USD before valuation
- [x] Handle ADR ratio for per-share calculations
- [x] Cache exchange rates (daily refresh)

### Key Files

| File | Purpose |
|------|---------|
| `src/db/schema.py` | All table definitions |
| `src/db/operations.py` | CRUD for all tables |
| `src/daemon.py` | Background task daemon |
| `src/agent/core.py` | Chat agent (Opus 4.7) |
| `src/modules/screener.py` | Finviz screening |
| `src/modules/onboarding.py` | Strategy creation tool |

---

## Remaining (Future Phases)

| Feature | Notes |
|---------|-------|
| Multi-account support (Broker A, Broker B, Broker C) | Not yet implemented |
| Telegram/WhatsApp notifications | Not yet implemented |
| Allocation breakdown (by sector) | Not yet implemented |
| Tranche tracking (T1/T2/T3 progression) | Not yet implemented |
| Cash tracking | Not yet implemented |
| Quarterly thesis review automation | Not yet implemented |
| Web UI | In progress (Phase 3b) |
