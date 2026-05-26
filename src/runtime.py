"""Shared runtime state resolution for Owlfolio.

This module is the single place that resolves filesystem/runtime state shared
across the CLI, Web UI, daemon, operations, and tests. Keep it free of heavy
application imports so callers can safely import it during startup.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

DEFAULT_STRATEGY_NAME = "buffett-munger"
LEGACY_DEFAULT_STRATEGY_NAME = "buffett-value"


@dataclass(frozen=True)
class CredentialsStatus:
    """Safe-to-display credential status; never include secret values."""

    ok: bool
    source: str | None = None


@dataclass(frozen=True)
class RuntimeContext:
    """Resolved runtime paths and status needed by Owlfolio entry points."""

    project_root: Path
    db_path: Path
    strategies_dir: Path
    methodology_path: Path
    active_strategy_path: Path
    active_strategy_name: str
    credentials: CredentialsStatus
    runtime: str = "native"


def resolve_project_root() -> Path:
    """Resolve project root: OWLFOLIO_PROJECT_DIR env > cwd > package location."""
    explicit = os.environ.get("OWLFOLIO_PROJECT_DIR")
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if path.exists():
            return path

    cwd = Path.cwd().resolve()
    if (cwd / "strategies").is_dir() and (cwd / "src").is_dir():
        return cwd

    # src/runtime.py -> src -> project root
    return Path(__file__).parent.parent.resolve()


def resolve_strategies_dir(project_root: Path | None = None) -> Path:
    """Return the preset strategy directory for a resolved project root."""
    root = project_root or resolve_project_root()
    return root / "strategies"


def resolve_methodology_path(project_root: Path | None = None) -> Path:
    """Return the active methodology.yaml path for a resolved project root."""
    root = project_root or resolve_project_root()
    return root / "methodology.yaml"


def resolve_database_path(project_root: Path | None = None) -> Path:
    """Return the operational SQLite database path."""
    if project_root is None and not os.environ.get("OWLFOLIO_PROJECT_DIR"):
        cwd_data = Path.cwd() / "data"
        if cwd_data.is_dir():
            return cwd_data / "portfolio.db"
    root = project_root or resolve_project_root()
    return root / "data" / "portfolio.db"


def default_strategy_path(project_root: Path | None = None) -> Path:
    """Return the production default strategy preset path."""
    return resolve_strategies_dir(project_root) / f"{DEFAULT_STRATEGY_NAME}.yaml"


def resolve_active_strategy_path(project_root: Path | None = None) -> Path:
    """Return methodology.yaml if present, otherwise the production default preset."""
    root = project_root or resolve_project_root()
    methodology = resolve_methodology_path(root)
    if methodology.exists():
        return methodology

    default = default_strategy_path(root)
    if default.exists():
        return default

    # Kept only as a last-ditch compatibility fallback for very old checkouts.
    legacy = resolve_strategies_dir(root) / f"{LEGACY_DEFAULT_STRATEGY_NAME}.yaml"
    if legacy.exists():
        return legacy

    return default


def read_strategy_name(path: Path) -> str:
    """Read a strategy YAML name, returning 'unknown' when unreadable."""
    try:
        raw: dict[str, Any] | None = yaml.safe_load(path.read_text())
        if raw:
            return str(raw.get("name") or path.stem)
    except Exception:
        pass
    return "unknown"


def resolve_active_strategy_name(project_root: Path | None = None) -> str:
    """Return the active strategy's configured name."""
    return read_strategy_name(resolve_active_strategy_path(project_root))


def resolve_credentials_status() -> CredentialsStatus:
    """Resolve Claude/Anthropic credential status without exposing secrets."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return CredentialsStatus(ok=True, source="ANTHROPIC_API_KEY")
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return CredentialsStatus(ok=True, source="CLAUDE_CODE_OAUTH_TOKEN")
    if os.environ.get("ONECLI_URL"):
        return CredentialsStatus(ok=True, source="ONECLI_URL")

    credentials_file = Path.home() / ".claude" / ".credentials.json"
    if credentials_file.exists():
        return CredentialsStatus(ok=True, source="~/.claude/.credentials.json")

    return CredentialsStatus(ok=False, source=None)


def get_runtime_context(project_root: Path | None = None) -> RuntimeContext:
    """Resolve all runtime state from the same source-of-truth decisions."""
    root = project_root or resolve_project_root()
    if project_root is not None:
        db_path = resolve_database_path(project_root)
    else:
        db_path = resolve_database_path()
    active_path = resolve_active_strategy_path(root)
    return RuntimeContext(
        project_root=root,
        db_path=db_path,
        strategies_dir=resolve_strategies_dir(root),
        methodology_path=resolve_methodology_path(root),
        active_strategy_path=active_path,
        active_strategy_name=read_strategy_name(active_path),
        credentials=resolve_credentials_status(),
    )
