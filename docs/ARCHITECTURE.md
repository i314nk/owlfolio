# Owlfolio -- Architecture Document

*Updated: 2026-04-28*
*Status: Phase 3d complete (two-zone strategies, candidate lists, audit feed)*

---

## Vision

An open-source, methodology-driven investment research agent that runs the full lifecycle: source candidates, research, value, size, decide, audit. The investing philosophy is defined as configuration, not code. Ships with 7 preset strategies (Buffett, Graham, Lynch, Terry Smith, and more). Bring your own methodology.

**One-liner:** "Your investment philosophy, automated."

---

## Architecture Overview

```
+------------------------------------------------------+
|                  USER INTERFACE                       |
|  CLI (owlfolio) | Web UI (owlfolio serve) | Chat       |
+------------------------------------------------------+
|              SPECIALIST SUBAGENTS                     |
|  Strategy YAML defines specialist roster (3-5 each)   |
|  Parallel execution via Agent SDK                     |
|  Synthesis agent owns final decision                  |
+------------------------------------------------------+
|              METHODOLOGY ENGINE                       |
|  Reads strategy YAML (two-zone shape)                 |
|  Zone 1: criteria/tiers/thresholds/sizing (typed)     |
|  Zone 2: prompts.{synthesis, discovery, specialists}  |
+---------------+---------------+---------------------+
|  Discovery   | Specialists   | Add-ons   | Portfolio  |
|  + Import    | (per-strat)   | (Shariah) | Module     |
|              |               |           |            |
|  find        | financial     | shariah   | Holdings   |
|  import      | moat          | esg*      | Performance|
|  lists       | risk          | insider*  | Snapshots  |
|  analyze-list| management    |           | Watchlist  |
|              | etc.          |           | Alerts     |
+--------------+-----------+---+-----------+------------+
|                   DATA LAYER                          |
|  Web Search (Agent SDK) | yfinance (+ LLM fallback)  |
+------------------------------------------------------+
|              STATE LAYER                              |
|  SQLite: holdings, decisions, watchlist, analyses,    |
|          specialist_findings, candidate_lists,        |
|          candidates, alerts, snapshots, memory,       |
|          scheduled_tasks, task_runs                   |
+------------------------------------------------------+
|              DAEMON (optional)                        |
|  Cron-based scheduled tasks, alert generation,        |
|  performance snapshots, task_runs history             |
+------------------------------------------------------+
```

*Add-ons marked with * are planned, not yet implemented.*

---

## Specialist Subagent Architecture (Phase 3a)

The old plugin pipeline (Phase 1-2) has been replaced with independent specialist subagents. Each strategy defines its own specialist roster in YAML.

### How It Works

```
owlfolio analyze TICKER
  |
  1. Load strategy YAML -- read specialist roster
  2. Prepare shared context (ticker, strategy, brief)
  3. Spawn specialists in parallel (Agent SDK)
  4. Each specialist:
     - Has tools: web_search
     - Independently fetches data relevant to its role
     - Returns structured findings (Pydantic)
  5. Synthesis agent combines all specialist outputs
  6. Final decision: BUY / WATCH / PASS with reasoning
```

### Strategy-Driven Roster

Each strategy defines 3-5 specialists tailored to its philosophy. Each
specialist is a self-contained prose block under `prompts.specialists.<name>`
in the strategy YAML — sources are folded inline:

```yaml
# buffett-munger.yaml (excerpt)
prompts:
  specialists:
    financial_analyst: |
      Analyze {COMPANY} ({TICKER})'s earnings quality, balance sheet
      strength, cash flow, and capital allocation. ...
      Sources to check first:
        - https://stockanalysis.com/stocks/{TICKER}/financials/

    moat_analyst: |
      Score competitive advantages on the strategy's criteria
      (switching_costs, network_effects, pricing_power, ...). ...

# deep-value.yaml (excerpt)
prompts:
  specialists:
    balance_sheet_analyst: |
      Calculate NCAV (current assets minus ALL liabilities) and tangible
      book value. Apply Graham-style haircuts. ...
    catalyst_analyst: |
      Identify concrete, time-bound catalysts for price reversion. ...
    value_trap_analyst: |
      Investigate value-trap indicators (secular decline, accounting
      issues, management problems, book-value erosion). ...
```

The `{TICKER}` and `{COMPANY}` placeholders are substituted at dispatch
time. See `docs/STRATEGY_GUIDE.md` for the full prompt-corpus reference.

### Key Files

| File | Purpose |
|------|---------|
| `src/specialists/runner.py` | Spawns specialists in parallel via Agent SDK |
| `src/specialists/synthesis.py` | Synthesis agent -- combines specialist outputs into final decision |
| `src/specialists/schemas.py` | Pydantic output schemas for specialist findings |
| `src/specialists/addons.py` | Add-on specialist pattern (Shariah, Review, News Pulse) |

### What Was Removed (Phase 3a cleanup)

The following old modules were deleted when the specialist architecture replaced the plugin pipeline:

- `src/data/edgar.py` -- EDGAR connector (specialists use web search instead)
- `src/data/fundamentals.py` -- fundamentals aggregator
- `src/modules/valuation.py` -- mechanical formula evaluation
- `src/modules/decision.py` -- mechanical decision rules
- `src/data/xbrl_tags.py` -- XBRL tag mapping
- `src/modules/screener.py` -- legacy Finviz screener (replaced by `find` / `import`)
- Plugin system (`research.plugins` in YAML, `ResearchPluginInput/Output`, plugin registry)

### Synthesis Agent

The synthesis agent receives all specialist outputs and produces the final analysis. It does NOT fetch new data -- it reconciles, weighs, and decides. The synthesis agent owns the full decision (no mechanical formulas).

### Add-on Specialists

Add-on specialists come in two flavours:

**Strategy-agnostic** (e.g. Shariah): same rules regardless of investment
strategy. No previous-analysis context needed.

**Strategy-aware** (e.g. Review, News Pulse): reference the active
strategy's criteria and the most recent saved analysis for the ticker.
Their prompts contain `{PREVIOUS_ANALYSIS}` which `run_addon()` resolves
at runtime with thesis, key risks, bull/bear case, and specialist scores.

Two invocation paths:

**1. Bundled with full analysis** — `owlfolio analyze AAPL --shariah` (or
the chat agent's `analyze` MCP tool with `shariah=true`). Runs the full
strategy pipeline (3-5 specialists + synthesis) AND the addon specialist.
Use when you want both an investment decision and the addon verdict.
~5 minutes; full BUY/WATCH/PASS in `decision`.

**2. Standalone (addon-only)** — `owlfolio shariah AAPL` (CLI) or the
`run_addon(addon_name, ticker)` MCP tool. Runs ONLY the addon specialist —
no strategy pipeline, no synthesis. Use when the user just wants the
verdict. ~30 sec to ~2 min depending on the addon. Persists as a degenerate
analysis with `decision='N/A'` and `quality_tier='addon'` so it shows up
in the Activity feed alongside full analyses with a `#NN` reference.

**Registered addons:**

| Addon | CLI | Strategy-aware | Purpose |
|-------|-----|---------------|---------|
| `shariah` | `owlfolio shariah TICKER` | No | AAOIFI Shariah compliance check |
| `review` | `owlfolio review TICKER` | Yes | Quarterly review vs saved thesis |
| `news` | `owlfolio news TICKER` | Yes | News pulse since last analysis |

The single source of truth for which addons are runnable is
`ADDON_REGISTRY` in `src/specialists/addons.py`. Adding a new addon
(ESG, Insider trading, etc.) = registering it there + dropping the
prompt body in. CLI + MCP discover registered addons automatically.

---

## Strategy-as-Config

The core innovation. Every investment decision flows from the active strategy YAML.

### Strategy YAML structure (two-zone schema, current)

Every strategy YAML has two clearly-separated zones. The full schema
reference lives in `docs/STRATEGY_GUIDE.md`; the high-level shape:

**Zone 1 — structured contract** (typed Pydantic objects, machine-readable):

| Field | Required? | Purpose |
|---|---|---|
| `name`, `description`, `summary`, `author` | required | Identity |
| `criteria` | **required** | List of `{name, weight}` — synthesis fills `criteria_scores` keyed on these names. Weights MUST sum to 1.0. |
| `tiers` | optional | Tier name → required return rate (or `null` for "don't buy"). Names are free-form per strategy. |
| `thresholds` | optional | Score cutoffs (`wide` / `narrow`) that map `weighted_score` to a tier. |
| `position_sizing` | optional | Max positions, sizing tiers/ranges, cash reserve. Numeric only. |
| `display` | optional | CLI value labels (cosmetic — `"Owner Earnings"` vs `"PEG Fair Value"`). |
| `llm_overridable` | optional | Numeric knobs synthesis can adjust within bounds. Prose for *when to adjust* lives in Zone 2. |

**Zone 2 — prompt corpus** (one prose block per LLM consumer):

| Field | Required? | Read by |
|---|---|---|
| `prompts.synthesis` | **required (>=50 chars)** | Synthesis agent — load-bearing analysis prompt |
| `prompts.discovery` | optional | Discovery agent (`owlfolio find`) — universe + biases + avoid-list |
| `prompts.specialists.<name>` | optional | Each specialist sees only its own prose block (sources folded inline) |

Removed in earlier cleanups (no consumers): `criteria_anchor` (split into
`criteria`+`tiers`+`thresholds`), `valuation` (folded into `prompts.synthesis`),
`decisions` (same), `screening` (Finviz screener removed), `research.plugins`,
`monitoring`, `reporting`, `fundamentals`, `specialists.<name>.role` +
`sources` (folded into `prompts.specialists.<name>` as one prose block).

### Available Strategies (7 total)

| # | Strategy | Inspired By | Description |
|---|----------|-------------|-------------|
| 1 | `deep-value` | Graham / Schloss | Statistical bargains below tangible book value |
| 2 | `buffett-munger` | Buffett / Munger | Wonderful businesses at fair prices |
| 3 | `quality-compounder` | Terry Smith | Highest-quality companies at fair prices (FCF-based) |
| 4 | `100-bagger` | Chris Mayer | Small compounders held for decades |
| 5 | `garp` | Peter Lynch | Growth at a reasonable price (PEG < 1.0) |
| 6 | `growth` | Lynch / Fisher | Fast growers (PEG < 1.5, Rule of 40) |
| 7 | `dividend-income` | Aristocrat investing | Reliable growing dividends |

---

## Web UI (Phase 3b — Complete)

FastAPI + Tailwind CSS + htmx + Alpine.js. Black/blue theme, OpenAI-style chat-centered layout. Responsive across mobile (< 640px), tablet (640-1024px), and desktop -- sidebar becomes full-width overlay on mobile, chat area adapts to available width, all touch targets meet 44px minimum.

```bash
owlfolio serve    # Start web UI at http://localhost:8000
```

### Features (current state)

- **Full Claude Agent SDK chat integration** — WebSocket-based streaming at `/ws/chat` with Claude Opus 4.7 + adaptive extended thinking
- **Token-level streaming** — live typing cursor with `text_delta` events
- **Specialist progress card** — per-specialist status (Queued → Analyzing → Done/Error) with progress bar during `analyze` runs
- **Thinking indicator** — elapsed time counter during extended thinking
- **Strategy selector dropdown** with all 7 presets + custom strategy option
- **Add-on agents panel** (Shariah toggle; ESG/Insider coming soon)
- **Sidebar drawer with 6 tabs:**
  - Portfolio — held positions with htmx-polled live prices (every 30s)
  - Watchlist — tracked tickers with buy-zone prices
  - Lists — candidate lists from `find`/`import` with analysis progress
  - Activity — unified audit trail (analyses, decisions, lists, task runs) with type-filter pills
  - Alerts — unread system notifications with badge dot
  - Schedule — cron tasks with daemon status indicator + start/stop buttons
- **Welcome screen** with 8 suggestion chips for quick-start prompts
- **Structured markdown rendering** — decision pills (BUY/WATCH/PASS), ticker highlighting, tables, code blocks
- **Tool use display** — labeled tool invocations shown inline during chat
- **Strategy-change server push** — UI updates when strategy is switched mid-session

### Key Files

| File | Purpose |
|------|---------|
| `src/web/app.py` | FastAPI application, routes, WebSocket handler, Agent SDK chat integration |
| `src/web/templates/dashboard.html` | Main template (htmx + Alpine.js) |
| `src/web/templates/partials/` | Tab content templates (portfolio, watchlist, lists, activity, alerts, tasks, daemon_status) |
| `src/web/static/style.css` | Tailwind-based styling |

---

## SQLite Persistence

All state is stored in a single SQLite database (`data/portfolio.db`).

### Tables (13 total)

| Table | Purpose |
|-------|---------|
| `holdings` | Portfolio positions (ticker, shares, cost basis, date, account, strategy, notes) |
| `decisions` | Decision journal (every BUY/SELL/PASS with reasoning, strategy, analysis_id) |
| `watchlist` | Tracked tickers with buy zone prices and strategy |
| `analyses` | Saved analysis results (decision, buy_price, quality_tier, weighted_score, thesis, bull/bear cases, key_risks, overrides) |
| `specialist_findings` | Per-specialist analysis artifacts (FK cascade from analyses — summary, key_findings, data_sources, flags, confidence, extra_json) |
| `candidate_lists` | Discovery/import collections (name, strategy, source type, note) |
| `candidates` | Ticker entries in lists (FK from candidate_lists — company_name, sector, market_cap, metrics_json, analyzed flag, analysis_id) |
| `scheduled_tasks` | Cron job definitions (name, command, schedule, timezone, enabled, last_run, last_result) |
| `task_runs` | Daemon execution history (started_at, finished_at, exit_code, stdout/stderr excerpts) |
| `alerts` | Price alerts, task results, watchlist notifications (type, ticker, message, read status) |
| `snapshots` | Portfolio history snapshots (total_value, total_cost, cash, holdings_json, benchmark_value) |
| `memory` | Persistent chat memory (category, content, ticker) |

### Key Files

| File | Purpose |
|------|---------|
| `src/db/schema.py` | Table definitions and migrations |
| `src/db/operations.py` | All CRUD operations |

---

## Memory System

SQLite-based memory table. Memories are injected into the chat agent's system prompt on startup, giving it persistent context across sessions.

---

## Candidate-list pipeline

Replaces the legacy Finviz screener. Two complementary paths feed a unified
candidate-list table that the analyze pipeline consumes:

- **Agentic discovery (`owlfolio find`).** Reads the strategy's
  `prompts.discovery` brief and uses WebSearch + WebFetch + a scoped MCP
  surface (`validate_ticker`, `get_ticker_summary`) to compile candidates.
  Slow (3-10 min), costs API credits, on-vision for the "AI analyst on
  staff" goal. Each ticker is yfinance-validated to drop hallucinations.
  Lives in `src/agents/discovery.py`.
- **External import (`owlfolio import`).** Takes whatever ticker list the
  user has — CSV file, comma/newline-separated string, file path — and
  validates each ticker against yfinance to catch typos. Lives in
  `src/operations/candidates.py::import_candidates`.

Both paths persist as `candidate_lists` rows with `source = 'agentic'` or
`'import'`. `owlfolio analyze-list NAME` then iterates the list's
candidates with a hard concurrency cap (default 2) — without this cap, a
25-ticker batch with 3-5 specialists per ticker would launch 75-125 parallel
LLM requests and trip the rate limiter.

The chat agent reaches all of this through MCP tools (`find_candidates`,
`import_candidates`, `list_candidate_lists`, `get_candidate_list`,
`analyze_candidate_list`, `delete_candidate_list`) — never raw SQL.

---

## Activity feed + audit story

Every meaningful action lands in a unified chronological feed across four
source tables:

- `analyses` — every full pipeline run, plus addon-only runs (Shariah)
  saved as degenerate analyses with `decision = 'N/A'`.
- `decisions` — recorded buy/sell/watchlist mutations.
- `candidate_lists` — every `find` or `import` event.
- `task_runs` — every daemon-fired scheduled-task execution, with start
  time, exit code, and stdout/stderr excerpts (capped at 2KB each).

The `get_activity` MCP tool unions these into a single stream the chat
agent and the Web UI's Activity tab both consume. Each row carries:

| Field | Example | Notes |
|---|---|---|
| `type` | `analysis` / `list` / `decision` / `task_run` | For pill colors + filter pills |
| `reference` | `#42` / `d#7` / `r#12` / list-name | The token the user can quote in chat |
| `link_to` | `{tool: "get_analysis", args: {id: 42}}` | What MCP call to make for detail |

Read-only tool calls (`get_portfolio`, `list_strategies`, `get_price`)
deliberately don't show up here — if the action doesn't change state or
produce a structured artifact, it's not an activity.

### Persisted specialist findings

Every analysis also persists its per-specialist findings into
`specialist_findings` (sibling table, FK cascade from `analyses`). Common
fields go into typed columns; specialist-specific extras (margin numbers,
moat-score breakdowns, Shariah ratios) JSON-encode into `extra_json`. This
unlocks two capabilities the synthesis-result-only model can't:

1. **Audit "why BUY?"** Drill into a `#NN` analysis and see what
   `moat_analyst` actually found, not just the 3-sentence thesis.
2. **Cheap re-synthesis.** If the synthesis prompt is tuned later,
   re-run synthesis against saved findings without re-paying for the
   (expensive) specialist research phase. Specialists are 3-5 parallel
   Opus calls with WebSearch — that's what costs.

`get_analysis(id)` returns the synthesis result with findings inlined
(default `with_findings=True`). The agent uses this when the user quotes
a `#NN` and asks follow-ups like "what did `moat_analyst` flag?".

---

## Owlfolio Agent Architecture

Owlfolio provides four interaction modes:

1. **Command mode** — Direct CLI commands (`owlfolio analyze AAPL`, `owlfolio portfolio`)
2. **Chat mode** — Conversational interface (`owlfolio chat`) backed by Claude Opus 4.7 with tool access
3. **Web mode** — Browser-based chat interface (`owlfolio serve`) with full Agent SDK integration and token streaming
4. **Daemon mode** — Background scheduler (`owlfolio daemon`) for scheduled tasks and alerts

### CLI Commands (25+)

| Command | Description |
|---------|-------------|
| `owlfolio setup` | First-time setup (auth, strategy, test) |
| `owlfolio analyze TICKER` | Full specialist-driven analysis |
| `owlfolio analyze TICKER --shariah` | Analysis with Shariah compliance check |
| `owlfolio find` | Agentic discovery for the active strategy (replaces the legacy Finviz screener) |
| `owlfolio import SOURCE --name LIST` | Import a CSV / inline ticker string into a named candidate list |
| `owlfolio analyze-list NAME` | Batch-analyze every ticker in a list (concurrency-capped) |
| `owlfolio compare TICKER1 TICKER2` | Side-by-side comparison (uses saved analyses) |
| `owlfolio portfolio` | View holdings with live P&L |
| `owlfolio add TICKER SHARES PRICE` | Record a purchase |
| `owlfolio sell TICKER SHARES PRICE` | Record a sale |
| `owlfolio watch TICKER` | Add to watchlist |
| `owlfolio snapshot` | Take a portfolio performance snapshot |
| `owlfolio performance` | Portfolio performance over time |
| `owlfolio strategy --list` | List all 7 preset strategies |
| `owlfolio strategy --use NAME` | Switch active strategy |
| `owlfolio strategy --info NAME` | Detailed strategy summary |
| `owlfolio config show` | View active strategy config |
| `owlfolio config validate` | Validate strategy file |
| `owlfolio analyses` | View saved analysis history |
| `owlfolio history` | Decision journal |
| `owlfolio alerts` | Recent alerts and task results |
| `owlfolio tasks` | View scheduled tasks |
| `owlfolio schedule NAME CMD CRON` | Create a scheduled task |
| `owlfolio daemon` | Run background daemon |
| `owlfolio chat` | Chat with AI portfolio manager |
| `owlfolio shariah TICKER` | Standalone Shariah compliance check (persists as a `#NN` audit row) |
| `owlfolio review TICKER` | Quarterly review — light re-eval of latest earnings vs saved thesis |
| `owlfolio news TICKER` | News pulse — scan for material changes since last analysis |
| `owlfolio serve` | Start web UI |
| `owlfolio status` | System status (auth, strategy, version) |

### Entry Points

- CLI: `owlfolio` (primary), `agent` (legacy alias)
- Web: `owlfolio serve` (FastAPI on port 8000)

### Daemon (Optional)

The daemon (`owlfolio daemon`) polls the SQLite task table and executes commands on their cron schedules. It is optional -- all commands work without the daemon running. The daemon also generates alerts (price alerts, task results) written to the `alerts` table, visible in CLI (`owlfolio alerts`) and web UI.

### Permissions Model

- The chat agent can read portfolio state, run analyses, and answer questions
- Buy/sell recording requires explicit CLI commands (`owlfolio add`, `owlfolio sell`)
- The daemon executes only pre-registered scheduled commands

---

## Security Model

Owlfolio is an open-source tool that runs on the user's own machine. The
threat model is therefore "single-user local app" by default — the same
trust contract as `git`, `pip`, or any other CLI tool the user installs.
The user owns the host; the agent runs with their permissions.

That said, two real risks remain even on a personal install:

1. **Prompt-injection via web content.** Specialist subagents fetch arbitrary
   web pages (`stockanalysis.com`, SEC EDGAR, news search results, competitor
   IR). A malicious page can contain "ignore previous instructions and …"
   payloads that an LLM may obey. Without isolation, a compromised specialist
   shares a process and credentials with everything else.

2. **Accidental exposure when sharing.** A user who wants to show Owlfolio to
   someone else (LAN demo, Tailscale, a friend) may bind to `0.0.0.0` without
   realizing the chat agent has Bash + `bypassPermissions` and no app-layer
   auth. That single change turns the local tool into a remote shell.

Owlfolio's mitigations focus on keeping the install simple while
reducing these risks for the single-user case.

### Execution Mode: Native

`pip install owlfolio && owlfolio serve` runs as the user with full
in-process specialist execution. No extra infrastructure. This is the
standard install path, appropriate for a local laptop install used by
the owner only.

### Chat agent tool surface — bounded by MCP, not by `Bash`

The chat agent (CLI and Web both) does **not** have shell access. Its
tool surface is the **owlfolio MCP server** (`src/mcp_server.py`) plus
`WebSearch` and `WebFetch`. The MCP server exposes 39 typed tools
covering every chat-agent need:

- **Read-only (18)** — `get_portfolio`, `get_watchlist`, `get_alerts`,
  `list_tasks`, `get_daemon_status`, `list_strategies`,
  `get_active_strategy`, `get_strategy_info`, `list_specialists`,
  `list_analyses`, `get_latest_analysis`, `get_analysis`, `get_activity`,
  `list_decisions`, `compare_tickers`, `list_memories`,
  `get_doctor_report`.
- **Analysis (5)** — `analyze` (full specialist + synthesis pipeline),
  `get_price` (spot price, no analysis), `run_addon` (standalone add-on
  specialist), `list_addons`, `quick_research` (bounded WebSearch for
  general finance questions).
- **Candidate lists (6)** — `find_candidates`, `import_candidates`,
  `list_candidate_lists`, `get_candidate_list`, `analyze_candidate_list`,
  `delete_candidate_list`.
- **Mutation (10)** — `add_holding`, `sell_holding`, `add_to_watchlist`,
  `remember`, `forget`, `delete_activity_event`, `mark_alerts_read`,
  `schedule_task`, `unschedule_task`, `switch_strategy`.

`Bash`, `Read`, `Glob`, `Grep`, `Edit`, `Write`, `NotebookEdit` are all
in the chat agent's `disallowed_tools`. A prompt-injection attack via
fetched web content can no longer escalate to host shell — the worst
case is the attacker invokes whatever read-only MCP tools already
exist, which can't reach credentials or modify state outside the
explicit mutation tools (which themselves validate their inputs).

Each MCP tool calls a domain function in `src/operations/`. The same
domain functions back the CLI commands in `src/main.py`, so the CLI
and the chat agent share a single source of truth. Inputs are
validated at the operation layer:

- Tickers must match `^[A-Z][A-Z.\-]{0,9}$` — rejects shell metachars,
  path traversal, anything malformed.
- Strategy names must match `^[a-z0-9][a-z0-9\-]{0,29}$` — case-sensitive,
  rejects `Buffett-Munger`, `../etc/passwd`, etc.
- Numeric inputs (shares, prices) are checked for positivity.

Tests in `tests/test_mcp.py` pin the contract: any future PR that adds
`Bash` back to the chat agent's `allowed_tools`, removes the MCP server
registration, or weakens the input validators will fail CI.

### What remains in scope for the chat agent's authority

After the MCP refactor, the chat agent can:

- Read every part of the user's portfolio, watchlist, decision journal,
  saved analyses, alerts, scheduled tasks, and memory.
- Run new analyses (which spawn the specialist pipeline).
- Record trades, watchlist additions, memory entries, and scheduled
  tasks **when the user explicitly asks**.
- Switch the active strategy.
- Search the web and fetch web content (still required for the
  `analyze` pipeline and for ad-hoc lookups).

It cannot:

- Read arbitrary files on the host.
- Run shell commands.
- Edit any file (including its own CLAUDE.md).
- Install packages, start/stop the daemon directly (the daemon must be
  controlled via the CLI, deliberately), or modify infrastructure.

This is the contract the project commits to for Owlfolio's chat agent.
It is intentionally narrower than what the Claude Agent SDK allows by
default; that's the point.

### Sharing Owlfolio with someone else

The recommended path is **Tailscale**:

1. `tailscale up` and share your machine with the person.
2. They open `http://your-machine:8000` over the Tailscale network.

Tailscale handles identity (only your tailnet members can reach the URL).
No auth middleware, rate limiters, or credential vault needed. Binding to
`0.0.0.0` without a network-layer gate is **not** recommended and the
docs say so explicitly.

### First-Run Experience

The install is abstracted behind a single installer and a few CLI
commands so users never have to know about `pip` extras or where
credentials live. The design principle: the user types one command per
intent.

| User intent | Command |
|---|---|
| Set up the tool from scratch | `./install.sh` |
| Start the web UI | `owlfolio serve` |
| Restart the web UI to pick up code changes | `owlfolio serve --restart` |
| Stop the web UI | `owlfolio serve --stop` |
| Diagnose anything that's not working | `owlfolio doctor` |

`install.sh` (~250 lines of bash) handles: Python detection, venv
creation, `pip install -e ".[web]"`, and credential discovery. The
same script gets the user from "I just cloned the repo" to "the tool
works" in one step.

`owlfolio doctor` (in `src/main.py`) prints one colored health report
covering credentials, active strategy, portfolio DB state, the Web UI
port, and daemon status. It's the first thing the user is told to run
when anything looks wrong, so support requests collapse to "paste the
doctor output."

`owlfolio setup` was also tightened: it auto-creates `methodology.yaml`
from a chosen preset on first run, so first-run users don't hit a
"strategy file not found" wall.

When the user runs `owlfolio serve --host 0.0.0.0` the CLI prints a
yellow warning explaining that this exposes a chat agent to anyone who
can reach the port, and points to the Tailscale recommendation. The bad
path stays available -- refusing to bind would be condescending -- but
it's clearly flagged.

---

## Authentication (Dual-Backend)

The LLM provider uses two backends with automatic selection:

**Primary: Claude Agent SDK** -- Uses Claude Code's authentication infrastructure. Works with Claude Pro/Max subscription tokens. No API key needed.

Auth sources (first match wins):
1. `CLAUDE_CODE_OAUTH_TOKEN` env var
2. OneCLI credential proxy (`ONECLI_URL` env var)
3. `~/.claude/.credentials.json` -- OAuth token from Claude Code login

**Fallback: Raw Anthropic SDK** -- Uses `api.anthropic.com` directly with `ANTHROPIC_API_KEY`. For users with API billing accounts.

Both paths use the same `complete()` / `complete_structured()` interface -- callers never know which backend is active. See `src/llm/provider.py`.

---

## Market Data

Owlfolio reads prices and basic company info via a **two-tier** path in
`src/data/prices.py::get_price_data()`:

1. **yfinance first** — `yf.Ticker(ticker).info` for `currentPrice` /
   `regularMarketPrice`, market cap, sector, industry, currency, exchange,
   next earnings date.
2. **LLM web-search fallback** — if yfinance returns no price, an Agent
   SDK `query` (Haiku, `WebSearch` tool only) asks for the current price
   as JSON. The fallback is slow and costs API credits, but it covers
   non-US tickers, ADRs, and post-Yahoo-breakage gaps without the
   pipeline crashing.
3. **Empty `PriceData`** as last resort — `price=0.0`, `name=ticker`,
   no exception. Callers must check for `price > 0` before acting.

The same `yf.Ticker(...).info` call is reused as the **hallucination
filter** in `src/agents/discovery.py::yfinance_validate()` — anything
without price/mcap/name is dropped from the candidate list, and from
`owlfolio import` unless `--no-validate` is passed.

### Reliability tradeoffs

**yfinance is the cheapest source, not the most reliable.** It is an
*unofficial scraper* of Yahoo Finance's undocumented endpoints. Yahoo
can change response shapes, throttle, or break it without notice — and
has, repeatedly. The maintainer ships fixes after each break, but you
eat the downtime in between.

Failure modes you'll hit in practice:

- Quiet zeros / `None` for `currentPrice` on illiquid names, ADRs, OTC
  stocks, or right at market open
- `regularMarketPrice` lagging the real quote by 15-20 min (Yahoo's free
  tier delays everything except top US listings)
- Rate-limit 429s during bursts (the `analyze-list` concurrency cap of
  2 helps but doesn't eliminate this)
- Sudden API breakage that requires `pip install -U yfinance` to recover
- Wrong sector/industry strings, or missing them entirely for non-US
  listings

### Why we accept it anyway

This is single-user research, not trading. Prices are an *input to slow
LLM analysis*, not a tick-by-tick signal. The web-search fallback masks
the most common breakage mode (yfinance returns nothing). Free + no API
key + broadest coverage matters more than tick precision for the
strategy-driven workflow.

The reliability gap matters more for the **watchlist daemon** (which
polls prices on a schedule and could quietly stop working) than for
ad-hoc analysis runs.

### Hardening options (not currently shipped)

If you want stronger guarantees:

- **Add a second free provider as a pre-LLM fallback.** Finnhub free
  tier or Alpha Vantage free tier — both documented APIs with rate
  limits, both require an env-var API key. Insert between steps 1 and 2
  of the lookup.
- **Surface price staleness in the daemon.** Log when a price came from
  the fallback or the empty-`PriceData` branch, so silent yfinance
  breakage shows up in `logs/agent.log` instead of degrading invisibly.
- **Pay for a real feed** if running this against money you care about:
  - **Broker APIs** (IBKR, Schwab, Alpaca) — real-time, authenticated,
    contractual SLAs. Best fit if the user already has a brokerage.
  - **Paid market-data APIs** (Polygon.io, IEX Cloud, Tiingo) — proper
    REST, documented rate limits, ~$10-50/mo for hobby tier.

None of these are wired today. yfinance + LLM-fallback is the deliberate
default for an open-source single-user tool with no required API keys.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.12+ |
| Packaging | `uv` |
| LLM | Claude only — Agent SDK (Pro/Max) or Anthropic SDK (API key). Specialists + synthesis run on Opus 4.7. |
| Database | SQLite |
| Prices | yfinance (with LLM-WebSearch fallback — see *Market Data* below) |
| Candidate sourcing | Agentic discovery agent + `owlfolio import` (the legacy Finviz screener was removed 2026-04) |
| Config | PyYAML + Pydantic |
| CLI | Typer |
| Web UI | FastAPI + Tailwind CSS + htmx + Alpine.js |
| Chat | WebSocket (web), readline (CLI) |

---

## Project Structure

```
investment-agent/
+-- README.md
+-- pyproject.toml
+-- methodology.yaml            # User's active strategy
|
+-- strategies/                 # 7 preset strategies
|   +-- buffett-munger.yaml
|   +-- deep-value.yaml
|   +-- quality-compounder.yaml
|   +-- 100-bagger.yaml
|   +-- garp.yaml
|   +-- growth.yaml
|   +-- dividend-income.yaml
|
+-- src/
|   +-- main.py                 # CLI entry point (Typer)
|   +-- daemon.py               # Background task daemon
|   |
|   +-- agent/                  # Chat agent (Opus 4.7)
|   |   +-- core.py             # Agent loop, tool dispatch
|   |   +-- CLAUDE.md           # Agent system prompt
|   |
|   +-- specialists/            # Subagent architecture
|   |   +-- runner.py           # Parallel specialist spawner
|   |   +-- synthesis.py        # Synthesis agent (final decision)
|   |   +-- schemas.py          # Pydantic output schemas
|   |   +-- addons.py           # Add-on specialists (Shariah, etc.)
|   |
|   +-- strategy/               # Strategy loading and validation
|   |   +-- loader.py
|   |
|   +-- modules/                # Remaining modules
|   |   +-- onboarding.py       # Conversational + quick-wizard strategy creation
|   |
|   +-- operations/             # Domain logic (shared by CLI + MCP)
|   |   +-- activity.py         # Unified activity feed
|   |   +-- alerts.py           # Alert management
|   |   +-- analyses.py         # Analysis history queries
|   |   +-- analysis.py         # Full specialist pipeline orchestration
|   |   +-- candidates.py       # Candidate list import/management
|   |   +-- memory.py           # Chat memory CRUD
|   |   +-- portfolio.py        # Holdings CRUD
|   |   +-- research.py         # quick_research bounded WebSearch
|   |   +-- strategies.py       # Strategy listing/switching
|   |   +-- system.py           # Doctor report, system status
|   |   +-- tasks.py            # Scheduled task management
|   |   +-- watchlist.py        # Watchlist CRUD
|   |
|   +-- agents/                 # Standalone agent flows
|   |   +-- discovery.py        # Agentic discovery (owlfolio find)
|   |
|   +-- data/                   # Data connectors
|   |   +-- prices.py           # yfinance wrapper + LLM fallback
|   |
|   +-- db/                     # SQLite persistence
|   |   +-- schema.py           # Table definitions (13 tables)
|   |   +-- operations.py       # All CRUD operations
|   |
|   +-- llm/                    # LLM provider
|   |   +-- provider.py         # Dual-backend (Agent SDK + raw API)
|   |
|   +-- web/                    # Web UI
|   |   +-- app.py              # FastAPI application, WebSocket chat, Agent SDK integration
|   |   +-- templates/          # HTML templates (htmx + Alpine.js)
|   |   +-- templates/partials/ # Tab content (portfolio, watchlist, lists, activity, alerts, tasks)
|   |   +-- static/             # CSS
|   |
|   +-- ui/                     # CLI display helpers
|
+-- tests/                      # 276 tests across 12 files
+-- docs/                       # Documentation
+-- logs/                       # Rotating log files
```

---

## Development Phases

| Phase | Status | Summary |
|-------|--------|---------|
| 1 | COMPLETE | Core engine: 7 strategies, plugin pipeline, strategy-neutral architecture |
| 1.5 | COMPLETE | Logging, structured outputs, web search, error isolation |
| 2 | COMPLETE | SQLite, portfolio, chat agent, daemon, memory, alerts (Finviz screening since removed in 3d) |
| 3a | COMPLETE | Specialist subagent architecture (replaced plugins) |
| 3b | COMPLETE | Web UI — FastAPI + htmx + WebSocket chat with full Agent SDK integration, token streaming, specialist progress card, 6 sidebar tabs |
| 3c | COMPLETE | Add-on specialist pattern (Shariah compliance; ESG/Insider planned) |
| 3d | COMPLETE | Two-zone strategy YAML restructure, candidate-list pipeline (agentic discovery + import), activity feed with unified audit trail, specialist findings persistence |

### What's Next

See `docs/FUTURE_PLAN.md` for the tiered roadmap. Highlights:

**Tier 1** (extends audit + strategy): Interactive Plotly chart tool, portfolio analytics dashboard (quantstats + agent narrative), quarterly portfolio report generator, re-synthesis from saved findings, thesis drift detection.

**Tier 2** (new surfaces): Strategy filters across all views (watchlist/portfolio/activity), ESG/Insider add-on specialists, multi-account support, form-based strategy editor.

**Tier 3** (bigger scope): Strategy hierarchy / multi-asset-class support (macro, crypto, private markets), backtesting engine (on hold — needs historical data API).

**Out of scope:** Multi-LLM support. Owlfolio is Claude-only by design — every
specialist and the synthesis agent run on the Claude Agent SDK. No LiteLLM,
OpenAI, or Ollama backends are planned.

---

## Key Design Decisions

1. **Python over TypeScript** — see the dedicated *Language Choice* section below. Short version: today the case is weak, the future case rests entirely on whether the FUTURE_PLAN measurement layer ships, and there are explicit tripwires for revisiting.

2. **YAML over TOML** -- Better multiline support, more readable for non-developers.

3. **SQLite over Postgres** -- Single-user local app. No server needed. Easy backup (single file).

4. **Specialists over plugins** -- Each specialist independently fetches AND analyses data. Strategy YAML defines team composition. More focused, less information loss than the old plugin pipeline that shared a single filing summary.

5. **CLI-first, Web-second** -- CLI shipped first. Web UI (Phase 3b) adds accessibility for non-CLI users.

6. **Free data only in core** -- No paid API dependencies. yfinance + LLM web-search fallback. See *Market Data* above for reliability tradeoffs and hardening options.

7. **Conversational config as first-class** -- `owlfolio setup` wizard is the primary onboarding path.

8. **Dual-backend LLM provider** -- Agent SDK for subscription users, raw SDK for API key users. Same interface.

9. **Strategy-as-YAML** -- Methodology is configuration, not code. The LLM adapts via strategy context injection.

10. **Add-on pattern** -- Shariah (and future ESG/Insider) works with ANY strategy via flags, not strategy-specific code.

11. **Audit trail: deferred (2026-04-25).** A structured `pipeline_runs` + `pipeline_events` table was scoped and prototyped, then rolled back. For a single-user personal tool, the existing `analyses` table (decision + thesis per run) and `logs/agent.log` (pipeline events) cover the diagnostic questions actually asked today. The full audit table earns its place when (a) the **backtesting engine** is built and needs queryable per-specialist provenance, or (b) the **daemon** starts running batch analyses where aggregate failure tracking matters. Until then, every `owlfolio analyze` writes one greppable summary line via the `owlfolio.run` logger (`grep owlfolio.run logs/agent.log`) — that's the 90%-value, 0%-maintenance version. The `on_progress` callback on `run_specialists` already exists, so a future auditor can hook in without further refactoring.

12. **One-command setup (2026-04-26).** `install.sh` collapses Python venv setup into one orchestrated step. `owlfolio doctor` is the canonical one-stop diagnostic. The principle: a user shouldn't need to know what `pip install -e ".[web]"` does just to get the tool running. See **First-Run Experience** in the Security Model section.

---

## Language Choice (Python) — honest analysis + tripwires

*Reviewed 2026-04-26. This section captures the actual reasoning so
future-you (or a contributor) doesn't re-litigate it from scratch.*

### Today's case is weak

The early framing of "Python because the financial library ecosystem
is unmatched" is **mostly aspirational**. Of the libraries declared in
`pyproject.toml`:

- **6 of the original 18 deps were already dead weight** by 2026-04
  (`apscheduler`, `edgartools`, `fredapi`, `litellm`, `simpleeval`,
  `sqlite-vec`) and were dropped — none were actually imported.
- The remaining 12 actually-used deps (`anthropic`, `claude-agent-sdk`,
  `yfinance`, `pyyaml`, `typer`, `rich`, `croniter`, `pydantic`,
  `python-dotenv`, `fastapi`, `uvicorn`, `jinja2`) **all have direct
  TypeScript equivalents.** Specifically:

  | Python | TS replacement |
  |---|---|
  | `claude-agent-sdk` | `@anthropic-ai/claude-agent-sdk` (official) |
  | `anthropic` | `@anthropic-ai/sdk` (official) |
  | `pyyaml` | `yaml` (npm) |
  | `pydantic` | `zod` |
  | `rich` | `chalk` + `cli-table3` (or `ink`) |
  | `yfinance` | `yahoo-finance2` (npm) |
  | `typer` | `commander` / `cac` |
  | `fastapi` + `uvicorn` | `hono` / `fastify` |
  | `croniter` | `cron-parser` |
  | `python-dotenv` | native `process.loadEnvFile()` (Node 20+) |
  | `jinja2` | `eta` / `nunjucks` / template literals |

So the **library-availability argument for Python is hollow** for the
current product. Today's stack — Agent SDK orchestration, FastAPI +
htmx + Alpine Web UI, SQLite for state — is essentially
language-agnostic.

### The real Python case: future-facing measurement layer

The honest reason to stay on Python is the `FUTURE_PLAN.md` measurement
layer (backtesting, portfolio analytics, correlation, exposure). The
TS ports for that domain are weak — `danfo.js` is a toy compared to
`pandas`, nothing matches `quantstats` or `vectorbt`, and the deeper
finance ecosystem (broker SDKs, paper implementations, EDGAR helpers)
is Python-first. **Doing the measurement layer in-process Python is
dramatically simpler than running a Python sidecar from a TS
orchestrator** — the sidecar is a one-time but permanent cost
(separate deploy, version pinning, IPC contract, two test harnesses).

But the measurement layer is *speculative*. It hasn't been built. If
it never lands, the Python justification dies retroactively.

### What TS would buy us

Honest list, not dismissive:

- Better end-to-end typing (Zod schemas double as API contracts AND
  browser-side types — single source of truth)
- Faster startup (~300ms Python interpreter spin-up disappears; CLI
  feels snappier)
- Cleaner Web UI story (Hono + htmx is more ergonomic than
  FastAPI + Jinja2; native template-literal HTML)
- Smaller deploy footprint
- Larger contributor pool for the orchestration / Web UI parts (TS is
  where most "bring your hobby project to a portfolio" devs live)

These are real wins. They're also **incremental, not transformational**
— none of them change what Owlfolio is or does.

### What TS would close the door on

- `pandas` / `quantstats` / `vectorbt` / `statsmodels` / `arch` /
  `PyPortfolioOpt` for the measurement layer. Either skip the layer,
  build a Python sidecar, or accept much weaker libraries.
- Jupyter as a prototyping environment ("open a notebook, try a
  backtest idea, commit it once it works"). This is uniquely Python in
  the financial-research community.
- Python-first broker SDKs (IBKR, Schwab, Alpaca all have official
  Python; TS is community-only).

### Recommendation: stay Python, set tripwires

For now, stay on Python — the cost of staying is zero (you've already
paid the Python tax), and rewriting mid-build kills momentum and
introduces regression risk for incremental gains. **But don't let this
decision calcify by default.** Two explicit tripwires for revisiting:

1. **6-month measurement-layer check.** If at least one piece of the
   measurement layer (most likely backtesting) hasn't shipped within 6
   months from this section's date, the Python case is hollow.
   Reconsider TS at that point — by then you'll have evidence about
   whether the math layer is real or aspirational.
2. **Frontend-complexity tripwire.** If a major frontend feature lands
   that needs shared types between server and browser (interactive
   charts with real-time updates, complex form state, etc.), the TS
   case strengthens significantly. Reconsider then.

If neither tripwire fires, stay Python — the costs are paid, the
benefits are real, and the rewrite is unjustified.

### If we ever do rewrite, target = TypeScript

Not Go (type system too thin for the dispatch-by-shape patterns the
MCP tools use). Not Rust (overkill for a workload that's mostly
waiting on LLM responses and SQLite). TypeScript is the natural fit:
it's where the Agent SDK lives natively, it's the same world as the
htmx/Alpine frontend, and Bun/Node performance is more than adequate
for an agent orchestrator.

Don't let "we should rewrite" turn into "we should rewrite to Rust" —
that's a different and much worse decision.

---

## Testing

276 tests across 12 test files. Key test files:

- `tests/test_specialists.py` — Specialist runner, synthesis, schemas, add-on injection (incl. strategy-aware review/news), JSON parsing
- `tests/test_strategy_loader.py` — Two-zone schema, both zones, per-strategy validation, `extra='ignore'` lenience
- `tests/test_discovery.py` — Agentic discovery prompt building, JSON parsing, ticker materialization, MCP tool surface lockdown
- `tests/test_candidates.py` — Schema, FK cascade, import operations, CSV parsing, list-name validator
- `tests/test_activity.py` — specialist_findings + task_runs persistence, cascade behavior, unified feed shape + filtering, addon-run rendering
- `tests/test_tasks.py` — `_validate_owlfolio_command` + add_task end-to-end
- `tests/test_daemon.py` — task_runs lifecycle across all four exit paths (success, non-zero, timeout, unhandled exception)
- `tests/test_mcp.py` — Tool registry + chat-agent surface contract + no-Bash defense-in-depth checks
- `tests/test_web.py` — Web UI routes and endpoints
- `tests/test_cli.py` — CLI command tests
- `tests/test_db.py` — SQLite operations
- `tests/test_onboarding.py` — Strategy creation
