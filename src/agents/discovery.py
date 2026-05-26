"""Agentic discovery — find candidate tickers for a strategy.

This is the *replacement* for the legacy Finviz screener. Instead of a
deterministic numeric filter, the discovery agent reads the strategy's
`prompts.discovery` prose (which describes the universe, biases, and
avoid-list in plain English) and uses WebSearch + WebFetch + a tiny MCP
tool surface to compile a candidate list.

Design notes:

  * **Slow + costly + non-deterministic by design.** This is what the
    user accepts in exchange for natural-language strategy descriptions.
    For deterministic candidate sourcing, the user can paste a CSV via
    `owlfolio import` instead.

  * **Tool surface is locked down.** The model gets only:
      - WebSearch / WebFetch (read-only public web)
      - get_ticker_summary  (yfinance lookup — name, sector, mcap, price)
      - validate_ticker     (yfinance probe — does this symbol exist?)
    No Bash, no Read, no Glob, no Grep, no portfolio access.

  * **Every ticker is yfinance-validated** before persistence. The model
    is prone to hallucinating plausible-looking tickers; we drop any
    that don't resolve to a live yfinance security.

  * **Output schema is enforced.** The model returns JSON that we parse
    into a list of `Candidate` objects. Free-form prose-only output is
    rejected.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from src.strategy.loader import Strategy

logger = logging.getLogger("owlfolio.discovery")

# ─── market code → exchange name mapping ────────────────────────────

MARKET_EXCHANGES: dict[str, str] = {
    "US": "NYSE / NASDAQ",
    "IN": "NSE / BSE",
    "AE": "ADX / DFM",
    "UK": "LSE",
    "HK": "HKEX",
    "CA": "TSX",
    "CN": "SSE / SZSE",
    "JP": "TSE",
    "AU": "ASX",
    "SA": "Tadawul",
    "DE": "XETRA",
    "BR": "B3",
}

MARKET_ACCOUNTING: dict[str, str] = {
    "US": "US GAAP",
    "IN": "IFRS (Ind AS)",
    "AE": "IFRS",
    "UK": "IFRS (UK-adopted)",
    "HK": "HKFRS (IFRS-converged)",
    "CA": "IFRS",
    "JP": "J-GAAP or IFRS (varies by company)",
    "AU": "IFRS (AASB)",
    "SA": "IFRS",
    "DE": "IFRS",
    "BR": "IFRS (CPC-converged)",
}

# Ticker suffix → market code mapping (yfinance conventions)
_SUFFIX_TO_MARKET: dict[str, str] = {
    ".NS": "IN",
    ".BO": "IN",
    ".AD": "AE",
    ".DFM": "AE",
    ".L": "UK",
    ".HK": "HK",
    ".TO": "CA",
    ".T": "JP",
    ".AX": "AU",
    ".SR": "SA",
    ".DE": "DE",
    ".SA": "BR",
}


def detect_market(ticker: str) -> str:
    """Detect market code from a ticker's exchange suffix. Defaults to 'US'."""
    for suffix, market in _SUFFIX_TO_MARKET.items():
        if ticker.upper().endswith(suffix.upper()):
            return market
    return "US"


def accounting_context(ticker: str) -> str:
    """Return a one-liner about the accounting standard for a ticker's market."""
    market = detect_market(ticker)
    standard = MARKET_ACCOUNTING.get(market, "IFRS")
    return (
        f"This company reports under {standard} ({market}). "
        "If comparing metrics with companies from other markets, "
        "note any accounting standard differences that affect the comparison."
    )


# Market code → (currency code, currency symbol)
_MARKET_CURRENCY: dict[str, tuple[str, str]] = {
    "US": ("USD", "$"),
    "IN": ("INR", "₹"),
    "AE": ("AED", "AED "),
    "UK": ("GBP", "£"),
    "HK": ("HKD", "HK$"),
    "CA": ("CAD", "C$"),
    "JP": ("JPY", "¥"),
    "AU": ("AUD", "A$"),
    "SA": ("SAR", "SAR "),
    "DE": ("EUR", "€"),
    "BR": ("BRL", "R$"),
}


def ticker_currency(ticker: str) -> tuple[str, str]:
    """Return (currency_code, currency_symbol) for a ticker.

    Derives from the ticker's exchange suffix. Defaults to ("USD", "$").
    The symbol includes a trailing space for codes that use a prefix word
    (e.g. "AED 2.90" vs "$2.90").

    >>> ticker_currency("ADNOCGAS.AD")
    ('AED', 'AED ')
    >>> ticker_currency("AAPL")
    ('USD', '$')
    """
    market = detect_market(ticker)
    return _MARKET_CURRENCY.get(market, ("USD", "$"))


@dataclass(frozen=True)
class MarketUniverse:
    """Selected public markets for discovery.

    This is a non-credentialed research/discovery universe. It deliberately
    carries market codes and exchange labels only — no broker names, account
    identifiers, credentials, order routing, or sync state.
    """

    codes: list[str]
    labels: list[str]

    def prompt_section(self) -> str:
        """Render deterministic instructions for the discovery agent."""
        lines = [f"- {code}: {label}" for code, label in zip(self.codes, self.labels)]
        markets = "\n".join(lines)
        return f"""## Selected market universe

Search and validate candidates only within these public markets:

{markets}

This is a non-credentialed discovery universe. It does not connect to broker accounts,
sync holdings, place orders, route trades, or call live broker APIs.
"""


def _default_config_path() -> Path:
    """Return the active runtime config path, falling back to repo data/."""
    try:
        from src.runtime import get_runtime_context

        return get_runtime_context().project_root / "data" / "config.yaml"
    except Exception:
        return Path(__file__).parent.parent.parent / "data" / "config.yaml"


def _load_market_universe(config_path: Path | None = None) -> MarketUniverse:
    """Read selected discovery markets from config.yaml.

    Unknown/empty values fall back to US so discovery always receives a
    deterministic investable/searchable universe.
    """
    config_path = config_path or _default_config_path()
    codes = ["US"]
    try:
        if config_path.exists():
            raw = yaml.safe_load(config_path.read_text()) or {}
            raw_codes = raw.get("markets")
            if isinstance(raw_codes, list):
                valid = [str(c).upper() for c in raw_codes if str(c).upper() in MARKET_EXCHANGES]
                if valid:
                    codes = valid
    except Exception:
        logger.debug("Could not read user config; defaulting to US markets")

    labels = [MARKET_EXCHANGES[c] for c in codes]
    return MarketUniverse(codes=codes, labels=labels)


def _load_user_markets() -> str:
    """Read the user's market preferences from data/config.yaml.

    Returns a human-readable description like "NYSE / NASDAQ" or
    "NYSE / NASDAQ, ADX / DFM, NSE / BSE".  Falls back to US if
    the config file is missing or has no markets key.
    """
    return ", ".join(_load_market_universe().labels)


@dataclass
class Candidate:
    """One candidate ticker the discovery agent surfaced."""

    ticker: str
    company_name: str = ""
    sector: str = ""
    market_cap: float = 0.0
    current_price: float = 0.0
    note: str = ""  # one-sentence rationale from the model
    metrics: dict[str, Any] = field(default_factory=dict)  # strategy-specific fields
    source: str = "agentic"  # "agentic" | "import"
    discovered_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "company_name": self.company_name,
            "sector": self.sector,
            "market_cap": self.market_cap,
            "current_price": self.current_price,
            "note": self.note,
            "metrics": self.metrics,
            "source": self.source,
            "discovered_at": self.discovered_at,
        }


# ─── ticker validation against yfinance ──────────────────────────────


def yfinance_validate(ticker: str) -> dict[str, Any] | None:
    """Probe yfinance for a ticker. Returns a small summary dict or None.

    Used both as a defensive filter on agent output (catching hallucinated
    tickers) and as the backing impl for the `validate_ticker` /
    `get_ticker_summary` MCP tools the discovery agent calls.
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed — skipping ticker validation")
        return {"ticker": ticker, "validated": False, "reason": "yfinance unavailable"}

    try:
        info = yf.Ticker(ticker).info
    except Exception as e:
        logger.debug("yfinance lookup failed for %s: %s", ticker, e)
        return None

    # yfinance returns {} or a stub for nonexistent tickers; require at
    # least a price OR a market cap OR a long name to count as valid.
    price = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
    mcap = info.get("marketCap") or 0.0
    name = info.get("longName") or info.get("shortName") or ""
    if not (price or mcap or name):
        return None

    return {
        "ticker": ticker.upper(),
        "company_name": name or ticker.upper(),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
        "market_cap": float(mcap),
        "current_price": float(price),
        "currency": info.get("currency", "USD"),
        "exchange": info.get("exchange", ""),
    }


# ─── scoped MCP tool surface for the discovery agent ─────────────────


def _build_discovery_mcp_server():
    """Build the MCP server the discovery agent calls.

    Two tools, both yfinance-backed and read-only. No portfolio access,
    no shell, no file IO. The agent uses these alongside WebSearch and
    WebFetch to compile and sanity-check candidate tickers.
    """
    from claude_agent_sdk import create_sdk_mcp_server, tool

    @tool(
        "validate_ticker",
        "Check whether a ticker symbol resolves to a real listed security. "
        "Returns true/false plus a short reason. Use this whenever you are "
        "about to add a ticker to your final candidate list — hallucinated "
        "tickers will be dropped.",
        {"ticker": str},
    )
    async def validate_ticker_tool(args):
        t = (args.get("ticker") or "").strip().upper()
        if not t:
            return {
                "content": [
                    {"type": "text", "text": json.dumps({"valid": False, "reason": "empty ticker"})}
                ]
            }
        result = yfinance_validate(t)
        payload = (
            {"valid": True, "ticker": t, "company_name": result.get("company_name", "")}
            if result
            else {"valid": False, "ticker": t, "reason": "no yfinance data"}
        )
        return {"content": [{"type": "text", "text": json.dumps(payload)}]}

    @tool(
        "get_ticker_summary",
        "Fetch a quick summary for a ticker: company name, sector, market "
        "cap, current price. Use this to confirm a candidate matches the "
        "universe (e.g. mid-to-large cap, US-listed) before including it.",
        {"ticker": str},
    )
    async def get_ticker_summary_tool(args):
        t = (args.get("ticker") or "").strip().upper()
        if not t:
            return {"content": [{"type": "text", "text": json.dumps({"error": "empty ticker"})}]}
        result = yfinance_validate(t)
        if not result:
            return {
                "content": [{"type": "text", "text": json.dumps({"error": "no data", "ticker": t})}]
            }
        return {"content": [{"type": "text", "text": json.dumps(result)}]}

    return create_sdk_mcp_server(
        name="discovery",
        version="0.1.0",
        tools=[validate_ticker_tool, get_ticker_summary_tool],
    )


# ─── prompt builder ─────────────────────────────────────────────────


def _build_exclude_section(exclude: set[str] | None) -> str:
    """Build the SKIP THESE TICKERS prompt section, or empty string."""
    if not exclude:
        return ""
    sorted_tickers = ", ".join(sorted(exclude))
    return (
        f"\n## Skip these tickers\n\n"
        f"The following tickers are already in the portfolio, watchlist, or "
        f"previous discovery lists. Do NOT include any of them — focus your "
        f"search on genuinely new names:\n\n"
        f"{sorted_tickers}\n"
    )


_SHARIAH_DISCOVERY_SECTION = """
## Shariah Compliance Filter

In addition to the strategy's own criteria, ALL candidates MUST pass
preliminary Shariah compliance screening (AAOIFI standards). Exclude
any company that clearly fails these tests:

1. **Business activity:** Exclude companies whose primary business
   involves conventional banking/insurance, alcohol, tobacco, pork,
   gambling, weapons, or adult entertainment.
2. **Debt ratio:** Total interest-bearing debt / trailing-12-month
   market cap should be < 30%. Exclude highly leveraged companies.
3. **Interest income:** Non-operating interest income / total revenue
   should be < 5%. Exclude companies that earn significant income
   from interest.
4. **Cash + receivables ratio:** (Cash + short-term investments +
   receivables) / market cap should be < 70%.

Apply these as preliminary filters. The full Shariah compliance
analysis (with exact AAOIFI ratios) runs later in the specialist
pipeline. At discovery stage, exclude obvious failures — conventional
banks, breweries, casinos, defense contractors, etc. — and flag
borderline cases in the note field.
"""


def _build_discovery_prompt(
    strategy: Strategy,
    n: int,
    exclude: set[str] | None = None,
    shariah: bool = False,
    config_path: Path | None = None,
) -> str:
    """Compose the discovery prompt from the strategy's discovery prose."""
    market_universe = _load_market_universe(config_path=config_path)
    discovery_prose = strategy.prompts.discovery.strip()
    if not discovery_prose:
        # Fall back to a generic instruction derived from the criteria.
        market_description = ", ".join(market_universe.labels)
        criteria_lines = "\n".join(
            f"  - {c.name} (weight {c.weight:.0%})" for c in strategy.criteria
        )
        discovery_prose = (
            f"Find {n} candidates listed on these exchanges: {market_description}\n"
            f"that score well on this strategy's criteria:\n"
            f"{criteria_lines}\n\n"
            f"Strategy summary: {strategy.summary or strategy.description}"
        )

    exclude_section = _build_exclude_section(exclude)
    shariah_section = _SHARIAH_DISCOVERY_SECTION if shariah else ""

    return f"""You are the discovery agent for the **{strategy.name}** investment strategy.

Your job is to compile a ranked candidate list. Read the strategy-specific
brief below, then use WebSearch + WebFetch + the validate_ticker /
get_ticker_summary MCP tools to find {n} candidates and validate each one
exists before you include it.

## Strategy Brief

{discovery_prose}

{market_universe.prompt_section()}

## Process

1. Use WebSearch + WebFetch to find candidate tickers matching the brief.
   Look at curated lists (Dividend Aristocrats, Russell 3000 screens,
   activist 13D filings, etc.) — whatever the brief points you at.
2. For each candidate, call get_ticker_summary to confirm the ticker
   resolves and matches the universe (market cap, sector, etc.).
3. Drop any ticker that fails validation. Hallucinated tickers
   (plausible-looking but not real) are the #1 failure mode here.
4. Rank by the criterion the brief specifies (Chowder Number, PEG,
   tangible-book discount, etc.).
5. Return JSON only — no markdown, no commentary outside the JSON.

## Screening stance

You are screening, not performing a full deep-dive analysis. However,
you MUST enforce the strategy's hard gates. If the strategy brief says
to exclude narrow-moat companies, companies with ROIC < 15%, or
companies with declining margins — those are real filters, not
suggestions. Apply them strictly.

Use preliminary qualitative language for soft assessments: "appears to
have pricing power", "recurring revenue model suggests durability",
"dominant market share in niche". But DO enforce the hard gates listed
in the strategy brief — they exist to prevent bad candidates from
entering the pipeline.

Your output feeds the candidate pipeline only. Do NOT suggest adding
tickers to the watchlist or holdings — that happens only after full
analysis by the specialist swarm. Your job is to find names worth
analyzing, not to make investment decisions. Quality > quantity — it
is far better to return 5 strong candidates than 15 mediocre ones.
{exclude_section}{shariah_section}
## Output schema

Return EXACTLY this JSON shape:

{{
  "candidates": [
    {{
      "ticker": "AAPL",
      "company_name": "Apple Inc.",
      "sector": "Technology",
      "quality_signal": "preliminary qualitative signal",
      "note": "one-sentence preliminary rationale",
      "metrics": {{
        "any_strategy_specific_field": "e.g. PEG=0.8, payout=42%, P/B=0.6"
      }}
    }}
  ]
}}

The `quality_signal` field should use qualified language ("appears to",
"initial signal suggests", "preliminary indication of") — never
definitive moat ratings. The `note` field is a preliminary rationale,
not a recommendation.

Aim for **{n} candidates**. It is better to return fewer high-confidence
candidates than to pad the list with marginal names. Quality > quantity.
"""


# ─── main entry point ───────────────────────────────────────────────


async def discover_candidates(
    strategy: Strategy,
    n: int = 15,
    skip_validation: bool = False,
    exclude: set[str] | None = None,
    shariah: bool = False,
) -> list[Candidate]:
    """Run the discovery agent against a strategy. Returns validated candidates.

    Args:
        strategy: the loaded Strategy (uses strategy.prompts.discovery)
        n: target number of candidates (the agent may return fewer)
        skip_validation: if True, bypass the yfinance hallucination filter
            (useful for tests / when offline). Default False.
        exclude: set of uppercase ticker strings to skip (holdings,
            watchlist, previous candidates). Injected into the prompt
            AND enforced as a deterministic post-filter.
        shariah: if True, inject AAOIFI Shariah compliance screening
            into the discovery prompt so only Shariah-compatible
            candidates are returned.

    Returns:
        List of Candidate, every one yfinance-validated unless
        skip_validation=True.
    """
    from claude_agent_sdk import (
        ClaudeAgentOptions,
        ResultMessage,
    )
    from claude_agent_sdk import (
        query as sdk_query,
    )

    from src.llm.provider import _agent_sdk_model

    if exclude:
        logger.info("Excluding %d known tickers from discovery", len(exclude))

    prompt = _build_discovery_prompt(strategy, n, exclude=exclude, shariah=shariah)
    mcp_server = _build_discovery_mcp_server()

    logger.info(
        "Running discovery for %s (target=%d, brief=%dc)",
        strategy.name,
        n,
        len(strategy.prompts.discovery),
    )

    result_text = ""
    async for msg in sdk_query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            model=_agent_sdk_model("claude-opus-4-7-20250507"),
            permission_mode="bypassPermissions",
            cwd=str(Path.home()),
            mcp_servers={"discovery": mcp_server},
            allowed_tools=[
                "WebSearch",
                "WebFetch",
                "mcp__discovery__validate_ticker",
                "mcp__discovery__get_ticker_summary",
            ],
            thinking={"type": "adaptive"},
        ),
    ):
        if isinstance(msg, ResultMessage) and msg.result:
            result_text = msg.result

    if not result_text:
        logger.warning("Discovery agent returned empty response")
        return []

    raw = _parse_discovery_json(result_text)
    if not raw:
        logger.warning("Could not parse discovery response: %s", result_text[:300])
        return []

    candidates = _materialize_candidates(raw.get("candidates", []), skip_validation=skip_validation)

    # Deterministic post-filter: drop any known tickers the agent included
    # despite the prompt instruction (LLMs can ignore exclude lists).
    if exclude:
        before = len(candidates)
        candidates = [c for c in candidates if c.ticker.upper() not in exclude]
        dropped = before - len(candidates)
        if dropped:
            logger.info("Post-filter dropped %d known tickers from discovery results", dropped)

    return candidates


def _parse_discovery_json(text: str) -> dict | None:
    """Extract the candidates JSON, tolerating fences / surrounding prose."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    return None


def _materialize_candidates(
    raw_list: list[dict],
    skip_validation: bool,
) -> list[Candidate]:
    """Convert raw model output into Candidate objects, dropping bad tickers."""
    out: list[Candidate] = []
    seen: set[str] = set()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    for entry in raw_list:
        if not isinstance(entry, dict):
            continue
        ticker = (entry.get("ticker") or "").strip().upper()
        if not ticker or ticker in seen:
            continue
        # Reject anything that doesn't look like a ticker (catches "TBD",
        # "N/A", company-name-as-ticker, etc.).
        # Use the canonical TICKER_RE from operations/__init__.py — same
        # 15-char widened pattern that admits ADX/HKEX/SS/NS/etc. listings.
        from src.operations import TICKER_RE

        if not TICKER_RE.match(ticker):
            logger.info("Discovery: rejecting non-ticker-shaped %r", ticker)
            continue

        if skip_validation:
            validated = {
                "company_name": entry.get("company_name", ticker),
                "sector": entry.get("sector", ""),
                "market_cap": 0.0,
                "current_price": 0.0,
            }
        else:
            validated = yfinance_validate(ticker)
            if not validated:
                logger.info("Discovery: dropping hallucinated ticker %s", ticker)
                continue

        seen.add(ticker)
        out.append(
            Candidate(
                ticker=ticker,
                company_name=validated.get("company_name") or entry.get("company_name", ticker),
                sector=validated.get("sector") or entry.get("sector", ""),
                market_cap=validated.get("market_cap", 0.0),
                current_price=validated.get("current_price", 0.0),
                note=(entry.get("note") or "").strip(),
                metrics=entry.get("metrics") if isinstance(entry.get("metrics"), dict) else {},
                source="agentic",
                discovered_at=now,
            )
        )

    logger.info(
        "Discovery: materialized %d candidates from %d raw entries", len(out), len(raw_list)
    )
    return out


# Synchronous convenience wrapper for callers outside an event loop
# (CLI command, MCP tool that runs the agent in-process, etc.)
def discover_candidates_sync(
    strategy: Strategy,
    n: int = 15,
    exclude: set[str] | None = None,
) -> list[Candidate]:
    """Run discover_candidates() from synchronous code."""
    try:
        return asyncio.run(discover_candidates(strategy, n=n, exclude=exclude))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(discover_candidates(strategy, n=n, exclude=exclude))
        finally:
            loop.close()
