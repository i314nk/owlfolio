"""Tests for price-data fallbacks."""

import asyncio
import warnings

import pytest

from src.data import prices
from src.data.prices import PriceData, _web_search_price, get_price_data


def test_web_search_price_returns_gracefully_inside_async_loop():
    """FastAPI callers already run in an event loop.

    The synchronous Agent SDK web-search fallback must not call asyncio.run()
    from inside that loop, and it must not leak an un-awaited coroutine warning.
    """

    async def call_in_loop():
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = _web_search_price("FAKE")
        return data, caught

    data, caught = asyncio.run(call_in_loop())

    assert data.ticker == "FAKE"
    assert data.price == 0
    assert data.error == "NETWORK_ERROR"
    assert data.error_detail == "Cannot run web search in async loop"
    assert not [w for w in caught if "was never awaited" in str(w.message)]


def test_get_price_data_can_disable_llm_fallback(monkeypatch):
    """Safe scheduled price refreshes must not invoke Agent SDK fallback."""

    prices._ticker_failures.clear()
    prices._ticker_cooldown.clear()
    prices._ticker_last_error.clear()

    def no_price(ticker: str) -> PriceData:
        return PriceData(
            ticker=ticker,
            price=0,
            market_cap=0,
            currency="USD",
            exchange="",
            name=ticker,
            sector="",
            industry="",
        )

    monkeypatch.setattr(prices, "_yfinance_price", no_price)
    monkeypatch.setattr(prices, "_tradingview_price", no_price)
    monkeypatch.setattr(
        prices,
        "_web_search_price",
        lambda ticker: pytest.fail("LLM web-search fallback should not run"),
    )

    data = get_price_data("FAKE", allow_llm_fallback=False)

    assert data.price == 0
    assert data.error == "NO_DATA"
    assert data.error_detail == "Primary sources exhausted; LLM fallback disabled"
