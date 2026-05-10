"""Default automation schedule for Owlfolio.

Creates a sensible end-to-end investment lifecycle schedule when the user
completes setup. All cron times are adjusted to the user's timezone and
their primary market's trading hours.
"""

from __future__ import annotations

import logging
import sqlite3

logger = logging.getLogger("owlfolio.schedule_defaults")

# Market open hour in UTC (approximate, ignoring DST for simplicity).
# Used to anchor daily checks relative to trading hours.
MARKET_OPEN_UTC: dict[str, int] = {
    "US": 14,  # NYSE 9:30 ET ≈ 14:00 UTC
    "UK": 8,  # LSE 8:00 UTC
    "AE": 6,  # ADX 10:00 GST = 6:00 UTC
    "JP": 0,  # TSE 9:00 JST = 0:00 UTC
    "HK": 1,  # HKEX 9:30 HKT ≈ 1:30 UTC
    "IN": 4,  # NSE 9:15 IST ≈ 3:45 UTC
    "SA": 7,  # Tadawul 10:00 AST = 7:00 UTC
    "CN": 1,  # SSE 9:30 CST ≈ 1:30 UTC
    "BR": 13,  # B3 10:00 BRT = 13:00 UTC
}

# UTC offsets for common timezone regions (hours ahead of UTC).
# Used to convert market open UTC hour to local cron hour.
TZ_OFFSETS: dict[str, int] = {
    "America/New_York": -5,
    "America/Chicago": -6,
    "America/Denver": -7,
    "America/Los_Angeles": -8,
    "Europe/London": 0,
    "Europe/Berlin": 1,
    "Asia/Dubai": 4,
    "Asia/Kolkata": 5,  # +5:30, rounded
    "Asia/Hong_Kong": 8,
    "Asia/Tokyo": 9,
    "Asia/Shanghai": 8,
    "Asia/Riyadh": 3,
    "Australia/Sydney": 11,
    "America/Sao_Paulo": -3,
    "UTC": 0,
}


def _market_open_local_hour(market: str, timezone: str) -> int:
    """Compute the local hour when the primary market opens."""
    utc_hour = MARKET_OPEN_UTC.get(market, 14)  # default to US
    offset = TZ_OFFSETS.get(timezone, 0)
    return (utc_hour + offset) % 24


# Each entry: (name, command, cron_template, description).
# In the cron_template, {H} is replaced with the market-open local hour,
# and {H-1} with one hour before.
DEFAULT_TASKS = [
    (
        "daily-watchlist-check",
        "owlfolio watchlist-check",
        "30 {H-1} * * 1-5",
        "Price check 30min before market open (weekdays)",
    ),
    (
        "daily-portfolio-check",
        "owlfolio portfolio",
        "0 {H} * * 1-5",
        "Portfolio P&L update at market open (weekdays)",
    ),
    (
        "weekly-discovery",
        "owlfolio find",
        "0 {H} * * 1",
        "Discover new candidates (Monday)",
    ),
    (
        "weekly-news-check",
        "owlfolio review-holdings --mode news",
        "0 {H-1} * * 2",
        "News pulse for all holdings (Tuesday)",
    ),
    (
        "weekly-candidate-screening",
        "owlfolio analyze-list --auto --next 3",
        "0 {H} * * 3",
        "Analyze top 3 unprocessed candidates (Wednesday)",
    ),
    (
        "quarterly-10q-review",
        "owlfolio review-holdings --mode review --thorough",
        "0 {H} 15 1,4,7,10 *",
        "Post-10Q review of all holdings (mid-quarter)",
    ),
    (
        "annual-full-reanalysis",
        "owlfolio review-holdings --mode full",
        "0 {H} 15 2,5,8,11 *",
        "Full re-analysis after 10-K season (Feb/May/Aug/Nov)",
    ),
]


def _resolve_cron(template: str, market_hour: int) -> str:
    """Replace {H} and {H-1} placeholders in a cron template."""
    return template.replace("{H}", str(market_hour)).replace("{H-1}", str((market_hour - 1) % 24))


def create_default_schedule(
    conn: sqlite3.Connection,
    timezone: str,
    market: str = "US",
) -> list[dict]:
    """Create the default schedule, skipping tasks that already exist.

    Returns a list of dicts describing what was created.
    """
    from src.db.operations import add_scheduled_task, get_scheduled_tasks

    existing = {t["name"] for t in get_scheduled_tasks(conn)}
    market_hour = _market_open_local_hour(market, timezone)

    created = []
    for name, command, cron_template, description in DEFAULT_TASKS:
        if name in existing:
            logger.info("Task '%s' already exists, skipping", name)
            continue

        cron = _resolve_cron(cron_template, market_hour)
        task_id = add_scheduled_task(
            conn,
            name=name,
            command=command,
            schedule=cron,
            timezone=timezone,
            description=description,
        )
        created.append(
            {
                "id": task_id,
                "name": name,
                "command": command,
                "cron": cron,
                "description": description,
            }
        )
        logger.info("Created task '%s' (ID %d): %s @ %s", name, task_id, command, cron)

    return created
