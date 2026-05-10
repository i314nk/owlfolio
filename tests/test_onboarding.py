"""Tests for the onboarding module (non-LLM parts).

Tests the YAML generation, extraction, and validation logic. Does NOT
test the interactive conversation loop (which requires the LLM).

Onboarding now produces the two-zone schema (criteria + tiers + thresholds
+ position_sizing + llm_overridable, plus prompts.{synthesis, discovery,
specialists}). Old fields (valuation.*, criteria_anchor.*, screening.*)
are gone.
"""

import tempfile
from pathlib import Path

import yaml

from src.modules.onboarding import (
    _build_strategy_dict,
    _build_system_prompt,
    extract_yaml_from_response,
)
from src.strategy.loader import Strategy, validate_strategy

# ─── YAML Extraction ──────────────────────────────────


def test_extract_yaml_from_response_with_fence():
    response = """Great! Here is your strategy.

[STRATEGY_COMPLETE]
```yaml
name: test-strategy
description: A test strategy
```
Done!"""
    result = extract_yaml_from_response(response)
    assert result is not None
    assert "name: test-strategy" in result
    assert "description: A test strategy" in result


def test_extract_yaml_from_response_without_fence():
    response = """Here it is.

[STRATEGY_COMPLETE]
name: my-strategy
description: No fences here
author: test"""
    result = extract_yaml_from_response(response)
    assert result is not None
    assert "name: my-strategy" in result


def test_extract_yaml_no_marker():
    response = """Here is some text without the marker.
```yaml
name: orphan
```"""
    result = extract_yaml_from_response(response)
    assert result is None


def test_extract_yaml_empty_after_marker():
    response = "[STRATEGY_COMPLETE]\n\nNo yaml here, just text."
    result = extract_yaml_from_response(response)
    assert result is None


# ─── Strategy Dict Building (new two-zone shape) ────────────────────


def test_build_value_strategy_dict():
    """Value-philosophy onboarding produces a loadable two-zone strategy."""
    from src.modules.onboarding import VALUE_MOAT_CRITERIA

    strategy_dict = _build_strategy_dict(
        name="test-value",
        philosophy="value",
        risk_level="moderate",
        max_position=0.08,
        max_positions=15,
        valuation_method="owner_earnings_yield",
        moat_criteria=VALUE_MOAT_CRITERIA,
        lookback_years=5,
        key_metrics=["revenue", "net_income", "free_cash_flow"],
        specialists=["financial_analyst", "moat_analyst", "risk_analyst"],
    )

    # Loads through the new Strategy schema
    strategy = Strategy(**strategy_dict)
    assert strategy.name == "test-value"
    # Structured contract
    assert len(strategy.criteria) == 5
    assert "inevitable" in strategy.tiers
    # Prompt corpus
    assert strategy.prompts.synthesis
    assert "owner earnings" in strategy.prompts.synthesis.lower()
    assert strategy.prompts.discovery
    assert "financial_analyst" in strategy.prompts.specialists
    assert "{TICKER}" in strategy.prompts.specialists["financial_analyst"]


def test_build_growth_strategy_dict():
    """Growth-philosophy strategy uses PEG knob and growth-flavored tiers."""
    from src.modules.onboarding import GROWTH_MOAT_CRITERIA

    strategy_dict = _build_strategy_dict(
        name="test-growth",
        philosophy="growth",
        risk_level="aggressive",
        max_position=0.06,
        max_positions=10,
        valuation_method="peg_ratio",
        moat_criteria=GROWTH_MOAT_CRITERIA,
        lookback_years=3,
        key_metrics=["revenue", "revenue_growth_1yr"],
        specialists=["growth_analyst", "moat_analyst", "risk_analyst"],
    )
    strategy = Strategy(**strategy_dict)
    assert "peg_target" in strategy.llm_overridable
    assert strategy.position_sizing.max_positions == 10
    assert "hypergrower" in strategy.tiers
    assert "growth_analyst" in strategy.prompts.specialists
    assert "PEG" in strategy.prompts.synthesis


def test_build_income_strategy_dict():
    """Income-philosophy strategy uses dividend-yield knob and aristocrat tiers."""
    from src.modules.onboarding import INCOME_MOAT_CRITERIA

    strategy_dict = _build_strategy_dict(
        name="test-income",
        philosophy="income",
        risk_level="conservative",
        max_position=0.10,
        max_positions=20,
        valuation_method="dividend_yield",
        moat_criteria=INCOME_MOAT_CRITERIA,
        lookback_years=7,
        key_metrics=["revenue", "dividend_per_share"],
        specialists=["dividend_safety_analyst", "financial_analyst", "risk_analyst"],
    )
    strategy = Strategy(**strategy_dict)
    assert "target_yield" in strategy.llm_overridable
    assert strategy.position_sizing.max_positions == 20
    assert "aristocrat" in strategy.tiers
    assert "dividend_safety_analyst" in strategy.prompts.specialists
    assert (
        "Dividend per Share" in strategy.prompts.synthesis
        or "dividend" in strategy.prompts.synthesis.lower()
    )


def test_built_strategies_pass_validation():
    """Built strategy dicts validate cleanly when round-tripped through YAML."""
    from src.modules.onboarding import VALUE_MOAT_CRITERIA

    strategy_dict = _build_strategy_dict(
        name="test-validate",
        philosophy="value",
        risk_level="moderate",
        max_position=0.08,
        max_positions=15,
        valuation_method="owner_earnings_yield",
        moat_criteria=VALUE_MOAT_CRITERIA,
        lookback_years=5,
        key_metrics=["revenue", "net_income"],
        specialists=["financial_analyst", "moat_analyst", "risk_analyst"],
    )

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump(strategy_dict, f, default_flow_style=False)
        tmp_path = f.name
    try:
        warnings = validate_strategy(tmp_path)
        errors = [w for w in warnings if w.startswith("Error:")]
        assert errors == [], f"Validation errors: {errors}"
    finally:
        Path(tmp_path).unlink()


def test_different_philosophies_produce_different_configs():
    """Philosophy changes the criteria, tiers, knobs, and synthesis prose."""
    from src.modules.onboarding import (
        GROWTH_MOAT_CRITERIA,
        INCOME_MOAT_CRITERIA,
        VALUE_MOAT_CRITERIA,
        _default_specialists,
    )

    value_dict = _build_strategy_dict(
        name="v",
        philosophy="value",
        risk_level="moderate",
        max_position=0.08,
        max_positions=15,
        valuation_method="owner_earnings_yield",
        moat_criteria=VALUE_MOAT_CRITERIA,
        lookback_years=5,
        key_metrics=["revenue"],
        specialists=_default_specialists("value"),
    )
    growth_dict = _build_strategy_dict(
        name="g",
        philosophy="growth",
        risk_level="aggressive",
        max_position=0.06,
        max_positions=10,
        valuation_method="peg_ratio",
        moat_criteria=GROWTH_MOAT_CRITERIA,
        lookback_years=3,
        key_metrics=["revenue"],
        specialists=_default_specialists("growth"),
    )
    income_dict = _build_strategy_dict(
        name="i",
        philosophy="income",
        risk_level="conservative",
        max_position=0.10,
        max_positions=20,
        valuation_method="dividend_yield",
        moat_criteria=INCOME_MOAT_CRITERIA,
        lookback_years=7,
        key_metrics=["revenue"],
        specialists=_default_specialists("income"),
    )

    # Knobs differ by valuation method
    assert "hurdle_rate" in value_dict["llm_overridable"]
    assert "peg_target" in growth_dict["llm_overridable"]
    assert "target_yield" in income_dict["llm_overridable"]

    # Tier vocabularies differ by philosophy
    assert "inevitable" in value_dict["tiers"]
    assert "hypergrower" in growth_dict["tiers"]
    assert "aristocrat" in income_dict["tiers"]

    # Criteria sets differ
    value_criteria = {c["name"] for c in value_dict["criteria"]}
    growth_criteria = {c["name"] for c in growth_dict["criteria"]}
    assert value_criteria != growth_criteria

    # Position sizing differs
    val_max = value_dict["position_sizing"]["max_positions"]
    grw_max = growth_dict["position_sizing"]["max_positions"]
    assert val_max != grw_max

    # Specialist rosters differ
    val_specs = set(value_dict["prompts"]["specialists"].keys())
    grw_specs = set(growth_dict["prompts"]["specialists"].keys())
    assert val_specs != grw_specs


# ─── System Prompt ──────────────────────────────────


def test_system_prompt_includes_two_zone_schema():
    """System prompt advertises the two-zone schema, not the legacy fields."""
    prompt = _build_system_prompt()
    # Zone 1 fields
    assert "criteria:" in prompt
    assert "tiers:" in prompt
    assert "thresholds:" in prompt
    assert "position_sizing:" in prompt
    # Zone 2 — prompt corpus
    assert "prompts:" in prompt
    assert "synthesis:" in prompt
    assert "discovery:" in prompt
    assert "specialists:" in prompt
    # Removed legacy fields
    assert "criteria_anchor:" not in prompt
    assert "valuation:" not in prompt
    assert "screening:" not in prompt
    assert "monitoring:" not in prompt
    assert "fundamentals:" not in prompt
    assert "decisions:" not in prompt


def test_system_prompt_includes_examples():
    prompt = _build_system_prompt()
    assert "BUFFETT VALUE" in prompt
    assert "GROWTH" in prompt
    assert "DIVIDEND INCOME" in prompt


def test_system_prompt_documents_specialists_format():
    """System prompt describes the new self-contained prose specialist format."""
    prompt = _build_system_prompt()
    assert "prompts:" in prompt
    assert "specialists:" in prompt
    assert "{TICKER}" in prompt or "TICKER" in prompt
    # Old plugin / split-field shape gone
    assert "news_context" not in prompt
    assert "competitor_analysis" not in prompt
    assert "role:" not in prompt or "role description" in prompt.lower()


def test_system_prompt_includes_strategy_complete_marker():
    prompt = _build_system_prompt()
    assert "[STRATEGY_COMPLETE]" in prompt
