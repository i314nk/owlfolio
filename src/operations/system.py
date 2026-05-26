"""System operations — health checks, doctor report, runtime detection."""

from __future__ import annotations

import socket
import sqlite3
import sys
from pathlib import Path
from typing import Any

from src.runtime import get_runtime_context


def _port_free(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            return s.connect_ex(("127.0.0.1", port)) != 0
    except OSError:
        return True


def doctor_report() -> dict[str, Any]:
    """One-stop health report — Python, credentials, strategy, DB, port, daemon, runtime.

    Same data the `owlfolio doctor` CLI command renders, but as a structured
    dict so the chat agent can answer "is everything OK?" without parsing
    text output.
    """
    from src.operations.strategies import get_active_strategy

    runtime_context = get_runtime_context()
    db_path = runtime_context.db_path
    auth = runtime_context.credentials

    # Strategy
    strategy_status: dict[str, Any]
    try:
        active = get_active_strategy()
        strategy_status = {
            "ok": True,
            "name": active["name"],
            "path": active["path"],
            "specialists": len(active["specialists"]),
        }
    except Exception as e:
        strategy_status = {"ok": False, "error": str(e)}

    # DB
    db_status: dict[str, Any] = {"path": str(db_path), "exists": Path(db_path).exists()}
    if db_status["exists"]:
        try:
            conn = sqlite3.connect(str(db_path))
            db_status["holdings"] = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
            db_status["analyses"] = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
            conn.close()
        except Exception as e:
            db_status["error"] = str(e)

    # Daemon
    from src.operations.tasks import daemon_status

    daemon_health = daemon_status()

    return {
        "python": {
            "version": sys.version.split()[0],
            "ok": sys.version_info >= (3, 12),
        },
        "credentials": {"ok": auth.ok, "source": auth.source},
        "strategy": strategy_status,
        "database": db_status,
        "web_ui_port_8000_free": _port_free(8000),
        "daemon": daemon_health,
        "runtime": "native",
    }
