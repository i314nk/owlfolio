"""Cross-component regression tests for shared Owlfolio runtime state.

These tests intentionally exercise CLI, Web, operations, daemon, and runtime helpers
through their public-ish seams so drift in one component is caught before it reaches
production UI/daemon disagreements.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

REPO_ROOT = Path(__file__).parent.parent


class _FakeSystemctl:
    def __init__(self, *, load_state: str = "loaded", active_state: str = "active"):
        self.load_state = load_state
        self.active_state = active_state

    def __call__(self, args, **kwargs):
        if args[:3] == ["systemctl", "--user", "show"]:
            return subprocess.CompletedProcess(
                args=args,
                returncode=0,
                stdout=(
                    f"LoadState={self.load_state}\n"
                    f"ActiveState={self.active_state}\n"
                    "SubState=running\n"
                ),
                stderr="",
            )
        raise AssertionError(f"unexpected subprocess call: {args}")


@pytest.fixture
def project_runtime(tmp_path, monkeypatch):
    """Minimal project root with strategies, data/config, and a real schema DB."""
    project = tmp_path / "runtime-project"
    project.mkdir()
    (project / "src").mkdir()
    (project / "data").mkdir()
    shutil.copytree(REPO_ROOT / "strategies", project / "strategies")

    from src.db.schema import _create_tables

    db_path = project / "data" / "portfolio.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    _create_tables(conn)
    conn.commit()
    conn.close()

    monkeypatch.setenv("OWLFOLIO_PROJECT_DIR", str(project))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-secret-value")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("ONECLI_URL", raising=False)
    return project


def _copy_methodology(project: Path, strategy: str = "growth") -> None:
    shutil.copy2(project / "strategies" / f"{strategy}.yaml", project / "methodology.yaml")


def test_strategy_operations_resolve_active_strategy_after_runtime_env_changes(
    tmp_path, monkeypatch, project_runtime
):
    """Operation helpers must not keep a stale project root from module import time."""
    from src.operations import strategies as strategy_ops

    _copy_methodology(project_runtime, "growth")
    monkeypatch.chdir(tmp_path)

    active = strategy_ops.get_active_strategy()

    assert active["name"] == "growth"
    assert Path(active["path"]) == project_runtime / "methodology.yaml"


def test_cli_status_uses_runtime_methodology_path_when_cwd_is_not_project(
    tmp_path, monkeypatch, project_runtime
):
    """CLI status should agree with runtime when service cwd differs from project dir."""
    _copy_methodology(project_runtime, "growth")
    monkeypatch.chdir(tmp_path)

    from src.main import app

    result = CliRunner().invoke(app, ["status"])

    assert result.exit_code == 0
    assert "growth" in result.stdout
    assert "methodology.yaml" in result.stdout
    assert "exists" in result.stdout
    assert "unknown" not in result.stdout.lower()


def test_web_tasks_use_runtime_db_path_after_web_module_was_imported(project_runtime, monkeypatch):
    """The Web Schedule tab should read the runtime DB path, not an import-cached path."""
    from src.db.operations import add_scheduled_task
    from src.web import app as web_app

    monkeypatch.setattr(web_app, "DB_PATH", project_runtime / "data" / "wrong-empty.db")
    monkeypatch.setattr(web_app, "_is_daemon_running", lambda: False)
    conn = sqlite3.connect(str(project_runtime / "data" / "portfolio.db"))
    conn.row_factory = sqlite3.Row
    add_scheduled_task(
        conn,
        name="runtime-visible-task",
        command="owlfolio status",
        schedule="0 9 * * *",
        timezone="UTC",
        description="from runtime db",
    )
    conn.close()

    response = TestClient(web_app.app).get("/api/tasks")

    assert response.status_code == 200
    assert "runtime-visible-task" in response.text


def test_web_market_universe_config_uses_runtime_project_dir_after_import(project_runtime):
    """The Web market-universe API and discovery loader must read the same config file."""
    from src.web import app as web_app

    (project_runtime / "data" / "config.yaml").write_text("markets:\n  - AE\n  - IN\n")

    response = TestClient(web_app.app).get("/api/config/markets")

    assert response.status_code == 200
    assert response.json()["markets"] == ["AE", "IN"]

    from src.agents.discovery import _load_market_universe

    universe = _load_market_universe()
    assert universe.codes == ["AE", "IN"]
    assert "non-credentialed discovery universe" in universe.prompt_section()
    assert "broker accounts" in universe.prompt_section()


def test_runtime_status_web_endpoint_agrees_with_operations_without_exposing_secrets(
    project_runtime, monkeypatch
):
    """One structured Web endpoint should mirror operation/runtime state safely."""
    from src.db.operations import add_scheduled_task, get_scheduled_tasks
    from src.operations.system import doctor_report
    from src.web import app as web_app

    _copy_methodology(project_runtime, "growth")
    (project_runtime / "data" / "config.yaml").write_text("markets:\n  - US\n  - AE\n")
    conn = sqlite3.connect(str(project_runtime / "data" / "portfolio.db"))
    conn.row_factory = sqlite3.Row
    add_scheduled_task(
        conn,
        name="daily-watchlist-check",
        command="owlfolio watchlist-check --no-llm-price",
        schedule="30 17 * * 1-5",
        timezone="Asia/Dubai",
        description="safe default",
        enabled=True,
    )
    tasks = get_scheduled_tasks(conn)
    conn.close()
    fake_daemon = {
        "running": True,
        "source": "systemd-user-service",
        "pids": [],
        "pid_file": str(project_runtime / "data" / "daemon.pid"),
        "pid_file_exists": False,
        "service_name": "owlfolio-daemon.service",
        "service_load_state": "loaded",
        "service_active_state": "active",
        "service_sub_state": "running",
        "error": None,
    }
    monkeypatch.setattr("src.operations.tasks.daemon_status", lambda: fake_daemon)

    response = TestClient(web_app.app).get("/api/runtime-status")
    report = doctor_report()

    assert response.status_code == 200
    payload = response.json()
    assert payload["project_dir"] == str(project_runtime)
    assert payload["db_path"] == str(project_runtime / "data" / "portfolio.db")
    assert payload["active_strategy"]["name"] == "growth"
    assert payload["credentials"] == {"ok": True, "source": "ANTHROPIC_API_KEY"}
    assert "sk-test-secret-value" not in str(payload)
    assert payload["daemon"]["running"] is report["daemon"]["running"] is True
    assert payload["daemon"]["source"] == report["daemon"]["source"] == "systemd-user-service"
    assert payload["scheduled_tasks"]["total"] == len(tasks) == 1
    assert payload["scheduled_tasks"]["enabled"] == 1
    assert payload["scheduled_tasks"]["names"] == ["daily-watchlist-check"]
    assert payload["market_universe"]["codes"] == ["US", "AE"]
    assert payload["market_universe"]["terminology"] == "market-universe"


def test_cli_status_and_web_daemon_pill_agree_when_systemd_active_without_pid_file(
    tmp_path, monkeypatch
):
    """Regression: missing PID file must not make Web disagree with service health."""
    fake_systemctl = _FakeSystemctl(active_state="active")
    monkeypatch.setattr("src.daemon_health.subprocess_run", fake_systemctl)
    monkeypatch.setattr("src.daemon.PID_FILE", tmp_path / "missing.pid")

    from src.main import app
    from src.web import app as web_app

    cli = CliRunner().invoke(app, ["status"])
    web = TestClient(web_app.app).get("/api/daemon-status")

    assert cli.exit_code == 0
    assert "running" in cli.stdout
    assert "systemd-user-service" in cli.stdout
    assert web.status_code == 200
    assert "Daemon running" in web.text
    assert "Daemon off" not in web.text


def test_cli_setup_writes_market_config_to_runtime_project_when_cwd_differs(
    tmp_path, monkeypatch, project_runtime
):
    """Setup must save timezone/market config beside the runtime DB, not cwd."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "src.data.prices.get_price_data",
        lambda ticker: SimpleNamespace(name="Apple", price=123.45, market_cap=3_000_000_000_000),
    )

    from src.main import app

    result = CliRunner().invoke(app, ["setup", "--quick"], input="3\nAsia/Dubai\nn\n")

    runtime_config = project_runtime / "data" / "config.yaml"
    assert result.exit_code == 0
    assert runtime_config.exists()
    assert "timezone: Asia/Dubai" in runtime_config.read_text()
    assert not (tmp_path / "data" / "config.yaml").exists()


def test_web_daemon_start_uses_request_time_runtime_project_dir(
    project_runtime, tmp_path, monkeypatch
):
    """Web daemon start must launch in the same runtime project reported by status APIs."""
    from src.web import app as web_app

    wrong_project = tmp_path / "wrong-import-root"
    (wrong_project / "logs").mkdir(parents=True)
    (project_runtime / "logs").mkdir()
    monkeypatch.setattr(web_app, "PROJECT_DIR", wrong_project)

    calls = []

    class FakePopen:
        def __init__(self, args, **kwargs):
            stdout = kwargs.get("stdout")
            calls.append(
                {
                    "args": args,
                    "cwd": kwargs.get("cwd"),
                    "stdout": getattr(stdout, "name", None),
                    "start_new_session": kwargs.get("start_new_session"),
                }
            )
            if stdout is not None:
                stdout.close()

    monkeypatch.setattr("subprocess.Popen", FakePopen)

    response = TestClient(web_app.app).post("/api/daemon/start")

    assert response.status_code == 200
    assert response.json() == {"status": "started"}
    assert calls == [
        {
            "args": [__import__("sys").executable, "-m", "src.main", "daemon"],
            "cwd": str(project_runtime),
            "stdout": str(project_runtime / "logs" / "daemon.log"),
            "start_new_session": True,
        }
    ]
