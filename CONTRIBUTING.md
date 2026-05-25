# Contributing to Owlfolio

Thanks for your interest. Owlfolio started as a personal tool and is still largely a solo project, so contributions are welcome but the scope is deliberately narrow. Read this before opening a PR.

## Getting Started

```bash
git clone https://github.com/i314nk/owlfolio.git
cd owlfolio
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,web]"
```

Requires Python 3.12+. The `dev` extra pulls in pytest and ruff. The `web` extra adds FastAPI + uvicorn for the web UI.

Copy `.env.example` to `.env` and add either an Anthropic API key or Claude Code subscription credentials. Owlfolio uses yfinance for market data (no API key needed) and Claude for all LLM work.

## Running Tests and Linting

```bash
pytest                  # 298 tests across 14 files
pytest -x               # stop on first failure
pytest tests/test_foo.py  # run one file
ruff check src/         # lint
ruff format src/        # auto-format
```

All PRs must pass `pytest` and `ruff check` with zero errors.

## Development Workflow

**Branch naming:**
- `feat/short-description` for new features
- `fix/short-description` for bug fixes
- `refactor/short-description` for internal changes

**Commit messages:** Imperative mood, concise. Examples:
- `add dividend-income strategy`
- `fix moat scoring when financials are missing`
- `refactor specialist runner to use async dispatch`

No conventional-commits prefixes required, but keep the first line under 72 characters.

## Adding a New Strategy

Strategies live in `strategies/` as YAML files. Every strategy follows the two-zone schema:

- **Zone 1** — Structured contract: criteria, tiers, position sizing rules. This is what synthesis reads and what determines typed outputs.
- **Zone 2** — Prompts: the prose each specialist agent reads. Edit these to tune behavior without touching code.

To add a strategy:

1. Copy an existing YAML (e.g., `buffett-munger.yaml`) as your starting point.
2. Fill in both zones. Zone 1 fields are validated by Pydantic at load time — the tests will catch schema violations.
3. Add at least one test in `tests/` that loads your strategy and runs a mock analysis.
4. Update the README strategy table.

## Adding a New Specialist

Specialist prompts live in each strategy YAML under `prompts.specialists`. The shared runner in `src/specialists/runner.py` turns those prompt bodies into Claude Agent SDK subagents during analysis.

To add a specialist:

1. Add the specialist prompt body to the relevant strategy YAML under `prompts.specialists.<name>`.
2. Include required placeholders such as `{TICKER}` and keep the prompt self-contained: role, research targets, output expectations, and strategy-specific nuance.
3. If the specialist needs reusable Python support code, add it to `src/specialists/` and keep it independent of strategy-specific prompt text.
4. Add tests — at minimum, test that the strategy loads, the specialist appears in `strategy.prompts.specialists`, and any required placeholders are present.

Specialists must be stateless. They receive strategy/ticker context, call Claude through the runner, and return structured findings. No side effects, no database writes.

## Code Style

Ruff handles formatting and linting. The config lives in `pyproject.toml`. Beyond that:

- Use Python 3.12+ features freely: `type` statements, `match/case`, f-strings, `|` for union types.
- Type hints on all public functions.
- No classes where a function will do. Owlfolio leans functional.
- SQLite is the only database. No ORMs — raw SQL via `db/` module.

## PR Guidelines

- One feature or fix per PR. Don't bundle unrelated changes.
- Describe *what* the PR does and *why* in the description. A sentence or two is fine.
- Include test coverage. New features need tests. Bug fixes need a regression test.
- Keep diffs small. If a refactor is needed to support your feature, send the refactor as a separate PR first.
- Don't break existing strategies. If your change affects strategy YAML schema, all 7 existing strategies must still load and pass tests.

## What NOT to Contribute

These will be closed without merge. Nothing personal — they conflict with the project's design:

- **Multi-LLM support** (LiteLLM, OpenAI fallbacks, etc.). Owlfolio is Claude-only by design. The agent architecture depends on Claude-specific capabilities.
- **Paid data APIs as hard dependencies.** yfinance covers what we need. If your feature requires a Bloomberg/Refinitiv/S&P subscription, it won't be merged. Optional integrations that gracefully degrade are a *maybe* — open an issue first.
- **Deterministic screeners.** Owlfolio is an AI research agent, not a stock screener. If it can be done with a SQL query and no LLM, it doesn't belong here.
- **Web scraping of paywalled sources.** Legal and ethical reasons.

## Reporting Issues

Open a GitHub issue with:

- What you expected vs. what happened.
- The strategy YAML you were using (or "default").
- Python version and OS.
- Relevant logs (the `logs/` directory has per-run output).

For strategy-quality issues (bad analysis, missed moat, wrong valuation), include the ticker and the specialist output so the prompts can be tuned.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
