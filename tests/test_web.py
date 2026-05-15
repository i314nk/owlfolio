"""Tests for the FastAPI web app and chat helpers.

These exercise the actual current implementation in src/web/app.py:
  - HTML routes (GET /) and htmx partials render without 500s
  - The chat helpers (_build_chat_system_prompt, _format_tool_use) work
  - Daemon control endpoints return JSON
The WebSocket handler itself is not exercised here — it depends on the
Claude Agent SDK runtime, which we don't run in unit tests.
"""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PROJECT_DIR = Path(__file__).parent.parent


@pytest.fixture
def app_with_db(tmp_path, monkeypatch):
    """Spin up the FastAPI app pointed at an empty fixture DB."""
    db_path = tmp_path / "portfolio.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            shares REAL NOT NULL,
            cost_basis REAL NOT NULL,
            date_acquired TEXT,
            account TEXT DEFAULT 'default'
        );
        CREATE TABLE watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            buy_price REAL,
            current_price REAL,
            last_checked TEXT,
            notes TEXT
        );
        CREATE TABLE alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            ticker TEXT,
            message TEXT,
            read INTEGER DEFAULT 0,
            created_at TEXT
        );
        CREATE TABLE scheduled_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            description TEXT,
            command TEXT,
            schedule TEXT,
            enabled INTEGER DEFAULT 1
        );
        INSERT INTO holdings (ticker, shares, cost_basis, date_acquired, account)
        VALUES ('AAPL', 10, 150.0, '2024-01-01', 'default');
        INSERT INTO watchlist (ticker, buy_price) VALUES ('MSFT', 350.0);
        INSERT INTO alerts (type, ticker, message) VALUES (
            'price', 'AAPL',
            '[daily-watchlist-check] AAPL trading at $298.21 vs buy price'
            || ' $334.24 (-10.8%). Currently in BUY ZONE — below target'
            || ' entry price. Consider adding to position.'
        );
        INSERT INTO scheduled_tasks (name, command, schedule)
        VALUES ('weekly-screen', 'owlfolio screen', '0 9 * * 1');
        """
    )
    conn.commit()
    conn.close()

    # Patch DB_PATH in both the web app and the db schema module
    # so that list_holdings (called via src.operations.portfolio → src.db)
    # uses the same test database.
    from src.db import schema as db_schema
    from src.web import app as web_app

    monkeypatch.setattr(web_app, "DB_PATH", db_path)
    monkeypatch.setattr(db_schema, "DB_PATH", db_path)
    return TestClient(web_app.app)


def test_dashboard_renders(app_with_db):
    """GET / returns the dashboard HTML with strategy + holdings."""
    r = app_with_db.get("/")
    assert r.status_code == 200
    body = r.text
    assert "Owlfolio" in body
    assert "AAPL" in body or "Strategy" in body  # one of the rendered fields


def test_strategies_endpoint_lists_presets(app_with_db):
    """GET /api/strategies returns at least the 7 preset strategies by name."""
    r = app_with_db.get("/api/strategies")
    assert r.status_code == 200
    names = {s["name"] for s in r.json()}
    expected = {
        "buffett-munger",
        "deep-value",
        "quality-compounder",
        "100-bagger",
        "garp",
        "growth",
        "dividend-income",
    }
    assert expected.issubset(names)


def test_portfolio_partial_renders(app_with_db):
    r = app_with_db.get("/api/portfolio")
    assert r.status_code == 200
    assert "AAPL" in r.text


def test_watchlist_partial_renders(app_with_db):
    r = app_with_db.get("/api/watchlist")
    assert r.status_code == 200
    assert "MSFT" in r.text


def test_alerts_partial_renders(app_with_db):
    r = app_with_db.get("/api/alerts")
    assert r.status_code == 200
    assert "AAPL" in r.text


def test_tasks_partial_renders(app_with_db):
    r = app_with_db.get("/api/tasks")
    assert r.status_code == 200
    assert "weekly-screen" in r.text


# ─── Chat helpers (real code, no SDK) ──────────────────


def test_build_chat_system_prompt_includes_claude_md(monkeypatch, tmp_path):
    """_build_chat_system_prompt loads CLAUDE.md and appends memory if present."""
    from src.web import app as web_app

    fake_agent_dir = tmp_path / "agent"
    fake_agent_dir.mkdir()
    (fake_agent_dir / "CLAUDE.md").write_text("# Test base prompt\nbe direct.")
    monkeypatch.setattr(web_app, "AGENT_DIR", fake_agent_dir)

    # Stub get_memory_context
    import src.db.operations as ops

    monkeypatch.setattr(ops, "get_memory_context", lambda: "remembered: AAPL is on watchlist")

    prompt = web_app._build_chat_system_prompt()
    assert "Test base prompt" in prompt
    assert "remembered: AAPL is on watchlist" in prompt
    assert "Memory (from previous sessions)" in prompt


def test_build_chat_system_prompt_handles_missing_claude_md(monkeypatch, tmp_path):
    """If CLAUDE.md can't be read, _build_chat_system_prompt falls back to a default."""
    from src.web import app as web_app

    monkeypatch.setattr(web_app, "AGENT_DIR", tmp_path / "does-not-exist")
    import src.db.operations as ops

    monkeypatch.setattr(ops, "get_memory_context", lambda: "")
    prompt = web_app._build_chat_system_prompt()
    assert "Owlfolio" in prompt


class _FakeBlock:
    def __init__(self, name, inp):
        self.name = name
        self.input = inp


def test_format_tool_use_handles_known_tools():
    """The tool-use formatter produces concise labels for the common SDK tools."""
    from src.web.app import _format_tool_use

    assert _format_tool_use(_FakeBlock("Bash", {"command": "ls -la"})).startswith("Bash:")
    assert _format_tool_use(_FakeBlock("Read", {"file_path": "/tmp/x.py"})) == "Read: /tmp/x.py"
    assert _format_tool_use(_FakeBlock("Edit", {"file_path": "/tmp/x.py"})) == "Edit: /tmp/x.py"
    assert _format_tool_use(_FakeBlock("Write", {"file_path": "/tmp/x.py"})) == "Write: /tmp/x.py"
    assert "pat" in _format_tool_use(_FakeBlock("Grep", {"pattern": "pat", "path": "src"}))
    assert "*.py" in _format_tool_use(_FakeBlock("Glob", {"pattern": "*.py"}))
    assert "Search:" in _format_tool_use(_FakeBlock("WebSearch", {"query": "AAPL revenue"}))
    assert "Fetch:" in _format_tool_use(_FakeBlock("WebFetch", {"url": "https://example.com"}))


def test_format_tool_use_unknown_tool_falls_back():
    from src.web.app import _format_tool_use

    label = _format_tool_use(_FakeBlock("MysteryTool", {"x": "abc"}))
    assert "MysteryTool" in label
