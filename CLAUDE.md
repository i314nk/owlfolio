# Owlfolio

Methodology-driven investment research agent built on the Claude Agent SDK.

## Setup

When a user asks you to set up Owlfolio, run these steps:

### 1. Python environment

```bash
# Requires Python 3.12+
python3 --version

# Create venv and install
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[web]"
```

### 2. Credentials

Owlfolio is **Claude-only** — it uses the Claude Agent SDK exclusively.

**Recommended: Claude subscription (Pro/Max)**
- If the user already has Claude Code running, credentials exist at `~/.claude/.credentials.json`
- No API costs — analyses run against the subscription
- This is the best path for individual investors

**Alternative: API key**
- Set `export ANTHROPIC_API_KEY=sk-ant-...` in shell profile
- Standard per-token billing (analyses are token-heavy — 3-5 specialists in parallel with extended thinking)

Check which is available:
```bash
ls ~/.claude/.credentials.json 2>/dev/null && echo "Subscription credentials found" || echo "No subscription credentials"
echo ${ANTHROPIC_API_KEY:+"API key is set"}
```

### 3. Default strategy

```bash
# Copy a preset strategy (Buffett-Munger is the default)
cp strategies/buffett-munger.yaml methodology.yaml
```

Or let the user choose:
```bash
owlfolio strategy --list           # show all 7 presets
owlfolio strategy --use <name>     # switch to a preset
owlfolio setup --create            # create a custom strategy via conversation
```

### 4. Create data directories

```bash
mkdir -p data logs
```

### 5. Verify

```bash
owlfolio doctor    # comprehensive health check
owlfolio status    # quick status
```

### 6. Start

```bash
owlfolio serve     # web dashboard at http://127.0.0.1:8000
# or
owlfolio analyze AAPL   # CLI analysis
```

## Architecture

- **Strategy YAML** defines the investment methodology (7 presets + custom)
- **Specialist subagents** (3-5 per strategy) run in parallel, each researching independently
- **Synthesis agent** reconciles specialist findings into BUY / WATCH / PASS
- **SQLite** stores analyses, portfolio, decisions, audit trail
- **Web UI** (FastAPI + htmx) provides chat interface with live streaming

## Key Files

| Path | Purpose |
|------|---------|
| `src/main.py` | CLI entry point (Typer, 47 commands) |
| `src/web/app.py` | FastAPI web UI + WebSocket chat |
| `src/specialists/runner.py` | Specialist subagent orchestration |
| `src/specialists/synthesis.py` | Synthesis agent (final decision) |
| `src/mcp_server.py` | MCP tools for web chat agent |
| `src/db/` | SQLite schema + operations |
| `src/operations/` | Business logic (portfolio, analysis, etc.) |
| `src/strategy/` | Strategy YAML loading + validation |
| `strategies/` | 7 preset strategy YAMLs |
| `methodology.yaml` | Active strategy (user's choice, gitignored) |

## Commands

```bash
owlfolio analyze TICKER          # full analysis
owlfolio analyze TICKER --shariah # with Shariah screening
owlfolio find --count 15         # agentic candidate discovery
owlfolio serve                   # web dashboard
owlfolio chat                    # CLI chat
owlfolio portfolio               # view holdings
owlfolio doctor                  # diagnose issues
owlfolio strategy --list         # show presets
```

## Development

```bash
source .venv/bin/activate
pip install -e ".[web,dev]"      # install with dev dependencies
pytest tests/ -x -q              # run tests
owlfolio serve --restart         # restart after code changes
```

## Coding Conventions

- **Type hints everywhere.** All function signatures use type annotations. Use `X | None` over `Optional[X]`.
- **Pydantic for data models.** Schemas in `src/specialists/schemas.py`. Nullable fields use `float | None = None` — prefer null over placeholder values.
- **Async by default.** All agent-facing code is async. Use `asyncio.gather()` for parallel work. Always pass `return_exceptions=True` to avoid one failure cancelling siblings.
- **Logging over print.** Use `logging.getLogger("owlfolio.<module>")`. Never print to stdout in library code.
- **Imports:** absolute imports from `src.` — no relative imports.

## Error Handling Philosophy

- **Classify errors:** Transient (retry) vs business (flag to user) vs permission (escalate). See `_is_transient()` in runner.py.
- **Never silently swallow.** Log every error, even if handled. `logger.warning` for recoverable, `logger.error` for failures.
- **MCP tools wrap all exceptions.** Every MCP tool in `mcp_server.py` catches exceptions and returns `_err(message)` with `is_error: True`. The agent loop never crashes from a bad tool call.
- **Specialists are fault-tolerant.** If 1 of 5 specialists fails, the other 4 still complete. Synthesis works with partial data.
- **Retry transient errors.** Rate limits, timeouts, 5xx → retry with exponential backoff (30s base, 2x per attempt, max 2 retries). Non-transient errors fail immediately.

## Security Model

- **Chat agent has no shell.** `allowed_tools` restricts to `mcp__owlfolio__*` only. Bash, Read, Write, Edit, Glob, Grep are all removed.
- **Specialist subagents have no filesystem.** Only `WebSearch` + `WebFetch`. Prompt injection from web content cannot escalate.
- **Tool inputs are untrusted.** They come from the LLM, not the user. Validate all inputs at the operations layer.

## Testing

- Tests live in `tests/`. Run with `pytest tests/ -x -q`.
- Use `pytest-asyncio` for async tests.
- Mock the Agent SDK — don't make real API calls in tests.
- Test specialist JSON parsing edge cases (malformed JSON, missing fields, null values).

## Important

- Claude-only: no multi-LLM support. Uses Claude Agent SDK with adaptive extended thinking.
- Subscription (Pro/Max) auth is convenient for personal use, but Agent SDK usage is token-intensive and draws from Anthropic's Agent SDK credit/usage-credit model.
- All data stays local in SQLite (`data/portfolio.db`). No telemetry, no external services except Claude API and yfinance for market data.
