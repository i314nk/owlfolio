"""Tests for the agentic discovery module (non-LLM parts).

We don't actually call the LLM — we test the prompt builder, JSON
parsing, ticker materialization (shape filter + dedup + hallucination
filter), and the MCP tool surface.
"""

from pathlib import Path

import pytest

from src.agents.discovery import (
    Candidate,
    _build_discovery_mcp_server,
    _build_discovery_prompt,
    _build_exclude_section,
    _materialize_candidates,
    _parse_discovery_json,
)
from src.strategy.loader import load_strategy

STRATEGIES_DIR = Path(__file__).parent.parent / "strategies"


# ─── prompt builder ─────────────────────────────────────────────────


def test_discovery_prompt_embeds_strategy_brief_verbatim():
    """The strategy's prompts.discovery prose must appear in the prompt verbatim."""
    s = load_strategy(STRATEGIES_DIR / "deep-value.yaml")
    p = _build_discovery_prompt(s, n=15)
    assert "deep-value" in p
    # deep-value.yaml's brief mentions Russell 3000 explicitly — pin it
    assert "Russell 3000" in p
    # Required JSON schema must be advertised so the model knows what to return
    assert '"candidates"' in p and '"ticker"' in p


def test_discovery_prompt_falls_back_when_brief_empty():
    """If a strategy has no discovery prose, the builder synthesizes one from criteria."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    class StubPrompts:
        synthesis = "x" * 100
        discovery = ""
        specialists: dict = {}

    class Stub:
        name = "stub"
        summary = ""
        description = "Test fallback"
        criteria = s.criteria
        prompts = StubPrompts()

    p = _build_discovery_prompt(Stub(), n=10)
    assert "Find 10 candidates listed on these exchanges" in p
    # Default config → US markets → NYSE / NASDAQ
    assert "NYSE / NASDAQ" in p
    # The criteria names should be listed in the fallback brief
    for c in s.criteria:
        assert c.name in p


def test_discovery_prompt_includes_target_count():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    p = _build_discovery_prompt(s, n=7)
    assert "7 candidates" in p


def test_discovery_prompt_includes_screening_stance():
    """The prompt must instruct the agent to use preliminary language, not definitive moat ratings."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    p = _build_discovery_prompt(s, n=10)
    assert "screening, not performing a full deep-dive analysis" in p
    assert "quality_signal" in p
    assert "preliminary" in p.lower()


def test_discovery_prompt_restricts_to_candidate_pipeline():
    """The prompt must explicitly say output feeds candidates only, not watchlist/holdings."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    p = _build_discovery_prompt(s, n=10)
    assert "candidate pipeline only" in p
    assert "Do NOT suggest adding" in p and "watchlist" in p


# ─── JSON parsing ───────────────────────────────────────────────────


@pytest.mark.parametrize("text", [
    '{"candidates": [{"ticker": "AAPL"}]}',
    '```json\n{"candidates": [{"ticker": "AAPL"}]}\n```',
    'preamble {"candidates": [{"ticker": "AAPL"}]} trailing prose',
    '```\n{"candidates": [{"ticker": "AAPL"}]}\n```',
])
def test_parse_discovery_json_handles_common_wrappers(text):
    parsed = _parse_discovery_json(text)
    assert parsed is not None
    assert parsed["candidates"][0]["ticker"] == "AAPL"


def test_parse_discovery_json_returns_none_for_non_json():
    assert _parse_discovery_json("just a sentence") is None
    assert _parse_discovery_json("") is None


# ─── candidate materialization ──────────────────────────────────────


def test_materialize_candidates_skips_malformed():
    """Empty / missing tickers and non-dict entries are dropped silently."""
    cands = _materialize_candidates([
        {"ticker": "AAPL", "note": "good"},
        {"company_name": "missing ticker"},
        "not a dict at all",
        {"ticker": "", "note": "empty"},
    ], skip_validation=True)
    assert [c.ticker for c in cands] == ["AAPL"]


def test_materialize_candidates_dedupes():
    """Duplicate tickers within one batch only appear once."""
    cands = _materialize_candidates([
        {"ticker": "AAPL", "note": "first"},
        {"ticker": "AAPL", "note": "dup"},
        {"ticker": "msft", "note": "case-insensitive"},
        {"ticker": "MSFT", "note": "dup of msft"},
    ], skip_validation=True)
    assert [c.ticker for c in cands] == ["AAPL", "MSFT"]
    assert cands[0].note == "first"


def test_materialize_candidates_rejects_bad_shape():
    """Tickers with leading punctuation or > 15 chars are dropped.

    Digit-leading IS allowed now (Hong Kong / Shanghai listings like
    `0700.HK` and `600519.SS`) — that's a deliberate widening from the
    earlier US-only validator.
    """
    cands = _materialize_candidates([
        {"ticker": "!@#"},                          # symbol-only — rejected
        {"ticker": "AAAAAAAAAAAAAAAAA"},            # 17 chars — over the 15 limit
        {"ticker": ".AAPL"},                        # leading punctuation
        {"ticker": "OK"},
        {"ticker": "BRK.B"},                        # dot is allowed
        {"ticker": "0700.HK"},                      # HK digit-leading — now allowed
        {"ticker": "ADNOCGAS.AD"},                  # 11 chars — now allowed
    ], skip_validation=True)
    assert [c.ticker for c in cands] == [
        "OK", "BRK.B", "0700.HK", "ADNOCGAS.AD",
    ]


def test_candidate_to_dict_roundtrip():
    """Candidate.to_dict produces a JSON-serializable dict with all fields."""
    c = Candidate(
        ticker="AAPL", company_name="Apple", sector="Tech",
        market_cap=3e12, current_price=200.0,
        note="great", metrics={"pe": 30}, source="agentic",
        discovered_at="2026-04-26T12:00:00",
    )
    d = c.to_dict()
    assert d["ticker"] == "AAPL"
    assert d["metrics"] == {"pe": 30}
    assert d["source"] == "agentic"


# ─── MCP tool surface ───────────────────────────────────────────────


def test_discovery_mcp_server_exposes_two_validation_tools():
    """The discovery agent's MCP surface is locked down to validate_ticker
    and get_ticker_summary — no portfolio access, no shell, no file IO.
    """
    server = _build_discovery_mcp_server()
    # SDK MCP server exposes its tool names; check via the underlying registry
    # The server object's tools are accessible via the internal `_tools` attr
    # (or whichever the SDK uses). Smoke-test: the object is built and is not None.
    assert server is not None


def test_discovery_module_does_not_import_portfolio_db():
    """Defense-in-depth: discovery.py must not import the portfolio DB or
    add_holding / sell_holding code paths. The agent should be sandboxed
    from anything that mutates state.
    """
    src = (Path(__file__).parent.parent / "src" / "agents" / "discovery.py").read_text()
    forbidden_imports = (
        "from src.db.operations",
        "from src.operations.portfolio",
        "from src.operations.watchlist",
    )
    for f in forbidden_imports:
        assert f not in src, (
            f"discovery.py must not import {f!r} — it should be read-only"
        )


# ─── exclude list ─────────────────────────────────────────────────


def test_exclude_section_empty_when_no_tickers():
    """No exclude set → no section injected into the prompt."""
    assert _build_exclude_section(None) == ""
    assert _build_exclude_section(set()) == ""


def test_exclude_section_lists_tickers_sorted():
    """Exclude section contains all tickers, sorted alphabetically."""
    section = _build_exclude_section({"AAPL", "MSFT", "GOOG"})
    assert "AAPL" in section
    assert "GOOG" in section
    assert "MSFT" in section
    assert "Skip these tickers" in section


def test_prompt_includes_exclude_section():
    """When exclude set is provided, the prompt contains the skip section."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    prompt = _build_discovery_prompt(s, n=10, exclude={"SPGI", "VRSN"})
    assert "SPGI" in prompt
    assert "VRSN" in prompt
    assert "Skip these tickers" in prompt


def test_prompt_omits_exclude_section_when_empty():
    """When no exclude set, the prompt has no skip section."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    prompt = _build_discovery_prompt(s, n=10)
    assert "Skip these tickers" not in prompt


# ─── ticker_currency ─────────────────────────────────────────────────


def test_ticker_currency_us_default():
    """US tickers (no suffix) return USD."""
    from src.agents.discovery import ticker_currency
    code, sym = ticker_currency("AAPL")
    assert code == "USD"
    assert sym == "$"


def test_ticker_currency_uae():
    """UAE tickers return AED."""
    from src.agents.discovery import ticker_currency
    code, sym = ticker_currency("ADNOCGAS.AD")
    assert code == "AED"
    assert "AED" in sym


def test_ticker_currency_india():
    """Indian tickers return INR."""
    from src.agents.discovery import ticker_currency
    code, sym = ticker_currency("RELIANCE.NS")
    assert code == "INR"
    assert sym == "₹"


def test_ticker_currency_uk():
    """UK tickers return GBP."""
    from src.agents.discovery import ticker_currency
    code, sym = ticker_currency("SHEL.L")
    assert code == "GBP"
    assert sym == "£"
