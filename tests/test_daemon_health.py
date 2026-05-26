"""Regression tests for shared daemon health resolution."""

from __future__ import annotations

import subprocess


class _FakeSystemctl:
    def __init__(self, *, load_state: str = "loaded", active_state: str = "active"):
        self.load_state = load_state
        self.active_state = active_state
        self.calls: list[list[str]] = []

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args[:3] == ["systemctl", "--user", "show"]:
            return subprocess.CompletedProcess(
                args=args,
                returncode=0,
                stdout=f"LoadState={self.load_state}\nActiveState={self.active_state}\nSubState=running\n",
                stderr="",
            )
        raise AssertionError(f"unexpected subprocess call: {args}")


def test_systemd_active_service_is_running_without_pid_file(tmp_path, monkeypatch):
    """Production user service is authoritative when loaded and active."""
    from src.daemon_health import resolve_daemon_health

    missing_pid = tmp_path / "daemon.pid"
    fake_systemctl = _FakeSystemctl(active_state="active")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)

    health = resolve_daemon_health(pid_file=missing_pid)

    assert health.running is True
    assert health.source == "systemd-user-service"
    assert health.service_active_state == "active"
    assert health.pid_file_exists is False


def test_systemd_inactive_service_is_not_running_even_with_stale_pid(tmp_path, monkeypatch):
    """A loaded inactive service must not be treated as alive from stale pid data."""
    from src.daemon_health import resolve_daemon_health

    pid_file = tmp_path / "daemon.pid"
    pid_file.write_text("12345")
    fake_systemctl = _FakeSystemctl(active_state="inactive")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)
    monkeypatch.setattr("src.daemon_health.os.kill", lambda pid, sig: None)

    health = resolve_daemon_health(pid_file=pid_file)

    assert health.running is False
    assert health.source == "systemd-user-service"
    assert health.service_active_state == "inactive"


def test_missing_systemd_unit_falls_back_to_live_pid_file(tmp_path, monkeypatch):
    """Local/non-systemd development keeps the pid-file behavior."""
    from src.daemon_health import resolve_daemon_health

    pid_file = tmp_path / "daemon.pid"
    pid_file.write_text("12345")
    fake_systemctl = _FakeSystemctl(load_state="not-found", active_state="inactive")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)
    monkeypatch.setattr("src.daemon_health.os.kill", lambda pid, sig: None)

    health = resolve_daemon_health(pid_file=pid_file)

    assert health.running is True
    assert health.source == "pid-file"
    assert health.pids == [12345]


def test_operation_doctor_and_daemon_status_share_systemd_health(tmp_path, monkeypatch):
    """Structured status APIs agree on active service / missing pid behavior."""
    fake_systemctl = _FakeSystemctl(active_state="active")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)
    monkeypatch.setattr("src.daemon.PID_FILE", tmp_path / "missing.pid")

    from src.operations.system import doctor_report
    from src.operations.tasks import daemon_status

    status = daemon_status()
    report = doctor_report()

    assert status["running"] is True
    assert status["source"] == "systemd-user-service"
    assert report["daemon"]["running"] is True
    assert report["daemon"]["source"] == "systemd-user-service"


def test_web_daemon_status_uses_shared_systemd_health(tmp_path, monkeypatch):
    """The htmx daemon pill should agree with CLI/operations status."""
    from fastapi.testclient import TestClient

    fake_systemctl = _FakeSystemctl(active_state="active")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)
    monkeypatch.setattr("src.daemon.PID_FILE", tmp_path / "missing.pid")

    from src.web import app as web_app

    response = TestClient(web_app.app).get("/api/daemon-status")

    assert response.status_code == 200
    assert "Daemon off" not in response.text
    assert "Daemon running" in response.text
