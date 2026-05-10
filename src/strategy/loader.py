"""Strategy loader — parse and validate a strategy YAML.

The strategy YAML has two zones:

  Zone 1 — Structured contract (small, typed, machine-readable)
    name, description, summary, author       # identity / display
    criteria: [{name, weight}]               # synthesis fills criteria_scores keyed on name
    tiers: {tier_name: hurdle_rate | None}   # synthesis picks a tier and looks up the hurdle
    thresholds: {wide, narrow}               # weighted_score → tier classification
    position_sizing: PositionSizingConfig    # numeric sizing constraints
    display: DisplayConfig                   # CLI labels
    llm_overridable: {var: OverridableVar}   # numeric knob ranges (synthesis can adjust within bounds)

  Zone 2 — Prompt corpus (one prose block per LLM consumer)
    prompts:
      synthesis: |   ...
      discovery: |   ...   (optional; falls back to inference if absent)
      specialists:
        <name>: |    ...   (one prose block per specialist; sources folded inline)

The structured contract is what the system needs as data so it can produce
typed outputs (criteria_scores, weighted_score, tier classification, buy
price math, position size). Everything else — every piece of LLM-consumed
prose — lives in the `prompts` block, one cohesive prompt per agent.

Removed from this file (vs the previous schema):
  - criteria[].description     → folded into prompts.synthesis
  - tier_definitions           → folded into prompts.synthesis
  - valuation.methodology      → folded into prompts.synthesis (with primary_method label)
  - decisions.buy/sell/watch   → folded into prompts.synthesis
  - llm_overridable[].guidance → folded into prompts.synthesis
  - position_sizing.tiers[].trigger / .description prose → folded into prompts.synthesis
  - specialists[].role + .sources → folded into prompts.specialists.{name}
  - screening.* (entire block) → deleted; replaced by `discovery.brief` for the agentic discovery
                                  agent and by `owlfolio import` for users with external screeners
"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, field_validator


# ─── Zone 1: structured contract ──────────────────────


class OverridableVar(BaseModel):
    """A numeric knob the synthesis agent can adjust within bounds.

    The prose `guidance` for *when* to adjust each knob lives in
    prompts.synthesis. Here we keep only what's load-bearing as data:
    the default, the allowed range, and a short label.
    """

    default: float
    range: tuple[float, float]  # (min, max) inclusive
    label: str = ""             # short human-readable label for CLI display

    @field_validator("range")
    @classmethod
    def range_is_valid(cls, v: tuple[float, float]) -> tuple[float, float]:
        if v[0] >= v[1]:
            raise ValueError(f"range min ({v[0]}) must be < max ({v[1]})")
        return v

    def clamp(self, value: float) -> float:
        return max(self.range[0], min(self.range[1], value))


class Criterion(BaseModel):
    """A single named criterion with a weight.

    The criterion's *meaning* (what scores 5/5, what scores 1/5) lives in
    the prose synthesis prompt. Here we keep only the name (the contract
    key) and the weight (the aggregation coefficient).
    """

    name: str
    weight: float


class DisplayConfig(BaseModel):
    """Strategy-specific CLI labels (cosmetic only)."""

    primary_value_label: str = "Owner Earnings"
    target_price_label: str = "Buy Price"
    yield_label: str = "Earnings Yield"
    safety_label: str = "Margin of Safety"
    zone_label: str = "Buy Zone"


class TierConfig(BaseModel):
    """Position-sizing tier (allocation-based format)."""

    allocation: float


class TrancheConfig(BaseModel):
    """Position-sizing tranche (pct_of_target format)."""

    pct_of_target: float


class CashReserveConfig(BaseModel):
    """Cash reserve floor and target as fractions of portfolio."""

    minimum: float = 0.10
    target: float = 0.20


class PositionSizingConfig(BaseModel):
    """Numeric position-sizing constraints.

    The prose for *when to enter each tranche* lives in prompts.synthesis.
    Here we keep only the numeric constraints synthesis enforces.
    """

    max_positions: int = 15
    max_single_position: float = 0.10
    tiers: dict[str, TierConfig] | None = None
    tier_ranges: dict[str, list[float] | None] | None = None
    tranches: dict[str, TrancheConfig] | None = None
    cash_reserve: CashReserveConfig = CashReserveConfig()


# ─── Zone 2: prompt corpus ────────────────────────────


class PromptsConfig(BaseModel):
    """One prose block per LLM consumer.

    `synthesis` and `specialists` are required (the analysis pipeline can't
    run without them). `discovery` is optional — if absent, the discovery
    agent infers from the criteria + structured contract.
    """

    synthesis: str
    discovery: str = ""
    specialists: dict[str, str] = {}

    @field_validator("synthesis")
    @classmethod
    def synthesis_must_be_substantive(cls, v: str) -> str:
        if not v or len(v.strip()) < 50:
            raise ValueError(
                "prompts.synthesis must be substantive prose (>=50 chars). "
                "It's the load-bearing instruction the synthesis agent reads."
            )
        return v


# ─── Top-level Strategy ───────────────────────────────


class Strategy(BaseModel):
    """Complete investment strategy configuration.

    `model_config = extra='ignore'` silently drops fields the runtime no
    longer consumes (e.g. legacy `screening:`, `monitoring:`, `reporting:`,
    `criteria_anchor.tier_definitions`). Old YAMLs keep loading; only the
    canonical schema below is consumed.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    # Identity / display
    name: str
    description: str = ""
    summary: str = ""
    author: str = ""

    # Structured contract
    criteria: list[Criterion] = []
    tiers: dict[str, float | None] = {}
    thresholds: dict[str, float] = {"wide": 3.5, "narrow": 2.5}
    position_sizing: PositionSizingConfig = PositionSizingConfig()
    display: DisplayConfig = DisplayConfig()
    llm_overridable: dict[str, OverridableVar] = {}

    # Prompt corpus
    prompts: PromptsConfig

    @field_validator("criteria")
    @classmethod
    def weights_must_sum_to_one(cls, v: list[Criterion]) -> list[Criterion]:
        if not v:
            return v
        total = sum(c.weight for c in v)
        if not (0.99 <= total <= 1.01):
            raise ValueError(f"criteria weights must sum to 1.0, got {total:.2f}")
        return v

    def get_hurdle_for_tier(self, tier: str) -> float | None:
        """Look up the hurdle rate for a tier classification (None = don't buy)."""
        return self.tiers.get(tier)


# ─── Synthesis context — small structured block + prompt prose ─────────


def build_strategy_context(strategy: Strategy) -> str:
    """Build the structured-contract block synthesis sees.

    Synthesis receives BOTH this small structured block (so it can fill
    criteria_scores keyed correctly and produce typed outputs) AND the
    full prompts.synthesis prose. This function returns only the structured
    block; the calling code (synthesis.py) appends prompts.synthesis after.
    """
    lines: list[str] = []
    lines.append(f"STRATEGY: {strategy.name}")
    if strategy.description:
        lines.append(strategy.description.strip())
    lines.append("")

    if strategy.criteria:
        lines.append("CRITERIA (weights sum to 1.0; score each 1-5):")
        for c in strategy.criteria:
            lines.append(f"  {c.name} weight={c.weight:.0%}")
        lines.append(
            f"  thresholds: wide ≥ {strategy.thresholds.get('wide', 3.5)} | "
            f"narrow ≥ {strategy.thresholds.get('narrow', 2.5)}"
        )
        lines.append("")

    if strategy.tiers:
        lines.append("TIERS (tier name → required return; null = don't buy):")
        for tier, rate in strategy.tiers.items():
            if rate is None:
                lines.append(f"  {tier}: don't buy")
            else:
                lines.append(f"  {tier}: {rate:.0%}")
        lines.append("")

    ps = strategy.position_sizing
    if ps.tier_ranges:
        parts = []
        for name, r in ps.tier_ranges.items():
            if r is None:
                parts.append(f"{name}=don't invest")
            else:
                parts.append(f"{name}=[{r[0]:.0%}-{r[1]:.0%}]")
        lines.append(f"SIZING: {' | '.join(parts)}")
    elif ps.tiers:
        parts = [f"{name}={t.allocation:.0%}" for name, t in ps.tiers.items()]
        lines.append(f"SIZING: {' | '.join(parts)}")
    lines.append(
        f"  max single position: {ps.max_single_position:.0%} | "
        f"max positions: {ps.max_positions} | "
        f"cash min {ps.cash_reserve.minimum:.0%}"
    )
    lines.append("")

    if strategy.llm_overridable:
        ov_parts = [
            f"{name} [{var.range[0]}-{var.range[1]}, default {var.default}]"
            for name, var in strategy.llm_overridable.items()
        ]
        lines.append(f"OVERRIDABLE: {', '.join(ov_parts)}")
        lines.append("")

    if strategy.prompts.specialists:
        lines.append(
            f"SPECIALISTS ({len(strategy.prompts.specialists)}): "
            f"{', '.join(strategy.prompts.specialists.keys())}"
        )

    return "\n".join(lines)


# ─── Loader + validator ───────────────────────────────


def load_strategy(path: str | Path) -> Strategy:
    """Load and validate a strategy YAML."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Strategy file not found: {path}")
    with open(path) as f:
        raw: dict[str, Any] = yaml.safe_load(f)
    if not raw:
        raise ValueError(f"Strategy file is empty: {path}")
    return Strategy(**raw)


def validate_strategy(path: str | Path) -> list[str]:
    """Validate a strategy file and return any warnings."""
    warnings: list[str] = []

    try:
        strategy = load_strategy(path)
    except Exception as e:
        return [f"Error: {e}"]

    primary = (
        strategy.llm_overridable.get("hurdle_rate")
        or strategy.llm_overridable.get("target_yield")
        or strategy.llm_overridable.get("peg_target")
        or strategy.llm_overridable.get("discount_factor")
    )
    if primary is not None and primary.default > 0.30:
        warnings.append(
            f"Primary threshold {primary.default:.2f} looks very high — "
            "few companies will qualify."
        )

    ps = strategy.position_sizing
    if ps.tiers:
        total_tier_alloc = sum(t.allocation for t in ps.tiers.values())
        max_possible = total_tier_alloc * ps.max_positions
        if max_possible > 1.0:
            warnings.append(
                f"Maximum possible allocation ({max_possible:.0%}) exceeds 100% — "
                "consider reducing max_positions or tier allocations."
            )
    elif ps.tier_ranges:
        max_possible = ps.max_single_position * ps.max_positions
        if max_possible > 2.0:
            warnings.append(
                f"Maximum possible allocation ({max_possible:.0%}) exceeds 200% — "
                "consider reducing max_positions or max_single_position."
            )

    if not strategy.prompts.specialists:
        warnings.append(
            "No specialists defined under prompts.specialists — the analyze pipeline needs at least one."
        )

    return warnings
