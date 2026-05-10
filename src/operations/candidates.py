"""Candidate-list operations.

Lifecycle:
    discovery (`owlfolio find`) ────┐
                                    ├──> candidate_lists table ──> analyze-list
    external import (`owlfolio import`) ┘                              │
                                                                       ▼
                                                              one analysis per ticker
                                                              (concurrency-capped)

Source-of-truth for both the CLI and the chat agent's MCP tools.
"""

from __future__ import annotations

import asyncio
import csv
import logging
import re
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

from src.operations import validate_ticker

logger = logging.getLogger("owlfolio.candidates")


# Cap concurrent specialist runs during analyze-list. Each ticker spawns
# 3-5 specialist subagents; without a cap, a 25-ticker list would have
# 75-125 in flight simultaneously, blowing through rate limits and
# producing a billing surprise. Two-to-three concurrent analyses is the
# sweet spot — enough to overlap network waits, not enough to thunder
# the API.
DEFAULT_ANALYZE_CONCURRENCY = 2


_CANDIDATE_RECENCY_DAYS = 90


def _get_known_tickers() -> set[str]:
    """Return tickers the discovery agent should skip.

    Three buckets with different rules:
      • Holdings — always excluded (you own it).
      • Watchlist — always excluded (you're already tracking it).
      • Previous candidates — only excluded if discovered within the last
        90 days.  Older candidates rotate back in because market
        conditions change (price drops, earnings improve, etc.).
    """
    from src.db.operations import get_holdings, get_watchlist
    from src.db.schema import get_db

    known: set[str] = set()
    conn = get_db()
    try:
        for h in get_holdings(conn):
            if h.get("ticker"):
                known.add(h["ticker"].upper())
        for w in get_watchlist(conn):
            if w.get("ticker"):
                known.add(w["ticker"].upper())
        # Only exclude recently-discovered candidates (within 90 days)
        rows = conn.execute(
            """SELECT DISTINCT c.ticker
               FROM candidates c
               JOIN candidate_lists cl ON c.list_id = cl.id
               WHERE cl.created_at > datetime('now', ?)""",
            (f"-{_CANDIDATE_RECENCY_DAYS} days",),
        ).fetchall()
        for r in rows:
            if r[0]:
                known.add(r[0].upper())
    except Exception as e:
        logger.warning("Could not load known tickers for exclusion: %s", e)
    finally:
        conn.close()
    return known


# ─── creation paths ─────────────────────────────────────────────────


async def find_candidates(
    strategy_name: str | None = None,
    n: int = 15,
    list_name: str | None = None,
    note: str = "",
    shariah: bool = False,
) -> dict[str, Any]:
    """Run the agentic discovery agent and persist its candidates.

    Args:
        strategy_name: which strategy to discover for; defaults to the
            active strategy (methodology.yaml).
        n: target number of candidates.
        list_name: name to give the saved list. Defaults to
            `discover-{strategy}-{timestamp}`.
        note: optional one-line description.

    Returns:
        {"list_name", "list_id", "strategy", "candidates": [...]}
    """
    from src.agents.discovery import discover_candidates
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        get_candidate_list,
    )
    from src.db.schema import get_db
    from src.operations import validate_strategy_name
    from src.operations.strategies import METHODOLOGY_PATH, STRATEGIES_DIR
    from src.strategy.loader import load_strategy

    # Resolve which strategy YAML to load
    if strategy_name:
        n_safe = validate_strategy_name(strategy_name)
        path = STRATEGIES_DIR / f"{n_safe}.yaml"
    else:
        path = (
            METHODOLOGY_PATH
            if METHODOLOGY_PATH.exists()
            else STRATEGIES_DIR / "buffett-munger.yaml"
        )
    if not path.exists():
        raise FileNotFoundError(f"strategy file not found: {path}")
    strategy = load_strategy(path)

    # Default list name: discover-<strategy>-<utc-timestamp>
    if not list_name:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        list_name = f"discover-{strategy.name}-{ts}"
    _validate_list_name(list_name)

    known = _get_known_tickers()
    candidates = await discover_candidates(strategy, n=n, exclude=known, shariah=shariah)

    conn = get_db()
    try:
        if get_candidate_list(conn, list_name):
            raise ValueError(f"candidate list {list_name!r} already exists")
        list_id = create_candidate_list(
            conn,
            name=list_name,
            source="agentic",
            strategy=strategy.name,
            note=note or f"Agentic discovery for {strategy.name}",
        )
        inserted = add_candidates_bulk(conn, list_id, [c.to_dict() for c in candidates])
    finally:
        conn.close()

    logger.info(
        "discovered %d candidates for %s, persisted as list %r (id=%d)",
        inserted,
        strategy.name,
        list_name,
        list_id,
    )

    return {
        "list_name": list_name,
        "list_id": list_id,
        "strategy": strategy.name,
        "inserted": inserted,
        "candidates": [c.to_dict() for c in candidates],
    }


def import_candidates(
    source: str,
    list_name: str,
    strategy_name: str | None = None,
    note: str = "",
    skip_validation: bool = False,
) -> dict[str, Any]:
    """Import a ticker list from CSV / file path / inline string.

    `source` may be:
      - a file path (CSV with a `ticker` column, OR a plain file with one
        ticker per line)
      - an inline string of comma- / newline- / whitespace-separated
        tickers (e.g. "AAPL, MSFT, GOOGL")

    Each ticker is validated against yfinance unless `skip_validation`
    is True. Hallucinated / typo'd tickers are dropped (with a log line
    so the user can see what was rejected).
    """
    from src.agents.discovery import yfinance_validate
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        get_candidate_list,
    )
    from src.db.schema import get_db
    from src.operations import validate_strategy_name

    _validate_list_name(list_name)
    if strategy_name:
        validate_strategy_name(strategy_name)

    raw_tickers = _parse_ticker_source(source)
    if not raw_tickers:
        raise ValueError(f"no tickers found in source: {source!r}")

    rows: list[dict[str, Any]] = []
    rejected: list[str] = []
    seen: set[str] = set()
    for raw in raw_tickers:
        try:
            t = validate_ticker(raw)
        except ValueError:
            rejected.append(raw)
            continue
        if t in seen:
            continue
        seen.add(t)

        if skip_validation:
            rows.append({"ticker": t})
            continue

        info = yfinance_validate(t)
        if not info:
            rejected.append(t)
            continue
        rows.append(
            {
                "ticker": t,
                "company_name": info.get("company_name", ""),
                "sector": info.get("sector", ""),
                "market_cap": info.get("market_cap"),
                "current_price": info.get("current_price"),
            }
        )

    conn = get_db()
    try:
        if get_candidate_list(conn, list_name):
            raise ValueError(f"candidate list {list_name!r} already exists")
        list_id = create_candidate_list(
            conn,
            name=list_name,
            source="import",
            strategy=strategy_name,
            note=note or f"Imported {len(rows)} tickers",
        )
        inserted = add_candidates_bulk(conn, list_id, rows)
    finally:
        conn.close()

    if rejected:
        logger.info("import: rejected %d tickers: %s", len(rejected), ", ".join(rejected[:10]))

    return {
        "list_name": list_name,
        "list_id": list_id,
        "inserted": inserted,
        "rejected": rejected,
        "tickers": [r["ticker"] for r in rows],
    }


# ─── read paths ─────────────────────────────────────────────────────


def list_lists() -> list[dict[str, Any]]:
    """All candidate lists with item counts."""
    from src.db.operations import list_candidate_lists
    from src.db.schema import get_db

    conn = get_db()
    try:
        return list_candidate_lists(conn)
    finally:
        conn.close()


def show_list(name: str) -> dict[str, Any]:
    """Return the named list plus all its candidates."""
    from src.db.operations import get_candidate_list, get_candidates
    from src.db.schema import get_db

    conn = get_db()
    try:
        lst = get_candidate_list(conn, name)
        if not lst:
            raise FileNotFoundError(f"candidate list {name!r} not found")
        candidates = get_candidates(conn, lst["id"])
    finally:
        conn.close()
    return {**lst, "candidates": candidates}


def delete_list(name: str) -> bool:
    """Delete a candidate list (and its candidates). True if it existed."""
    from src.db.operations import delete_candidate_list
    from src.db.schema import get_db

    conn = get_db()
    try:
        return delete_candidate_list(conn, name)
    finally:
        conn.close()


# ─── analyze path ───────────────────────────────────────────────────


async def analyze_list(
    name: str,
    strategy_name: str | None = None,
    concurrency: int = DEFAULT_ANALYZE_CONCURRENCY,
    skip_analyzed: bool = True,
    shariah: bool = False,
    max_candidates: int | None = None,
) -> dict[str, Any]:
    """Run the analyze pipeline against every candidate in a list.

    Concurrency is capped (default 2) because each candidate spawns 3-5
    specialist subagents — without a cap a 25-ticker list balloons to
    75-125 in-flight requests and the rate limiter / billing alarm fires.

    Args:
        name: candidate list name.
        strategy_name: override the list's stored strategy. Defaults to
            the list's strategy, falling back to the active strategy.
        concurrency: max simultaneous analyses (default 2).
        skip_analyzed: if True, skip candidates already linked to an
            analysis row (resumable).
        shariah: pass through to the analyze() pipeline.
        max_candidates: if set, only analyze the first N unprocessed
            candidates. Useful for scheduled tasks that process a few
            at a time.

    Returns:
        {"name", "strategy", "results": [{ticker, decision, ...}, ...],
         "errors": [{ticker, error}], "skipped": [tickers]}
    """
    from src.db.operations import (
        get_candidate_list,
        get_candidates,
        mark_candidate_analyzed,
    )
    from src.db.schema import get_db
    from src.operations.analysis import analyze
    from src.operations.strategies import STRATEGIES_DIR

    if concurrency < 1:
        raise ValueError(f"concurrency must be >= 1, got {concurrency}")
    if concurrency > 5:
        logger.warning(
            "analyze_list concurrency=%d is high; rate-limit risk",
            concurrency,
        )

    conn = get_db()
    try:
        lst = get_candidate_list(conn, name)
        if not lst:
            raise FileNotFoundError(f"candidate list {name!r} not found")
        candidates = get_candidates(conn, lst["id"])
    finally:
        conn.close()

    if not candidates:
        return {
            "name": name,
            "strategy": strategy_name or lst.get("strategy"),
            "results": [],
            "errors": [],
            "skipped": [],
        }

    effective_strategy = strategy_name or lst.get("strategy")
    strategy_path: str | None = None
    if effective_strategy:
        sp = STRATEGIES_DIR / f"{effective_strategy}.yaml"
        if sp.exists():
            strategy_path = str(sp)

    pending: list[dict] = []
    skipped: list[str] = []
    for c in candidates:
        if skip_analyzed and c.get("analyzed"):
            skipped.append(c["ticker"])
            continue
        pending.append(c)

    if max_candidates and len(pending) > max_candidates:
        pending = pending[:max_candidates]

    logger.info(
        "analyze_list %r: %d to run, %d already-analyzed skipped, concurrency=%d",
        name,
        len(pending),
        len(skipped),
        concurrency,
    )

    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    async def _one(candidate: dict) -> None:
        async with semaphore:
            ticker = candidate["ticker"]
            try:
                result = await analyze(
                    ticker=ticker,
                    company_name=candidate.get("company_name") or ticker,
                    strategy_path=strategy_path,
                    shariah=shariah,
                )
            except Exception as e:
                logger.error("analyze_list: %s failed: %s", ticker, e)
                errors.append({"ticker": ticker, "error": str(e)})
                return
            # Persist the link from candidate -> analysis row
            conn2 = get_db()
            try:
                mark_candidate_analyzed(conn2, candidate["id"], result["analysis_id"])
            finally:
                conn2.close()
            results.append(
                {
                    "ticker": ticker,
                    "decision": result["decision"],
                    "confidence": result["confidence"],
                    "fair_value": result["fair_value"],
                    "current_price": result["current_price"],
                    "quality_tier": result["quality_tier"],
                    "weighted_score": result["weighted_score"],
                    "analysis_id": result["analysis_id"],
                }
            )

    await asyncio.gather(*[_one(c) for c in pending], return_exceptions=False)

    return {
        "name": name,
        "strategy": effective_strategy,
        "results": results,
        "errors": errors,
        "skipped": skipped,
    }


# ─── helpers ────────────────────────────────────────────────────────


_LIST_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._\-]{0,63}$")


def _validate_list_name(name: str) -> str:
    """Allow letters, digits, dot, underscore, hyphen. 1-64 chars."""
    if not isinstance(name, str) or not _LIST_NAME_RE.match(name):
        raise ValueError(
            f"invalid list name {name!r}: must be 1-64 chars, "
            "letters/digits/dot/underscore/hyphen, not starting with punctuation"
        )
    return name


def _parse_ticker_source(source: str) -> list[str]:
    """Pull tickers out of a file path, CSV path, or inline string."""
    candidate_path = Path(source)
    if candidate_path.exists() and candidate_path.is_file():
        text = candidate_path.read_text()
        # CSV path with a 'ticker' column?
        if candidate_path.suffix.lower() == ".csv":
            return _extract_csv_tickers(text)
        return _split_tokens(text)

    # Inline string
    return _split_tokens(source)


def _extract_csv_tickers(text: str) -> list[str]:
    """Extract tickers from CSV: prefer a 'ticker'/'symbol' column, else col 0."""
    reader = csv.reader(StringIO(text))
    rows = list(reader)
    if not rows:
        return []
    header = [h.strip().lower() for h in rows[0]]
    ticker_col = 0
    for candidate in ("ticker", "symbol", "tickers", "symbols"):
        if candidate in header:
            ticker_col = header.index(candidate)
            data_rows = rows[1:]
            break
    else:
        # No header — treat every row as data, take col 0
        data_rows = rows

    out = []
    for row in data_rows:
        if not row or len(row) <= ticker_col:
            continue
        cell = row[ticker_col].strip()
        if cell:
            out.append(cell)
    return out


def _split_tokens(text: str) -> list[str]:
    """Split on commas, newlines, semicolons, and whitespace."""
    if not text:
        return []
    tokens = re.split(r"[,;\s]+", text.strip())
    return [t for t in tokens if t]
