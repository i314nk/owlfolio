"""Tests for the two-zone strategy loader.

The strategy YAML now has two zones:
  Zone 1 — structured contract (criteria + tiers + thresholds + sizing)
  Zone 2 — prompt corpus (prompts.synthesis, prompts.discovery,
           prompts.specialists.{name})

These tests pin both zones, plus the `extra='ignore'` lenience that
lets stale fields from old YAMLs load without crashing.
"""

from pathlib import Path

import pytest

from src.strategy.loader import build_strategy_context, load_strategy, validate_strategy

STRATEGIES_DIR = Path(__file__).parent.parent / "strategies"

ALL_STRATEGIES = [
    "buffett-munger.yaml",
    "growth.yaml",
    "garp.yaml",
    "100-bagger.yaml",
    "deep-value.yaml",
    "quality-compounder.yaml",
    "dividend-income.yaml",
]


# ─── Zone 1 (structured contract) ────────────────────────────────────


def test_load_buffett_munger():
    """buffett-munger.yaml is the reference migration; pin its structured contract."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    assert s.name == "buffett-munger"
    assert len(s.criteria) == 5
    # Tiers map tier-name → required return (or None for "don't buy")
    assert "inevitable" in s.tiers
    assert s.tiers["inevitable"] == 0.10
    assert s.tiers["narrow"] is None
    # Thresholds are the score-cutoffs synthesis uses to pick a tier
    assert s.thresholds["wide"] == 3.5


def test_criteria_weights_sum_to_one():
    """Every strategy's criteria weights must sum to 1.0 (loader-enforced)."""
    for filename in ALL_STRATEGIES:
        s = load_strategy(STRATEGIES_DIR / filename)
        total = sum(c.weight for c in s.criteria)
        assert abs(total - 1.0) < 0.01, f"{filename}: weights sum to {total}"


def test_load_nonexistent_file():
    with pytest.raises(FileNotFoundError):
        load_strategy("nonexistent.yaml")


def test_position_sizing_loads():
    """Position sizing carries the numeric-only constraints (no prose triggers)."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ps = s.position_sizing
    # buffett-munger uses tier_ranges + tranches
    assert ps.tier_ranges is not None
    assert "inevitable" in ps.tier_ranges
    assert ps.tier_ranges["inevitable"] == [0.20, 0.25]
    assert ps.tier_ranges["narrow"] is None
    assert ps.tranches is not None
    assert ps.tranches["T1"].pct_of_target == 0.70


def test_position_sizing_old_format():
    """Strategies using the simpler tiers-as-allocations format also load."""
    s = load_strategy(STRATEGIES_DIR / "growth.yaml")
    assert s.position_sizing.tiers is not None
    assert "T1" in s.position_sizing.tiers
    assert s.position_sizing.tiers["T1"].allocation == 0.03


# ─── Zone 2 (prompt corpus) ──────────────────────────────────────────


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_synthesis_prompt_present(filename):
    """Every strategy must define prompts.synthesis (the load-bearing prose)."""
    s = load_strategy(STRATEGIES_DIR / filename)
    assert s.prompts.synthesis, f"{filename}: prompts.synthesis is empty"
    assert len(s.prompts.synthesis) > 500, (
        f"{filename}: prompts.synthesis is suspiciously short "
        f"({len(s.prompts.synthesis)}c) — should be a comprehensive prompt"
    )


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_discovery_prompt_present(filename):
    """Every strategy must define prompts.discovery (the agentic-discovery brief)."""
    s = load_strategy(STRATEGIES_DIR / filename)
    assert s.prompts.discovery, f"{filename}: prompts.discovery is empty"
    assert "Universe" in s.prompts.discovery or "universe" in s.prompts.discovery


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_specialist_roster(filename):
    """Each strategy defines >=3 named specialists with substantive prompt bodies."""
    s = load_strategy(STRATEGIES_DIR / filename)
    assert isinstance(s.prompts.specialists, dict)
    assert len(s.prompts.specialists) >= 3, (
        f"{filename}: needs >=3 specialists, has {len(s.prompts.specialists)}"
    )
    for name, body in s.prompts.specialists.items():
        assert body and len(body.strip()) > 100, (
            f"{filename}:{name} body is too short ({len(body)}c)"
        )


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_specialist_prompts_are_generic(filename):
    """Specialist prose must not pin to specific tickers / company names."""
    s = load_strategy(STRATEGIES_DIR / filename)
    forbidden = ["S&P Global", "SPGI ", "Visa,", "Apple,", "Microsoft,"]
    for name, body in s.prompts.specialists.items():
        for token in forbidden:
            assert token not in body, (
                f"{filename}:{name} prompt contains '{token}' — should be generic"
            )


# ─── overridable knobs ──────────────────────────────────────────────


def test_overridable_var_clamps_to_range():
    """OverridableVar.clamp keeps values inside the declared range."""
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    hr = s.llm_overridable["hurdle_rate"]
    assert hr.clamp(hr.range[0] - 0.10) == hr.range[0]
    assert hr.clamp(hr.range[1] + 0.10) == hr.range[1]
    assert hr.clamp(hr.default) == hr.default


def test_overridable_var_invalid_range_rejected():
    """min >= max should fail validation."""
    from pydantic import ValidationError

    from src.strategy.loader import OverridableVar
    with pytest.raises(ValidationError):
        OverridableVar(default=0.10, range=(0.20, 0.10), label="bad")


# ─── build_strategy_context ─────────────────────────────────────────


def test_build_strategy_context_includes_criteria_block():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ctx = build_strategy_context(s)
    assert "CRITERIA" in ctx
    # Each criterion is listed with its name and weight
    for c in s.criteria:
        assert c.name in ctx
    # Thresholds present
    assert "wide" in ctx and "narrow" in ctx


def test_build_strategy_context_includes_tiers_block():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ctx = build_strategy_context(s)
    assert "TIERS" in ctx
    assert "inevitable" in ctx
    assert "10%" in ctx       # inevitable hurdle rate
    assert "don't buy" in ctx  # narrow tier (None)


def test_build_strategy_context_includes_sizing_block():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ctx = build_strategy_context(s)
    assert "SIZING" in ctx
    assert "max single position" in ctx
    assert "cash min" in ctx


def test_build_strategy_context_lists_overridable():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ctx = build_strategy_context(s)
    assert "OVERRIDABLE" in ctx
    assert "hurdle_rate" in ctx
    assert "default 0.14" in ctx


def test_build_strategy_context_lists_specialists():
    s = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    ctx = build_strategy_context(s)
    assert "SPECIALISTS" in ctx
    for name in s.prompts.specialists.keys():
        assert name in ctx


# ─── all-strategies sanity ──────────────────────────────────────────


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_all_strategies_load(filename):
    s = load_strategy(STRATEGIES_DIR / filename)
    assert s.name
    assert len(s.criteria) >= 3
    assert s.prompts.synthesis


@pytest.mark.parametrize("filename", ALL_STRATEGIES)
def test_all_strategies_validate_clean(filename):
    """validate_strategy returns no `Error:` lines for any preset."""
    warnings = validate_strategy(STRATEGIES_DIR / filename)
    errors = [w for w in warnings if w.startswith("Error:")]
    assert errors == [], f"{filename}: {errors}"


# ─── extra='ignore' lenience (legacy YAMLs keep loading) ────────────


def test_loader_silently_drops_unknown_top_level_keys():
    """Legacy fields like `valuation:`/`monitoring:`/`screening:` should
    silently drop (extra='ignore') so old YAMLs keep loading.
    """
    import tempfile

    import yaml as _yaml

    raw = _yaml.safe_load((STRATEGIES_DIR / "buffett-munger.yaml").read_text())
    raw["valuation"] = {"primary_method": "owner_earnings_yield"}  # legacy
    raw["monitoring"] = {"price_check": "daily"}  # legacy
    raw["screening"] = {"min_market_cap": 1e9}  # deleted
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        _yaml.safe_dump(raw, f)
        path = f.name
    s = load_strategy(path)
    assert s.name == "buffett-munger"
    for ghost in ("valuation", "monitoring", "screening"):
        assert not hasattr(s, ghost)


def test_loader_rejects_missing_prompts():
    """A YAML without the prompts block must fail to load — synthesis depends on it."""
    import tempfile

    import yaml as _yaml
    from pydantic import ValidationError

    raw = _yaml.safe_load((STRATEGIES_DIR / "buffett-munger.yaml").read_text())
    del raw["prompts"]
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        _yaml.safe_dump(raw, f)
        path = f.name
    with pytest.raises(ValidationError):
        load_strategy(path)


def test_loader_rejects_short_synthesis_prompt():
    """The synthesis prompt has a >=50-char floor — anything shorter is an
    accidental empty / placeholder and must fail.
    """
    import tempfile

    import yaml as _yaml
    from pydantic import ValidationError

    raw = _yaml.safe_load((STRATEGIES_DIR / "buffett-munger.yaml").read_text())
    raw["prompts"]["synthesis"] = "do stuff"
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        _yaml.safe_dump(raw, f)
        path = f.name
    with pytest.raises(ValidationError):
        load_strategy(path)
