"""Tests for scheduled-task operations.

Pins the `_validate_owlfolio_command` guardrail that rejects phantom
subcommands (e.g. the `owlfolio watchlist check` incident where the
chat agent guessed at a CLI command that doesn't exist; the cron would
have fired and silently failed every run).
"""

import pytest


@pytest.fixture
def tmp_workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    yield tmp_path


# ─── command validator ──────────────────────────────────────────────


def test_validator_accepts_real_subcommands():
    from src.operations.tasks import _validate_owlfolio_command
    # These all exist in src/main.py
    for cmd in (
        "owlfolio analyze AAPL",
        "owlfolio portfolio --with-prices",
        "owlfolio find --count 20",
        "owlfolio watch AAPL",
        "owlfolio analyze-list my-list",
    ):
        _validate_owlfolio_command(cmd)  # must not raise


def test_validator_rejects_phantom_subcommand():
    """`owlfolio watchlist check` is the bug from the chat transcript —
    no such subcommand exists. Validator must reject it loudly."""
    from src.operations.tasks import _validate_owlfolio_command
    with pytest.raises(ValueError, match="unknown owlfolio subcommand"):
        _validate_owlfolio_command("owlfolio watchlist check")


def test_validator_suggests_close_matches():
    """Typo'd subcommands get a 'Did you mean' hint."""
    from src.operations.tasks import _validate_owlfolio_command
    with pytest.raises(ValueError, match="Did you mean"):
        _validate_owlfolio_command("owlfolio anaylze AAPL")  # typo


def test_validator_rejects_bare_owlfolio():
    from src.operations.tasks import _validate_owlfolio_command
    with pytest.raises(ValueError, match="not a valid scheduled task"):
        _validate_owlfolio_command("owlfolio")


def test_validator_passes_through_non_owlfolio_commands():
    """Users may legitimately schedule arbitrary shell — only
    `owlfolio ...` commands get the existence check.
    """
    from src.operations.tasks import _validate_owlfolio_command
    for cmd in (
        "pg_dump > /tmp/backup.sql",
        "/usr/bin/python3 /home/me/script.py",
        "echo hello",
    ):
        _validate_owlfolio_command(cmd)  # must not raise


def test_validator_rejects_unparseable_shell():
    from src.operations.tasks import _validate_owlfolio_command
    with pytest.raises(ValueError, match="not parseable as shell"):
        _validate_owlfolio_command('owlfolio analyze "unclosed quote')


# ─── add_task end-to-end ────────────────────────────────────────────


def test_add_task_rejects_phantom_command(tmp_workdir):
    """The validator fires before we touch the DB — phantom commands
    never make it into the scheduled_tasks table."""
    from src.operations.tasks import add_task, list_tasks

    with pytest.raises(ValueError, match="unknown owlfolio subcommand"):
        add_task(
            name="bad-task",
            command="owlfolio watchlist check",
            schedule="0 7 * * 1-5",
            timezone="Asia/Dubai",
        )
    # Nothing got persisted
    assert list_tasks() == []


def test_add_task_persists_real_command(tmp_workdir):
    from src.operations.tasks import add_task, list_tasks

    result = add_task(
        name="daily-watch",
        command="owlfolio analyze AAPL",
        schedule="0 7 * * 1-5",
        timezone="Asia/Dubai",
    )
    assert result["name"] == "daily-watch"
    tasks = list_tasks()
    assert len(tasks) == 1
    assert tasks[0]["command"] == "owlfolio analyze AAPL"
