"""Tests for first-run default automation schedule."""

import sqlite3

from src.db.operations import add_scheduled_task, get_scheduled_tasks, toggle_task
from src.db.schema import _create_tables
from src.modules.schedule_defaults import (
    DEFAULT_TASKS,
    OPTIONAL_RESEARCH_TASKS,
    create_default_schedule,
)


def test_default_schedule_is_safe_for_onboarding():
    """First-run setup should not auto-schedule credit-burning research jobs."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    created = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    enabled_defaults = [task for task in created if task["enabled"]]
    names = [task["name"] for task in enabled_defaults]
    commands = [task["command"] for task in enabled_defaults]

    assert names == [
        "daily-watchlist-check",
        "daily-portfolio-check",
    ]
    assert commands == [
        "owlfolio watchlist-check --no-llm-price",
        "owlfolio portfolio --no-llm-price",
    ]
    assert all("find" not in command for command in commands)
    assert all("analyze-list" not in command for command in commands)
    assert all("review-holdings" not in command for command in commands)


def test_default_schedule_is_idempotent():
    """Running setup repeatedly should not duplicate default safe tasks or disabled templates."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    first = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    second = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    tasks = get_scheduled_tasks(conn)

    assert {change["action"] for change in first} == {"created"}
    assert {change["action"] for change in second} == {"unchanged"}
    assert len(tasks) == len(DEFAULT_TASKS) + len(OPTIONAL_RESEARCH_TASKS)
    assert len({task["name"] for task in tasks}) == len(tasks)


def test_optional_research_templates_are_installed_disabled():
    """Fresh setup records research templates as opt-in rows, not enabled jobs."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    tasks = {task["name"]: task for task in get_scheduled_tasks(conn)}

    assert tasks["daily-watchlist-check"]["enabled"] == 1
    assert tasks["daily-portfolio-check"]["enabled"] == 1
    for name, *_ in OPTIONAL_RESEARCH_TASKS:
        assert tasks[name]["enabled"] == 0
    assert tasks["weekly-discovery"]["enabled"] == 0


def test_default_schedule_repairs_managed_fields_without_resetting_user_enablement():
    """Re-running defaults updates stale command/schedule text while preserving explicit toggles."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    safe_id = add_scheduled_task(
        conn,
        name="daily-watchlist-check",
        command="owlfolio find",
        schedule="* * * * *",
        timezone="UTC",
        description="old unsafe default",
    )
    toggle_task(conn, safe_id, enabled=False)
    research_id = add_scheduled_task(
        conn,
        name="weekly-discovery",
        command="owlfolio find --old",
        schedule="* * * * *",
        timezone="UTC",
        description="old research default",
        enabled=False,
    )

    changes = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    tasks = {task["name"]: task for task in get_scheduled_tasks(conn)}

    updated_names = {change["name"] for change in changes if change["action"] == "updated"}
    assert {"daily-watchlist-check", "weekly-discovery"}.issubset(updated_names)
    assert tasks["daily-watchlist-check"]["command"] == "owlfolio watchlist-check --no-llm-price"
    assert tasks["daily-watchlist-check"]["schedule"] == "30 17 * * 1-5"
    assert tasks["daily-watchlist-check"]["enabled"] == 0
    assert tasks["weekly-discovery"]["command"] == "owlfolio find"
    assert tasks["weekly-discovery"]["enabled"] == 0
    assert tasks["weekly-discovery"]["id"] == research_id


def test_schedule_default_changes_leave_audit_evidence_on_rows():
    """Created and repaired defaults should explain what the installer changed."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)

    create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    stale_id = conn.execute(
        "SELECT id FROM scheduled_tasks WHERE name = 'daily-portfolio-check'"
    ).fetchone()[0]
    conn.execute(
        """UPDATE scheduled_tasks
           SET command = 'owlfolio analyze AAPL', last_result = NULL
           WHERE id = ?""",
        (stale_id,),
    )
    conn.commit()

    changes = create_default_schedule(conn, timezone="Asia/Dubai", market="US")
    task = conn.execute(
        "SELECT last_result FROM scheduled_tasks WHERE name = 'daily-portfolio-check'"
    ).fetchone()

    assert any(
        change["name"] == "daily-portfolio-check"
        and change["action"] == "updated"
        and "command" in change["changed_fields"]
        for change in changes
    )
    assert task["last_result"].startswith("schedule-defaults: updated")
    assert "command" in task["last_result"]


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
