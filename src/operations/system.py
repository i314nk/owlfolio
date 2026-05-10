"""System operations — health checks, doctor report, runtime detection."""

from __future__ import annotations

import os
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any


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
    from src.db.schema import DB_PATH
    from src.llm.provider import _load_oauth_token
    from src.operations.strategies import get_active_strategy

    # Auth
    auth = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        auth = "API key (ANTHROPIC_API_KEY)"
    elif os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        auth = "Agent SDK token (CLAUDE_CODE_OAUTH_TOKEN)"
    elif _load_oauth_token():
        auth = "Claude subscription (~/.claude/.credentials.json)"

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
    db_status: dict[str, Any] = {"path": str(DB_PATH), "exists": Path(DB_PATH).exists()}
    if db_status["exists"]:
        try:
            conn = sqlite3.connect(str(DB_PATH))
            db_status["holdings"] = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
            db_status["analyses"] = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
            conn.close()
        except Exception as e:
            db_status["error"] = str(e)

    # Daemon
    try:
        result = subprocess.run(["pgrep", "-f", "owlfolio.*daemon"], capture_output=True, timeout=2)
        daemon_alive = result.returncode == 0
    except Exception:
        daemon_alive = False

    return {
        "python": {
            "version": sys.version.split()[0],
            "ok": sys.version_info >= (3, 12),
        },
        "credentials": {"ok": auth is not None, "source": auth},
        "strategy": strategy_status,
        "database": db_status,
        "web_ui_port_8000_free": _port_free(8000),
        "daemon": {"running": daemon_alive},
        "runtime": "native",
    }
