"""Smoke tests for CLI commands — verify they don't crash on import/basic call."""

from typer.testing import CliRunner

from src.main import app

runner = CliRunner()


def test_cli_app_imports():
    """The main app can be imported without errors."""
    assert app is not None


def test_strategy_list():
    """Strategy --list doesn't crash."""
    result = runner.invoke(app, ["strategy", "--list"])
    assert result.exit_code == 0


def test_status():
    """Status command doesn't crash."""
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0


def test_specialists():
    """Specialists command doesn't crash and lists the roster."""
    result = runner.invoke(app, ["specialists"])
    assert result.exit_code == 0


def test_plugins_command_removed():
    """The old 'plugins' command was renamed to 'specialists'. Confirm it's gone."""
    result = runner.invoke(app, ["plugins"])
    # Typer returns non-zero with 'No such command' when the command is unknown.
    assert result.exit_code != 0


def test_strategy_show_no_research_sections():
    """`config show` must not crash even though research.sections was removed."""
    result = runner.invoke(app, ["config", "show"])
    assert result.exit_code == 0
    assert "Specialists" in result.stdout


def test_doctor_command_runs():
    """`owlfolio doctor` produces a health report and exits 0."""
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    assert "Owlfolio Doctor" in result.stdout
    # Each major section should appear
    for label in ("Python", "credentials", "strategy", "Portfolio DB", "Web UI port", "Daemon", "Runtime"):
        assert label.lower() in result.stdout.lower(), f"doctor missing section: {label}"


def test_install_script_exists():
    """install.sh must exist, be executable, and support native mode."""
    import os
    from pathlib import Path
    script = Path(__file__).parent.parent / "install.sh"
    assert script.exists(), "install.sh is the one-command entrypoint advertised in README"
    assert os.access(script, os.X_OK), "install.sh must be executable"
    text = script.read_text()
    assert "install_native" in text


def test_alerts():
    """Alerts command doesn't crash."""
    result = runner.invoke(app, ["alerts"])
    assert result.exit_code == 0


def test_analyses_empty():
    """Analyses command doesn't crash with empty DB."""
    result = runner.invoke(app, ["analyses"])
    assert result.exit_code == 0


def test_portfolio_empty():
    """Portfolio command doesn't crash with empty portfolio."""
    result = runner.invoke(app, ["portfolio"])
    assert result.exit_code == 0


def test_performance_empty():
    """Performance command doesn't crash with no snapshots."""
    result = runner.invoke(app, ["performance"])
    assert result.exit_code == 0


def test_tasks_empty():
    """Tasks command doesn't crash with no tasks."""
    result = runner.invoke(app, ["tasks"])
    assert result.exit_code == 0
