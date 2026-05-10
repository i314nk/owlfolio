"""Domain operations — the canonical implementation of every Owlfolio action.

This package holds the actual logic that backs both the CLI commands (in
src/main.py) and the MCP tool surface (in src/mcp_server.py). The principle
is one source of truth: a CLI command calls the same function an MCP tool
calls, and both render the same typed result.

Each module covers one slice of the domain:

    portfolio.py   — holdings, add/sell/snapshot, performance
    watchlist.py   — watchlist CRUD + buy-zone tracking
    analyses.py    — saved analysis records, history, compare
    alerts.py      — alert listing
    tasks.py       — scheduled task CRUD + daemon status
    strategies.py  — strategy listing, switching, info, specialist roster
    memory.py      — chat memory CRUD
    system.py      — doctor / status / health checks

Functions in this package:
  - Take primitive arguments (no Typer types, no MCP types).
  - Return Pydantic models or plain dicts (JSON-serializable).
  - Validate their inputs (tickers, strategy names, etc.) and raise
    ValueError on bad input — neither the CLI nor MCP should accept
    junk that wasn't pre-validated.
  - Do not print. Display is the caller's job.
"""

import re

# Shared validation primitives used across every operation module.
# These are deliberately strict — the chat agent's MCP surface should
# refuse anything that doesn't match before invoking the underlying logic.

# Ticker shape: 1-15 chars, starts with letter or digit, then
# letters/digits/dots/hyphens. Widened from the original 10-char /
# letter-leading regex to support yfinance's international suffix
# convention:
#
#   ADNOCGAS.AD      Abu Dhabi (11 chars — was rejected before)
#   BHARTIARTL.NS    NSE India (13 chars — was rejected before)
#   0700.HK          Hong Kong (digit-leading — was rejected before)
#   600519.SS        Shanghai  (digit-leading — was rejected before)
#   BARC.L           London
#   RY.TO            Toronto
#   BRK.B            US class share
#   BF-A             US hyphenated
#
# Still rejects: empty strings, shell metacharacters, path traversal,
# whitespace, lowercase mixed with non-letters, anything > 15 chars.
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
# Strategy names: lowercase alnum + hyphen, 1-30 chars, may start with a
# digit (e.g. `100-bagger`). Rejects path traversal, shell metachars,
# anything containing dots, slashes, spaces, etc.
STRATEGY_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,29}$")


def validate_ticker(ticker: str) -> str:
    """Normalize and validate a ticker. Raises ValueError on bad input."""
    if not isinstance(ticker, str):
        raise ValueError(f"ticker must be a string, got {type(ticker).__name__}")
    t = ticker.strip().upper()
    if not TICKER_RE.match(t):
        raise ValueError(
            f"invalid ticker {ticker!r}: must be 1-10 uppercase letters/dots/hyphens "
            f"starting with a letter"
        )
    return t


def validate_strategy_name(name: str) -> str:
    """Validate a strategy name. Raises ValueError on bad input.

    Strategy names are case-sensitive (presets are all lowercase). We do NOT
    auto-lowercase — `Buffett-Munger` is rejected, not silently normalized,
    so that prompt-injection attempts get flagged rather than coerced into
    a valid name.
    """
    if not isinstance(name, str):
        raise ValueError(f"strategy name must be a string, got {type(name).__name__}")
    n = name.strip()
    if not STRATEGY_NAME_RE.match(n):
        raise ValueError(
            f"invalid strategy name {name!r}: must be 1-30 lowercase letters/digits/hyphens"
        )
    return n
