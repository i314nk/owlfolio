"""Runtime state resolution contract shared by CLI, Web, daemon, and operations."""

from __future__ import annotations

import shutil
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent


def _project_with_strategies(tmp_path: Path) -> Path:
    project_dir = tmp_path / "owlfolio-project"
    project_dir.mkdir()
    (project_dir / "src").mkdir()
    shutil.copytree(REPO_ROOT / "strategies", project_dir / "strategies")
    return project_dir


def test_active_strategy_falls_back_to_buffett_munger_without_methodology(tmp_path, monkeypatch):
    """No methodology.yaml should still resolve to the production default strategy preset."""
    project_dir = _project_with_strategies(tmp_path)
    monkeypatch.setenv("OWLFOLIO_PROJECT_DIR", str(project_dir))

    from src.runtime import get_runtime_context, resolve_active_strategy_path

    active_path = resolve_active_strategy_path()
    context = get_runtime_context()

    assert active_path == project_dir / "strategies" / "buffett-munger.yaml"
    assert context.active_strategy_path == active_path
    assert context.active_strategy_name == "buffett-munger"
    assert context.methodology_path == project_dir / "methodology.yaml"
    assert context.db_path == project_dir / "data" / "portfolio.db"


def test_active_strategy_uses_explicit_methodology_yaml(tmp_path, monkeypatch):
    """An explicit methodology.yaml should be the single active strategy source."""
    project_dir = _project_with_strategies(tmp_path)
    monkeypatch.setenv("OWLFOLIO_PROJECT_DIR", str(project_dir))
    shutil.copy2(project_dir / "strategies" / "growth.yaml", project_dir / "methodology.yaml")

    from src.runtime import get_runtime_context, resolve_active_strategy_path

    active_path = resolve_active_strategy_path()
    context = get_runtime_context()

    assert active_path == project_dir / "methodology.yaml"
    assert context.active_strategy_path == active_path
    assert context.active_strategy_name == "growth"


def test_runtime_context_uses_same_db_path_decision_as_database_helper(tmp_path, monkeypatch):
    """RuntimeContext and direct DB helper should not diverge in temp cwd mode."""
    runtime_dir = tmp_path / "runtime-cwd"
    (runtime_dir / "data").mkdir(parents=True)
    monkeypatch.chdir(runtime_dir)
    monkeypatch.delenv("OWLFOLIO_PROJECT_DIR", raising=False)

    from src.runtime import get_runtime_context, resolve_database_path

    assert get_runtime_context().db_path == resolve_database_path()


def test_runtime_reports_production_auth_status_without_exposing_secret(tmp_path, monkeypatch):
    """Runtime auth status should identify configured production credentials safely."""
    project_dir = _project_with_strategies(tmp_path)
    monkeypatch.setenv("OWLFOLIO_PROJECT_DIR", str(project_dir))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant...alue")
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)

    from src.runtime import get_runtime_context

    auth = get_runtime_context().credentials

    assert auth.ok is True
    assert auth.source == "ANTHROPIC_API_KEY"
    assert "secret" not in repr(auth).lower()


def test_cli_and_web_use_runtime_active_strategy_resolution(tmp_path, monkeypatch):
    """CLI and Web helpers should agree with the runtime helper."""
    project_dir = _project_with_strategies(tmp_path)
    monkeypatch.setenv("OWLFOLIO_PROJECT_DIR", str(project_dir))

    from src import main
    from src.runtime import resolve_active_strategy_path
    from src.web import app as web_app

    assert Path(main.get_default_strategy()) == resolve_active_strategy_path()
    assert web_app._read_active_strategy_name() == "buffett-munger"

    shutil.copy2(project_dir / "strategies" / "growth.yaml", project_dir / "methodology.yaml")
    raw = yaml.safe_load((project_dir / "methodology.yaml").read_text())

    assert Path(main.get_default_strategy()) == resolve_active_strategy_path()
    assert web_app._read_active_strategy_name() == raw["name"]
