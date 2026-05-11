"""Owlfolio Daemon -- background task executor.

Runs scheduled tasks from the SQLite database on their cron schedules.
Start with: owlfolio daemon
"""

import logging
import os
import signal
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from croniter import croniter

from src.db.operations import (
    add_alert,
    get_scheduled_tasks,
    log_task_run,
    record_task_run_end,
    record_task_run_start,
)
from src.db.schema import get_db

logger = logging.getLogger("owlfolio.daemon")


def _resolve_project_root() -> Path:
    """Resolve project root: OWLFOLIO_PROJECT_DIR env > cwd > __file__."""
    explicit = os.environ.get("OWLFOLIO_PROJECT_DIR")
    if explicit:
        p = Path(explicit).resolve()
        if p.exists():
            return p
    cwd = Path.cwd()
    if (cwd / "strategies").is_dir() and (cwd / "src").is_dir():
        return cwd
    return Path(__file__).parent.parent


PROJECT_ROOT = _resolve_project_root()
PID_FILE = PROJECT_ROOT / "data" / "daemon.pid"
# Ensure the venv's bin directory is on PATH so `owlfolio` resolves in
# subprocess shells spawned by _execute_task.
_venv_bin = str(PROJECT_ROOT / ".venv" / "bin")
if _venv_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _venv_bin + os.pathsep + os.environ.get("PATH", "")


def _write_pid():
    """Write current PID to the pid file."""
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))


def _remove_pid():
    """Remove the pid file on shutdown."""
    try:
        PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def is_daemon_running() -> bool:
    """Check if the daemon is running by reading the PID file and verifying
    the process is alive. This avoids false positives from pgrep matching
    unrelated processes (e.g. Claude Agent SDK subprocesses whose command
    line contains 'daemon' in the system prompt text).
    """
    try:
        if not PID_FILE.exists():
            return False
        pid = int(PID_FILE.read_text().strip())
        # Signal 0 checks process existence without actually signalling it
        os.kill(pid, 0)
        return True
    except (ValueError, OSError, ProcessLookupError):
        # Stale PID file or process gone — clean up
        _remove_pid()
        return False


def stop_daemon() -> bool:
    """Stop the daemon by sending SIGTERM to the PID in the pid file.
    Returns True if a signal was sent, False if daemon wasn't running.
    """
    try:
        if not PID_FILE.exists():
            return False
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        # Wait briefly for process to exit
        for _ in range(10):
            try:
                os.kill(pid, 0)
                time.sleep(0.5)
            except ProcessLookupError:
                break
        _remove_pid()
        return True
    except (ValueError, ProcessLookupError):
        _remove_pid()
        return False
    except OSError:
        return False


def _is_due(task: dict, now: datetime) -> bool:
    """Check if a task's cron schedule means it should run now."""
    tz = ZoneInfo(task.get("timezone") or "UTC")
    local_now = now.astimezone(tz)

    last_run = task.get("last_run")
    if last_run:
        last_dt = datetime.fromisoformat(last_run).astimezone(tz)
    else:
        # Never run before -- use start of today so it fires on next match
        last_dt = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    cron = croniter(task["schedule"], last_dt)
    next_run = cron.get_next(datetime)

    return local_now >= next_run


def _strip_rich_tables(text: str) -> str:
    """Strip Rich box-drawing characters and collapse whitespace."""
    import re

    # Remove box-drawing lines (━, ┃, ┏, ┓, ┗, ┛, ┣, ┫, ┳, ┻, ╋, ┡, ╇, etc.)
    text = re.sub(r"[┏┓┗┛┣┫┳┻╋┡╇━┃╈╉╊╃╄╅╆╀╁╂┠┨┯┷┝┥┰┸┍┑┕┙┞┦┟┧┮┶┭┵┲┺┱┹╞╡╥╨]+", "", text)
    # Collapse multiple spaces/whitespace into single space
    text = re.sub(r"[ \t]{2,}", " ", text)
    # Remove blank lines
    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()


def _check_for_alerts(conn, task: dict, output: str, run_id: int | None = None):
    """Check task output for alert-worthy content and create alerts."""
    alert_keywords = {
        "BUY ZONE": "price_alert",
        "below buy price": "price_alert",
        "FAIL": "risk_alert",
        "dividend cut": "dividend_alert",
    }
    for keyword, alert_type in alert_keywords.items():
        if keyword.lower() in output.lower():
            clean = _strip_rich_tables(output)
            add_alert(
                conn,
                alert_type,
                f"[{task['name']}] {clean[:500]}",
                ticker=None,
                task_run_id=run_id,
            )
            break


def _execute_task(task: dict):
    """Run a task's command and persist the result.

    Two persistence paths run in parallel — they serve different
    consumers and we want both:

    * `log_task_run` updates the parent `scheduled_tasks` row's
      `last_run` / `last_result` so the Schedule tab shows freshness.
    * `record_task_run_start` / `record_task_run_end` append to the
      `task_runs` history table the Activity feed reads from. Without
      this, the Activity tab's `task_run` events would always be empty
      in production (the table I added would have no producer).

    Both paths must always close out, even on timeout or exception —
    otherwise a `task_runs` row stays `running` forever and the audit
    feed lies about state. Hence the try/except/finally around each
    call site rather than a single wrapper.
    """
    logger.info("Running task: %s (%s)", task["name"], task["command"])

    conn = get_db()
    run_id: int | None = None
    try:
        run_id = record_task_run_start(
            conn,
            task["id"],
            task["name"],
            task["command"],
        )
    except Exception as e:
        logger.error("Could not open task_runs row for %s: %s", task["name"], e)

    try:
        result = subprocess.run(
            task["command"],
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(PROJECT_ROOT),
        )

        success = result.returncode == 0
        output = result.stdout[:1000] if result.stdout else ""
        if result.stderr:
            output += f"\nSTDERR: {result.stderr[:500]}"

        log_task_run(conn, task["id"], "success" if success else "error", output)
        if run_id is not None:
            record_task_run_end(
                conn,
                run_id,
                exit_code=result.returncode,
                stdout=result.stdout or "",
                stderr=result.stderr or "",
            )

        if success:
            logger.info("Task %s completed successfully", task["name"])
            _check_for_alerts(conn, task, output, run_id=run_id)
        else:
            logger.warning(
                "Task %s failed (exit %d): %s",
                task["name"],
                result.returncode,
                result.stderr[:200],
            )

    except subprocess.TimeoutExpired:
        log_task_run(conn, task["id"], "timeout", "Task exceeded 5 minute timeout")
        if run_id is not None:
            # Convention: -1 = timeout, distinct from the subprocess's own exit codes.
            record_task_run_end(
                conn,
                run_id,
                exit_code=-1,
                stdout="",
                stderr="Task exceeded 5 minute timeout",
            )
        logger.error("Task %s timed out", task["name"])
    except Exception as e:
        log_task_run(conn, task["id"], "error", str(e))
        if run_id is not None:
            record_task_run_end(
                conn,
                run_id,
                exit_code=-2,
                stdout="",
                stderr=str(e),
            )
        logger.error("Task %s error: %s", task["name"], e)
    finally:
        conn.close()


def run_daemon(poll_interval: int = 60):
    """Main daemon loop. Checks for due tasks every poll_interval seconds."""
    logger.info("Owlfolio daemon starting (poll every %ds)...", poll_interval)

    _write_pid()
    try:
        while True:
            try:
                conn = get_db()
                try:
                    tasks = get_scheduled_tasks(conn, enabled_only=True)
                finally:
                    conn.close()

                now = datetime.now().astimezone()

                for task in tasks:
                    if _is_due(task, now):
                        _execute_task(task)

            except KeyboardInterrupt:
                raise
            except Exception as e:
                logger.error("Daemon error: %s", e)

            time.sleep(poll_interval)

    except KeyboardInterrupt:
        logger.info("Daemon shutting down...")
    finally:
        _remove_pid()
