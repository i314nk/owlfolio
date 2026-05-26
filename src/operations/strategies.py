"""Strategy operations — listing, switching, info, specialist roster."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

from src.operations import validate_strategy_name
from src.runtime import (
    resolve_active_strategy_path,
    resolve_methodology_path,
    resolve_project_root,
    resolve_strategies_dir,
)
from src.strategy.loader import Strategy, load_strategy

# These paths are resolved against the project root, NOT the current
# working directory. Resolution order:
#   1. OWLFOLIO_PROJECT_DIR env var (an explicit override for tests / CI)
#   2. $PWD if it contains a `strategies/` directory (running from project root)
#   3. The package's own location (Path(__file__).parent.parent.parent),
#      which is the project root for the editable `pip install -e .` install
#
# Without anchoring, `switch_strategy` writes `./methodology.yaml`
# relative to the web server's cwd while the dashboard endpoint reads
# `<project_root>/methodology.yaml` — the two diverge whenever
# `owlfolio serve` is launched from anywhere except the project root,
# producing the "I switched but the header didn't update" bug.


PROJECT_ROOT = resolve_project_root()
STRATEGIES_DIR = resolve_strategies_dir(PROJECT_ROOT)
METHODOLOGY_PATH = resolve_methodology_path(PROJECT_ROOT)


def _project_root() -> Path:
    """Resolve the active project root at call time."""
    return resolve_project_root()


def _strategies_dir() -> Path:
    """Resolve the active preset strategies directory at call time."""
    return resolve_strategies_dir(_project_root())


def _methodology_path() -> Path:
    """Resolve the active methodology.yaml path at call time."""
    return resolve_methodology_path(_project_root())


def list_strategies() -> list[dict[str, Any]]:
    """Every strategy YAML in strategies/, with name and one-line description."""
    out = []
    strategies_dir = _strategies_dir()
    if not strategies_dir.exists():
        return out
    for f in sorted(strategies_dir.glob("*.yaml")):
        try:
            raw = yaml.safe_load(f.read_text())
            if not raw:
                continue
            desc = (raw.get("description") or "").strip()
            if len(desc) > 120:
                desc = desc[:117] + "..."
            out.append({"name": raw.get("name", f.stem), "description": desc, "path": str(f)})
        except Exception:
            continue
    return out


def get_active_strategy() -> dict[str, Any]:
    """Return a structured summary of the active strategy (methodology.yaml)."""
    path = resolve_active_strategy_path(_project_root())
    if not path.exists():
        raise FileNotFoundError(f"No active strategy found at {path}")
    return _strategy_summary(load_strategy(path), path=str(path))


def get_strategy_info(name: str) -> dict[str, Any]:
    """Return a structured summary of a named preset strategy."""
    n = validate_strategy_name(name)
    path = _strategies_dir() / f"{n}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"strategy {n!r} not found at {path}")
    return _strategy_summary(load_strategy(path), path=str(path))


def list_specialists(strategy_name: str | None = None) -> list[dict[str, Any]]:
    """List the specialist roster for the active strategy (or a named one).

    Each entry includes the specialist name and its full prompt body
    (a self-contained prose block from prompts.specialists.{name} —
    sources, scoring rubrics, and instructions are folded inline).
    """
    if strategy_name:
        s = load_strategy(_strategies_dir() / f"{validate_strategy_name(strategy_name)}.yaml")
    else:
        s = load_strategy(resolve_active_strategy_path(_project_root()))
    return [
        {"name": name, "prompt_body": (body or "").strip()}
        for name, body in s.prompts.specialists.items()
    ]


def switch_strategy(name: str) -> dict[str, Any]:
    """Make a named preset the active strategy (copies it to methodology.yaml)."""
    n = validate_strategy_name(name)
    strategies_dir = _strategies_dir()
    methodology_path = _methodology_path()
    src = strategies_dir / f"{n}.yaml"
    if not src.exists():
        raise FileNotFoundError(f"strategy {n!r} not found at {src}")
    shutil.copy2(src, methodology_path)
    return {"active": n, "path": str(methodology_path)}


def _strategy_summary(s: Strategy, path: str) -> dict[str, Any]:
    """Convert a Strategy object into a JSON-serializable summary dict.

    Mirrors the new two-zone schema: structured contract (criteria,
    tiers, thresholds, sizing, overridable) plus the names of the prompt
    blocks (synthesis, discovery, specialists). The prose itself is
    available via the loader if a caller wants it — this summary is
    designed for at-a-glance display.
    """
    return {
        "name": s.name,
        "description": s.description,
        "summary": s.summary,
        "author": s.author,
        "path": path,
        "criteria": [{"name": c.name, "weight": c.weight} for c in s.criteria],
        "tiers": {k: v for k, v in s.tiers.items()},
        "thresholds": dict(s.thresholds),
        "position_sizing": {
            "max_positions": s.position_sizing.max_positions,
            "max_single_position": s.position_sizing.max_single_position,
            "tiers": {k: v.model_dump() for k, v in (s.position_sizing.tiers or {}).items()},
            "tier_ranges": s.position_sizing.tier_ranges or {},
            "cash_reserve": s.position_sizing.cash_reserve.model_dump(),
        },
        "display": s.display.model_dump(),
        "llm_overridable": {
            k: {"default": v.default, "range": list(v.range), "label": v.label}
            for k, v in s.llm_overridable.items()
        },
        "specialists": list(s.prompts.specialists.keys()),
        "has_discovery_prompt": bool(s.prompts.discovery.strip()),
    }
