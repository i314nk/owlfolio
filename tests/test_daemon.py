"""Tests for the Owlfolio daemon -- background task executor."""

import sqlite3
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from zoneinfo import ZoneInfo

import pytest

from src.db.schema import _create_tables
from src.db.operations import (
    add_scheduled_task,
    get_scheduled_tasks,
    log_task_run,
)
from src.daemon import _is_due, _execute_task, run_daemon


class _UnclosableConnection:
    """Wrapper around sqlite3.Connection that makes close() a no-op.

    The daemon calls conn.close() after each task execution. When tests use
    an in-memory database, closing it would destroy all data. This wrapper
    delegates every attribute to the real connection but silently ignores close().
    """

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def close(self):
        pass  # no-op for tests

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def db():
    """In-memory SQLite database for testing."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)
    return _UnclosableConnection(conn)


# ── log_task_run ──────────────────────────────────────────────────────


def test_log_task_run_updates_last_run(db):
    """log_task_run sets last_run and last_result on the task."""
    task_id = add_scheduled_task(db, name="t1", command="echo hi", schedule="* * * * *")

    log_task_run(db, task_id, "success", "hello")

    task = get_scheduled_tasks(db)[0]
    assert task["last_run"] is not None
    assert "success" in task["last_result"]
    assert "hello" in task["last_result"]


def test_log_task_run_truncates_output(db):
    """Output is truncated to 500 chars in last_result."""
    task_id = add_scheduled_task(db, name="t2", command="echo hi", schedule="* * * * *")
    long_output = "x" * 1000

    log_task_run(db, task_id, "success", long_output)

    task = get_scheduled_tasks(db)[0]
    # "success: " prefix + 500 chars of output
    assert len(task["last_result"]) <= 510


# ── _is_due ───────────────────────────────────────────────────────────


def test_is_due_never_run_task():
    """A task that has never run should be due if cron matches."""
    task = {
        "schedule": "* * * * *",  # every minute
        "timezone": "UTC",
        "last_run": None,
    }
    now = datetime.now(ZoneInfo("UTC"))
    assert _is_due(task, now) is True


def test_is_due_recently_run_task():
    """A task that just ran should not be due again immediately."""
    now = datetime.now(ZoneInfo("UTC"))
    task = {
        "schedule": "0 12 * * *",  # once a day at noon
        "timezone": "UTC",
        "last_run": now.isoformat(),
    }
    assert _is_due(task, now) is False


def test_is_due_past_next_run():
    """A task is due when current time is past the next cron occurrence."""
    # Set last_run to 2 hours ago
    now = datetime.now(ZoneInfo("UTC"))
    last_run = now - timedelta(hours=2)
    task = {
        "schedule": "* * * * *",  # every minute
        "timezone": "UTC",
        "last_run": last_run.isoformat(),
    }
    assert _is_due(task, now) is True


def test_is_due_respects_timezone():
    """Cron schedule is evaluated in the task's timezone."""
    # Use a timezone where the hour differs from UTC
    dubai_tz = ZoneInfo("Asia/Dubai")
    now_utc = datetime.now(ZoneInfo("UTC"))
    now_dubai = now_utc.astimezone(dubai_tz)

    task = {
        "schedule": f"{now_dubai.minute} {now_dubai.hour} * * *",
        "timezone": "Asia/Dubai",
        "last_run": (now_utc - timedelta(days=1)).isoformat(),
    }
    # Should be due because we set the cron to match the current Dubai time
    assert _is_due(task, now_utc) is True


def test_is_due_default_timezone():
    """Tasks with no timezone default to UTC."""
    now = datetime.now(ZoneInfo("UTC"))
    task = {
        "schedule": "* * * * *",
        "timezone": None,
        "last_run": (now - timedelta(hours=1)).isoformat(),
    }
    assert _is_due(task, now) is True


# ── _execute_task ─────────────────────────────────────────────────────


@patch("src.daemon.get_db")
def test_execute_task_success(mock_get_db, db):
    """Successful command execution logs success."""
    mock_get_db.return_value = db
    task_id = add_scheduled_task(db, name="echo-test", command="echo hello", schedule="* * * * *")

    task = get_scheduled_tasks(db)[0]
    _execute_task(task)

    updated = get_scheduled_tasks(db)[0]
    assert updated["last_run"] is not None
    assert "success" in updated["last_result"]


@patch("src.daemon.get_db")
def test_execute_task_failure(mock_get_db, db):
    """Failed command logs error status."""
    mock_get_db.return_value = db
    task_id = add_scheduled_task(
        db, name="fail-test", command="exit 1", schedule="* * * * *"
    )

    task = get_scheduled_tasks(db)[0]
    _execute_task(task)

    updated = get_scheduled_tasks(db)[0]
    assert updated["last_run"] is not None
    assert "error" in updated["last_result"]


@patch("src.daemon.get_db")
@patch("src.daemon.subprocess.run")
def test_execute_task_timeout(mock_run, mock_get_db, db):
    """Timed-out command logs timeout status."""
    import subprocess

    mock_get_db.return_value = db
    mock_run.side_effect = subprocess.TimeoutExpired(cmd="sleep 999", timeout=300)

    task_id = add_scheduled_task(
        db, name="timeout-test", command="sleep 999", schedule="* * * * *"
    )

    task = get_scheduled_tasks(db)[0]
    _execute_task(task)

    updated = get_scheduled_tasks(db)[0]
    assert updated["last_run"] is not None
    assert "timeout" in updated["last_result"]


# ── task_runs persistence (Activity feed producer) ───────────────────


@patch("src.daemon.get_db")
def test_execute_task_success_records_task_run(mock_get_db, db):
    """Successful runs land in task_runs with exit_code=0 + stdout captured.

    Without this wiring, the Activity tab's task_run rows would always
    be empty in production — the producer side of the audit trail.
    """
    from src.db.operations import get_task_runs

    mock_get_db.return_value = db
    task_id = add_scheduled_task(db, name="echo-test", command="echo hello", schedule="* * * * *")
    _execute_task(get_scheduled_tasks(db)[0])

    runs = get_task_runs(db)
    assert len(runs) == 1
    r = runs[0]
    assert r["task_id"] == task_id
    assert r["exit_code"] == 0
    assert r["finished_at"] is not None
    assert "hello" in (r["stdout_excerpt"] or "")


@patch("src.daemon.get_db")
def test_execute_task_failure_records_task_run_with_exit_code(mock_get_db, db):
    """Non-zero exit codes are captured exactly (not collapsed to 1)."""
    from src.db.operations import get_task_runs

    mock_get_db.return_value = db
    add_scheduled_task(db, name="fail-test", command="exit 7", schedule="* * * * *")
    _execute_task(get_scheduled_tasks(db)[0])

    runs = get_task_runs(db)
    assert len(runs) == 1
    assert runs[0]["exit_code"] == 7
    assert runs[0]["finished_at"] is not None


@patch("src.daemon.get_db")
@patch("src.daemon.subprocess.run")
def test_execute_task_timeout_records_task_run(mock_run, mock_get_db, db):
    """Timeouts close the row with exit_code=-1 (sentinel) so audit
    rows never stay 'running' forever after a hung subprocess."""
    import subprocess

    from src.db.operations import get_task_runs

    mock_get_db.return_value = db
    mock_run.side_effect = subprocess.TimeoutExpired(cmd="sleep 999", timeout=300)
    add_scheduled_task(db, name="t-out", command="sleep 999", schedule="* * * * *")
    _execute_task(get_scheduled_tasks(db)[0])

    runs = get_task_runs(db)
    assert len(runs) == 1
    assert runs[0]["exit_code"] == -1
    assert runs[0]["finished_at"] is not None
    assert "timeout" in (runs[0]["stderr_excerpt"] or "").lower()


@patch("src.daemon.get_db")
@patch("src.daemon.subprocess.run")
def test_execute_task_unexpected_exception_records_task_run(mock_run, mock_get_db, db):
    """Unhandled exceptions still close the task_runs row (-2 sentinel)
    rather than leaving it dangling."""
    from src.db.operations import get_task_runs

    mock_get_db.return_value = db
    mock_run.side_effect = OSError("disk full")
    add_scheduled_task(db, name="boom", command="anything", schedule="* * * * *")
    _execute_task(get_scheduled_tasks(db)[0])

    runs = get_task_runs(db)
    assert len(runs) == 1
    assert runs[0]["exit_code"] == -2
    assert runs[0]["finished_at"] is not None
    assert "disk full" in (runs[0]["stderr_excerpt"] or "")


# ── run_daemon ────────────────────────────────────────────────────────


@patch("src.daemon.get_db")
@patch("src.daemon.time.sleep")
def test_run_daemon_executes_due_tasks(mock_sleep, mock_get_db, db):
    """Daemon loop finds and executes due tasks."""
    mock_get_db.return_value = db

    # Make sleep raise KeyboardInterrupt after first iteration
    mock_sleep.side_effect = KeyboardInterrupt

    add_scheduled_task(db, name="daemon-test", command="echo daemon", schedule="* * * * *")

    run_daemon(poll_interval=10)

    updated = get_scheduled_tasks(db)[0]
    assert updated["last_run"] is not None
    assert "success" in updated["last_result"]


@patch("src.daemon.get_db")
@patch("src.daemon.time.sleep")
def test_run_daemon_skips_disabled_tasks(mock_sleep, mock_get_db, db):
    """Daemon only runs enabled tasks."""
    mock_get_db.return_value = db
    mock_sleep.side_effect = KeyboardInterrupt

    task_id = add_scheduled_task(
        db, name="disabled-test", command="echo nope", schedule="* * * * *"
    )
    db.execute("UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?", (task_id,))
    db.commit()

    run_daemon(poll_interval=10)

    updated = get_scheduled_tasks(db)[0]
    assert updated["last_run"] is None  # never ran


@patch("src.daemon.get_db")
@patch("src.daemon.time.sleep")
def test_run_daemon_handles_errors_gracefully(mock_sleep, mock_get_db):
    """Daemon continues running even if an iteration fails."""
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count >= 2:
            raise KeyboardInterrupt
        # First call continues normally

    mock_sleep.side_effect = side_effect
    mock_get_db.side_effect = Exception("DB connection failed")

    # Should not raise -- daemon catches exceptions and continues
    run_daemon(poll_interval=10)
    assert call_count >= 1
