"""Tests for SQLite persistence layer (portfolio state, decisions, watchlist, analyses)."""

import json
import sqlite3

import pytest

from src.db.schema import get_db, _create_tables
from src.db.operations import (
    add_holding,
    get_holdings,
    update_holding,
    sell_holding,
    log_decision,
    get_decisions,
    add_to_watchlist,
    remove_from_watchlist,
    get_watchlist,
    update_watchlist_price,
    save_analysis,
    get_latest_analysis,
    get_analyses,
    add_memory,
    get_memories,
    delete_memory,
    get_memory_context,
)


@pytest.fixture
def db():
    """In-memory SQLite database for testing."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)
    return conn


# ── Schema ──────────────────────────────────────────────────────────


def test_database_initializes(db):
    """DB creates all tables on first access."""
    tables = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [row["name"] for row in tables]
    assert "holdings" in table_names
    assert "decisions" in table_names
    assert "watchlist" in table_names
    assert "analyses" in table_names


# ── Holdings CRUD ───────────────────────────────────────────────────


def test_add_holding(db):
    """Can add a new holding."""
    holding_id = add_holding(
        db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15"
    )
    assert holding_id is not None
    assert isinstance(holding_id, int)
    assert holding_id > 0


def test_get_holdings(db):
    """Can retrieve all holdings."""
    add_holding(db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15")
    add_holding(db, ticker="MSFT", shares=5.0, cost_basis=400.0, date_acquired="2025-02-01")

    holdings = get_holdings(db)
    assert len(holdings) == 2
    tickers = {h["ticker"] for h in holdings}
    assert tickers == {"AAPL", "MSFT"}


def test_get_holdings_by_ticker(db):
    """Can filter holdings by ticker."""
    add_holding(db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15")
    add_holding(db, ticker="MSFT", shares=5.0, cost_basis=400.0, date_acquired="2025-02-01")

    holdings = get_holdings(db, ticker="AAPL")
    assert len(holdings) == 1
    assert holdings[0]["ticker"] == "AAPL"
    assert holdings[0]["shares"] == 10.0
    assert holdings[0]["cost_basis"] == 150.0


def test_update_holding(db):
    """Can update shares/cost basis."""
    holding_id = add_holding(
        db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15"
    )

    update_holding(db, holding_id, shares=15.0, cost_basis=155.0)

    holdings = get_holdings(db, ticker="AAPL")
    assert holdings[0]["shares"] == 15.0
    assert holdings[0]["cost_basis"] == 155.0


def test_update_holding_partial(db):
    """Partial update only changes specified fields."""
    holding_id = add_holding(
        db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15"
    )

    update_holding(db, holding_id, notes="Added to core position")

    holdings = get_holdings(db, ticker="AAPL")
    assert holdings[0]["shares"] == 10.0  # unchanged
    assert holdings[0]["notes"] == "Added to core position"


def test_sell_holding(db):
    """Selling reduces shares. Full sell removes holding."""
    add_holding(db, ticker="AAPL", shares=10.0, cost_basis=150.0, date_acquired="2025-01-15")

    # Partial sell
    decision = sell_holding(db, ticker="AAPL", shares=3.0, price=180.0)
    assert decision is not None
    assert decision["action"] == "SELL"
    assert decision["shares"] == 3.0
    assert decision["price"] == 180.0

    holdings = get_holdings(db, ticker="AAPL")
    assert len(holdings) == 1
    assert holdings[0]["shares"] == 7.0

    # Full sell
    sell_holding(db, ticker="AAPL", shares=7.0, price=185.0)
    holdings = get_holdings(db, ticker="AAPL")
    assert len(holdings) == 0


# ── Decisions ───────────────────────────────────────────────────────


def test_log_decision(db):
    """Can log a buy/sell decision with reasoning."""
    decision_id = log_decision(
        db,
        ticker="AAPL",
        action="BUY",
        price=150.0,
        shares=10.0,
        reasoning="Strong moat, undervalued by 20%",
        strategy="buffett-munger",
    )
    assert decision_id is not None
    assert isinstance(decision_id, int)


def test_get_decisions(db):
    """Can retrieve decisions by ticker."""
    log_decision(db, ticker="AAPL", action="BUY", price=150.0, shares=10.0, reasoning="Cheap")
    log_decision(db, ticker="MSFT", action="WATCH", reasoning="Too expensive")
    log_decision(db, ticker="AAPL", action="SELL", price=180.0, shares=5.0, reasoning="Take profit")

    # All decisions
    all_decisions = get_decisions(db)
    assert len(all_decisions) == 3

    # Filtered by ticker
    aapl_decisions = get_decisions(db, ticker="AAPL")
    assert len(aapl_decisions) == 2
    assert all(d["ticker"] == "AAPL" for d in aapl_decisions)


def test_get_decisions_limit(db):
    """Limit parameter caps number of returned decisions."""
    for i in range(10):
        log_decision(db, ticker="AAPL", action="BUY", price=150.0 + i)

    decisions = get_decisions(db, limit=3)
    assert len(decisions) == 3


# ── Watchlist ───────────────────────────────────────────────────────


def test_add_to_watchlist(db):
    """Can add ticker to watchlist with strategy and buy price."""
    wl_id = add_to_watchlist(
        db, ticker="GOOG", strategy="buffett-munger", buy_price=140.0, notes="Wait for dip"
    )
    assert wl_id is not None
    assert isinstance(wl_id, int)


def test_remove_from_watchlist(db):
    """Can remove ticker from watchlist."""
    add_to_watchlist(db, ticker="GOOG")
    remove_from_watchlist(db, ticker="GOOG")

    watchlist = get_watchlist(db)
    assert len(watchlist) == 0


def test_get_watchlist(db):
    """Can retrieve full watchlist."""
    add_to_watchlist(db, ticker="GOOG", strategy="buffett-munger", buy_price=140.0)
    add_to_watchlist(db, ticker="AMZN", strategy="growth", buy_price=180.0)

    watchlist = get_watchlist(db)
    assert len(watchlist) == 2
    tickers = {w["ticker"] for w in watchlist}
    assert tickers == {"GOOG", "AMZN"}


def test_update_watchlist_price(db):
    """Can update current price on watchlist entry."""
    add_to_watchlist(db, ticker="GOOG", buy_price=140.0)
    update_watchlist_price(db, ticker="GOOG", current_price=155.0)

    watchlist = get_watchlist(db)
    assert watchlist[0]["current_price"] == 155.0


# ── Analyses ────────────────────────────────────────────────────────


def test_save_analysis(db):
    """Can save an analysis result."""
    analysis_id = save_analysis(
        db,
        ticker="AAPL",
        strategy="buffett-munger",
        decision="BUY",
        buy_price=140.0,
        current_price=150.0,
        quality_tier="A",
        weighted_score=0.82,
        thesis="Strong moat with pricing power",
        bull_case="Services growth accelerating",
        bear_case="China risk",
        key_risks=["regulatory", "competition"],
        overrides={"hurdle_rate": 0.10},
    )
    assert analysis_id is not None
    assert isinstance(analysis_id, int)


def test_get_latest_analysis(db):
    """Can retrieve most recent analysis for a ticker."""
    save_analysis(
        db,
        ticker="AAPL",
        strategy="buffett-munger",
        decision="WATCH",
        buy_price=140.0,
        current_price=160.0,
        quality_tier="A",
        weighted_score=0.80,
        thesis="First analysis",
        bull_case="Bull 1",
        bear_case="Bear 1",
        key_risks=["risk1"],
        overrides={},
    )
    save_analysis(
        db,
        ticker="AAPL",
        strategy="buffett-munger",
        decision="BUY",
        buy_price=140.0,
        current_price=145.0,
        quality_tier="A",
        weighted_score=0.85,
        thesis="Second analysis — price dropped",
        bull_case="Bull 2",
        bear_case="Bear 2",
        key_risks=["risk1", "risk2"],
        overrides={"hurdle_rate": 0.10},
    )

    latest = get_latest_analysis(db, ticker="AAPL")
    assert latest is not None
    assert latest["decision"] == "BUY"
    assert latest["thesis"] == "Second analysis — price dropped"
    assert latest["weighted_score"] == 0.85
    # JSON fields are deserialized
    assert latest["key_risks"] == ["risk1", "risk2"]
    assert latest["overrides"] == {"hurdle_rate": 0.10}


def test_get_latest_analysis_none(db):
    """Returns None when no analysis exists for ticker."""
    result = get_latest_analysis(db, ticker="XYZ")
    assert result is None


def test_get_analyses(db):
    """Can retrieve multiple analyses with limit."""
    for i in range(5):
        save_analysis(
            db,
            ticker="AAPL",
            strategy="buffett-munger",
            decision="WATCH",
            buy_price=140.0,
            current_price=150.0 + i,
            quality_tier="A",
            weighted_score=0.80 + i * 0.01,
            thesis=f"Analysis {i}",
            bull_case=f"Bull {i}",
            bear_case=f"Bear {i}",
            key_risks=[],
            overrides={},
        )

    analyses = get_analyses(db, ticker="AAPL", limit=3)
    assert len(analyses) == 3


def test_save_and_retrieve_analysis(db):
    """Save analysis, retrieve it, verify all fields."""
    analysis_id = save_analysis(
        db,
        ticker="MSFT",
        strategy="buffett-munger",
        decision="BUY",
        buy_price=350.0,
        current_price=320.0,
        quality_tier="wide",
        weighted_score=4.2,
        thesis="Dominant cloud position with durable moat",
        bull_case="AI integration accelerating Azure growth",
        bear_case="Antitrust risk and slowing enterprise spend",
        key_risks=["regulatory", "competition", "valuation"],
        overrides={"hurdle_rate": 0.10, "growth_haircut": 0.25},
    )
    assert analysis_id is not None

    latest = get_latest_analysis(db, ticker="MSFT")
    assert latest is not None
    assert latest["ticker"] == "MSFT"
    assert latest["strategy"] == "buffett-munger"
    assert latest["decision"] == "BUY"
    assert latest["buy_price"] == 350.0
    assert latest["current_price"] == 320.0
    assert latest["quality_tier"] == "wide"
    assert latest["weighted_score"] == 4.2
    assert latest["thesis"] == "Dominant cloud position with durable moat"
    assert latest["bull_case"] == "AI integration accelerating Azure growth"
    assert latest["bear_case"] == "Antitrust risk and slowing enterprise spend"
    assert latest["key_risks"] == ["regulatory", "competition", "valuation"]
    assert latest["overrides"] == {"hurdle_rate": 0.10, "growth_haircut": 0.25}


def test_get_analyses_by_ticker(db):
    """Filter analyses by ticker."""
    save_analysis(
        db, ticker="AAPL", strategy="buffett-munger", decision="WATCH",
        buy_price=140.0, current_price=150.0, quality_tier="wide",
        weighted_score=3.8, thesis="T1", bull_case="B1", bear_case="R1",
        key_risks=[], overrides={},
    )
    save_analysis(
        db, ticker="GOOG", strategy="growth", decision="BUY",
        buy_price=160.0, current_price=140.0, quality_tier="narrow",
        weighted_score=3.2, thesis="T2", bull_case="B2", bear_case="R2",
        key_risks=["risk"], overrides={},
    )
    save_analysis(
        db, ticker="AAPL", strategy="buffett-munger", decision="BUY",
        buy_price=140.0, current_price=130.0, quality_tier="wide",
        weighted_score=4.0, thesis="T3", bull_case="B3", bear_case="R3",
        key_risks=[], overrides={},
    )

    aapl = get_analyses(db, ticker="AAPL")
    assert len(aapl) == 2
    assert all(a["ticker"] == "AAPL" for a in aapl)
    # Most recent first
    assert aapl[0]["decision"] == "BUY"
    assert aapl[1]["decision"] == "WATCH"

    goog = get_analyses(db, ticker="GOOG")
    assert len(goog) == 1
    assert goog[0]["ticker"] == "GOOG"

    # No filter returns all
    all_analyses = get_analyses(db, limit=50)
    assert len(all_analyses) == 3


# ── Memory ─────────────────────────────────────────────────────────


@pytest.fixture
def mock_db(db, monkeypatch):
    """Monkeypatch get_db to return the in-memory test DB."""
    monkeypatch.setattr("src.db.operations.get_db", lambda: db)
    yield db


# ── Memory ─────────────────────────────────────────────────────────


def test_database_has_memory_table(db):
    """DB creates memory table."""
    tables = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [row["name"] for row in tables]
    assert "memory" in table_names


def test_add_memory(mock_db):
    """Can add a memory entry."""
    memory_id = add_memory("preference", "Prefers concentrated portfolios")
    assert memory_id is not None
    assert isinstance(memory_id, int)
    assert memory_id > 0


def test_add_memory_with_ticker(mock_db):
    """Can add a memory with associated ticker."""
    memory_id = add_memory("observation", "SPGI near buy zone", ticker="SPGI")
    assert memory_id > 0

    mems = get_memories(ticker="SPGI")
    assert len(mems) == 1
    assert mems[0]["ticker"] == "SPGI"
    assert mems[0]["category"] == "observation"


def test_add_memory_invalid_category(mock_db):
    """Rejects invalid category."""
    with pytest.raises(ValueError, match="Invalid category"):
        add_memory("invalid_cat", "some content")


def test_get_memories_all(mock_db):
    """Can retrieve all memories."""
    add_memory("preference", "Prefers concentrated portfolios")
    add_memory("observation", "SPGI near buy zone", ticker="SPGI")
    add_memory("context", "Uses primary broker for US stocks")

    mems = get_memories()
    assert len(mems) == 3


def test_get_memories_by_category(mock_db):
    """Can filter memories by category."""
    add_memory("preference", "Prefers concentrated portfolios")
    add_memory("observation", "SPGI near buy zone", ticker="SPGI")
    add_memory("preference", "Uses buffett-munger strategy")

    mems = get_memories(category="preference")
    assert len(mems) == 2
    assert all(m["category"] == "preference" for m in mems)


def test_get_memories_by_ticker(mock_db):
    """Can filter memories by ticker."""
    add_memory("observation", "SPGI near buy zone", ticker="SPGI")
    add_memory("observation", "NVDA PEG ratio low", ticker="NVDA")
    add_memory("preference", "Prefers concentrated portfolios")

    mems = get_memories(ticker="SPGI")
    assert len(mems) == 1
    assert mems[0]["ticker"] == "SPGI"


def test_get_memories_limit(mock_db):
    """Limit parameter caps number of returned memories."""
    for i in range(10):
        add_memory("preference", f"Preference {i}")

    mems = get_memories(limit=3)
    assert len(mems) == 3


def test_delete_memory(mock_db):
    """Can delete a memory by ID."""
    memory_id = add_memory("preference", "Delete me")
    delete_memory(memory_id)

    mems = get_memories()
    assert len(mems) == 0


def test_get_memory_context_empty(mock_db):
    """Returns empty string when no memories exist."""
    ctx = get_memory_context()
    assert ctx == ""


def test_get_memory_context_formatted(mock_db):
    """Returns formatted memory context grouped by category."""
    add_memory("preference", "Prefers concentrated portfolios")
    add_memory("preference", "Uses buffett-munger strategy")
    add_memory("observation", "SPGI near buy zone", ticker="SPGI")

    ctx = get_memory_context()
    assert "## User Preferences" in ctx
    assert "Prefers concentrated portfolios" in ctx
    assert "Uses buffett-munger strategy" in ctx
    assert "## Recent Observations" in ctx
    assert "SPGI near buy zone" in ctx
    assert "[SPGI]" in ctx
