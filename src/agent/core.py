"""Owlfolio — interactive investment agent.

Uses Claude Agent SDK for multi-turn conversation with tool access.
Runs as `owlfolio chat` in the CLI.
"""

import asyncio
import os
import sqlite3
from pathlib import Path

import yaml
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
)
from rich.console import Console

console = Console()

OWL_BANNER = """\
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣶⣶⣶⣶⣦⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢦⣤⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣤⣤⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣿⠟⠁⢀⣈⠙⢿⣿⣿⣿⠟⠁⢀⣈⠙⢿⣿⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⠀⢻⣿⡿⠂⣸⣿⣿⣿⠀⢻⣿⡿⠀⣸⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣷⣤⣄⣤⣴⣿⠁⠀⣻⣷⣤⣄⣤⣴⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⣿⣧⢠⣿⣿⣿⣿⣿⣿⣿⣿⣝⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⠟⣭⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣻⣻⣿⣿⠇⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⡀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠿⢟⠿⢿⣿⡄⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡄⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡿⡿⢿⣿⣿⣷⡈⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣾⣷⣾⣿⣿⣷⣄⠙⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣮⣶⣭⣭⣛⣽⣿⣿⣦⣈⠙⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢷⣭⣯⣻⣝⣛⣿⣿⣿⣿⣶⣤⣉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⠀
⠀⠀⠀⠀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣛⣛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣤⣉⡛⠿⣿⣿⣿⣿⣿⣿⣇⠀
⠀⠀⠀⠀⠈⠙⠷⣶⣤⣄⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⡿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣯⣽⣿⣿⣿⣿⡄
⠀⠀⠀⠀⠀⠰⣄⠀⣀⠉⠉⠛⠛⠷⠶⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡏⠙⢿⣧
⠀⠀⠀⠘⠛⠓⢉⡄⡹⠆⠀⠀⠀⠀⠀⠉⠛⠿⢷⣶⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣿⣿⣿⡏⠛⠛⠛⠛⠛⠊⢿⣿⣿⠀⠀⠙
⠀⠀⠀⠀⠀⠀⠉⠛⠋⠢⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⢹⣿⣷⣦⣄⣀⡀⠀⠀⢀⣀⣼⣿⣿⣿⡿⠁⠀⠀⠀⠀⠀⠀⠈⢻⣿⡀⠀⠀
⠈⠉⠙⠒⠲⠶⠶⢶⣶⣤⣬⣽⣶⣦⣤⣤⣤⣶⣶⣿⡿⠿⠿⠟⠛⠿⠿⠏⣴⣿⣿⠟⣛⣛⣋⣀⣀⡀⠀⠀⡀⠀⠀⠀⠀⠹⡇⠀⠀
⠀⠀⠀⠀⢀⣠⠶⠛⠋⠉⠉⠁⠀⠈⠉⠉⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠈⢏⠈⡏⠈⠛⠛⠻⠿⢿⣿⣿⣿⣿⣿⣶⣦⣤⣤⠑⠀⠀
⠀⠀⠀⠐⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠛⠻⠿⣿⡇⠀⠀⠀"""


def _format_tool_use(block) -> str:
    """Format a tool use block for display."""
    name = getattr(block, "name", "tool")
    inp = getattr(block, "input", {})
    if not isinstance(inp, dict):
        return name

    # Bash — show the command
    if name == "Bash":
        cmd = inp.get("command", "")
        return f"Bash: {cmd[:100]}" if cmd else "Bash"

    # Read — show the file path
    if name == "Read":
        path = inp.get("file_path", "")
        return f"Read: {path}" if path else "Read"

    # Edit — show the file
    if name == "Edit":
        path = inp.get("file_path", "")
        return f"Edit: {path}" if path else "Edit"

    # Write — show the file
    if name == "Write":
        path = inp.get("file_path", "")
        return f"Write: {path}" if path else "Write"

    # Grep — show the pattern
    if name == "Grep":
        pattern = inp.get("pattern", "")
        path = inp.get("path", "")
        return f"Grep: '{pattern}' in {path}" if pattern else "Grep"

    # Glob — show the pattern
    if name == "Glob":
        pattern = inp.get("pattern", "")
        return f"Glob: {pattern}" if pattern else "Glob"

    # WebSearch
    if name == "WebSearch":
        query = inp.get("query", "")
        return f"Search: {query[:80]}" if query else "WebSearch"

    # Fallback — show name + first value
    first_val = next((str(v)[:60] for v in inp.values() if v), "")
    return f"{name}: {first_val}" if first_val else name


def _resolve_project_dir() -> Path:
    """Resolve project root: OWLFOLIO_PROJECT_DIR env > cwd > __file__."""
    explicit = os.environ.get("OWLFOLIO_PROJECT_DIR")
    if explicit:
        p = Path(explicit).resolve()
        if p.exists():
            return p
    cwd = Path.cwd()
    if (cwd / "strategies").is_dir() and (cwd / "src").is_dir():
        return cwd
    return Path(__file__).parent.parent.parent


PROJECT_DIR = _resolve_project_dir()
DB_PATH = PROJECT_DIR / "data" / "portfolio.db"
METHODOLOGY_PATH = PROJECT_DIR / "methodology.yaml"


def _load_startup_context() -> dict:
    """Load portfolio context for the welcome banner."""
    ctx = {"strategy": "unknown", "holdings": 0, "watchlist": 0}

    try:
        with open(METHODOLOGY_PATH) as f:
            data = yaml.safe_load(f)
        ctx["strategy"] = data.get("name", "unknown")
    except Exception:
        pass

    try:
        conn = sqlite3.connect(str(DB_PATH))
        ctx["holdings"] = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
        ctx["watchlist"] = conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
        conn.close()
    except Exception:
        pass

    return ctx


def _get_recent_alerts() -> list[str]:
    """Get unread alerts from the database."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT type, message, created_at FROM alerts WHERE read = 0 ORDER BY id DESC"
        ).fetchall()
        conn.close()
        return [f"[{row['type']}] {row['message'][:100]}" for row in rows]
    except Exception:
        return []


def run_chat():
    """Launch the interactive Owlfolio chat."""
    ctx = _load_startup_context()

    console.print(OWL_BANNER, highlight=False)
    console.print()
    console.print("  [bold]🦉 Owlfolio[/bold] — Investment Agent")
    console.print(
        f"  Strategy: {ctx['strategy']} | "
        f"Holdings: {ctx['holdings']} | "
        f"Watchlist: {ctx['watchlist']}"
    )

    # Show alerts if any
    alerts = _get_recent_alerts()
    if alerts:
        console.print(f"\n  [yellow]{len(alerts)} alert(s) since last session:[/yellow]")
        for alert in alerts[:3]:
            console.print(f"    {alert}")
        # Mark as read
        try:
            conn = sqlite3.connect(str(DB_PATH))
            conn.execute("UPDATE alerts SET read = 1 WHERE read = 0")
            conn.commit()
            conn.close()
        except Exception:
            pass

    console.print("  [dim]Type your questions. Ctrl+C to exit.[/dim]\n")

    try:
        asyncio.run(_chat_loop())
    except KeyboardInterrupt:
        console.print("\n  [dim]🦉 Goodbye.[/dim]")


async def _chat_loop():
    """Main conversation loop using Claude SDK Client."""
    agent_dir = Path(__file__).parent

    # Load memory context from DB
    from src.db.operations import get_memory_context

    memory_context = get_memory_context()

    # Read base CLAUDE.md
    claude_md = (agent_dir / "CLAUDE.md").read_text()

    # Combine into system prompt
    if memory_context:
        system_prompt = f"{claude_md}\n\n## Memory (from previous sessions)\n\n{memory_context}"
    else:
        system_prompt = claude_md

    # The chat agent's authority is bounded to the owlfolio MCP server's
    # typed tools — period. No Bash, no Read, no raw WebSearch.
    # WebSearch/WebFetch deliberately removed: the chat agent is a
    # portfolio manager applying the active strategy, not a web
    # researcher. For general-purpose finance questions there's
    # `mcp__owlfolio__quick_research` — a bounded typed wrapper.
    # See docs/ARCHITECTURE.md → Security Model.
    from src.mcp_server import SERVER as OWLFOLIO_MCP
    from src.mcp_server import allowed_tool_names

    async with ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model="claude-opus-4-7",
            permission_mode="bypassPermissions",
            cwd=str(PROJECT_DIR),
            system_prompt=system_prompt,
            mcp_servers={"owlfolio": OWLFOLIO_MCP},
            allowed_tools=allowed_tool_names(),
            disallowed_tools=[
                "Bash",
                "Read",
                "Glob",
                "Grep",
                "Edit",
                "Write",
                "NotebookEdit",
                "WebSearch",
                "WebFetch",
            ],
            # Adaptive extended thinking — model sizes its own thinking budget.
            thinking={"type": "adaptive"},
        ),
    ) as client:
        while True:
            try:
                user_input = console.input("[bold green]>[/bold green] ").strip()
            except (EOFError, KeyboardInterrupt):
                break

            if not user_input:
                continue

            if user_input.lower() in ("quit", "exit", "bye"):
                break

            console.print()

            try:
                await client.query(user_input)
                async for message in client.receive_response():
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if hasattr(block, "name") and hasattr(block, "input"):
                                # Tool use block — show what Owlfolio is doing
                                label = _format_tool_use(block)
                                console.print(f"  [dim]⚡ {label}[/dim]")
                            elif isinstance(block, TextBlock):
                                console.print(block.text)
                    elif isinstance(message, ResultMessage):
                        # Only print errors — text content already shown via AssistantMessage
                        if message.is_error and message.result:
                            console.print(f"  [red]Error: {message.result}[/red]")
                    elif isinstance(message, SystemMessage):
                        pass
            except Exception as e:
                console.print(f"  [red]Error: {e}[/red]")

            console.print()
