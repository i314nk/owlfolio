# Owlfolio Autonomous Schedule Policy

Owlfolio should keep working when the user is away, but autonomy must be explicit about cost. The scheduler therefore separates low-cost monitoring from Claude-powered research.

## Policy

### 1. Safe monitoring tasks may be enabled by default

Safe tasks are deterministic CLI checks that do not call Claude and should be cheap to run on weekdays:

| Task | Command | Cadence | Why it is safe |
|---|---|---|---|
| `daily-watchlist-check` | `owlfolio watchlist-check --no-llm-price` | 30 minutes before primary market open, Monday-Friday | Uses market-data price sources only; no Claude fallback. |
| `daily-portfolio-check` | `owlfolio portfolio --no-llm-price` | At primary market open, Monday-Friday | Refreshes holdings/P&L view using price sources only; no Claude fallback. |

These tasks preserve the core “autonomous portfolio monitor” behavior without surprise Agent SDK credit usage.

### 2. Claude research tasks are opt-in

Research/discovery/deep-analysis tasks use Claude specialist agents and may take minutes to hours. They should exist as documented policy/templates, but they should only be enabled after the operator intentionally accepts the cadence and credit/runtime expectations.

Recommended opt-in ladder:

| Task | Command | Suggested cadence | Expected cost/runtime |
|---|---|---|---|
| `weekly-discovery` | `owlfolio find` | Monday at market open | Claude WebSearch discovery; slow, credit-using. |
| `weekly-news-check` | `owlfolio review-holdings --mode news` | Tuesday before market open | Claude review for every holding; scales with holdings count. |
| `weekly-candidate-screening` | `owlfolio analyze-list --auto --next 3` | Wednesday at market open | Full specialist analysis for up to 3 candidates; high credit/runtime use. |
| `quarterly-10q-review` | `owlfolio review-holdings --mode review --thorough` | Mid-quarter | Thorough holding review; high credit/runtime use. |
| `annual-full-reanalysis` | `owlfolio review-holdings --mode full` | Feb/May/Aug/Nov after reporting cycles | Full holding re-analysis; highest recurring cost. |

### 3. Daemon execution rules

- Scheduled commands must be `owlfolio ...` commands only; the daemon rejects shell/metacharacter commands.
- Safe monitoring tasks should use `--no-llm-price` so price-source outages do not silently trigger Claude usage.
- Agentic jobs need a long timeout; the daemon timeout is intentionally long enough for discovery and batch analysis.
- The Schedule tab / `task_runs` history must show executions so autonomy is auditable.

## Applied production stance for the patched runtime

For `/home/hermes_agent/code/owlfolio/data/portfolio.db`, enable only the two safe monitoring tasks while credentials, portfolio holdings, watchlist, and imported historical state are still empty. Insert the Claude research tasks as disabled opt-in entries so the system is not left with zero automation and the intended autonomous ladder remains visible.

Once credentials and portfolio/watchlist state are restored, the operator can enable specific research tasks from the Schedule tab or CLI after choosing an acceptable cadence.
