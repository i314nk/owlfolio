"""Freshness gate — detect and flag stale analyses.

Analyses decay over time. A 6-month-old analysis citing Q2 data when Q4 is
available is worse than no analysis at all (it creates false confidence).

This module provides:
  - staleness classification (FRESH / AGING / STALE / EXPIRED)
  - a gate function the synthesis agent calls before trusting prior analyses
  - a bulk audit for the daemon's weekly freshness sweep
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.db.operations import get_analyses
from src.db.schema import get_db

# Thresholds in days
FRESH_DAYS = 30       # Analysis is current — no flag needed
AGING_DAYS = 60       # Still usable, but note the age
STALE_DAYS = 90       # Should be re-analyzed before acting on it
EXPIRED_DAYS = 180    # Do not use — treat as if no analysis exists


class FreshnessStatus:
    FRESH = "FRESH"         # <30 days
    AGING = "AGING"         # 30-60 days — usable with age note
    STALE = "STALE"         # 60-90 days — re-analysis recommended
    EXPIRED = "EXPIRED"     # >90 days — do not use


def classify_freshness(analysis_date: str | datetime) -> tuple[str, int]:
    """Classify an analysis by age.

    Returns (status, age_days).
    """
    if isinstance(analysis_date, str):
        # Handle various ISO format variations
        try:
            dt = datetime.fromisoformat(analysis_date)
        except ValueError:
            # If we can't parse, assume it's stale
            return FreshnessStatus.STALE, -1
    else:
        dt = analysis_date

    # Make timezone-aware if naive
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    age = (now - dt).days

    if age <= FRESH_DAYS:
        return FreshnessStatus.FRESH, age
    elif age <= AGING_DAYS:
        return FreshnessStatus.AGING, age
    elif age <= STALE_DAYS:
        return FreshnessStatus.STALE, age
    else:
        return FreshnessStatus.EXPIRED, age


def check_analysis_freshness(ticker: str) -> dict[str, Any]:
    """Check the freshness of the latest analysis for a ticker.

    Returns a dict with:
      - ticker
      - status (FRESH/AGING/STALE/EXPIRED/NO_ANALYSIS)
      - age_days (-1 if no analysis)
      - analysis_date
      - recommendation (human-readable action)
    """
    conn = get_db()
    try:
        rows = get_analyses(conn, ticker=ticker.upper(), limit=1)
        if not rows:
            return {
                "ticker": ticker.upper(),
                "status": "NO_ANALYSIS",
                "age_days": -1,
                "analysis_date": None,
                "recommendation": "No analysis exists. Run a full analysis.",
            }

        analysis = rows[0]
        created = analysis.get("created_at", "")
        status, age = classify_freshness(created)

        recommendations = {
            FreshnessStatus.FRESH: "Analysis is current. Safe to use.",
            FreshnessStatus.AGING: (
                f"Analysis is {age} days old. Still usable "
                "but verify key assumptions haven't changed."
            ),
            FreshnessStatus.STALE: (
                f"⚠️ Analysis is {age} days old. "
                "Re-analysis recommended before any position changes."
            ),
            FreshnessStatus.EXPIRED: (
                f"🚫 Analysis is {age} days old. EXPIRED — "
                "do not use for decisions. Full re-analysis required."
            ),
        }

        return {
            "ticker": ticker.upper(),
            "status": status,
            "age_days": age,
            "analysis_date": created,
            "decision": analysis.get("decision"),
            "recommendation": recommendations.get(status, "Unknown status"),
        }
    finally:
        conn.close()


def audit_all_freshness() -> list[dict[str, Any]]:
    """Audit freshness of ALL analyses in the database.

    Returns a list sorted by staleness (most stale first).
    Used by the weekly freshness sweep task.
    """
    conn = get_db()
    try:
        # Get the latest analysis per ticker
        rows = get_analyses(conn, limit=200)
    finally:
        conn.close()

    # Deduplicate to latest per ticker
    seen: dict[str, dict] = {}
    for row in rows:
        ticker = row.get("ticker", "")
        if ticker not in seen:
            seen[ticker] = row

    results = []
    for ticker, analysis in seen.items():
        created = analysis.get("created_at", "")
        status, age = classify_freshness(created)
        results.append({
            "ticker": ticker,
            "status": status,
            "age_days": age,
            "analysis_date": created,
            "decision": analysis.get("decision"),
        })

    # Sort: EXPIRED first, then STALE, then AGING, then FRESH
    priority = {
        FreshnessStatus.EXPIRED: 0,
        FreshnessStatus.STALE: 1,
        FreshnessStatus.AGING: 2,
        FreshnessStatus.FRESH: 3,
    }
    results.sort(key=lambda r: (priority.get(r["status"], 99), -r["age_days"]))
    return results


def freshness_gate(ticker: str) -> dict[str, Any]:
    """Gate function for the synthesis agent.

    Called before using a previous analysis as context. Returns whether
    the prior analysis should be trusted, used with caveats, or discarded.

    Returns:
      - trust: bool — safe to reference prior analysis
      - caveat: str | None — warning to include if using stale data
      - block: bool — if True, discard prior analysis entirely
    """
    result = check_analysis_freshness(ticker)
    status = result["status"]

    if status in (FreshnessStatus.FRESH, "NO_ANALYSIS"):
        return {"trust": True, "caveat": None, "block": False}
    elif status == FreshnessStatus.AGING:
        return {
            "trust": True,
            "caveat": (
                f"Prior analysis is {result['age_days']} days old"
                " — verify key data points are still current."
            ),
            "block": False,
        }
    elif status == FreshnessStatus.STALE:
        return {
            "trust": False,
            "caveat": (
                f"⚠️ Prior analysis is {result['age_days']} days old."
                " Data may be from a previous quarter."
                " Treat with LOW CONFIDENCE."
            ),
            "block": False,
        }
    else:  # EXPIRED
        return {
            "trust": False,
            "caveat": None,
            "block": True,  # Don't even show to synthesis — it will mislead
        }
