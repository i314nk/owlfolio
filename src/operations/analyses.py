"""Saved analysis records, decision history, comparisons."""

from __future__ import annotations

from typing import Any

from src.db.operations import get_analyses as db_get_analyses
from src.db.operations import get_analysis_by_id as db_get_analysis_by_id
from src.db.operations import get_decisions as db_get_decisions
from src.db.schema import get_db
from src.operations import validate_ticker


def list_analyses(ticker: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Return saved analyses, newest first."""
    conn = get_db()
    try:
        t = validate_ticker(ticker) if ticker else None
        return db_get_analyses(conn, ticker=t, limit=limit)
    finally:
        conn.close()


def get_latest_analysis(ticker: str) -> dict[str, Any] | None:
    """Return the most recent saved analysis for a ticker, or None."""
    t = validate_ticker(ticker)
    conn = get_db()
    try:
        rows = db_get_analyses(conn, ticker=t, limit=1)
        return rows[0] if rows else None
    finally:
        conn.close()


def get_analysis(analysis_id: int, with_findings: bool = True) -> dict[str, Any] | None:
    """Look up a saved analysis by its `#NN` id token.

    The user can quote `#42` in chat; the agent resolves it via this op
    and gets back the synthesis result PLUS the per-specialist findings
    (so "tell me what moat_analyst found" works without a re-run).
    """
    if not isinstance(analysis_id, int) or analysis_id < 1:
        raise ValueError(f"analysis_id must be a positive int, got {analysis_id!r}")
    conn = get_db()
    try:
        return db_get_analysis_by_id(conn, analysis_id, with_findings=with_findings)
    finally:
        conn.close()


def list_decisions(ticker: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """Decision journal — every BUY/SELL/PASS recorded with reasoning."""
    conn = get_db()
    try:
        t = validate_ticker(ticker) if ticker else None
        return db_get_decisions(conn, ticker=t, limit=limit)
    finally:
        conn.close()


def get_specialist_findings_for_analysis(analysis_id: int) -> list[dict[str, Any]]:
    """Return specialist findings for a given analysis_id.

    Used by the web UI's specialist drilldown cards — lazy-loaded via
    htmx when the user expands an analysis row.
    """
    if not isinstance(analysis_id, int) or analysis_id < 1:
        raise ValueError(f"analysis_id must be a positive int, got {analysis_id!r}")
    conn = get_db()
    try:
        from src.db.operations import get_specialist_findings

        return get_specialist_findings(conn, analysis_id)
    finally:
        conn.close()


def get_previous_analysis_context(ticker: str) -> dict[str, Any] | None:
    """Return a compact summary of the most recent saved analysis for *ticker*.

    Used by the synthesis agent to detect material drift between analyses.
    Returns a dict with: ticker, decision, weighted_score, quality_tier,
    analysis_date, and per-specialist scores (from specialist_findings).
    Returns None if no previous analysis exists.
    """
    t = validate_ticker(ticker)
    conn = get_db()
    try:
        rows = db_get_analyses(conn, ticker=t, limit=1)
        if not rows:
            return {"error": "NOT_FOUND", "error_detail": f"No previous analysis for {t}"}
        analysis = rows[0]

        # Fetch per-specialist scores from specialist_findings
        from src.db.operations import get_specialist_findings

        specialist_scores: dict[str, float] = {}
        if analysis.get("id"):
            findings = get_specialist_findings(conn, analysis["id"])
            for f in findings:
                name = f.get("specialist_name", "")
                confidence = f.get("confidence")
                if name and confidence is not None:
                    specialist_scores[name] = round(confidence, 2)

        return {
            "ticker": analysis.get("ticker", t),
            "decision": analysis.get("decision", "UNKNOWN"),
            "weighted_score": analysis.get("weighted_score", 0.0),
            "quality_tier": analysis.get("quality_tier", "unknown"),
            "analysis_date": analysis.get("created_at", "unknown"),
            "specialist_scores": specialist_scores,
        }
    finally:
        conn.close()


def compare_tickers(ticker_a: str, ticker_b: str) -> dict[str, Any]:
    """Side-by-side comparison from the most recent saved analyses."""
    a = get_latest_analysis(ticker_a)
    b = get_latest_analysis(ticker_b)
    return {
        "a": a,
        "b": b,
        "both_available": a is not None and b is not None,
    }
