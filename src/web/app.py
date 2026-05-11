"""Owlfolio Web UI -- FastAPI application."""

import asyncio
import os
import sqlite3
from pathlib import Path

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="Owlfolio", docs_url=None, redoc_url=None)

WEB_DIR = Path(__file__).parent
TEMPLATES = Jinja2Templates(directory=str(WEB_DIR / "templates"))


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
    return WEB_DIR.parent.parent


PROJECT_DIR = _resolve_project_dir()
DB_PATH = PROJECT_DIR / "data" / "portfolio.db"
AGENT_DIR = PROJECT_DIR / "src" / "agent"

# Mount static files
app.mount("/static", StaticFiles(directory=str(WEB_DIR / "static")), name="static")


def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _load_strategies() -> list[dict]:
    """Load all preset strategies from the strategies/ directory."""
    strategies = []
    strategies_dir = PROJECT_DIR / "strategies"
    if not strategies_dir.exists():
        return strategies
    for f in sorted(strategies_dir.glob("*.yaml")):
        try:
            with open(f) as fh:
                raw = yaml.safe_load(fh)
            if raw:
                desc = raw.get("description", "").strip()
                # Truncate to first sentence or 80 chars
                if len(desc) > 80:
                    desc = desc[:77] + "..."
                strategies.append(
                    {
                        "name": raw.get("name", f.stem),
                        "description": desc,
                    }
                )
        except Exception:
            pass
    return strategies


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main dashboard -- chat + sidebar panels."""
    conn = _get_db()

    # Portfolio
    holdings = [dict(r) for r in conn.execute("SELECT * FROM holdings").fetchall()]

    # Watchlist
    watchlist = [dict(r) for r in conn.execute("SELECT * FROM watchlist").fetchall()]

    # Alerts
    alerts = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM alerts WHERE read = 0 ORDER BY id DESC LIMIT 5"
        ).fetchall()
    ]

    # Active strategy
    strategy_name = "unknown"
    try:
        with open(PROJECT_DIR / "methodology.yaml") as f:
            strategy_name = yaml.safe_load(f).get("name", "unknown")
    except Exception:
        pass

    # All available strategies
    strategies = _load_strategies()

    # Scheduled tasks
    tasks = [dict(r) for r in conn.execute("SELECT * FROM scheduled_tasks ORDER BY id").fetchall()]

    conn.close()

    # Check if daemon is running
    from src.daemon import is_daemon_running

    daemon_running = is_daemon_running()

    response = TEMPLATES.TemplateResponse(
        request,
        "dashboard.html",
        context={
            "holdings": holdings,
            "watchlist": watchlist,
            "alerts": alerts,
            "strategy": strategy_name,
            "strategies": strategies,
            "tasks": tasks,
            "daemon_running": daemon_running,
        },
    )
    # No-store + must-revalidate on the dashboard HTML itself. Without
    # this, browsers happily hold the previous render across `serve
    # --restart` and keep polling deleted endpoints with the old htmx
    # wiring (the strategy-badge-stuck-on-old-name bug). The chat is
    # all-WebSocket and the sidebar is htmx-polled, so caching the
    # outer HTML buys nothing.
    response.headers["Cache-Control"] = "no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/api/strategies")
async def api_strategies():
    """Get list of available strategies."""
    return _load_strategies()


# Sidebar data endpoints (htmx polling)
@app.get("/api/portfolio", response_class=HTMLResponse)
async def api_portfolio(request: Request, strategy: str | None = None):
    from src.operations.portfolio import list_holdings

    result = list_holdings(ticker=None, with_prices=True)
    holdings = result["holdings"]
    if strategy:
        holdings = [h for h in holdings if h.get("strategy") == strategy]
    return TEMPLATES.TemplateResponse(
        request,
        "partials/portfolio.html",
        context={
            "holdings": holdings,
            "totals": result["totals"],
            "active_strategy_filter": strategy or "",
        },
    )


@app.get("/api/watchlist", response_class=HTMLResponse)
async def api_watchlist(request: Request, strategy: str | None = None, fresh: str | None = None):
    conn = _get_db()
    if strategy:
        watchlist = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM watchlist WHERE strategy = ?", (strategy,)
            ).fetchall()
        ]
    else:
        watchlist = [dict(r) for r in conn.execute("SELECT * FROM watchlist").fetchall()]

    # Always enrich with live prices (skip only if ?fresh=false explicitly)
    skip_fresh = fresh and fresh.lower() in ("false", "0", "no")
    if not skip_fresh:
        from src.data.prices import get_price_data
        from src.db.operations import update_latest_analysis_price, update_watchlist_price

        for w in watchlist:
            try:
                price_data = get_price_data(w["ticker"])
                if price_data.price and price_data.price > 0:
                    w["current_price"] = price_data.price
                    update_watchlist_price(conn, w["ticker"], price_data.price)
                    update_latest_analysis_price(conn, w["ticker"], price_data.price)
            except Exception:
                pass

    conn.close()
    return TEMPLATES.TemplateResponse(
        request,
        "partials/watchlist.html",
        context={"watchlist": watchlist, "active_strategy_filter": strategy or ""},
    )


@app.get("/api/alerts", response_class=HTMLResponse)
async def api_alerts(request: Request):
    conn = _get_db()
    alerts = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM alerts WHERE read = 0 ORDER BY id DESC LIMIT 5"
        ).fetchall()
    ]
    conn.close()
    return TEMPLATES.TemplateResponse(
        request,
        "partials/alerts.html",
        context={"alerts": alerts},
    )


@app.get("/api/task-run/{run_id}")
async def api_task_run(run_id: int):
    """Return the full stdout of a task run for alert detail view."""
    conn = _get_db()
    row = conn.execute(
        "SELECT task_name, started_at, finished_at, exit_code, stdout_excerpt, stderr_excerpt FROM task_runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    conn.close()
    if not row:
        return {"error": "not found"}
    r = dict(row)
    return {
        "task_name": r["task_name"],
        "started_at": r["started_at"],
        "finished_at": r["finished_at"],
        "exit_code": r["exit_code"],
        "stdout": r["stdout_excerpt"] or "",
        "stderr": r["stderr_excerpt"] or "",
    }


@app.get("/api/tasks", response_class=HTMLResponse)
async def api_tasks(request: Request):
    return _render_tasks(request)


def _render_tasks(request: Request):
    """Re-render the tasks partial — shared by all task mutation endpoints."""
    conn = _get_db()
    tasks = [dict(r) for r in conn.execute("SELECT * FROM scheduled_tasks ORDER BY id").fetchall()]
    from src.daemon import is_daemon_running

    daemon_running = is_daemon_running()
    conn.close()
    return TEMPLATES.TemplateResponse(
        request,
        "partials/tasks.html",
        context={"tasks": tasks, "daemon_running": daemon_running},
    )


@app.post("/api/tasks/{task_id}/toggle", response_class=HTMLResponse)
async def api_task_toggle(request: Request, task_id: int):
    """Toggle a task's enabled state."""
    from src.db.operations import toggle_task

    conn = _get_db()
    row = conn.execute("SELECT enabled FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    if row:
        toggle_task(conn, task_id, not bool(row["enabled"]))
    conn.close()
    return _render_tasks(request)


@app.delete("/api/tasks/{task_id}", response_class=HTMLResponse)
async def api_task_delete(request: Request, task_id: int):
    """Delete a scheduled task."""
    from src.db.operations import delete_scheduled_task

    conn = _get_db()
    delete_scheduled_task(conn, task_id)
    conn.close()
    return _render_tasks(request)


@app.post("/api/tasks/{task_id}/run", response_class=HTMLResponse)
async def api_task_run(request: Request, task_id: int):
    """Manually trigger a task immediately (runs in background thread)."""
    import asyncio

    from src.daemon import _execute_task

    conn = _get_db()
    row = conn.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    if row:
        asyncio.get_event_loop().run_in_executor(None, _execute_task, dict(row))
    return _render_tasks(request)


@app.put("/api/tasks/{task_id}", response_class=HTMLResponse)
async def api_task_update(request: Request, task_id: int):
    """Update a task's schedule, command, or other fields."""
    from croniter import croniter

    from src.db.operations import update_scheduled_task

    body = await request.json()
    schedule = body.get("schedule")
    if schedule and not croniter.is_valid(schedule):
        return HTMLResponse(
            "<p class='text-red-400 text-sm px-3 py-2'>Invalid cron expression</p>",
            status_code=400,
        )
    conn = _get_db()
    update_scheduled_task(
        conn,
        task_id,
        schedule=schedule,
        command=body.get("command"),
        name=body.get("name"),
        description=body.get("description"),
        timezone=body.get("timezone"),
    )
    conn.close()
    return _render_tasks(request)


@app.post("/api/tasks", response_class=HTMLResponse)
async def api_task_create(request: Request):
    """Create a new scheduled task."""
    from croniter import croniter

    from src.db.operations import add_scheduled_task

    body = await request.json()
    name = body.get("name", "").strip()
    command = body.get("command", "").strip()
    schedule = body.get("schedule", "").strip()
    timezone = body.get("timezone", "UTC").strip()
    description = body.get("description", "").strip()
    if not name or not command or not schedule:
        return HTMLResponse(
            "<p class='text-red-400 text-sm px-3 py-2'>"
            "Name, command, and schedule are required</p>",
            status_code=400,
        )
    if not croniter.is_valid(schedule):
        return HTMLResponse(
            "<p class='text-red-400 text-sm px-3 py-2'>Invalid cron expression</p>",
            status_code=400,
        )
    # Validate owlfolio subcommands
    try:
        from src.operations.tasks import _validate_owlfolio_command

        _validate_owlfolio_command(command)
    except ValueError as e:
        return HTMLResponse(f"<p class='text-red-400 text-sm px-3 py-2'>{e}</p>", status_code=400)
    conn = _get_db()
    add_scheduled_task(
        conn,
        name=name,
        command=command,
        schedule=schedule,
        timezone=timezone,
        description=description,
    )
    conn.close()
    return _render_tasks(request)


def _read_active_strategy_name() -> str:
    """Single source of truth for the active strategy name."""
    # Use the same METHODOLOGY_PATH the strategies op writes to — that
    # way endpoint reads + agent writes can never disagree.
    from src.operations.strategies import METHODOLOGY_PATH

    try:
        with open(METHODOLOGY_PATH) as f:
            return yaml.safe_load(f).get("name", "unknown")
    except Exception:
        return "unknown"


@app.get("/api/active-strategy-name", response_class=HTMLResponse)
async def api_active_strategy_name():
    """Tiny endpoint that returns ONLY the active strategy name as
    plain text (or HTML, but the contents are just text). htmx-polled
    every 2s by the badge span in the header. No Alpine, no markup —
    swap is unconditionally safe.
    """
    response = HTMLResponse(content=_read_active_strategy_name())
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/strategy-dropdown-body", response_class=HTMLResponse)
async def api_strategy_dropdown_body(request: Request):
    """Dropdown body — refreshed when the user opens the dropdown
    (or when a switch fires). Renders the strategy list with the
    active-checkmark in the right place. Returns markup that swaps
    cleanly because it's NOT inside an Alpine-bound parent at the
    same level.
    """
    response = TEMPLATES.TemplateResponse(
        request,
        "partials/strategy_dropdown_body.html",
        context={
            "strategy": _read_active_strategy_name(),
            "strategies": _load_strategies(),
        },
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/daemon-status", response_class=HTMLResponse)
async def api_daemon_status(request: Request):
    """Header daemon-status indicator. htmx-polled every 5s so the
    header pill stays in sync with the Schedule tab — without this
    the header is rendered once at page load and never updates.
    """
    from src.daemon import is_daemon_running

    daemon_running = is_daemon_running()
    response = TEMPLATES.TemplateResponse(
        request,
        "partials/daemon_status.html",
        context={"daemon_running": daemon_running},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/lists", response_class=HTMLResponse)
async def api_lists(request: Request):
    """Candidate lists (from `find` discovery + `import` ingest)."""
    from src.operations.candidates import list_lists

    return TEMPLATES.TemplateResponse(
        request,
        "partials/lists.html",
        context={"lists": list_lists()},
    )


@app.get("/api/analysis/{analysis_id}/findings", response_class=HTMLResponse)
async def api_analysis_findings(request: Request, analysis_id: int):
    """Specialist findings drilldown — lazy-loaded by htmx when the user
    expands an analysis row in the activity feed or chat."""
    from src.operations.analyses import get_specialist_findings_for_analysis

    try:
        findings = get_specialist_findings_for_analysis(analysis_id)
    except ValueError:
        findings = []
    return TEMPLATES.TemplateResponse(
        request,
        "partials/specialist_findings.html",
        context={"findings": findings, "analysis_id": analysis_id},
    )


@app.get("/api/activity", response_class=HTMLResponse)
async def api_activity(request: Request, type_filter: str = "all", strategy: str | None = None):
    """Unified chronological activity feed."""
    from src.operations.activity import get_activity

    try:
        events = get_activity(
            type_filter=None if type_filter == "all" else type_filter,
            strategy=strategy or None,
            limit=50,
        )
    except ValueError:
        events = []
    return TEMPLATES.TemplateResponse(
        request,
        "partials/activity.html",
        context={
            "events": events,
            "active_filter": type_filter,
            "active_strategy_filter": strategy or "",
        },
    )


@app.delete("/api/activity/{event_type}/{reference}", response_class=HTMLResponse)
async def api_activity_delete(
    request: Request,
    event_type: str,
    reference: str,
    type_filter: str = "all",
    strategy: str | None = None,
):
    """Delete an activity row, then return the refreshed feed.

    htmx-driven from the row's delete button; the response replaces the
    whole #activity-panel so the deleted row + counts update in one
    swap. type_filter is forwarded so we re-render the panel under the
    same active filter the user had selected.
    """
    from src.operations.activity import delete_event, get_activity

    try:
        delete_event(event_type, reference)
    except ValueError:
        # Bad input — fall through to a feed re-render so the user sees
        # the unchanged state and the stale row is still there.
        pass
    try:
        events = get_activity(
            type_filter=None if type_filter == "all" else type_filter,
            strategy=strategy or None,
            limit=50,
        )
    except ValueError:
        events = []
    return TEMPLATES.TemplateResponse(
        request,
        "partials/activity.html",
        context={
            "events": events,
            "active_filter": type_filter,
            "active_strategy_filter": strategy or "",
        },
    )


@app.post("/api/daemon/start")
async def api_daemon_start():
    """Start the Owlfolio daemon in the background."""
    import subprocess
    import sys

    try:
        subprocess.Popen(
            [sys.executable, "-m", "src.main", "daemon"],
            cwd=str(PROJECT_DIR),
            stdout=open(PROJECT_DIR / "logs" / "daemon.log", "a"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        return {"status": "started"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


CONFIG_PATH = PROJECT_DIR / "data" / "config.yaml"

KNOWN_MARKETS = [
    {"code": "US", "label": "NYSE / NASDAQ"},
    {"code": "IN", "label": "NSE / BSE"},
    {"code": "AE", "label": "ADX / DFM"},
    {"code": "UK", "label": "LSE"},
    {"code": "HK", "label": "HKEX"},
    {"code": "CA", "label": "TSX"},
    {"code": "JP", "label": "TSE"},
    {"code": "AU", "label": "ASX"},
    {"code": "SA", "label": "Tadawul"},
    {"code": "DE", "label": "XETRA"},
    {"code": "BR", "label": "B3"},
]


def _read_config() -> dict:
    """Read data/config.yaml, returning empty dict on missing/corrupt."""
    try:
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH) as f:
                return yaml.safe_load(f) or {}
    except Exception:
        pass
    return {}


def _write_config(cfg: dict) -> None:
    """Write data/config.yaml, preserving non-markets keys."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False)


@app.get("/api/config/markets")
async def api_config_markets_get():
    """Return the current markets list from config.yaml."""
    cfg = _read_config()
    return {"markets": cfg.get("markets", ["US"])}


@app.post("/api/config/markets")
async def api_config_markets_post(request: Request):
    """Update the markets list in config.yaml."""
    body = await request.json()
    markets = body.get("markets", [])
    # Validate: only accept known market codes
    valid_codes = {m["code"] for m in KNOWN_MARKETS}
    markets = [m for m in markets if m in valid_codes]
    if not markets:
        markets = ["US"]  # always have at least one
    cfg = _read_config()
    cfg["markets"] = markets
    _write_config(cfg)
    return {"markets": markets}


_whisper_model = None
_whisper_loading = False


def _whisper_available() -> bool:
    """Check if faster-whisper is importable."""
    try:
        import faster_whisper  # noqa: F401

        return True
    except ImportError:
        return False


def _whisper_model_ready() -> bool:
    """Check if the model is already loaded in memory."""
    return _whisper_model is not None


def _get_whisper_model():
    """Lazy-load the faster-whisper model (downloaded on first use)."""
    global _whisper_model, _whisper_loading
    if _whisper_model is None:
        _whisper_loading = True
        try:
            from faster_whisper import WhisperModel

            # "base" is a good default: 74MB, fast on CPU, decent accuracy.
            # Users can override via WHISPER_MODEL env (tiny/small/medium/large-v3).
            model_size = os.environ.get("WHISPER_MODEL", "base")
            device = os.environ.get("WHISPER_DEVICE", "cpu")
            compute = "int8" if device == "cpu" else "float16"
            _whisper_model = WhisperModel(model_size, device=device, compute_type=compute)
        finally:
            _whisper_loading = False
    return _whisper_model


@app.get("/api/voice/status")
async def api_voice_status():
    """Check voice input availability.

    Returns status so the frontend can show/hide the mic button
    and display appropriate setup messages.
    """
    if not _whisper_available():
        return {"available": False, "reason": "not_installed"}
    if _whisper_loading:
        return {"available": True, "ready": False, "status": "loading"}
    if _whisper_model_ready():
        return {"available": True, "ready": True, "status": "ready"}
    # Installed but model not yet loaded (will load on first transcription)
    return {"available": True, "ready": False, "status": "idle"}


@app.post("/api/transcribe")
async def api_transcribe(request: Request):
    """Transcribe audio locally using faster-whisper (no data leaves the machine).

    Accepts multipart form data with an 'audio' file field.
    Returns {"text": "transcribed text"} or {"error": "message"}.
    Auto-detects language (99 languages supported).
    """
    import tempfile

    form = await request.form()
    audio = form.get("audio")
    if not audio:
        return {"error": "No audio file provided."}

    try:
        model = _get_whisper_model()

        # Save upload to a temp file (Whisper needs a file path)
        contents = await audio.read()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        segments, info = model.transcribe(tmp_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments)

        os.unlink(tmp_path)
        return {
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 2),
        }
    except ImportError:
        return {"error": "Voice not available. Reinstall with: pip install 'owlfolio[web]'"}
    except Exception as e:
        return {"error": f"Transcription failed: {e}"}


@app.post("/api/daemon/stop")
async def api_daemon_stop():
    """Stop the Owlfolio daemon."""
    from src.daemon import stop_daemon

    try:
        if stop_daemon():
            return {"status": "stopped"}
        return {"status": "not_running"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _build_chat_system_prompt() -> str:
    """Compose CLAUDE.md + persisted memory into the chat system prompt."""
    try:
        claude_md = (AGENT_DIR / "CLAUDE.md").read_text()
    except OSError:
        claude_md = "You are Owlfolio, a personal investment agent."

    memory_context = ""
    try:
        from src.db.operations import get_memory_context

        memory_context = get_memory_context() or ""
    except Exception:
        pass

    if memory_context:
        return f"{claude_md}\n\n## Memory (from previous sessions)\n\n{memory_context}"
    return claude_md


def _format_tool_use(block) -> str:
    """One-line summary of a tool_use block for the UI."""
    name = getattr(block, "name", "tool")
    inp = getattr(block, "input", {})
    if not isinstance(inp, dict):
        return name
    if name == "Bash":
        return f"Bash: {(inp.get('command') or '')[:120]}"
    if name in ("Read", "Edit", "Write"):
        return f"{name}: {inp.get('file_path', '')}"
    if name == "Grep":
        return f"Grep: '{inp.get('pattern', '')}' in {inp.get('path', '')}"
    if name == "Glob":
        return f"Glob: {inp.get('pattern', '')}"
    if name == "WebSearch":
        return f"Search: {(inp.get('query') or '')[:100]}"
    if name == "WebFetch":
        return f"Fetch: {(inp.get('url') or '')[:120]}"
    first_val = next((str(v)[:80] for v in inp.values() if v), "")
    return f"{name}: {first_val}" if first_val else name


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """Stream a real Claude Agent conversation over WebSocket.

    Outbound message types:
      {"type": "thinking", "content": true|false}
      {"type": "tool_use", "label": "..."}
      {"type": "message_start"}
      {"type": "token",        "content": "..."}    (incremental text delta)
      {"type": "message_end",  "content": "..."}    (final full text — client re-renders markdown)
      {"type": "error",        "content": "..."}
    """
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ClaudeSDKClient,
        ResultMessage,
        StreamEvent,
        TextBlock,
    )

    await websocket.accept()
    system_prompt = _build_chat_system_prompt()

    # The chat agent's authority is bounded to the owlfolio MCP server's
    # typed tools — period. No Bash, no Read, no raw WebSearch.
    #
    # WebSearch + WebFetch are deliberately NOT here. The chat agent is a
    # portfolio manager applying the active strategy; its job is to run
    # the analyze pipeline (specialist team + strategy synthesis), not to
    # freelance web research. For ad-hoc general-purpose finance questions
    # there's `mcp__owlfolio__quick_research` — a typed wrapper that
    # internally spawns a bounded SDK query with WebSearch. The chat agent
    # never gets raw web access, so it can't pretend to "analyze" a
    # company by Googling it. See docs/ARCHITECTURE.md → Security Model.
    from src.mcp_server import SERVER as OWLFOLIO_MCP
    from src.mcp_server import allowed_tool_names

    options = ClaudeAgentOptions(
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
        # Adaptive extended thinking for the chat agent — same default as the
        # specialist subagents, so the web chat reasons as deeply as the CLI chat.
        thinking={"type": "adaptive"},
        # Token-level streaming — client gets `text_delta` events to drive a
        # live typing cursor instead of receiving full TextBlocks at end of turn.
        include_partial_messages=True,
    )

    try:
        async with ClaudeSDKClient(options=options) as client:
            while True:
                user_msg = await websocket.receive_text()
                if not user_msg.strip():
                    continue
                # Ignore keepalive pings from the client
                if user_msg.strip().startswith('{"type"') and '"ping"' in user_msg:
                    await websocket.send_json({"type": "pong"})
                    continue

                await websocket.send_json({"type": "thinking", "content": True})

                # Track the in-progress assistant text per content block index.
                # The SDK emits `content_block_start` (we open a bubble),
                # `content_block_delta` (we push tokens), and `content_block_stop`
                # (we finalize) inside the raw stream events. We accumulate the
                # full text so the final `message_end` can carry the canonical
                # value and the client can re-parse to markdown once.
                streaming_text: dict[int, str] = {}
                bubble_open = False

                async def _close_bubble():
                    nonlocal bubble_open
                    if bubble_open:
                        # Send the final canonical text so the client can swap
                        # the plain-text typing buffer for fully-rendered markdown.
                        joined = "".join(streaming_text[i] for i in sorted(streaming_text.keys()))
                        await websocket.send_json(
                            {
                                "type": "message_end",
                                "content": joined,
                            }
                        )
                        bubble_open = False
                        streaming_text.clear()

                try:
                    await client.query(user_msg)
                    async for message in client.receive_response():
                        if isinstance(message, StreamEvent):
                            evt = message.event or {}
                            etype = evt.get("type")
                            if etype == "content_block_start":
                                block = evt.get("content_block") or {}
                                if block.get("type") == "text":
                                    if not bubble_open:
                                        await websocket.send_json({"type": "message_start"})
                                        bubble_open = True
                                    streaming_text[evt.get("index", 0)] = ""
                            elif etype == "content_block_delta":
                                delta = evt.get("delta") or {}
                                if delta.get("type") == "text_delta":
                                    chunk = delta.get("text") or ""
                                    idx = evt.get("index", 0)
                                    streaming_text[idx] = streaming_text.get(idx, "") + chunk
                                    if chunk:
                                        await websocket.send_json(
                                            {
                                                "type": "token",
                                                "content": chunk,
                                            }
                                        )
                            # message_stop / content_block_stop close handled below
                        elif isinstance(message, AssistantMessage):
                            # The SDK still delivers a consolidated AssistantMessage at
                            # end-of-turn. If we never received deltas (e.g. partial
                            # messages disabled by the model), fall back to sending the
                            # full TextBlock as a single token so the bubble still works.
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    if not streaming_text:
                                        if not bubble_open:
                                            await websocket.send_json({"type": "message_start"})
                                            bubble_open = True
                                        await websocket.send_json(
                                            {
                                                "type": "token",
                                                "content": block.text,
                                            }
                                        )
                                        streaming_text[0] = block.text
                                elif hasattr(block, "name") and hasattr(block, "input"):
                                    await _close_bubble()
                                    await websocket.send_json(
                                        {
                                            "type": "tool_use",
                                            "label": _format_tool_use(block),
                                        }
                                    )
                                    # State-mutation push events. Earlier
                                    # attempts (htmx polling + client-side
                                    # regex on tool labels) failed in subtle
                                    # ways — Alpine/htmx swap interaction,
                                    # browser HTML caching, missed events.
                                    # The server already knows exactly when
                                    # switch_strategy is dispatched, so we
                                    # emit a dedicated event the client uses
                                    # to set DOM text directly via vanilla JS.
                                    # No swap, no poll, no inference.
                                    #
                                    # Two-stage emission to handle SDK timing:
                                    # the tool_use block here is the model's
                                    # REQUEST — the SDK will run the tool right
                                    # after we yield. Stage 1 trusts the
                                    # requested name for instant UI feedback;
                                    # Stage 2 re-reads methodology.yaml after
                                    # a brief delay to confirm the canonical
                                    # truth (and corrects if the tool errored).
                                    if block.name == "mcp__owlfolio__switch_strategy":
                                        requested = (block.input or {}).get("name")
                                        if isinstance(requested, str) and requested:
                                            # Stage 1: instant optimistic update.
                                            await websocket.send_json(
                                                {
                                                    "type": "strategy_changed",
                                                    "name": requested,
                                                }
                                            )

                                        # Stage 2: scheduled canonical re-check.
                                        async def _confirm_strategy_change(ws):
                                            await asyncio.sleep(0.6)
                                            try:
                                                await ws.send_json(
                                                    {
                                                        "type": "strategy_changed",
                                                        "name": _read_active_strategy_name(),
                                                    }
                                                )
                                            except Exception:
                                                pass  # WS may have closed

                                        asyncio.create_task(_confirm_strategy_change(websocket))
                            # End of an assistant turn — finalize whatever was streaming.
                            await _close_bubble()
                        elif isinstance(message, ResultMessage):
                            await _close_bubble()
                            if message.is_error and message.result:
                                await websocket.send_json(
                                    {
                                        "type": "error",
                                        "content": message.result,
                                    }
                                )
                except Exception as e:
                    await _close_bubble()
                    await websocket.send_json({"type": "error", "content": str(e)})
                finally:
                    await _close_bubble()
                    await websocket.send_json({"type": "thinking", "content": False})
    except WebSocketDisconnect:
        return
