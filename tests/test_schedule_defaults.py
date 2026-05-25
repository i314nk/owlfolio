"""Tests for first-run default automation schedule."""

import sqlite3

from src.db.operations import get_scheduled_tasks
from src.db.schema import _create_tables
from src.modules.schedule_defaults import OPTIONAL_RESEARCH_TASKS, create_default_schedule


def test_default_schedule_is_safe_for_onboarding():
    """First-run setup should not auto-schedule credit-burning research jobs."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    created = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    commands = [task["command"] for task in created]

    assert commands == [
        "owlfolio watchlist-check --no-llm-price",
        "owlfolio portfolio --no-llm-price",
    ]
    assert all("find" not in command for command in commands)
    assert all("analyze-list" not in command for command in commands)
    assert all("review-holdings" not in command for command in commands)


def test_default_schedule_is_idempotent():
    """Running setup repeatedly should not duplicate default safe tasks."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    first = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    second = create_default_schedule(conn, timezone="Asia/Dubai", market="US")

    assert len(first) == 2
    assert second == []
    assert len(get_scheduled_tasks(conn)) == 2


def test_optional_research_tasks_are_explicit_credit_using_catalog():
    """Research automation remains available, but not enabled by setup defaults."""
    commands = [task[1] for task in OPTIONAL_RESEARCH_TASKS]

    assert commands == [
        "owlfolio find",
        "owlfolio review-holdings --mode news",
        "owlfolio analyze-list --auto --next 3",
        "owlfolio review-holdings --mode review --thorough",
        "owlfolio review-holdings --mode full",
    ]
    assert all("uses Claude" in task[3] for task in OPTIONAL_RESEARCH_TASKS)
