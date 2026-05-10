# Future Plan

This document is split into two halves:

1. **What's been built** — the four sub-phases that brought Owlfolio to its current shape.
2. **Potential future additions** — concrete ideas for what comes next, ranked by how directly they extend what's already here.

For *current behavior* see [`ARCHITECTURE.md`](ARCHITECTURE.md). This is
the forward-looking doc — not a phase log.

---

## What's been built

### Phase 3a — Specialist Subagent Architecture

Replaced the original plugin pipeline with independent specialist subagents.

- Specialist runner (`src/specialists/runner.py`) spawns Agent SDK subagents in parallel.
- Each specialist independently fetches data via `WebSearch` / `WebFetch` and returns structured findings.
- Synthesis agent (`src/specialists/synthesis.py`) combines specialist outputs and owns the final BUY / WATCH / PASS decision (no mechanical formulas).
- Pydantic output schemas in `src/specialists/schemas.py`.

Removed: `src/data/edgar.py`, `src/data/fundamentals.py`, `src/data/xbrl_tags.py`, `src/modules/valuation.py`, `src/modules/decision.py`, the entire plugin registry.

### Phase 3b — Web UI

FastAPI + Tailwind + htmx + Alpine.js. OpenAI-style chat-centered layout.

- `owlfolio serve` starts the web UI at http://127.0.0.1:8000.
- WebSocket chat with token streaming and structured markdown rendering on completion (decision pills, ticker/price highlighting, tables, code blocks).
- Strategy selector dropdown, add-on agents panel, daemon-status indicator in the header.
- Sidebar drawer with six tabs (Portfolio, Watchlist, Lists, Activity, Alerts, Schedule), each opening with a one-paragraph explainer.
- Specialist progress card during `analyze` runs (live status dots + progress bar).

### Phase 3c — Add-on specialists

Reusable add-on pattern letting strategy-agnostic specialists attach to *any* strategy via CLI flag or chat.

- Shariah compliance specialist (AAOIFI screening). `owlfolio analyze TICKER --shariah` runs it alongside the strategy roster; `owlfolio shariah TICKER` runs it standalone (persists as a degenerate analysis with `decision = 'N/A'` so the audit feed is unified).
- Pattern lives in `src/specialists/addons.py`. Future add-ons drop in here.

### Phase 3d — Two-zone strategies, candidate lists, audit

The biggest restructure since 3a. Three pillars:

**Two-zone strategy YAML.** Old YAMLs threaded prose through ~30 fields. New shape collapses prose into one block per LLM consumer:

- Zone 1 (typed): `criteria` (names + weights), `tiers`, `thresholds`, `position_sizing`, `display`, `llm_overridable` (numeric ranges only).
- Zone 2 (prose): `prompts.synthesis`, `prompts.discovery`, `prompts.specialists.<name>` (sources folded inline).

All 7 presets migrated. Loader stays permissive (`extra='ignore'`) so old YAMLs still load.

**Candidate-list pipeline (replacing the Finviz screener).** The legacy numeric screener was deleted. Replaced by:

- `owlfolio find` — agentic discovery using the strategy's `prompts.discovery` brief.
- `owlfolio import` — paste a CSV / file path / inline ticker string from any external screener.
- `owlfolio analyze-list NAME` — batch-analyze every candidate, concurrency-capped (default 2) to prevent rate-limit / billing surprises.

**Audit story.** Every meaningful action persists with a stable `#NN` reference token.

- Specialist findings persisted per analysis (`specialist_findings` table, FK cascade).
- Daemon-fired task runs persisted (`task_runs` table — exit code, stdout/stderr excerpts capped at 2KB).
- `get_activity` MCP tool unifies analyses + decisions + candidate_lists + task_runs into one chronological feed.
- Activity sidebar tab consumes the same feed with type-filter pills.

**Agent guardrails.** `src/agent/CLAUDE.md` updated with: pre-analysis disambiguation (ticker vs company vs private), cost-aware confirmation, intent-to-tool routing, `#NN` reference recognition, "never guess CLI subcommand names" rule (server-side validator rejects phantom `owlfolio <subcommand>` schedules).

---

## Potential future additions

Ranked by how directly they extend what's already built. The first group reuses the existing architecture; the second adds new surfaces; the third is genuinely new scope.

### Tier 1 — extends the audit + strategy story

- **~~Specialist drilldown.~~** ✅ *Implemented 2026-04-28 (contributor).* Expandable accordion cards per specialist in the Activity tab with confidence badges, key findings, flags, and data sources. Lazy-loaded via `GET /api/analysis/{id}/findings`. See `docs/CHANGELOG_ADDITIONS.md` for details.
- **~~Thesis drift detection.~~** ✅ *Implemented 2026-04-28 (contributor) as a synthesis prompt enhancement.* Previous analysis scores passed to synthesis agent; holdings get `[MATERIAL CHANGE]` flag for ≥2 point score shifts or decision changes. Not a standalone daemon job — baked into the analysis pipeline itself. See `docs/CHANGELOG_ADDITIONS.md` for details.
- **Interactive chart tool (Plotly).** Agent generates Plotly charts on demand during chat — margin trends, price history, peer comparisons, sector exposure. Charts render inline in the htmx UI as interactive HTML (hover, zoom, click). Replaces the need for a separate static Metrics pane. Implementation: a `render_chart(chart_type, data, title)` MCP tool that writes a Plotly figure to a temp HTML file and returns a URL the UI embeds in an iframe.
  - *Implementation approach (documented, not yet built):*
  - Charts render inline in chat messages (Option A) — below synthesis text, interactive Plotly iframes.
  - Specialists include `suggested_charts` field in output → synthesis selects 2-3 most relevant.
  - Chart types: revenue/earnings trend (bar), margin profile (line), valuation range (vs 5yr + sector), key metric highlight with annotated flags/markers.
  - `render_chart` MCP tool generates Plotly JSON → frontend renders via Plotly.js in chat bubble.
  - Future upgrade path: Option B — click-to-expand from thumbnail to slide-out panel if inline feels cramped.
  - No layout change needed — works within existing chat width (~48rem).
- **Portfolio analytics dashboard.** *(Consolidated from Tier 2 "Portfolio analytics pane" + "Risk / correlation / exposure pane" + "Metrics pane".)* Single analytics surface combining returns-and-risk (alpha vs SPY, beta, Sortino, max drawdown, calmar ratio), correlation matrix, sector/factor/geography exposure, and score history. `quantstats` for metrics, `pandas` for returns time-series, Plotly for visualization. Exposed as typed MCP tools: `compute_portfolio_metrics(account?, since?)`, `compute_correlation_matrix(tickers, window)`, `compute_exposure(holdings)`. The agent describes results in prose; the math is deterministic. Agent-generated narrative commentary on what's driving performance.
- **Quarterly portfolio report generator.** Agent-driven, fully customizable per user preferences. User sets what they want once (performance attribution, top/bottom movers, risk metrics, strategy drift, macro commentary). Each quarter the agent: pulls portfolio data → runs analytics (quantstats) → writes narrative commentary explaining *why* (not just what) → generates Plotly charts → renders to static images → assembles into a Jinja2-templated PDF via `weasyprint`. The narrative is the killer feature — no static tool writes "BR underperformed because recurring revenue decelerated while the market rotated into growth." Replaces the simpler "PDF report generation" idea — that becomes a subset (single-analysis memo export).
- **Activity feed search.** Filter by ticker / decision / strategy / date range. Currently filterable only by type.
- **Default automated schedule (end-to-end lifecycle).** Out-of-the-box schedule template that automates the full investment lifecycle. New users set timezone + strategy → schedule auto-configures with cron expressions adjusted to their market hours. Users can toggle individual tasks on/off.

  *Lifecycle coverage:*

  | Frequency | Lifecycle Step | Task |
  |-----------|---------------|------|
  | Daily (weekdays) | Monitoring | Price check + buy zone alerts for holdings and watchlist |
  | 2x/week (Tue/Fri) | Monitoring | Material event scan — news/filings for holdings + top watchlist |
  | Weekly | Discovery | Run strategy's `prompts.discovery` to find new candidates |
  | Weekly | Screening | Process candidate queue — analyze next unprocessed batch from candidate lists |
  | On earnings date | Re-analysis | Auto-trigger full re-analysis when a holding reports earnings (uses thesis drift context) |
  | Monthly (1st) | Portfolio health | Performance snapshot, exposure check, allocation drift, thesis drift summary across all holdings |
  | Quarterly | Reporting | Generate quarterly report (depends on quarterly report generator) |

  *Implementation:*
  - Schedule stored as YAML template per strategy (different strategies may emphasize different cadences)
  - Timezone-aware: user sets timezone in config → cron expressions computed relative to their primary market's hours (e.g. "30min before NYSE open" = different crons for Dubai vs NYC)
  - Each task maps to existing CLI commands or MCP tools (`analyze`, `find`, `analyze-list`, price check, etc.)
  - Onboarding flow presents the schedule and lets user customize before activating

  *Identified gaps (must be resolved before or alongside this feature):*
  1. **Earnings calendar integration** — No earnings date table in Owlfolio DB. Need either: (a) store upcoming earnings dates fetched from yfinance/API, or (b) daily check that queries an earnings API. Without this, the "on earnings date" trigger is manual.
  2. **Automated buy zone alerting** — `alerts` table exists but nothing auto-populates it from price movements. Price check task needs to create alerts when watchlist items enter buy zone.
  3. **Candidate queue auto-processing** — `analyze-list` exists for batch analysis, but no scheduled task picks up unanalyzed candidates automatically. Need a "process next N candidates" scheduled task.
  4. **Rebalancing signals** — No way to detect when a position exceeds allocation targets. Depends on portfolio analytics dashboard (Tier 1).

### Tier 2 — new surfaces, same architecture

- **Re-synthesis from saved findings.** Phase 3d already saves specialist findings. Add `owlfolio resynthesize ANALYSIS_ID` that pulls the saved findings and runs synthesis again with the *current* prompt — no re-paying for research. Useful when tuning `prompts.synthesis`.
- **~~Strategy filters across all views.~~** ✅ *Implemented 2026-04-28 (contributor).* Watchlist constraint migrated to `UNIQUE(ticker, strategy)`. Strategy dropdown filters on Portfolio, Watchlist, and Activity tabs. MCP tools `add_holding` and `add_to_watchlist` now accept strategy parameter. See `docs/CHANGELOG_ADDITIONS.md` for details.
- **ESG add-on specialist.** Pattern already exists in `src/specialists/addons.py`. Needs an AAOIFI-style scoring rubric.
- **Insider trading add-on specialist.** Form 4 filings + insider buying/selling clusters. Same pattern.
- **Multi-account support.** `holdings.account` already exists; the UI doesn't expose it well. Add account selector + per-account performance (which now has a real metric story to tell, see above).
- **Form-based strategy editor in the Web UI.** Currently YAML-only. The two-zone shape makes a form viable — Zone 1 is typed, Zone 2 is per-block textareas.
- **Telegram / WhatsApp notifications.** Daemon-side webhook on alert creation. Single-user, opt-in.
- **Second free price provider as fallback.** Finnhub or Alpha Vantage free tier inserted between yfinance and the LLM web-search fallback. Pure reliability win for the watchlist daemon. See `ARCHITECTURE.md` → Market Data.

### Tier 2.5 — user intelligence & extensibility

- **Per-user self-improvement (user model that learns).** The `memory` table already stores preferences, context, observations, and decision context. Extend this with a periodic consolidation job that reviews user corrections to analyses and distills preference patterns. Examples: "user consistently scores pharma moats lower than specialists do," "user prefers conservative growth estimates (haircuts LLM growth by ~20%)," "user always overrides tier classification downward for commodity-adjacent businesses." The job produces a `calibration` context block injected into synthesis prompts — grounding future analyses in the user's demonstrated judgment, not just the strategy's static prose. Low complexity (memory table + periodic SQL query + prompt injection), high perceived value ("it gets smarter the more I use it").

- **User-registered MCP tool plugins (custom API integration).** Currently specialists are limited to WebSearch + WebFetch. Users with access to financial APIs (Bloomberg, FactSet, SEC EDGAR full-text, broker APIs) have no way to plug them in without modifying `addons.py` or `mcp_server.py`. Add a plugin registry where users can register external MCP servers (URL + transport config) that get mounted into the specialist tool surface at runtime. This keeps the sandbox intact — MCP tools are typed, validated, and allowlisted — while letting power users bring their own data. Enables: SEC EDGAR structured data, local Ollama for cost-sensitive specialist runs, proprietary screeners, broker position sync.

### Tier 3 — bigger scope shifts

- **Strategy hierarchy / multi-asset-class support.** Today the system assumes public equities — `analyze` validates for a ticker, specialists assume SEC filings exist, strategies score equity-specific criteria. To support macro (Dalio All-Weather, Risk Parity), crypto, private markets, or real estate, the entry point needs to accept *subjects* beyond tickers (e.g., asset classes, ETF baskets, property addresses, token contracts). The orchestration pattern (spawn specialists → parallel analysis → synthesis) stays the same, but each asset class defines its own specialist roster and data sources. See "Strategy hierarchy architecture" section below.
- **Backtesting engine.** *(Moved from Tier 1 — on hold, requires historical data API.)* Measure past decision performance against historical prices. Hybrid approach: quantitative screening agent filters the historical universe (no LLM, avoids look-ahead bias), then swarm runs once on filtered set at the start date, then mechanical simulation rolls forward (price tracking, dividend reinvestment, sell-rule triggers). Expensive agentic part runs once at entry, not every quarter. Blocked on: reliable historical fundamentals API (Financial Modeling Prep, SimFin, or SEC EDGAR). Survivorship and look-ahead bias mitigation needed.
- **Strategy sharing / community marketplace.** Ship a curated set of community-authored strategy YAMLs. Requires versioning + signing decisions.
- **Documentation site (MkDocs).** The current `docs/` is fine for a repo browse but not great for searchability.
- **PyPI publication.** `pip install owlfolio`. Requires the install path to stop assuming a git checkout.
- **Cash tracking.** `holdings` is share-based; cash inflows/outflows aren't modeled.
- **Tranche tracking (T1/T2/T3 progression).** Strategies define tranches; no UI shows which tranche a holding is in.
- **Broker API integration (read-only).** Pull positions / cash from IBKR / Schwab / Alpaca instead of manual `owlfolio add`. Read-only — no order placement (see "Out of scope").

### The pattern: deterministic math sits *above* the agentic pipeline, not inside it

**Important framing.** Owlfolio's research-and-analysis pipeline is
agentic by design and *non-deterministic*. The same ticker analyzed
twice under the same strategy will produce two slightly different
syntheses — different specialist findings, different score nudges,
different prose. That's not a bug to engineer away; it IS the
architecture. The whole point of Owlfolio is "an LLM analyst team
applies your written-down philosophy" — replacing that with
deterministic screens defeats the design. If you wanted deterministic
screens, you'd use Finviz or a Bloomberg terminal.

So the principle for the math additions in Tier 1 / Tier 2 above is
**not** "use deterministic where you can, agentic where you must." It's:

> **The research-and-analysis pipeline stays fully agentic. Pandas /
> quantstats serve a separate, narrower job: measuring what the
> agentic pipeline did (audit, backtest, portfolio analytics, exposure
> math).** Never let the LLM compute alpha; equally, never replace
> the synthesis agent or the specialists with deterministic screens.

In other words, the math layer answers questions like:

- "Did your past decisions outperform SPY?" (backtest the audit feed)
- "What's my live portfolio's max drawdown / Sharpe / sector concentration?"
- "How correlated are my top 5 holdings on a 90-day window?"

It does NOT answer:

- "Is AAPL a buy?" — `analyze` does that, and will keep doing it.
- "Find me dividend names" — `find` (agentic discovery) does that.
- "Score this company on the criteria" — specialists do that.

The architectural seam is the existing MCP tool surface. Each
deterministic computation gets exposed as one typed tool the chat
agent can call — same shape as `analyze` or `get_price` today:

- `backtest(strategy_name, start_date, end_date)` → Sharpe, max
  drawdown, alpha vs SPY, win rate, turnover, on the *recorded
  decision history*. Internal: `pandas` for returns, `quantstats` for
  metrics.
- `compute_portfolio_metrics(account?, since?)` → same metrics for
  the live portfolio.
- `compute_correlation_matrix(tickers, window)` → typed matrix the
  agent describes and the UI renders.
- `compute_exposure(holdings)` → sector / factor / geography
  concentrations as a structured dict.

The agent decides *when* to call them; pandas does the math.
Specialists keep doing what they do — LLM-driven research, structured
findings, synthesis. **The agentic pipeline isn't being replaced or
pushed back; the math layer is sitting above it as a measurement and
audit story.**

This is also why the language choice matters in practice (see README):
shipping pandas behind these measurement tools from the same Python
process is basically free. From a TypeScript orchestrator it would
mean a Python sidecar / subprocess + JSON marshalling at every call —
possible, but real ongoing friction. Not the reason we chose Python,
but a downstream win.

---

### Strategy hierarchy architecture (Tier 3 design notes)

Today all 7 strategies are *investor-style strategies* within a single implicit asset class (public equities). The hierarchy concept separates two levels:

**Level 1 — Asset class (orchestration context):**
Defines what a "subject" is, which specialists get spawned, and what data sources are available.

```
asset_classes:
  public_equity:
    subject_type: ticker          # validates via yfinance / price provider
    specialists: [moat, financial, valuation, risk, catalyst]
    data_sources: [sec_filings, market_data, earnings_transcripts]

  macro:
    subject_type: portfolio_allocation   # no single ticker — analyzes asset class weights
    specialists: [regime, correlation, yield_curve, rebalancing]
    data_sources: [fred, treasury_yields, commodity_indices, etf_prices]

  crypto:
    subject_type: token_contract   # validates via CoinGecko / on-chain
    specialists: [tokenomics, on_chain, protocol_risk, catalyst]
    data_sources: [coingecko, etherscan, defillama]

  private_market:
    subject_type: company_name     # no ticker — unstructured data
    specialists: [due_diligence, comparable_transactions, management, risk]
    data_sources: [pitchbook, crunchbase, manual_uploads]
```

**Level 2 — Investor strategy (within an asset class):**
Same as today — scoring criteria, weights, thresholds, prompts. Each strategy declares which asset class it belongs to.

```
strategies:
  buffett-munger:
    asset_class: public_equity     # ← uses equity specialists + ticker validation
    criteria: [moat_durability, management_quality, ...]

  all-weather:
    asset_class: macro             # ← uses macro specialists + allocation validation
    criteria: [regime_resilience, correlation_balance, ...]
```

**What actually needs to change (minimal):**

1. `analyze` entry point — instead of hardcoded ticker validation, resolve subject type from the strategy's asset class. For public equities, still validates ticker. For macro, accepts an allocation spec or "rebalance my portfolio."
2. Specialist runner — already strategy-driven. Just needs to read `specialists` from the asset class config instead of assuming the equity roster.
3. Strategy YAML — add `asset_class: public_equity` to existing strategies (backward-compatible default).
4. New specialist agents — each new asset class needs its own set. Macro needs ~4, crypto needs ~3. These are the real work.

**Key insight:** The orchestration layer (spawn → parallel → synthesize) doesn't change. The prompts are what make each specialist behave differently, not the code. The only hard code change is the entry point subject validation.

---

- **Multi-LLM.** Owlfolio is Claude-only by design. No LiteLLM / OpenAI / Ollama backends. Adding them dilutes prompt engineering and complicates the Agent SDK assumptions baked into specialists/synthesis. The deliberate scope choice keeps the codebase small and prompt-tuning coherent.
- **Robo-advising / order placement.** Owlfolio records what *you* tell it you did. It does not place orders, integrate with brokerages for execution, or auto-trade. The decision stays with you; the tool stays a research assistant.
- **Tick-level / real-time price feeds.** yfinance + LLM-fallback are sufficient for the strategy-driven workflow (analysis is slow, prices are an input not a signal). Real-time feeds would imply a different product.

---

## Testing

276 tests across 12 test files, all passing. Run with:

```bash
pytest tests/ -q
```

Test surfaces, per the work in this phase:

- `tests/test_strategy_loader.py` — two-zone schema, both zones, per-strategy validation, `extra='ignore'` lenience.
- `tests/test_specialists.py` — runner + synthesis + add-on injection + JSON parsing.
- `tests/test_discovery.py` — agentic discovery prompt building, JSON parsing, ticker materialization, MCP tool surface lockdown.
- `tests/test_candidates.py` — schema, FK cascade, import operations, CSV parsing, list-name validator.
- `tests/test_activity.py` — specialist_findings + task_runs persistence, cascade behavior, unified feed shape + filtering, addon-run rendering.
- `tests/test_tasks.py` — `_validate_owlfolio_command` (the `watchlist check` incident pin) + add_task end-to-end.
- `tests/test_daemon.py` — task_runs lifecycle across all four exit paths (success, non-zero, timeout, unhandled exception).
- `tests/test_mcp.py` — tool registry + chat-agent surface contract + no-Bash defense-in-depth checks.
- `tests/test_web.py`, `tests/test_cli.py`, `tests/test_db.py`, `tests/test_onboarding.py` — surface-specific coverage.
