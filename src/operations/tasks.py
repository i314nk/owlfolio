"""Scheduled task operations + daemon status."""

from __future__ import annotations

import shlex
import subprocess
from functools import lru_cache
from typing import Any

from src.db.operations import add_scheduled_task as db_add_task
from src.db.operations import get_scheduled_tasks as db_get_tasks
from src.db.schema import get_db


@lru_cache(maxsize=1)
def _known_owlfolio_subcommands() -> frozenset[str]:
    """Enumerate every registered `owlfolio <subcommand>` name.

    Cached because Typer command introspection imports the world. Used
    by add_task() to refuse scheduling of phantom commands like
    `owlfolio watchlist check` (no such subcommand exists; the cron would
    fire and silently fail every run).
    """
    from src.main import app
    names: set[str] = set()
    for c in app.registered_commands:
        n = c.name or (c.callback.__name__ if c.callback else None)
        if n:
            names.add(n)
    return frozenset(names)


def list_tasks() -> list[dict[str, Any]]:
    """Return every scheduled task."""
    conn = get_db()
    try:
        return db_get_tasks(conn)
    finally:
        conn.close()


def add_task(
    name: str,
    command: str,
    schedule: str,
    description: str | None = None,
    timezone: str = "UTC",
) -> dict[str, Any]:
    """Schedule a task. The command runs on the cron schedule when the daemon is up.

    Raises ValueError if `command` looks like `owlfolio <subcommand> ...`
    but `<subcommand>` doesn't exist on the actual CLI surface. Without
    this check, an agent (or user) can schedule a phantom command that
    silently fails on every cron firing — the original `watchlist check`
    incident that motivated this guardrail.
    """
    if not name or not isinstance(name, str):
        raise ValueError("task name is required")
    if not command or not isinstance(command, str):
        raise ValueError("command is required")
    if not schedule or not isinstance(schedule, str):
        raise ValueError("schedule (cron expression) is required")

    _validate_owlfolio_command(command)

    conn = get_db()
    try:
        task_id = db_add_task(
            conn,
            name=name,
            command=command,
            schedule=schedule,
            description=description,
            timezone=timezone,
        )
    finally:
        conn.close()
    return {"id": task_id, "name": name, "command": command, "schedule": schedule}


def remove_task(task_id: int) -> dict[str, Any]:
    """Delete a scheduled task by ID."""
    if not isinstance(task_id, int):
        raise ValueError(f"task_id must be int, got {type(task_id).__name__}")
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
        conn.commit()
        return {"deleted": cur.rowcount, "id": task_id}
    finally:
        conn.close()


def _validate_owlfolio_command(command: str) -> None:
    """Refuse `owlfolio <subcommand>` if <subcommand> doesn't exist.

    Non-owlfolio commands pass through unchanged — users may legitimately
    schedule arbitrary shell (e.g. `pg_dump`, `aws s3 sync`). The check
    only fires when the command starts with `owlfolio` so we catch
    mistyped or hallucinated subcommands without being heavy-handed.
    """
    try:
        tokens = shlex.split(command)
    except ValueError as e:
        raise ValueError(f"command is not parseable as shell: {e}") from e
    if not tokens or tokens[0] != "owlfolio":
        return
    if len(tokens) < 2:
        raise ValueError(
            "command 'owlfolio' alone is not a valid scheduled task — "
            "specify a subcommand (e.g. 'owlfolio analyze AAPL')"
        )
    sub = tokens[1]
    known = _known_owlfolio_subcommands()
    if sub not in known:
        # Suggest closest matches so the caller sees the real options
        from difflib import get_close_matches
        suggestions = get_close_matches(sub, known, n=3, cutoff=0.5)
        hint = f" Did you mean: {', '.join(suggestions)}?" if suggestions else ""
        raise ValueError(
            f"unknown owlfolio subcommand {sub!r} — would silently fail "
            f"on every cron firing.{hint} "
            f"Run `owlfolio --help` to see the real CLI surface."
        )


def daemon_status() -> dict[str, Any]:
    """Return whether the owlfolio daemon process is currently running."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "owlfolio.*daemon"],
            capture_output=True, text=True, timeout=2,
        )
        running = result.returncode == 0
        pids = [int(p) for p in result.stdout.split() if p.strip().isdigit()] if running else []
    except Exception as e:
        return {"running": False, "pids": [], "error": str(e)}
    return {"running": running, "pids": pids}
