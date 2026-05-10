"""Watchlist operations."""

from __future__ import annotations

from typing import Any

from src.db.operations import get_watchlist as db_get_watchlist
from src.db.schema import get_db
from src.operations import validate_ticker


def list_watchlist() -> list[dict[str, Any]]:
    """Return every ticker on the watchlist."""
    conn = get_db()
    try:
        return db_get_watchlist(conn)
    finally:
        conn.close()


def add_to_watchlist(
    ticker: str,
    buy_price: float | None = None,
    strategy: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Add a ticker to the watchlist with an optional buy price + notes."""
    t = validate_ticker(ticker)
    if buy_price is not None:
        if not isinstance(buy_price, (int, float)) or buy_price <= 0:
            raise ValueError(f"buy_price must be positive, got {buy_price!r}")

    conn = get_db()
    try:
        cur = conn.execute(
            """INSERT OR REPLACE INTO watchlist (ticker, strategy, buy_price, notes)
               VALUES (?, ?, ?, ?)""",
            (t, strategy, buy_price, notes),
        )
        conn.commit()
        return {
            "id": cur.lastrowid,
            "ticker": t,
            "strategy": strategy,
            "buy_price": buy_price,
            "notes": notes,
        }
    finally:
        conn.close()
