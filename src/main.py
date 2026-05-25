"""Owlfolio — CLI entry point."""

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

# Load .env before anything else reads os.environ
load_dotenv()

import typer  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.panel import Panel  # noqa: E402
from rich.table import Table  # noqa: E402


def _configure_logging(verbose: bool = False):
    """Configure logging to file + console."""
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    level = logging.DEBUG if verbose else logging.INFO

    # File handler with rotation (5MB, keep 3 files)
    file_handler = RotatingFileHandler(log_dir / "agent.log", maxBytes=5_000_000, backupCount=3)
    file_handler.setLevel(logging.DEBUG)  # Always log everything to file
    file_handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(name)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
    )

    # Console handler — only warnings and errors (Rich handles normal output)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)
    console_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

    logging.basicConfig(level=level, handlers=[file_handler, console_handler])


OWL_BANNER = "\n  🦉 Owlfolio — An AI portfolio manager. Your investment philosophy, automated.\n"


from src.agents.discovery import ticker_currency  # noqa: E402


def _fmt_price(value: float, ticker: str = "") -> str:
    """Format a price with the correct currency symbol for the ticker's market.

    JPY prices use whole numbers (¥42,500); all others use 2 decimals ($123.45).
    Falls back to USD formatting when no ticker is provided.
    """
    code, symbol = ticker_currency(ticker) if ticker else ("USD", "$")
    if code == "JPY":
        return f"{symbol}{value:,.0f}"
    return f"{symbol}{value:,.2f}"


def _fmt_mcap(value: float, ticker: str = "") -> str:
    """Format market cap in billions with correct currency symbol."""
    _, symbol = ticker_currency(ticker) if ticker else ("USD", "$")
    return f"{symbol}{value / 1e9:.1f}B"


def _owl_callback(ctx: typer.Context):
    """Show owl banner when no command is given."""
    if ctx.invoked_subcommand is None:
        typer.echo(OWL_BANNER)
        raise typer.Exit()


app = typer.Typer(
    name="owlfolio",
    help="Owlfolio -- An AI portfolio manager. Your investment philosophy, automated.",
    invoke_without_command=True,
    callback=_owl_callback,
)


def _deprecated_owlclaw_alias() -> None:
    """Backward-compatibility entry point for the old `owlclaw` command name.

    Prints a deprecation warning to stderr and forwards to the canonical
    `owlfolio` app. Will be removed in the release after this one.
    """
    import sys

    sys.stderr.write(
        "\n\033[33m[DEPRECATED]\033[0m The `owlclaw` command has been renamed to "
        "`owlfolio`. Update your scripts. This alias will be removed in the next release.\n\n"
    )
    app()


def _deprecated_agent_alias() -> None:
    """Backward-compatibility entry point for the legacy `agent` command name."""
    import sys

    sys.stderr.write(
        "\n\033[33m[DEPRECATED]\033[0m The `agent` command has been renamed to "
        "`owlfolio`. Update your scripts. This alias will be removed in the next release.\n\n"
    )
    app()


console = Console()


# Default strategy path
def get_default_strategy() -> str:
    """Return the active strategy path, checked at runtime."""
    if Path("methodology.yaml").exists():
        return "methodology.yaml"
    if Path("strategies/buffett-munger.yaml").exists():
        return "strategies/buffett-munger.yaml"
    return "strategies/buffett-value.yaml"


DEFAULT_STRATEGY = "strategies/buffett-munger.yaml"


@app.command()
def analyze(
    ticker: str = typer.Argument(help="Stock ticker to analyze (e.g., AAPL)"),
    strategy_path: str = typer.Option(
        None,
        "--strategy",
        "-s",
        help="Path to strategy YAML file",
    ),
    skip_llm: bool = typer.Option(
        False,
        "--skip-llm",
        help="Show the last saved analysis from the database (no new specialist run)",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show debug output"),
    shariah: bool = typer.Option(False, "--shariah", help="Add Shariah compliance check"),
):
    """Analyze a company using your investment methodology.

    Runs the specialist pipeline: parallel specialist subagents gather data,
    then a synthesis step produces the final investment decision.

    Examples:
        owlfolio analyze AAPL
        owlfolio analyze GOOG -s strategies/growth.yaml
        owlfolio analyze AAPL --shariah
        owlfolio analyze AAPL --skip-llm   # show last saved analysis only
    """
    _configure_logging(verbose=verbose)
    ticker = ticker.upper()
    if strategy_path is None:
        strategy_path = get_default_strategy()
    console.print(f"\n[bold]Analyzing {ticker}...[/bold]\n")

    # ── Load strategy ──
    from src.strategy.loader import load_strategy

    if not Path(strategy_path).exists():
        console.print(f"[red]Strategy file not found: {strategy_path}[/red]")
        raise typer.Exit(1)

    strategy = load_strategy(strategy_path)

    specialist_count = len(strategy.prompts.specialists)
    console.print(f"[dim]Strategy: {strategy.name} | Specialists: {specialist_count}[/dim]\n")

    # ── Quick check (--skip-llm) — show saved analysis if available ──
    if skip_llm:
        from src.db.operations import get_latest_analysis
        from src.db.schema import get_db

        conn = get_db()
        saved = get_latest_analysis(conn, ticker)
        conn.close()

        if saved:
            console.print(f"\n  [bold]{ticker}[/bold] — Last analysis ({saved['created_at'][:10]})")
            console.print(
                f"  Decision: {saved['decision']}"
                f" | {saved['quality_tier']} {saved['weighted_score']}/5"
            )
            if saved.get("buy_price"):
                console.print(f"  Fair Value: {_fmt_price(saved['buy_price'], ticker)}")
            if saved.get("thesis"):
                console.print(f"  Thesis: {saved['thesis'][:150]}...")
        else:
            console.print(
                f"\n  [dim]No saved analysis for {ticker}."
                " Run without --skip-llm for full specialist"
                " analysis.[/dim]"
            )
        return

    # ── Full specialist analysis ──
    company_name = ticker  # Specialists will find the real name

    # ── Specialist pipeline ──
    import time as _time

    from src.llm.provider import _run_async
    from src.specialists.runner import run_specialists
    from src.specialists.synthesis import synthesize

    # Build add-on specialists
    addons = []
    if shariah:
        from src.specialists.addons import SHARIAH_SPECIALIST

        addons.append(SHARIAH_SPECIALIST)

    total_count = specialist_count + len(addons)
    console.print(f"\n[dim]Running specialist analysis ({total_count} specialists)...[/dim]")

    t_start = _time.monotonic()

    # Run specialists
    findings = _run_async(run_specialists(ticker, company_name, strategy, addons=addons))

    for f in findings:
        console.print(
            f"  [green]\u2713[/green] {f.specialist_name} (confidence: {f.confidence:.0%})"
        )

    # Run synthesis
    console.print("[dim]Synthesizing findings...[/dim]")
    result = _run_async(synthesize(ticker, company_name, findings, strategy))

    # Save to DB
    from src.db.operations import add_memory, save_analysis, save_specialist_findings
    from src.db.schema import get_db

    conn = get_db()
    analysis_id = save_analysis(
        conn,
        ticker=ticker,
        strategy=strategy.name,
        decision=result.decision,
        buy_price=result.fair_value or 0,
        current_price=result.current_price or 0,
        quality_tier=result.quality_tier,
        weighted_score=result.weighted_score,
        thesis=result.thesis,
        bull_case=result.bull_case,
        bear_case=result.bear_case,
        key_risks=result.key_risks,
        overrides={},
    )

    # Persist per-specialist findings for audit drilldown and re-synthesis
    if findings:
        save_specialist_findings(conn, analysis_id, findings)

    # Save to memory
    fair_value_str = _fmt_price(result.fair_value, ticker) if result.fair_value else "N/A"
    add_memory(
        "observation",
        f"{ticker}: {result.decision} at {fair_value_str} fair value,"
        f" {result.quality_tier} {result.weighted_score:.1f}/5",
        ticker=ticker,
    )

    # One-line greppable summary in the rotating log — covers the 90% diagnostic
    # use case (what did the pipeline run, what did it decide, did it complete)
    # without the maintenance cost of a separate audit table. See
    # docs/ARCHITECTURE.md → "Key Design Decisions" → audit trail.
    duration_s = _time.monotonic() - t_start
    addon_str = ",".join(a.name for a in addons) if addons else "-"
    logging.getLogger("owlfolio.run").info(
        "ticker=%s strategy=%s addons=%s decision=%s confidence=%.2f "
        "score=%.1f/5 specialists=%d/%d duration=%.1fs analysis_id=%d",
        ticker,
        strategy.name,
        addon_str,
        result.decision,
        result.confidence,
        result.weighted_score,
        len(findings),
        total_count,
        duration_s,
        analysis_id,
    )

    # Display
    _display_synthesis_result(result, strategy)

    console.print(f"\n[dim]Analysis saved (ID: {analysis_id})[/dim]")


def _get_specialist_names(strategy) -> list[str]:
    """Return the specialist roster for the strategy (in declaration order)."""
    return list(strategy.prompts.specialists.keys())


def _primary_overridable_str(s) -> str:
    """One-line summary of the strategy's primary numeric knob."""
    if "peg_target" in s.llm_overridable:
        return f"PEG target: {s.llm_overridable['peg_target'].default:.1f}x"
    if "target_yield" in s.llm_overridable:
        return f"Target yield: {s.llm_overridable['target_yield'].default:.1%}"
    if "discount_factor" in s.llm_overridable:
        return f"Book discount: {s.llm_overridable['discount_factor'].default:.0%}"
    if "hurdle_rate" in s.llm_overridable:
        return f"Hurdle: {s.llm_overridable['hurdle_rate'].default:.0%}"
    return "—"


def _display_synthesis_result(result, strategy):
    """Display the specialist pipeline's synthesis result."""

    # Decision panel
    colors = {"BUY": "green", "WATCH": "yellow", "PASS": "red"}
    color = colors.get(result.decision, "white")

    console.print(
        Panel(
            f"[bold]{result.ticker} — {result.company_name}[/bold]\n"
            f"Decision: [{color}][bold]{result.decision}[/bold][/{color}] "
            f"(confidence: {result.confidence:.0%})\n"
            f"{result.reasoning}",
            title="Investment Decision",
            border_style=f"bold {color}",
        )
    )

    # Valuation — always fetch a live price instead of using stored value
    if result.fair_value:
        from src.data.prices import get_price_data

        live = get_price_data(result.ticker)
        display_price = live.price if live.price and live.price > 0 else result.current_price
        if display_price:
            gap = (display_price - result.fair_value) / result.fair_value * 100
            table = Table(title="Valuation", show_header=True)
            table.add_column("Metric", style="bold")
            table.add_column("Value", justify="right")
            table.add_row(
                strategy.display.target_price_label,
                _fmt_price(result.fair_value, result.ticker),
            )
            table.add_row("Current Price", _fmt_price(display_price, result.ticker))
            table.add_row("Gap", f"{gap:+.1f}%")
            table.add_row("Reasoning", result.valuation_reasoning[:100])
            console.print(table)

    # Quality
    console.print(
        f"\n  Weighted Score: {result.weighted_score:.1f}/5 — {result.quality_tier.upper()}"
    )

    # Thesis
    if result.thesis:
        console.print(
            Panel(
                f"[bold]Thesis:[/bold] {result.thesis}\n\n"
                f"[green][bold]Bull:[/bold][/green] {result.bull_case}\n\n"
                f"[red][bold]Bear:[/bold][/red] {result.bear_case}",
                title="Investment Thesis",
            )
        )

    # Risks
    if result.key_risks:
        console.print("\n[bold]Key Risks:[/bold]")
        for risk in result.key_risks:
            console.print(f"  [red]\u2022[/red] {risk}")

    # Discrepancies (if specialists disagreed)
    if result.discrepancies:
        console.print("\n[bold yellow]Data Discrepancies:[/bold yellow]")
        for d in result.discrepancies:
            console.print(f"  [yellow]\u26a0[/yellow] {d}")

    # Sources
    if result.data_sources:
        console.print(f"\n[dim]Sources: {', '.join(result.data_sources[:5])}[/dim]")

    console.print(f"[dim]Analysis saved (specialists: {', '.join(result.specialists_used)})[/dim]")


@app.command()
def setup(
    quick: bool = typer.Option(
        False,
        "--quick",
        help="Use form wizard instead of full setup",
    ),
    create: bool = typer.Option(
        False,
        "--create",
        help="Skip straight to custom strategy creation (LLM-powered)",
    ),
):
    """First-time setup: configure auth, pick a strategy, test the connection.

    Steps: (1) check/configure credentials, (2) pick a strategy,
    (3) test API, (4) quick pipeline test, (5) optionally create a custom strategy.

    Use --quick to skip the LLM API test.
    Use --create to jump straight to custom strategy creation.
    """
    if create:
        from src.modules.onboarding import run_onboarding

        path = run_onboarding()
        if path:
            console.print(f"[bold]Strategy created:[/bold] {path}")
            console.print("Run [bold]owlfolio analyze TICKER[/bold] to use it.")
        return

    console.print("\n[bold]Owlfolio — Setup[/bold]\n")

    # ── Step 1: API Key ──
    console.print("[bold]Step 1: API Credentials[/bold]")

    from src.llm.provider import _load_oauth_token

    has_creds = False
    cred_source = ""

    if os.environ.get("ANTHROPIC_API_KEY"):
        has_creds = True
        cred_source = "ANTHROPIC_API_KEY env var"
    elif os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        has_creds = True
        cred_source = "CLAUDE_CODE_OAUTH_TOKEN env var (Claude Pro subscription)"
    elif _load_oauth_token():
        has_creds = True
        cred_source = "Claude Code OAuth (~/.claude/.credentials.json)"

    if has_creds:
        console.print(f"  [green]✓ Credentials found:[/green] {cred_source}")
        change = typer.prompt(
            "  Change credentials? (1) Claude Pro setup token  (2) API key  (3) Keep current",
            default="3",
        )
    else:
        console.print("  [yellow]No credentials found.[/yellow]")
        change = typer.prompt(
            "  Choose auth method: (1) Claude Pro setup token  (2) Anthropic API key  (3) Skip",
            default="1",
        )

    if change == "1":
        token = typer.prompt(
            "  Paste your Claude setup token (from `claude setup-token`)",
            default="",
            show_default=False,
        )
        if token:
            env_path = Path(".env")
            env_content = env_path.read_text() if env_path.exists() else ""
            lines = [
                line
                for line in env_content.splitlines()
                if not line.startswith("CLAUDE_CODE_OAUTH_TOKEN")
            ]
            lines.append(f"CLAUDE_CODE_OAUTH_TOKEN={token}")
            env_path.write_text("\n".join(lines) + "\n")
            console.print("  [green]✓ Setup token saved to .env[/green]")
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token
            has_creds = True
            cred_source = "CLAUDE_CODE_OAUTH_TOKEN (Claude Pro setup token)"
    elif change == "2":
        api_key = typer.prompt(
            "  Enter your Anthropic API key",
            default="",
            show_default=False,
        )
        if api_key:
            env_path = Path(".env")
            env_content = env_path.read_text() if env_path.exists() else ""
            lines = [
                line
                for line in env_content.splitlines()
                if not line.startswith("ANTHROPIC_API_KEY")
            ]
            lines.append(f"ANTHROPIC_API_KEY={api_key}")
            env_path.write_text("\n".join(lines) + "\n")
            console.print("  [green]✓ API key saved to .env[/green]")
            os.environ["ANTHROPIC_API_KEY"] = api_key
            has_creds = True

    # ── Step 2: Strategy ──
    console.print("\n[bold]Step 2: Investment Strategy[/bold]")

    strategies_dir = Path("strategies")
    available = sorted(strategies_dir.glob("*.yaml")) if strategies_dir.exists() else []

    methodology = Path("methodology.yaml")
    if not methodology.exists() and available:
        # First-run convenience: pick a default and copy it. The user can
        # change strategies any time with `owlfolio strategy --use NAME`.
        import shutil

        default_src = strategies_dir / "buffett-munger.yaml"
        if not default_src.exists():
            default_src = available[0]
        shutil.copy2(default_src, methodology)
        console.print(
            f"  [green]✓ methodology.yaml created from {default_src.stem}[/green] "
            f"(change later with `owlfolio strategy --use NAME`)"
        )

    if available:
        console.print("  Available strategies:")
        for i, s in enumerate(available, 1):
            marker = (
                " [yellow](active)[/yellow]"
                if s.stem in (methodology.exists() and methodology.read_text() or "")
                else ""
            )
            console.print(f"    {i}. {s.stem}{marker}")

        console.print(f"\n  Default: [bold]{DEFAULT_STRATEGY}[/bold]")
        console.print("  [dim]To change, use: owlfolio strategy --use NAME[/dim]")
    else:
        console.print("  [yellow]No strategies found in strategies/ directory[/yellow]")

    # Validate the default strategy
    from src.strategy.loader import load_strategy, validate_strategy

    try:
        strategy = load_strategy(DEFAULT_STRATEGY)
        warnings = validate_strategy(DEFAULT_STRATEGY)

        console.print(f"\n  Strategy: [bold]{strategy.name}[/bold]")
        console.print("  Tiers (tier → required return; None = don't buy):")
        for tier, rate in strategy.tiers.items():
            if rate is not None:
                console.print(f"    {tier:20s} → {rate:.0%}")
            else:
                console.print(f"    {tier:20s} → [red]don't buy[/red]")

        if warnings:
            for w in warnings:
                console.print(f"  [yellow]⚠ {w}[/yellow]")
        else:
            console.print("  [green]✓ Strategy valid[/green]")
    except Exception as e:
        console.print(f"  [red]Strategy error: {e}[/red]")

    # ── Step 3: Test API ──
    if not quick:
        console.print("\n[bold]Step 3: API Connection Test[/bold]")

        try:
            from src.llm.provider import complete

            result = complete("Respond with exactly: API test successful")
            console.print(f"  [green]✓ API working:[/green] {result.strip()}")
        except Exception as e:
            console.print(f"  [red]✗ API error: {e}[/red]")
            console.print("  [dim]Fix Claude credentials before running 'owlfolio analyze'.[/dim]")
    else:
        console.print(
            "\n[bold]Step 3: API Connection Test[/bold]"
            " [dim](skipped — use without --quick to test)[/dim]"
        )

    # ── Step 4: Quick test ──
    console.print("\n[bold]Step 4: Quick Test (price fetch)[/bold]")
    console.print("  [dim]Running: price check for AAPL[/dim]")
    try:
        from src.data.prices import get_price_data

        price_data = get_price_data("AAPL")
        console.print(
            f"  [green]✓ Pipeline works:[/green] {price_data.name}"
            f" — {_fmt_price(price_data.price, 'AAPL')}"
            f" (market cap: {_fmt_mcap(price_data.market_cap, 'AAPL')})"
        )
    except Exception as e:
        console.print(f"  [red]✗ Pipeline error: {e}[/red]")

    # ── Step 5: Timezone & Safe Schedule ──
    console.print("\n[bold]Step 5: Timezone & Safe Default Schedule[/bold]")

    common_tzs = [
        "America/New_York",
        "America/Chicago",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Dubai",
        "Asia/Kolkata",
        "Asia/Hong_Kong",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Asia/Riyadh",
        "Australia/Sydney",
    ]

    # Load current config
    import yaml

    config_path = Path("data/config.yaml")
    config = yaml.safe_load(config_path.read_text()) if config_path.exists() else {}
    current_tz = config.get("timezone", "UTC")
    primary_market = config.get("markets", ["US"])[0]

    console.print(f"  Current timezone: [bold]{current_tz}[/bold]")
    console.print("  Common timezones:")
    for i, tz in enumerate(common_tzs, 1):
        marker = " [yellow](current)[/yellow]" if tz == current_tz else ""
        console.print(f"    {i:2d}. {tz}{marker}")

    tz_choice = typer.prompt(
        "  Select timezone (number or IANA name)",
        default=current_tz,
    )

    # Resolve choice — number or raw IANA string
    try:
        idx = int(tz_choice) - 1
        if 0 <= idx < len(common_tzs):
            chosen_tz = common_tzs[idx]
        else:
            chosen_tz = tz_choice
    except ValueError:
        chosen_tz = tz_choice

    # Validate timezone
    from zoneinfo import ZoneInfo

    try:
        ZoneInfo(chosen_tz)
    except (KeyError, ValueError):
        console.print(f"  [red]Invalid timezone '{chosen_tz}', keeping {current_tz}[/red]")
        chosen_tz = current_tz

    # Save timezone to config
    config["timezone"] = chosen_tz
    config_path.write_text(yaml.dump(config, default_flow_style=False))
    console.print(f"  [green]✓ Timezone set to {chosen_tz}[/green]")

    # Create default schedule
    from src.db.schema import get_db as _get_db
    from src.modules.schedule_defaults import create_default_schedule

    conn = _get_db()
    try:
        created = create_default_schedule(conn, timezone=chosen_tz, market=primary_market)
    finally:
        conn.close()

    if created:
        sched_table = Table(title="Safe Default Schedule Created", show_header=True)
        sched_table.add_column("Task", style="bold")
        sched_table.add_column("Schedule")
        sched_table.add_column("Description")
        for t in created:
            sched_table.add_row(t["name"], t["cron"], t["description"])
        console.print(sched_table)
    else:
        console.print("  [dim]Default schedule already configured (all tasks exist).[/dim]")

    console.print(
        "  [dim]Safe defaults only check watchlist prices and portfolio P&L; "
        "they do not run Claude research jobs automatically.[/dim]"
    )
    console.print(
        "  [dim]Customize with: owlfolio tasks / owlfolio schedule / owlfolio unschedule[/dim]"
    )

    # ── Step 6: Custom strategy? ──
    console.print("\n[bold]Step 6: Custom Strategy (optional)[/bold]")
    create_custom = typer.confirm(
        "  Would you like to create a custom strategy?",
        default=False,
    )

    if create_custom:
        from src.modules.onboarding import run_onboarding

        run_onboarding()

    # ── Done ──
    console.print(f"\n{'═' * 50}")
    console.print("[bold]Setup complete![/bold]")
    console.print("\nNext steps:")
    console.print("  owlfolio analyze AAPL              # Full specialist analysis")
    console.print("  owlfolio analyze AAPL --shariah    # Add Shariah compliance check")
    console.print("  owlfolio analyze AAPL --skip-llm   # Show last saved analysis (no new run)")
    console.print("  owlfolio setup --create            # Create a custom strategy")
    console.print("  owlfolio strategy --list           # View all strategies")
    console.print("  owlfolio config show               # View active strategy")
    console.print("  owlfolio tasks                     # View scheduled tasks")
    console.print("  owlfolio daemon                    # Start the background scheduler")
    console.print()


@app.command(hidden=True)
def onboard():
    """Alias for 'setup'. Use 'owlfolio setup' instead."""
    setup(quick=False, create=False)


@app.command()
def config(
    action: str = typer.Argument(help="Action: show, validate"),
):
    """View or validate your methodology configuration."""
    if action == "validate":
        from src.strategy.loader import validate_strategy

        path = get_default_strategy()
        console.print(f"[dim]Validating {path}...[/dim]")
        warnings = validate_strategy(path)
        if warnings:
            for w in warnings:
                console.print(f"  [yellow]⚠ {w}[/yellow]")
        else:
            console.print("  [green]✓ Strategy is valid[/green]")
    elif action == "show":
        from src.strategy.loader import load_strategy

        strategy = load_strategy(get_default_strategy())
        console.print(f"[bold]Strategy: {strategy.name}[/bold]")
        if strategy.summary:
            console.print(f"  {strategy.summary.strip().splitlines()[0]}")
        console.print(f"  Max positions: {strategy.position_sizing.max_positions}")
        console.print(
            f"  Criteria ({len(strategy.criteria)}): {', '.join(c.name for c in strategy.criteria)}"
        )
        if strategy.llm_overridable:
            console.print("  LLM-overridable variables:")
            for name, var in strategy.llm_overridable.items():
                console.print(
                    f"    {name:25s} default={var.default:<6.2f} "
                    f"range=[{var.range[0]:.2f}, {var.range[1]:.2f}]"
                )
        specialists = strategy.prompts.specialists
        if specialists:
            console.print(f"  Specialists ({len(specialists)}): {', '.join(specialists.keys())}")
        else:
            console.print("  Specialists: [yellow]none defined[/yellow]")
        console.print("  Tiers (tier → required return; None = don't buy):")
        for tier, rate in strategy.tiers.items():
            if rate is not None:
                console.print(f"    {tier:20s} → {rate:.0%}")
            else:
                console.print(f"    {tier:20s} → don't buy")
    else:
        console.print(f"[red]Unknown action: {action}. Use 'show' or 'validate'.[/red]")


@app.command(name="strategy")
def strategy_cmd(
    full: bool = typer.Option(False, "--full", help="Show full YAML"),
    list_all: bool = typer.Option(False, "--list", help="List available strategies"),
    compare: bool = typer.Option(False, "--compare", help="Compare strategies"),
    use: str = typer.Option(None, "--use", help="Switch active strategy"),
    info: str = typer.Option(None, "--info", help="Show full summary for a strategy"),
):
    """Show current active strategy."""
    import shutil

    from src.strategy.loader import load_strategy

    strategies_dir = Path("strategies")

    if use is not None:
        source = strategies_dir / f"{use}.yaml"
        if not source.exists():
            console.print(f"[red]Strategy not found: {source}[/red]")
            raise typer.Exit(1)
        shutil.copy2(str(source), "methodology.yaml")
        console.print(f"\u2713 Active strategy changed to {use}")
        return

    if info is not None:
        source = strategies_dir / f"{info}.yaml"
        if not source.exists():
            console.print(f"[red]Strategy not found: {source}[/red]")
            raise typer.Exit(1)

        s = load_strategy(source)
        parts: list[str] = []

        # Name and description
        parts.append(f"[bold]{s.name}[/bold]")
        parts.append("")
        parts.append(s.description.strip() if s.description else "(no description)")
        parts.append("")

        # Summary
        if s.summary:
            parts.append(s.summary.strip())
            parts.append("")

        # Key parameters
        parts.append(f"[bold]Primary knob:[/bold] {_primary_overridable_str(s)}")
        criteria_names = ", ".join(f"{c.name} ({c.weight:.0%})" for c in s.criteria)
        parts.append(f"[bold]Criteria:[/bold] {criteria_names}")

        specialist_names = _get_specialist_names(s)
        spec_str = ", ".join(specialist_names) if specialist_names else "none"
        parts.append(f"[bold]Specialists:[/bold] {spec_str}")

        ps = s.position_sizing
        if ps.tiers:
            tier_parts = ", ".join(f"{name}: {t.allocation:.0%}" for name, t in ps.tiers.items())
        elif ps.tier_ranges:
            tier_parts = ", ".join(
                f"{name}: {r[0]:.0%}-{r[1]:.0%}" if r else f"{name}: N/A"
                for name, r in ps.tier_ranges.items()
            )
        else:
            tier_parts = "not configured"
        parts.append(
            f"[bold]Position Sizing:[/bold] {tier_parts}"
            f" | max {ps.max_single_position:.0%} per position"
            f" | {ps.max_positions} positions max"
        )
        parts.append("")

        # LLM-overridable variables
        if s.llm_overridable:
            parts.append("[bold]LLM-Overridable Variables:[/bold]")
            for name, var in s.llm_overridable.items():
                parts.append(
                    f"  {name}: default={var.default}, range=[{var.range[0]}, {var.range[1]}]"
                )

        console.print(
            Panel(
                "\n".join(parts),
                title=f"Strategy Info: {s.name}",
                border_style="bold",
            )
        )
        return

    if list_all:
        # List all available strategies with comprehensive details
        if not strategies_dir.exists():
            console.print("[red]No strategies/ directory found[/red]")
            raise typer.Exit(1)
        yaml_files = sorted(strategies_dir.glob("*.yaml"))
        if not yaml_files:
            console.print("[yellow]No strategy files found in strategies/[/yellow]")
            raise typer.Exit(1)

        # Determine active strategy name
        active_name = None
        active_path = Path(get_default_strategy())
        if active_path.exists():
            try:
                active_s = load_strategy(active_path)
                active_name = active_s.name
            except Exception:
                pass

        table = Table(title="Available Strategies", show_header=True)
        table.add_column("Strategy", style="bold")
        table.add_column("Primary Knob")
        table.add_column("Criteria", justify="center")
        table.add_column("Specialists")
        table.add_column("Philosophy", max_width=55)

        for yf in yaml_files:
            try:
                s = load_strategy(yf)
                # Strategy name with active marker
                name_display = s.name
                if s.name == active_name:
                    name_display = f"{s.name} [bold yellow]*[/bold yellow]"

                knob_display = _primary_overridable_str(s)
                criteria_display = f"{len(s.criteria)} criteria"

                # Specialists
                specialist_names = _get_specialist_names(s)
                mod_display = (
                    f"{len(specialist_names)} ({', '.join(specialist_names)})"
                    if specialist_names
                    else "none"
                )

                # Philosophy (truncated description)
                desc = s.description.strip() if s.description else ""
                if len(desc) > 100:
                    desc = desc[:97] + "..."
                philosophy_display = desc

                table.add_row(
                    name_display,
                    knob_display,
                    criteria_display,
                    mod_display,
                    philosophy_display,
                )
            except Exception as e:
                table.add_row(yf.stem, f"[red]Error: {e}[/red]", "", "", "")

        console.print(table)
        if active_name:
            console.print(f"[dim]* = active strategy ({get_default_strategy()})[/dim]")
        return

    if compare:
        # Compare all strategies side by side
        if not strategies_dir.exists():
            console.print("[red]No strategies/ directory found[/red]")
            raise typer.Exit(1)
        yaml_files = sorted(strategies_dir.glob("*.yaml"))
        strategies_list = []
        for yf in yaml_files:
            try:
                strategies_list.append(load_strategy(yf))
            except Exception:
                pass

        if not strategies_list:
            console.print("[yellow]No valid strategies found[/yellow]")
            raise typer.Exit(1)

        table = Table(title="Strategy Comparison", show_header=True)
        table.add_column("Attribute", style="bold")
        for s in strategies_list:
            table.add_column(s.name)

        table.add_row(
            "Primary Knob",
            *[_primary_overridable_str(s) for s in strategies_list],
        )
        table.add_row(
            "Max Positions",
            *[str(s.position_sizing.max_positions) for s in strategies_list],
        )
        table.add_row(
            "Max Single Position",
            *[f"{s.position_sizing.max_single_position:.0%}" for s in strategies_list],
        )
        table.add_row(
            "Criteria",
            *[str(len(s.criteria)) for s in strategies_list],
        )
        table.add_row(
            "Tiers",
            *[", ".join(s.tiers.keys()) for s in strategies_list],
        )

        def _specialist_list(s):
            names = _get_specialist_names(s)
            return f"{len(names)}" if names else "none"

        table.add_row(
            "Specialists",
            *[_specialist_list(s) for s in strategies_list],
        )

        console.print(table)
        return

    # Default or --full: show the active strategy
    active = get_default_strategy()
    if not Path(active).exists():
        console.print(f"[red]Strategy file not found: {active}[/red]")
        raise typer.Exit(1)

    if full:
        # Print raw YAML
        console.print(Path(active).read_text())
        return

    # Default: comprehensive formatted summary
    s = load_strategy(active)

    parts: list[str] = []

    # Header
    parts.append(f"[bold]Strategy: {s.name}[/bold]")
    parts.append("")
    parts.append(s.description.strip() if s.description else "(no description)")
    parts.append("")

    # Summary (1-line tagline if present)
    if s.summary:
        first_para = s.summary.strip().split("\n\n")[0]
        parts.append(first_para)
        parts.append("")

    # LLM-overridable primary knob
    parts.append(f"[bold]Primary knob:[/bold] {_primary_overridable_str(s)}")
    parts.append("")

    # Criteria framework
    criteria_parts = " | ".join(f"{c.name} ({c.weight:.0%})" for c in s.criteria)
    parts.append(f"[bold]Criteria:[/bold] {len(s.criteria)} (weighted, sum=1.0)")
    parts.append(f"  {criteria_parts}")
    wide = s.thresholds.get("wide", 3.5)
    narrow = s.thresholds.get("narrow", 2.5)
    parts.append(f"  Score thresholds: wide >= {wide} | narrow >= {narrow}")
    parts.append("")

    # Tiers (tier name → required return; None = don't buy)
    tier_parts = []
    for tier, rate in s.tiers.items():
        if rate is not None:
            tier_parts.append(f"{tier}: {rate:.0%}")
        else:
            tier_parts.append(f"{tier}: don't buy")
    parts.append("[bold]Tiers:[/bold]")
    parts.append(f"  {' | '.join(tier_parts)}")
    parts.append("")

    # Position sizing
    ps = s.position_sizing
    if ps.tiers:
        tier_parts = " | ".join(f"{name}: {t.allocation:.0%}" for name, t in ps.tiers.items())
    elif ps.tier_ranges:
        tier_parts = " | ".join(
            f"{name}: {r[0]:.0%}-{r[1]:.0%}" if r else f"{name}: N/A"
            for name, r in ps.tier_ranges.items()
        )
    else:
        tier_parts = "not configured"
    parts.append("[bold]Position Sizing:[/bold]")
    parts.append(
        f"  {tier_parts} | Max: {ps.max_single_position:.0%}"
        f" | Cash min: {ps.cash_reserve.minimum:.0%}"
    )
    parts.append("")

    # Specialists
    specialist_names = _get_specialist_names(s)
    spec_str = ", ".join(specialist_names) if specialist_names else "none"
    parts.append(f"[bold]Specialists ({len(specialist_names)}):[/bold] {spec_str}")
    parts.append("")

    # LLM-overridable variables
    if s.llm_overridable:
        parts.append("[bold]LLM-Overridable:[/bold]")
        for name, var in s.llm_overridable.items():
            parts.append(f"  {name} [{var.range[0]}-{var.range[1]}, default {var.default}]")

    console.print(
        Panel(
            "\n".join(parts),
            title="Active Strategy",
            border_style="bold",
        )
    )


@app.command()
def doctor():
    """One-stop health report: credentials, strategy, DB, ports, mode.

    Use this when something isn't working. Output is intentionally
    copy-pasteable into a bug report.
    """
    import socket
    import sys

    from src.llm.provider import _load_oauth_token

    def _port_free(port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                return s.connect_ex(("127.0.0.1", port)) != 0
        except OSError:
            return True

    table = Table(title="Owlfolio Doctor", show_header=True, header_style="bold")
    table.add_column("Check", style="bold")
    table.add_column("Status")

    # Python
    pyver = sys.version.split()[0]
    py_ok = sys.version_info >= (3, 12)
    table.add_row(
        "Python 3.12+",
        f"[green]✓ {pyver}[/green]" if py_ok else f"[red]✗ {pyver} (need ≥3.12)[/red]",
    )

    # Auth
    auth = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        auth = "API key (ANTHROPIC_API_KEY)"
    elif os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        auth = "Agent SDK token (CLAUDE_CODE_OAUTH_TOKEN)"
    elif _load_oauth_token():
        auth = "Claude subscription (~/.claude/.credentials.json)"
    table.add_row(
        "Claude credentials",
        (
            f"[green]✓ {auth}[/green]"
            if auth
            else "[red]✗ none — run `owlfolio setup` or set ANTHROPIC_API_KEY[/red]"
        ),
    )

    # Active strategy + methodology.yaml
    active = get_default_strategy()
    if Path(active).exists():
        try:
            from src.strategy.loader import load_strategy

            s = load_strategy(active)
            n_spec = len(s.prompts.specialists)
            table.add_row(
                "Active strategy",
                f"[green]✓ {s.name}[/green] ({active}, {n_spec} specialists)",
            )
        except Exception as e:
            table.add_row("Active strategy", f"[red]✗ load error: {e}[/red]")
    else:
        table.add_row("Active strategy", f"[red]✗ {active} not found[/red]")

    # Database
    from src.db.schema import DB_PATH as _DB_PATH

    if Path(_DB_PATH).exists():
        try:
            import sqlite3

            conn = sqlite3.connect(str(_DB_PATH))
            holdings = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
            analyses = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
            conn.close()
            table.add_row(
                "Portfolio DB",
                f"[green]✓ {_DB_PATH}[/green] ({holdings} holdings, {analyses} analyses)",
            )
        except Exception as e:
            table.add_row("Portfolio DB", f"[yellow]⚠ {_DB_PATH} (read error: {e})[/yellow]")
    else:
        table.add_row("Portfolio DB", f"[dim]not yet initialized[/dim] ({_DB_PATH})")

    # Web UI port
    table.add_row(
        "Web UI port 8000",
        "[green]✓ free[/green]" if _port_free(8000) else "[yellow]⚠ already in use[/yellow]",
    )

    # Daemon status
    from src.daemon import is_daemon_running

    daemon_alive = is_daemon_running()
    table.add_row(
        "Daemon",
        "[green]✓ running[/green]"
        if daemon_alive
        else "[dim]not running (scheduled tasks won't execute until you start it)[/dim]",
    )

    # Runtime mode
    table.add_row("Runtime", "[green]host-native[/green]")

    console.print(table)


@app.command()
def status():
    """Show system status: credentials, strategy, data sources."""
    import sys

    # Auth method
    from src.llm.provider import _load_oauth_token

    auth_method = "none"
    if os.environ.get("ANTHROPIC_API_KEY"):
        auth_method = "API key (ANTHROPIC_API_KEY)"
    elif os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        auth_method = "Agent SDK (CLAUDE_CODE_OAUTH_TOKEN)"
    elif os.environ.get("ONECLI_URL"):
        auth_method = f"OneCLI proxy ({os.environ['ONECLI_URL']})"
    elif _load_oauth_token():
        auth_method = "Agent SDK (OAuth — ~/.claude/.credentials.json)"

    table = Table(title="System Status", show_header=True)
    table.add_column("Component", style="bold")
    table.add_column("Status")

    # Auth
    if auth_method == "none":
        table.add_row("Auth", "[red]No credentials found[/red]")
    else:
        table.add_row("Auth", f"[green]{auth_method}[/green]")

    # Strategy
    active_strategy = get_default_strategy()
    strategy_exists = Path(active_strategy).exists()
    if strategy_exists:
        from src.strategy.loader import load_strategy

        try:
            s = load_strategy(active_strategy)
            table.add_row("Strategy", f"{s.name} ({active_strategy})")
        except Exception as e:
            table.add_row("Strategy", f"[red]Error: {e}[/red]")
    else:
        table.add_row("Strategy", f"[red]Not found: {active_strategy}[/red]")

    # methodology.yaml
    methodology_exists = Path("methodology.yaml").exists()
    table.add_row(
        "methodology.yaml",
        (
            "[green]exists[/green]"
            if methodology_exists
            else "[dim]not found (using default strategy)[/dim]"
        ),
    )

    # Python version
    table.add_row("Python", sys.version.split()[0])

    # Package version
    try:
        from importlib.metadata import version as pkg_version

        table.add_row("owlfolio", pkg_version("owlfolio"))
    except Exception:
        table.add_row("owlfolio", "[dim]dev (not installed)[/dim]")

    console.print(table)


@app.command(name="specialists")
def specialists_cmd():
    """Show the specialist roster for the active strategy."""
    from src.strategy.loader import load_strategy

    active = get_default_strategy()
    if not Path(active).exists():
        console.print(f"[red]Strategy file not found: {active}[/red]")
        raise typer.Exit(1)

    strategy = load_strategy(active)
    specialists = getattr(strategy, "specialists", None) or {}

    if not specialists:
        console.print(f"[yellow]Strategy '{strategy.name}' has no specialists defined.[/yellow]")
        return

    table = Table(title=f"Specialists ({strategy.name})", show_header=True)
    table.add_column("Specialist", style="bold")
    table.add_column("Sources", justify="center")
    table.add_column("Role", max_width=70)

    for name, spec in specialists.items():
        if not isinstance(spec, dict):
            continue
        role_text = " ".join((spec.get("role") or "").split())
        if len(role_text) > 200:
            role_text = role_text[:197] + "..."
        sources = spec.get("sources") or []
        table.add_row(name, str(len(sources)), role_text)

    console.print(table)


@app.command()
def portfolio(
    allow_llm_price: bool = typer.Option(
        True,
        "--llm-price/--no-llm-price",
        help="Allow Claude web-search fallback if primary price sources fail.",
    ),
):
    """View portfolio holdings and performance."""
    from src.data.prices import get_price_data
    from src.db.operations import get_holdings
    from src.db.schema import get_db

    conn = get_db()
    holdings = get_holdings(conn)

    if not holdings:
        console.print("[dim]No holdings. Add one with: owlfolio add TICKER SHARES PRICE[/dim]")
        return

    table = Table(title="Portfolio", show_header=True)
    table.add_column("Ticker", style="bold")
    table.add_column("Shares", justify="right")
    table.add_column("Cost Basis", justify="right")
    table.add_column("Current", justify="right")
    table.add_column("P&L", justify="right")
    table.add_column("P&L %", justify="right")
    table.add_column("Account")

    total_cost = 0.0
    total_value = 0.0
    missing_price_count = 0

    for h in holdings:
        try:
            price_data = get_price_data(h["ticker"], allow_llm_fallback=allow_llm_price)
            current = price_data.price if price_data.price and price_data.price > 0 else None
        except Exception:
            current = None

        cost = h["shares"] * h["cost_basis"]
        if current is not None:
            value = h["shares"] * current
            pnl = value - cost
            pnl_pct = (pnl / cost * 100) if cost > 0 else 0
            total_cost += cost
            total_value += value
            color = "green" if pnl >= 0 else "red"
            table.add_row(
                h["ticker"],
                f"{h['shares']:.2f}",
                _fmt_price(h["cost_basis"], h["ticker"]),
                _fmt_price(current, h["ticker"]),
                f"[{color}]{_fmt_price(pnl, h['ticker'])}[/{color}]",
                f"[{color}]{pnl_pct:+.1f}%[/{color}]",
                h.get("account", "default") or "default",
            )
        else:
            missing_price_count += 1
            table.add_row(
                h["ticker"],
                f"{h['shares']:.2f}",
                _fmt_price(h["cost_basis"], h["ticker"]),
                "[yellow]N/A[/yellow]",
                "[yellow]N/A[/yellow]",
                "[yellow]N/A[/yellow]",
                h.get("account", "default") or "default",
            )

    console.print(table)

    # Summary
    total_pnl = total_value - total_cost
    total_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0
    color = "green" if total_pnl >= 0 else "red"
    console.print(f"\n  Priced Cost: {_fmt_price(total_cost)}")
    console.print(f"  Priced Value: {_fmt_price(total_value)}")
    console.print(f"  Priced P&L: [{color}]{_fmt_price(total_pnl)} ({total_pct:+.1f}%)[/{color}]")
    if missing_price_count:
        console.print(
            f"  [yellow]Summary excludes {missing_price_count} holding(s) with unavailable "
            "current prices.[/yellow]"
        )


@app.command()
def add(
    ticker: str = typer.Argument(help="Stock ticker (e.g., AAPL)"),
    shares: float = typer.Argument(help="Number of shares purchased"),
    price: float = typer.Argument(help="Purchase price per share"),
    account: str = typer.Option("default", help="Account name"),
    date: str = typer.Option(None, help="Date acquired (YYYY-MM-DD). Defaults to today."),
):
    """Record a stock purchase."""
    from datetime import datetime as dt

    from src.db.operations import add_holding, log_decision
    from src.db.schema import get_db

    ticker = ticker.upper()
    if date is None:
        date = dt.now().strftime("%Y-%m-%d")

    conn = get_db()
    holding_id = add_holding(
        conn,
        ticker=ticker,
        shares=shares,
        cost_basis=price,
        date_acquired=date,
        account=account,
    )
    log_decision(
        conn,
        ticker=ticker,
        action="BUY",
        price=price,
        shares=shares,
        reasoning=f"Bought {shares} shares at {_fmt_price(price, ticker)}",
    )

    console.print(
        f"[green]Recorded:[/green] {shares} shares of [bold]{ticker}[/bold] "
        f"at {_fmt_price(price, ticker)} (holding #{holding_id})"
    )


@app.command()
def sell(
    ticker: str = typer.Argument(help="Stock ticker (e.g., AAPL)"),
    shares: float = typer.Argument(help="Number of shares to sell"),
    price: float = typer.Argument(help="Sale price per share"),
):
    """Record a stock sale."""
    from src.db.operations import sell_holding
    from src.db.schema import get_db

    ticker = ticker.upper()
    conn = get_db()
    try:
        sell_holding(conn, ticker=ticker, shares=shares, price=price)
        console.print(
            f"[green]Sold:[/green] {shares} shares of"
            f" [bold]{ticker}[/bold] at {_fmt_price(price, ticker)}"
        )
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def watch(
    ticker: str = typer.Argument(help="Stock ticker to watch"),
):
    """Add ticker to watchlist."""
    from src.db.operations import add_to_watchlist, get_latest_analysis, get_watchlist
    from src.db.schema import get_db

    ticker = ticker.upper()
    conn = get_db()

    # Check if already on watchlist
    existing = [w for w in get_watchlist(conn) if w["ticker"] == ticker]
    if existing:
        console.print(f"[yellow]{ticker} is already on the watchlist.[/yellow]")
        return

    # Auto-populate buy_price from latest analysis if available
    buy_price = None
    latest = get_latest_analysis(conn, ticker)
    if latest and latest.get("buy_price"):
        buy_price = latest["buy_price"]

    add_to_watchlist(conn, ticker=ticker, buy_price=buy_price)
    if buy_price:
        console.print(
            f"[green]Added [bold]{ticker}[/bold] to watchlist "
            f"(buy price {_fmt_price(buy_price, ticker)} from latest analysis).[/green]"
        )
    else:
        console.print(f"[green]Added [bold]{ticker}[/bold] to watchlist.[/green]")


@app.command()
def history(
    ticker: str = typer.Argument(None, help="Filter by ticker (optional)"),
):
    """Show decision history."""
    from src.db.operations import get_decisions
    from src.db.schema import get_db

    conn = get_db()
    decisions = get_decisions(conn, ticker=ticker.upper() if ticker else None)

    if not decisions:
        msg = f"for {ticker.upper()}" if ticker else ""
        console.print(f"[dim]No decisions recorded {msg}.[/dim]")
        return

    table = Table(title="Decision History", show_header=True)
    table.add_column("Date", style="dim")
    table.add_column("Ticker", style="bold")
    table.add_column("Action")
    table.add_column("Price", justify="right")
    table.add_column("Shares", justify="right")
    table.add_column("Reasoning")

    for d in decisions:
        action_style = {"BUY": "green", "SELL": "red", "WATCH": "yellow", "PASS": "dim"}.get(
            d["action"], ""
        )
        table.add_row(
            d["created_at"] or "",
            d["ticker"],
            f"[{action_style}]{d['action']}[/{action_style}]",
            _fmt_price(d["price"], d["ticker"]) if d["price"] else "",
            f"{d['shares']:.2f}" if d["shares"] else "",
            d["reasoning"] or "",
        )

    console.print(table)


@app.command(name="watchlist-check")
def watchlist_check(
    allow_llm_price: bool = typer.Option(
        True,
        "--llm-price/--no-llm-price",
        help="Allow Claude web-search fallback if primary price sources fail.",
    ),
):
    """Check current prices for all watchlist items.

    Shows each ticker on the watchlist with its buy price (from the
    latest analysis) and the current market price, highlighting when
    a stock drops below the buy price.

    Designed to run as a scheduled task before market open.
    """
    from src.data.prices import get_price_data
    from src.db.operations import (
        get_watchlist,
        update_latest_analysis_price,
        update_watchlist_price,
    )
    from src.db.schema import get_db

    conn = get_db()
    watchlist = get_watchlist(conn)

    if not watchlist:
        console.print("[dim]Watchlist is empty. Add tickers with: owlfolio watch TICKER[/dim]")
        return

    table = Table(title="Watchlist — Price Check", show_header=True)
    table.add_column("Ticker", style="bold")
    table.add_column("Buy Price", justify="right")
    table.add_column("Current", justify="right")
    table.add_column("Gap", justify="right")
    table.add_column("Signal")

    for w in watchlist:
        ticker = w["ticker"]
        buy_price = w.get("buy_price")
        try:
            price_data = get_price_data(ticker, allow_llm_fallback=allow_llm_price)
            current = price_data.price if price_data.price and price_data.price > 0 else None
        except Exception:
            table.add_row(
                ticker,
                _fmt_price(buy_price, ticker) if buy_price else "-",
                "[yellow]N/A[/yellow]",
                "-",
                "-",
            )
            continue

        # Persist fresh price to watchlist and latest analysis record
        if current and current > 0:
            try:
                update_watchlist_price(conn, ticker, current)
                update_latest_analysis_price(conn, ticker, current)
            except Exception:
                pass  # best-effort persistence

        if current is None:
            gap_str = "-"
            signal = "-"
        elif buy_price and buy_price > 0:
            gap_pct = (current - buy_price) / buy_price * 100
            if gap_pct <= 0:
                signal = "[green bold]BUY ZONE[/green bold]"
            elif gap_pct <= 10:
                signal = "[yellow]Close[/yellow]"
            else:
                signal = "[dim]Above[/dim]"
            gap_str = f"{gap_pct:+.1f}%"
        else:
            gap_str = "-"
            signal = "-"

        table.add_row(
            ticker,
            _fmt_price(buy_price, ticker) if buy_price else "-",
            _fmt_price(current, ticker) if current is not None else "[yellow]N/A[/yellow]",
            gap_str,
            signal,
        )

    console.print(table)


@app.command(name="review-holdings")
def review_holdings_cmd(
    mode: str = typer.Option(
        "review",
        "--mode",
        "-m",
        help="Mode: news (news pulse), review (light quarterly), full (deep re-analysis)",
    ),
    thorough: bool = typer.Option(
        False,
        "--thorough",
        help="More thorough review (e.g. post-10Q with full filing analysis)",
    ),
):
    """Run a review across all portfolio holdings.

    Iterates over every holding and runs the appropriate addon or
    full re-analysis pipeline for each ticker.

    Modes:
      news    — Quick news pulse against saved thesis (~30s per ticker)
      review  — Light quarterly review vs earnings (~1-2 min per ticker)
      full    — Complete re-analysis with all specialists (~5 min per ticker)

    Use --thorough with 'review' mode for post-10Q analysis that includes
    full filing examination.

    Designed to run as a scheduled task (weekly news, monthly review,
    quarterly 10-Q review, annual full re-analysis).
    """
    from src.db.operations import get_holdings
    from src.db.schema import get_db
    from src.llm.provider import _run_async

    conn = get_db()
    holdings = get_holdings(conn)
    conn.close()

    if not holdings:
        console.print("[dim]No holdings to review.[/dim]")
        return

    valid_modes = {"news", "review", "full"}
    if mode not in valid_modes:
        console.print(f"[red]Invalid mode '{mode}'. Choose from: {', '.join(valid_modes)}[/red]")
        raise typer.Exit(1)

    tickers = [h["ticker"] for h in holdings]
    mode_label = {
        "news": "News Pulse",
        "review": "Quarterly Review" + (" (thorough)" if thorough else ""),
        "full": "Full Re-Analysis",
    }[mode]

    console.print(f"\n[bold]{mode_label}[/bold] — {len(tickers)} holdings")
    console.print(f"[dim]Tickers: {', '.join(tickers)}[/dim]\n")

    if mode == "full":
        # Full re-analysis uses the main analyze pipeline
        from src.operations.analysis import analyze as run_analyze

        for ticker in tickers:
            console.print(f"  [dim]Re-analyzing {ticker}...[/dim]")
            try:
                result = _run_async(run_analyze(ticker=ticker, company_name=ticker))
                decision = result.get("decision", "?")
                colors = {"BUY": "green", "WATCH": "yellow", "PASS": "red"}
                color = colors.get(decision, "white")
                console.print(f"  [green]✓[/green] {ticker}: [{color}]{decision}[/{color}]")
            except Exception as e:
                console.print(f"  [red]✗ {ticker}: {e}[/red]")
    else:
        # news or review — use the addon system
        from src.operations.analysis import run_addon

        addon_name = mode  # "news" or "review"
        for ticker in tickers:
            console.print(f"  [dim]Running {mode} for {ticker}...[/dim]")
            try:
                result = _run_async(run_addon(addon_name, ticker))
                status = result.get("status", "done")
                console.print(f"  [green]✓[/green] {ticker}: {status}")
            except Exception as e:
                console.print(f"  [red]✗ {ticker}: {e}[/red]")

    console.print(f"\n[green]Done.[/green] {mode_label} complete for {len(tickers)} holdings.")


@app.command()
def analyses(
    ticker: str = typer.Argument(None, help="Filter by ticker"),
    limit: int = typer.Option(10, "--limit", "-n", help="Number of results"),
):
    """View saved analysis results."""
    from src.db.operations import get_analyses
    from src.db.schema import get_db

    conn = get_db()
    results = get_analyses(conn, ticker=ticker.upper() if ticker else None, limit=limit)

    if not results:
        msg = f"for {ticker.upper()}" if ticker else ""
        console.print(
            f"[dim]No analyses saved {msg}. Run [bold]owlfolio analyze TICKER[/bold] first.[/dim]"
        )
        return

    table = Table(title="Saved Analyses", show_header=True)
    table.add_column("ID", style="dim", justify="right")
    table.add_column("Date", style="dim")
    table.add_column("Ticker", style="bold")
    table.add_column("Strategy")
    table.add_column("Decision")
    table.add_column("Buy Price", justify="right")
    table.add_column("Current", justify="right")
    table.add_column("Quality")

    # Fetch live prices for all unique tickers in one pass
    from src.data.prices import get_price_data

    tickers_seen: dict[str, float | None] = {}
    for a in results:
        t = a["ticker"]
        if t not in tickers_seen:
            live = get_price_data(t)
            tickers_seen[t] = live.price if live.price and live.price > 0 else None

    for a in results:
        decision = a["decision"] or "—"
        decision_style = {"BUY": "green", "WATCH": "yellow", "PASS": "red"}.get(decision, "dim")
        live_price = tickers_seen.get(a["ticker"]) or a["current_price"]
        table.add_row(
            str(a["id"]),
            (a["created_at"] or "")[:10],
            a["ticker"],
            a["strategy"] or "",
            f"[{decision_style}]{decision}[/{decision_style}]",
            _fmt_price(a["buy_price"], a["ticker"]) if a["buy_price"] else "",
            _fmt_price(live_price, a["ticker"]) if live_price else "",
            a["quality_tier"] or "",
        )

    console.print(table)


# ─── Candidate lists: agentic discovery + import + analyze ─────────


@app.command(name="find")
def find_cmd(
    n: int = typer.Option(15, "--count", "-n", help="Target number of candidates"),
    strategy_name: str = typer.Option(
        None,
        "--strategy",
        "-s",
        help="Strategy to use (default: active)",
    ),
    list_name: str = typer.Option(None, "--name", help="Save under this list name"),
    note: str = typer.Option("", "--note", help="One-line description for the list"),
    shariah: bool = typer.Option(False, "--shariah", help="Apply Shariah compliance pre-filter"),
):
    """Run the agentic discovery agent — slow, costly, on-vision.

    Reads the strategy's discovery brief and uses WebSearch + WebFetch
    to compile a candidate list. Persists to candidate_lists. Use
    `owlfolio analyze-list NAME` to deep-analyze the saved candidates.
    """
    from src.llm.provider import _run_async
    from src.operations.candidates import find_candidates

    _configure_logging()
    console.print("\n[bold]Running discovery agent...[/bold]")
    console.print("[dim]This is slow (3-10 min) and uses real API credits.[/dim]\n")

    try:
        result = _run_async(
            find_candidates(
                strategy_name=strategy_name,
                n=n,
                list_name=list_name,
                note=note,
                shariah=shariah,
            )
        )
    except Exception as e:
        console.print(f"[red]find failed: {e}[/red]")
        raise typer.Exit(1)

    console.print(
        f"[green]✓ Saved {result['inserted']} candidates as "
        f"list [bold]{result['list_name']}[/bold] (strategy: {result['strategy']})[/green]\n"
    )

    table = Table(title=f"Discovered candidates ({result['list_name']})", show_header=True)
    table.add_column("Ticker", style="bold")
    table.add_column("Company")
    table.add_column("Sector")
    table.add_column("Note", max_width=60)
    for c in result["candidates"]:
        table.add_row(
            c["ticker"],
            c.get("company_name", ""),
            c.get("sector", ""),
            c.get("note", ""),
        )
    console.print(table)
    console.print(f"\n[dim]Next: owlfolio analyze-list {result['list_name']}[/dim]")


@app.command(name="import")
def import_cmd(
    source: str = typer.Argument(help="CSV file path, plain text file, or inline ticker string"),
    list_name: str = typer.Option(..., "--name", help="Save under this list name"),
    strategy_name: str = typer.Option(None, "--strategy", "-s", help="Strategy this list targets"),
    note: str = typer.Option("", "--note", help="One-line description"),
    skip_validation: bool = typer.Option(
        False, "--no-validate", help="Skip yfinance ticker validation (offline / fast)"
    ),
):
    """Import a ticker list from CSV / text file / inline string.

    Examples:
        owlfolio import tickers.csv --name watch-q2
        owlfolio import "AAPL, MSFT, GOOGL" --name megacap
        owlfolio import dividend-aristocrats.txt --name aristocrats --strategy dividend-income
    """
    from src.operations.candidates import import_candidates

    _configure_logging()
    try:
        result = import_candidates(
            source=source,
            list_name=list_name,
            strategy_name=strategy_name,
            note=note,
            skip_validation=skip_validation,
        )
    except Exception as e:
        console.print(f"[red]import failed: {e}[/red]")
        raise typer.Exit(1)

    console.print(
        f"[green]✓ Imported {result['inserted']} tickers as "
        f"list [bold]{result['list_name']}[/bold][/green]"
    )
    if result["rejected"]:
        console.print(
            f"[yellow]Rejected ({len(result['rejected'])}): "
            f"{', '.join(result['rejected'][:10])}"
            f"{'...' if len(result['rejected']) > 10 else ''}"
            "[/yellow]"
        )
    console.print(f"[dim]Next: owlfolio analyze-list {result['list_name']}[/dim]")


@app.command(name="lists")
def lists_cmd():
    """Show all candidate lists."""
    from src.operations.candidates import list_lists

    lists = list_lists()
    if not lists:
        console.print(
            "[dim]No candidate lists yet. Use `owlfolio find` or `owlfolio import`.[/dim]"
        )
        return

    table = Table(title="Candidate Lists", show_header=True)
    table.add_column("Name", style="bold")
    table.add_column("Source")
    table.add_column("Strategy")
    table.add_column("Total", justify="right")
    table.add_column("Analyzed", justify="right")
    table.add_column("Created")
    for lst in lists:
        table.add_row(
            lst["name"],
            lst["source"],
            lst["strategy"] or "-",
            str(lst["total"]),
            str(lst["analyzed"] or 0),
            (lst["created_at"] or "")[:16],
        )
    console.print(table)


@app.command(name="list-show")
def list_show_cmd(
    name: str = typer.Argument(help="Candidate list name"),
):
    """Show all candidates in a list."""
    from src.operations.candidates import show_list

    try:
        data = show_list(name)
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)

    console.print(
        f"\n[bold]{data['name']}[/bold] "
        f"({data['source']} | strategy: {data.get('strategy') or '-'})"
    )
    if data.get("note"):
        console.print(f"[dim]{data['note']}[/dim]")

    table = Table(show_header=True)
    table.add_column("Ticker", style="bold")
    table.add_column("Company")
    table.add_column("Sector")
    table.add_column("Mkt Cap", justify="right")
    table.add_column("Price", justify="right")
    table.add_column("Status")
    table.add_column("Note", max_width=50)
    for c in data["candidates"]:
        mcap = c.get("market_cap")
        mcap_str = _fmt_mcap(mcap, c["ticker"]) if mcap else "-"
        price = c.get("current_price")
        price_str = _fmt_price(price, c["ticker"]) if price else "-"
        status = "[green]✓[/green]" if c.get("analyzed") else "[dim]pending[/dim]"
        table.add_row(
            c["ticker"],
            c.get("company_name", ""),
            c.get("sector", ""),
            mcap_str,
            price_str,
            status,
            c.get("note", ""),
        )
    console.print(table)


@app.command(name="list-delete")
def list_delete_cmd(
    name: str = typer.Argument(help="Candidate list name"),
):
    """Delete a candidate list (and all its candidates)."""
    from src.operations.candidates import delete_list

    if not delete_list(name):
        console.print(f"[red]list {name!r} not found[/red]")
        raise typer.Exit(1)
    console.print(f"[green]✓ deleted list {name!r}[/green]")


@app.command(name="analyze-list")
def analyze_list_cmd(
    name: str = typer.Argument("", help="Candidate list name (optional with --auto)"),
    strategy_name: str = typer.Option(None, "--strategy", "-s", help="Override strategy"),
    concurrency: int = typer.Option(
        2,
        "--concurrency",
        "-j",
        help="Max concurrent analyses (default 2; raises rate-limit risk if >5)",
    ),
    redo: bool = typer.Option(False, "--redo", help="Re-analyze candidates already analyzed"),
    shariah: bool = typer.Option(False, "--shariah", help="Also run Shariah compliance"),
    next_n: int = typer.Option(
        0, "--next", "-n", help="Only analyze the next N unprocessed candidates (0 = all)"
    ),
    auto: bool = typer.Option(
        False, "--auto", help="Auto-select the most recent list (for scheduled tasks)"
    ),
    screened_only: bool = typer.Option(
        False, "--screened-only", help="Only analyze candidates that passed quick screen"
    ),
):
    """Run the analyze pipeline against every candidate in a list.

    Concurrency is capped (default 2) because each ticker spawns 3-5
    specialist subagents — without a cap a 25-ticker list balloons to
    75-125 in-flight requests. Bump it carefully.
    """
    from src.llm.provider import _run_async
    from src.operations.candidates import analyze_list

    # Auto-select most recent list if --auto is set
    if auto and name == "":
        from src.operations.candidates import list_lists

        lists = list_lists()
        if not lists:
            console.print("[red]No candidate lists found.[/red]")
            raise typer.Exit(1)
        name = lists[0]["name"]  # lists sorted by created_at DESC — [0] is newest
        console.print(f"[dim]Auto-selected list: {name}[/dim]")

    if not name:
        console.print("[red]Please provide a list name, or use --auto.[/red]")
        raise typer.Exit(1)

    _configure_logging()
    console.print(f"\n[bold]Analyzing list {name!r}[/bold] (concurrency={concurrency})")
    if next_n:
        console.print(f"[dim]Processing next {next_n} unanalyzed candidates.[/dim]\n")
    else:
        console.print("[dim]Each ticker takes ~2-5 min; this will run for a while.[/dim]\n")

    try:
        result = _run_async(
            analyze_list(
                name=name,
                strategy_name=strategy_name,
                concurrency=concurrency,
                skip_analyzed=not redo,
                shariah=shariah,
                max_candidates=next_n if next_n else None,
                screened_only=screened_only,
            )
        )
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]analyze-list failed: {e}[/red]")
        raise typer.Exit(1)

    if result["skipped"]:
        console.print(
            f"[dim]Skipped {len(result['skipped'])} already-analyzed (use --redo to re-run)[/dim]"
        )

    if result["results"]:
        table = Table(title=f"Analyses ({name})", show_header=True)
        table.add_column("Ticker", style="bold")
        table.add_column("Decision")
        table.add_column("Confidence", justify="right")
        table.add_column("Tier")
        table.add_column("Score", justify="right")
        table.add_column("Fair Value", justify="right")
        table.add_column("Price", justify="right")
        for r in result["results"]:
            colors = {"BUY": "green", "WATCH": "yellow", "PASS": "red"}
            color = colors.get(r["decision"], "white")
            fv = _fmt_price(r["fair_value"], r["ticker"]) if r["fair_value"] else "-"
            cp = _fmt_price(r["current_price"], r["ticker"]) if r["current_price"] else "-"
            table.add_row(
                r["ticker"],
                f"[{color}]{r['decision']}[/{color}]",
                f"{r['confidence']:.0%}",
                r["quality_tier"],
                f"{r['weighted_score']:.1f}",
                fv,
                cp,
            )
        console.print(table)

    if result["errors"]:
        console.print(f"\n[red]Errors ({len(result['errors'])}):[/red]")
        for e in result["errors"]:
            console.print(f"  [red]{e['ticker']}: {e['error']}[/red]")


@app.command(name="tasks")
def tasks_cmd():
    """View scheduled tasks."""
    from src.db.operations import get_scheduled_tasks
    from src.db.schema import get_db

    conn = get_db()
    tasks = get_scheduled_tasks(conn)

    if not tasks:
        console.print("[dim]No scheduled tasks. Use 'owlfolio schedule' to create one.[/dim]")
        return

    table = Table(title="Scheduled Tasks", show_header=True)
    table.add_column("ID", justify="right", style="dim")
    table.add_column("Name", style="bold")
    table.add_column("Command")
    table.add_column("Schedule")
    table.add_column("TZ")
    table.add_column("Enabled", justify="center")
    table.add_column("Last Run")

    for t in tasks:
        enabled = "[green]Yes[/green]" if t["enabled"] else "[red]No[/red]"
        last_run = t["last_run"] or "Never"
        table.add_row(
            str(t["id"]),
            t["name"],
            t["command"][:40],
            t["schedule"],
            t["timezone"],
            enabled,
            last_run,
        )

    console.print(table)


@app.command()
def schedule(
    name: str = typer.Argument(help="Task name"),
    command: str = typer.Argument(help="Command to run"),
    cron: str = typer.Argument(help="Cron expression"),
    tz: str = typer.Option("Asia/Dubai", "--tz", help="Timezone"),
    description: str = typer.Option("", "--desc", help="Description"),
):
    """Schedule a recurring task."""
    from src.db.operations import add_scheduled_task
    from src.db.schema import get_db

    conn = get_db()
    task_id = add_scheduled_task(
        conn, name=name, command=command, schedule=cron, timezone=tz, description=description
    )
    console.print(f"[green]Scheduled task '{name}' (ID: {task_id})[/green]")
    console.print(f"  Command:  {command}")
    console.print(f"  Schedule: {cron}")
    console.print(f"  Timezone: {tz}")


@app.command()
def unschedule(
    task_id: int = typer.Argument(help="Task ID to delete"),
):
    """Delete a scheduled task."""
    from src.db.operations import delete_scheduled_task
    from src.db.schema import get_db

    conn = get_db()
    delete_scheduled_task(conn, task_id)
    console.print(f"[green]Task {task_id} deleted.[/green]")


@app.command(name="create-strategy")
def create_strategy(
    name: str = typer.Argument(help="Strategy name (lowercase, hyphens)"),
    yaml_file: str = typer.Option(None, "--from-file", help="Read YAML from a file"),
):
    """Create a new strategy from YAML input."""
    import re
    import sys

    from src.strategy.loader import load_strategy

    # Reject path traversal
    if ".." in name or "/" in name or "\\" in name:
        console.print("[red]Error: Strategy name cannot contain '..', '/', or '\\\\'[/red]")
        raise typer.Exit(1)

    # Validate name format
    if not re.match(r"^[a-z0-9][a-z0-9-]*$", name):
        console.print(
            "[red]Error: Strategy name must be lowercase letters, numbers, and hyphens only.[/red]"
        )
        raise typer.Exit(1)

    # Read YAML content
    if yaml_file:
        yaml_path = Path(yaml_file)
        if not yaml_path.exists():
            console.print(f"[red]Error: File not found: {yaml_file}[/red]")
            raise typer.Exit(1)
        yaml_content = yaml_path.read_text()
    else:
        # Read from stdin
        if sys.stdin.isatty():
            console.print("[red]Error: No YAML input. Pipe YAML to stdin or use --from-file.[/red]")
            raise typer.Exit(1)
        yaml_content = sys.stdin.read()

    if not yaml_content.strip():
        console.print("[red]Error: Empty YAML input.[/red]")
        raise typer.Exit(1)

    # Write to a temp file and validate through load_strategy
    target = Path("strategies") / f"{name}.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)

    # Write the content first so load_strategy can read it
    target.write_text(yaml_content)

    try:
        load_strategy(target)
    except Exception as e:
        # Validation failed — remove the file
        target.unlink(missing_ok=True)
        console.print(f"[red]Error: Invalid strategy YAML — {e}[/red]")
        raise typer.Exit(1)

    console.print(f"Strategy '{name}' created at strategies/{name}.yaml")


PRESET_STRATEGIES = {
    "buffett-munger",
    "growth",
    "garp",
    "100-bagger",
    "quality-compounder",
    "dividend-income",
    "deep-value",
}


@app.command(name="delete-strategy")
def delete_strategy(
    name: str = typer.Argument(help="Strategy name to delete"),
):
    """Delete a custom strategy (presets cannot be deleted)."""
    if name in PRESET_STRATEGIES:
        console.print(f"[red]Error: Cannot delete preset strategy '{name}'.[/red]")
        raise typer.Exit(1)

    if ".." in name or "/" in name or "\\" in name:
        console.print("[red]Error: Invalid strategy name.[/red]")
        raise typer.Exit(1)

    target = Path("strategies") / f"{name}.yaml"
    if not target.exists():
        console.print(f"[red]Error: Strategy not found: {target}[/red]")
        raise typer.Exit(1)

    target.unlink()
    console.print(f"Strategy '{name}' deleted.")


@app.command()
def alerts():
    """Show recent task results and alerts."""
    from src.db.operations import get_unread_alerts
    from src.db.schema import get_db

    conn = get_db()
    try:
        unread = get_unread_alerts(conn)

        if unread:
            console.print(f"[yellow]{len(unread)} unread alert(s):[/yellow]")
            for a in unread:
                console.print(f"  [{a['type']}] {a['message'][:100]}")
        else:
            # Fall back to showing recent task results
            from src.db.operations import get_scheduled_tasks

            tasks = get_scheduled_tasks(conn, enabled_only=False)
            has_alerts = False

            for task in tasks:
                if task.get("last_result") and task.get("last_run"):
                    console.print(
                        f"  [{task['name']}] {task['last_run'][:16]}: {task['last_result'][:100]}"
                    )
                    has_alerts = True

            if not has_alerts:
                console.print("[dim]No recent alerts.[/dim]")
    finally:
        conn.close()


@app.command(name="daemon")
def daemon_cmd(
    poll: int = typer.Option(60, "--poll", help="Poll interval in seconds"),
):
    """Run Owlfolio as a background daemon (executes scheduled tasks)."""
    from src.daemon import run_daemon

    _configure_logging()
    console.print("  [bold]Owlfolio daemon starting...[/bold]")
    console.print(f"  [dim]Poll interval: {poll}s. Ctrl+C to stop.[/dim]")
    run_daemon(poll_interval=poll)


@app.command()
def compare(
    ticker1: str = typer.Argument(help="First ticker"),
    ticker2: str = typer.Argument(help="Second ticker"),
):
    """Compare two stocks using saved analysis results."""
    _configure_logging()
    ticker1 = ticker1.upper()
    ticker2 = ticker2.upper()

    from src.db.operations import get_latest_analysis
    from src.db.schema import get_db

    console.print(f"\n[bold]Comparing {ticker1} vs {ticker2}...[/bold]\n")

    conn = get_db()
    a1 = get_latest_analysis(conn, ticker1)
    a2 = get_latest_analysis(conn, ticker2)
    conn.close()

    if not a1 and not a2:
        console.print("  [yellow]No saved analyses for either ticker.[/yellow]")
        console.print(f"  Run 'owlfolio analyze {ticker1}' and 'owlfolio analyze {ticker2}' first.")
        return

    table = Table(title=f"{ticker1} vs {ticker2}", show_header=True)
    table.add_column("Metric", style="bold")
    table.add_column(ticker1, justify="right")
    table.add_column(ticker2, justify="right")

    def _val(a, key, fmt="str", tkr=""):
        if not a:
            return "[dim]Not analyzed[/dim]"
        val = a.get(key)
        if val is None:
            return "—"
        if fmt == "dollar":
            return _fmt_price(val, tkr)
        if fmt == "score":
            return f"{val}/5"
        return str(val)

    table.add_row("Strategy", _val(a1, "strategy"), _val(a2, "strategy"))
    table.add_row("Decision", _val(a1, "decision"), _val(a2, "decision"))
    table.add_row("Quality Tier", _val(a1, "quality_tier"), _val(a2, "quality_tier"))
    table.add_row("Score", _val(a1, "weighted_score", "score"), _val(a2, "weighted_score", "score"))
    table.add_row(
        "Fair Value",
        _val(a1, "buy_price", "dollar", ticker1),
        _val(a2, "buy_price", "dollar", ticker2),
    )
    table.add_row(
        "Price at Analysis",
        _val(a1, "current_price", "dollar", ticker1),
        _val(a2, "current_price", "dollar", ticker2),
    )
    table.add_row(
        "Analyzed",
        _val(a1, "created_at")[:10] if a1 else "—",
        _val(a2, "created_at")[:10] if a2 else "—",
    )

    console.print(table)

    # Show thesis snippets
    if a1 and a1.get("thesis"):
        console.print(f"\n[bold]{ticker1} Thesis:[/bold] {a1['thesis'][:200]}...")
    if a2 and a2.get("thesis"):
        console.print(f"\n[bold]{ticker2} Thesis:[/bold] {a2['thesis'][:200]}...")

    if not a1:
        console.print(
            f"\n  [dim]{ticker1} hasn't been analyzed yet. Run 'owlfolio analyze {ticker1}'[/dim]"
        )
    if not a2:
        console.print(
            f"\n  [dim]{ticker2} hasn't been analyzed yet. Run 'owlfolio analyze {ticker2}'[/dim]"
        )

    console.print()


@app.command()
def snapshot():
    """Take a portfolio snapshot for performance tracking."""
    import json as json_mod

    from src.data.prices import get_price_data
    from src.db.operations import get_holdings, save_snapshot
    from src.db.schema import get_db

    conn = get_db()
    holdings = get_holdings(conn)

    if not holdings:
        console.print("[dim]No holdings to snapshot.[/dim]")
        return

    total_cost = 0.0
    total_value = 0.0
    holdings_data = []

    for h in holdings:
        try:
            price_data = get_price_data(h["ticker"])
            current = price_data.price
        except Exception:
            current = 0.0

        cost = h["shares"] * h["cost_basis"]
        value = h["shares"] * current
        total_cost += cost
        total_value += value

        holdings_data.append(
            {
                "ticker": h["ticker"],
                "shares": h["shares"],
                "price": current,
                "value": round(value, 2),
            }
        )

    # Fetch SPY as benchmark
    benchmark_value = None
    try:
        spy = get_price_data("SPY")
        benchmark_value = spy.price
    except Exception:
        pass

    snapshot_id = save_snapshot(
        conn,
        total_value=total_value,
        total_cost=total_cost,
        cash=0.0,
        holdings_json=json_mod.dumps(holdings_data),
        benchmark_value=benchmark_value,
    )

    pnl = total_value - total_cost
    pnl_pct = (pnl / total_cost * 100) if total_cost > 0 else 0
    color = "green" if pnl >= 0 else "red"

    console.print(f"\n[bold]Snapshot saved (ID: {snapshot_id})[/bold]")
    console.print(f"  Total Value: {_fmt_price(total_value)}")
    console.print(f"  Total Cost:  {_fmt_price(total_cost)}")
    console.print(f"  P&L: [{color}]{_fmt_price(pnl)} ({pnl_pct:+.1f}%)[/{color}]")
    if benchmark_value:
        console.print(f"  SPY: {_fmt_price(benchmark_value, 'SPY')}")
    console.print(f"  Holdings: {len(holdings_data)}")
    console.print()


@app.command()
def performance():
    """Show portfolio performance over time."""
    from src.db.operations import get_snapshots
    from src.db.schema import get_db

    conn = get_db()
    snapshots = get_snapshots(conn, limit=12)

    if not snapshots:
        console.print("[dim]No snapshots yet. Run 'owlfolio snapshot' to take one.[/dim]")
        return

    # Reverse so oldest is first for display
    snapshots = list(reversed(snapshots))

    table = Table(title="Portfolio Performance", show_header=True)
    table.add_column("Date", style="dim")
    table.add_column("Total Value", justify="right")
    table.add_column("Total Cost", justify="right")
    table.add_column("P&L", justify="right")
    table.add_column("P&L %", justify="right")
    table.add_column("Change", justify="right")
    table.add_column("SPY", justify="right")

    prev_value = None
    for s in snapshots:
        pnl = s["total_value"] - s["total_cost"]
        pnl_pct = (pnl / s["total_cost"] * 100) if s["total_cost"] > 0 else 0
        color = "green" if pnl >= 0 else "red"

        # Change since last snapshot
        if prev_value is not None and prev_value > 0:
            change = (s["total_value"] - prev_value) / prev_value * 100
            change_color = "green" if change >= 0 else "red"
            change_str = f"[{change_color}]{change:+.1f}%[/{change_color}]"
        else:
            change_str = "--"

        spy_str = _fmt_price(s["benchmark_value"], "SPY") if s.get("benchmark_value") else "--"

        table.add_row(
            (s["created_at"] or "")[:10],
            _fmt_price(s["total_value"]),
            _fmt_price(s["total_cost"]),
            f"[{color}]{_fmt_price(pnl)}[/{color}]",
            f"[{color}]{pnl_pct:+.1f}%[/{color}]",
            change_str,
            spy_str,
        )

        prev_value = s["total_value"]

    console.print(table)


@app.command()
def remember(
    content: str = typer.Argument(help="What to remember"),
    category: str = typer.Option(
        "preference",
        "--category",
        "-c",
        help="Category: preference, context, observation, decision_context",
    ),
    ticker: str = typer.Option(None, "--ticker", "-t", help="Associated ticker"),
):
    """Save something to Owlfolio's memory."""
    from src.db.operations import add_memory

    add_memory(category, content, ticker)
    console.print(f"  [green]\u2713[/green] Remembered: {content[:80]}")


@app.command()
def memories(
    category: str = typer.Option(None, "--category", "-c", help="Filter by category"),
    ticker: str = typer.Option(None, "--ticker", "-t", help="Filter by ticker"),
):
    """View stored memories."""
    from src.db.operations import get_memories

    mems = get_memories(category=category, ticker=ticker)

    if not mems:
        console.print("[dim]No memories stored. Use 'owlfolio remember' to add one.[/dim]")
        return

    table = Table(title="Memories", show_header=True)
    table.add_column("ID", justify="right", style="dim")
    table.add_column("Category", style="bold")
    table.add_column("Content")
    table.add_column("Ticker")
    table.add_column("Date", style="dim")

    for m in mems:
        table.add_row(
            str(m["id"]),
            m["category"],
            m["content"][:80],
            m.get("ticker") or "",
            (m["created_at"] or "")[:10],
        )

    console.print(table)


@app.command()
def forget(
    memory_id: int = typer.Argument(help="Memory ID to forget"),
):
    """Delete a memory."""
    from src.db.operations import delete_memory

    delete_memory(memory_id)
    console.print(f"  [green]\u2713[/green] Memory {memory_id} forgotten.")


@app.command()
def chat():
    """Chat with your portfolio manager."""
    from src.agent.core import run_chat

    _configure_logging()
    run_chat()


@app.command(name="shariah")
def shariah_cmd(
    ticker: str = typer.Argument(help="Stock ticker to check"),
):
    """Quick Shariah compliance check — runs ONLY the Shariah specialist.

    Standalone addon path: ~1 minute, one specialist subagent, persists
    as a `#NN` audit row with `decision='N/A'`. Use this when you only
    want the Shariah verdict; use `owlfolio analyze TICKER --shariah`
    if you also want the full strategy analysis.
    """
    from src.llm.provider import _run_async
    from src.operations.analysis import run_addon

    _configure_logging()
    console.print(f"\n[dim]Checking Shariah compliance for {ticker.upper()}...[/dim]")

    try:
        result = _run_async(run_addon("shariah", ticker))
    except KeyError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Shariah check failed: {e}[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold]Shariah Compliance: {result['ticker']}[/bold]")
    console.print(f"  {result['summary']}")
    for finding in result.get("key_findings") or []:
        console.print(f"  \u2022 {finding}")
    for flag in result.get("flags") or []:
        color = "green" if "GREEN" in flag else "red" if "RED" in flag else "yellow"
        console.print(f"  [{color}]{flag}[/{color}]")
    console.print(f"\n[dim]Saved as analysis #{result['analysis_id']}[/dim]")


@app.command(name="review")
def review_cmd(
    ticker: str = typer.Argument(help="Stock ticker to review"),
):
    """Light quarterly review — checks latest earnings against saved thesis.

    Strategy-aware addon: compares the most recent quarterly filing to your
    last full analysis. Flags whether the thesis is intact, weakening, or
    broken. Much faster than a full re-analysis (~1-2 min vs ~5 min).

    Use `owlfolio analyze` for a full deep-dive; use this for quarterly
    check-ins between annual analyses.
    """
    from src.llm.provider import _run_async
    from src.operations.analysis import run_addon

    _configure_logging()
    console.print(f"\n[dim]Running quarterly review for {ticker.upper()}...[/dim]")

    try:
        result = _run_async(run_addon("review", ticker))
    except KeyError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Review failed: {e}[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold]Quarterly Review: {result['ticker']}[/bold]")
    console.print(f"  {result['summary']}")
    for finding in result.get("key_findings") or []:
        console.print(f"  \u2022 {finding}")
    for flag in result.get("flags") or []:
        color = "green" if "GREEN" in flag else "red" if "RED" in flag else "yellow"
        console.print(f"  [{color}]{flag}[/{color}]")
    console.print(f"\n[dim]Saved as analysis #{result['analysis_id']}[/dim]")


@app.command(name="news")
def news_cmd(
    ticker: str = typer.Argument(help="Stock ticker to check"),
):
    """Quick news pulse — what's changed since the last analysis?

    Strategy-aware addon: scans recent news and scores each finding
    against your saved thesis, bull/bear case, and key risks. ~30 seconds.

    Use this for ad-hoc checks like "did anything break?" without
    spinning up the full specialist pipeline.
    """
    from src.llm.provider import _run_async
    from src.operations.analysis import run_addon

    _configure_logging()
    console.print(f"\n[dim]Checking news pulse for {ticker.upper()}...[/dim]")

    try:
        result = _run_async(run_addon("news", ticker))
    except KeyError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]News pulse failed: {e}[/red]")
        raise typer.Exit(1)

    console.print(f"\n[bold]News Pulse: {result['ticker']}[/bold]")
    console.print(f"  {result['summary']}")
    for finding in result.get("key_findings") or []:
        console.print(f"  \u2022 {finding}")
    for flag in result.get("flags") or []:
        color = "green" if "GREEN" in flag else "red" if "RED" in flag else "yellow"
        console.print(f"  [{color}]{flag}[/{color}]")
    console.print(f"\n[dim]Saved as analysis #{result['analysis_id']}[/dim]")


SERVE_PID_FILE = Path("data/serve.pid")


def _read_serve_pid() -> int | None:
    """Return the PID written by the most recent foreground `serve`, if alive."""
    if not SERVE_PID_FILE.exists():
        return None
    try:
        pid = int(SERVE_PID_FILE.read_text().strip())
    except (ValueError, OSError):
        return None
    # Probe whether the process is still alive
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return None
    return pid


def _write_serve_pid(pid: int) -> None:
    SERVE_PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    SERVE_PID_FILE.write_text(str(pid))


def _stop_running_serve(timeout: float = 5.0) -> int:
    """Stop any running `owlfolio serve` instance.

    Tries the recorded PID file first (clean SIGTERM, then SIGKILL on timeout),
    falls back to a targeted pkill if the PID file is missing or stale.
    Returns the number of processes killed.
    """
    import signal
    import subprocess
    import time

    killed = 0
    pid = _read_serve_pid()
    if pid is not None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        else:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            killed += 1
        try:
            SERVE_PID_FILE.unlink()
        except FileNotFoundError:
            pass

    # Fallback / sweep: anything still running under our launcher
    try:
        result = subprocess.run(
            ["pgrep", "-f", "src.main serve"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        for line in result.stdout.split():
            try:
                stray = int(line)
            except ValueError:
                continue
            if stray == os.getpid():
                continue
            try:
                os.kill(stray, signal.SIGTERM)
                killed += 1
            except ProcessLookupError:
                pass
    except Exception:
        pass

    return killed


@app.command()
def serve(
    port: int = typer.Option(8000, "--port", "-p", help="Port number"),
    host: str = typer.Option("127.0.0.1", "--host", help="Host to bind"),
    restart: bool = typer.Option(
        False,
        "--restart",
        help="Stop any running serve instance and start a fresh one (refreshes code).",
    ),
    stop: bool = typer.Option(
        False,
        "--stop",
        help="Stop the running serve instance and exit (don't start a new one).",
    ),
    allow_public: bool = typer.Option(
        False,
        "--allow-public",
        help="Required when binding to a non-loopback host (e.g. 0.0.0.0). "
        "The chat agent has full Bash — binding to all interfaces exposes "
        "that to anyone reachable. This flag is the explicit acknowledgement.",
    ),
):
    """Launch the Owlfolio web interface.

    Runs directly on the host. Specialists run in-process.

    Use `--restart` to restart. Use `--stop` to shut down.
    """
    import uvicorn

    _configure_logging()

    if stop or restart:
        n = _stop_running_serve()
        if n:
            console.print(f"  [dim]Stopped {n} running serve instance(s).[/dim]")
        elif stop:
            console.print("  [dim]No running serve instance found.[/dim]")
        if stop:
            return

    # Non-loopback host in native mode is the path that puts a chat agent
    # with full Bash on the wire. Require explicit --allow-public so it
    # can't happen by accidental flag muscle-memory ("oh I'll just type
    # --host 0.0.0.0 like every other dev tool").
    is_loopback = host in ("127.0.0.1", "localhost", "::1")
    if not is_loopback and not allow_public:
        console.print(
            f"[red]Refusing to bind serve to {host}.[/red]\n\n"
            f"The chat agent has full Bash, Read, Write, and shell access.\n"
            f"Binding to a non-loopback interface exposes that to anyone who\n"
            f"can reach the port — including via SSRF from a prompt-injected\n"
            f"web page.\n\n"
            f"You have two options:\n"
            f"  1. [bold]Stay loopback-only[/bold]: omit --host (defaults to 127.0.0.1)\n"
            f"  2. [bold]Override[/bold]: re-run with"
            f" [bold]--allow-public[/bold] if you understand\n"
            f"     the risk and have an external boundary (Tailscale, SSH tunnel,\n"
            f"     reverse proxy with auth) in front. NEVER on a public IP.\n\n"
            f"See docs/ARCHITECTURE.md → Security Model."
        )
        raise typer.Exit(2)

    if not is_loopback:
        console.print(
            f"[yellow]⚠ Binding native serve to {host} (--allow-public set).[/yellow]\n"
            f"  This exposes a chat agent with full Bash to anyone who can\n"
            f"  reach the port. Make sure there's an auth boundary in front\n"
            f"  (Tailscale, SSH tunnel, or reverse proxy).\n"
            f"  See docs/ARCHITECTURE.md → Security Model.\n"
        )

    _write_serve_pid(os.getpid())
    console.print("\n  \U0001f989 Owlfolio Web UI")
    console.print(f"  [dim]http://{host}:{port}[/dim]")
    console.print(f"  [dim]pid {os.getpid()} (data/serve.pid)[/dim]\n")
    try:
        uvicorn.run("src.web.app:app", host=host, port=port, reload=False)
    finally:
        if _read_serve_pid() == os.getpid():
            try:
                SERVE_PID_FILE.unlink()
            except FileNotFoundError:
                pass


@app.command(name="screen")
def screen_cmd(
    ticker: str = typer.Argument("", help="Ticker to screen (or use --auto)"),
    list_name: str = typer.Option("", "--list", "-l", help="Screen all unscreened in this list"),
    auto: bool = typer.Option(False, "--auto", help="Auto-select most recent list"),
    concurrency: int = typer.Option(3, "--concurrency", "-j", help="Max concurrent screens"),
):
    """Quick screen candidates — lightweight single-agent evaluation.

    Evaluates candidates from the active strategy's perspective.
    Much faster and cheaper than a full deep dive.
    """
    from src.llm.provider import _run_async

    _configure_logging()

    if ticker and ticker != "":
        # Single ticker mode
        from src.operations.screening import screen_candidate
        from src.operations.strategies import get_active_strategy

        strategy = get_active_strategy()
        console.print(f"\n[bold]Quick screening {ticker}...[/bold]")
        result = _run_async(
            screen_candidate(
                ticker,
                strategy.get("description", "Value investing"),
                strategy.get("name", "unknown"),
            )
        )
        status = "[green]PASS[/green]" if result.get("pass") else "[red]FAIL[/red]"
        score = result.get("score", 0)
        console.print(f"\n  Result: {status} ({score}/5)")
        console.print(f"  {result.get('reasoning', 'No reasoning')}")
        if result.get("key_strengths"):
            console.print(f"  Strengths: {', '.join(result['key_strengths'])}")
        if result.get("key_concerns"):
            console.print(f"  Concerns: {', '.join(result['key_concerns'])}")
        return

    # List mode
    from src.operations.screening import screen_list

    name_arg = list_name if list_name else None
    if not name_arg and not auto:
        console.print("[red]Provide a ticker, --list NAME, or --auto.[/red]")
        raise typer.Exit(1)

    console.print("\n[bold]Quick Screen — evaluating candidates...[/bold]")
    result = _run_async(screen_list(list_name=name_arg, concurrency=concurrency))

    if result.get("error"):
        console.print(f"[red]{result['error_detail']}[/red]")
        raise typer.Exit(1)

    table = Table(title=f"Quick Screen: {result.get('list_name', '?')}")
    table.add_column("Ticker", style="bold")
    table.add_column("Result")
    table.add_column("Score", justify="right")
    table.add_column("Reasoning")

    for r in result.get("results", []):
        status = "[green]PASS[/green]" if r["pass"] else "[red]FAIL[/red]"
        table.add_row(r["ticker"], status, f"{r['score']}/5", r["reasoning"][:80])

    console.print(table)
    console.print(
        f"\n  Screened: {result['screened']}  |  "
        f"[green]Passed: {result['passed']}[/green]  |  "
        f"[red]Failed: {result['failed']}[/red]"
    )
    if result["passed"] > 0:
        console.print("\n[dim]Next: owlfolio analyze-list --auto --screened-only[/dim]")


if __name__ == "__main__":
    app()
