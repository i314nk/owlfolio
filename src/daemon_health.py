"""Shared daemon health resolution for CLI, Web UI, and operations."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from subprocess import SubprocessError
from subprocess import run as subprocess_run
from typing import Any

from src.runtime import resolve_project_root

DAEMON_SERVICE_NAME = "owlfolio-daemon.service"


@dataclass(frozen=True)
class DaemonHealth:
    """Safe-to-display daemon health from the most authoritative source available."""

    running: bool
    source: str
    pids: list[int]
    pid_file: str
    pid_file_exists: bool
    service_name: str = DAEMON_SERVICE_NAME
    service_load_state: str | None = None
    service_active_state: str | None = None
    service_sub_state: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable representation."""
        return asdict(self)


def default_pid_file() -> Path:
    """Return Owlfolio's default daemon PID-file path."""
    return resolve_project_root() / "data" / "daemon.pid"


def resolve_daemon_health(
    *,
    pid_file: Path | None = None,
    service_name: str = DAEMON_SERVICE_NAME,
) -> DaemonHealth:
    """Resolve daemon health using service-manager state before PID files.

    Precedence:
    1. If the user-level systemd service is loaded, its ActiveState is
       authoritative. This matches production installs where systemd owns the
       daemon lifecycle and a missing PID file should not hide a running unit.
    2. If systemd is unavailable or the unit is not installed, fall back to the
       local development PID-file check.
    """
    resolved_pid_file = pid_file or default_pid_file()
    systemd_health = _systemd_user_service_health(resolved_pid_file, service_name)
    if systemd_health is not None:
        return systemd_health
    return _pid_file_health(resolved_pid_file, source="pid-file", service_name=service_name)


def _systemd_user_service_health(pid_file: Path, service_name: str) -> DaemonHealth | None:
    try:
        result = subprocess_run(
            [
                "systemctl",
                "--user",
                "show",
                service_name,
                "--property=LoadState",
                "--property=ActiveState",
                "--property=SubState",
                "--no-page",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (FileNotFoundError, SubprocessError, OSError):
        return None

    if result.returncode != 0:
        return None

    props = _parse_systemctl_show(result.stdout)
    load_state = props.get("LoadState")
    if load_state in (None, "not-found"):
        return None

    active_state = props.get("ActiveState")
    sub_state = props.get("SubState")
    return DaemonHealth(
        running=active_state == "active",
        source="systemd-user-service",
        pids=[],
        pid_file=str(pid_file),
        pid_file_exists=pid_file.exists(),
        service_name=service_name,
        service_load_state=load_state,
        service_active_state=active_state,
        service_sub_state=sub_state,
    )


def _parse_systemctl_show(output: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for line in output.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            props[key] = value
    return props


def _pid_file_health(pid_file: Path, *, source: str, service_name: str) -> DaemonHealth:
    if not pid_file.exists():
        return DaemonHealth(
            running=False,
            source=source,
            pids=[],
            pid_file=str(pid_file),
            pid_file_exists=False,
            service_name=service_name,
        )

    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
    except (ValueError, OSError, ProcessLookupError) as e:
        try:
            pid_file.unlink(missing_ok=True)
        except OSError:
            pass
        return DaemonHealth(
            running=False,
            source=source,
            pids=[],
            pid_file=str(pid_file),
            pid_file_exists=pid_file.exists(),
            service_name=service_name,
            error=str(e),
        )

    return DaemonHealth(
        running=True,
        source=source,
        pids=[pid],
        pid_file=str(pid_file),
        pid_file_exists=True,
        service_name=service_name,
    )
