"""Price and market data connector.

Three-tier lookup in get_price_data():
  1. yfinance (free, broad coverage, sometimes flaky)
  2. Google Finance scrape (covers markets yfinance misses: UAE/ADX,
     DFM, and others — free, no API key, lightweight HTTP request)
  3. LLM web-search fallback (Haiku + WebSearch) as last resort
  4. Empty PriceData(price=0.0) if everything fails — never raises.

yfinance is an unofficial Yahoo Finance scraper. It is the cheapest
source, not the most reliable. See docs/ARCHITECTURE.md → Market Data
for the full reliability tradeoffs and hardening options (Finnhub /
Alpha Vantage second-tier fallback, broker APIs, paid feeds).
"""

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime

import requests
import yfinance as yf

logger = logging.getLogger(__name__)

# Per-ticker failure tracking to avoid retrying tickers that consistently
# fail (e.g. ADX:LULU 404 spam).  After _MAX_FAILURES consecutive failures
# the ticker is skipped for _COOLDOWN_SECONDS.
_MAX_FAILURES = 3
_COOLDOWN_SECONDS = 3600  # 1 hour
_ticker_failures: dict[str, int] = {}  # ticker -> consecutive failure count
_ticker_cooldown: dict[str, float] = {}  # ticker -> time.monotonic() when cooldown expires
_ticker_last_error: dict[str, str] = {}  # ticker -> last error reason

_COOLDOWN_BY_ERROR: dict[str, int] = {
    "TICKER_NOT_FOUND": 86400,  # 24 hours — ticker doesn't exist
    "NETWORK_ERROR": 600,  # 10 minutes — transient network/timeout
}
_COOLDOWN_DEFAULT = 3600  # 1 hour — other/unknown errors


@dataclass
class PriceData:
    """Current price and market data for a ticker."""

    ticker: str
    price: float
    market_cap: float
    currency: str
    exchange: str
    name: str
    sector: str
    industry: str
    next_earnings_date: datetime | None = None
    error: str | None = None  # e.g. TICKER_NOT_FOUND, NO_DATA
    error_detail: str | None = None  # Human-readable explanation


# Ticker suffixes where yfinance is known to return nothing.
# Skip it entirely for these — go straight to Google Finance.
_YFINANCE_BLIND_SPOTS = {".AD", ".DH"}  # ADX, DFM


def _is_yfinance_blind_spot(ticker: str) -> bool:
    """Check if this ticker is in a market yfinance doesn't cover."""
    t = ticker.upper()
    return any(t.endswith(suffix) for suffix in _YFINANCE_BLIND_SPOTS)


def get_price_data(ticker: str) -> PriceData:
    """Get current price data. Three-tier fallback chain.

    Args:
        ticker: Stock ticker (e.g., "AAPL", "ADNOCGAS.AD").

    Returns:
        PriceData with current market information.
    """
    ticker = _normalize_ticker(ticker)
    import time as _time

    # Check cooldown for repeatedly-failing tickers (e.g. ADX:LULU)
    cooldown_until = _ticker_cooldown.get(ticker)
    if cooldown_until is not None and _time.monotonic() < cooldown_until:
        logger.debug(
            "Skipping %s — on cooldown after %d failures",
            ticker,
            _MAX_FAILURES,
        )
        return PriceData(
            ticker=ticker.upper(),
            price=0.0,
            market_cap=0.0,
            currency="USD",
            exchange="",
            name=ticker,
            sector="",
            industry="",
            error="COOLDOWN",
            error_detail=f"Skipped — on cooldown after {_MAX_FAILURES} consecutive failures",
        )

    # Tier 1: yfinance (skip for known blind spots)
    if not _is_yfinance_blind_spot(ticker):
        try:
            data = _yfinance_price(ticker)
            if data.price and data.price > 0:
                _ticker_failures.pop(ticker, None)
                _ticker_cooldown.pop(ticker, None)
                _ticker_last_error.pop(ticker, None)
                return data
        except Exception as e:
            err_str = str(e)
            if "404" in err_str or "Not Found" in err_str:
                _ticker_last_error[ticker] = "TICKER_NOT_FOUND"
            else:
                _ticker_last_error[ticker] = "NETWORK_ERROR"
            logger.debug("yfinance failed for %s: %s", ticker, e)

    # Tier 2: TradingView scanner (lightweight, covers all markets incl. UAE)
    try:
        data = _tradingview_price(ticker)
        if data.price and data.price > 0:
            _ticker_failures.pop(ticker, None)
            _ticker_cooldown.pop(ticker, None)
            _ticker_last_error.pop(ticker, None)
            return data
    except Exception as e:
        _ticker_last_error[ticker] = "NETWORK_ERROR"
        logger.debug("TradingView failed for %s: %s", ticker, e)

    # Track consecutive failures — skip web search after too many
    count = _ticker_failures.get(ticker, 0) + 1
    _ticker_failures[ticker] = count
    if count >= _MAX_FAILURES:
        err_type = _ticker_last_error.get(ticker, "")
        cooldown = _COOLDOWN_BY_ERROR.get(err_type, _COOLDOWN_DEFAULT)
        logger.warning(
            "Ticker %s failed %d times consecutively — cooling down for %ds (%s)",
            ticker,
            count,
            cooldown,
            err_type or "unknown",
        )
        _ticker_cooldown[ticker] = _time.monotonic() + cooldown
        return PriceData(
            ticker=ticker.upper(),
            price=0.0,
            market_cap=0.0,
            currency="USD",
            exchange="",
            name=ticker,
            sector="",
            industry="",
            error="NO_DATA",
            error_detail=f"Failed {count} times consecutively across yfinance and TradingView",
        )

    # Tier 3: LLM web search (heavy, last resort)
    logger.info("Primary sources returned no price for %s, trying web search", ticker)
    return _web_search_price(ticker)


def _yfinance_price(ticker: str) -> PriceData:
    """Fetch price data from yfinance."""
    stock = yf.Ticker(ticker)
    info = stock.info

    # Extract with safe defaults
    price = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
    market_cap = info.get("marketCap") or 0.0
    currency = info.get("currency", "USD")
    exchange = info.get("exchange", "")
    name = info.get("longName") or info.get("shortName") or ticker
    sector = info.get("sector", "")
    industry = info.get("industry", "")

    # Next earnings date
    earnings_date = None
    cal = stock.calendar
    if cal is not None and not cal.empty if hasattr(cal, "empty") else cal:
        try:
            if isinstance(cal, dict) and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                if dates:
                    earnings_date = dates[0] if isinstance(dates, list) else dates
        except (KeyError, IndexError, TypeError):
            pass

    return PriceData(
        ticker=ticker.upper(),
        price=float(price),
        market_cap=float(market_cap),
        currency=currency,
        exchange=exchange,
        name=name,
        sector=sector,
        industry=industry,
        next_earnings_date=earnings_date,
    )


# ���── TradingView scanner fallback ────────────────────────────────────
#
# TradingView's scanner API is free, requires no API key, and covers
# every market including UAE (ADX/DFM), Saudi, India, HK, UK, US.
# yfinance uses ticker.suffix format (e.g. "ADNOCGAS.AD"); TradingView
# uses EXCHANGE:TICKER format (e.g. "ADX:ADNOCGAS").

_SUFFIX_TO_TV_EXCHANGE = {
    ".AD": "ADX",  # Abu Dhabi Securities Exchange
    ".DH": "DFM",  # Dubai Financial Market
    ".SR": "TADAWUL",  # Saudi Tadawul
    ".NS": "NSE",  # National Stock Exchange of India
    ".BO": "BSE",  # Bombay Stock Exchange
    ".L": "LSE",  # London Stock Exchange
    ".HK": "HKEX",  # Hong Kong
    ".T": "TSE",  # Tokyo
    ".AX": "ASX",  # Australian Securities Exchange
    ".TO": "TSX",  # Toronto Stock Exchange
    ".DE": "XETR",  # XETRA / Frankfurt
    ".SA": "BMFBOVESPA",  # B3 (Brasil Bolsa Balcão)
}

_TV_EXCHANGE_TO_SUFFIX = {v: k for k, v in _SUFFIX_TO_TV_EXCHANGE.items()}


def _normalize_ticker(ticker: str) -> str:
    """Convert EXCHANGE:SYMBOL (e.g. ADX:LULU) to yfinance format (LULU.AD).

    Returns the ticker unchanged if it's already in yfinance format.
    """
    if ":" in ticker:
        exchange, symbol = ticker.split(":", 1)
        suffix = _TV_EXCHANGE_TO_SUFFIX.get(exchange.upper())
        if suffix:
            return f"{symbol.upper()}{suffix}"
        # Unknown exchange — return as-is (will likely fail downstream,
        # but no worse than the EXCHANGE:SYMBOL format)
        return ticker
    return ticker


def _to_tv_symbol(ticker: str) -> str:
    """Convert a yfinance-style ticker to TradingView EXCHANGE:TICKER format."""
    t = ticker.upper()
    for suffix, exchange in _SUFFIX_TO_TV_EXCHANGE.items():
        if t.endswith(suffix):
            return f"{exchange}:{t[: -len(suffix)]}"
    # No suffix → assume US; try NYSE first (TradingView resolves it)
    return f"NYSE:{t}"


def _tradingview_price(ticker: str) -> PriceData:
    """Fetch price from TradingView's global scanner API.

    Covers all major markets including UAE/ADX, DFM, Saudi, India, etc.
    No API key required. Single HTTP POST, returns structured JSON.
    """
    tv_symbol = _to_tv_symbol(ticker)
    url = "https://scanner.tradingview.com/global/scan"
    payload = {
        "columns": ["close", "name", "currency", "market_cap_basic", "sector", "industry"],
        "symbols": {"tickers": [tv_symbol]},
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    rows = data.get("data", [])
    if not rows:
        return PriceData(
            ticker=ticker.upper(),
            price=0.0,
            market_cap=0.0,
            currency="USD",
            exchange="",
            name=ticker,
            sector="",
            industry="",
        )

    cols = rows[0]["d"]
    exchange = tv_symbol.split(":")[0] if ":" in tv_symbol else ""

    return PriceData(
        ticker=ticker.upper(),
        price=float(cols[0] or 0),
        market_cap=float(cols[3] or 0),
        currency=cols[2] or "USD",
        exchange=exchange,
        name=cols[1] or ticker,
        sector=cols[4] or "",
        industry=cols[5] or "",
    )


def _web_search_price(ticker: str) -> PriceData:
    """Fallback: get price via web search using Agent SDK.

    Works for non-US tickers and other cases where yfinance fails.
    """
    import asyncio
    from pathlib import Path

    async def _search():
        from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

        from src.llm.provider import _agent_sdk_model

        result_text = ""
        async for msg in query(
            prompt=(
                f"Search for the current stock price of {ticker}. "
                f"Return ONLY valid JSON (no markdown, no explanation): "
                f'{{"price": 123.45, "currency": "USD", "name": "Company Name", '
                f'"market_cap": 100000000000, "sector": "", "industry": ""}}'
            ),
            options=ClaudeAgentOptions(
                model=_agent_sdk_model("claude-haiku-4-5-20250507"),
                permission_mode="bypassPermissions",
                cwd=str(Path.home()),
                allowed_tools=["WebSearch"],
            ),
        ):
            if isinstance(msg, ResultMessage) and msg.result:
                result_text = msg.result

        return result_text

    try:
        result_text = asyncio.run(_search())
    except RuntimeError:
        # Already inside an async event loop (e.g. called from FastAPI).
        # Spawning a new loop or run_until_complete would block the server's
        # event loop, killing WebSocket connections. Return gracefully —
        # callers (activity feed, etc.) have fallback prices.
        logger.info("Skipping web search for %s (already in async loop)", ticker)
        return PriceData(
            ticker=ticker.upper(),
            price=0,
            market_cap=0,
            currency="USD",
            exchange="",
            name=ticker,
            sector="",
            industry="",
            error="NETWORK_ERROR",
            error_detail="Cannot run web search in async loop",
        )
    except Exception as e:
        # Agent SDK can crash (nested invocation, missing key, etc.)
        logger.warning("Agent SDK web search failed for %s: %s", ticker, e)
        result_text = ""

    if result_text:
        data = _parse_price_json(result_text)
        if data:
            return PriceData(
                ticker=ticker.upper(),
                price=float(data.get("price", 0)),
                market_cap=float(data.get("market_cap", 0)),
                currency=data.get("currency", "USD"),
                exchange="",
                name=data.get("name", ticker),
                sector=data.get("sector", ""),
                industry=data.get("industry", ""),
            )

    # Last resort: return empty data
    return PriceData(
        ticker=ticker.upper(),
        price=0.0,
        market_cap=0.0,
        currency="USD",
        exchange="",
        name=ticker,
        sector="",
        industry="",
        error="NO_DATA",
        error_detail="All sources exhausted: yfinance, TradingView, web search",
    )


def _parse_price_json(text: str) -> dict | None:
    """Parse JSON from web search response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON from markdown code blocks
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    logger.warning("Could not parse price JSON: %s", text[:200])
    return None


def get_price_history(ticker: str, period: str = "5y") -> list[dict]:
    """Get historical price data.

    Args:
        ticker: Stock ticker.
        period: Time period (1y, 2y, 5y, 10y, max).

    Returns:
        List of {"date": str, "close": float} dicts, oldest first.
    """
    ticker = _normalize_ticker(ticker)
    stock = yf.Ticker(ticker)
    hist = stock.history(period=period)

    if hist.empty:
        return []

    result = []
    for date, row in hist.iterrows():
        result.append(
            {
                "date": str(date.date()) if hasattr(date, "date") else str(date),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if "Volume" in row else 0,
            }
        )

    return result


def calculate_growth_rate(
    ticker: str,
    years: int = 5,
    haircut: float = 0.0,
    max_rate: float = 1.0,
) -> float | None:
    """Calculate price CAGR over a period.

    Note: This is price-based growth, not revenue growth.
    Revenue growth should come from EDGAR multi-year data.

    Args:
        ticker: Stock ticker.
        years: Number of years for CAGR.
        haircut: Percentage to reduce growth (0.3 = 30% haircut).
        max_rate: Maximum allowed growth rate.

    Returns:
        Annualized growth rate as decimal, or None.
    """
    ticker = _normalize_ticker(ticker)
    history = get_price_history(ticker, period=f"{years}y")

    if len(history) < 2:
        return None

    start_price = history[0]["close"]
    end_price = history[-1]["close"]

    if start_price <= 0:
        return None

    # CAGR formula
    n_years = len(history) / 252  # approximate trading days per year
    if n_years <= 0:
        return None

    cagr = (end_price / start_price) ** (1 / n_years) - 1

    # Apply haircut
    cagr = cagr * (1 - haircut)

    # Cap at maximum
    cagr = min(cagr, max_rate)

    return cagr
