# Contributor Additions

Changes made by external contributors during design/review sessions. This file exists so Claude Code can pick up context without re-reading full conversation history.

**Last Updated:** 2026-05-01

---

## 2026-04-28 — Design Session: Future Plan Overhaul + Bug Fix

### Code Change: Daemon Start Bug Fix

**File:** `src/web/app.py` (line 312)
**Problem:** `POST /api/daemon/start` used hardcoded `"python"` in the subprocess command. The system only has `python3`, and the venv python lives at `.venv/bin/python3`. Clicking "Start" in the web UI Schedule tab would silently fail.
**Fix:** Changed `"python"` to `sys.executable` — resolves to whatever Python interpreter is running the current process (the venv one when started via `owlfolio serve`).

```python
# Before:
["python", "-m", "src.main", "daemon"]

# After:
[sys.executable, "-m", "src.main", "daemon"]
```

### FUTURE_PLAN.md — Major Restructure

**File:** `docs/FUTURE_PLAN.md`

Summary of all changes made in this session:

#### Tier 1 — New Items Added

1. **Interactive chart tool (Plotly)** — Agent generates Plotly charts on demand during chat. Renders inline in htmx UI as interactive HTML. Replaces the old static "Metrics pane" idea from Tier 2. Implementation: `render_chart(chart_type, data, title)` MCP tool.

2. **Portfolio analytics dashboard** — Consolidated from THREE separate Tier 2 items:
   - Old "Portfolio analytics pane"
   - Old "Risk / correlation / exposure pane"
   - Old "Metrics pane"
   Into one unified analytics surface with quantstats metrics + agent narrative commentary.

3. **Quarterly portfolio report generator** — Agent-driven, customizable per user. Replaces simpler "PDF report generation." Agent pulls data → runs quantstats → writes narrative → generates Plotly charts → renders to PDF via Jinja2 + weasyprint.

#### Tier 1 — Item Moved Out

- **Backtesting engine** moved to Tier 3 (on hold). Requires historical data API which adds unwanted dependency. Documented hybrid approach: quantitative screening (no LLM, avoids look-ahead bias) → one-time swarm at entry → mechanical forward simulation.

#### Tier 2 — New Item Added

- **Strategy filters across all views** — Watchlist, portfolio, and activity feed gain a strategy dropdown filter. Key schema change: watchlist unique constraint from `UNIQUE(ticker)` to `UNIQUE(ticker, strategy)` so same ticker can appear under multiple strategies with different buy prices. Holdings already have `strategy` column — just needs consistent population.

#### Tier 2 — Items Removed (Absorbed)

- "Portfolio analytics pane" → absorbed into Tier 1 analytics dashboard
- "Risk / correlation / exposure pane" → absorbed into Tier 1 analytics dashboard
- "Metrics pane" → absorbed into Tier 1 Plotly chart tool

#### Tier 3 — New Item Added

- **Strategy hierarchy / multi-asset-class support** — Two-level architecture:
  - Level 1: Asset class (public_equity, macro, crypto, private_market) — defines subject type, specialist roster, data sources
  - Level 2: Investor strategy within each class (buffett-munger under public_equity, all-weather under macro, etc.)
  - Key insight: orchestration layer (spawn → parallel → synthesize) stays the same. Only the specialists and subject validation change per asset class.
  - Minimal code changes needed: (1) `validate_subject()` dispatcher replacing `validate_ticker()`, (2) asset class config in strategy YAML, (3) new specialist agents per asset class.
  - Full architecture diagram added in new "Strategy hierarchy architecture" section.

#### Tier 3 — Item Updated

- **Backtesting engine** — moved here from Tier 1 with expanded design notes on hybrid approach and bias mitigation.

### Design Decisions Made (Not Yet Implemented)

These were discussed and agreed upon but are future work:

1. **Python stays** — Considered TypeScript rewrite, decided against it. Financial library ecosystem (quantstats, pandas, vectorbt, plotly) is Python-only. Rewrite would cost 3-4 weeks for no gain.

2. **No separate orchestration layer for multi-asset** — Different asset classes just use different specialists and a subject-type validator. No new "plane" above the strategy layer needed.

3. **Daemon stays opt-in** — Already implemented: off by default, user starts via web UI Schedule tab button. Confirmed current design is correct.

4. **Backtesting on hold** — Would need historical data API (Financial Modeling Prep, SimFin, etc.). Not worth the dependency right now.

5. **LLM swap feasibility assessed** — User asked about github.com/Alishahryar1/free-claude-code (API proxy for other LLMs). Assessed as possible but would degrade tool-use quality. 8/41 files import Claude SDK directly. No action taken — informational only.

---

### Code Change: Strategy Filters Across All Views

Implemented the Tier 2 "Strategy filters across all views" feature from FUTURE_PLAN.md. All 276 existing tests still pass.

**Files changed:**

1. **`src/mcp_server.py`** — Added optional `strategy` parameter to `add_holding` and `add_to_watchlist` MCP tool definitions. The DB operations already accepted strategy; this wires it to the chat agent.

2. **`src/db/schema.py`** — Changed watchlist unique constraint from `UNIQUE(ticker)` to `UNIQUE(ticker, strategy)`. Added `_run_migrations()` with `_migrate_watchlist_unique_constraint()` that detects old schema and rebuilds the table automatically at startup. Same ticker can now exist under multiple strategies with different buy prices.

3. **`src/operations/watchlist.py`** — Added `strategy` parameter passthrough to `add_to_watchlist()`.

4. **`src/operations/activity.py`** — Added `strategy: str | None = None` parameter to `get_activity()`. When strategy filter is active, analyses and decisions filter by strategy; lists and task_runs (no strategy column) are excluded.

5. **`src/web/app.py`** — Added optional `strategy` query parameter to `/api/portfolio`, `/api/watchlist`, `/api/activity`, and `/api/activity/{event_type}/{reference}` DELETE. Added `/api/strategies` endpoint for populating filter dropdowns.

6. **`src/web/templates/dashboard.html`** — Added `<select class="strategy-filter-select">` dropdowns to Portfolio, Watchlist, and Activity tabs. Populated via fetch from `/api/strategies`. Default "All Strategies". Uses htmx to re-fetch tab content with strategy filter applied.

7. **`src/web/static/style.css`** — Added `.strategy-filter-select` styles matching the dark theme.

**What this enables:**
- Same ticker on watchlist under multiple strategies (e.g., AAPL as BUY at $200 under 100-bagger, WATCH at $150 under buffett-munger)
- Portfolio filtered by strategy ("how are my Buffett-Munger picks doing?")
- Activity feed filtered by strategy
- Holdings and watchlist entries tagged with the strategy that drove them

---

### Documentation Accuracy Sweep

Verified actual project state (276 tests / 12 files, 13 SQLite tables, 39 MCP tools, Phase 3d complete, full Web UI with Agent SDK chat) against all documentation. Three docs were stale, three were accurate.

**`docs/ARCHITECTURE.md` — Major refresh (was stuck at Phase 3b):**
- Header: "Phase 3b in progress" → "Phase 3d complete"
- Web UI section: Replaced "echo placeholder — Agent SDK integration next" with full feature list (Agent SDK chat, token streaming, specialist progress card, 6 sidebar tabs, welcome screen, structured markdown rendering, tool use display, strategy-change server push)
- SQLite tables: 8 → 13 (added specialist_findings, candidate_lists, candidates, scheduled_tasks, task_runs)
- MCP tool count: ~27 → 39 (added run_addon, list_addons, quick_research, candidate list tools, delete_activity_event)
- Testing: 131 tests / 7 files → 276 tests / 12 files
- Development Phases table: Phase 3b "IN PROGRESS" → all phases through 3d marked COMPLETE with descriptions
- "Still TODO" section: Replaced bare list with structured summary referencing FUTURE_PLAN.md tiered roadmap
- Project structure: Fixed duplicate onboarding.py entry, added operations/ directory (12 files), agents/ directory, web/templates/partials/
- Interaction modes: Fixed "three" → "four" (was listing 4 items under heading that said "three")
- Key Files table under Web UI: Added partials/ directory and updated app.py description

**`README.md` — Minor refresh:**
- Project status: Added "Phases 3a-3d are complete", updated test count to 276, added add-on pattern and full Agent SDK integration to feature list
- MCP tool surface: "typed MCP tool surface" → "typed MCP tool surface (39 tools, no Bash/Read/Glob)"
- Biggest planned items: Updated from "backtesting + form editor" to "Plotly charts + portfolio analytics + quarterly reports"
- Roadmap link: Changed from ARCHITECTURE.md "Still TODO" to FUTURE_PLAN.md

**`docs/FUTURE_PLAN.md`:**
- Test count: 260 → 276

**No changes needed (verified accurate):**
- `docs/STRATEGY_GUIDE.md` — two-zone schema, tier naming, validation rules all current
- `src/agent/CLAUDE.md` — persona, tool surface (39 tools documented), routing rules all current. Confirmed `quick_research` tool exists.
- `docs/archive/README.md` — properly flags all archived docs as historical with correct reasons

---

### Specialist Drilldown (Apr 28, 2026)

Expandable accordion cards per specialist in the Activity tab. Each card shows confidence badge, key findings, flags, and data sources. Lazy-loaded on first click with toggle pattern (no re-fetch on subsequent opens).

**New API endpoint:** `GET /api/analysis/{id}/findings` — returns specialist findings for a given analysis.

**New template:** `partials/specialist_findings.html` — accordion cards per specialist with confidence badges, key findings, flags, and data sources.

**New operation:** `get_specialist_findings_for_analysis()` — queries `specialist_findings` table for a given analysis ID.

**Activity tab integration:** Drilldown button on each analysis row. Uses lazy-load-once + toggle pattern — first click fetches findings via htmx, subsequent clicks toggle visibility without re-fetching.

**New CSS styles:** Accordion card styles (expand/collapse, confidence badge colors, flag highlighting).

**Files changed:**

1. **`src/operations/analyses.py`** — Added `get_specialist_findings_for_analysis()` operation.
2. **`src/web/app.py`** — Added `GET /api/analysis/{id}/findings` endpoint.
3. **`src/web/templates/partials/specialist_findings.html`** — New template for accordion cards.
4. **`src/web/templates/partials/activity.html`** — Added drilldown button with lazy-load-once + toggle pattern.
5. **`src/web/templates/dashboard.html`** — Wired up drilldown JS/htmx integration.
6. **`src/web/static/style.css`** — Accordion card styles.

---

### Responsive Mobile UI (Apr 29, 2026)

Pure CSS/Tailwind responsive pass across the web UI. No HTML restructuring or separate mobile templates -- responsive behavior added via Tailwind breakpoint prefixes (`sm:`) and targeted `@media` queries in style.css.

**Key changes:**

- **Sidebar:** Full-width overlay on mobile (`w-full sm:w-[460px]`), capped at 80vw on tablet. Tab bar scrollable on narrow screens.
- **Chat area:** Bubbles use 92% width on mobile (up from 80%). Message containers use tighter padding (`px-3 sm:px-6`). Input bar is sticky-bottom with comfortable touch targets.
- **Top bar:** Logo text hidden on mobile (icon only). "Add-ons" label collapses to "+". "Strategy:" label hidden on mobile. Reduced horizontal padding.
- **Welcome screen:** Tighter spacing and padding on mobile. Suggestion chips smaller.
- **Touch targets:** All interactive elements (buttons, chips, specialist card headers, chat input, send button) meet 44px minimum height on coarse-pointer devices.
- **Activity feed:** Row action buttons always visible on mobile/touch (no hover dependency).
- **No horizontal scroll:** `overflow-x: hidden` on html/body. Dropdowns constrained to viewport width.
- **Progress card and thinking indicator:** Responsive padding.

**Files changed:**

1. **`src/web/static/style.css`** -- Added responsive `@media` rules for mobile (<640px), tablet (640-1023px), and touch devices (`pointer: coarse`).
2. **`src/web/templates/dashboard.html`** -- Added Tailwind responsive prefixes to top bar, sidebar, chat input, welcome screen, thinking indicator, and JS-generated DOM elements (message wrappers, tool use rows, progress card).

**Note:** Future UI additions automatically inherit responsive behavior from the container-level rules (chat message wrappers, sidebar drawer class). Only new layout structures need explicit mobile consideration.

---

### Synthesis Drift Context (Apr 28, 2026)

Previous analysis context is now passed to the synthesis agent so it can flag material changes for holdings. Non-holdings get lighter reference context. Adds ~100-200 tokens to the synthesis prompt when prior data exists, zero on first analysis.

**New functions:**

- `get_previous_analysis_context(ticker)` — returns compact dict with decision, score, specialist scores, and date from the most recent prior analysis.
- `is_current_holding(ticker)` — checks whether a ticker is in the current holdings table.

**Synthesis integration:** `synthesize()` now receives previous analysis context. Holdings get a `[MATERIAL CHANGE]` flag when there's a ≥2 point score shift or a decision change (e.g., BUY → PASS). Non-holdings get lighter reference context ("previously analyzed on DATE with DECISION").

**Files changed:**

1. **`src/operations/analyses.py`** — Added `get_previous_analysis_context()`.
2. **`src/operations/portfolio.py`** — Added `is_current_holding()`.
3. **`src/specialists/synthesis.py`** — `synthesize()` accepts and uses previous analysis context, generates `[MATERIAL CHANGE]` flags.
4. **`src/operations/analysis.py`** — Orchestration wires previous context into synthesis call.

---

### Discovery Agent Fixes (Apr 29, 2026)

- **Market config**: Replaced hardcoded "US-listed" in discovery prompt with user-configurable markets. New `data/config.yaml` with `markets: [US]` default. Maps market codes to exchange names (US→NYSE/NASDAQ, IN→NSE/BSE, AE→ADX/DFM, UK→LSE). User edits config to add their investable markets.
- **Preliminary language**: Discovery prompt now uses "Screening stance" — no definitive moat ratings (wide/narrow). Uses qualified signals ("appears to have pricing power", "suggests durability"). Output schema: `quality_signal` field replaces moat classification.
- **Candidate pipeline only**: Explicit prompt instruction that discovery feeds candidates only. Never suggests watchlist/holdings — that requires full specialist analysis first.
- **Tests**: 2 new tests (screening stance check, candidate pipeline restriction). Total: 278.
- **Files changed**: `src/agents/discovery.py`, `data/config.yaml` (new), `tests/test_discovery.py`
- **Markets UI dropdown**: Live multi-select dropdown in header (same pattern as add-ons). 10 markets with descriptive labels (e.g. "US — American Markets (NYSE / NASDAQ)"). Saves to config.yaml immediately. Two API endpoints: GET/POST /api/config/markets. Mobile shows globe icon + count. Files: `src/web/app.py`, `src/web/templates/dashboard.html`
- **Accounting standards context**: Auto-detects market from ticker suffix (.NS→India/IFRS, .AD→UAE/IFRS, .L→UK/IFRS, etc.). Injects accounting context line into every specialist prompt. Files: `src/agents/discovery.py` (mappings + detection), `src/specialists/runner.py` (prompt injection)

---

### Default Automated Schedule Design (Apr 29, 2026)

- Designed end-to-end automated schedule covering full investment lifecycle: discovery → screening → analysis → monitoring → re-analysis → portfolio health → reporting
- Documented in FUTURE_PLAN.md Tier 1 with lifecycle table, implementation approach, and 4 identified gaps
- Key design decisions: timezone-aware cron generation, per-strategy schedule templates, toggle-able individual tasks
- Gaps flagged: earnings calendar integration, automated buy zone alerting, candidate queue auto-processing, rebalancing signals

---

### Discovery Deduplication — Exclude Known Tickers (Apr 30, 2026)

Discovery agent now excludes tickers already known to the system. Two-layer approach:

1. **Prompt injection:** Sorted exclude list injected as "Skip these tickers" section. Steers the agent toward genuinely new names, saving API cost.
2. **Deterministic post-filter:** After the agent returns candidates, any known tickers that slipped through are dropped programmatically. Safety net since LLMs can ignore instructions.

**Exclusion rules (three buckets):**
- Holdings — always excluded (you own it)
- Watchlist — always excluded (you're tracking it)
- Previous candidates — only excluded if discovered within last 90 days. Older candidates rotate back in because market conditions change (price drops, earnings improve). Prevents the exclude list from growing forever and starving the agent of good names.

The exclude set is built in `candidates.py` (which already has DB access) and passed into `discover_candidates()` as a parameter — keeping `discovery.py` free of portfolio DB imports (enforced by existing isolation test).

**Files changed:**
1. **`src/operations/candidates.py`** — Added `_get_known_tickers()` with 90-day recency window for candidates. `find_candidates()` passes exclude set to discovery.
2. **`src/agents/discovery.py`** — Added `_build_exclude_section()` helper. `_build_discovery_prompt()` accepts `exclude` param. `discover_candidates()` accepts `exclude` param + post-filter. Sync wrapper updated.
3. **`tests/test_discovery.py`** — 4 new tests: exclude section empty/populated, prompt includes/omits section. Total: 282.

---

### Daemon Status False Positive Fix (Apr 29, 2026)

**Problem:** Web UI showed daemon as "running" when it wasn't. Stop button didn't work. Root cause: `pgrep -f "owlfolio.*daemon"` matched the Claude Agent SDK subprocess (PID 2618451) whose command line contains the entire system prompt text — which includes both "Owlfolio" and "daemon" as words. The regex matched across the ~55KB command-line string.

**Fix:** Replaced all `pgrep`-based daemon detection with a PID file approach:
- Daemon writes `data/daemon.pid` on start, removes on shutdown
- `is_daemon_running()` reads PID file, verifies process alive via `os.kill(pid, 0)`
- `stop_daemon()` sends SIGTERM to actual daemon PID, waits for exit, cleans up PID file
- All 4 status check sites updated (dashboard, schedule tab, htmx-polled header, CLI status)

**Files changed:**
1. **`src/daemon.py`** — Added `PID_FILE`, `_write_pid()`, `_remove_pid()`, `is_daemon_running()`, `stop_daemon()`. `run_daemon()` now writes PID on start and removes on exit (via `finally`).
2. **`src/web/app.py`** — All 3 status checks replaced `pgrep` subprocess with `from src.daemon import is_daemon_running`. Stop endpoint uses `stop_daemon()` instead of `pkill`.
3. **`src/main.py`** — CLI status command uses `is_daemon_running()` instead of `pgrep`.

---

### Strategy-Aware Addons: Quarterly Review + News Pulse (Apr 30, 2026)

Two new addon specialists that are **strategy-aware** — unlike Shariah (which is strategy-agnostic), these reference the active strategy's criteria and the most recent saved analysis for the ticker.

**Quarterly Review** (`owlfolio review TICKER` / `run_addon("review", ticker)`):
- Light quarterly check-in between full annual analyses (~1-2 min)
- Pulls the latest quarterly filing and compares key metrics against saved thesis
- Outputs `thesis_status: intact|weakening|strengthening|broken` with metric deltas (revenue growth, margins, FCF, ROIC)
- Flags material events: management changes, acquisitions, guidance changes
- Use case: "Did this quarter's numbers confirm my BUY thesis?"

**News Pulse** (`owlfolio news TICKER` / `run_addon("news", ticker)`):
- Quick ad-hoc news scan (~30 seconds)
- Searches for news published after the last saved analysis date
- Scores each finding against saved thesis, bull/bear case, and key risks
- Outputs `thesis_alignment: supports|contradicts|neutral` with new risks/catalysts
- Use case: "Did the UAE OPEC exit affect my ADNOC thesis?"

**Architecture — strategy-aware addon pattern:**
- Addons in `STRATEGY_AWARE_ADDONS` set have `{PREVIOUS_ANALYSIS}` placeholder in their prompt
- `run_addon()` resolves this at runtime by fetching the latest saved analysis from the DB
- Injects: analysis date, decision, quality tier, score, thesis, bull/bear case, key risks, catalysts, per-specialist confidence scores
- If no previous analysis exists, specialist is told to treat it as a first-time check
- Strategy context (name + description) flows through the standard specialist runner header

**Files changed:**
1. **`src/specialists/addons.py`** — Added `REVIEW_SPECIALIST`, `NEWS_PULSE_SPECIALIST`, `STRATEGY_AWARE_ADDONS` set. Updated registry and module docstring.
2. **`src/operations/analysis.py`** — Added `_inject_previous_analysis()` and `_build_previous_analysis_text()`. `run_addon()` now resolves `{PREVIOUS_ANALYSIS}` for strategy-aware addons before specialist runs.
3. **`src/main.py`** — Added `owlfolio review TICKER` and `owlfolio news TICKER` CLI commands (mirrors existing `shariah` command pattern).
4. **`src/mcp_server.py`** — Updated `run_addon` tool description to list all three addons.
5. **`tests/test_specialists.py`** — 9 new tests: registry checks, placeholder presence, strategy-aware set consistency, context injection with/without saved analysis, prompt content validation. Total: 291.

**Tiered analysis cadence this enables:**
- Full analysis → once a year (annual report, full specialist swarm)
- Quarterly review → after each earnings (single specialist, strategy-aware)
- News pulse → ad-hoc, whenever something might have changed

---

## 2026-05-01 — Strategy Calibration + Currency Fix

### Pricing Power as 6th Moat Criterion

**File:** `strategies/buffett-munger.yaml`
**Problem:** BR (Broadridge) was misclassified as MONOPOLY because the strategy had no way to detect regulated pricing caps. A company can score high on all five existing moat criteria while having severely constrained pricing power due to regulation.
**Fix:** Added `pricing_power` as a 6th criterion (weight 0.20) and rebalanced existing weights:
- `switching_costs` 0.20, `network_effects` 0.20, `pricing_power` 0.20, `cost_advantages` 0.15, `intangible_assets` 0.15, `efficient_scale` 0.10
- Added detailed scoring rubric in `prompts.synthesis` (regulated pricing = max 4/5)
- Updated `prompts.specialists.moat_analyst` to investigate pricing constraints

**Docs updated:** `docs/STRATEGY_GUIDE.md` criteria example updated from 5 to 6 criteria with new weights.

---

### Maintenance CapEx Default: 85% to 50%

**File:** `strategies/buffett-munger.yaml`
**Problem:** The 85% default for maintenance CapEx as a share of total CapEx crushed Owner Earnings calculations for asset-light businesses (BR, VRSN, FICO). These companies spend most of their CapEx on growth, not maintenance — the old default treated nearly all CapEx as maintenance, deflating OE and making them look worse than they are.
**Fix:**
- Changed `llm_overridable.maintenance_capex_ratio.default` from 0.85 to 0.50
- Added asset intensity classification guide to `prompts.specialists.financial_analyst` (asset-light 40-55%, moderate 70-85%, asset-heavy 90-100%)
- Aligned guidance in `prompts.synthesis`

**Docs updated:** `docs/STRATEGY_GUIDE.md` `llm_overridable` example updated from 0.85 to 0.50.

---

### Fixed Hardcoded "$" Currency Symbols in CLI

**Files:** `src/main.py` (26 spots), `src/db/operations.py` (1 spot)
**Problem:** Japanese stocks (e.g., 6861.T Keyence) and other non-USD tickers displayed "$" instead of their native currency symbol (¥, £, AED, etc.).
**Fix:**
- Created `_fmt_price()` helper using `ticker_currency()` for correct currency symbols
- JPY displays as whole numbers (no decimals), all others as 2 decimals
- Fixed 27 total hardcoded "$" occurrences across CLI display commands

---

### Test Update: Strategy Criteria Count

**File:** `tests/test_strategy_loader.py`
**Change:** Updated expected criteria count from 5 to 6 to reflect the new `pricing_power` criterion in buffett-munger.yaml.

---

### Default Automation Schedule — Implementation

**Files:** `src/modules/schedule_defaults.py` (new), `src/main.py` (2 new commands + setup Step 5), `src/operations/candidates.py` (`max_candidates` param), `data/config.yaml` (timezone)

Built end-to-end automated schedule covering the full investment lifecycle. Created during `owlfolio setup` (Step 5), timezone-aware, anchored to market open hours.

**8 default tasks (intensity ladder):**
1. Daily watchlist price check — 30min before market open (weekdays)
2. Daily portfolio P&L update — at market open (weekdays)
3. Weekly discovery — Monday at market open
4. Weekly candidate screening — Wednesday, auto-selects latest list, processes 3 at a time
5. Bi-weekly news pulse — Tue/Fri, all holdings
6. Monthly light review — 1st of month, all holdings vs thesis
7. Quarterly 10-Q review — mid-quarter (Jan/Apr/Jul/Oct), thorough mode
8. Annual full re-analysis — post-10-K season (Feb/May/Aug/Nov)

**New CLI commands:**
- `owlfolio watchlist-check` — Price check for all watchlist items with buy zone signals
- `owlfolio review-holdings --mode {news|review|full} [--thorough]` — Batch review across all holdings using addon system (news/review) or full re-analysis pipeline

**Other changes:**
- `analyze_list()` now accepts `max_candidates` parameter for incremental processing
- `analyze-list` CLI: `name` argument optional with `--auto` flag (auto-selects most recent list)
- Setup Step 5 collects timezone, saves to config.yaml, creates default schedule with Rich table display
- `schedule_defaults.py` uses `{H}` / `{H-1}` cron templates resolved from market open hours + timezone offsets

---

### Schedule Management UI

**Files:** `src/web/templates/partials/tasks.html` (rewrite), `src/web/app.py` (5 new endpoints + helper), `src/db/operations.py` (`update_scheduled_task`)

Upgraded the Schedule tab from read-only to full CRUD:

**5 features:**
1. *Toggle switch* per task — pause/resume without deleting (uses existing `toggle_task()` DB function)
2. *Delete button* per task — with confirmation dialog
3. *Run Now button* — manually trigger a task immediately (runs in background thread via `asyncio.run_in_executor`)
4. *Inline schedule editor* — frequency/day/time dropdowns that translate to cron (no cron syntax knowledge needed). Supports: hourly, daily, weekdays, weekly, monthly, quarterly
5. *Add task form* — collapsible form with command dropdown (pre-populated with all owlfolio commands), schedule dropdowns, timezone selector. Validates owlfolio subcommands before saving.

**API endpoints added:**
- `POST /api/tasks/{id}/toggle` — flip enabled state
- `DELETE /api/tasks/{id}` — remove task
- `POST /api/tasks/{id}/run` — manual trigger
- `PUT /api/tasks/{id}` — update schedule/command/name
- `POST /api/tasks` — create new task

Refactored `GET /api/tasks` to use shared `_render_tasks()` helper (eliminates duplication across 6 endpoints).

**Also in this session:**
- Trimmed default schedule from 8 → 6 tasks (removed bi-weekly news → weekly, removed monthly review → quarterly covers it)
- Relabeled "Markets" → "Brokerages" / "Brokerage Access" in web UI to indicate which markets the user has trading access to

---

## How to Use This File

When picking up Owlfolio work in Claude Code:
1. Read this file for recent changes and context
2. Read `docs/FUTURE_PLAN.md` for the full roadmap
3. Read `docs/ARCHITECTURE.md` for current system design
4. Check git log for any changes since this file was last updated
