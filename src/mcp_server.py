"""Owlfolio MCP server — the bounded tool surface the chat agent uses.

This server exposes every operation the chat agent (CLI or Web) needs as
typed MCP tools. The chat agent's `allowed_tools` list contains the
`mcp__owlfolio__*` tool names plus `WebSearch` + `WebFetch`; everything
else (`Bash`, `Read`, `Glob`, `Grep`, `Edit`, `Write`) is removed.

That replaces "the agent has a shell" with "the agent has 30 typed tools."
A prompt-injection attack via web content can no longer escalate to host
shell — the worst case is the attacker invokes whatever read-only tools
already exist, which can't reach credentials or modify state.

Each tool:
  - Accepts a typed dict (TypedDict) describing its inputs.
  - Validates inputs (tickers, strategy names, share counts) at the
    operation layer (src/operations/) before doing anything.
  - Returns structured JSON the synthesis or chat agent can consume.
  - Wraps exceptions into `{"is_error": True}` MCP responses so a bad
    call never crashes the agent loop.

Mutation tools (`add_holding`, `sell_holding`, `switch_strategy`,
`schedule_task`, `unschedule_task`, `forget`, `remember`, `add_to_watchlist`,
`mark_alerts_read`, `take_snapshot`) are present so the chat agent can
*do things* on the user's behalf when asked. They require explicit
arguments — there's no "infer the ticker from context."
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from src.operations import (
    activity as op_activity,
    alerts as op_alerts,
    analyses as op_analyses,
    analysis as op_analysis,
    candidates as op_candidates,
    memory as op_memory,
    portfolio as op_portfolio,
    research as op_research,
    strategies as op_strategies,
    system as op_system,
    tasks as op_tasks,
    watchlist as op_watchlist,
)


def _ok(payload: Any) -> dict[str, Any]:
    """Wrap a successful tool result in MCP response format."""
    return {"content": [{"type": "text", "text": json.dumps(payload, default=str)}]}


def _err(message: str) -> dict[str, Any]:
    """Wrap a tool error in MCP response format."""
    return {
        "content": [{"type": "text", "text": message}],
        "is_error": True,
    }


# ─── Read-only: portfolio + holdings ──────────────────────────────────


@tool(
    "get_portfolio",
    "List the user's current portfolio holdings with live prices and P&L. "
    "Set with_prices=false to skip live price lookups (faster, no P&L).",
    {
        "ticker": Annotated[str, "Optional: filter to a single ticker"],
        "with_prices": Annotated[bool, "Fetch live prices and compute P&L (default true)"],
    },
)
async def get_portfolio(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_portfolio.list_holdings(
            ticker=args.get("ticker") or None,
            with_prices=bool(args.get("with_prices", True)),
        ))
    except Exception as e:
        return _err(f"get_portfolio: {e}")


@tool(
    "get_watchlist",
    "List every ticker on the user's watchlist with optional buy-zone prices.",
    {},
)
async def get_watchlist(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_watchlist.list_watchlist())
    except Exception as e:
        return _err(f"get_watchlist: {e}")


# ─── Read-only: alerts + tasks ───────────────────────────────────────


@tool(
    "get_alerts",
    "List recent alerts. Defaults to unread only.",
    {
        "unread_only": Annotated[bool, "If true (default), only unread alerts"],
        "limit": Annotated[int, "Max rows (default 20)"],
    },
)
async def get_alerts(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_alerts.list_alerts(
            unread_only=bool(args.get("unread_only", True)),
            limit=int(args.get("limit", 20)),
        ))
    except Exception as e:
        return _err(f"get_alerts: {e}")


@tool(
    "list_tasks",
    "List every scheduled task (cron jobs the daemon runs).",
    {},
)
async def list_tasks(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_tasks.list_tasks())
    except Exception as e:
        return _err(f"list_tasks: {e}")


@tool(
    "get_daemon_status",
    "Return whether the owlfolio daemon process is running. Scheduled tasks "
    "do not execute when the daemon is down.",
    {},
)
async def get_daemon_status(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_tasks.daemon_status())
    except Exception as e:
        return _err(f"get_daemon_status: {e}")


# ─── Read-only: strategies + specialists ─────────────────────────────


@tool(
    "list_strategies",
    "List every strategy YAML available in the strategies/ directory.",
    {},
)
async def list_strategies(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_strategies.list_strategies())
    except Exception as e:
        return _err(f"list_strategies: {e}")


@tool(
    "get_active_strategy",
    "Return a structured summary of the currently-active strategy "
    "(methodology.yaml). Includes criteria, weights, hurdle rates, "
    "specialist roster, decision rules.",
    {},
)
async def get_active_strategy(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_strategies.get_active_strategy())
    except Exception as e:
        return _err(f"get_active_strategy: {e}")


@tool(
    "get_strategy_info",
    "Return a structured summary of a named preset strategy (e.g. 'buffett-munger').",
    {"name": Annotated[str, "Strategy name (lowercase, hyphens)"]},
)
async def get_strategy_info(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_strategies.get_strategy_info(args["name"]))
    except Exception as e:
        return _err(f"get_strategy_info: {e}")


@tool(
    "list_specialists",
    "List the specialist roster for the active strategy (or a named one). "
    "Each specialist includes its role description and data sources.",
    {"strategy": Annotated[str, "Optional strategy name; defaults to active"]},
)
async def list_specialists(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_strategies.list_specialists(args.get("strategy") or None))
    except Exception as e:
        return _err(f"list_specialists: {e}")


# ─── Read-only: analysis history ─────────────────────────────────────


@tool(
    "list_analyses",
    "Return saved analyses, newest first. Optional ticker filter.",
    {
        "ticker": Annotated[str, "Optional ticker filter"],
        "limit": Annotated[int, "Max rows (default 20)"],
    },
)
async def list_analyses(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_analyses.list_analyses(
            ticker=args.get("ticker") or None,
            limit=int(args.get("limit", 20)),
        ))
    except Exception as e:
        return _err(f"list_analyses: {e}")


@tool(
    "get_latest_analysis",
    "Return the most recent saved analysis for a ticker (or null if none).",
    {"ticker": Annotated[str, "Ticker symbol"]},
)
async def get_latest_analysis(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_analyses.get_latest_analysis(args["ticker"]))
    except Exception as e:
        return _err(f"get_latest_analysis: {e}")


@tool(
    "get_analysis",
    "Look up a saved analysis by its `#NN` id token (e.g. user says "
    "'tell me about #42' or 'show analysis 42'). Returns the full "
    "synthesis result PLUS the per-specialist findings — use this to "
    "answer questions like 'what did moat_analyst say?' without "
    "re-running the (expensive) analyze pipeline.",
    {
        "id": Annotated[int, "Analysis id (the integer in the `#NN` reference)"],
        "with_findings": Annotated[bool, "Include per-specialist findings (default true)"],
    },
)
async def get_analysis(args: dict) -> dict[str, Any]:
    try:
        result = op_analyses.get_analysis(
            int(args["id"]),
            with_findings=bool(args.get("with_findings", True)),
        )
        if result is None:
            return _err(f"no analysis found with id={args['id']}")
        return _ok(result)
    except Exception as e:
        return _err(f"get_analysis: {e}")


@tool(
    "get_activity",
    "Unified chronological feed of meaningful actions: analyses, "
    "discovery/import lists, recorded buy/sell decisions, and "
    "daemon-fired task runs. Optionally filter by type. Use this when "
    "the user asks 'what have you been doing', 'show me recent "
    "activity', or wants to audit what the system did over a period.",
    {
        "type_filter": Annotated[str, "One of: analysis, list, decision, task_run, all (default all)"],
        "limit": Annotated[int, "Max events (default 50)"],
    },
)
async def get_activity(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_activity.get_activity(
            type_filter=args.get("type_filter") or None,
            limit=int(args.get("limit") or 50),
        ))
    except Exception as e:
        return _err(f"get_activity: {e}")


@tool(
    "delete_activity_event",
    "Delete a row from the activity feed. The user must explicitly ask "
    "for this — never delete inferred from conversation. Cascade behavior: "
    "deleting an analysis drops all its specialist_findings; deleting a "
    "list drops all its candidates; deleting a decision or task_run only "
    "removes that row. Confirm the reference before deleting.",
    {
        "event_type": Annotated[str, "One of: analysis, list, decision, task_run"],
        "reference": Annotated[
            str,
            "Reference token: integer id for analysis/decision/task_run, "
            "list name for list. Strip the `#` if the user quoted `#42` — "
            "pass `42`."
        ],
    },
)
async def delete_activity_event(args: dict) -> dict[str, Any]:
    try:
        et = (args.get("event_type") or "").strip()
        ref = args.get("reference")
        if not et or ref is None:
            return _err("delete_activity_event: event_type and reference are required")
        # Accept '42' or '#42' or 42 — caller-side strip the prefix
        if isinstance(ref, str) and ref.startswith(("#", "d#", "r#")):
            ref = ref.lstrip("#dr")
        deleted = op_activity.delete_event(et, ref)
        if not deleted:
            return _err(
                f"no {et} found with reference {args.get('reference')!r} — "
                "nothing was deleted"
            )
        return _ok({"deleted": True, "event_type": et, "reference": ref})
    except Exception as e:
        return _err(f"delete_activity_event: {e}")


@tool(
    "list_decisions",
    "Decision journal — every BUY/SELL/PASS recorded with reasoning. Optional ticker filter.",
    {
        "ticker": Annotated[str, "Optional ticker filter"],
        "limit": Annotated[int, "Max rows (default 50)"],
    },
)
async def list_decisions(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_analyses.list_decisions(
            ticker=args.get("ticker") or None,
            limit=int(args.get("limit", 50)),
        ))
    except Exception as e:
        return _err(f"list_decisions: {e}")


@tool(
    "compare_tickers",
    "Side-by-side comparison from the most recent saved analyses of two tickers.",
    {
        "ticker_a": Annotated[str, "First ticker"],
        "ticker_b": Annotated[str, "Second ticker"],
    },
)
async def compare_tickers(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_analyses.compare_tickers(args["ticker_a"], args["ticker_b"]))
    except Exception as e:
        return _err(f"compare_tickers: {e}")


# ─── Read-only: memory ───────────────────────────────────────────────


@tool(
    "list_memories",
    "List chat memory entries (notes the agent has saved across sessions).",
    {
        "category": Annotated[str, "Optional category filter (e.g. 'observation', 'preference')"],
        "limit": Annotated[int, "Max rows (default 50)"],
    },
)
async def list_memories(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_memory.list_memories(
            category=args.get("category") or None,
            limit=int(args.get("limit", 50)),
        ))
    except Exception as e:
        return _err(f"list_memories: {e}")


# ─── Read-only: system ───────────────────────────────────────────────


@tool(
    "get_doctor_report",
    "One-stop health report: Python version, Claude credentials, active "
    "strategy, portfolio DB state, web UI port availability, daemon status, "
    "runtime mode.",
    {},
)
async def get_doctor_report(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_system.doctor_report())
    except Exception as e:
        return _err(f"get_doctor_report: {e}")


# ─── Analysis (heavyweight — spawns the specialist pipeline) ─────────


@tool(
    "analyze",
    "Run the full specialist analysis pipeline on a ticker. Spawns 3-5 "
    "specialist subagents in parallel, then a synthesis agent reconciles "
    "their findings into a BUY/WATCH/PASS decision. Persists the result "
    "to the analyses table. Slow (~30-90s).",
    {
        "ticker": Annotated[str, "Ticker symbol (e.g. 'AAPL')"],
        "company_name": Annotated[str, "Optional human-readable name"],
        "shariah": Annotated[bool, "Add Shariah compliance specialist (default false)"],
    },
)
async def analyze(args: dict) -> dict[str, Any]:
    try:
        result = await op_analysis.analyze(
            ticker=args["ticker"],
            company_name=args.get("company_name") or None,
            shariah=bool(args.get("shariah", False)),
        )
        return _ok(result)
    except Exception as e:
        return _err(f"analyze: {e}")


@tool(
    "get_price",
    "Quick spot-price lookup for a ticker. No analysis pipeline. Use this "
    "instead of `analyze` when the user just wants to know what something "
    "is trading at.",
    {"ticker": Annotated[str, "Ticker symbol"]},
)
async def get_price(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_analysis.get_price(args["ticker"]))
    except Exception as e:
        return _err(f"get_price: {e}")


@tool(
    "run_addon",
    "Run a single addon specialist on a ticker WITHOUT the full strategy "
    "pipeline. Cheap (~1-2 min) and persists as a #NN audit row. "
    "Available addons: 'shariah' (compliance check), 'review' (light "
    "quarterly review vs saved thesis), 'news' (news pulse — what "
    "changed since last analysis?). The review and news addons are "
    "strategy-aware — they reference the active strategy and the most "
    "recent saved analysis. Use list_addons to see all available.",
    {
        "addon_name": Annotated[str, "Addon registry key (e.g. 'shariah')"],
        "ticker": Annotated[str, "Ticker symbol"],
        "company_name": Annotated[str, "Optional human-readable name"],
    },
)
async def run_addon(args: dict) -> dict[str, Any]:
    try:
        result = await op_analysis.run_addon(
            addon_name=args["addon_name"],
            ticker=args["ticker"],
            company_name=args.get("company_name") or None,
        )
        return _ok(result)
    except Exception as e:
        return _err(f"run_addon: {e}")


@tool(
    "quick_research",
    "Bounded WebSearch escape hatch for GENERAL-PURPOSE finance / markets "
    "questions only — NOT for analyzing a specific company. Use this for "
    "questions like 'did the Fed move rates this week?', 'what's the latest "
    "on the SECURE 2.0 changes?', 'who's the current Treasury Secretary?', "
    "'what's the 10-year yielding right now?'. For company analysis use the "
    "`analyze` pipeline (specialist team + strategy framework + audit row). "
    "If you find yourself reaching for this on a stock question, you're "
    "violating the architecture — use analyze instead.",
    {"query": Annotated[str, "Natural-language question (max 500 chars)"]},
)
async def quick_research(args: dict) -> dict[str, Any]:
    try:
        result = await op_research.quick_research(args["query"])
        return _ok(result)
    except Exception as e:
        return _err(f"quick_research: {e}")


@tool(
    "list_addons",
    "List the available addon specialists that can be run via run_addon "
    "or attached to a full analyze. Use this when the user asks 'what "
    "addons are available' or before guessing an addon name.",
    {},
)
async def list_addons(args: dict) -> dict[str, Any]:
    try:
        from src.specialists.addons import list_addons as _list
        return _ok({"addons": _list()})
    except Exception as e:
        return _err(f"list_addons: {e}")


# ─── Candidate lists: discovery + import + analyze-list ─────────────


@tool(
    "find_candidates",
    "Run the agentic discovery agent for the active strategy. SLOW (3-10 "
    "minutes) and uses real API credits — confirm with the user before "
    "calling. Persists results as a named candidate list.",
    {
        "n": Annotated[int, "Target number of candidates (default 15)"],
        "strategy_name": Annotated[str, "Override the active strategy"],
        "list_name": Annotated[str, "Name to save the list under (auto-generated if empty)"],
        "note": Annotated[str, "One-line description"],
        "shariah": Annotated[bool, "Apply Shariah compliance pre-filter to exclude non-compliant companies (default false)"],
    },
)
async def find_candidates(args: dict) -> dict[str, Any]:
    try:
        result = await op_candidates.find_candidates(
            strategy_name=args.get("strategy_name") or None,
            n=int(args.get("n") or 15),
            list_name=args.get("list_name") or None,
            note=args.get("note") or "",
            shariah=bool(args.get("shariah", False)),
        )
        return _ok(result)
    except Exception as e:
        return _err(f"find_candidates: {e}")


@tool(
    "import_candidates",
    "Import a ticker list the user pasted (CSV string, comma-separated, "
    "or whitespace-separated). Validates each ticker against yfinance "
    "and drops hallucinations / typos. Persists as a named candidate list.",
    {
        "source": Annotated[str, "Inline tickers OR a file path"],
        "list_name": Annotated[str, "Name to save the list under"],
        "strategy_name": Annotated[str, "Strategy this list targets (optional)"],
        "note": Annotated[str, "One-line description"],
    },
)
async def import_candidates(args: dict) -> dict[str, Any]:
    try:
        if not args.get("source") or not args.get("list_name"):
            return _err("import_candidates: 'source' and 'list_name' are required")
        result = op_candidates.import_candidates(
            source=args["source"],
            list_name=args["list_name"],
            strategy_name=args.get("strategy_name") or None,
            note=args.get("note") or "",
        )
        return _ok(result)
    except Exception as e:
        return _err(f"import_candidates: {e}")


@tool(
    "list_candidate_lists",
    "List all saved candidate lists with item counts and analysis progress.",
    {},
)
async def list_candidate_lists(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_candidates.list_lists())
    except Exception as e:
        return _err(f"list_candidate_lists: {e}")


@tool(
    "get_candidate_list",
    "Show all candidates in a named list, with their company info and "
    "analysis status.",
    {"name": Annotated[str, "Candidate list name"]},
)
async def get_candidate_list(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_candidates.show_list(args["name"]))
    except Exception as e:
        return _err(f"get_candidate_list: {e}")


@tool(
    "analyze_candidate_list",
    "Run the deep analyze pipeline against every candidate in a list. "
    "SLOW (each ticker takes ~2-5 min; concurrency is capped at 2-5 to "
    "prevent rate-limit / billing surprises). Confirm with the user "
    "before calling — a 25-ticker list takes ~30-60 minutes.",
    {
        "name": Annotated[str, "Candidate list name"],
        "strategy_name": Annotated[str, "Override strategy (default: list's stored strategy)"],
        "concurrency": Annotated[int, "Max concurrent analyses (default 2; max practical 5)"],
        "redo": Annotated[bool, "Re-analyze candidates already analyzed"],
        "shariah": Annotated[bool, "Also run Shariah compliance check"],
    },
)
async def analyze_candidate_list(args: dict) -> dict[str, Any]:
    try:
        result = await op_candidates.analyze_list(
            name=args["name"],
            strategy_name=args.get("strategy_name") or None,
            concurrency=int(args.get("concurrency") or 2),
            skip_analyzed=not bool(args.get("redo", False)),
            shariah=bool(args.get("shariah", False)),
        )
        return _ok(result)
    except Exception as e:
        return _err(f"analyze_candidate_list: {e}")


@tool(
    "delete_candidate_list",
    "Delete a candidate list and all its candidates (cascade). "
    "Confirm with the user first — this is irreversible.",
    {"name": Annotated[str, "Candidate list name"]},
)
async def delete_candidate_list(args: dict) -> dict[str, Any]:
    try:
        ok = op_candidates.delete_list(args["name"])
        return _ok({"deleted": ok, "name": args["name"]})
    except Exception as e:
        return _err(f"delete_candidate_list: {e}")


# ─── Mutation: portfolio + watchlist + memory ────────────────────────


@tool(
    "add_holding",
    "Record a stock purchase in the portfolio. The user must explicitly "
    "ask you to do this — never infer trades from conversation.",
    {
        "ticker": Annotated[str, "Ticker symbol"],
        "shares": Annotated[float, "Number of shares (must be > 0)"],
        "cost_basis": Annotated[float, "Per-share cost (must be > 0)"],
        "date_acquired": Annotated[str, "ISO date (defaults to today)"],
        "account": Annotated[str, "Account label (defaults to 'default')"],
        "strategy": Annotated[str, "Optional strategy that motivated the buy"],
        "notes": Annotated[str, "Optional notes"],
    },
)
async def add_holding(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_portfolio.add_holding(
            ticker=args["ticker"],
            shares=float(args["shares"]),
            cost_basis=float(args["cost_basis"]),
            date_acquired=args.get("date_acquired") or None,
            account=args.get("account") or "default",
            strategy=args.get("strategy") or None,
            notes=args.get("notes") or None,
        ))
    except Exception as e:
        return _err(f"add_holding: {e}")


@tool(
    "sell_holding",
    "Record a stock sale. The user must explicitly ask.",
    {
        "ticker": Annotated[str, "Ticker symbol"],
        "shares": Annotated[float, "Shares sold (must be > 0)"],
        "price": Annotated[float, "Per-share sale price (must be > 0)"],
    },
)
async def sell_holding(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_portfolio.sell_holding(
            ticker=args["ticker"],
            shares=float(args["shares"]),
            price=float(args["price"]),
        ))
    except Exception as e:
        return _err(f"sell_holding: {e}")


@tool(
    "add_to_watchlist",
    "Add a ticker to the watchlist with an optional buy-zone price.",
    {
        "ticker": Annotated[str, "Ticker symbol"],
        "buy_price": Annotated[float, "Optional buy-zone price"],
        "strategy": Annotated[str, "Optional strategy this watch is for"],
        "notes": Annotated[str, "Optional notes"],
    },
)
async def add_to_watchlist(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_watchlist.add_to_watchlist(
            ticker=args["ticker"],
            buy_price=float(args["buy_price"]) if args.get("buy_price") else None,
            strategy=args.get("strategy") or None,
            notes=args.get("notes") or None,
        ))
    except Exception as e:
        return _err(f"add_to_watchlist: {e}")


@tool(
    "remember",
    "Save a memory entry (persists across chat sessions). Use sparingly — "
    "only for facts the user wants you to recall later, not for routine "
    "context.",
    {
        "content": Annotated[str, "What to remember"],
        "category": Annotated[str, "Category (default 'observation'; e.g. 'preference')"],
        "ticker": Annotated[str, "Optional ticker the memory is about"],
    },
)
async def remember(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_memory.remember(
            content=args["content"],
            category=args.get("category") or "observation",
            ticker=args.get("ticker") or None,
        ))
    except Exception as e:
        return _err(f"remember: {e}")


@tool(
    "forget",
    "Delete a memory entry by its ID.",
    {"memory_id": Annotated[int, "Memory entry ID (from list_memories)"]},
)
async def forget(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_memory.forget(int(args["memory_id"])))
    except Exception as e:
        return _err(f"forget: {e}")


@tool(
    "mark_alerts_read",
    "Mark every unread alert as read. Returns the count.",
    {},
)
async def mark_alerts_read(args: dict) -> dict[str, Any]:
    try:
        return _ok({"marked_read": op_alerts.mark_all_read()})
    except Exception as e:
        return _err(f"mark_alerts_read: {e}")


# ─── Mutation: tasks + strategy switching ────────────────────────────


@tool(
    "schedule_task",
    "Schedule a cron task. The owlfolio daemon executes scheduled tasks.",
    {
        "name": Annotated[str, "Unique task name"],
        "command": Annotated[str, "Shell command to run (typically 'owlfolio ...')"],
        "schedule": Annotated[str, "Cron expression (e.g. '0 9 * * 1' = Mondays at 9am)"],
        "description": Annotated[str, "Optional human-readable description"],
        "timezone": Annotated[str, "Timezone (default UTC; e.g. 'Asia/Dubai')"],
    },
)
async def schedule_task(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_tasks.add_task(
            name=args["name"],
            command=args["command"],
            schedule=args["schedule"],
            description=args.get("description") or None,
            timezone=args.get("timezone") or "UTC",
        ))
    except Exception as e:
        return _err(f"schedule_task: {e}")


@tool(
    "unschedule_task",
    "Delete a scheduled task by ID.",
    {"task_id": Annotated[int, "Task ID (from list_tasks)"]},
)
async def unschedule_task(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_tasks.remove_task(int(args["task_id"])))
    except Exception as e:
        return _err(f"unschedule_task: {e}")


@tool(
    "switch_strategy",
    "Switch the active strategy by copying a named preset to methodology.yaml. "
    "Confirm with the user before switching — this changes how every "
    "subsequent analysis behaves.",
    {"name": Annotated[str, "Strategy name (e.g. 'buffett-munger')"]},
)
async def switch_strategy(args: dict) -> dict[str, Any]:
    try:
        return _ok(op_strategies.switch_strategy(args["name"]))
    except Exception as e:
        return _err(f"switch_strategy: {e}")


# ─── Server assembly ─────────────────────────────────────────────────


ALL_TOOLS = [
    # Read-only — portfolio + watchlist + alerts + tasks
    get_portfolio, get_watchlist, get_alerts, list_tasks, get_daemon_status,
    # Read-only — strategies + specialists
    list_strategies, get_active_strategy, get_strategy_info, list_specialists,
    # Read-only — analyses + memory
    list_analyses, get_latest_analysis, get_analysis, get_activity,
    list_decisions, compare_tickers, list_memories,
    # Read-only — system
    get_doctor_report,
    # Analysis pipeline
    analyze, get_price, run_addon, list_addons, quick_research,
    # Candidate lists (discovery + import + analyze-list)
    find_candidates, import_candidates, list_candidate_lists,
    get_candidate_list, analyze_candidate_list, delete_candidate_list,
    # Mutation
    add_holding, sell_holding, add_to_watchlist, remember, forget,
    mark_alerts_read, schedule_task, unschedule_task, switch_strategy,
    delete_activity_event,
]


SERVER = create_sdk_mcp_server(name="owlfolio", version="1.0.0", tools=ALL_TOOLS)


def allowed_tool_names() -> list[str]:
    """Return the MCP tool identifiers the chat agent should be allowlisted for.

    Format is `mcp__<server_name>__<tool_name>` per the Agent SDK convention.
    """
    return [f"mcp__owlfolio__{t.name}" for t in ALL_TOOLS]
