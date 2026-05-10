"""Strategy onboarding agent -- interactive strategy builder.

Two modes:
  1. Conversational (default): LLM-powered discovery conversation that
     understands natural language investment philosophy descriptions and
     generates a custom strategy YAML through dialogue.
  2. Quick (--quick flag): Form wizard with numbered choices. No LLM needed.

Usage:
    from src.modules.onboarding import run_onboarding, run_onboarding_quick
    path = run_onboarding()        # conversational (LLM-powered)
    path = run_onboarding_quick()  # form wizard (no LLM needed)
"""

import re
import shutil
from pathlib import Path

import yaml
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from src.strategy.loader import validate_strategy

console = Console()

# ─── Strategy YAML Schema Reference ─────────────────────
# Used in the system prompt so the LLM knows what to produce.

STRATEGY_SCHEMA = """
The strategy YAML has TWO ZONES:

ZONE 1 — STRUCTURED CONTRACT (small, typed, machine-readable)

  name: string (lowercase, hyphens, e.g. "my-value-strategy")
  description: string (1-2 sentences)
  summary: string (longer paragraph for the strategy --info display)
  author: string

  criteria:                              # synthesis fills criteria_scores keyed on these names
    - name: switching_costs
      weight: 0.20                       # weights MUST sum to 1.0
    - ...

  tiers:                                  # tier_name → required return (or null for "don't buy")
    inevitable: 0.08                      # name tiers after what the strategy actually scores:
    wide: 0.12                            #   moat strategies: inevitable / monopoly / wide / narrow
    narrow: null                          #   deep-value:      fortress / safe / risky / dangerous
                                          #   income:          aristocrat / achiever / contender
                                          #   compounder: generational/exceptional/proven/unproven
                                          #   growth:     hypergrower / leader / contender / fading

  thresholds:                             # weighted score thresholds for tier classification
    wide: 3.5
    narrow: 2.5

  llm_overridable:                        # numeric knobs synthesis can adjust (no prose here)
    hurdle_rate:
      default: 0.15
      range: [0.08, 0.25]
      label: "Required return rate"

  position_sizing:
    max_positions: int
    max_single_position: float
    tiers: dict of tier_name -> {allocation: float}             # numeric only, no prose
    cash_reserve: {minimum: float, target: float}

  display:                                # CLI value labels (cosmetic only)
    primary_value_label, target_price_label, yield_label, safety_label, zone_label

ZONE 2 — PROMPT CORPUS (one prose block per LLM consumer)

  prompts:
    synthesis: |
      The load-bearing analysis prompt. Tells synthesis HOW to score the criteria,
      classify the tier, compute the buy price, and decide BUY/WATCH/PASS. This
      is required and must be substantive (>=50 chars). All "when to override"
      knob guidance, valuation methodology, and decision rules go here.
    discovery: |
      The agentic-discovery brief. Tells the discovery agent what universe to
      look at, what to bias toward, what to avoid. Used by `owlfolio find`.
    specialists:
      <specialist_name>: |
        Self-contained prose for one specialist. Includes role description,
        scoring rubric, and source URLs inline. The runner substitutes
        {TICKER} and {COMPANY} placeholders at dispatch time.
"""

STRATEGY_EXAMPLES_SUMMARY = """
Example strategies for reference (all use the new two-zone shape):

1. BUFFETT VALUE (buffett-munger.yaml):
   - Owner-earnings methodology embedded in prompts.synthesis
   - Moat criteria: pricing_power(20%), switching_costs(20%),
     network_effects(20%), cost_advantages(20%), intangible_assets(20%)
   - Tiers: inevitable=10%, monopoly=12%, wide=14%, narrow=null (don't buy)
   - Max 8 positions, 25% max single position
   - Specialists: financial_analyst, moat_analyst, risk_analyst, management_analyst, mental_models

2. GROWTH (growth.yaml):
   - PEG-based methodology in prompts.synthesis
   - Criteria: market_size(20%), product_leadership(25%),
     network_effects(25%), switching_costs(15%), management_vision(15%)
   - Tiers: hypergrower=20% / leader=15% / contender=10% / fading=null
   - Max 20 positions, 8% max single position
   - Specialists: tam_analyst, unit_economics_analyst, competitive_dynamics, risk_analyst

3. DIVIDEND INCOME (dividend-income.yaml):
   - Dividend-yield methodology in prompts.synthesis
     (Chowder Number, payout < 60%, FCF coverage > 1.5x)
   - Criteria: earnings_stability(30%), dividend_track_record(30%),
     competitive_position(20%), balance_sheet_strength(20%)
   - Tiers: aristocrat=3.0% / achiever=3.5% / contender=4.5%
   - Max 25 positions, 5% max single position
   - Specialists: dividend_safety_analyst, earnings_stability_analyst, balance_sheet_analyst
"""


def _build_system_prompt() -> str:
    """Build the system prompt for the conversational onboarding agent."""
    return f"""You are an expert investment strategy design consultant. Your job is to help
the user create a custom investment strategy by understanding their philosophy,
preferences, and risk tolerance through natural conversation.

YOU MUST FOLLOW THESE PHASES:

PHASE 1 - DISCOVERY (2-4 exchanges):
Ask about their investment philosophy in natural language. Based on their response,
ask targeted follow-ups:
- If they mention "Buffett", "value", "moat", or "intrinsic value": ask about moat
  frameworks, hurdle rates, position concentration, and how they think about margin of safety.
- If they mention "growth", "momentum", or "innovation": ask about growth thresholds,
  PEG vs revenue multiples, how they handle unprofitable companies.
- If they mention "dividends", "income", or "yield": ask about yield targets,
  dividend streak requirements, payout ratio limits.
- If unclear or hybrid: explore further to understand their unique blend.
Ask about:
- Risk tolerance and position sizing preferences
- What financial data matters most to them
- Which research modules they want (news context, competitor analysis, management quality)
- Time horizon

PHASE 2 - PROPOSAL (1-2 exchanges):
After gathering enough information, summarize what you understood and propose a strategy.
Explain each configuration choice and your reasoning. For example:
"I set the hurdle rate to 13% because you mentioned wanting a higher bar for quality..."
Do NOT show raw YAML yet. Explain in readable format.
Ask for approval, changes, or rejection.

PHASE 3 - GENERATION:
Once the user approves, generate the final YAML. Output it with the marker
[STRATEGY_COMPLETE] followed by the complete YAML between ```yaml and ``` fences.
The YAML MUST be valid and pass validation.

IMPORTANT RULES:
- Criteria weights MUST sum to exactly 1.0
- prompts.synthesis MUST be substantive prose (>=500 chars) — it is the
  load-bearing instruction the synthesis agent reads at every analysis
- prompts.discovery should describe the universe (mid-cap, large-cap,
  Russell 3000, etc.) and the bias / avoid filters
- Each entry under prompts.specialists is a self-contained prose block
  with the role, scoring rubric, and source URLs all inline
- Be conversational and warm, not robotic
- Adapt your questions based on what the user has already told you
- Don't ask questions they've already answered
- If the user says something like "something like Buffett but more concentrated",
  use that as a strong signal for the whole strategy design

STRATEGY YAML SCHEMA:
{STRATEGY_SCHEMA}

EXAMPLE STRATEGIES FOR REFERENCE:
{STRATEGY_EXAMPLES_SUMMARY}

Remember: Only output [STRATEGY_COMPLETE] when the user has explicitly approved
the proposed strategy. The YAML must immediately follow the marker."""


OPENING_MESSAGE = """Welcome! I'm your investment strategy design consultant.

I'll help you create a custom investment strategy through conversation. Instead \
of filling out forms, just tell me about your investing style in your own words.

To get started: **How would you describe your investment philosophy?**

For example, you might say:
- "I want something like Buffett -- buy wonderful businesses at fair prices"
- "I'm focused on high-growth tech companies with strong moats"
- "I want reliable dividend income that grows over time"
- "I care about cash flow above everything else"

Or anything else -- there's no wrong answer."""


def run_onboarding() -> str:
    """LLM-powered strategy onboarding conversation.

    Engages in a multi-turn conversation to understand the user's
    investment philosophy, then generates a validated strategy YAML.

    Returns:
        Path to the created strategy file, or empty string if cancelled.
    """
    from src.llm.provider import complete_messages

    system_prompt = _build_system_prompt()

    console.print(
        Panel(
            "[bold]Strategy Design Consultant[/bold]\n\n"
            "I'll help you create a custom investment strategy through\n"
            "a natural conversation about your investing philosophy.",
            border_style="blue",
        )
    )

    console.print()
    console.print(OPENING_MESSAGE)
    console.print()

    messages: list[dict[str, str]] = []

    while True:
        try:
            user_input = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            console.print("\n[yellow]Onboarding cancelled.[/yellow]")
            return ""

        if not user_input:
            continue

        if user_input.lower() in ("quit", "exit", "cancel", "q"):
            console.print("[yellow]Onboarding cancelled.[/yellow]")
            return ""

        messages.append({"role": "user", "content": user_input})

        try:
            response = complete_messages(
                messages,
                system=system_prompt,
                max_tokens=4096,
                temperature=0.7,
            )
        except Exception as e:
            console.print(f"[red]LLM error: {e}[/red]")
            console.print("[yellow]Try again or type 'quit' to cancel.[/yellow]")
            messages.pop()  # Remove the failed user message
            continue

        messages.append({"role": "assistant", "content": response})
        console.print()
        console.print(response)
        console.print()

        # Check if the LLM has produced a final YAML
        if "[STRATEGY_COMPLETE]" in response:
            return _extract_and_save_strategy(response)


def _extract_and_save_strategy(response: str) -> str:
    """Extract YAML from LLM response, validate, and save.

    Args:
        response: LLM response containing [STRATEGY_COMPLETE] marker
            followed by YAML in a code fence.

    Returns:
        Path to saved strategy file, or empty string on failure.
    """
    yaml_text = extract_yaml_from_response(response)
    if not yaml_text:
        console.print("[red]Could not extract YAML from response.[/red]")
        return ""

    try:
        strategy_dict = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        console.print(f"[red]Invalid YAML: {e}[/red]")
        return ""

    if not isinstance(strategy_dict, dict) or "name" not in strategy_dict:
        console.print("[red]YAML is missing required 'name' field.[/red]")
        return ""

    strategy_name = strategy_dict["name"]
    strategies_dir = Path("strategies")
    strategies_dir.mkdir(exist_ok=True)
    strategy_path = strategies_dir / f"{strategy_name}.yaml"

    with open(strategy_path, "w") as f:
        yaml.dump(strategy_dict, f, default_flow_style=False, sort_keys=False, width=100)

    console.print(f"\n[green]Strategy saved to:[/green] {strategy_path}")

    # Validate
    warnings = validate_strategy(strategy_path)
    if warnings:
        has_errors = any(w.startswith("Error:") for w in warnings)
        for w in warnings:
            if w.startswith("Error:"):
                console.print(f"  [red]{w}[/red]")
            else:
                console.print(f"  [yellow]Warning: {w}[/yellow]")
        if has_errors:
            console.print("[red]Strategy has validation errors. Please fix and retry.[/red]")
            return ""
    else:
        console.print("  [green]Strategy validated successfully.[/green]")

    # Copy to methodology.yaml
    methodology_path = Path("methodology.yaml")
    shutil.copy2(strategy_path, methodology_path)
    console.print(f"  [green]Copied to:[/green] {methodology_path} (active strategy)\n")

    return str(strategy_path)


def extract_yaml_from_response(response: str) -> str | None:
    """Extract YAML content from an LLM response.

    Looks for YAML between ```yaml and ``` fences after
    the [STRATEGY_COMPLETE] marker.

    Args:
        response: Full LLM response text.

    Returns:
        Extracted YAML string, or None if not found.
    """
    # Find the [STRATEGY_COMPLETE] marker
    marker_idx = response.find("[STRATEGY_COMPLETE]")
    if marker_idx == -1:
        return None

    after_marker = response[marker_idx:]

    # Look for YAML in a code fence
    yaml_match = re.search(r"```(?:yaml|yml)?\s*\n(.*?)```", after_marker, re.DOTALL)
    if yaml_match:
        return yaml_match.group(1).strip()

    # Fallback: try to find bare YAML after the marker
    # Look for content that starts with "name:" (first required field)
    name_match = re.search(r"(name:\s*\S+.*)", after_marker, re.DOTALL)
    if name_match:
        return name_match.group(1).strip()

    return None


def generate_strategy_yaml(philosophy_description: str) -> str:
    """Generate a strategy YAML from a natural language description.

    Non-interactive helper used for testing. Makes a single LLM call
    to generate a complete strategy YAML from a philosophy description.

    Args:
        philosophy_description: Natural language description of investment philosophy.

    Returns:
        Generated YAML string.
    """
    from src.llm.provider import complete

    system = _build_system_prompt()

    prompt = f"""The user has described their investment philosophy as follows:

"{philosophy_description}"

Based on this description, generate a complete, valid strategy YAML in
the new two-zone shape. Skip the discovery conversation -- go directly
to generation. Output [STRATEGY_COMPLETE] followed by the complete YAML
in a ```yaml code fence.

Remember:
- Criteria weights MUST sum to exactly 1.0
- prompts.synthesis MUST be substantive (>=500 chars)
- prompts.discovery and prompts.specialists.* are required
- All required fields must be present"""

    response = complete(prompt, system=system, max_tokens=4096, temperature=0.5)
    yaml_text = extract_yaml_from_response(response)
    return yaml_text or ""


# ═══════════════════════════════════════════════════════════
# QUICK MODE — Form wizard (no LLM needed)
# Accessed via: owlfolio setup --quick
# ═══════════════════════════════════════════════════════════

# ─── Defaults and choices ─────────────────────────────

PHILOSOPHY_CHOICES = {
    "1": ("value", "Buy wonderful businesses below intrinsic value"),
    "2": ("growth", "Own fastest-growing businesses at reasonable prices"),
    "3": ("income", "Build portfolio of reliable dividend payers"),
    "4": ("hybrid", "Blend of value and growth principles"),
}

RISK_LEVELS = {
    "1": ("conservative", 0.10, 20),
    "2": ("moderate", 0.08, 15),
    "3": ("aggressive", 0.06, 10),
}

VALUATION_METHODS = {
    "1": "owner_earnings_yield",
    "2": "peg_ratio",
    "3": "dividend_yield",
    "4": "dcf",
}

AVAILABLE_METRICS = [
    "revenue",
    "net_income",
    "gross_margin",
    "operating_margin",
    "net_margin",
    "free_cash_flow",
    "debt_to_equity",
    "roic",
    "roe",
    "stock_based_compensation",
    "operating_cash_flow",
    "total_capex",
    "depreciation_amortization",
    "research_development",
    "dividend_per_share",
    "revenue_growth_1yr",
    "revenue_growth_3yr",
    "revenue_growth_5yr",
]

# ─── Moat templates by philosophy ─────────────────────

VALUE_MOAT_CRITERIA = [
    {
        "name": "pricing_power",
        "weight": 0.20,
        "description": "Can the company raise prices without losing customers?",
    },
    {
        "name": "switching_costs",
        "weight": 0.20,
        "description": "How hard is it for customers to leave?",
    },
    {
        "name": "network_effects",
        "weight": 0.20,
        "description": "Does the product get better with more users?",
    },
    {
        "name": "cost_advantages",
        "weight": 0.20,
        "description": "Structural cost advantage from scale or process?",
    },
    {
        "name": "intangible_assets",
        "weight": 0.20,
        "description": "Brands, patents, licenses, regulatory moats?",
    },
]

GROWTH_MOAT_CRITERIA = [
    {
        "name": "market_size",
        "weight": 0.20,
        "description": "How large is the TAM? Room to grow 5-10x?",
    },
    {
        "name": "product_leadership",
        "weight": 0.25,
        "description": "Is the product clearly best-in-class?",
    },
    {
        "name": "network_effects",
        "weight": 0.25,
        "description": "Does the product get better with more users?",
    },
    {
        "name": "switching_costs",
        "weight": 0.15,
        "description": "How deeply embedded in customer workflows?",
    },
    {
        "name": "management_vision",
        "weight": 0.15,
        "description": "Founder-led? Clear long-term vision?",
    },
]

INCOME_MOAT_CRITERIA = [
    {
        "name": "earnings_stability",
        "weight": 0.30,
        "description": "How stable and predictable are earnings?",
    },
    {
        "name": "dividend_track_record",
        "weight": 0.30,
        "description": "How long has the company paid and grown dividends?",
    },
    {
        "name": "competitive_position",
        "weight": 0.20,
        "description": "Can competitors undercut this business?",
    },
    {
        "name": "balance_sheet_strength",
        "weight": 0.20,
        "description": "Can the company maintain dividends in a recession?",
    },
]


def _ask(prompt: str, default: str = "") -> str:
    """Prompt user for input with optional default."""
    if default:
        suffix = f" [{default}]: "
    else:
        suffix = ": "
    try:
        answer = input(f"{prompt}{suffix}").strip()
    except (EOFError, KeyboardInterrupt):
        console.print("\n[yellow]Onboarding cancelled.[/yellow]")
        raise SystemExit(0)
    return answer if answer else default


def _ask_choice(prompt: str, choices: dict, default: str = "1") -> str:
    """Prompt user to pick from numbered choices."""
    for key, val in choices.items():
        if isinstance(val, tuple):
            console.print(f"  {key}. {val[1]}")
        else:
            console.print(f"  {key}. {val}")
    return _ask(prompt, default)


def run_onboarding_quick() -> str:
    """Form-based strategy onboarding (no LLM). Returns path to created strategy file.

    Walks the user through a multi-step form to define their
    investment strategy, then generates a valid YAML file and copies
    it to methodology.yaml as the active strategy.
    """
    console.print(
        Panel(
            "[bold]Strategy Builder (Quick Mode)[/bold]\n\n"
            "I'll help you create a custom investment strategy.\n"
            "Answer a few questions about your investing style,\n"
            "and I'll generate a strategy YAML file for you.",
            border_style="blue",
        )
    )

    # ── Step 1: Investment philosophy ──
    console.print("\n[bold]Step 1: Investment Philosophy[/bold]")
    console.print("What best describes your approach?\n")
    phil_choice = _ask_choice("Choose", PHILOSOPHY_CHOICES, "1")
    philosophy, phil_desc = PHILOSOPHY_CHOICES.get(phil_choice, PHILOSOPHY_CHOICES["1"])
    console.print(f"\n  Selected: [bold]{philosophy}[/bold] - {phil_desc}\n")

    # ── Step 2: Risk tolerance and sizing ──
    console.print("[bold]Step 2: Risk Tolerance & Position Sizing[/bold]")
    console.print("How would you describe your risk tolerance?\n")
    risk_choices = {
        "1": ("conservative", "Smaller positions, more diversification"),
        "2": ("moderate", "Balanced approach"),
        "3": ("aggressive", "Concentrated positions, higher conviction"),
    }
    risk_choice = _ask_choice("Choose", risk_choices, "2")
    risk_level, max_position, max_positions = RISK_LEVELS.get(risk_choice, RISK_LEVELS["2"])
    console.print(
        f"\n  Risk: [bold]{risk_level}[/bold]"
        f" (max {max_position:.0%}/position,"
        f" up to {max_positions} positions)"
    )

    time_horizon = _ask("\n  Investment time horizon in years", "5")
    try:
        time_horizon_years = int(time_horizon)
    except ValueError:
        time_horizon_years = 5
    console.print(f"  Time horizon: [bold]{time_horizon_years} years[/bold]\n")

    # ── Step 3: What matters to you ──
    console.print("[bold]Step 3: Investment Criteria[/bold]")
    console.print("What matters most when evaluating a company?")
    console.print("(These become your moat criteria)\n")

    if philosophy == "value":
        moat_criteria = VALUE_MOAT_CRITERIA
        console.print("  Using value-oriented moat criteria (Buffett-style)")
    elif philosophy == "growth":
        moat_criteria = GROWTH_MOAT_CRITERIA
        console.print("  Using growth-oriented moat criteria (Lynch/Fisher-style)")
    elif philosophy == "income":
        moat_criteria = INCOME_MOAT_CRITERIA
        console.print("  Using income-oriented moat criteria (dividend focus)")
    else:
        moat_criteria = VALUE_MOAT_CRITERIA
        console.print("  Using balanced moat criteria")

    console.print("  Criteria:")
    for c in moat_criteria:
        console.print(f"    - {c['name']} ({c['weight']:.0%}): {c['description']}")

    customize_moat = _ask("\n  Customize these criteria? (y/n)", "n")
    if customize_moat.lower() == "y":
        console.print("  [dim]Custom moat criteria editing coming soon. Using defaults.[/dim]")

    # ── Step 4: Valuation method ──
    console.print("\n[bold]Step 4: Valuation Method[/bold]")
    console.print("How do you prefer to value companies?\n")
    val_choices = {
        "1": ("owner_earnings_yield", "Owner Earnings Yield (Buffett-style)"),
        "2": ("peg_ratio", "PEG Ratio (growth-relative valuation)"),
        "3": ("dividend_yield", "Dividend Yield (income-based valuation)"),
        "4": ("dcf", "DCF / Discounted Cash Flow"),
    }
    val_choice = _ask_choice("Choose", val_choices, _default_val_for_philosophy(philosophy))
    valuation_method = VALUATION_METHODS.get(val_choice, "owner_earnings_yield")
    console.print(f"\n  Valuation: [bold]{valuation_method}[/bold]\n")

    # ── Step 5: Fundamental data ──
    console.print("[bold]Step 5: Fundamental Data[/bold]")
    lookback = _ask("  How many years of history to analyze?", str(_default_lookback(philosophy)))
    try:
        lookback_years = int(lookback)
    except ValueError:
        lookback_years = 5

    console.print("\n  Available metrics:")
    for i, m in enumerate(AVAILABLE_METRICS, 1):
        console.print(f"    {i:2d}. {m}")

    default_metrics = _default_metrics(philosophy)
    console.print(f"\n  Default selection: {', '.join(default_metrics)}")
    customize_metrics = _ask("  Customize metrics? (y/n)", "n")
    if customize_metrics.lower() == "y":
        nums = _ask("  Enter metric numbers separated by commas (e.g., 1,2,3,5,6)")
        try:
            indices = [int(n.strip()) - 1 for n in nums.split(",")]
            selected = [AVAILABLE_METRICS[i] for i in indices if 0 <= i < len(AVAILABLE_METRICS)]
            if selected:
                default_metrics = selected
        except (ValueError, IndexError):
            console.print("  [yellow]Invalid input, using defaults.[/yellow]")

    console.print(f"  Using: {', '.join(default_metrics)}\n")

    # ── Step 6: Specialist roster ──
    console.print("[bold]Step 6: Specialist Roster[/bold]")
    console.print(
        "  Each analysis spawns specialist subagents in parallel. Each specialist\n"
        "  independently researches the company from a focused angle.\n"
    )
    default_specialists = _default_specialists(philosophy)
    for spec_name in default_specialists:
        console.print(f"    • {spec_name}")
    console.print(
        f"\n  Default roster ({len(default_specialists)} specialists)"
        f" tuned for [bold]{philosophy}[/bold].\n"
    )

    # ── Step 7: Summary ──
    strategy_name = _ask(
        "\n[bold]Strategy name[/bold] (lowercase, hyphens ok)",
        f"custom-{philosophy}",
    )
    strategy_name = strategy_name.lower().replace(" ", "-")

    console.print("\n")
    table = Table(title="Strategy Summary", show_header=False)
    table.add_column("Setting", style="bold")
    table.add_column("Value")
    table.add_row("Name", strategy_name)
    table.add_row("Philosophy", philosophy)
    table.add_row("Risk Level", risk_level)
    table.add_row("Max Position", f"{max_position:.0%}")
    table.add_row("Max Positions", str(max_positions))
    table.add_row("Time Horizon", f"{time_horizon_years} years")
    table.add_row("Valuation", valuation_method)
    table.add_row("Lookback Years", str(lookback_years))
    metrics_str = ", ".join(default_metrics[:5])
    if len(default_metrics) > 5:
        metrics_str += "..."
    table.add_row("Key Metrics", metrics_str)
    table.add_row("Specialists", ", ".join(default_specialists))
    console.print(table)

    confirm = _ask("\nGenerate this strategy? (y/n)", "y")
    if confirm.lower() != "y":
        console.print("[yellow]Onboarding cancelled.[/yellow]")
        return ""

    # ── Step 8: Generate YAML ──
    strategy_dict = _build_strategy_dict(
        name=strategy_name,
        philosophy=philosophy,
        risk_level=risk_level,
        max_position=max_position,
        max_positions=max_positions,
        valuation_method=valuation_method,
        moat_criteria=moat_criteria,
        lookback_years=lookback_years,
        key_metrics=default_metrics,
        specialists=default_specialists,
    )

    strategies_dir = Path("strategies")
    strategies_dir.mkdir(exist_ok=True)
    strategy_path = strategies_dir / f"{strategy_name}.yaml"

    with open(strategy_path, "w") as f:
        yaml.dump(strategy_dict, f, default_flow_style=False, sort_keys=False, width=100)

    console.print(f"\n  [green]Strategy saved to:[/green] {strategy_path}")

    # Validate
    warnings = validate_strategy(strategy_path)
    if warnings:
        for w in warnings:
            console.print(f"  [yellow]Warning: {w}[/yellow]")
    else:
        console.print("  [green]Strategy validated successfully.[/green]")

    # ── Step 9: Copy to methodology.yaml ──
    methodology_path = Path("methodology.yaml")
    shutil.copy2(strategy_path, methodology_path)
    console.print(f"  [green]Copied to:[/green] {methodology_path} (active strategy)\n")

    return str(strategy_path)


def _default_val_for_philosophy(philosophy: str) -> str:
    """Return default valuation method choice number for philosophy."""
    return {"value": "1", "growth": "2", "income": "3", "hybrid": "1"}.get(philosophy, "1")


def _default_lookback(philosophy: str) -> int:
    """Return default lookback years for philosophy."""
    return {"value": 5, "growth": 3, "income": 7, "hybrid": 5}.get(philosophy, 5)


def _default_metrics(philosophy: str) -> list[str]:
    """Return default key metrics for philosophy."""
    if philosophy == "growth":
        return [
            "revenue",
            "net_income",
            "gross_margin",
            "operating_margin",
            "free_cash_flow",
            "stock_based_compensation",
            "research_development",
            "revenue_growth_1yr",
            "revenue_growth_3yr",
        ]
    elif philosophy == "income":
        return [
            "revenue",
            "net_income",
            "free_cash_flow",
            "gross_margin",
            "operating_margin",
            "debt_to_equity",
            "operating_cash_flow",
            "dividend_per_share",
        ]
    else:  # value or hybrid
        return [
            "revenue",
            "net_income",
            "free_cash_flow",
            "gross_margin",
            "operating_margin",
            "net_margin",
            "roic",
            "debt_to_equity",
            "stock_based_compensation",
            "operating_cash_flow",
        ]


def _build_strategy_dict(
    name: str,
    philosophy: str,
    risk_level: str,
    max_position: float,
    max_positions: int,
    valuation_method: str,
    moat_criteria: list[dict],
    lookback_years: int,
    key_metrics: list[str],
    specialists: list[str],
) -> dict:
    """Build the strategy dict that will be serialized to YAML.

    Produces a complete two-zone strategy compatible with the Strategy
    pydantic model in loader.py:
      * structured contract: criteria + tiers + thresholds + sizing +
        llm_overridable (numeric only).
      * prompt corpus: prompts.synthesis (the load-bearing analysis
        prompt), prompts.discovery (agentic-discovery brief), and
        prompts.specialists (one prose block per specialist).
    """
    llm_overridable = _build_overridable(valuation_method)
    tiers = _build_tiers(risk_level, max_position)

    # New-shape criteria — names + weights only. The prose lives in prompts.synthesis.
    criteria = [{"name": c["name"], "weight": c["weight"]} for c in moat_criteria]

    # Tier-name → required return (or null = don't buy). Names match
    # the philosophy convention so analyses display sensible labels.
    tier_dict = _default_tiers_for_philosophy(philosophy)

    return {
        "name": name,
        "description": f"Custom {philosophy} strategy created via onboarding.",
        "author": "User (via onboarding)",
        "criteria": criteria,
        "tiers": tier_dict,
        "thresholds": {"wide": 3.5, "narrow": 2.5},
        "llm_overridable": llm_overridable,
        "position_sizing": {
            "max_positions": max_positions,
            "max_single_position": max_position,
            "tiers": tiers,
            "cash_reserve": {"minimum": 0.10, "target": 0.20},
        },
        "prompts": {
            "synthesis": _build_synthesis_prompt(
                philosophy,
                valuation_method,
                criteria,
                tier_dict,
            ),
            "discovery": _build_discovery_prompt(philosophy),
            "specialists": _build_specialists(specialists),
        },
    }


def _default_tiers_for_philosophy(philosophy: str) -> dict:
    """Convention: tier names match the philosophy's display vocabulary."""
    if philosophy == "value":
        return {"inevitable": 0.08, "monopoly": 0.10, "wide": 0.12, "narrow": None}
    if philosophy == "growth":
        return {"hypergrower": 0.20, "leader": 0.15, "contender": 0.10, "fading": None}
    if philosophy == "income":
        return {"aristocrat": 0.030, "achiever": 0.035, "contender": 0.045}
    # hybrid / catch-all
    return {"inevitable": 0.08, "wide": 0.12, "narrow": None}


# Library of specialist templates the onboarding flow can mix into a custom roster.
# Each entry is a self-contained prose block (the new prompts.specialists.{name}
# format). Sources, role description, and scoring guidance live inline. The runner
# substitutes {TICKER} and {COMPANY} at dispatch time.
SPECIALIST_TEMPLATES: dict[str, str] = {
    "financial_analyst": (
        "Analyze {COMPANY} ({TICKER})'s earnings quality, balance sheet strength, cash "
        "flow, and capital allocation. Calculate Owner Earnings (Net Income + D&A "
        "- Maintenance Capex - SBC - Working Capital Change). Assess debt levels, "
        "interest coverage, and cash generation consistency over 5 years. "
        "Cross-reference at least 2 data sources.\n\n"
        "Sources to check first:\n"
        "  - https://stockanalysis.com/stocks/{TICKER}/financials/\n"
        "  - https://www.macrotrends.net/stocks/charts/{TICKER}\n"
    ),
    "moat_analyst": (
        "Score {COMPANY} ({TICKER})'s competitive advantages on the strategy's "
        "criteria (1-5 scale). Research market share, switching costs, and competitor "
        "positioning via web search. Assess whether the moat is widening, stable, or "
        "narrowing.\n\n"
        "Sources to check first:\n"
        "  - Industry reports and market share data (web search)\n"
        "  - Competitor filings and annual reports\n"
    ),
    "risk_analyst": (
        "Identify and assess {COMPANY} ({TICKER})'s risks: regulatory, litigation, "
        "customer concentration, macro exposure, geopolitical, technology disruption. "
        "For each risk, estimate probability (low/medium/high) and severity "
        "(minor/moderate/severe).\n\n"
        "Sources to check first:\n"
        "  - SEC EDGAR Item 1A risk factors (search: {TICKER} risk factors SEC)\n"
        "  - Recent news (search: {TICKER} news risks regulatory)\n"
    ),
    "growth_analyst": (
        "Analyze {COMPANY} ({TICKER})'s revenue and earnings growth trajectory, TAM, "
        "unit economics, and Rule of 40 score (revenue growth % + profit margin %). "
        "Distinguish organic growth from acquisition-driven growth.\n\n"
        "Sources to check first:\n"
        "  - https://stockanalysis.com/stocks/{TICKER}/financials/\n"
        "  - Industry TAM reports (web search)\n"
    ),
    "dividend_safety_analyst": (
        "Assess {COMPANY} ({TICKER})'s dividend safety: payout ratio, FCF coverage of "
        "dividends, dividend streak length, Chowder Number (yield + 5yr dividend "
        "growth rate). Flag rising payout ratio or declining FCF coverage.\n\n"
        "Sources to check first:\n"
        "  - https://stockanalysis.com/stocks/{TICKER}/financials/\n"
        "  - https://www.macrotrends.net/stocks/charts/{TICKER}\n"
    ),
    "management_analyst": (
        "Assess {COMPANY} ({TICKER})'s management quality: insider ownership %, recent "
        "insider buying/selling, CEO tenure, capital allocation history (buybacks, "
        "acquisitions, dividends), executive compensation alignment, board "
        "independence.\n\n"
        "Sources to check first:\n"
        "  - SEC EDGAR proxy statement DEF 14A (search: {TICKER} proxy statement SEC)\n"
        "  - Insider trading data (search: {TICKER} insider buying selling)\n"
    ),
}


def _default_specialists(philosophy: str) -> list[str]:
    """Pick a sensible default specialist roster for a given philosophy."""
    if philosophy == "growth":
        return ["growth_analyst", "moat_analyst", "risk_analyst", "management_analyst"]
    if philosophy == "income":
        return ["dividend_safety_analyst", "financial_analyst", "risk_analyst"]
    # value or hybrid
    return ["financial_analyst", "moat_analyst", "risk_analyst", "management_analyst"]


def _build_specialists(names: list[str]) -> dict[str, str]:
    """Materialize a specialist roster from template names.

    Returns the new {name: prompt_body} format that prompts.specialists
    expects. Unknown names are skipped silently.
    """
    return {n: SPECIALIST_TEMPLATES[n] for n in names if n in SPECIALIST_TEMPLATES}


def _build_synthesis_prompt(
    philosophy: str,
    valuation_method: str,
    criteria: list[dict],
    tiers: dict,
) -> str:
    """Compose the prompts.synthesis prose for an onboarded strategy.

    The synthesis prompt has to be substantive (loader enforces >=50
    chars and we want it usefully long). It encodes the criteria, the
    tier-classification rule, the valuation methodology, and the
    BUY/WATCH/PASS decision logic — all derived from the form choices.
    """
    criteria_lines = "\n".join(
        f"- **{c['name']} ({int(c['weight'] * 100)}%):** Score 5 for best-in-class, "
        f"3 for average, 1 for poor."
        for c in criteria
    )
    tier_lines = "\n".join(
        f"- **{name}:** required return {rate:.0%}"
        if rate is not None
        else f"- **{name}:** don't buy"
        for name, rate in tiers.items()
    )
    method_block = _valuation_method_prose(valuation_method)
    return f"""You are scoring this company against the {philosophy} framework.
Your job: reconcile specialist findings, score the criteria, classify
the tier, compute the buy price, and decide BUY / WATCH / PASS.

## Score each criterion 1-5

{criteria_lines}

## Classify into a tier

{tier_lines}

Use the wide / narrow score thresholds in the structured contract to
pick the tier — higher weighted score → better tier.

## Compute the buy price

{method_block}

## Decision rules

- **BUY** when current price ≤ buy price AND tier is the best two tiers.
- **WATCH** when fundamentals are sound but price is above the buy price.
- **PASS** when tier is the worst, or thesis is broken, or risks dominate.
- **SELL** when thesis breaks (criteria deteriorate, tier downgrades, or
  fundamentals collapse).

## Output

Return the typed SynthesisResult JSON. Quote the metrics that drove your
score (margins, growth rate, debt levels) so the decision is auditable.
"""


def _valuation_method_prose(valuation_method: str) -> str:
    if valuation_method == "owner_earnings_yield":
        return (
            "Buy Price = Owner Earnings per Share / (Hurdle Rate - Growth Rate). "
            "Owner Earnings = Net Income + D&A - Maintenance Capex - SBC - Working "
            "Capital Change. Hurdle rate comes from the tier classification. Margin "
            "of safety is embedded in the hurdle."
        )
    if valuation_method == "peg_ratio":
        return (
            "PEG ratio = P/E ÷ earnings growth rate. PEG < 1.0 = buy. PEG 1.0-1.5 = "
            "fair. PEG > 2.0 = too expensive. Buy Price = EPS × (PEG_target × "
            "growth_rate × 100). Cap P/E at 25x even if PEG looks cheap."
        )
    if valuation_method == "dividend_yield":
        return (
            "Buy Price = Dividend per Share / Target Yield. Payout ratio must be "
            "under 60% and FCF coverage > 1.5x. Yields above 6% usually signal "
            "trouble — investigate before buying."
        )
    return (
        "Discount future cash flows to present value at the strategy's discount "
        "rate. Apply a margin of safety to the result before recommending BUY."
    )


def _build_discovery_prompt(philosophy: str) -> str:
    """Compose the prompts.discovery brief used by the agentic discovery agent."""
    if philosophy == "growth":
        bias = (
            "**Bias toward:** mid-to-large caps with revenue growth >20%/year, "
            "expanding gross margins, large TAMs, founder-led management."
        )
        avoid = (
            "**Avoid:** unprofitable companies with deteriorating unit economics, "
            "any business where revenue growth is slowing AND margins are compressing."
        )
    elif philosophy == "income":
        bias = (
            "**Bias toward:** consumer staples, utilities, healthcare, REITs with "
            "5+ years of consecutive dividend increases, payout ratios under 60%, "
            "FCF coverage > 1.5x."
        )
        avoid = (
            "**Avoid:** yields above 6% (likely yield traps), companies that froze "
            "or cut dividends in 2008-2009 or 2020, cyclical industries with "
            "earnings volatility."
        )
    else:  # value / hybrid
        bias = (
            "**Bias toward:** profitable businesses trading at low multiples of "
            "owner earnings or tangible book, low debt, durable competitive "
            "advantages, insider ownership > 5%."
        )
        avoid = (
            "**Avoid:** secular-decline industries unless the asset value alone "
            "exceeds the market cap, persistent loss-makers, anything that has "
            "been cheap for 3+ years without a catalyst."
        )
    return (
        f"Universe: US-listed common stocks meeting the {philosophy} philosophy.\n\n"
        f"{bias}\n\n{avoid}\n\n"
        f"Output 10-15 candidates ranked by fit to the criteria. Validate each "
        f"ticker resolves before including it (use the validate_ticker MCP tool)."
    )


def _build_overridable(valuation_method: str) -> dict:
    """Build the strategy's numeric llm_overridable knobs.

    Each entry is a numeric range with a default and short label. The
    *prose* about when to adjust the knob lives in prompts.synthesis —
    this is the new shape's clean separation between data and prose.
    """
    if valuation_method == "owner_earnings_yield":
        return {
            "hurdle_rate": {
                "default": 0.15,
                "range": [0.08, 0.25],
                "label": "Required return rate (lower for strong moats)",
            },
            "growth_haircut": {
                "default": 0.30,
                "range": [0.10, 0.60],
                "label": "Discount on revenue CAGR",
            },
            "maintenance_capex_ratio": {
                "default": 0.85,
                "range": [0.40, 1.00],
                "label": "Maintenance share of total capex",
            },
        }
    if valuation_method == "peg_ratio":
        return {
            "peg_target": {
                "default": 1.0,
                "range": [0.5, 2.0],
                "label": "Target PEG ratio",
            },
            "growth_haircut": {
                "default": 0.20,
                "range": [0.05, 0.50],
                "label": "Discount on earnings CAGR",
            },
        }
    if valuation_method == "dividend_yield":
        return {
            "target_yield": {
                "default": 0.035,
                "range": [0.02, 0.06],
                "label": "Minimum dividend yield target",
            },
            "growth_haircut": {
                "default": 0.20,
                "range": [0.05, 0.40],
                "label": "Discount on historical dividend growth rate",
            },
        }
    return {
        "discount_rate": {
            "default": 0.10,
            "range": [0.06, 0.20],
            "label": "Discount rate",
        },
        "growth_haircut": {
            "default": 0.25,
            "range": [0.10, 0.50],
            "label": "Discount on projected growth rate",
        },
    }


def _build_tiers(risk_level: str, max_position: float) -> dict:
    """Build position sizing tiers based on risk tolerance.

    Each tier maps to {allocation: float} — the new TierConfig only
    accepts the numeric allocation. Trigger / description prose lives
    in prompts.synthesis.
    """
    if risk_level == "conservative":
        return {"T1": {"allocation": 0.02}, "T2": {"allocation": 0.03}}
    if risk_level == "aggressive":
        return {
            "T1": {"allocation": 0.04},
            "T2": {"allocation": 0.03},
            "T3": {"allocation": 0.03},
        }
    return {  # moderate
        "T1": {"allocation": 0.03},
        "T2": {"allocation": 0.03},
        "T3": {"allocation": 0.02},
    }
