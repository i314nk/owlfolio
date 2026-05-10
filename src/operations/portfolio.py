"""Portfolio operations — holdings + live P&L."""

from __future__ import annotations

from typing import Any

from src.db.operations import add_holding as db_add_holding
from src.db.operations import get_holdings as db_get_holdings
from src.db.operations import sell_holding as db_sell_holding
from src.db.schema import get_db
from src.operations import validate_ticker


def list_holdings(ticker: str | None = None, with_prices: bool = False) -> dict[str, Any]:
    """Return all holdings, optionally filtered by ticker.

    Args:
        ticker: Optional ticker to filter by (case-insensitive).
        with_prices: If True, fetches live prices via yfinance and computes P&L.

    Returns:
        {
          "holdings": [ {ticker, shares, cost_basis, account, ...}, ... ],
          "totals":   {total_value, total_cost, total_pnl, total_pnl_pct} | None,
        }
    """
    conn = get_db()
    try:
        t = validate_ticker(ticker) if ticker else None
        rows = db_get_holdings(conn, ticker=t)
    finally:
        conn.close()

    if not with_prices:
        return {"holdings": rows, "totals": None}

    # Live P&L
    from src.data.prices import get_price_data

    enriched = []
    total_value = 0.0
    total_cost = 0.0
    for h in rows:
        try:
            price = get_price_data(h["ticker"]).price
        except Exception:
            price = None
        cost = float(h["shares"]) * float(h["cost_basis"])
        value = float(h["shares"]) * price if price is not None else None
        pnl = (value - cost) if value is not None else None
        pnl_pct = (pnl / cost * 100) if (pnl is not None and cost) else None
        enriched.append({
            **h,
            "current_price": price,
            "current_value": value,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
        })
        if value is not None:
            total_value += value
            total_cost += cost

    totals = {
        "total_value": total_value,
        "total_cost": total_cost,
        "total_pnl": total_value - total_cost,
        "total_pnl_pct": ((total_value - total_cost) / total_cost * 100) if total_cost else 0.0,
    }
    return {"holdings": enriched, "totals": totals}


def is_current_holding(ticker: str) -> bool:
    """Return True if the ticker has any active holdings in the portfolio."""
    t = validate_ticker(ticker)
    conn = get_db()
    try:
        rows = db_get_holdings(conn, ticker=t)
        return len(rows) > 0
    finally:
        conn.close()


def add_holding(
    ticker: str,
    shares: float,
    cost_basis: float,
    date_acquired: str | None = None,
    account: str = "default",
    strategy: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Record a purchase. Returns the inserted row info.

    Args:
        ticker: Ticker symbol (validated).
        shares: Share count (must be > 0).
        cost_basis: Per-share cost (must be > 0).
        date_acquired: ISO date string. Defaults to today.
        account: Account label. Defaults to "default".
        strategy: Optional strategy that motivated the buy.
        notes: Optional free-text notes.
    """
    from datetime import date as _date

    t = validate_ticker(ticker)
    if not isinstance(shares, (int, float)) or shares <= 0:
        raise ValueError(f"shares must be a positive number, got {shares!r}")
    if not isinstance(cost_basis, (int, float)) or cost_basis <= 0:
        raise ValueError(f"cost_basis must be positive, got {cost_basis!r}")

    date_str = date_acquired or _date.today().isoformat()

    conn = get_db()
    try:
        holding_id = db_add_holding(
            conn,
            ticker=t,
            shares=float(shares),
            cost_basis=float(cost_basis),
            date_acquired=date_str,
            account=account,
            strategy=strategy,
            notes=notes,
        )
    finally:
        conn.close()

    return {
        "id": holding_id,
        "ticker": t,
        "shares": shares,
        "cost_basis": cost_basis,
        "date_acquired": date_str,
        "account": account,
    }


def sell_holding(ticker: str, shares: float, price: float) -> dict[str, Any]:
    """Record a sale. Returns the realized P&L on the sold shares."""
    t = validate_ticker(ticker)
    if not isinstance(shares, (int, float)) or shares <= 0:
        raise ValueError(f"shares must be positive, got {shares!r}")
    if not isinstance(price, (int, float)) or price <= 0:
        raise ValueError(f"price must be positive, got {price!r}")

    conn = get_db()
    try:
        result = db_sell_holding(conn, ticker=t, shares=float(shares), price=float(price))
    finally:
        conn.close()
    return {"ticker": t, "shares_sold": shares, "price": price, "result": result}
